import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const data = await req.json();

        const inquiry = await prisma.weeklyInquiry.create({
            data: {
                uaId: data.uaId,
                theme: data.theme,
                thinking: data.thinking,
                reality: data.reality,
                rant: data.rant,
                nuclear: data.nuclear,
                anythingElse: data.anythingElse,
                status: 'PENDING'
            }
        });

        return NextResponse.json(inquiry);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
