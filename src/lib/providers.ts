import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { debugLog } from "./pipeline";

export type LLMProvider = 'GEMINI' | 'OPENAI' | 'ANTHROPIC';

export interface GenerationOptions {
    temperature?: number;
    maxTokens?: number;
    responseMimeType?: string;
    useSearch?: boolean;
}

export interface GenerationResult {
    text: string;
    tokensUsed?: number;
    costEstimate?: number;
}

export const PROVIDER_CONFIG = {
    GEMINI: {
        key: 'GEMINI_API_KEY',
        enabled: !!process.env.GEMINI_API_KEY
    },
    OPENAI: {
        key: 'OPENAI_API_KEY',
        enabled: !!process.env.OPENAI_API_KEY
    },
    ANTHROPIC: {
        key: 'ANTHROPIC_API_KEY',
        enabled: !!process.env.ANTHROPIC_API_KEY
    }
};

export async function generateContent(
    provider: LLMProvider,
    model: string,
    prompt: string,
    options: GenerationOptions = {}
): Promise<GenerationResult> {
    // Check if key exists
    const config = PROVIDER_CONFIG[provider];
    if (!process.env[config.key]) {
        throw new Error(`API Key for ${provider} (${config.key}) is not set in environment variables`);
    }

    switch (provider) {
        case 'GEMINI':
            return await generateGemini(model, prompt, options);
        case 'OPENAI':
            return await generateOpenAI(model, prompt, options);
        case 'ANTHROPIC':
            return await generateAnthropic(model, prompt, options);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 2000): Promise<T> {
    let delay = initialDelay;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            // Non-retryable: content blocked by Gemini safety/recitation filters
            const isNonRetryable = err._nonRetryable === true;
            if (isNonRetryable) throw err;

            const is429 = err.status === 429 ||
                err.message?.includes("429") ||
                err.message?.includes("Resource exhausted") ||
                err.message?.includes("Too Many Requests");

            if (is429 && i < maxRetries - 1) {
                const jitter = Math.random() * 1000;
                debugLog(`[Providers] 429/Rate Limit detected. Retrying in ${Math.round(delay + jitter)}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay + jitter));
                delay *= 2;
                continue;
            }
            throw err;
        }
    }
    throw new Error("Max retries exceeded");
}

async function generateGemini(modelName: string, prompt: string, options: GenerationOptions, recitationRetry = false): Promise<GenerationResult> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            responseMimeType: options.responseMimeType === 'application/json' ? 'application/json' : 'text/plain'
        },
        tools: options.useSearch ? ([{ googleSearch: {} }] as any) : undefined
    }, { apiVersion: "v1beta" });

    return await withRetry(async () => {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
            if (finishReason === 'MAX_TOKENS') {
                debugLog(`[Providers] Gemini hit MAX_TOKENS. Falling back to Claude (claude-sonnet-4-6)...`);
                return await generateAnthropic('claude-sonnet-4-6', prompt, options);
            }
            if (finishReason === 'RECITATION' && !recitationRetry) {
                debugLog(`[Providers] Gemini RECITATION detected. Retrying with paraphrase instruction...`);
                const augmentedPrompt = prompt + '\n\nCRITICAL: Do not quote any source text verbatim. Restate all findings, statistics and excerpts entirely in your own words. Do not reproduce copyrighted text under any circumstances.';
                return await generateGemini(modelName, augmentedPrompt, options, true);
            }
            const err: any = new Error(
                finishReason === 'RECITATION'
                    ? `Gemini blocked this generation due to RECITATION (potential copyrighted content detected). The research topic may need rephrasing.`
                    : finishReason === 'SAFETY'
                    ? `Gemini blocked this generation due to SAFETY filters.`
                    : `Gemini generation ended unexpectedly with reason: ${finishReason}`
            );
            err._nonRetryable = true;
            throw err;
        }

        return {
            text: response.text(),
        };
    });
}

async function generateOpenAI(modelName: string, prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return await withRetry(async () => {
        const response = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: "user", content: prompt }],
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            response_format: options.responseMimeType === 'application/json' ? { type: "json_object" } : undefined
        });

        return {
            text: response.choices[0].message.content || "",
            tokensUsed: response.usage?.total_tokens
        };
    });
}

async function generateAnthropic(modelName: string, prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const callAt = async (mn: string, depth = 0): Promise<GenerationResult> => {
        if (depth > 3) throw new Error("Max fallback depth exceeded for Anthropic");

        try {
            const response = await anthropic.messages.create({
                model: mn,
                max_tokens: options.maxTokens || 4096,
                messages: [{ role: "user", content: prompt }],
                temperature: options.temperature,
            });

            const text = response.content
                .filter((block: any) => block.type === 'text')
                .map((block: any) => block.text)
                .join('\n');

            return {
                text,
                tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
            };
        } catch (err: any) {
            // Centralized 404/529 Overloaded Fallback
            if (err.status === 404 || err.status === 529 || err.status === 400) {
                let fallbackModel = '';
                if (mn.includes('sonnet')) {
                    // Refined Sonnet Chain
                    if (mn === 'claude-3-5-sonnet-20241022') fallbackModel = 'claude-3-5-sonnet-latest';
                    else if (mn === 'claude-3-5-sonnet-latest') fallbackModel = 'claude-3-5-sonnet-20240620';
                    else if (mn === 'claude-3-5-sonnet-20240620') fallbackModel = 'claude-3-opus-20240229';
                } else if (mn.includes('haiku')) {
                    fallbackModel = 'claude-3-5-haiku-latest';
                }

                if (fallbackModel && fallbackModel !== mn) {
                    debugLog(`[Providers] ${mn} failed with ${err.status}. Attempting depth ${depth + 1} fallback: ${fallbackModel}`);
                    return await callAt(fallbackModel, depth + 1);
                }

                // Tier-3: Panic Fallback to Gemini if Anthropic is completely unreachable/denied
                debugLog(`[Providers] Anthropic stack exhausted after ${depth} retries. Panic falling back to GEMINI...`);
                return await generateGemini('gemini-2.0-flash', prompt, options);
            }
            throw err;
        }
    };

    return await withRetry(async () => {
        return await callAt(modelName);
    });
}

export function extractJSON(text: string): any {
    if (!text) throw new Error("Empty response received from LLM.");

    // Aggressively strip ALL markdown code blocks
    let cleaned = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();

    const tryParse = (str: string) => {
        try {
            return JSON.parse(str);
        } catch (e: any) {
            // If it fails due to control characters or line breaks, sanitize manually
            // We broaden the check to any error that might be fixed by escaping
            const msg = e.message.toLowerCase();
            if (msg.includes("control character") || msg.includes("line break") || msg.includes("unexpected token") || msg.includes("position")) {
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
                        } else if (char === '\\' && !escaped) {
                            // Check if this is a valid escape sequence next character
                            const nextChar = str[i + 1];
                            const validEscapes = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'];
                            if (!validEscapes.includes(nextChar)) {
                                // Invalid escape backslash, escape the backslash itself
                                sanitized += '\\\\';
                            } else {
                                sanitized += char;
                            }
                        } else {
                            sanitized += char;
                        }
                    } else {
                        sanitized += char;
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
                } catch (innerE: any) {
                    console.error(`[tryParse] Manual sanitization failed: ${innerE.message}`);
                    throw e; // Throw original if sanitization still fails
                }
            }
            throw e;
        }
    };

    try {
        return tryParse(cleaned);
    } catch (e: any) {
        console.error(`[extractJSON Fail] First pass fail. Snippet: ${text.substring(0, 100)}...`);
        console.error(`[extractJSON Fail] Attempting resilient recovery.`);

        // --- RESILIENT RECOVERY ---
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            let jsonPart = text.substring(firstBrace, lastBrace + 1);
            jsonPart = jsonPart.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');

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

            if (inString) jsonPart += '"';
            while (bracketCount > 0) { jsonPart += ']'; bracketCount--; }
            while (braceCount > 0) { jsonPart += '}'; braceCount--; }

            try {
                return tryParse(jsonPart);
            } catch (innerE: any) {
                console.error(`[extractJSON Fail] Resilient recovery failed: ${innerE.message}`);
            }
        }
        throw e;
    }
}
