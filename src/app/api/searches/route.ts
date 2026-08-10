import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { PROVIDERS } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const searches = await prisma.savedSearch.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { jobs: true } } },
  });
  return NextResponse.json({ searches });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    keywords?: string;
    location?: string;
    remoteOnly?: boolean;
    providers?: string[];
    minMatch?: number | null;
  };

  const keywords = body.keywords?.trim();
  if (!keywords) {
    return NextResponse.json({ error: "Give the search some keywords." }, { status: 400 });
  }

  const known = new Set(PROVIDERS.map((p) => p.id));
  const providers = (body.providers ?? []).filter((id) => known.has(id));

  const search = await prisma.savedSearch.create({
    data: {
      name: body.name?.trim() || keywords,
      keywords,
      location: body.location?.trim() || null,
      remoteOnly: Boolean(body.remoteOnly),
      providers: providers.length ? JSON.stringify(providers) : null,
      minMatch:
        typeof body.minMatch === "number" && body.minMatch > 0
          ? Math.min(100, Math.round(body.minMatch))
          : null,
    },
  });

  return NextResponse.json({ search }, { status: 201 });
}
