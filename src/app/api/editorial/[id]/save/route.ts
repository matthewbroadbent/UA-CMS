import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { validateArticle } from "@/lib/validator";

export async function POST(
    req: Request,
    { params }: { params: { id: string } }
) {
    try {
        const { id } = await (params as any);
        const { content } = await req.json();

        const inquiry = await (prisma as any).weeklyInquiry.findUnique({
            where: { id },
            include: { article: true }
        });

        if (!inquiry || !inquiry.article) {
            return NextResponse.json({ error: "Article not found" }, { status: 404 });
        }

        // On save, we also re-validate
        const validation = validateArticle(content, {
            researchPack: {},
            spineContract: {}
        });

        const updated = await (prisma as any).article.update({
            where: { id: inquiry.article.id },
            data: {
                finalContent: content,
                validationReport: JSON.stringify(validation)
            }
        });

        return NextResponse.json({
            message: "Article saved successfully.",
            validation
        });
    } catch (error: any) {
        console.error("[SAVE_ARTICLE_ERROR]", error);
        return NextResponse.json({
            error: "Failed to save article. Server-side exception.",
            details: error.message
        }, { status: 500 });
    }
}
