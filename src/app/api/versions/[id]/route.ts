import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const version = await prisma.cvVersion.findUnique({
    where: { id },
    include: { cv: { select: { name: true } } },
  });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ?download=1 returns the markdown as a file.
  if (new URL(request.url).searchParams.get("download")) {
    const safe = `${version.cv.name} - ${version.label}`
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 120);
    return new NextResponse(version.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}.md"`,
      },
    });
  }

  return NextResponse.json({ version });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const version = await prisma.cvVersion.findUnique({ where: { id } });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (version.kind === "ORIGINAL") {
    return NextResponse.json(
      { error: "The original version cannot be deleted." },
      { status: 403 },
    );
  }
  await prisma.cvVersion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
