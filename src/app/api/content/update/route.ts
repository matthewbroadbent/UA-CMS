import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const { type, id, content } = await req.json();

        if (type === 'article') {
            await prisma.article.update({
                where: { id },
                data: { draftContent: content }
            });
        } else if (type === 'script') {
            await prisma.videoScript.update({
                where: { id },
                data: { script: content }
            });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
