import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { applyEditorialSanitization } from "@/lib/editorial";
import { validateArticle } from "@/lib/validator";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await (params as any); // Next.js 15/16 compat
        const inquiry = await (prisma as any).weeklyInquiry.findUnique({
            where: { id },
            include: { article: true }
        });

        if (!inquiry || !inquiry.article) {
            return NextResponse.json({ error: "Article not found" }, { status: 404 });
        }

        const currentContent = inquiry.article.finalContent || inquiry.article.draftContent;
        const sanitized = applyEditorialSanitization(currentContent);

        // Check if anything actually changed
        if (sanitized === currentContent) {
            return NextResponse.json({ message: "No fixes required.", changed: false });
        }

        // Re-validate after fixing
        const validation = validateArticle(sanitized, {
            researchPack: {}, // In a real scenario, we'd fetch the research pack too
            spineContract: {}
        });

        const updated = await (prisma as any).article.update({
            where: { id: inquiry.article.id },
            data: {
                draftContent: sanitized,
                validationReport: JSON.stringify(validation)
            }
        });

        return NextResponse.json({
            message: "System fixes applied successfully.",
            changed: true,
            content: sanitized,
            validation
        });
    } catch (error: any) {
        console.error("[FIX_ARTICLE_ERROR]", error);
        return NextResponse.json({
            error: "Failed to apply system fixes. Server-side exception.",
            details: error.message
        }, { status: 500 });
    }
}
