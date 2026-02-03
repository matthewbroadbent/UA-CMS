import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const items = await prisma.weeklyInquiry.findMany({
            include: {
                article: true,
                scripts: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return NextResponse.json(items);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
