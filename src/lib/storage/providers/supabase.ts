import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { StorageProvider, UploadParams, UploadResult, StorageKind } from '../types';

export class SupabaseStorageProvider implements StorageProvider {
    private client: SupabaseClient;

    constructor() {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !key) {
            throw new Error('Missing Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
        }

        this.client = createClient(url, key);
    }

    async upload(params: UploadParams): Promise<UploadResult> {
        const bucket = this.getBucketForKind(params.kind);
        const objectKey = this.getObjectKey(params);

        let body: any;
        if (typeof params.file === 'string') {
            if (!fs.existsSync(params.file)) throw new Error(`File not found: ${params.file}`);
            body = fs.readFileSync(params.file); // Small files can be read into memory
        } else if (Buffer.isBuffer(params.file)) {
            body = params.file;
        } else {
            // For streams, we might need a different handling if they are large
            // Supabase JS client handles Blob | ArrayBuffer | ArrayBufferView | Buffer | File | FormData | ReadableStream | ReadableStreamDefaultReader | URLSearchParams | string
            body = params.file;
        }

        const { data, error } = await this.client.storage
            .from(bucket)
            .upload(objectKey, body, {
                contentType: params.contentType || this.getMimeType(params.fileName),
                upsert: true
            });

        if (error) {
            throw new Error(`Supabase upload failed: ${error.message}`);
        }

        return {
            provider: 'supabase',
            fileName: params.fileName,
            kind: params.kind,
            renderId: params.renderId,
            bucket: bucket,
            objectKey: objectKey,
        };
    }

    async getSignedUrl(bucket: string, objectKey: string, ttlSeconds: number = 86400): Promise<string> {
        const { data, error } = await this.client.storage
            .from(bucket)
            .createSignedUrl(objectKey, ttlSeconds);

        if (error) {
            throw new Error(`Failed to generate signed URL: ${error.message}`);
        }

        return data.signedUrl;
    }

    getPublicUrl(bucket: string, objectKey: string): string {
        const { data } = this.client.storage
            .from(bucket)
            .getPublicUrl(objectKey);

        return data.publicUrl;
    }

    private getBucketForKind(kind: StorageKind): string {
        switch (kind) {
            case 'AUDIO': return process.env.UA_SUPABASE_AUDIO_BUCKET || 'ua-audio';
            case 'VIDEO': return process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video';
            case 'TEXT': return process.env.UA_SUPABASE_TEXT_BUCKET || 'ua-text';
            case 'CAPTIONS': return process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video';
            case 'IMAGE': return process.env.UA_SUPABASE_VIDEO_BUCKET || 'ua-video';
            default: return 'ua-cms-assets';
        }
    }

    private getObjectKey(params: UploadParams): string {
        const prefix = params.kind.toLowerCase();
        if (params.kind === 'CAPTIONS') {
            return `captions/${params.renderId}/${params.fileName}`;
        }
        return `${prefix}/${params.renderId}/${params.fileName}`;
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
