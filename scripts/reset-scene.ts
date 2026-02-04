import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function resetStalledScene() {
    const sceneId = 'cml6t47d9003xkc19ovsdvpex';
    await (prisma as any).scene.update({
        where: { id: sceneId },
        data: {
            type: 'IMAGE',
            assetUrl: null,
            status: 'PENDING'
        }
    });
    console.log(`Scene ${sceneId} reset to IMAGE/PENDING.`);
}

resetStalledScene()
    .catch((e) => {
        console.error('Failed to reset scene:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
