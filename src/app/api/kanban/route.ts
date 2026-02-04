import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Forced rebuild to refresh Prisma client
export async function GET() {
    try {
        const items = await prisma.weeklyInquiry.findMany({
            include: {
                article: true,
                scripts: {
                    include: {
                        scenes: {
                            orderBy: {
                                index: 'asc'
                            }
                        }
                    }
                },
                generationRuns: {
                    include: {
                        outputs: true
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return NextResponse.json(items);
    } catch (error: any) {
        console.error('API Error /api/kanban:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
