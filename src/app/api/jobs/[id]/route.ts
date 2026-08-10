import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { detach, processJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      sources: { orderBy: { firstSeenAt: "asc" } },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

const APPLICATION_STATUSES = new Set([
  "NEW",
  "SHORTLISTED",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "REJECTED",
  "DISCARDED",
]);

/** Where you are with this job, and which CV you actually sent. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json()) as {
    applicationStatus?: string;
    appliedVersionId?: string | null;
    notes?: string | null;
  };

  const data: Record<string, unknown> = {};

  if (body.applicationStatus !== undefined) {
    if (!APPLICATION_STATUSES.has(body.applicationStatus)) {
      return NextResponse.json({ error: "Unknown application status." }, { status: 400 });
    }
    data.applicationStatus = body.applicationStatus;

    // Stamp the date the first time it's marked applied, and clear it if the
    // status is walked back to something before applying.
    const current = await prisma.job.findUnique({
      where: { id },
      select: { appliedAt: true },
    });
    const isApplied = ["APPLIED", "INTERVIEWING", "OFFER", "REJECTED"].includes(
      body.applicationStatus,
    );
    if (isApplied && !current?.appliedAt) data.appliedAt = new Date();
    if (!isApplied) data.appliedAt = null;
  }

  if (body.appliedVersionId !== undefined) data.appliedVersionId = body.appliedVersionId;
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;

  const job = await prisma.job.update({ where: { id }, data }).catch(() => null);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ job });
}

/** Re-run the analysis, e.g. after uploading another CV. */
export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.job.update({ where: { id }, data: { status: "PENDING", error: null } });
  detach(processJob(id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.job.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
