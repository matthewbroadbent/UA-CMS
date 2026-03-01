import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { type, id, content, field } = body;

        if (type === 'article') {
            await prisma.article.update({
                where: { id },
                data: { draftContent: content }
            });
        } else if (type === 'textPost') {
            const updateField = field || 'content';
            await prisma.textPost.update({
                where: { id },
                data: { [updateField]: content }
            });
        } else if (type === 'script') {
            if (typeof content === 'object' && content !== null) {
                // Batch update (handled by ScriptEditor)
                await prisma.videoScript.update({
                    where: { id },
                    data: content
                });
            } else {
                // Single field update (backward compatibility/legacy buttons)
                const updateField = field || 'script';
                await prisma.videoScript.update({
                    where: { id },
                    data: { [updateField]: content }
                });
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
