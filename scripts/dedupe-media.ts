import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * UA CMS Media Deduplication Script
 * Identifies and removes identical media files based on content hash.
 */

const CONFIG = {
    searchPaths: [
        path.join(process.cwd(), 'public', 'media', 'audio'),
        path.join(process.cwd(), 'public', 'media', 'videos'),
        path.join(process.cwd(), 'public', 'media', 'images')
    ],
    logFile: path.join(process.cwd(), 'media-dedupe.log'),
    backupDirName: '.backup' // We will skip the backup folder itself
};

function log(msg: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [DEDUPE] ${msg}`;
    console.log(entry);
    fs.appendFileSync(CONFIG.logFile, entry + '\n');
}

function getFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

async function runDedupe() {
    log('Starting media deduplication audit...');
    const hashMap = new Map<string, string>(); // hash -> first filePath found
    let totalSaved = 0;
    let duplicatesRemoved = 0;

    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item === CONFIG.backupDirName || item.startsWith('.')) continue;
            const fullPath = path.join(dir, item);
            const stats = fs.lstatSync(fullPath);

            if (stats.isDirectory()) {
                walk(fullPath);
            } else {
                try {
                    const hash = getFileHash(fullPath);
                    if (hashMap.has(hash)) {
                        const originalPath = hashMap.get(hash)!;
                        const size = stats.size;

                        // It's a duplicate. We remove it.
                        log(`Duplicate found: ${fullPath} is identical to ${originalPath}`);
                        fs.unlinkSync(fullPath);
                        duplicatesRemoved++;
                        totalSaved += size;
                        log(`Removed duplicate: ${fullPath} (Saved ${path.basename(fullPath)})`);
                    } else {
                        hashMap.set(hash, fullPath);
                    }
                } catch (err: any) {
                    log(`Error hashing/processing ${fullPath}: ${err.message}`);
                }
            }
        }
    };

    for (const searchPath of CONFIG.searchPaths) {
        log(`Scanning: ${searchPath}`);
        walk(searchPath);
    }

    log(`Deduplication complete. Removed ${duplicatesRemoved} duplicates, saving approximately ${(totalSaved / (1024 * 1024)).toFixed(2)} MB.`);
}

runDedupe().catch(err => {
    log(`Fatal deduplication error: ${err.message}`);
});
