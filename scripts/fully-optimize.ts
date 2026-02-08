import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * UA CMS Master Optimization Orchestrator
 * Runs all specialized optimization scripts and provides a final summary.
 */

const SCRIPTS = [
    'scripts/cleanup-workspace.ts',
    'scripts/optimize-media.ts',
    'scripts/dedupe-media.ts',
    'scripts/prune-modules.ts'
];

const LOG_FILES = [
    'media-optimization.log',
    'media-dedupe.log',
    'prune-modules.log'
];

function log(msg: string) {
    console.log(`[${new Date().toISOString()}] [MASTER-OPTIMIZE] ${msg}`);
}

async function runAll() {
    log('Starting full project optimization suite...');
    const startUsage = execSync('du -sh .').toString().split('\t')[0].trim();
    log(`Initial project disk usage: ${startUsage}`);

    for (const script of SCRIPTS) {
        if (!fs.existsSync(path.join(process.cwd(), script))) {
            log(`Warning: Script not found: ${script}`);
            continue;
        }

        try {
            log(`Running: ${script}...`);
            execSync(`npx tsx ${script}`, { stdio: 'inherit' });
            log(`Completed: ${script}`);
        } catch (err: any) {
            log(`Error running ${script}: ${err.message}`);
        }
    }

    // Additional Cleanup: Remove any orphaned .map files in src
    log('Performing final audit for obsolete build artifacts (.map files)...');
    try {
        const mapFiles = execSync('find src -name "*.map"').toString().trim();
        if (mapFiles) {
            const files = mapFiles.split('\n');
            for (const file of files) {
                fs.unlinkSync(file);
                log(`Deleted obsolete map file: ${file}`);
            }
        } else {
            log('No obsolete map files found.');
        }
    } catch (e) { }

    const endUsage = execSync('du -sh .').toString().split('\t')[0].trim();
    log(`Optimization complete!`);
    log(`Final project disk usage: ${endUsage}`);
    log(`Optimization logs are available at: ${LOG_FILES.join(', ')}`);
}

runAll().catch(err => {
    log(`Fatal orchestration error: ${err.message}`);
});
