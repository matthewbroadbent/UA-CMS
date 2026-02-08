import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';

/**
 * UA CMS Media Optimization Script
 * Compresses images, videos, and audio while maintaining high quality.
 * Includes backup/restore capability.
 */

const CONFIG = {
    searchPaths: [
        path.join(process.cwd(), 'public', 'media'),
        path.join(process.cwd(), 'public')
    ],
    extensions: {
        image: ['.png', '.jpg', '.jpeg', '.gif'],
        video: ['.mp4', '.mov', '.avi', '.mkv'],
        audio: ['.wav', '.mp3', '.aac', '.flac']
    },
    thresholds: {
        image: 50 * 1024, // 50KB
        media: 500 * 1024 // 500KB
    },
    backupDirName: '.backup',
    logFile: path.join(process.cwd(), 'media-optimization.log')
};

function log(msg: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [OPTIMIZE] ${msg}`;
    console.log(entry);
    fs.appendFileSync(CONFIG.logFile, entry + '\n');
}

function getFileSize(filePath: string): number {
    return fs.statSync(filePath).size;
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Optimizes a single file using FFmpeg.
 */
async function optimizeFile(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath).toLowerCase();
    const originalSize = getFileSize(filePath);

    // Skip if below threshold
    const isImage = CONFIG.extensions.image.includes(ext);
    const threshold = isImage ? CONFIG.thresholds.image : CONFIG.thresholds.media;

    if (originalSize < threshold) {
        // log(`Skipping small file: ${path.basename(filePath)} (${formatSize(originalSize)})`);
        return false;
    }

    const tempOutputPath = filePath + '.tmp' + ext;

    return new Promise((resolve) => {
        let command = ffmpeg(filePath);

        if (CONFIG.extensions.image.includes(ext)) {
            // Image optimization
            if (ext === '.jpg' || ext === '.jpeg') {
                command = command.outputOptions(['-q:v 2']); // Quality 85-90 roughly
            } else if (ext === '.png') {
                command = command.outputOptions(['-pred mixed', '-pix_fmt pal8']); // Basic PNG optimization
            }
        } else if (CONFIG.extensions.video.includes(ext)) {
            // Video optimization: H.264 CRF 23
            command = command
                .videoCodec('libx264')
                .outputOptions(['-crf 23', '-preset medium', '-pix_fmt yuv420p']);
        } else if (CONFIG.extensions.audio.includes(ext)) {
            // Audio optimization: AAC 192k
            command = command
                .audioCodec('aac')
                .audioBitrate('192k');
        } else {
            resolve(false);
            return;
        }

        command
            .on('error', (err) => {
                log(`Error optimizing ${path.basename(filePath)}: ${err.message}`);
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
                resolve(false);
            })
            .on('end', () => {
                const newSize = getFileSize(tempOutputPath);

                // Only keep if significantly smaller (at least 5% savings)
                if (newSize < originalSize * 0.95) {
                    // Create backup
                    const dir = path.dirname(filePath);
                    const backupDir = path.join(dir, CONFIG.backupDirName);
                    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

                    const backupPath = path.join(backupDir, path.basename(filePath));
                    if (!fs.existsSync(backupPath)) {
                        fs.copyFileSync(filePath, backupPath);
                    }

                    // Replace original
                    fs.renameSync(tempOutputPath, filePath);
                    log(`Optimized ${path.basename(filePath)}: ${formatSize(originalSize)} -> ${formatSize(newSize)} (Saved ${formatSize(originalSize - newSize)})`);
                    resolve(true);
                } else {
                    // log(`Discarding optimization for ${path.basename(filePath)}: No significant savings.`);
                    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
                    resolve(false);
                }
            })
            .save(tempOutputPath);
    });
}

async function walkAndOptimize(dir: string, isRoot: boolean = false) {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir);
    for (const item of items) {
        if (item === CONFIG.backupDirName || item.startsWith('.') || item === 'node_modules') continue;

        const fullPath = path.join(dir, item);
        const stats = fs.lstatSync(fullPath);

        if (stats.isDirectory()) {
            if (isRoot && item === 'media') continue;
            await walkAndOptimize(fullPath);
        } else {
            const ext = path.extname(item).toLowerCase();
            const allExts = [...CONFIG.extensions.image, ...CONFIG.extensions.video, ...CONFIG.extensions.audio];

            if (allExts.includes(ext)) {
                await optimizeFile(fullPath);
            }
        }
    }
}

async function run() {
    log('Starting media optimization audit...');
    for (const searchPath of CONFIG.searchPaths) {
        const isRoot = searchPath === path.join(process.cwd(), 'public');
        log(`Processing directory: ${searchPath}`);
        await walkAndOptimize(searchPath, isRoot);
    }
    log('Media optimization complete.');
}

run().catch(err => {
    log(`Fatal error during optimization: ${err.message}`);
});
