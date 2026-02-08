import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';

/**
 * Google Drive Service
 * Handles uploads to specific folders for Audio, Text, and Video outputs.
 * 
 * GUARDRAIL: All new production output types (e.g. reels, thumbnails, transcripts) 
 * must be integrated here to be stored in Drive by default to prevent repo bloat.
 */
export class GoogleDriveService {
    private static auth: any;
    private static drive: any;

    private static init() {
        if (this.drive) return;

        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (credentialsPath && fs.existsSync(credentialsPath)) {
            // Service Account approach
            this.auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive.file'],
            });
        } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
            // OAuth2 approach (for VPS/Headless)
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000'
            );
            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });
            this.auth = oauth2Client;
        } else {
            console.error('[GoogleDrive] Missing credentials. Please set GOOGLE_APPLICATION_CREDENTIALS or OAuth variables.');
        }

        if (this.auth) {
            this.drive = google.drive({ version: 'v3', auth: this.auth });
        }
    }

    /**
     * Uploads a file to a specific Google Drive folder.
     */
    static async uploadFile({
        filePath,
        fileName,
        folderId,
        fileType,
        renderId,
        videoScriptId,
        articleId,
        weeklyInquiryId
    }: {
        filePath: string;
        fileName: string;
        folderId: string;
        fileType: 'AUDIO' | 'VIDEO' | 'TEXT';
        renderId: string;
        videoScriptId?: string;
        articleId?: string;
        weeklyInquiryId?: string;
    }) {
        this.init();
        if (!this.drive) throw new Error('Google Drive client not initialized');

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        console.log(`[GoogleDrive] Uploading ${fileName} to folder ${folderId}...`);

        const fileMetadata = {
            name: fileName,
            parents: [folderId],
        };

        const media = {
            mimeType: this.getMimeType(filePath),
            body: fs.createReadStream(filePath),
        };

        const response = await this.drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink, webContentLink',
            supportsAllDrives: true,
        });

        const fileId = response.data.id;
        const webViewLink = response.data.webViewLink;
        const webContentLink = response.data.webContentLink;

        console.log(`[GoogleDrive] Upload complete. File ID: ${fileId}`);

        // Store metadata in DB
        const driveOutput = await prisma.driveOutput.create({
            data: {
                driveFileId: fileId,
                driveWebViewLink: webViewLink,
                driveDownloadLink: webContentLink,
                fileType: fileType,
                fileName: fileName,
                renderId: renderId,
                videoScriptId: videoScriptId,
                articleId: articleId,
                weeklyInquiryId: weeklyInquiryId
            }
        });

        return driveOutput;
    }

    private static getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.mp3': return 'audio/mpeg';
            case '.wav': return 'audio/wav';
            case '.mp4': return 'video/mp4';
            case '.md': return 'text/markdown';
            case '.json': return 'application/json';
            case '.ass': return 'text/plain';
            case '.srt': return 'text/plain';
            case '.vtt': return 'text/plain';
            default: return 'application/octet-stream';
        }
    }
}
