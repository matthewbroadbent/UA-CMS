import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const inquiry = await prisma.weeklyInquiry.findFirst({
        where: { status: 'MEDIA' },
        include: { scripts: true }
    });

    if (!inquiry) {
        console.log('No inquiry in MEDIA stage found.');
        return;
    }

    console.log('Inquiry ID:', inquiry.id);
    console.log('Theme:', inquiry.theme);
    console.log('Scripts:', inquiry.scripts.length);
    inquiry.scripts.forEach((s, idx) => {
        console.log(`Script ${idx + 1}: ID=${s.id}, VisualPrompt=${s.visualPrompt ? 'YES' : 'NO'}, Status=${s.status}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
