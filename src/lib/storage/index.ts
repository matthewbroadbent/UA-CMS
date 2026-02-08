import { StorageProvider } from './types';
import { GoogleDriveProvider } from './providers/google-drive';
import { SupabaseStorageProvider } from './providers/supabase';
import { prisma } from '../prisma';

export * from './types';

let storageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
    if (storageProvider) return storageProvider;

    const backend = process.env.STORAGE_BACKEND || 'supabase';

    if (backend === 'drive') {
        storageProvider = new GoogleDriveProvider();
    } else {
        storageProvider = new SupabaseStorageProvider();
    }

    return storageProvider;
}

/**
 * Higher-level service to handle uploads and DB persistence.
 */
export class StorageService {
    static async uploadAndRecord(params: {
        file: Buffer | string;
        fileName: string;
        kind: 'AUDIO' | 'VIDEO' | 'TEXT' | 'CAPTIONS' | 'IMAGE';
        renderId: string;
        videoScriptId?: string;
        articleId?: string;
        weeklyInquiryId?: string;
    }) {
        const provider = getStorageProvider();

        console.log(`[StorageService] Uploading ${params.fileName} (${params.kind}) via ${process.env.STORAGE_BACKEND || 'supabase'}...`);

        const result = await provider.upload({
            file: params.file,
            fileName: params.fileName,
            kind: params.kind,
            renderId: params.renderId,
        });

        // Save to OutputAsset model
        const asset = await prisma.outputAsset.create({
            data: {
                provider: result.provider,
                kind: result.kind,
                fileName: result.fileName,
                bucket: result.bucket,
                objectKey: result.objectKey,
                driveFileId: result.driveFileId,
                driveWebViewLink: result.driveWebViewLink,
                driveDownloadLink: result.driveDownloadLink,
                publicUrl: result.publicUrl,
                renderId: result.renderId,
                videoScriptId: params.videoScriptId,
                articleId: params.articleId,
                weeklyInquiryId: params.weeklyInquiryId,
            },
        });

        return asset;
    }

    static async getSignedUrl(asset: { provider: string; bucket?: string | null; objectKey?: string | null; driveWebViewLink?: string | null }) {
        if (asset.provider === 'supabase' && asset.bucket && asset.objectKey) {
            const provider = getStorageProvider();
            return provider.getSignedUrl(asset.bucket, asset.objectKey);
        }
        return asset.driveWebViewLink || '';
    }
}
