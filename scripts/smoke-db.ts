import { prisma } from '../src/lib/prisma';

async function runSmokeTest() {
    console.log('🚀 Starting Supabase DB Smoke Test...');
    const testId = `smoke-test-${Date.now()}`;

    try {
        // 1. Create
        console.log('📝 Testing INSERT...');
        const newInquiry = await (prisma as any).weeklyInquiry.create({
            data: {
                uaId: testId,
                theme: 'Smoke Test Theme',
                status: 'PENDING'
            }
        });
        console.log('✅ INSERT successful:', newInquiry.id);

        // 2. Read
        console.log('📖 Testing READ...');
        const found = await (prisma as any).weeklyInquiry.findUnique({
            where: { id: newInquiry.id }
        });
        if (!found || found.uaId !== testId) throw new Error('Read verification failed');
        console.log('✅ READ successful');

        // 3. Delete
        console.log('🗑️ Testing DELETE...');
        await (prisma as any).weeklyInquiry.delete({
            where: { id: newInquiry.id }
        });
        console.log('✅ DELETE successful');

        console.log('\n✨ Supabase DB Smoke Test PASSED!');
    } catch (error: any) {
        console.error('\n❌ Supabase DB Smoke Test FAILED!');
        console.error('Error:', error.message);
        process.exit(1);
    }
}

runSmokeTest();
