const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const latestInquiry = await prisma.weeklyInquiry.findFirst({
        orderBy: { createdAt: 'desc' }
    });

    if (!latestInquiry) {
        console.log("No inquiry found.");
        return;
    }

    console.log(`Found inquiry: ${latestInquiry.uaId} (${latestInquiry.id}) with status: ${latestInquiry.status}`);

    const updated = await prisma.weeklyInquiry.update({
        where: { id: latestInquiry.id },
        data: { status: 'PENDING' }
    });

    console.log(`Updated status to: ${updated.status}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
