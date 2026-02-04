import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';
import { runPipeline, runMediaPipeline } from '@/lib/pipeline';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { id, status, config } = body;

        const item = await prisma.weeklyInquiry.findUnique({
            where: { id },
            include: { article: true, scripts: true },
        });

        if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });

        // Handle Stage-Specific Logic (Automatic actions on manual move)
        if (status === 'EDITORIAL') {
            console.log(`Starting TWO-STAGE generation for item: ${id}`);

            const pipelineConfig = config || {
                mode: 'STANDARD',
                stage1Model: 'gemini-2.0-flash',
                stage1Provider: 'GEMINI',
                stage2Models: [
                    process.env.ANTHROPIC_API_KEY
                        ? { model: 'claude-3-5-sonnet-20241022', provider: 'ANTHROPIC' }
                        : { model: 'gemini-2.0-flash', provider: 'GEMINI' }
                ]
            };

            // Trigger Pipeline (Article)
            const result = await runPipeline(id, pipelineConfig);
            console.log(`Article generated via Pipeline: ${result.runId}`);

            // Trigger Gemini Drafting for Scripts (Existing logic for now)
            // Note: We use the first output's content for scripts
            const primaryContent = result.outputs[0].content;
            const scripts = await generateScripts(primaryContent);
            console.log(`Scripts generated: ${scripts.length}`);

            // Clean up existing scripts if they exist (Article is handled by pipeline upsert)
            if (item.scripts.length > 0) {
                await prisma.videoScript.deleteMany({ where: { weeklyInquiryId: id } });
            }

            await prisma.$transaction(
                scripts.map((s: any) => prisma.videoScript.create({
                    data: {
                        weeklyInquiryId: id,
                        durationType: s.duration,
                        hook: s.hook,
                        script: s.script,
                        closingLine: s.closingLine,
                    }
                }))
            );
            console.log("Database transaction complete.");
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
            console.log(`Starting MEDIA PIPELINE for item: ${id}`);
            await runMediaPipeline(id);
        }

        const updated = await prisma.weeklyInquiry.update({
            where: { id },
            data: { status },
        });

        return NextResponse.json(updated);
    } catch (error: any) {
        console.error('CRITICAL MOVE ERROR:', error);
        // Return detailed error for easier debugging
        return NextResponse.json({
            error: error.message || 'Unknown error',
            details: error.stack
        }, { status: 500 });
    }
}
