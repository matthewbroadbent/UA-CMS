import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PROMPTS } from '@/lib/prompts';

export async function GET() {
    try {
        const dbPrompts = await (prisma as any).prompt.findMany({
            where: { isActive: true }
        });

        // Merge DB prompts with static defaults
        const allPrompts = { ...PROMPTS };
        dbPrompts.forEach((p: any) => {
            (allPrompts as any)[p.key] = p.content;
        });

        return NextResponse.json(allPrompts);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { key, content, name } = await req.json();

        if (!key || !content) {
            return NextResponse.json({ error: 'Key and content are required' }, { status: 400 });
        }

        const p = prisma as any;

        // Deactivate existing active prompt for this key
        await p.prompt.updateMany({
            where: { key, isActive: true },
            data: { isActive: false }
        });

        // Determine stage for categorization
        let stage = 1;
        if (key.includes('STAGE_2')) stage = 2;
        if (key === 'VIDEO_SCRIPTS') stage = 3;

        // Create new active prompt (versioning)
        const updated = await p.prompt.create({
            data: {
                key,
                content,
                name: name || `v${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
                isActive: true,
                stage
            },
        });

        return NextResponse.json(updated);
    } catch (error: any) {
        console.error('Prompt POST error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
