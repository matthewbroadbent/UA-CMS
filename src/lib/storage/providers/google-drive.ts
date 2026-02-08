import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { StorageProvider, UploadParams, UploadResult, StorageKind } from '../types';

export class GoogleDriveProvider implements StorageProvider {
    private drive: any;
    private auth: any;

    constructor() {
        this.init();
    }

    private init() {
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (credentialsPath && fs.existsSync(credentialsPath)) {
            this.auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive.file'],
            });
        } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000'
            );
            oauth2Client.setCredentials({
                refresh_token: process.env.GOOGLE_REFRESH_TOKEN
            });
            this.auth = oauth2Client;
        }

        if (this.auth) {
            this.drive = google.drive({ version: 'v3', auth: this.auth });
        }
    }

    async upload(params: UploadParams): Promise<UploadResult> {
        if (!this.drive) throw new Error('Google Drive client not initialized');

        const folderId = this.getFolderId(params.kind);
        if (!folderId) throw new Error(`Google Drive folder ID not configured for kind: ${params.kind}`);

        let body: any;
        if (typeof params.file === 'string') {
            if (!fs.existsSync(params.file)) throw new Error(`File not found: ${params.file}`);
            body = fs.createReadStream(params.file);
        } else if (Buffer.isBuffer(params.file)) {
            const { Readable } = require('stream');
            body = Readable.from(params.file);
        } else {
            body = params.file;
        }

        const fileMetadata = {
            name: params.fileName,
            parents: [folderId],
        };

        const media = {
            mimeType: params.contentType || this.getMimeType(params.fileName),
            body: body,
        };

        const response = await this.drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink, webContentLink',
            supportsAllDrives: true,
        });

        return {
            provider: 'drive',
            fileName: params.fileName,
            kind: params.kind,
            renderId: params.renderId,
            driveFileId: response.data.id,
            driveWebViewLink: response.data.webViewLink,
            driveDownloadLink: response.data.webContentLink,
        };
    }

    async getSignedUrl(bucket: string, objectKey: string, ttlSeconds?: number): Promise<string> {
        // Google Drive doesn't really have "signed URLs" in the same way, 
        // but we return the webViewLink if we have it, or just a placeholder.
        return '';
    }

    getPublicUrl(bucket: string, objectKey: string): string {
        return '';
    }

    private getFolderId(kind: StorageKind): string | undefined {
        switch (kind) {
            case 'AUDIO': return process.env.GOOGLE_DRIVE_AUDIO_FOLDER_ID;
            case 'VIDEO': return process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID;
            case 'TEXT': return process.env.GOOGLE_DRIVE_TEXT_FOLDER_ID;
            case 'CAPTIONS': return process.env.GOOGLE_DRIVE_TEXT_FOLDER_ID;
            case 'IMAGE': return process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID; // Fallback to video folder for images for now
            default: return undefined;
        }
    }

    private getMimeType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        switch (ext) {
            case '.mp3': return 'audio/mpeg';
            case '.wav': return 'audio/wav';
            case '.mp4': return 'video/mp4';
            case '.md': return 'text/markdown';
            case '.json': return 'application/json';
            case '.ass': return 'text/plain';
            case '.srt': return 'text/plain';
            case '.vtt': return 'text/plain';
            case '.png': return 'image/png';
            case '.jpg': return 'image/jpeg';
            case '.jpeg': return 'image/jpeg';
            default: return 'application/octet-stream';
        }
    }
}
