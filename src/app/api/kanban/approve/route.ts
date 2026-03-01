import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const { id, type, approved } = await req.json();

        if (!id || !type) {
            return NextResponse.json({ error: 'ID and type are required' }, { status: 400 });
        }

        if (type === 'article') {
            const updated = await prisma.article.update({
                where: { id },
                data: { approved: !!approved }
            });
            return NextResponse.json(updated);
        } else if (type === 'script') {
            const updated = await prisma.videoScript.update({
                where: { id },
                data: { approved: !!approved }
            });
            return NextResponse.json(updated);
        } else if (type === 'textPost') {
            const updated = await prisma.textPost.update({
                where: { id },
                data: { approved: !!approved }
            });
            return NextResponse.json(updated);
        } else {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Approval Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
