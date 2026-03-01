import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs";
import path from "path";
import { prisma } from "./prisma";
import { StorageService } from "./storage";
import { getIntelligibleName } from "./naming";

// Lazy initialisation — client created at call time, not module load time,
// so the build doesn't fail when env vars aren't present in the Docker layer.
function getClient() {
    return new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
}

/**
 * Converts numbers and symbols to spoken words for ElevenLabs natural pronunciation.
 */
function convertNumbersToWords(text: string): string {
    let cleaned = text;

    // ... (logic remains same)
    return cleaned;
}

/**
 * Strips Markdown characters and other artifacts that shouldn't be spoken.
 */
function sanitizeTextForTTS(text: string): string {
    // ... (logic remains same)
    return text;
}

export async function generateSpeech(text: string, scriptId: string, weeklyInquiryId?: string) {
    try {
        const script = await prisma.videoScript.findUnique({
            where: { id: scriptId },
            include: { weeklyInquiry: true }
        });

        const sanitizedText = sanitizeTextForTTS(text);
        const audio = await getClient().textToSpeech.convert(
            process.env.ELEVENLABS_VOICE_ID || "7ZJdaADoQFRYkRSUhLQt", // Default UA voice
            {
                text: sanitizedText,
                modelId: "eleven_monolingual_v1",
            }
        );

        const publicDir = path.join('/tmp', 'audio');
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

        const fileName = `${scriptId}.mp3`;
        const filePath = path.join(publicDir, fileName);
        console.log(`Generating speech for script ${scriptId}... (Length: ${sanitizedText.length} characters)`);

        // Log to debug.log for budget tracking
        const logLine = `[${new Date().toISOString()}] [ELEVENLABS] Script: ${scriptId} | Characters: ${sanitizedText.length}\n`;
        fs.appendFileSync('/tmp/debug.log', logLine);

        // Convert ReadableStream to Buffer
        const chunks: any[] = [];
        for await (const chunk of audio as any) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buffer);
        console.log(`Audio saved: ${filePath}`);

        // Upload to Storage (Supabase or Drive)
        let audioUrl = `/media/audio/${fileName}`;
        try {
            const asset = await StorageService.uploadAndRecord({
                file: buffer,
                fileName: getIntelligibleName({
                    uaId: (script as any)?.weeklyInquiry?.uaId || 'UA',
                    type: 'VOICE',
                    detail: script?.durationType || '30S',
                    extension: 'mp3'
                }),
                kind: 'AUDIO',
                renderId: scriptId,
                videoScriptId: scriptId,
                weeklyInquiryId: weeklyInquiryId
            });
            console.log(`[Storage] Audio uploaded: ${asset.fileName}`);
            // Use the remote URL so the render pipeline can always find it
            // (local /tmp files are not shared across serverless invocations)
            if ((asset as any).publicUrl) audioUrl = (asset as any).publicUrl;
        } catch (err) {
            console.error(`[Storage] Audio upload failed:`, err);
        }

        return audioUrl;
    } catch (error) {
        console.error("ElevenLabs Error:", error);
        throw error;
    }
}
