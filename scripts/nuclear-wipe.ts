import { prisma } from '../src/lib/prisma';

const inquiryId = 'cmldyvqmy0000fx19visak1i9';

async function nuclearWipe() {
    console.log(`[Nuclear Wipe] Purging ALL records for Inquiry: ${inquiryId}...`);

    try {
        // 1. Delete Scenes and VideoScripts
        const scripts = await (prisma as any).videoScript.findMany({ where: { weeklyInquiryId: inquiryId } });
        for (const s of scripts) {
            await (prisma as any).scene.deleteMany({ where: { videoScriptId: s.id } });
        }
        const delScripts = await (prisma as any).videoScript.deleteMany({ where: { weeklyInquiryId: inquiryId } });
        console.log(`- Deleted ${delScripts.count} scripts and all their scenes.`);

        // 2. Delete TextPosts
        const delPosts = await (prisma as any).textPost.deleteMany({ where: { weeklyInquiryId: inquiryId } });
        console.log(`- Deleted ${delPosts.count} text posts.`);

        // 3. Delete Assets
        const delAssets = await (prisma as any).outputAsset.deleteMany({ where: { weeklyInquiryId: inquiryId } });
        console.log(`- Deleted ${delAssets.count} output assets.`);

        // 4. Delete Generation Runs
        const delRuns = await (prisma as any).generationRun.deleteMany({ where: { weeklyInquiryId: inquiryId } });
        console.log(`- Deleted ${delRuns.count} generation runs.`);

        // 5. Reset Article
        const article = await (prisma as any).article.findUnique({ where: { weeklyInquiryId: inquiryId } });
        if (article) {
            await (prisma as any).article.update({
                where: { id: article.id },
                data: { draftContent: '', finalContent: '', approved: false, status: 'PENDING' }
            });
            console.log(`- Reset article draft.`);
        }

        // 6. Reset Inquiry Status
        await (prisma as any).weeklyInquiry.update({
            where: { id: inquiryId },
            data: { status: 'PENDING' }
        });
        console.log(`- Reset inquiry status to PENDING.`);

        console.log(`[Nuclear Wipe] Success. Card is clean.`);
    } catch (err) {
        console.error(`[Nuclear Wipe] Failed:`, err);
    } finally {
        await prisma.$disconnect();
    }
}

nuclearWipe();
