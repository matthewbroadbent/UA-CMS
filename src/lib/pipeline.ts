import { prisma } from "./prisma";
import { PROMPTS, buildPrompt, getActivePrompt } from "./prompts";
import { NextResponse } from 'next/server';
import { generateScripts } from '@/lib/gemini';
import { generateSpeech } from '@/lib/voice';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffprobePath from 'ffprobe-static';
import { generateMediaAsset } from './scenes';
import { renderVideo } from './renderer';
import { LLMProvider, generateContent, extractJSON } from './providers';
import { StorageService } from "./storage";
import { getIntelligibleName } from "./naming";
import { validateArticle } from './validator';
import { applyEditorialSanitization, validateUrl } from './editorial';

export function debugLog(msg: string) {
    const time = new Date().toISOString();
    try {
        fs.appendFileSync('/tmp/debug.log', `[${time}] ${msg}\n`);
    } catch (e) {
        console.error("Failed to write to debug.log", e);
    }
}

// Use bundled ffprobe binary (works on Vercel and Docker)
ffmpeg.setFfprobePath(ffprobePath.path);

/**
 * Follows a redirect URL and returns the canonical destination.
 * Falls back gracefully to the original URL if resolution fails or times out.
 */
async function resolveRedirectUrl(url: string, timeoutMs = 5000): Promise<string> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': 'UA-Editorial-Validator/1.0' }
        });
        clearTimeout(timeout);
        // res.url is the final URL after all redirects have been followed
        return res.url || url;
    } catch (e: any) {
        debugLog(`[Pass A] Could not resolve redirect for ${url}: ${e.message}`);
        return url;
    }
}

/**
 * Word count utility
 */
function countWords(text: string) {
    return text.trim().split(/\s+/).length;
}

/**
 * Verifies if a URL is reachable (returns 200 OK)
 */
async function verifyUrl(url: string, timeoutMs = 3000): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: { 'User-Agent': 'UA-Editorial-Validator/1.0' }
        });

        clearTimeout(timeout);
        return { ok: res.ok, status: res.status };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}

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

/**
 * Robustly extracts and parses JSON from a string that might contain preamble, 
 * search tool output, or markdown citations.
 */



/**
 * extractJSON - Resilient JSON extraction
 */

export async function resetInquiryToStartingState(inquiryId: string, targetStatus: string) {
    console.log(`[Pipeline] Resetting Inquiry ${inquiryId} to starting state of ${targetStatus}`);

    if (targetStatus === 'PENDING') {
        return await clearInquiryArtifacts(inquiryId);
    }

    // Common Cleanup for anything EDITORIAL or later being reset
    if (['EDITORIAL', 'VOICE', 'MEDIA'].includes(targetStatus)) {
        // If resetting to Editorial, we must kill everything downstream (Audio, Scenes, Assets)
        // If resetting to Voice, we kill everything downstream (Scenes, Media Assets)

        if (targetStatus === 'EDITORIAL') {
            console.log(`[Pipeline] Resetting to EDITORIAL: Un-approving and flushing downstream assets.`);
            // Un-approve Article
            await (prisma as any).article.updateMany({
                where: { weeklyInquiryId: inquiryId },
                data: { approved: false }
            });
            // Un-approve Scripts & Flush Audio/Video URLs
            await (prisma as any).videoScript.updateMany({
                where: { weeklyInquiryId: inquiryId },
                data: { approved: false, audioUrl: null, videoUrl: null, status: 'DRAFT' }
            });
            // Flush ALL assets (Audio, Video, Scenes)
            await (prisma as any).outputAsset.deleteMany({ where: { weeklyInquiryId: inquiryId } });
            await (prisma as any).driveOutput.deleteMany({ where: { weeklyInquiryId: inquiryId } });

            // Delete Scenes
            const scripts = await (prisma as any).videoScript.findMany({ where: { weeklyInquiryId: inquiryId } });
            for (const script of scripts) {
                await (prisma as any).scene.deleteMany({ where: { videoScriptId: script.id } });
            }
        }

        if (targetStatus === 'VOICE') {
            console.log(`[Pipeline] Resetting to VOICE: Flushing audio and downstream media.`);
            // Keep scripts approved (they were approved to GET to Voice), but flush audio
            await (prisma as any).videoScript.updateMany({
                where: { weeklyInquiryId: inquiryId },
                data: { audioUrl: null, videoUrl: null, status: 'APPROVED' }
            });
            // Flush Audio/Video/Scene assets only
            await (prisma as any).outputAsset.deleteMany({
                where: { weeklyInquiryId: inquiryId, kind: { in: ['AUDIO', 'VIDEO', 'IMAGE'] } }
            });
            await (prisma as any).driveOutput.deleteMany({
                where: { weeklyInquiryId: inquiryId, fileType: { in: ['AUDIO', 'VIDEO'] } }
            });

            // Delete Scenes
            const scripts = await (prisma as any).videoScript.findMany({ where: { weeklyInquiryId: inquiryId } });
            for (const script of scripts) {
                await (prisma as any).scene.deleteMany({ where: { videoScriptId: script.id } });
            }
        }

        if (targetStatus === 'MEDIA') {
            console.log(`[Pipeline] Resetting to MEDIA: Flushing scenes and master renders.`);
            // Keep audio, flush scenes and video
            await (prisma as any).videoScript.updateMany({
                where: { weeklyInquiryId: inquiryId },
                data: { videoUrl: null, status: 'VOICE_GENERATED' }
            });
            // Flush Video/Scene assets only
            await (prisma as any).outputAsset.deleteMany({
                where: { weeklyInquiryId: inquiryId, kind: { in: ['VIDEO', 'IMAGE'] } }
            });
            await (prisma as any).driveOutput.deleteMany({
                where: { weeklyInquiryId: inquiryId, fileType: 'VIDEO' }
            });

            // Delete Scenes
            const scripts = await (prisma as any).videoScript.findMany({ where: { weeklyInquiryId: inquiryId } });
            for (const script of scripts) {
                await (prisma as any).scene.deleteMany({ where: { videoScriptId: script.id } });
            }
        }
    }
}

export async function clearInquiryArtifacts(inquiryId: string) {
    const inquiry = await (prisma as any).weeklyInquiry.findUnique({
        where: { id: inquiryId },
        include: { article: true }
    });

    if (!inquiry) return;

    console.log(`[Pipeline] Nuclear Clean for Inquiry: ${inquiryId}`);

    // Order matters for some FK constraints if not cascade deleted
    await (prisma as any).outputAsset.deleteMany({ where: { weeklyInquiryId: inquiryId } });
    await (prisma as any).driveOutput.deleteMany({ where: { weeklyInquiryId: inquiryId } });
    await (prisma as any).textPost.deleteMany({ where: { weeklyInquiryId: inquiryId } });
    await (prisma as any).generationRun.deleteMany({ where: { weeklyInquiryId: inquiryId } });

    // Nuclear Wipe: Scripts and Scenes
    const scripts = await (prisma as any).videoScript.findMany({ where: { weeklyInquiryId: inquiryId } });
    for (const script of scripts) {
        // Also wipe assets related directly to scripts if any
        await (prisma as any).outputAsset.deleteMany({ where: { videoScriptId: script.id } });
        await (prisma as any).driveOutput.deleteMany({ where: { videoScriptId: script.id } });
        await (prisma as any).scene.deleteMany({ where: { videoScriptId: script.id } });
    }
    await (prisma as any).videoScript.deleteMany({ where: { weeklyInquiryId: inquiryId } });

    // Reset Article
    if (inquiry.article) {
        await (prisma as any).outputAsset.deleteMany({ where: { articleId: inquiry.article.id } });
        await (prisma as any).driveOutput.deleteMany({ where: { articleId: inquiry.article.id } });
        await (prisma as any).article.delete({
            where: { id: inquiry.article.id }
        });
    }

    console.log(`[Pipeline] Cleanup complete for ${inquiryId}`);
}

export async function runPipeline(inquiryId: string, config: PipelineConfig) {
    const inquiry = await (prisma as any).weeklyInquiry.findUnique({
        where: { id: inquiryId },
        include: { article: true }
    });

    if (!inquiry) throw new Error("Inquiry not found");

    // [Idempotency Fix] Defer clearing until we have confirmed new generation success
    // await clearInquiryArtifacts(inquiryId);

    try {
        // --- PASS A: RESEARCH PACK (Gemini) ---
        debugLog(`[Pass A] Starting Gemini Research for inquiry: ${inquiryId}`);
        const researchPack = await runPassAResearchPack(inquiry);

        // --- PASS B: STRATEGIC PLAN (Haiku) ---
        debugLog(`[Pass B] Designing Strategic Plan for: ${inquiryId}`);
        const plan = await runPassBStrategicPlan(inquiry, researchPack);

        // --- PASS C1: REALITY STORY (Sonnet) ---
        debugLog(`[Pass C1] Writing Reality story for: ${inquiryId}`);
        const section1 = await runPassC1StoryPass(inquiry);

        // --- PASS C2: LONG-FORM PROSE (Sonnet) ---
        debugLog(`[Pass C2] Writing Long-form Prose for: ${inquiryId}`);
        const articleProse = await runPassC2ProseWrite(inquiry, researchPack, plan, config, section1);

        // --- PASS D: COMPLIANCE PASS (Sonnet) ---
        debugLog(`[Pass D] Running Compliance Pass for: ${inquiryId}`);
        const complianceResult = await runPassDCompliancePass(articleProse, plan.text_posts);

        // --- ATOMIC TRANSITION: CLEAR OLD DATA JUST BEFORE SAVING NEW ---
        debugLog(`[Pipeline] Content generated successfully. Performing final cleanup of previous artifacts...`);
        await clearInquiryArtifacts(inquiryId);

        // --- PERSISTENCE ---

        // 1. Create Generation Run Record
        const run = await (prisma as any).generationRun.create({
            data: {
                weeklyInquiryId: inquiryId,
                mode: config.mode,
                stage1Model: 'claude-3-5-sonnet-latest',
                stage1Provider: 'ANTHROPIC',
                stage1Prompt: 'UA_PROSE_WRITE',
                stage1Output: JSON.stringify(plan.spine_contract),
                status: 'PROCESSING'
            }
        });

        // 2. Persist Text Posts (using Pass D compliance-checked content)
        const textPosts = [];
        for (const [idx, post] of plan.text_posts.entries()) {
            const sequence = (idx + 1).toString().padStart(2, '0');
            const uaId = `UA-POST-${inquiry.uaId}-${sequence}`;

            // Use compliance-checked content from Pass D where available
            const compPost = complianceResult.posts.find((p: any) => p.index === idx + 1);
            const finalContent = compPost ? compPost.content : post.content;

            const saved = await prisma.textPost.create({
                data: {
                    uaId,
                    weeklyInquiryId: inquiryId,
                    runId: run.id,
                    index: idx,
                    title: post.title,
                    content: cleanString(finalContent),
                    researchPackData: JSON.stringify(researchPack),
                    status: 'EDITORIAL'
                }
            });

            // Upload to Storage
            await StorageService.uploadAndRecord({
                file: Buffer.from(cleanString(finalContent), 'utf8'),
                fileName: getIntelligibleName({
                    uaId: inquiry.uaId,
                    type: 'POST',
                    detail: (idx + 1).toString().padStart(2, '0'),
                    extension: 'md'
                }),
                kind: 'TEXT',
                renderId: uaId,
                textPostId: saved.id,
                weeklyInquiryId: inquiryId
            });
            textPosts.push(saved);
        }

        // 3. Persist Article (rawOutput = Pass C2 prose; draftContent = Pass D compliance-checked)
        const sanitizedOutput = applyEditorialSanitization(complianceResult.article);
        const validation = validateArticle(sanitizedOutput, { researchPack, spineContract: plan.spine_contract });

        const article = await prisma.article.upsert({
            where: { weeklyInquiryId: inquiryId },
            create: {
                weeklyInquiryId: inquiryId,
                rawOutput: articleProse,
                draftContent: sanitizedOutput,
                researchPackData: JSON.stringify(researchPack),
                validationReport: JSON.stringify(validation),
                status: 'EDITORIAL'
            },
            update: {
                rawOutput: articleProse,
                draftContent: sanitizedOutput,
                researchPackData: JSON.stringify(researchPack),
                validationReport: JSON.stringify(validation),
                status: 'EDITORIAL'
            }
        });

        // Create Generation Output for Substack record
        const output = await (prisma as any).generationOutput.create({
            data: {
                runId: run.id,
                model: 'Claude-3.5-Sonnet-Deterministic',
                provider: 'ANTHROPIC',
                prompt: 'UA_PROSE_WRITE',
                content: sanitizedOutput,
                tokensUsed: 0
            }
        });

        // Upload Article to Storage
        await StorageService.uploadAndRecord({
            file: Buffer.from(sanitizedOutput, 'utf8'),
            fileName: getIntelligibleName({
                uaId: inquiry.uaId,
                type: 'ARTICLE',
                extension: 'md'
            }),
            kind: 'TEXT',
            renderId: inquiry.uaId,
            articleId: article.id,
            weeklyInquiryId: inquiryId
        });

        await (prisma as any).generationRun.update({
            where: { id: run.id },
            data: { status: 'SUCCESS' }
        });

        return { runId: run.id, outputs: [output], textPosts };

    } catch (err: any) {
        // --- STRUCTURED FAILURE REPORT ---
        const failureReport = {
            status: "FAILED",
            tier: err.message.includes("Tier 0") ? 0 : err.message.includes("Tier 1") ? 1 : 2,
            fail_reasons: [err.message],
            metrics: {
                timestamp: new Date().toISOString(),
                inquiryId
            },
            next_action: err.message.includes("Tier 0") ? "HARD FAIL: Manual intervention required." : "RETRY: Check logs for structural compliance."
        };

        debugLog(`[PIPELINE FAILURE] ${JSON.stringify(failureReport, null, 2)}`);

        // Ensure UI reflects the failure by not saving the article or marking the run as FAILED
        // (Wait, we need a run record to mark as failed if it was created, but Pass A/B/C may fail before creation)

        throw err; // Re-throw to inform the caller (API route)
    }
}

/**
 * Stage 0: Research Pack (Gemini)
 */
async function runPassAResearchPack(inquiry: any, retryCount = 0, hint = ""): Promise<any> {
    const template = await getActivePrompt('UA_RESEARCH_PACK', PROMPTS.UA_RESEARCH_PACK);
    debugLog(`[Pass A] Building Research Pack for: ${inquiry.uaId}`);
    let prompt = buildPrompt(template, {
        theme: inquiry.theme,
        thinking: inquiry.thinking || "",
        reality: inquiry.reality || "",
        rant: inquiry.rant || ""
    });

    if (hint) {
        prompt += `\n\nINSTRUCTION UPDATE: ${hint}`;
    }

    const result = await generateContent('GEMINI', 'gemini-2.0-flash', prompt, {
        temperature: 0.2,
        useSearch: true,
        maxTokens: 16384
        // responseMimeType: 'application/json' // CANNOT use with Search tool in Gemini
    });

    try {
        const pack = extractJSON(result.text);

        // Strict Validation: Sources
        if (!pack.sources || pack.sources.length === 0) {
            throw new Error("Research Pack failed: No sources found.");
        }

        // --- URL Health Check (Implementation Plan Fix) ---
        debugLog(`[Pass A] Verifying ${pack.sources.length} citation URLs...`);
        const verificationResults = await Promise.all(
            pack.sources.map(async (s: any) => ({
                id: s.id,
                url: s.url,
                health: await verifyUrl(s.url)
            }))
        );

        const brokenCount = verificationResults.filter(r => !r.health.ok).length;
        const brokenPercentage = (brokenCount / pack.sources.length) * 100;

        if (brokenPercentage > 30 && retryCount < 1) {
            debugLog(`[Pass A] High broken URL rate (${brokenPercentage.toFixed(1)}%). Retrying with ROBUST_SOURCES hint.`);
            const robustHint = "The previous research returned too many broken links. Use ONLY high-authority, stable news/regulator domains (e.g., gov.uk, ft.com, reuters.com, bbc.co.uk).";
            return runPassAResearchPack(inquiry, retryCount + 1, robustHint);
        }

        // --- Redirect URL Resolution ---
        // Resolve any proxy or redirect URLs (e.g. vertexaisearch.cloud.google.com) to their
        // canonical publisher destinations before the pack is passed to Pass B and Pass C.
        debugLog(`[Pass A] Resolving redirect URLs in sources...`);
        for (const source of pack.sources) {
            if (source.url && !validateUrl(source.url).valid) {
                const resolved = await resolveRedirectUrl(source.url);
                if (resolved !== source.url) {
                    debugLog(`[Pass A] Resolved ${source.id}: ${source.url} → ${resolved}`);
                    source.url = resolved;
                }
                // Fix publisher field if Gemini populated it from a redirect/proxy domain
                if (source.publisher && /vertexaisearch|googlecloud|googleapis/i.test(source.publisher)) {
                    try {
                        const domain = new URL(source.url).hostname.replace(/^www\./, '');
                        debugLog(`[Pass A] Fixed publisher for ${source.id}: "${source.publisher}" → "${domain}"`);
                        source.publisher = domain;
                    } catch {
                        // Leave publisher unchanged if URL parsing fails
                    }
                }
            }
        }

        // --- Discard sources with no valid canonical URL after resolution ---
        const beforeCount = pack.sources.length;
        pack.sources = pack.sources.filter((s: any) => {
            const url = s.url || '';
            const isEmpty = !url.trim();
            const isRedirect = /vertexaisearch|googlecloud|googleapis/i.test(url);
            if (isEmpty || isRedirect) {
                debugLog(`[Pass A] Discarded ${s.id}: no valid canonical URL after resolution.`);
                return false;
            }
            return true;
        });
        if (pack.sources.length < beforeCount) {
            debugLog(`[Pass A] Removed ${beforeCount - pack.sources.length} source(s) with invalid URLs.`);
        }

        // Traceability Check
        const sourceIds = pack.sources.map((s: any) => s.id);
        const allClaims = [...(pack.facts || []), ...(pack.stats || []), ...(pack.regulatory_changes || []), ...(pack.tensions || [])];
        const untraceable = allClaims.filter(c => !sourceIds.some((sid: string) => c.includes(sid)));

        if (untraceable.length > 0 && retryCount < 1) {
            debugLog(`[Pass A] Untraceable claims found. Retrying...`);
            return runPassAResearchPack(inquiry, retryCount + 1);
        }

        return pack;
    } catch (err: any) {
        debugLog(`[Pass A] Failed: ${err.message}`);
        if (retryCount < 1) return runPassAResearchPack(inquiry, retryCount + 1);
        throw err;
    }
}

/**
 * Stage 1: Strategic Plan (Claude)
 */
async function runPassBStrategicPlan(inquiry: any, researchPack: any, retryCount = 0) {
    const template = await getActivePrompt('UA_STRATEGIC_PLAN', PROMPTS.UA_STRATEGIC_PLAN);
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

    debugLog(`[Pass B] Designing Strategic Plan for: ${inquiry.uaId}`);
    const prompt = buildPrompt(template, {
        theme: inquiry.theme,
        thinking: inquiry.thinking || "",
        reality: inquiry.reality || "",
        rant: inquiry.rant || "",
        nuclear: inquiry.nuclear || "",
        research_pack: JSON.stringify(researchPack),
        today: today
    });

    const result = await generateContent('ANTHROPIC', 'claude-3-5-haiku-20241022', prompt, {
        temperature: 0.3,
        maxTokens: 4096,
        responseMimeType: 'application/json'
    });

    try {
        const plan = extractJSON(result.text);

        // Validation: Spine Contract & Post Count
        if (!plan.spine_contract || !plan.spine_contract.spine || plan.spine_contract.spine.length !== 5 || !plan.text_posts || plan.text_posts.length !== 7) {
            debugLog(`[Pass B] Invalid structure (Spine: ${plan.spine_contract?.spine?.length}, Posts: ${plan.text_posts?.length}). Retrying...`);
            if (retryCount < 1) return runPassBStrategicPlan(inquiry, researchPack, retryCount + 1);
            throw new Error(`Strategic Plan failed: Must have exactly 5 spine sections and 7 text posts.`);
        }

        // Coerce chapter_number to a positive integer
        const rawChapterNum = plan.spine_contract.chapter_number;
        const parsedChapterNum = parseInt(String(rawChapterNum), 10);
        if (!isNaN(parsedChapterNum) && parsedChapterNum > 0) {
            plan.spine_contract.chapter_number = parsedChapterNum;
        } else {
            const count = await prisma.weeklyInquiry.count();
            plan.spine_contract.chapter_number = count;
            debugLog(`[Pass B] chapter_number coerced: "${rawChapterNum}" → ${count} (inquiry count fallback).`);
        }

        return plan;
    } catch (err: any) {
        debugLog(`[Pass B] Failed: ${err.message}`);
        if (retryCount < 1) return runPassBStrategicPlan(inquiry, researchPack, retryCount + 1);
        throw err;
    }
}

/**
 * Programmatically removes exclusion phrases, named brands and framing notes
 * from the Reality field before it reaches the LLM.
 * The model cannot reproduce what it never receives.
 */
function preprocessRealityField(reality: string): {
    cleaned: string;
    foundExclusions: string[];
    excludedNames: string[];
    removedFramingNotes: string[];
} {
    const EXCLUSION_TRIGGERS = [
        "i would prefer it if they were not mentioned",
        "prefer not to name",
        "prefer not to mention",
        "do not mention",
        "i would rather not identify",
        "i would rather not name",
        "please do not name",
        "rather not say"
    ];

    const FRAMING_TRIGGERS = [
        "this is probably an extreme example",
        "this might be an extreme example",
        "perhaps an extreme example"
    ];

    const COMMON_WORDS = new Set([
        // Sentence starters / conjunctions / articles
        'The', 'And', 'But', 'For', 'With', 'This', 'That', 'They', 'Their',
        'There', 'Would', 'Could', 'Should', 'Were', 'Have', 'Been', 'When',
        'What', 'Which', 'Who', 'How', 'Not', 'From', 'Into', 'About', 'Just',
        'Each', 'Also', 'More', 'Very', 'Rather', 'Please', 'Prefer', 'If',
        'Like', 'Such', 'Name', 'Mention', 'Want', 'Know', 'Think', 'Some',
        // Pronouns
        'I', 'We', 'He', 'She', 'It', 'You', 'Our', 'My', 'His', 'Her',
        'Having', 'Because', 'Although', 'Although', 'Despite', 'After',
        'Before', 'During', 'Without', 'Within', 'Between', 'Through',
        // Countries / regions / nationalities commonly appearing in SME stories
        'UK', 'US', 'EU', 'China', 'Italy', 'France', 'Germany', 'Spain',
        'India', 'Japan', 'America', 'Europe', 'Asia', 'Africa', 'London',
        'British', 'English', 'Scottish', 'Welsh', 'Irish', 'American',
        'Chinese', 'Italian', 'French', 'German', 'Indian',
        // Month names
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
        // Season names
        'Spring', 'Summer', 'Autumn', 'Winter',
        // Day names
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        // Job titles (standalone, without a preceding proper name)
        'Managing', 'Director', 'Manager', 'Partner', 'Chairman', 'Chief',
        'Officer', 'President', 'Executive', 'Senior', 'Junior', 'Head',
        'Finance', 'Operations', 'Marketing', 'Sales', 'Legal',
        // Common adjectives/nouns that start sentences and look like proper nouns
        'Ladies', 'Fashion', 'Retail', 'Trade', 'Business', 'Company',
        'Group', 'Limited', 'Trust', 'Fund', 'Bank', 'Capital'
    ]);

    // Split into sentences on . ! ? followed by whitespace
    const sentences = reality.split(/(?<=[.!?])\s+/);

    const foundExclusions: string[] = [];
    const excludedNames: string[] = [];
    const removedFramingNotes: string[] = [];
    const exclusionSentences: string[] = [];

    const keptSentences = sentences.filter(sentence => {
        const lower = sentence.toLowerCase();
        if (EXCLUSION_TRIGGERS.some(t => lower.includes(t))) {
            foundExclusions.push(sentence.trim());
            exclusionSentences.push(sentence);
            return false;
        }
        if (FRAMING_TRIGGERS.some(t => lower.includes(t))) {
            removedFramingNotes.push(sentence.trim());
            return false;
        }
        return true;
    });

    // Extract proper nouns from ALL sentences when an exclusion trigger was found.
    // The trigger sentence often uses an indirect reference ("the above two brands"),
    // so the actual brand names may appear anywhere in the Reality field.
    if (foundExclusions.length > 0) {
        const capPattern = /\b([A-Z][a-zA-Z'&]{1,}(?:\s+[A-Z][a-zA-Z'&]{1,}){0,2})\b/g;
        for (const sentence of sentences) {
            let match;
            capPattern.lastIndex = 0;
            while ((match = capPattern.exec(sentence)) !== null) {
                const candidate = match[1].trim();
                const firstWord = candidate.split(/\s+/)[0];
                if (COMMON_WORDS.has(firstWord)) continue;
                // Skip each word in the candidate if any part is a common word
                const allWords = candidate.split(/\s+/);
                if (allWords.some(w => COMMON_WORDS.has(w))) continue;
                // Skip short candidates and short all-caps abbreviations
                if (candidate.length < 3) continue;
                if (candidate === candidate.toUpperCase() && candidate.length <= 3) continue;
                if (!excludedNames.includes(candidate)) {
                    excludedNames.push(candidate);
                }
            }
        }
    }

    // Replace excluded names in the remaining text
    let cleaned = keptSentences.join(' ').trim();
    for (const name of excludedNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'a well-known brand');
    }

    return { cleaned, foundExclusions, excludedNames, removedFramingNotes };
}

/**
 * Pass C1: Reality Story (Claude)
 * Rewrites the author's Reality field as polished publishable prose.
 */
async function runPassC1StoryPass(inquiry: any): Promise<string> {
    const template = await getActivePrompt('UA_STORY_PASS', PROMPTS.UA_STORY_PASS);
    debugLog(`[Pass C1] Writing Reality story for: ${inquiry.uaId}`);

    // Pre-process the Reality field programmatically before the LLM sees it
    const { cleaned, foundExclusions, excludedNames, removedFramingNotes } =
        preprocessRealityField(inquiry.reality || "");

    debugLog(`[Pass C1] Pre-processed Reality field. Exclusion phrases found: ${foundExclusions.length}. Names excluded: [${excludedNames.join(', ')}]. Framing notes removed: [${removedFramingNotes.map(n => n.substring(0, 60)).join(' | ')}]`);

    const prompt = buildPrompt(template, {
        reality: cleaned
    });

    const result = await generateContent('ANTHROPIC', 'claude-3-5-sonnet-latest', prompt, {
        temperature: 0.4,
        maxTokens: 2048
    });

    const story = result.text.trim();
    const storyWordCount = countWords(story);
    debugLog(`[Pass C1] Story pass complete, word count: ${storyWordCount}`);
    if (storyWordCount < 180) {
        debugLog(`[Pass C1] Warning: story word count ${storyWordCount} below minimum 200. Consider expanding Reality field input.`);
    }
    return story;
}

/**
 * Pass C2: Long-form Prose (Claude)
 * Writes sections 2-5 of the article, building on the C1 story.
 */
async function runPassC2ProseWrite(inquiry: any, researchPack: any, plan: any, config: PipelineConfig, section1: string, retryCount = 0, repairAttempt = 0): Promise<string> {
    const template = await getActivePrompt('UA_PROSE_WRITE', PROMPTS.UA_PROSE_WRITE);

    const promptData: any = {
        chapter_number: plan.spine_contract.chapter_number,
        chapter_title: plan.spine_contract.chapter_title,
        theme_subtitle: plan.spine_contract.italic_subtitle,
        thinking: inquiry.thinking || "",
        rant: inquiry.rant || "",
        nuclear: inquiry.nuclear || "",
        research_pack: JSON.stringify(researchPack),
        article_spine: JSON.stringify(plan.spine_contract),
        section_1: section1
    };

    // Pass h2_2 through h2_5 — section 1 is handled by Pass C1
    const spineItems = plan.spine_contract.spine || [];
    for (let i = 1; i < spineItems.length; i++) {
        promptData[`h2_${i + 1}`] = spineItems[i].title;
    }

    const prompt = buildPrompt(template, promptData);

    // Model selection: default Sonnet 3.5, upgrade on retry/repair
    let model = 'claude-3-5-sonnet-latest';
    const provider: LLMProvider = 'ANTHROPIC';

    if (retryCount >= 1 || repairAttempt >= 1) {
        model = 'claude-3-7-sonnet-20250219';
    }

    debugLog(`[Pass C2] Writing with ${model}.`);

    const result = await generateContent(provider, model, prompt, {
        temperature: 0.5,
        maxTokens: 8192
    });

    const prose = result.text.trim();
    debugLog(`[Pass C2] Prose pass complete, word count: ${countWords(prose)}`);
    return prose;
}

/**
 * Pass D: Compliance Check (Claude)
 * Applies A1-A8 article checks and P1-P6 post checks.
 * Returns fixed article + posts, with a log of changes made.
 * Uses delimited text output to avoid JSON escaping failures.
 * Never throws — always returns something usable.
 */
async function runPassDCompliancePass(
    article: string,
    textPosts: any[]
): Promise<{ article: string; posts: Array<{ index: number; content: string }>; changes: string[] }> {
    const template = await getActivePrompt('UA_COMPLIANCE_PASS', PROMPTS.UA_COMPLIANCE_PASS);

    const formattedPosts = textPosts.map((p: any, idx: number) => ({
        index: idx + 1,
        content: p.content
    }));

    const prompt = buildPrompt(template, {
        article,
        posts: formattedPosts.map((p: any) => `---POST_${p.index}_INPUT---\n${p.content}\n---END_POST_${p.index}_INPUT---`).join('\n\n')
    });

    debugLog(`[Pass D] Running compliance check on article + ${textPosts.length} posts.`);

    try {
        const result = await generateContent('ANTHROPIC', 'claude-3-5-sonnet-latest', prompt, {
            temperature: 0.1,
            maxTokens: 8192
        });

        const raw = result.text;
        const lines = raw.split('\n');

        // Extracts content between an exact opening delimiter line and its closing delimiter
        function extractBlock(openDelimiter: string, closeDelimiter: string): string | null {
            const startIdx = lines.findIndex(l => l.trim() === openDelimiter);
            if (startIdx === -1) return null;
            const endIdx = lines.findIndex((l, i) => i > startIdx && l.trim() === closeDelimiter);
            if (endIdx === -1) return null;
            return lines.slice(startIdx + 1, endIdx).join('\n');
        }

        // Extract article
        const parsedArticle = extractBlock('---ARTICLE---', '---END_ARTICLE---');
        if (parsedArticle === null) {
            debugLog('[Pass D] Warning: ---ARTICLE--- delimiter missing, using Pass C2 output unchanged.');
        }
        const finalArticle = parsedArticle !== null ? parsedArticle.trim() : article;

        // Extract posts 1-7
        const posts: Array<{ index: number; content: string }> = [];
        for (let i = 1; i <= 7; i++) {
            const parsedPost = extractBlock(`---POST_${i}---`, `---END_POST_${i}---`);
            if (parsedPost !== null) {
                posts.push({ index: i, content: parsedPost.trim() });
            } else {
                debugLog(`[Pass D] Warning: ---POST_${i}--- delimiter missing, using original post unchanged.`);
                const original = formattedPosts.find((p: any) => p.index === i);
                posts.push({ index: i, content: original ? original.content : '' });
            }
        }

        // Extract changes
        const changesBlock = extractBlock('---CHANGES---', '---END_CHANGES---');
        let changes: string[] = [];
        if (changesBlock !== null) {
            changes = changesBlock
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.startsWith('- '))
                .map(l => l.slice(2).trim())
                .filter(l => l.length > 0);
            if (changes.length === 0) changes = ['No changes required'];
        } else {
            changes = ['Parse warning: changes section missing'];
        }

        changes.forEach(c => debugLog(`[Pass D] Fix: ${c}`));
        debugLog(`[Pass D] Compliance pass complete, ${changes.length} fix(es) applied.`);

        return { article: finalArticle, posts, changes };

    } catch (err: any) {
        debugLog(`[Pass D] Failed: ${err.message}. Returning Pass C2 outputs unchanged.`);
        return {
            article,
            posts: formattedPosts,
            changes: ['Pass D failure — original outputs returned unchanged.']
        };
    }
}


/**
 * Utility to clean UTF-8 artefacts and enforce UA voice rules
 */
function cleanString(text: string): string {
    if (!text) return "";

    // DANGER: We no longer repair mojibake here because Pass N mandates hard fails.
    // We only clean whitespace and trim.
    let cleaned = text.trim()
        .replace(/â´/g, "'")
        // Enforce "No Em-Dashes" rule per UA prompt
        .replace(/—/g, ' - ')
        .replace(/--/g, ' - ')
        .trim();

    // PROACTIVE HARD STOP ENFORCEMENT
    // If the text ends with a question mark, replace it with a full stop.
    if (cleaned.endsWith('?')) {
        debugLog(`[Hard Stop Enforcement] Proactively stripping trailing question mark.`);
        cleaned = cleaned.replace(/\?+$/, '.');
    }

    return cleaned;
}



/**
 * Validates audio integrity, duration, and file size.
 */
async function validateTier3(scriptId: string, audioUrl: string): Promise<{ valid: boolean; errors: string[]; duration: number }> {
    const errors: string[] = [];
    let duration = 0;

    // For remote URLs (Supabase), download to /tmp first — ffprobe cannot resolve
    // external hostnames inside the Docker container network.
    // For local paths, check /tmp/audio first (serverless), then public/.
    let fullPath: string;
    if (audioUrl.startsWith('http')) {
        const localProbe = path.join('/tmp', `${scriptId}_tier3.mp3`);
        const res = await fetch(audioUrl);
        if (!res.ok) {
            return { valid: false, errors: [`Failed to download audio for validation: ${res.status}`], duration: 0 };
        }
        fs.writeFileSync(localProbe, Buffer.from(await res.arrayBuffer()));
        fullPath = localProbe;
    } else {
        const tmpPath = path.join('/tmp', 'audio', `${scriptId}.mp3`);
        const publicPath = path.join(process.cwd(), 'public', audioUrl.startsWith('/') ? audioUrl.slice(1) : audioUrl);
        fullPath = fs.existsSync(tmpPath) ? tmpPath : publicPath;

        if (!fs.existsSync(fullPath)) {
            errors.push("Audio file not found on disk.");
            return { valid: false, errors, duration: 0 };
        }

        const stats = fs.statSync(fullPath);
        if (stats.size < 1000) {
            errors.push("Audio file is too small (possible generation failure).");
        }
    }

    try {
        const probedDuration: number = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(fullPath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata.format.duration || 0);
            });
        });
        duration = probedDuration;

        if (duration < 5) { // Any script shorter than 5s is likely a failure
            errors.push(`Audio duration too short: ${duration.toFixed(1)}s.`);
        }
    } catch (e: any) {
        errors.push(`Failed to probe audio duration: ${e.message}`);
    }

    return { valid: errors.length === 0, errors, duration };
}

export async function runVoicePipeline(inquiryId: string, options?: { autoApprove?: boolean }) {
    const log = (msg: string) => {
        const line = `[${new Date().toISOString()}] [VOICE] ${msg}\n`;
        fs.appendFileSync('/tmp/debug.log', line);
        console.log(`[VOICE] ${msg}`);
    };

    const inquiry = await prisma.weeklyInquiry.findUnique({
        where: { id: inquiryId },
        include: { scripts: true }
    });

    if (!inquiry) throw new Error("Inquiry not found");

    log(`STARTING Voice Pipeline for: ${inquiry.uaId}`);

    const results = [];
    for (const script of inquiry.scripts) {
        // Strict Voice Machine: Only process approved scripts UNLESS autoApprove is toggled
        if (!script.approved && !options?.autoApprove) {
            log(`Skipping unapproved script: ${script.id} (${script.durationType})`);
            continue;
        }

        // Strip hook duplication: hook is a standalone beat, script body must not repeat it.
        const hookText = script.hook?.trim() ?? '';
        const scriptBody = script.script?.trimStart() ?? '';
        const dedupedScript = hookText && scriptBody.startsWith(hookText)
            ? scriptBody.slice(hookText.length).trimStart()
            : scriptBody;
        const text = [script.hook, dedupedScript, script.closingLine].filter(Boolean).join('\n\n');

        try {
            log(`Generating audio for ${script.durationType} script...`);
            const audioUrl = await generateSpeech(text, script.id, inquiry.id);

            // Save audioUrl immediately — audio is already uploaded to Supabase.
            // This ensures the URL is never lost even if Tier 3 validation fails.
            await (prisma as any).videoScript.update({
                where: { id: script.id },
                data: { audioUrl }
            });

            // Tier 3 Validation
            const validation = await validateTier3(script.id, audioUrl);
            if (!validation.valid) {
                throw new Error(`Tier 3 Fail: ${validation.errors.join(', ')}`);
            }

            await (prisma as any).videoScript.update({
                where: { id: script.id },
                data: {
                    actualAudioDuration: validation.duration,
                    status: 'VOICE_GENERATED',
                    approved: options?.autoApprove ? true : script.approved
                }
            });

            results.push({ id: script.id, status: 'SUCCESS' });
            log(`Voice success for script ${script.id}`);
        } catch (err: any) {
            log(`Voice failure for script ${script.id}: ${err.message}`);
            await (prisma as any).videoScript.update({
                where: { id: script.id },
                data: { status: 'FAILED' }
            }).catch(() => { });
            results.push({ id: script.id, status: 'FAILED', error: err.message });
        }
    }

    return results;
}

export async function runMediaPipeline(inquiryId: string, selectedScriptIds?: string[] | null, options?: { autoApprove?: boolean }) {
    const log = (msg: string) => {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        fs.appendFileSync('/tmp/scribing.log', line);
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
        try {
            // DENSITY PROTECTION V2.2: Check for existing scenes before Nuclear clearing
            const existingScenes = await prisma.scene.findMany({ where: { videoScriptId: script.id } });

            if (existingScenes.length === 0) {
                log(`Phase 1: Structuring ${script.durationType} (${idx + 1}/${scriptsToProcess.length})`);

                if (idx > 0) await new Promise(r => setTimeout(r, 2000));

                const plannedDurationSec = parseInt(script.durationType) || 30;
                const fullText = [script.hook, script.script, script.closingLine].filter(Boolean).join(' ');
                const wordCount = countWords(fullText);

                // Estimate audio duration based on ~150 words per minute
                const estimatedAudioSec = Math.max(10, wordCount / 2.5);

                // USE ACTUAL DURATION IF AVAILABLE (from Voice Phase)
                const actualDuration = (script as any).actualAudioDuration;
                const effectiveDuration = actualDuration || Math.min(plannedDurationSec, estimatedAudioSec + 2);

                // Enforce Density Protection: Target 4-6s per scene
                const totalScenes = Math.max(3, Math.floor(effectiveDuration / 4.5));

                log(`Density Check: Word Count: ${wordCount} | Est. Audio: ${estimatedAudioSec.toFixed(1)}s | Planned: ${plannedDurationSec}s`);
                log(`Effective storyboard length: ${effectiveDuration.toFixed(1)}s | Calculated Scenes: ${totalScenes}`);
                const videoCount = Math.floor(totalScenes * 0.25);
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

                    const { scenes } = extractJSON(structRes.text);
                    log(`Structure received: ${scenes.length} segments.`);

                    // Phase 2: Literal Grounding for each scene
                    log(`Phase 2: Grounding ${scenes.length} scenes for ${script.id}...`);

                    const processedScenes = [];
                    let previousScenePrompt = '';
                    for (const s of scenes) {
                        const previousSceneSection = previousScenePrompt
                            ? `Previous scene:\n${previousScenePrompt}\n\n`
                            : '';
                        const groundPrompt = buildPrompt(groundingTemplate, {
                            spoken_text: s.scriptSegment,
                            previous_scene_section: previousSceneSection
                        });

                        await new Promise(r => setTimeout(r, 500));

                        const groundRes = await generateContent('GEMINI' as LLMProvider, 'gemini-2.0-flash', groundPrompt, { temperature: 0.1 });

                        let finalDuration = s.duration || (effectiveDuration / totalScenes);
                        if (s.type === 'VIDEO') {
                            finalDuration = Math.round(finalDuration * 2) / 2;
                        }

                        const scenePrompt = groundRes.text.trim();
                        processedScenes.push({
                            ...s,
                            duration: finalDuration,
                            prompt: scenePrompt
                        });
                        previousScenePrompt = scenePrompt;
                        log(`Grounding complete for scene ${s.index}`);
                    }

                    // Save to DB
                    const savedScenes = await prisma.$transaction(
                        processedScenes.map((s: any) => prisma.scene.create({
                            data: {
                                videoScriptId: script.id,
                                index: s.index,
                                type: s.type,
                                prompt: s.prompt,
                                scriptSegment: s.scriptSegment,
                                duration: s.duration,
                                approved: options?.autoApprove ?? false,
                                status: 'PENDING'
                            } as any
                        }))
                    );

                    // DURATION GAP REPAIR V1.0: Ensure storyboard matches audio perfectly
                    const totalPlanned = savedScenes.reduce((acc, s) => acc + (s as any).duration, 0);
                    const gap = effectiveDuration - totalPlanned;

                    if (Math.abs(gap) > 0.1 && savedScenes.length > 0) {
                        log(`Duration Gap Detected: ${gap.toFixed(2)}s. Repairing final scene...`);
                        const lastScene = savedScenes[savedScenes.length - 1];
                        await prisma.scene.update({
                            where: { id: lastScene.id },
                            data: { duration: (lastScene as any).duration + gap }
                        });
                    }
                } catch (err: any) {
                    log(`ERROR in Phase 1/2 for ${script.id}: ${err.message}`);
                    throw err;
                }
            } else {
                log(`Skipping Phase 1 & 2 for ${script.id}: ${existingScenes.length} existing scenes found.`);
            }

            // Phase 3: Parallel Asset Generation
            const authorizedScenes = await prisma.scene.findMany({
                where: {
                    videoScriptId: script.id,
                    approved: true,
                    assetUrl: null
                }
            });

            if (authorizedScenes.length > 0) {
                log(`Phase 3: Triggering Parallel Asset Generation for ${authorizedScenes.length} AUTHORIZED scenes...`);
                const batchSize = 3;
                for (let i = 0; i < authorizedScenes.length; i += batchSize) {
                    const batch = authorizedScenes.slice(i, i + batchSize);
                    await Promise.all(batch.map(scene => generateMediaAsset(scene.id)));
                }

                const remainingApproved = await prisma.scene.count({
                    where: { videoScriptId: script.id, approved: true, assetUrl: null }
                });

                if (remainingApproved === 0) {
                    await prisma.videoScript.update({
                        where: { id: script.id },
                        data: { status: 'MEDIA_GENERATED' as any }
                    });
                }
            } else {
                log(`Phase 3: No newly authorized scenes for ${script.id}. (Waiting for approval or already complete)`);
            }

            // Upload Script JSON to Storage
            try {
                const innerScript = await prisma.videoScript.findUnique({
                    where: { id: script.id },
                    include: { scenes: true, weeklyInquiry: true }
                });
                const scriptJson = JSON.stringify(innerScript, null, 2);
                await StorageService.uploadAndRecord({
                    file: scriptJson,
                    fileName: getIntelligibleName({
                        uaId: (innerScript as any)?.weeklyInquiry?.uaId || 'UA',
                        type: 'SCRIPT',
                        detail: script.durationType,
                        extension: 'json'
                    }),
                    kind: 'TEXT',
                    renderId: script.id,
                    videoScriptId: script.id
                });
                console.log(`[Storage] Script JSON uploaded for ${script.id}`);
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
        fs.appendFileSync('/tmp/scribing.log', line);
        console.log(`[RENDER] ${msg}`);
    };

    try {
        log(`STARTING Render Pipeline for script: ${scriptId}${aspectRatio ? ` [${aspectRatio}]` : ''}`);

        // Update script with aspect ratio if provided
        if (aspectRatio) {
            await (prisma.videoScript as any).update({
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

        // 1. Ensure Voice is Generated and audio is accessible
        // audioUrl may be a Supabase https URL or a local relative path
        const resolveAudioPath = (url: string) =>
            url.startsWith('http') ? url : path.join(process.cwd(), 'public', url);

        let audioPath = script.audioUrl ? resolveAudioPath(script.audioUrl) : '';

        const audioMissing = !script.audioUrl ||
            (!script.audioUrl.startsWith('http') && !fs.existsSync(audioPath));

        if (audioMissing) {
            log(
                !script.audioUrl
                    ? `Generating voiceover for script ${scriptId} (no existing audioUrl)...`
                    : `Regenerating voiceover for script ${scriptId} (missing audio file on disk)...`
            );
            const fullText = [script.hook, script.script, script.closingLine]
                .filter(Boolean)
                .join('\n\n');
            const audioUrl = await generateSpeech(fullText, scriptId, script.weeklyInquiryId);
            await (prisma as any).videoScript.update({
                where: { id: scriptId },
                data: { audioUrl }
            });
            script.audioUrl = audioUrl;
            audioPath = resolveAudioPath(audioUrl);
            log(`Voiceover complete: ${audioUrl}`);
        }

        // 2. Dynamic Duration Rescaling (SYNC FIX)
        // If audio is a remote URL, download to /tmp first — ffprobe cannot resolve
        // external hostnames inside the Docker container network.
        let probeAudioPath = audioPath;
        if (audioPath.startsWith('http')) {
            const localAudioProbe = path.join('/tmp', `${scriptId}_probe.mp3`);
            log(`Downloading audio for probing: ${audioPath}`);
            const audioRes = await fetch(audioPath);
            if (!audioRes.ok) throw new Error(`Failed to download audio for probing: ${audioRes.status}`);
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            fs.writeFileSync(localAudioProbe, audioBuffer);
            probeAudioPath = localAudioProbe;
        }

        log(`Measuring audio duration for ${probeAudioPath}...`);

        const audioDuration: number = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(probeAudioPath, (err: any, metadata: any) => {
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

        // 3. Ensure all scene Assets are Generated (BATCHED to respect fal.ai 10-request limit)
        log(`Checking assets for ${updatedScript!.scenes.length} scenes...`);
        const missingScenes = updatedScript!.scenes.filter(scene => {
            if (!scene.assetUrl) {
                log(`Queuing generation for scene ${scene.index} (${scene.type})...`);
                return true;
            }
            log(`Skipping asset generation for scene ${scene.index} (Asset already exists)`);
            return false;
        });

        // Process in batches of 3 to avoid hitting fal.ai's 10 concurrent request limit
        const FAL_BATCH_SIZE = 3;
        for (let i = 0; i < missingScenes.length; i += FAL_BATCH_SIZE) {
            const batch = missingScenes.slice(i, i + FAL_BATCH_SIZE);
            await Promise.all(batch.map(scene => generateMediaAsset(scene.id)));
        }

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
