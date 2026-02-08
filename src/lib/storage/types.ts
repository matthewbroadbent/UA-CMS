export type StorageKind = 'AUDIO' | 'VIDEO' | 'TEXT' | 'CAPTIONS' | 'IMAGE';

export interface UploadParams {
    file: Buffer | ReadableStream | string; // buffer, stream, or local path
    fileName: string;
    kind: StorageKind;
    renderId: string;
    contentType?: string;
}

export interface UploadResult {
    provider: 'drive' | 'supabase';
    fileName: string;
    kind: StorageKind;
    renderId: string;

    // Supabase specific
    bucket?: string;
    objectKey?: string;

    // Drive specific
    driveFileId?: string;
    driveWebViewLink?: string;
    driveDownloadLink?: string;

    // Generic
    publicUrl?: string;
}

export interface StorageProvider {
    upload(params: UploadParams): Promise<UploadResult>;
    getSignedUrl(bucket: string, objectKey: string, ttlSeconds?: number): Promise<string>;
    getPublicUrl(bucket: string, objectKey: string): string;
}
