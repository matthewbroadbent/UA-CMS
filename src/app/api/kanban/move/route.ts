import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';
import { runPipeline, runMediaPipeline } from '@/lib/pipeline';
import fs from 'fs';

function debugLog(msg: string) {
    const time = new Date().toISOString();
    try {
        fs.appendFileSync('debug.log', `[${time}] ${msg}\n`);
    } catch (e) {
        console.error("Failed to write to debug.log", e);
    }
}

export async function POST(req: Request) {
    debugLog("--- NEW MOVE REQUEST ---");
    try {
        const body = await req.json();
        const { id, status, config } = body;
        debugLog(`Request for ID: ${id}, Target Status: ${status}`);

        const item = await prisma.weeklyInquiry.findUnique({
            where: { id },
            include: { article: true, scripts: true },
        });

        if (!item) {
            debugLog(`ERROR: Item ${id} not found`);
            return NextResponse.json({ error: 'Item not found' }, { status: 404 });
        }

        // Handle Stage-Specific Logic (Automatic actions on manual move)
        if (status === 'EDITORIAL') {
            debugLog(`[EDITORIAL] Starting Pipeline for: ${id}`);

            const pipelineConfig = config || {
                mode: 'STANDARD',
                stage1Model: 'gemini-2.0-flash',
                stage1Provider: 'GEMINI',
                stage2Models: [
                    process.env.ANTHROPIC_API_KEY
                        ? { model: 'claude-3-5-haiku-20241022', provider: 'ANTHROPIC' }
                        : { model: 'gemini-2.0-flash', provider: 'GEMINI' }
                ]
            };

            try {
                debugLog(`[EDITORIAL] Triggering runPipeline...`);
                let result;
                try {
                    result = await runPipeline(id, pipelineConfig);
                } catch (err: any) {
                    debugLog(`[EDITORIAL] Primary Pipeline Failed (${err.message}). Attempting Gemini Fallback...`);
                    const fallbackConfig = {
                        ...pipelineConfig,
                        stage2Models: [{ model: 'gemini-2.0-flash', provider: 'GEMINI' }]
                    };
                    result = await runPipeline(id, fallbackConfig);
                }

                debugLog(`[EDITORIAL] Article generated. RunID: ${result.runId}`);

                debugLog(`[EDITORIAL] Triggering Script Drafting...`);
                const primaryContent = result.outputs[0].content;
                const scripts = await generateScripts(primaryContent);
                debugLog(`[EDITORIAL] ${scripts.length} scripts drafted.`);

                if (item.scripts.length > 0) {
                    debugLog(`[EDITORIAL] Deleting existing scripts...`);
                    await prisma.videoScript.deleteMany({ where: { weeklyInquiryId: id } });
                }

                debugLog(`[EDITORIAL] Syncing new scripts...`);
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
                debugLog(`[EDITORIAL] Database sync complete.`);
            } catch (pipelineErr: any) {
                debugLog(`[EDITORIAL] PIPELINE FAILURE: ${pipelineErr.message}`);
                console.error(`[STAGE_MOVE] [EDITORIAL] PIPELINE FAILURE:`, pipelineErr);
                throw new Error(`Editorial Pipeline Failed: ${pipelineErr.message}`);
            }
        }

        if (status === 'VOICE') {
            debugLog(`[VOICE] Generating speech...`);
            for (const script of item.scripts) {
                if (script.approved) {
                    const text = [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n');
                    const audioUrl = await generateSpeech(text, script.id);
                    await prisma.videoScript.update({
                        where: { id: script.id },
                        data: { audioUrl, status: 'VOICE_GENERATED' }
                    });
                }
            }
            debugLog(`[VOICE] Speech generation complete.`);
        }

        if (status === 'MEDIA') {
            debugLog(`[MEDIA] Starting Media Pipeline...`);
            try {
                await runMediaPipeline(id);
                debugLog(`[MEDIA] Media Pipeline triggered.`);
            } catch (mediaErr: any) {
                debugLog(`[MEDIA] MEDIA PIPELINE FAILURE: ${mediaErr.message}`);
                console.error(`[STAGE_MOVE] [MEDIA] MEDIA PIPELINE FAILURE:`, mediaErr);
                throw new Error(`Media Pipeline Failed: ${mediaErr.message}`);
            }
        }

        debugLog(`Finalizing status update to: ${status}`);
        const updated = await prisma.weeklyInquiry.update({
            where: { id },
            data: { status },
        });
        debugLog(`Update successful for ${id}`);

        return NextResponse.json(updated);
    } catch (error: any) {
        debugLog(`CRITICAL ERROR: ${error.message}`);
        console.error('CRITICAL MOVE ERROR:', error);
        return NextResponse.json({
            error: error.message || 'Unknown error',
            details: error.stack
        }, { status: 500 });
    }
}
