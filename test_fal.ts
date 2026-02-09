import { fal } from "@fal-ai/client";
import dotenv from "dotenv";
dotenv.config();

async function testFal() {
    console.log("Testing Fal Key:", process.env.FAL_KEY?.substring(0, 5) + "...");
    try {
        const result = await fal.subscribe("fal-ai/flux/schnell", {
            input: { prompt: "A simple red dot." }
        });
        console.log("Success:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Diagnostic Failed:", e);
    }
}

testFal();
