import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const scripts = await prisma.videoScript.findMany({
        select: {
            id: true,
            durationType: true,
            audioUrl: true,
            status: true,
        }
    });
    console.log(JSON.stringify(scripts, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
