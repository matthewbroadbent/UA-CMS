import fs from 'fs';
import path from 'path';
import { GoogleDriveService } from '../src/lib/google-drive';
import dotenv from 'dotenv';

// Load .env
dotenv.config();

async function testDrive() {
    console.log('--- Google Drive Smoke Test ---');
    console.log('Folder IDs:', {
        audio: process.env.GOOGLE_DRIVE_AUDIO_FOLDER_ID || process.env.DRIVE_AUDIO_FOLDER_ID,
        text: process.env.GOOGLE_DRIVE_TEXT_FOLDER_ID || process.env.DRIVE_TEXT_FOLDER_ID,
        video: process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID || process.env.DRIVE_VIDEO_FOLDER_ID,
    });
    console.log('Credentials Path:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

    const testFile = path.join(process.cwd(), 'tmp', 'test-drive-upload.txt');
    if (!fs.existsSync(path.dirname(testFile))) fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, `Test upload from Antigravity UI at ${new Date().toISOString()}`);

    const folderId = process.env.GOOGLE_DRIVE_TEXT_FOLDER_ID || process.env.DRIVE_TEXT_FOLDER_ID;

    if (!folderId) {
        console.error('Error: No text folder ID found in .env');
        return;
    }

    try {
        console.log('Attempting upload...');
        // We expect the DB save to FAIL if the DB is down, but we want to see if the upload succeeds.
        const result = await GoogleDriveService.uploadFile({
            filePath: testFile,
            fileName: `test_verification_${Date.now()}.txt`,
            folderId: folderId,
            fileType: 'TEXT',
            renderId: 'test-verification'
        });
        console.log('Success! Result:', result);
    } catch (err: any) {
        if (err.message.includes('Prisma') || err.message.includes('database')) {
            console.log('Upload likely succeeded, but Database save failed (as expected if DB is down).');
            console.log('Error details:', err.message);
        } else {
            console.error('Upload failed with a non-database error:', err);
        }
    } finally {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
}

testDrive().catch(console.error);
