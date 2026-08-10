import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { detach, processJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ranked by fit, because a fetched feed is long and a pasted list is not. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("applicationStatus");
  const sort = url.searchParams.get("sort") ?? "match";

  const jobs = await prisma.job.findMany({
    where: status && status !== "ALL" ? { applicationStatus: status } : undefined,
    orderBy:
      sort === "newest"
        ? [{ createdAt: "desc" }]
        : // Unscored jobs sort last rather than first: a null match is "we don't
          // know yet", not "bad fit".
          [{ professionalMatch: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      createdAt: true,
      status: true,
      error: true,
      professionalMatch: true,
      cvMatch: true,
      recommendedCvId: true,
      recommendedCvName: true,
      applicationStatus: true,
      appliedAt: true,
      origin: true,
      url: true,
      salary: true,
      remote: true,
      postedAt: true,
      sources: {
        select: { id: true, provider: true, providerName: true, url: true },
        orderBy: { firstSeenAt: "asc" },
      },
    },
  });

  const counts = await prisma.job.groupBy({
    by: ["applicationStatus"],
    _count: { _all: true },
  });

  return NextResponse.json({
    jobs,
    counts: Object.fromEntries(counts.map((c) => [c.applicationStatus, c._count._all])),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    company?: string;
    location?: string;
    source?: string;
    description?: string;
  };

  const title = body.title?.trim();
  const description = body.description?.trim();

  if (!title) return NextResponse.json({ error: "A job title is required." }, { status: 400 });
  if (!description || description.length < 40) {
    return NextResponse.json(
      { error: "Paste the job description — at least a few lines are needed to analyse it." },
      { status: 400 },
    );
  }

  const job = await prisma.job.create({
    data: {
      title,
      company: body.company?.trim() || null,
      location: body.location?.trim() || null,
      source: body.source?.trim() || null,
      description,
      status: "PENDING",
    },
  });

  detach(processJob(job.id));

  return NextResponse.json({ job }, { status: 201 });
}
