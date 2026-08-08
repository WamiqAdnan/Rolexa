import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the original, untouched upload. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cv = await prisma.cv.findUnique({ where: { id } });
  if (!cv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await readFile(cv.storedPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": cv.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(cv.fileName)}"`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "The original file is missing from disk." },
      { status: 410 },
    );
  }
}
