import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { detach, processCv } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-parse and re-extract a CV — useful after adding an API key. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cv = await prisma.cv.findUnique({ where: { id } });
  if (!cv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.cv.update({
    where: { id },
    data: { status: "PENDING", error: null },
  });
  detach(processCv(id));

  return NextResponse.json({ ok: true });
}
