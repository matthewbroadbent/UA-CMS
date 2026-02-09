const { prisma } = require('./src/lib/prisma');

async function checkStatus() {
    const inquiryId = 'cmle41ub60000i419hehtgci5';
    const scripts = await prisma.videoScript.findMany({
        where: { weeklyInquiryId: inquiryId },
        include: { _count: { select: { scenes: true } } }
    });

    console.log("--- Pipeline Status Report ---");
    scripts.forEach(s => {
        console.log(`Script [${s.durationType}]: Status=${s.status}, Scenes=${s._count.scenes}, ID=${s.id}`);
    });

    const script30s = scripts.find(s => s.durationType === '30s');
    if (script30s) {
        const scenes = await prisma.scene.findMany({
            where: { videoScriptId: script30s.id },
            orderBy: { index: 'asc' }
        });
        console.log(`\n--- Scenes for 30s (${script30s.id}) ---`);
        scenes.forEach(sc => {
            console.log(`Scene ${sc.index}: Status=${sc.status}, Type=${sc.type}, Asset=${sc.assetUrl ? 'YES' : 'NO'}`);
        });
    }
}

checkStatus().catch(console.error).finally(() => prisma.$disconnect());
