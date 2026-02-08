import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * UA CMS Node Modules Pruning Script
 * Removes unused packages and non-essential documentation/tests from node_modules.
 */

const CONFIG = {
    nodeModulesPath: path.join(process.cwd(), 'node_modules'),
    unnecessaryFolders: [
        'test', 'tests', 'docs', 'doc', 'example', 'examples', 'benchmark'
    ],
    unnecessaryFiles: [
        'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md'
    ],
    logFile: path.join(process.cwd(), 'prune-modules.log')
};

function log(msg: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [PRUNE] ${msg}`;
    console.log(entry);
    fs.appendFileSync(CONFIG.logFile, entry + '\n');
}

function deleteRecursive(dir: string) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.lstatSync(fullPath).isDirectory()) {
            deleteRecursive(fullPath);
            fs.rmdirSync(fullPath);
        } else {
            fs.unlinkSync(fullPath);
        }
    }
}

async function runPrune() {
    log('Starting node_modules pruning...');

    // 1. Run npm prune
    try {
        log('Running npm prune to remove unused packages...');
        execSync('npm prune', { stdio: 'inherit' });
    } catch (err: any) {
        log(`npm prune failed: ${err.message}`);
    }

    // 2. Scan node_modules for unnecessary files/folders
    log('Scanning node_modules for non-essential folders/files...');
    let filesRemoved = 0;
    let foldersRemoved = 0;

    const pruneDir = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const packages = fs.readdirSync(dir);

        for (const pkg of packages) {
            if (pkg.startsWith('.')) continue;
            const pkgPath = path.join(dir, pkg);

            if (pkg.startsWith('@')) {
                // Scoped package, recurse once
                pruneDir(pkgPath);
                continue;
            }

            if (!fs.lstatSync(pkgPath).isDirectory()) continue;

            // Check for unnecessary subfolders in this package
            const subItems = fs.readdirSync(pkgPath);
            for (const item of subItems) {
                const fullPath = path.join(pkgPath, item);
                const itemNameLow = item.toLowerCase();

                if (CONFIG.unnecessaryFolders.includes(itemNameLow)) {
                    try {
                        if (fs.lstatSync(fullPath).isDirectory()) {
                            deleteRecursive(fullPath);
                            fs.rmdirSync(fullPath);
                            log(`Removed unnecessary folder: ${fullPath}`);
                            foldersRemoved++;
                        }
                    } catch (e) { }
                } else if (CONFIG.unnecessaryFiles.includes(item)) {
                    try {
                        if (!fs.lstatSync(fullPath).isDirectory()) {
                            fs.unlinkSync(fullPath);
                            log(`Removed unnecessary file: ${fullPath}`);
                            filesRemoved++;
                        }
                    } catch (e) { }
                }
            }
        }
    };

    pruneDir(CONFIG.nodeModulesPath);

    log(`Pruning complete. Removed ${foldersRemoved} folders and ${filesRemoved} files from node_modules.`);
}

runPrune().catch(err => {
    log(`Fatal pruning error: ${err.message}`);
});
