import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function planScenes(scriptId: string) {
    const script = await prisma.videoScript.findUnique({
        where: { id: scriptId },
        include: { weeklyInquiry: true }
    });

    if (!script) throw new Error("Script not found");

    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
You are a high-end Business Documentary Director and Prompt Engineer. 
Your style is professional, modern, authoritative, and cinematic (BBC Documentary / FT standard).

TASK:
Break this script into a visual shot list.
For each scene, write a highly detailed "Agentic Prompt" optimized for high-end models like Flux or Midjourney.

PROMPT RULES:
- Use cinematic lighting terms (rembrandt lighting, volumetric fog, anamorphic lens).
- Specify camera angles (low angle, wide shot, extreme close up).
- Ensure a consistent aesthetic: Moody, corporate but human, high contrast, professional color grading.
- For VIDEO: Describe movement (slow zoom, pan, tracking shot).
- For IMAGE: Describe texture and depth (shallow depth of field, 8k resolution, photorealistic).

SCRIPT:
${script.hook}
${script.script}
${script.closingLine}

RETURN JSON:
{
  "scenes": [
    {
      "index": 0,
      "type": "VIDEO", 
      "duration": 5.0,
      "prompt": "Cinematic low-angle tracking shot through a minimalist glass-walled boardroom. Volumetric sunlight streaming through floor-to-ceiling windows. Dust motes dancing in the light. 8k, highly detailed, photorealistic, Arri Alexa style."
    }
  ]
}
`;

    const result = await model.generateContent(prompt);
    const data = JSON.parse(result.response.text());

    // Save scenes to DB
    await prisma.scene.deleteMany({ where: { videoScriptId: scriptId } });

    await prisma.scene.createMany({
        data: data.scenes.map((s: any) => ({
            videoScriptId: scriptId,
            index: s.index,
            type: s.type,
            duration: s.duration,
            prompt: s.prompt,
            status: "PENDING"
        }))
    });

    return data.scenes;
}

export async function generateMediaAsset(sceneId: string) {
    const scene = await prisma.scene.findUnique({
        where: { id: sceneId }
    });

    if (!scene) return;

    const FAL_KEY = process.env.FAL_KEY;
    const modelUrl = scene.type === 'VIDEO'
        ? "https://queue.fal.run/fal-ai/veo3/fast"
        : "https://queue.fal.run/fal-ai/flux/schnell";

    // Here we would call Fal.ai API
    // For now, simulating success
    console.log(`Generating ${scene.type} for prompt: ${scene.prompt}`);
}
