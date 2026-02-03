import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

export async function renderVideo(
    scriptId: string,
    audioPath: string,
    scenes: any[],
    logoPath?: string
) {
    const publicDir = path.join(process.cwd(), 'public');
    const tempDir = path.join(publicDir, 'temp', scriptId);
    const outputFileName = `${scriptId}_final.mp4`;
    const outputPath = path.join(publicDir, 'media', 'output', outputFileName);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    if (!fs.existsSync(path.join(publicDir, 'media', 'output'))) {
        fs.mkdirSync(path.join(publicDir, 'media', 'output'), { recursive: true });
    }

    // 1. Download all assets locally
    const localScenes = await Promise.all(scenes.map(async (scene, i) => {
        const ext = scene.type === 'VIDEO' ? 'mp4' : 'jpg';
        const localPath = path.join(tempDir, `scene_${i}.${ext}`);

        const response = await axios({
            method: 'get',
            url: scene.assetUrl,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ ...scene, localPath }));
            writer.on('error', reject);
        });
    })) as any[];

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        // 2. Add each scene
        localScenes.forEach(scene => {
            command = command.input(scene.localPath);
            if (scene.type === 'IMAGE') {
                command = command.inputOptions(['-loop 1', `-t ${scene.duration}`]);
            }
        });

        // 3. Add audio
        command = command.input(path.join(publicDir, audioPath));

        // 4. Build Filter Complex for BBC/Sky News Subtitles
        // We'll use a simplified version: Stack all videos and add global overlay
        let filterComplex = '';
        const inputs = localScenes.length;

        // Scale and pad all inputs to matching resolution (1080x1350 for social)
        for (let i = 0; i < inputs; i++) {
            filterComplex += `[${i}:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[v${i}];`;
        }

        // Concat videos
        for (let i = 0; i < inputs; i++) {
            filterComplex += `[v${i}]`;
        }
        filterComplex += `concat=n=${inputs}:v=1:a=0[vconcat];`;

        // BBC Subtitle Box (bottom 25%)
        filterComplex += `[vconcat]drawbox=y=ih-ih/4:color=black@0.8:width=iw:height=ih/4:t=fill[vbox];`;

        // BBC Text Style
        const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
        filterComplex += `[vbox]drawtext=text='UNEMPLOYABLE ADVISOR':fontcolor=white:fontsize=40:fontfile=${fontPath}:x=60:y=h-h/5:shadowcolor=black:shadowx=2:shadowy=2[vtitle];`;
        filterComplex += `[vtitle]drawtext=text='NEWS FEED':fontcolor=yellow:fontsize=30:fontfile=${fontPath}:x=60:y=h-h/7[vlabel]`;

        command
            .complexFilter([filterComplex], 'vlabel')
            .outputOptions([
                '-c:v libx264',
                '-preset fast',
                '-crf 23',
                '-c:a aac',
                '-b:a 192k',
                '-shortest',
                '-pix_fmt yuv420p'
            ])
            .on('start', (cmd: string) => console.log('FFmpeg started:', cmd))
            .on('error', (err: Error) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .on('end', () => {
                console.log('FFmpeg finished render');
                fs.rmSync(tempDir, { recursive: true, force: true }); // Cleanup
                resolve(`/media/output/${outputFileName}`);
            })
            .save(outputPath);
    });
}
