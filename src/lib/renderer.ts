import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { prisma } from './prisma';
import { StorageService } from './storage';
import { getIntelligibleName } from './naming';

// Use bundled FFmpeg binaries (works on Vercel and Docker)
ffmpeg.setFfmpegPath(ffmpegStatic!);
ffmpeg.setFfprobePath(ffprobePath.path);

async function downloadFile(url: string, dest: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(dest);
                https.get(url, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                        return;
                    }
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', (err) => {
                    fs.unlink(dest, () => reject(err));
                });
            });
        } catch (err) {
            if (i === retries - 1) throw err;
            console.log(`[Renderer] Download retry ${i + 1} for ${url}`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

/**
 * UA VIDEO RENDER ENGINE
 * Authoritative 1:1 Square Master
 * 
 * Implements:
 * - Brand Palette (Black, Off-White, Muted Amber)
 * - Caption Hierarchy (Primary, Secondary, Emphasis)
 * - Editorial Lag (200-300ms)
 * - Ken Burns (Atmospheric)
 */

interface RenderOptions {
    scriptId: string;
    outputName?: string;
    aspectRatio?: string; // "1:1", "9:16", or "16:9"
}

/**
 * Cleans up temporary files for a given render ID.
 * Only removes files in the tmp folder associated with that render.
 * Logs deleted files with timestamps.
 */
export function cleanupTempFiles(renderId: string) {
    const tmpDir = path.join('/tmp', renderId);

    if (!fs.existsSync(tmpDir)) {
        console.log(`[${new Date().toISOString()}] [CLEANUP] No temp folder found for render ${renderId}`);
        return;
    }

    const deleteRecursive = (dir: string) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stats = fs.lstatSync(fullPath);

            if (stats.isDirectory()) {
                deleteRecursive(fullPath);
                try {
                    fs.rmdirSync(fullPath);
                    console.log(`[${new Date().toISOString()}] [CLEANUP] Removed directory: ${fullPath}`);
                } catch (err) {
                    console.error(`[${new Date().toISOString()}] [CLEANUP] Failed to remove directory ${fullPath}:`, err);
                }
            } else {
                try {
                    fs.unlinkSync(fullPath);
                    console.log(`[${new Date().toISOString()}] [CLEANUP] Deleted temp file: ${fullPath}`);
                } catch (err) {
                    console.error(`[${new Date().toISOString()}] [CLEANUP] Failed to delete file ${fullPath}:`, err);
                }
            }
        }
    };

    try {
        deleteRecursive(tmpDir);
        fs.rmdirSync(tmpDir);
        console.log(`[${new Date().toISOString()}] [CLEANUP] Completed cleanup for render ${renderId}`);
    } catch (err) {
        console.error(`[${new Date().toISOString()}] [CLEANUP] Error during cleanup for ${renderId}:`, err);
    }
}

export async function renderVideo({ scriptId, outputName, aspectRatio: overrideRatio }: RenderOptions, onProgress?: (msg: string) => void) {
    const log = (msg: string) => {
        if (onProgress) onProgress(msg);
        console.log(`[Renderer] ${msg}`);
    };

    const script = await prisma.videoScript.findUnique({
        where: { id: scriptId },
        include: {
            scenes: {
                orderBy: { index: 'asc' }
            }
        }
    });

    if (!script) throw new Error("Script not found");
    if (!script.audioUrl) throw new Error("Audio must be generated before rendering");

    const aspectRatio = overrideRatio || (script as any).aspectRatio || "1:1";
    const isVertical = aspectRatio === "9:16";
    const isWidescreen = aspectRatio === "16:9";
    const width = isWidescreen ? 1280 : (isVertical ? 720 : 1080);
    const height = isVertical ? 1280 : (isWidescreen ? 720 : 1080);

    // Use configurable media output directory if provided, otherwise default to public/media
    const mediaBaseDir = process.env.MEDIA_OUTPUT_DIR || path.join('public', 'media');

    // Audio files are always written under public/media/audio by generateSpeech,
    // and script.audioUrl is stored as a relative path like "media/audio/xyz.mp3".
    // Build a stable relative path for ffmpeg without duplicating "media".
    const audioPath = path.join(
        'public',
        script.audioUrl.startsWith('/') ? script.audioUrl.slice(1) : script.audioUrl
    );
    const timestamp = Date.now();
    const outputPath = path.join(mediaBaseDir, 'videos', `${outputName || scriptId}_${aspectRatio.replace(':', 'x')}_${timestamp}.mp4`);
    const tempDir = path.resolve('/tmp', scriptId);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const assetsDir = path.join(tempDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    log(`Localizing assets for ${scriptId}...`);
    // 0. Download remote assets to temp dir for robust FFmpeg processing
    const localizedScenes = await Promise.all(script.scenes.map(async (scene) => {
        if (!scene.assetUrl) return scene;
        if (!scene.assetUrl.startsWith('http')) return scene;

        const ext = path.extname(new URL(scene.assetUrl).pathname) || (scene.type === 'IMAGE' ? '.png' : '.mp4');
        const localPath = path.join(assetsDir, `scene_${scene.index}${ext}`);

        try {
            await downloadFile(scene.assetUrl, localPath);
            return { ...scene, assetUrl: localPath };
        } catch (err) {
            log(`Failed to download asset for scene ${scene.index}: ${err}`);
            return scene; // Fallback to URL if download fails (less reliable but better than nothing)
        }
    }));

    // Localize audio as well if it's remote (though usually it's local)
    let localAudioPath = audioPath;
    if (script.audioUrl && (script.audioUrl.startsWith('http') || !fs.existsSync(audioPath))) {
        if (script.audioUrl.startsWith('http')) {
            localAudioPath = path.join(assetsDir, 'voiceover.mp3');
            try {
                await downloadFile(script.audioUrl, localAudioPath);
            } catch (err) {
                log(`Failed to download audio: ${err}`);
            }
        } else {
            // If it's local but missing, we have a problem, but audioPath is already set
        }
    }

    log(`Starting render for ${scriptId} in ${aspectRatio}...`);

    try {
        // 1. Generate Subtitles (ASS format for brand hierarchy)
        const assPath = await generateASS(script, tempDir, width, height);

        // 3. Render each scene individually to MP4
        const sceneFiles: string[] = [];
        for (let i = 0; i < localizedScenes.length; i++) {
            const scene = localizedScenes[i];
            if (!scene.assetUrl) continue;

            const sceneOutputPath = path.join(tempDir, `scene_${i}_rendered.mp4`);
            log(`Rendering Scene ${i + 1}/${localizedScenes.length}...`);

            const duration = scene.duration || 6;
            const frames = Math.ceil(duration * 25);
            let filterChain = "";

            if (scene.type === 'IMAGE') {
                // Ken Burns: RE-ENABLED for sequential rendering with standard intensity
                // Robust scale ensuring we fill the space before zoompan
                filterChain = `scale=${width * 1.5}:${height * 1.5}:force_original_aspect_ratio=increase,crop=${width * 1.5}:${height * 1.5},zoompan=z='min(zoom+0.0015,1.5)':d=${frames}:s=${width}x${height}:fps=25`;
            } else {
                // Video: Scale to fill, Crop, and Normalize to 25fps
                filterChain = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},loop=loop=-1:size=1:start=-1,trim=duration=${duration},setpts=PTS-STARTPTS,fps=25`;
            }

            await new Promise((resolve, reject) => {
                ffmpeg(scene.assetUrl!)
                    .videoFilters(filterChain)
                    .videoCodec('libx264')
                    .outputOptions(['-an', '-pix_fmt yuv420p', '-r 25'])
                    .duration(duration)
                    .on('error', (err) => {
                        log(`Scene ${i + 1} render failed: ${err.message}`);
                        reject(err);
                    })
                    .on('end', () => resolve(true))
                    .save(sceneOutputPath);
            });
            sceneFiles.push(sceneOutputPath);
        }

        log(`Concatenating ${sceneFiles.length} scenes and applying master overlays...`);

        // 4. Concat all visual streams and add audio/logo/subtitles
        const concatListPath = path.join(tempDir, 'concat_list.txt');
        const concatContent = sceneFiles.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(concatListPath, concatContent);

        const filterEscape = (p: string) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''")}'`;
        const relativeLogoPath = 'public/logo.png';
        const relativeAssPath = assPath.replace(/\\/g, '/');

        let finalFilterChain = "";
        if (fs.existsSync(path.join(process.cwd(), relativeLogoPath))) {
            const logoWidth = isVertical ? 300 : 200;
            finalFilterChain = `movie=${filterEscape(relativeLogoPath)}[logo];[logo]scale=${logoWidth}:'trunc(ih*${logoWidth}/iw/2)*2',format=rgba,colorchannelmixer=aa=0.4[logostyled];[0:v][logostyled]overlay=W-w-50:50:enable='gt(t,2)'[vbranded];[vbranded]ass=${filterEscape(relativeAssPath)}[outv]`;
        } else {
            finalFilterChain = `ass=${filterEscape(relativeAssPath)}[outv]`;
        }

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(concatListPath)
                .inputOptions(['-f concat', '-safe 0'])
                .input(localAudioPath)
                .complexFilter(finalFilterChain)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-map [outv]',
                    '-map 1:a',
                    '-pix_fmt yuv420p',
                    '-r 25'
                ])
                .on('start', (cmd) => log(`Final merge started: ${cmd}`))
                .on('progress', (p) => log(`Merging: ${Math.round(p.percent || 0)}% done`))
                .on('error', (err) => {
                    log(`Final merge error: ${err.message}`);
                    reject(err);
                })
                .on('end', async () => {
                    log(`Render complete: ${outputPath}`);

                    // 5. Upload to Storage (Supabase or Drive)
                    try {
                        const videoAsset = await StorageService.uploadAndRecord({
                            file: outputPath,
                            fileName: getIntelligibleName({
                                uaId: (script as any).weeklyInquiry?.uaId || 'UA',
                                type: 'VIDEO',
                                detail: script.durationType,
                                extension: 'mp4'
                            }),
                            kind: 'VIDEO',
                            renderId: scriptId,
                            videoScriptId: scriptId
                        });
                        log(`[Storage] Video uploaded: ${videoAsset.fileName}`);
                    } catch (err) {
                        console.error(`[Storage] Video upload failed:`, err);
                    }

                    if (fs.existsSync(assPath)) {
                        try {
                            const captionAsset = await StorageService.uploadAndRecord({
                                file: assPath,
                                fileName: getIntelligibleName({
                                    uaId: (script as any).weeklyInquiry?.uaId || 'UA',
                                    type: 'CAPTIONS',
                                    detail: script.durationType,
                                    extension: 'ass'
                                }),
                                kind: 'CAPTIONS',
                                renderId: scriptId,
                                videoScriptId: scriptId
                            });
                            log(`[Storage] Captions uploaded: ${captionAsset.fileName}`);
                        } catch (err) {
                            console.error(`[Storage] Captions upload failed:`, err);
                        }
                    }

                    cleanupTempFiles(scriptId);
                    resolve(true);
                })
                .save(outputPath);
        });

        return `/media/videos/${path.basename(outputPath)}`;
    } catch (e) {
        console.error("Render failed:", e);
        throw e;
    }
}

/**
 * Generates an ASS (Advanced Substation Alpha) file for high-end captions.
 * Supports Primary, Secondary, and Emphasis styles with the 300ms lag.
 */
async function generateASS(script: any, dir: string, width: number, height: number) {
    const fontName = "DejaVu Sans"; // Clean sans-serif
    const primaryColor = "&H00FFFFFF"; // White (BGR)
    const backColor = "&H80000000";   // 50% transparent black box

    // MarginV: distance from bottom edge — raised to clear video player timeline
    const marginV = height === 1920 ? 220 : (width === 1920 ? 120 : 160);

    let assContent = `[Script Info]
Title: UA Captions
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Primary,${fontName},52,${primaryColor},&H000000FF,&H00000000,${backColor},0,0,0,0,100,100,0,0,3,0,0,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    // 200ms editorial lag
    const lag = 0.2;
    let currentTime = 0;

    for (const scene of script.scenes) {
        const start = currentTime + lag;
        const end = currentTime + (scene.duration || 6);

        // Truncate to max 6 words — captions are assistive, not transcripts
        const words = (scene.scriptSegment || "").trim().split(/\s+/);
        const caption = words.slice(0, 6).join(" ");

        if (caption) {
            assContent += `Dialogue: 0,${formatTime(start)},${formatTime(end)},Primary,,0,0,0,,${caption}\n`;
        }

        currentTime += (scene.duration || 6);
    }

    const assPath = path.join(dir, 'captions.ass');
    fs.writeFileSync(assPath, assContent);
    return assPath;
}

function formatTime(seconds: number) {
    const h = Math.floor(seconds / 3600).toString().padStart(1, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toFixed(2).padStart(5, '0');
    return `${h}:${m}:${s}`;
}
