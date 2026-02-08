import { prisma } from "./prisma";
import { PROMPTS, buildPrompt, getActivePrompt } from "./prompts";
import { NextResponse } from 'next/server';
import { generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { generateMediaAsset } from './scenes';
import { renderVideo } from './renderer';
import { LLMProvider, generateContent } from './providers';
import { StorageService } from "./storage";

export interface PipelineConfig {
    mode: 'STANDARD' | 'COMPARE';
    stage1Model: string;
    stage1Provider: LLMProvider;
    stage2Models: { model: string, provider: LLMProvider }[];
    options?: {
        temperature1?: number;
        maxTokens1?: number;
        temperature2?: number;
        maxTokens2?: number;
    }
}

export async function runPipeline(inquiryId: string, config: PipelineConfig) {
    const inquiry = await (prisma as any).weeklyInquiry.findUnique({
        where: { id: inquiryId },
        include: { article: true }
    });

    if (!inquiry) throw new Error("Inquiry not found");

    // 1. Fetch Stage 1 Prompt
    const stage1Template = await getActivePrompt('SUBSTACK_STAGE_1', PROMPTS.SUBSTACK_STAGE_1);

    const stage1Prompt = buildPrompt(stage1Template, {
        theme: inquiry.theme,
        thinking: inquiry.thinking || "",
        reality: inquiry.reality || "",
        rant: inquiry.rant || "",
        nuclear: inquiry.nuclear || "",
        anythingElse: inquiry.anythingElse || ""
    });

    // 2. Run Stage 1 (Enforce JSON)
    let spineText = "";
    let retryCount = 0;
    const maxRetries = 1;

    console.log(`Running Stage 1 Pipeline (Inquiry: ${inquiryId})`);

    while (retryCount <= maxRetries) {
        try {
            const result = await generateContent(
                config.stage1Provider,
                config.stage1Model,
                retryCount === 0 ? stage1Prompt : `${stage1Prompt}\n\nREPAIR: Your previous output was invalid JSON. Return ONLY valid JSON now according to the schema.`,
                {
                    temperature: config.options?.temperature1 || 0.2,
                    maxTokens: config.options?.maxTokens1 || 2000,
                    responseMimeType: 'application/json'
                }
            );
            spineText = result.text;

            // Validate JSON
            const cleaned = spineText.replace(/```json\n?|\n?```/g, '').trim();
            JSON.parse(cleaned);
            break;
        } catch (e) {
            console.warn(`Stage 1 attempt ${retryCount + 1} failed:`, e);
            retryCount++;
            if (retryCount > maxRetries) {
                // Log failure to DB
                await (prisma as any).generationRun.create({
                    data: {
                        weeklyInquiryId: inquiryId,
                        mode: config.mode,
                        stage1Model: config.stage1Model,
                        stage1Provider: config.stage1Provider,
                        stage1Prompt: stage1Prompt,
                        stage1Output: spineText,
                        status: 'FAILED',
                        error: `Failed to generate valid Spine JSON: ${(e as Error).message}`
                    }
                });
                throw new Error("Failed to generate valid Spine JSON after retries.");
            }
        }
    }

    const spineJson = spineText.replace(/```json\n?|\n?```/g, '').trim();

    // Create Generation Run Record
    const run = await (prisma as any).generationRun.create({
        data: {
            weeklyInquiryId: inquiryId,
            mode: config.mode,
            stage1Model: config.stage1Model,
            stage1Provider: config.stage1Provider,
            stage1Prompt: stage1Prompt,
            stage1Output: spineJson,
            status: 'PROCESSING'
        }
    });

    // 3. Stage 2: Prose
    const outputs = [];
    const stage2Template = await getActivePrompt('SUBSTACK_STAGE_2', PROMPTS.SUBSTACK_STAGE_2);

    console.log(`Running Stage 2 Pipeline with ${config.stage2Models.length} models`);

    for (const modelConfig of config.stage2Models) {
        const stage2Prompt = buildPrompt(stage2Template, {
            article_spine_json: spineJson,
            thinking: inquiry.thinking || "",
            reality: inquiry.reality || "",
            rant: inquiry.rant || "",
            nuclear: inquiry.nuclear || "",
            anythingElse: inquiry.anythingElse || ""
        });

        let proseText = "";
        let s2Retry = 0;

        while (s2Retry <= maxRetries) {
            const result = await generateContent(
                modelConfig.provider,
                modelConfig.model,
                s2Retry === 0 ? stage2Prompt : `${stage2Prompt}\n\nREPAIR: Remove all meta-commentary like "Here is the article". Output ONLY the article markdown starting with the H1.`,
                {
                    temperature: config.options?.temperature2 || 0.7,
                    maxTokens: config.options?.maxTokens2 || 4000
                }
            );
            proseText = result.text;

            // Simple check for forbidden patterns
            const forbidden = ["here is", "the subject of this", "i have generated"];
            const isClean = !forbidden.some(f => proseText.toLowerCase().includes(f));

            if (isClean) break;
            s2Retry++;
        }

        const output = await (prisma as any).generationOutput.create({
            data: {
                runId: run.id,
                model: modelConfig.model,
                provider: modelConfig.provider,
                prompt: stage2Prompt,
                content: proseText,
                tokensUsed: 0 // Placeholder
            }
        });
        outputs.push(output);
    }

    if (outputs.length > 0) {
        await (prisma as any).article.upsert({
            where: { weeklyInquiryId: inquiryId },
            create: {
                weeklyInquiryId: inquiryId,
                draftContent: outputs[0].content,
                status: 'EDITORIAL'
            },
            update: {
                draftContent: outputs[0].content,
                status: 'EDITORIAL'
            }
        });

        // Upload Article to Storage (Supabase or Drive)
        try {
            const asset = await StorageService.uploadAndRecord({
                file: outputs[0].content,
                fileName: `${inquiry.uaId}_article.md`,
                kind: 'TEXT',
                renderId: inquiry.uaId,
                articleId: (await prisma.article.findUnique({ where: { weeklyInquiryId: inquiryId } }))?.id,
                weeklyInquiryId: inquiryId
            });
            console.log(`[Storage] Article uploaded via ${asset.provider}: ${asset.fileName}`);
        } catch (err) {
            console.error(`[Storage] Article upload failed:`, err);
        }
    }

    await (prisma as any).generationRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS' }
    });

    return { runId: run.id, outputs };
}

const countWords = (text: string) => text.trim().split(/\s+/).length;

export async function runMediaPipeline(inquiryId: string, selectedScriptIds?: string[]) {
    const log = (msg: string) => {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        fs.appendFileSync('scribing.log', line);
        console.log(msg);
    };

    log(`STARTING Grounded Storyboarding [DENSITY PROTECTION V2.1] for inquiry: ${inquiryId}`);

    const inquiry = await prisma.weeklyInquiry.findUnique({
        where: { id: inquiryId },
        include: { scripts: true }
    });

    if (!inquiry) {
        log(`ERROR: Inquiry ${inquiryId} not found`);
        throw new Error("Inquiry not found");
    }

    const scriptsToProcess = selectedScriptIds
        ? inquiry.scripts.filter(s => selectedScriptIds.includes(s.id))
        : inquiry.scripts;

    if (!scriptsToProcess.length) {
        log(`WARN: No scripts selected for processing`);
        return { success: true, message: "No scripts selected" };
    }

    const structTemplate = await getActivePrompt('STORYBOARD_STRUCTURIZER', PROMPTS.STORYBOARD_STRUCTURIZER);
    const groundingTemplate = await getActivePrompt('VISUAL_GROUNDING', PROMPTS.VISUAL_GROUNDING);

    for (const [idx, script] of scriptsToProcess.entries()) {
        log(`Phase 1: Structuring ${script.durationType} (${idx + 1}/${scriptsToProcess.length})`);

        if (idx > 0) await new Promise(r => setTimeout(r, 2000));

        // Cleanup any existing scenes for this script to prevent "ghost" data
        await prisma.scene.deleteMany({ where: { videoScriptId: script.id } });

        const plannedDurationSec = parseInt(script.durationType) || 30;
        const fullText = [script.hook, script.script, script.closingLine].filter(Boolean).join(' ');
        const wordCount = countWords(fullText);

        // Estimate audio duration based on ~150 words per minute (2.5 words per second)
        const estimatedAudioSec = Math.max(10, wordCount / 2.5);

        // Final duration to storyboard for should be the MIN of planned and actual words
        // We add a small buffer for natural pauses
        const effectiveDuration = Math.min(plannedDurationSec, estimatedAudioSec + 2);

        // Enforce Density Protection: Target 4-6s per scene
        // If the script is thin, we reduce the scene count
        const totalScenes = Math.max(3, Math.floor(effectiveDuration / 4.5));

        log(`Density Check: Word Count: ${wordCount} | Est. Audio: ${estimatedAudioSec.toFixed(1)}s | Planned: ${plannedDurationSec}s`);
        log(`Effective storyboard length: ${effectiveDuration.toFixed(1)}s | Calculated Scenes: ${totalScenes}`);
        const videoCount = Math.floor(totalScenes * 0.25); // Target ~25% video scenes for cost efficiency
        const imageCount = totalScenes - videoCount;
        const maxVideoDuration = (effectiveDuration * 0.25).toFixed(1) + "s";

        const structPrompt = buildPrompt(structTemplate, {
            duration: `${effectiveDuration.toFixed(1)}s`,
            script: [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n'),
            sceneCount: totalScenes.toString(),
            videoCount: videoCount.toString(),
            imageCount: imageCount.toString(),
            maxVideoDuration: maxVideoDuration
        });

        try {
            log(`Calling Structurizer for script ${script.id}...`);
            const structRes = await generateContent('GEMINI' as LLMProvider, 'gemini-2.0-flash', structPrompt, { temperature: 0.1, responseMimeType: 'application/json' });

            let structJson = structRes.text;
            if (structJson.includes('```')) {
                structJson = structJson.split(/```(?:json)?/)[1].split('```')[0].trim();
            }
            const { scenes } = JSON.parse(structJson);
            log(`Structure received: ${scenes.length} segments.`);

            // Nuclear clear old scenes
            await prisma.scene.deleteMany({ where: { videoScriptId: script.id } });

            // Phase 2: Literal Grounding for each scene
            log(`Phase 2: Grounding ${scenes.length} scenes for ${script.id}...`);

            const processedScenes = [];
            for (const s of scenes) {
                const groundPrompt = buildPrompt(groundingTemplate, {
                    spoken_text: s.scriptSegment
                });

                // Small delay to avoid 429 on rapid individual calls
                await new Promise(r => setTimeout(r, 500));

                const groundRes = await generateContent('GEMINI' as LLMProvider, 'gemini-2.0-flash', groundPrompt, { temperature: 0.1 });

                let finalDuration = s.duration || (effectiveDuration / totalScenes);
                if (s.type === 'VIDEO') {
                    // Standardize: Snap to nearest 0.5s for video model stability
                    finalDuration = Math.round(finalDuration * 2) / 2;
                }

                processedScenes.push({
                    ...s,
                    duration: finalDuration,
                    prompt: groundRes.text.trim()
                });
                log(`Grounding complete for scene ${s.index}`);
            }

            // Save to DB
            await prisma.$transaction(
                processedScenes.map((s: any) => prisma.scene.create({
                    data: {
                        videoScriptId: script.id,
                        index: s.index,
                        type: s.type,
                        prompt: s.prompt,
                        scriptSegment: s.scriptSegment, // CRITICAL: Save the spoken text for subtitles
                        duration: s.duration || (effectiveDuration / totalScenes),
                        status: 'COMPLETED'
                    } as any
                }))
            );

            await prisma.videoScript.update({
                where: { id: script.id },
                data: {
                    status: 'MEDIA_GENERATED' as any
                }
            });

            // Upload Script JSON to Storage (Supabase or Drive)
            try {
                const scriptJson = JSON.stringify(script, null, 2);
                const asset = await StorageService.uploadAndRecord({
                    file: scriptJson,
                    fileName: `${script.id}_script.json`,
                    kind: 'TEXT',
                    renderId: script.id,
                    videoScriptId: script.id
                });
                console.log(`[Storage] Script JSON uploaded via ${asset.provider}: ${asset.fileName}`);
            } catch (err) {
                console.error(`[Storage] Script JSON upload failed:`, err);
            }

            log(`Successfully story-grounded script ${script.id}`);
        } catch (e: any) {
            log(`FAILED script ${script.id}: ${e.message}`);
            console.error(e);
        }
    }

    log(`COMPLETED Grounded Scribing for inquiry: ${inquiryId}`);
    return { success: true };
}

export async function runRenderPipeline(scriptId: string, aspectRatio?: string) {
    const log = (msg: string) => {
        const line = `[${new Date().toISOString()}] [RENDER] ${msg}\n`;
        fs.appendFileSync('scribing.log', line);
        console.log(`[RENDER] ${msg}`);
    };

    try {
        log(`STARTING Render Pipeline for script: ${scriptId}${aspectRatio ? ` [${aspectRatio}]` : ''}`);

        // Update script with aspect ratio if provided
        if (aspectRatio) {
            await prisma.videoScript.update({
                where: { id: scriptId },
                data: { aspectRatio }
            });
        }

        const script = await prisma.videoScript.findUnique({
            where: { id: scriptId },
            include: { scenes: { orderBy: { index: 'asc' } } }
        });

        if (!script) throw new Error("Script not found");

        // Update status to RENDERING now that we have the object in memory
        await prisma.$executeRaw`UPDATE "VideoScript" SET "status" = 'RENDERING' WHERE "id" = ${scriptId}`;

        // 1. Ensure Voice is Generated
        if (!script.audioUrl) {
            log(`Generating voiceover for script ${scriptId}...`);
            const fullText = [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n');
            const audioUrl = await generateSpeech(fullText, scriptId);
            await (prisma as any).videoScript.update({
                where: { id: scriptId },
                data: { audioUrl }
            });
            script.audioUrl = audioUrl;
            log(`Voiceover complete: ${audioUrl}`);
        }

        // 2. Dynamic Duration Rescaling (SYNC FIX)
        const audioPath = path.join(process.cwd(), 'public', script.audioUrl!);
        log(`Measuring audio duration for ${audioPath}...`);

        const audioDuration: number = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err: any, metadata: any) => {
                if (err) reject(err);
                else resolve(metadata.format.duration || 0);
            });
        });

        const plannedDuration = script.scenes.reduce((sum, s) => sum + s.duration, 0);
        const scalingFactor = audioDuration / plannedDuration;

        log(`Audio Duration: ${audioDuration.toFixed(2)}s | Planned: ${plannedDuration.toFixed(2)}s | Scaling Factor: ${scalingFactor.toFixed(3)}`);

        // Update scene durations in DB for this render run
        for (const scene of script.scenes) {
            const newDuration = Math.round((scene.duration * scalingFactor) * 100) / 100;
            await prisma.scene.update({
                where: { id: scene.id },
                data: { duration: newDuration }
            });
            log(`Rescaled Scene ${scene.index}: ${scene.duration.toFixed(2)}s -> ${newDuration.toFixed(2)}s`);
        }

        // Refresh script with updated scene durations
        const updatedScript = await prisma.videoScript.findUnique({
            where: { id: scriptId },
            include: { scenes: { orderBy: { index: 'asc' } } }
        });

        // 3. Ensure all scene Assets are Generated (PARALLEL)
        log(`Checking assets for ${updatedScript!.scenes.length} scenes...`);
        const assetTasks = updatedScript!.scenes.map(async (scene) => {
            if (!scene.assetUrl) {
                log(`Queuing parallel generation for scene ${scene.index} (${scene.type})...`);
                return generateMediaAsset(scene.id);
            } else {
                log(`Skipping asset generation for scene ${scene.index} (Asset already exists)`);
                return scene.assetUrl;
            }
        });

        await Promise.all(assetTasks);

        // 4. Final Render
        log(`Executing FFmpeg render...`);
        const videoUrl = await renderVideo({
            scriptId,
            outputName: `ua_render_${scriptId}`
        }, (msg: string) => log(`[FFMPEG] ${msg}`));

        // Update script with final video URL
        await prisma.$executeRaw`UPDATE "VideoScript" SET "status" = 'RENDERED', "videoUrl" = ${videoUrl} WHERE "id" = ${scriptId}`;

        log(`RENDER COMPLETED: ${videoUrl}`);
        return videoUrl;

    } catch (error: any) {
        log(`CRITICAL PIPELINE ERROR: ${error.message}`);
        await prisma.$executeRaw`UPDATE "VideoScript" SET "status" = 'FAILED' WHERE "id" = ${scriptId}`.catch(() => { });
        console.error(error);
        throw error;
    }
}
