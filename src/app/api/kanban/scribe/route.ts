import { NextResponse } from 'next/server';
import { runMediaPipeline } from '@/lib/pipeline';

export const maxDuration = 800; // Vercel Pro: allow up to 800s for media pipeline

export async function POST(req: Request) {
    try {
        const { id, scriptIds } = await req.json();
        if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

        console.log(`[API] Manual Scribe Request: ${id}. Selected scripts: ${scriptIds?.length || 'all'}`);

        // We now await this since it's a manual trigger and we want to know if it finished for UI refresh
        await runMediaPipeline(id, scriptIds);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[API] Scribe Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
