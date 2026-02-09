import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';
import { runPipeline, runMediaPipeline, runVoicePipeline, clearInquiryArtifacts, resetInquiryToStartingState } from '@/lib/pipeline';
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

        // Regression Reset Logic:
        // If the move is backwards (regression), reset to starting state
        const STAGE_ORDER = ['PENDING', 'EDITORIAL', 'VOICE', 'MEDIA', 'FINAL_RENDER', 'PUBLISHED'];
        const currentIdx = STAGE_ORDER.indexOf(item.status);
        const targetIdx = STAGE_ORDER.indexOf(status);

        if (targetIdx < currentIdx) {
            debugLog(`[REGRESSION] Rolling back from ${item.status} to ${status}. Resetting to starting state.`);
            await resetInquiryToStartingState(id, status);
        }

        // Handle Stage-Specific Logic (Automatic actions on manual move)
        if (status === 'EDITORIAL') {
            // ONLY trigger the full generation pipeline if coming from PENDING
            // If coming from a later stage (VOICE, etc.), it's a manual refinement move
            if (item.status === 'PENDING' || item.status === 'FAILED') {
                debugLog(`[EDITORIAL] Starting Initial Pipeline for: ${id}`);

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
                    debugLog(`[EDITORIAL] Triggering runPipeline (Deterministic 3-Pass)...`);
                    const result = await runPipeline(id, pipelineConfig);

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
        }

        if (status === 'VOICE') {
            debugLog(`[VOICE] Starting Voice Pipeline for: ${id}`);

            // SECURITY GATE: Prevent moving to VOICE if there are SYSTEM-BLOCK issues
            if (item.article?.validationReport && item.article.validationReport.trim() !== '') {
                try {
                    const report = JSON.parse(item.article.validationReport);
                    if (report && report.status === 'SYSTEM-BLOCK') {
                        debugLog(`[VOICE] BLOCKED: Article has SYSTEM-BLOCK validation errors.`);
                        return NextResponse.json({
                            error: 'Publication blocked: Article has critical validation errors that must be resolved in the Editorial Desk.',
                            report
                        }, { status: 403 });
                    }
                } catch (e) {
                    debugLog(`[VOICE] Warning: Malformed validation report for ${id}. Skipping gate.`);
                }
            }

            try {
                await runVoicePipeline(id, { autoApprove: true });
                debugLog(`[VOICE] Voice Pipeline complete.`);
            } catch (voiceErr: any) {
                debugLog(`[VOICE] VOICE PIPELINE FAILURE: ${voiceErr.message}`);
                console.error(`[STAGE_MOVE] [VOICE] VOICE PIPELINE FAILURE:`, voiceErr);
                throw new Error(`Voice Pipeline Failed: ${voiceErr.message}`);
            }
        }

        if (status === 'MEDIA') {
            debugLog(`[MEDIA] Starting Media Pipeline...`);
            try {
                // Support targeted script selection (e.g., only 30s)
                const selectedScripts = config?.selectedScriptIds || null;
                await runMediaPipeline(id, selectedScripts, { autoApprove: true });
                debugLog(`[MEDIA] Media Pipeline complete.`);
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
