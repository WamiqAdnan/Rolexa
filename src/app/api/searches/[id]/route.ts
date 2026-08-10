import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { PROVIDERS } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    keywords?: string;
    location?: string | null;
    remoteOnly?: boolean;
    providers?: string[];
    minMatch?: number | null;
    isActive?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim() || "Untitled search";
  if (body.keywords !== undefined) {
    const keywords = body.keywords.trim();
    if (!keywords) {
      return NextResponse.json({ error: "Give the search some keywords." }, { status: 400 });
    }
    data.keywords = keywords;
  }
  if (body.location !== undefined) data.location = body.location?.trim() || null;
  if (body.remoteOnly !== undefined) data.remoteOnly = Boolean(body.remoteOnly);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.providers !== undefined) {
    const known = new Set(PROVIDERS.map((p) => p.id));
    const providers = body.providers.filter((p) => known.has(p));
    data.providers = providers.length ? JSON.stringify(providers) : null;
  }
  if (body.minMatch !== undefined) {
    data.minMatch =
      typeof body.minMatch === "number" && body.minMatch > 0
        ? Math.min(100, Math.round(body.minMatch))
        : null;
  }

  const search = await prisma.savedSearch
    .update({ where: { id }, data })
    .catch(() => null);
  if (!search) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ search });
}

/**
 * Deleting a search keeps the jobs it found — they're yours now, and some may
 * already be applications. `Job.savedSearchId` is nulled by the relation.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.savedSearch.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
