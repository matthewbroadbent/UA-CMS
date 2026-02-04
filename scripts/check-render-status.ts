import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkStatus() {
    const scriptId = 'cml6q46eo0006gg195jddnabb';
    const script = await prisma.videoScript.findUnique({
        where: { id: scriptId },
        include: { scenes: { orderBy: { index: 'asc' } } }
    });

    console.log('--- SCRIPT STATUS ---');
    console.log(`ID: ${script?.id}`);
    console.log(`Status: ${script?.status}`);
    console.log(`Audio: ${script?.audioUrl}`);

    console.log('\n--- SCENES ---');
    script?.scenes.forEach(s => {
        console.log(`Scene ${s.index}: [${s.status}] Duration: ${s.duration.toFixed(2)}s | Asset: ${s.assetUrl ? 'YES' : 'NO'}`);
    });
}

checkStatus().catch(console.error).finally(() => prisma.$disconnect());
