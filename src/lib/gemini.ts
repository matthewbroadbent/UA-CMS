import { prisma } from "@/lib/prisma";
import { PROMPTS, buildPrompt } from "./prompts";
import { generateContent } from "./providers";

export async function generateScripts(articleMarkdown: string) {
    // Try to get custom active prompt from DB
    let template = PROMPTS.VIDEO_SCRIPTS;
    try {
        const p = prisma as any;
        const dbPrompt = await p.prompt.findFirst({
            where: { key: 'VIDEO_SCRIPTS', isActive: true },
            orderBy: { updatedAt: 'desc' }
        });
        if (dbPrompt?.content) template = dbPrompt.content;
    } catch (e) {
        console.warn("Could not fetch VIDEO_SCRIPTS from DB, using default.", e);
    }

    const prompt = buildPrompt(template, {
        article: articleMarkdown
    });

    const result = await generateContent('GEMINI', 'gemini-2.0-flash', prompt, {
        responseMimeType: 'application/json'
    });

    const text = result.text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(text).scripts;
}
