import fs from 'fs';
import path from 'path';

/**
 * UA CMS Media Restoration Script
 * Restores original files from .backup/ directories.
 */

const CONFIG = {
    searchPaths: [
        path.join(process.cwd(), 'public', 'media', 'audio'),
        path.join(process.cwd(), 'public', 'media', 'videos'),
        path.join(process.cwd(), 'public')
    ],
    backupDirName: '.backup'
};

function log(msg: string) {
    console.log(`[${new Date().toISOString()}] [RESTORE] ${msg}`);
}

function restoreFromDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir);

    // Check if current dir has a .backup subfolder
    const backupDir = path.join(dir, CONFIG.backupDirName);
    if (fs.existsSync(backupDir) && fs.lstatSync(backupDir).isDirectory()) {
        const backedUpFiles = fs.readdirSync(backupDir);
        for (const file of backedUpFiles) {
            const backupPath = path.join(backupDir, file);
            const targetPath = path.join(dir, file);

            try {
                fs.copyFileSync(backupPath, targetPath);
                log(`Restored: ${targetPath}`);
            } catch (err: any) {
                console.error(`[RESTORE-ERROR] Failed to restore ${targetPath}: ${err.message}`);
            }
        }
    }

    // Recurse
    for (const item of items) {
        if (item === CONFIG.backupDirName || item.startsWith('.')) continue;
        const fullPath = path.join(dir, item);
        if (fs.lstatSync(fullPath).isDirectory()) {
            restoreFromDir(fullPath);
        }
    }
}

async function run() {
    log('Starting media restoration...');
    for (const searchPath of CONFIG.searchPaths) {
        log(`Processing directory: ${searchPath}`);
        restoreFromDir(searchPath);
    }
    log('Media restoration complete.');
}

run().catch(err => {
    console.error(`[RESTORE-FATAL] ${err.message}`);
});
