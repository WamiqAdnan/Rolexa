import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { rebuildMasterProfile } from "@/lib/master-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const cv = await prisma.cv.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: "asc" } } },
  });
  if (!cv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ cv });
}

/** Rename a CV, or set its target role / industry. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    targetRole?: string | null;
    industry?: string | null;
  };

  const data: Record<string, string | null> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    data.name = name.slice(0, 120);
  }
  if ("targetRole" in body) data.targetRole = body.targetRole?.trim() || null;
  if ("industry" in body) data.industry = body.industry?.trim() || null;

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const cv = await prisma.cv.update({ where: { id }, data });

  // The CV name is the evidence label everywhere, and target role/industry feed
  // the profile, so keep the profile in step.
  await rebuildMasterProfile();

  return NextResponse.json({ cv });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const cv = await prisma.cv.findUnique({ where: { id } });
  if (!cv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.cv.delete({ where: { id } });
  await unlink(cv.storedPath).catch(() => {
    /* file already gone — nothing to clean up */
  });
  await rebuildMasterProfile();

  return NextResponse.json({ ok: true });
}
