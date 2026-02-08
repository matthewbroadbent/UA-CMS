import { prisma } from '@/lib/prisma';

async function main() {
    const scriptId = 'cml89bxr8000e3apipklwiqct';
    const script = await prisma.videoScript.findUnique({
        where: { id: scriptId }
    });
    console.log(JSON.stringify(script, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
