import { prisma } from './src/lib/prisma';

async function fixVideoUrl() {
    try {
        const scriptId = 'cml6q46eo0006gg195jddnabb';
        const videoUrl = '/media/videos/ua_render_cml6q46eo0006gg195jddnabb.mp4';

        const updated = await prisma.videoScript.update({
            where: { id: scriptId },
            data: {
                videoUrl,
                status: 'RENDERED'
            }
        });

        console.log('Successfully updated videoUrl for script:', updated.id);
    } catch (e) {
        console.error('FAILED TO UPDATE:', e);
    } finally {
        process.exit(0);
    }
}

fixVideoUrl();
