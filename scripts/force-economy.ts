import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function forceEconomyMode() {
    const scriptId = 'cml6q46eo0006gg195jddnabb';

    // 1. Force all scenes to be IMAGE type for this script to bypass video stall
    await prisma.scene.updateMany({
        where: { videoScriptId: scriptId },
        data: { type: 'IMAGE' }
    });

    console.log(`Economy Mode (All Images) forced for script: ${scriptId}`);
}

forceEconomyMode().catch(console.error).finally(() => prisma.$disconnect());
