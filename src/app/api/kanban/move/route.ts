import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateDraft, generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';

export async function POST(req: Request) {
    try {
        const { id, status } = await req.json();

        const item = await prisma.weeklyInquiry.findUnique({
            where: { id },
            include: { article: true, scripts: true },
        });

        if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

        // Handle Stage-Specific Logic (Automatic actions on manual move)
        if (status === 'EDITORIAL' && !item.article) {
            // Trigger Gemini Drafting
            const draft = await generateDraft(item);
            const scripts = await generateScripts(draft);

            await prisma.$transaction([
                prisma.article.create({
                    data: {
                        weeklyInquiryId: id,
                        draftContent: draft,
                    }
                }),
                ...scripts.map((s: any) => prisma.videoScript.create({
                    data: {
                        weeklyInquiryId: id,
                        durationType: s.duration,
                        hook: s.hook,
                        script: s.script,
                        closingLine: s.closingLine,
                    }
                }))
            ]);
        }

        if (status === 'VOICE') {
            // Generate speech for all approved scripts
            for (const script of item.scripts) {
                if (script.status === 'APPROVED' || script.status === 'DRAFT') {
                    const text = [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n');
                    const audioUrl = await generateSpeech(text, script.id);
                    await prisma.videoScript.update({
                        where: { id: script.id },
                        data: { audioUrl, status: 'VOICE_GENERATED' }
                    });
                }
            }
        }

        if (status === 'MEDIA') {
            // Here we would plan scenes (Stage 4)
            // For now, mark as progressing
        }

        const updated = await prisma.weeklyInquiry.update({
            where: { id },
            data: { status },
        });

        return NextResponse.json(updated);
    } catch (error: any) {
        console.error('Move error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
