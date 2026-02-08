import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs";
import path from "path";
import { StorageService } from "./storage";

const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

/**
 * Converts numbers and symbols to spoken words for ElevenLabs natural pronunciation.
 */
function convertNumbersToWords(text: string): string {
    let cleaned = text;

    // 1. Currencies (e.g., £5.5m -> five point five million pounds)
    cleaned = cleaned.replace(/£(\d+(?:\.\d+)?)\s*m/gi, '$1 million pounds');
    cleaned = cleaned.replace(/£(\d+(?:\.\d+)?)\s*b/gi, '$1 billion pounds');
    cleaned = cleaned.replace(/£(\d+(?:\.\d+)?)/gi, '$1 pounds');

    // 2. Percentages (e.g., 6.5% -> six point five per cent)
    cleaned = cleaned.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 per cent');

    // 3. Multiples (e.g., 10x -> ten times)
    cleaned = cleaned.replace(/(\d+)\s*x\b/gi, '$1 times');

    // 4. Decimals (e.g., 6.5 -> six point five)
    // We only replace if it's a number.
    cleaned = cleaned.replace(/(\d+)\.(\d+)/g, '$1 point $2');

    // Note: We leave the raw numbers for ElevenLabs to handle standard integers, 
    // but the symbols above are the most common points of failure for "literal" reading.
    return cleaned;
}

/**
 * Strips Markdown characters and other artifacts that shouldn't be spoken.
 * Also performs systematic number-to-words conversion.
 */
function sanitizeTextForTTS(text: string): string {
    let cleaned = text.replace(/\*/g, '').trim();
    cleaned = convertNumbersToWords(cleaned);
    return cleaned;
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

        // Upload to Storage (Supabase or Drive)
        try {
            const asset = await StorageService.uploadAndRecord({
                file: buffer,
                fileName: `${scriptId}_audio.mp3`,
                kind: 'AUDIO',
                renderId: scriptId,
                videoScriptId: scriptId
            });
            console.log(`[Storage] Audio uploaded via ${asset.provider}: ${asset.fileName}`);
        } catch (err) {
            console.error(`[Storage] Audio upload failed:`, err);
        }

        return `/media/audio/${fileName}`;
    } catch (error) {
        console.error("ElevenLabs Error:", error);
        throw error;
    }
}
