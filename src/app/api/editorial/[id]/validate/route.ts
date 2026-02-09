import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { validateArticle } from "@/lib/validator";
import fs from 'fs';

function debugLog(msg: string) {
    const time = new Date().toISOString();
    try {
        fs.appendFileSync('debug.log', `[${time}] ${msg}\n`);
    } catch (e) {
        console.error('Failed to write to debug.log', e);
    }
}

export async function POST(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        const { id } = await (params as any);
        const { content } = await req.json();

        if (!content) {
            return NextResponse.json({ error: "Content is required for validation." }, { status: 400 });
        }

        const inquiry = await (prisma as any).weeklyInquiry.findUnique({
            where: { id },
            include: { article: true }
        });

        if (!inquiry || !inquiry.article) {
            return NextResponse.json({ error: "Article not found" }, { status: 404 });
        }

        const validation = validateArticle(content, {
            researchPack: {},
            spineContract: {}
        });

        await (prisma as any).article.update({
            where: { id: inquiry.article.id },
            data: {
                validationReport: JSON.stringify(validation)
            }
        });

        return NextResponse.json({ validation });
    } catch (error: any) {
        debugLog(`[REFRESH_AUDIT_ERROR] ${error.message} \nStack: ${error.stack}`);
        console.error("[REFRESH_AUDIT_ERROR]", error);
        return NextResponse.json({
            error: "Failed to refresh audit. Server-side exception.",
            details: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
