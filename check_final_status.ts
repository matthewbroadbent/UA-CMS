import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const inquiry = await prisma.weeklyInquiry.findFirst({
            where: { uaId: 'UA-20260208-1901' },
            include: {
                article: true,
                generationRuns: {
                    include: { outputs: true },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!inquiry) {
            console.log('Inquiry not found.');
            return;
        }

        console.log(`Inquiry Status: ${inquiry.status}`);
        console.log(`Article Exists: ${!!inquiry.article}`);
        if (inquiry.article) {
            console.log(`Article Length: ${inquiry.article.draftContent.length} chars`);
        }

        console.log(`\nGeneration Runs: ${inquiry.generationRuns.length}`);
        inquiry.generationRuns.slice(0, 3).forEach((run, idx) => {
            console.log(`Run ${idx + 1}: ID=${run.id}, Status=${run.status}, CreatedAt=${run.createdAt.toISOString()}`);
            console.log(`  Error: ${run.error || 'None'}`);
            console.log(`  Outputs: ${run.outputs.length}`);
        });

    } catch (err) {
        console.error('Check failed', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
