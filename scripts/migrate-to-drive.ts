import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { GoogleDriveService } from '../src/lib/google-drive';

/**
 * Migration Script: Local to Google Drive
 * Scans public/media/ for existing audio and video and uploads them to Google Drive.
 */

async function migrate() {
    console.log('Starting migration to Google Drive...');

    const audioFolderId = process.env.DRIVE_AUDIO_FOLDER_ID;
    const videoFolderId = process.env.DRIVE_VIDEO_FOLDER_ID;

    if (!audioFolderId || !videoFolderId) {
        console.error('Missing Drive folder IDs in environment variables.');
        return;
    }

    // 1. Migrate Audio
    const audioDir = path.join(process.cwd(), 'public', 'media', 'audio');
    if (fs.existsSync(audioDir)) {
        const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
        console.log(`Found ${files.length} audio files to migrate.`);

        for (const file of files) {
            const filePath = path.join(audioDir, file);
            const scriptId = file.replace('.mp3', '');

            try {
                const driveOutput = await GoogleDriveService.uploadFile({
                    filePath,
                    fileName: `${scriptId}_audio.mp3`,
                    folderId: audioFolderId,
                    fileType: 'AUDIO',
                    renderId: scriptId,
                    videoScriptId: scriptId
                });
                console.log(`Migrated audio: ${file} -> ${driveOutput.driveFileId}`);
                // fs.unlinkSync(filePath); // Optional: remove local
            } catch (err) {
                console.error(`Failed to migrate audio ${file}:`, err);
            }
        }
    }

    // 2. Migrate Videos
    const videoDir = path.join(process.cwd(), 'public', 'media', 'videos');
    if (fs.existsSync(videoDir)) {
        const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
        console.log(`Found ${files.length} video files to migrate.`);

        for (const file of files) {
            const filePath = path.join(videoDir, file);
            // Extract scriptId from name if possible, e.g., ua_render_{scriptId}_...
            const match = file.match(/ua_render_([a-z0-9]+)_/);
            const scriptId = match ? match[1] : 'unknown';

            try {
                const driveOutput = await GoogleDriveService.uploadFile({
                    filePath,
                    fileName: file,
                    folderId: videoFolderId,
                    fileType: 'VIDEO',
                    renderId: scriptId,
                    videoScriptId: scriptId !== 'unknown' ? scriptId : undefined
                });
                console.log(`Migrated video: ${file} -> ${driveOutput.driveFileId}`);
                // fs.unlinkSync(filePath); // Optional: remove local
            } catch (err) {
                console.error(`Failed to migrate video ${file}:`, err);
            }
        }
    }

    console.log('Migration complete.');
}

migrate().catch(console.error);
