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
import { getIntelligibleName } from "./naming";

export function debugLog(msg: string) {
    const time = new Date().toISOString();
    try {
        fs.appendFileSync('debug.log', `[${time}] ${msg}\n`);
    } catch (e) {
        console.error("Failed to write to debug.log", e);
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
function extractJSON(text: string): any {
    if (!text) throw new Error("Empty response received from LLM.");

    // Aggressively strip ALL markdown code blocks
    let cleaned = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();

    const tryParse = (str: string) => {
        try {
            return JSON.parse(str);
        } catch (e: any) {
            // If it fails due to control characters or line breaks, sanitize manually
            if (e.message.includes("control character") || e.message.includes("line breaks") || e.message.includes("Unexpected token")) {
                let sanitized = "";
                let inString = false;
                let escaped = false;

                for (let i = 0; i < str.length; i++) {
                    const char = str[i];
                    const code = str.charCodeAt(i);

                    if (char === '"' && !escaped) {
                        inString = !inString;
                        sanitized += char;
                    } else if (inString) {
                        // Inside string: ALL control characters (0x00-0x1F) MUST be escaped
                        if (code < 32) {
                            switch (char) {
                                case '\n': sanitized += '\\n'; break;
                                case '\r': sanitized += '\\r'; break;
                                case '\t': sanitized += '\\t'; break;
                                case '\b': sanitized += '\\b'; break;
                                case '\f': sanitized += '\\f'; break;
                                default:
                                    const hex = code.toString(16).padStart(4, '0');
                                    sanitized += `\\u${hex}`;
                            }
                        } else {
                            sanitized += char;
                        }
                    } else {
                        // Outside string: Only allow valid whitespace, escape other control characters
                        if (code < 32 && ![9, 10, 13].includes(code)) {
                            const hex = code.toString(16).padStart(4, '0');
                            sanitized += `\\u${hex}`;
                        } else {
                            sanitized += char;
                        }
                    }

                    // Track escape state
                    if (char === '\\' && !escaped) {
                        escaped = true;
                    } else {
                        escaped = false;
                    }
                }

                try {
                    return JSON.parse(sanitized);
                } catch (innerE) {
                    throw e; // Throw original if sanitization still fails
                }
            }
            throw e;
        }
    };

    try {
        return tryParse(cleaned);
    } catch (e: any) {
        debugLog(`[extractJSON Fail] Failed first pass with cleaned text. Attempting resilient recovery.`);

        // --- RESILIENT RECOVERY ---
        // 1. Greedy brace extraction - we look for the OUTERMOST braces
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            let jsonPart = text.substring(firstBrace, lastBrace + 1);

            // Clean any markdown blocks that might have been captured inside the range
            jsonPart = jsonPart.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');

            // 2. Truncated JSON recovery: count braces and brackets and close them
            let braceCount = 0;
            let bracketCount = 0;
            let inString = false;
            let escaped = false;

            for (let i = 0; i < jsonPart.length; i++) {
                const char = jsonPart[i];
                if (char === '"' && !escaped) inString = !inString;
                if (!inString) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                    if (char === '[') bracketCount++;
                    if (char === ']') bracketCount--;
                }
                escaped = char === '\\' && !escaped;
            }

            // Close strings
            if (inString) jsonPart += '"';
            // Close brackets
            while (bracketCount > 0) { jsonPart += ']'; bracketCount--; }
            // Close braces
            while (braceCount > 0) { jsonPart += '}'; braceCount--; }

            try {
                return tryParse(jsonPart);
            } catch (innerE: any) {
                debugLog(`[extractJSON Fail] Resilient recovery failed: ${innerE.message}`);
            }
        }
    }
    throw new Error("Could not extract valid JSON from response.");
}


/**
 * Tier 0 — HARD FAIL (NO LLM REPAIR)
 * Encoding, Research Pack, Spine Contract, Publication Headers.
 */
function validateTier0(text: string, contracts: { researchPack?: any, spineContract?: any }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Encoding corruption (mojibake)
    const mojibake = ["Â£", "â€•", "â€¢", "â€™", "â€œ", "â€", "â", "Â"];
    for (const char of mojibake) {
        if (text.includes(char)) {
            errors.push(`Encoding corruption detected: Found "${char}". No repairs allowed.`);
        }
    }

    // 2. Missing contracts
    if (!contracts.researchPack || Object.keys(contracts.researchPack).length === 0) {
        errors.push("research_pack missing or empty.");
    }
    if (!contracts.spineContract || Object.keys(contracts.spineContract).length === 0) {
        errors.push("spine_contract missing.");
    }

    // 3. Publication headers
    if (!text.includes("# The Unemployable Advisor")) {
        errors.push("Missing publication header: '# The Unemployable Advisor'");
    }
    if (!text.match(/\n\*[^*]+\*\n/)) { // Italic subtitle
        errors.push("Missing publication subtitle (italic).");
    }

    // 4. Chapter header (H1)
    if (!text.match(/^# Chapter/m)) {
        errors.push("Missing or incorrect chapter header level: '# Chapter X: ...' (Must be H1)");
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Tier 1 — HARD FAIL (RERUN PASS C ONLY)
 * Structural breach.
 */
function validateTier1(text: string, spineContract: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check H2 count (sections are H2 in the refined structure)
    // We match ## at the start of the line, then filter out the "Chapter" heading
    const allH2s = text.match(/^##\s.+/gm) || [];
    const sectionH2s = allH2s.filter(h => !h.includes('## Chapter'));
    const h2Count = sectionH2s.length;

    if (h2Count !== 5) {
        errors.push(`Structural breach: Found ${h2Count} sections, expected exactly 5.`);
    }

    // Check H2 title length (3-6 words)
    sectionH2s.forEach(h => {
        const title = h.replace('## ', '').trim();
        const wordCount = title.split(/\s+/).length;
        if (wordCount < 3 || wordCount > 6) {
            errors.push(`Structural breach: Section title "${title}" is ${wordCount} words. Requirement: 3-6 words.`);
        }
    });

    // Check titles match spine contract
    if (spineContract && spineContract.spine) {
        spineContract.spine.forEach((s: any, idx: number) => {
            if (!text.includes(`## ${s.title}`)) {
                errors.push(`Structural breach: Missing section title "${s.title}" from spine contract.`);
            }
        });
    }

    // Extra headings
    const totalHeadings = (text.match(/^#+\s/gm) || []).length;
    // Expected: 1 (H1) + 1 (Chapter H2) + 5 (Section H2s) + 1 (REFERENCES H2 maybe?) = 8
    const refsHeading = text.includes("REFERENCES") ? 1 : 0;
    if (totalHeadings > (7 + refsHeading)) {
        errors.push(`Structural breach: Extra headings detected. Found ${totalHeadings}, expected max ${7 + refsHeading}.`);
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Tier 2 — REPAIRABLE (MAX ONE REPAIR CALL)
 * Depth, Ending, References.
 */
function validateTier2(text: string, researchPack: any): { valid: boolean; errors: string[], report: any } {
    const errors: string[] = [];
    const report: any = {
        total_words: text.split(/\s+/).length,
        words_per_section: {},
        paragraphs_per_section: {},
        headings_found: (text.match(/^##\s.+/gm) || []).filter(h => !h.includes('## Chapter'))
    };

    // 1. Depth
    if (report.total_words < 750) {
        errors.push(`Word count too low: ${report.total_words} (min 750).`);
    }

    const sections = text.split(/^##\s(?!Chapter)/gm).slice(1);
    sections.forEach((s, idx) => {
        const title = report.headings_found[idx]?.replace('## ', '') || `Section ${idx + 1}`;
        const words = s.split(/\s+/).length;
        const paragraphs = s.split(/\n\s*\n/).length;
        report.words_per_section[title] = words;
        report.paragraphs_per_section[title] = paragraphs;

        if (words < 130) errors.push(`Section "${title}" too short: ${words} words (min 130).`);
        if (paragraphs < 2) errors.push(`Section "${title}" too thin: ${paragraphs} paragraphs (min 2).`);
    });

    // 2. Ending
    const lastLines = text.trim().split('\n').slice(-5).join('\n').toLowerCase();
    const metaPhrases = ["Would you like", "Shall I", "Next section", "I will now", "Let me know"];
    for (const phrase of metaPhrases) {
        if (lastLines.includes(phrase.toLowerCase())) errors.push(`Meta-LLM language detected near end: "${phrase}"`);
    }
    if (lastLines.includes('click here') || lastLines.includes('subscribe')) errors.push("CTA language detected.");
    if (text.trim().endsWith('?')) errors.push("Ends with a question (interactive ending forbidden).");

    // 3. References & Citation Hygiene
    if (!text.includes("REFERENCES")) {
        errors.push("REFERENCES section missing.");
    } else {
        const refCount = (text.match(/\[SRC-\d+\]/g) || []).length;
        if (refCount < 5) errors.push(`Insufficient references: Found ${refCount} (min 5).`);

        // Check for Footnote syntax (Forbidden)
        if (text.match(/\[\^\d+\]/)) {
            errors.push("Forbidden citation format: Footnote syntax [^1] detected. Use [SRC-XX] only.");
        }

        // Check for Redirect/AI URLs
        const urls = text.match(/https?:\/\/[^\s\)]+/g) || [];
        const redirectPatterns = ["google.com/search", "vertexai", "googlecloud", "atp.ai"];
        for (const url of urls) {
            for (const pattern of redirectPatterns) {
                if (url.includes(pattern)) {
                    errors.push(`Reference hygiene failure: Non-canonical/Redirect URL detected: ${url}`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors, report };
}

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

    // Idempotency: Clear EVERYTHING for this inquiry
    await clearInquiryArtifacts(inquiryId);

    try {
        // --- PASS A: RESEARCH PACK (Gemini) ---
        debugLog(`[Pass A] Starting Gemini Research for inquiry: ${inquiryId}`);
        const researchPack = await runPassAResearchPack(inquiry);

        // --- PASS B: STRATEGIC PLAN (Haiku) ---
        debugLog(`[Pass B] Designing Strategic Plan for: ${inquiryId}`);
        const plan = await runPassBStrategicPlan(inquiry, researchPack);

        // --- PASS C: LONG-FORM PROSE (Sonnet with Repair) ---
        debugLog(`[Pass C] Writing Long-form Prose for: ${inquiryId}`);
        const articleProse = await runPassCWrite(inquiry, researchPack, plan, config);

        // --- PERSISTENCE ---

        // 1. Create Generation Run Record
        const run = await (prisma as any).generationRun.create({
            data: {
                weeklyInquiryId: inquiryId,
                mode: config.mode,
                stage1Model: 'claude-3-5-sonnet-20241022',
                stage1Provider: 'ANTHROPIC',
                stage1Prompt: 'UA_PROSE_WRITE',
                stage1Output: JSON.stringify(plan.spine_contract),
                status: 'PROCESSING'
            }
        });

        // 2. Persist Text Posts
        const textPosts = [];
        for (const [idx, post] of plan.text_posts.entries()) {
            const sequence = (idx + 1).toString().padStart(2, '0');
            const uaId = `UA-POST-${inquiry.uaId}-${sequence}`;

            const saved = await (prisma as any).textPost.create({
                data: {
                    uaId,
                    weeklyInquiryId: inquiryId,
                    runId: run.id,
                    index: idx,
                    title: post.title,
                    content: cleanString(post.content),
                    researchContext: JSON.stringify(researchPack),
                    status: 'EDITORIAL'
                }
            });

            // Upload to Storage
            await StorageService.uploadAndRecord({
                file: Buffer.from(cleanString(post.content), 'utf8'),
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

        // 3. Persist Article
        const cleanedArticle = cleanString(articleProse);
        const article = await (prisma as any).article.upsert({
            where: { weeklyInquiryId: inquiryId },
            create: {
                weeklyInquiryId: inquiryId,
                draftContent: cleanedArticle,
                status: 'EDITORIAL'
            },
            update: {
                draftContent: cleanedArticle,
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
                content: cleanedArticle,
                tokensUsed: 0
            }
        });

        // Upload Article to Storage
        await StorageService.uploadAndRecord({
            file: Buffer.from(cleanedArticle, 'utf8'),
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
async function runPassAResearchPack(inquiry: any, retryCount = 0): Promise<any> {
    const template = await getActivePrompt('UA_RESEARCH_PACK', PROMPTS.UA_RESEARCH_PACK);
    debugLog(`[Pass A] Building Research Pack for: ${inquiry.uaId}`);
    const prompt = buildPrompt(template, {
        theme: inquiry.theme,
        thinking: inquiry.thinking || "",
        reality: inquiry.reality || "",
        rant: inquiry.rant || ""
    });

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

        return plan;
    } catch (err: any) {
        debugLog(`[Pass B] Failed: ${err.message}`);
        if (retryCount < 1) return runPassBStrategicPlan(inquiry, researchPack, retryCount + 1);
        throw err;
    }
}

async function runPassCWrite(inquiry: any, researchPack: any, plan: any, config: PipelineConfig, retryCount = 0, repairAttempt = 0): Promise<string> {
    const template = await getActivePrompt('UA_PROSE_WRITE', PROMPTS.UA_PROSE_WRITE);

    // Pass B produces spine_contract
    const promptData: any = {
        chapter_number: plan.spine_contract.chapter_number,
        chapter_title: plan.spine_contract.chapter_title,
        italic_subtitle: plan.spine_contract.italic_subtitle,
        research_pack: JSON.stringify(researchPack),
        article_spine: JSON.stringify(plan.spine_contract)
    };

    if (plan.spine_contract.spine) {
        plan.spine_contract.spine.forEach((s: any, idx: number) => {
            promptData[`h2_${idx + 1}`] = s.title;
        });
    }

    // Alignment: theme_subtitle vs italic_subtitle
    promptData.theme_subtitle = plan.spine_contract.italic_subtitle;

    const prompt = buildPrompt(template, promptData);

    // Model Selection
    // Default: Sonnet 3.5
    // Retry/Repair: Use latest Sonnet version (per user request)
    let model = 'claude-3-5-sonnet-20241022';
    let provider: LLMProvider = 'ANTHROPIC';

    if (retryCount >= 1 || repairAttempt >= 1) {
        model = 'claude-3-7-sonnet-20250219'; // Robust latest
    }

    debugLog(`[Pass C] Writing with ${model}. (retryCount: ${retryCount}, repairAttempt: ${repairAttempt})`);

    let result;
    try {
        result = await generateContent(provider, model, prompt, {
            temperature: 0.5,
            maxTokens: 8192
        });
    } catch (err: any) {
        // Fallback to Sonnet Latest if 20241022 fails (handled in providers.ts, but safety here)
        throw err;
    }

    let prose = cleanString(result.text.trim());

    // --- TIER 0: HARD FAIL ---
    const t0 = validateTier0(prose, { researchPack, spineContract: plan.spine_contract });
    if (!t0.valid) {
        debugLog(`[Tier 0 Fail] ${t0.errors.join(' | ')}`);
        throw new Error(`Pipeline Halted (Tier 0): ${t0.errors[0]}`);
    }

    // --- TIER 1: STRUCTURAL BREACH (Rerun Pass C Once) ---
    const t1 = validateTier1(prose, plan.spine_contract);
    if (!t1.valid) {
        debugLog(`[Tier 1 Fail] ${t1.errors.join(' | ')}`);
        if (retryCount < 1) {
            debugLog(`[Pass C] Structural Breach. Rerunning Pass C...`);
            return runPassCWrite(inquiry, researchPack, plan, config, retryCount + 1, repairAttempt);
        }
        throw new Error(`Pipeline Halted (Tier 1): Structural Breach failed after retry.`);
    }

    // --- TIER 2: REPAIRABLE (Max 1 Repair Call) ---
    const t2 = validateTier2(prose, researchPack);
    if (!t2.valid) {
        debugLog(`[Tier 2 Fail] ${t2.errors.join(' | ')}`);
        if (repairAttempt < 1) {
            debugLog(`[Pass C] Triggering targeted repair...`);

            // Build Repair Prompt
            const repairTemplate = `
You are the Editorial Validator. The following article failed quality gates.
FAILS:
{{errors}}

METRICS:
{{metrics}}

ARTICLE:
{{article}}

TASK:
Fix only the violations listed above. 
If depth is the issue, expand the thin sections by 2-3 paragraphs.
If ending is the issue, rewrite the final paragraph to be a quiet, unresolved close with no questions.
If references are missing, ensure citations match [SRC-ID] from research pack.

Return the FULL fixed article.
`;
            const repairPrompt = buildPrompt(repairTemplate, {
                errors: t2.errors.join('\n'),
                metrics: JSON.stringify(t2.report),
                article: prose
            });

            const repairResult = await generateContent(provider, model, repairPrompt, {
                temperature: 0.3,
                maxTokens: 8192
            });

            const repairedProse = cleanString(repairResult.text.trim());

            // Re-validate Tier 2 after repair
            const finalCheck = validateTier2(repairedProse, researchPack);
            if (!finalCheck.valid) {
                debugLog(`[Repair Failed] ${finalCheck.errors.join(' | ')}`);
            }
            return repairedProse;
        }

        // If we reach here, it failed Tier 2 but we already used the repair budget.
        // We log the failure but continue to save what we have as 'EDITORIAL' review required.
        debugLog(`[Tier 2 Warning] Article passed structural gates but failed quality gates: ${t2.errors.join(', ')}`);
    }

    return prose;
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



const countWords = (text: string) => text.trim().split(/\s+/).length;

/**
 * Tier 3 — Voice Quality Gate
 * Validates audio integrity, duration, and file size.
 */
async function validateTier3(scriptId: string, audioUrl: string): Promise<{ valid: boolean; errors: string[]; duration: number }> {
    const errors: string[] = [];
    let duration = 0;
    const fullPath = path.join(process.cwd(), 'public', audioUrl);

    if (!fs.existsSync(fullPath)) {
        errors.push("Audio file not found on disk.");
        return { valid: false, errors, duration: 0 };
    }

    const stats = fs.statSync(fullPath);
    if (stats.size < 1000) {
        errors.push("Audio file is too small (possible generation failure).");
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
        fs.appendFileSync('debug.log', line);
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

        const text = [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n');

        try {
            log(`Generating audio for ${script.durationType} script...`);
            const audioUrl = await generateSpeech(text, script.id, inquiry.id);

            // Tier 3 Validation
            const validation = await validateTier3(script.id, audioUrl);
            if (!validation.valid) {
                throw new Error(`Tier 3 Fail: ${validation.errors.join(', ')}`);
            }

            await (prisma as any).videoScript.update({
                where: { id: script.id },
                data: {
                    audioUrl,
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

                    let structJson = structRes.text;
                    if (structJson.includes('```')) {
                        structJson = structJson.split(/```(?:json)?/)[1].split('```')[0].trim();
                    }
                    const { scenes } = JSON.parse(structJson);
                    log(`Structure received: ${scenes.length} segments.`);

                    // Phase 2: Literal Grounding for each scene
                    log(`Phase 2: Grounding ${scenes.length} scenes for ${script.id}...`);

                    const processedScenes = [];
                    for (const s of scenes) {
                        const groundPrompt = buildPrompt(groundingTemplate, {
                            spoken_text: s.scriptSegment
                        });

                        await new Promise(r => setTimeout(r, 500));

                        const groundRes = await generateContent('GEMINI' as LLMProvider, 'gemini-2.0-flash', groundPrompt, { temperature: 0.1 });

                        let finalDuration = s.duration || (effectiveDuration / totalScenes);
                        if (s.type === 'VIDEO') {
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
                    const savedScenes = await prisma.$transaction(
                        processedScenes.map((s: any) => prisma.scene.create({
                            data: {
                                videoScriptId: script.id,
                                index: s.index,
                                type: s.type,
                                prompt: s.prompt,
                                scriptSegment: s.scriptSegment,
                                duration: s.duration,
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
        fs.appendFileSync('scribing.log', line);
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

        // 1. Ensure Voice is Generated
        if (!script.audioUrl) {
            log(`Generating voiceover for script ${scriptId}...`);
            const fullText = [script.hook, script.script, script.closingLine].filter(Boolean).join('\n\n');
            const audioUrl = await generateSpeech(fullText, scriptId, script.weeklyInquiryId);
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
