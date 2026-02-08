import { StorageService } from '../src/lib/storage';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log('--- Storage Verification Tool ---');
    console.log(`Backend: ${process.env.STORAGE_BACKEND || 'supabase'}`);

    const testFile = 'test-asset.txt';
    const testContent = `Verification test at ${new Date().toISOString()}`;
    const filePath = path.join(process.cwd(), testFile);

    fs.writeFileSync(filePath, testContent);

    try {
        console.log('\n1. Testing Upload and DB Record...');
        const asset = await StorageService.uploadAndRecord({
            file: filePath,
            fileName: testFile,
            kind: 'TEXT',
            renderId: 'test-render-id',
        });

        console.log('✅ Upload Success!');
        console.log(`Asset Provider: ${asset.provider}`);
        console.log(`Asset ID: ${asset.id}`);

        console.log('\n2. Testing Signed URL Generation...');
        const signedUrl = await StorageService.getSignedUrl(asset);
        console.log(`✅ Signed URL: ${signedUrl}`);

        if (asset.provider === 'supabase') {
            console.log(`Bucket: ${asset.bucket}`);
            console.log(`Key: ${asset.objectKey}`);
        }

    } catch (error) {
        console.error('❌ Verification Failed:');
        console.error(error);
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

verify();
