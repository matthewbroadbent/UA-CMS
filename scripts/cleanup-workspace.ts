import fs from 'fs';
import path from 'path';

/**
 * UA CMS Global Cleanup Script
 * Cleans up temporary files, build caches, and logs.
 * Supports configurable aging logic for tmp files.
 */

const CONFIG = {
    maxAgeDays: 2, // Requirements: Delete tmp folders older than 48 hours
    maxAgeHours: 0,
    logRotation: {
        maxFiles: 5,
        compress: false
    },
    targets: {
        tmp: path.join(process.cwd(), 'tmp'),
        nextCache: path.join(process.cwd(), '.next', 'cache'),
        nextDev: path.join(process.cwd(), '.next', 'dev'),
        logs: [
            path.join(process.cwd(), 'debug.log'),
            path.join(process.cwd(), 'scribing.log'),
            path.join(process.cwd(), 'media-optimization.log'),
            path.join(process.cwd(), 'media-dedupe.log'),
            path.join(process.cwd(), 'prune-modules.log')
        ]
    },
    safetyExclusions: [
        'public/media/videos',
        'public/media/audio',
        'public/media/images'
    ]
};

function log(msg: string) {
    console.log(`[${new Date().toISOString()}] [CLEANUP] ${msg}`);
}

function error(msg: string, err?: any) {
    console.error(`[${new Date().toISOString()}] [CLEANUP-ERROR] ${msg}`, err || '');
}

/**
 * Checks if a file or directory is older than maxAgeDays/Hours.
 */
function isExpired(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);
        const ageMs = Date.now() - stats.mtime.getTime();
        const maxAgeMs = CONFIG.maxAgeHours > 0
            ? CONFIG.maxAgeHours * 60 * 60 * 1000
            : CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
        return ageMs > maxAgeMs;
    } catch (err) {
        return false;
    }
}

/**
 * Rotates a log file.
 */
function rotateLog(logPath: string) {
    if (!fs.existsSync(logPath)) return;

    // Shift existing rotations
    for (let i = CONFIG.logRotation.maxFiles - 1; i > 0; i--) {
        const oldFile = `${logPath}.${i}`;
        const newFile = `${logPath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
            fs.renameSync(oldFile, newFile);
        }
    }

    // Move current log to .1
    fs.renameSync(logPath, `${logPath}.1`);
    // Create new empty log
    fs.writeFileSync(logPath, '');
    log(`Rotated log file: ${logPath}`);
}

/**
 * Recursively deletes a directory's contents.
 * @param dir The directory to clean.
 * @param checkAge If true, only delete expired items.
 */
function cleanDirectory(dir: string, checkAge: boolean = false) {
    if (!fs.existsSync(dir)) {
        log(`Path does not exist, skipping: ${dir}`);
        return;
    }

    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = fs.lstatSync(fullPath);

        if (checkAge && !isExpired(fullPath)) {
            // log(`Skipping active item: ${fullPath}`);
            continue;
        }

        if (stats.isDirectory()) {
            cleanDirectory(fullPath, false); // Children of an expired dir are deleted regardless of their own age
            try {
                fs.rmdirSync(fullPath);
                log(`Removed directory: ${fullPath}`);
            } catch (err) {
                error(`Failed to remove directory ${fullPath}:`, err);
            }
        } else {
            try {
                fs.unlinkSync(fullPath);
                log(`Deleted file: ${fullPath}`);
            } catch (err) {
                error(`Failed to delete file ${fullPath}:`, err);
            }
        }
    }
}

async function runCleanup() {
    log('Starting global workspace cleanup...');

    // 1. Clean tmp/ with aging logic
    const ageLabel = CONFIG.maxAgeHours > 0 ? `${CONFIG.maxAgeHours} hours` : `${CONFIG.maxAgeDays} days`;
    log(`Auditing ${CONFIG.targets.tmp} (max age: ${ageLabel})...`);
    cleanDirectory(CONFIG.targets.tmp, true);

    // 2. Clear .next caches (no aging logic, always safe to clear)
    log(`Clearing .next build caches...`);
    cleanDirectory(CONFIG.targets.nextCache, false);
    cleanDirectory(CONFIG.targets.nextDev, false);

    // 3. Rotate logs
    log('Rotating log files...');
    for (const logFile of CONFIG.targets.logs) {
        if (fs.existsSync(logFile)) {
            try {
                // If log is empty, skip rotation
                if (fs.statSync(logFile).size > 0) {
                    rotateLog(logFile);
                }
            } catch (err) {
                error(`Failed to rotate ${logFile}:`, err);
            }
        }
    }

    log('Cleanup complete.');
}

runCleanup().catch(err => {
    error('Cleanup script failed unexpectedly:', err);
});
