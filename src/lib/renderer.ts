import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { prisma } from './prisma';

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
}

export async function renderVideo({ scriptId, outputName }: RenderOptions, onProgress?: (msg: string) => void) {
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

    // Use relative paths to avoid issues with spaces in the absolute project path on macOS
    const audioPath = path.join('public', script.audioUrl);
    const outputPath = path.join('public', 'media', 'videos', `${outputName || scriptId}.mp4`);
    const relativeTempDir = path.join('tmp', scriptId);

    if (!fs.existsSync(relativeTempDir)) fs.mkdirSync(relativeTempDir, { recursive: true });
    if (!fs.existsSync(path.dirname(outputPath))) fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    log(`Starting render for ${scriptId}...`);

    try {
        // 1. Generate Subtitles (ASS format for brand hierarchy)
        const assPath = await generateASS(script, relativeTempDir);

        // 3. Build FFmpeg command
        const command = ffmpeg();

        let filterChain = "";
        let inputCount = 0;

        for (const scene of script.scenes) {
            if (!scene.assetUrl) continue;

            // Logic for local path (assuming public directory or direct URL)
            const assetPath = scene.assetUrl.startsWith('http')
                ? scene.assetUrl // Remote (FFmpeg can handle URLs)
                : path.join('public', scene.assetUrl);

            command.input(assetPath);

            const idx = inputCount;
            const duration = scene.duration || 6;

            if (scene.type === 'IMAGE') {
                // Ken Burns: Subtle zoom in
                // Robust scale to 2160x2160 ensuring we fill the space before zoompan
                filterChain += `[${idx}:v]scale=2160:2160:force_original_aspect_ratio=increase,crop=2160:2160,zoompan=z='min(zoom+0.0005,1.2)':d=${Math.ceil(duration * 25)}:s=1080x1080:fps=25[v${idx}];`;
            } else {
                // Video: Scale to fill 1080x1080, Crop 1:1, and Normalize to 25fps
                // We use loop=-1:size=1:start=-1 to infinitely loop the last frame if the video is too short,
                // then trim it to the exact duration we need.
                filterChain += `[${idx}:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,loop=loop=-1:size=1:start=-1,trim=duration=${duration},setpts=PTS-STARTPTS,fps=25[v${idx}];`;
            }
            inputCount++;
        }

        // Concat all visual streams
        for (let i = 0; i < inputCount; i++) {
            filterChain += `[v${i}]`;
        }
        filterChain += `concat=n=${inputCount}:v=1:a=0[vfinal];`;

        // FFmpeg filter string escaping (specifically for movie and ass filters)
        // Colons must be escaped, and the entire path must be quoted in single quotes
        const filterEscape = (p: string) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''")}'`;

        // Add Watermark Logic (fade in after 2-3s)
        const relativeLogoPath = 'public/logo.png';
        const relativeAssPath = assPath.replace(/\\/g, '/');

        if (fs.existsSync(path.join(process.cwd(), relativeLogoPath))) {
            filterChain += `movie=${filterEscape(relativeLogoPath)}[logo];`;
            filterChain += `[logo]scale=200:-1,format=rgba,colorchannelmixer=aa=0.4[logostyled];`;
            filterChain += `[vfinal][logostyled]overlay=W-w-50:50:enable='gt(t,2)'[vbranded];`;
            filterChain += `[vbranded]ass=${filterEscape(relativeAssPath)}[outv]`;
        } else {
            filterChain += `[vfinal]ass=${filterEscape(relativeAssPath)}[outv]`;
        }

        await new Promise((resolve, reject) => {
            command
                .complexFilter(filterChain)
                .input(audioPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-map [outv]',
                    `-map ${inputCount}:a`,
                    '-pix_fmt yuv420p',
                    '-r 25',
                    '-shortest'
                ])
                .on('start', (cmd) => log(`FFmpeg started: ${cmd}`))
                .on('progress', (p) => log(`Rendering: ${Math.round(p.percent || 0)}% done`))
                .on('error', (err) => {
                    log(`FFmpeg error: ${err.message}`);
                    reject(err);
                })
                .on('end', () => {
                    log(`Render complete: ${outputPath}`);
                    fs.rmSync(relativeTempDir, { recursive: true, force: true });
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
async function generateASS(script: any, dir: string) {
    const fontName = "Charter"; // FFmpeg font name for the TTC
    const primaryColor = "&H00F5F5F5"; // Off-white (BGR)
    const emphasisColor = "&H0037AFD4"; // Muted Amber (#D4AF37)
    const secondaryColor = "&H00CCCCCC"; // Softer off-white

    let assContent = `[Script Info]
Title: UA Authoritative Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Primary,${fontName},64,${primaryColor},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,80,80,180,1
Style: Secondary,${fontName},42,${secondaryColor},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1.5,0,2,80,80,130,1
Style: Emphasis,${fontName},64,${emphasisColor},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,2,80,80,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    // Implement the 200-300ms Editorial Lag logic
    const lag = 0.25;
    let currentTime = 0;

    for (const scene of script.scenes) {
        const start = currentTime + lag;
        const end = currentTime + (scene.duration || 6);

        // Simple logic for primary vs emphasis (could be smarter with NLP)
        // For now, we'll put the whole segment in Primary
        // If a word is wrapped in ** it becomes Emphasis (if we had markdown in script segments)

        const text = scene.scriptSegment || "";
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, `{\\rEmphasis}$1{\\rPrimary}`);

        assContent += `Dialogue: 0,${formatTime(start)},${formatTime(end)},Primary,,0,0,0,,${formattedText}\n`;

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
