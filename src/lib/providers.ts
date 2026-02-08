import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

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

async function generateGemini(modelName: string, prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            responseMimeType: options.responseMimeType === 'application/json' ? 'application/json' : 'text/plain'
        },
        tools: options.useSearch ? [{ googleSearchRetrieval: {} }] : undefined
    }, { apiVersion: "v1beta" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return {
        text: response.text(),
    };
}

async function generateOpenAI(modelName: string, prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
}

async function generateAnthropic(modelName: string, prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: options.maxTokens || 4096,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature,
    });

    const text = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('\n');

    return {
        text,
        tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
    };
}
