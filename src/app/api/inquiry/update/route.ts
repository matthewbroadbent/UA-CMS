import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    try {
        const { id, theme, thinking, reality, rant, nuclear, anythingElse } = await req.json();

        if (!id) {
            return NextResponse.json({ error: "Missing inquiry ID" }, { status: 400 });
        }

        const updated = await prisma.weeklyInquiry.update({
            where: { id },
            data: {
                theme,
                thinking,
                reality,
                rant,
                nuclear,
                anythingElse,
            },
        });

        return NextResponse.json(updated);
    } catch (e: any) {
        console.error("Failed to update inquiry:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
