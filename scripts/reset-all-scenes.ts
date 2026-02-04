import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function cleanUpScript() {
    const scriptId = 'cml6q46eo0006gg195jddnabb';

    // 1. Reset all scenes for this script to PENDING
    // 2. Clear any existing assetUrls to ensure fresh generation
    // 3. Ensure all are IMAGE type (Economy Mode insurance)
    const result = await (prisma as any).scene.updateMany({
        where: { videoScriptId: scriptId },
        data: {
            status: 'PENDING',
            assetUrl: null,
            type: 'IMAGE'
        }
    });

    console.log(`Successfully reset ${result.count} scenes for script ${scriptId}.`);
}

cleanUpScript()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
