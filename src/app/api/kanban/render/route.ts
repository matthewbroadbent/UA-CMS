import { NextResponse } from 'next/server';
import { runRenderPipeline } from '@/lib/pipeline';

export const maxDuration = 800; // Vercel Pro: allow background render pipeline to complete

export async function POST(req: Request) {
    try {
        const { scriptId, aspectRatio } = await req.json();
        if (!scriptId) return NextResponse.json({ error: 'Missing scriptId' }, { status: 400 });

        console.log(`[API] Final Render Request: ${scriptId} | Aspect Ratio: ${aspectRatio || 'default'}`);

        // Non-blocking trigger
        runRenderPipeline(scriptId, aspectRatio).catch(err => {
            console.error('Background Render Pipeline Error:', err);
        });

        return NextResponse.json({ success: true, message: 'Final render initiated' });
    } catch (error: any) {
        console.error('[API] Render Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
