import { ElevenLabsClient } from "elevenlabs";
import fs from "fs";
import path from "path";

const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

export async function generateSpeech(text: string, scriptId: string) {
    try {
        const audio = await client.textToSpeech.convert(
            process.env.ELEVENLABS_VOICE_ID || "uesuxleIgmNYCdwNrW9s", // Default UA voice
            {
                text: text,
                model_id: "eleven_monolingual_v1",
            }
        );

        const publicDir = path.join(process.cwd(), "public", "media", "audio");
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

        const fileName = `${scriptId}.mp3`;
        const filePath = path.join(publicDir, fileName);

        // Convert ReadableStream to Buffer
        const chunks: any[] = [];
        for await (const chunk of audio as any) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buffer);

        return `/media/audio/${fileName}`;
    } catch (error) {
        console.error("ElevenLabs Error:", error);
        throw error;
    }
}
