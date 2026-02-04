import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs";
import path from "path";

const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

/**
 * Strips Markdown characters and other artifacts that shouldn't be spoken.
 */
function sanitizeTextForTTS(text: string): string {
    return text.replace(/\*/g, '').trim();
}

export async function generateSpeech(text: string, scriptId: string) {
    try {
        const sanitizedText = sanitizeTextForTTS(text);
        const audio = await client.textToSpeech.convert(
            process.env.ELEVENLABS_VOICE_ID || "uesuxleIgmNYCdwNrW9s", // Default UA voice
            {
                text: sanitizedText,
                modelId: "eleven_monolingual_v1",
            }
        );

        const publicDir = path.join(process.cwd(), "public", "media", "audio");
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

        const fileName = `${scriptId}.mp3`;
        const filePath = path.join(publicDir, fileName);
        console.log(`Generating speech for script ${scriptId}...`);

        // Convert ReadableStream to Buffer
        const chunks: any[] = [];
        for await (const chunk of audio as any) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buffer);
        console.log(`Audio saved: ${filePath}`);

        return `/media/audio/${fileName}`;
    } catch (error) {
        console.error("ElevenLabs Error:", error);
        throw error;
    }
}
