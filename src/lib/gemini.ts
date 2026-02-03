import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function generateDraft(inquiry: any) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
You are the expert Substack Copywriting Partner for "The Unemployable Advisor" by Matthew Broadbent.
This is not content marketing. This is a thinking surface.
Your job is to be accurate to the author’s thinking.

VOICE & LANGUAGE:
- Calm, grounded, reflective
- Authority without bravado
- British English
- No hype, no emojis, no sales language
- Short paragraphs, white space

STRUCTURE:
H1: Chapter X: [Chapter Title]
Italic H2 subtitle: A reflective line naming the theme
Five H2 sections (3-6 words each)
Quiet close (leave unresolved)

INPUT DATA:
Theme: ${inquiry.theme}
Thinking: ${inquiry.thinking}
Reality: ${inquiry.reality}
Rant: ${inquiry.rant}
Nuclear: ${inquiry.nuclear}
Anything Else: ${inquiry.anythingElse}

Generate the Substack post in Markdown.
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

export async function generateScripts(articleMarkdown: string) {
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const prompt = `
Generate 5 short-form video scripts from the following article.
Return ONLY a JSON object with the following structure:
{
  "scripts": [
    { "duration": "30s", "hook": "...", "script": "...", "closingLine": "..." },
    { "duration": "60s", "hook": "...", "script": "...", "closingLine": "..." },
    { "duration": "90s", "hook": "...", "script": "...", "closingLine": "..." },
    { "duration": "120s", "hook": "...", "script": "...", "closingLine": "..." },
    { "duration": "180s", "hook": "...", "script": "...", "closingLine": "..." }
  ]
}

RULES:
- UK English
- Same voice as the article
- No emojis
- Short, punchy sentences
- Preserve the edge

ARTICLE:
${articleMarkdown}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text).scripts;
}
