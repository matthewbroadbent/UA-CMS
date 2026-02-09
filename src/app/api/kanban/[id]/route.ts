import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        console.log(`[API] Deleting Inquiry: ${id}`);

        // Try to find the inquiry first to verify it exists
        const inquiry = await prisma.weeklyInquiry.findFirst({
            where: {
                OR: [
                    { id: id },
                    { uaId: id }
                ]
            }
        });

        if (!inquiry) {
            console.error(`[API] Delete Failure: Inquiry not found for ID: ${id}`);
            return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
        }

        console.log(`[API] Found Inquiry ${inquiry.uaId} (${inquiry.id}). Executing delete...`);

        // Cascading deletes in Prisma will handle VideoScript, Scene, Article, TextPost, GenerationRun, OutputAsset, DriveOutput
        // since we updated the schema to reflect this.
        await prisma.weeklyInquiry.delete({
            where: { id: inquiry.id }
        });

        console.log(`[API] Successfully deleted inquiry ${inquiry.uaId}`);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[API] Delete Error:', error);
        return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
    }
}
