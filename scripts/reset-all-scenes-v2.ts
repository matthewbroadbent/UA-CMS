import { prisma } from './src/lib/prisma';

async function cleanUpScript() {
    const scriptId = 'cml6q46eo0006gg195jddnabb';

    console.log(`Resetting scenes for script ${scriptId}...`);

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
