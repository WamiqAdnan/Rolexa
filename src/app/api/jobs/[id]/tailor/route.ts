import { NextResponse } from "next/server";

import { json, prisma } from "@/lib/db";
import { loadMasterProfile } from "@/lib/master-profile";
import { loadCvsForMatching } from "@/lib/pipeline";
import { tailorCv } from "@/lib/tailor";
import type { JobAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tailoring is one long model call; give it room.
export const maxDuration = 300;

/**
 * Generate a tailored CV for this job and store it as a new version under the
 * base CV. The original is never touched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { cvId?: string };

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "READY" || !job.analysis) {
    return NextResponse.json(
      { error: "This job has not been analysed yet." },
      { status: 409 },
    );
  }

  const analysis = json<JobAnalysis | null>(job.analysis, null);
  if (!analysis) {
    return NextResponse.json({ error: "The stored analysis is unreadable — re-analyse the job." }, { status: 409 });
  }

  const baseCvId = body.cvId || analysis.recommendedCvId;
  if (!baseCvId) {
    return NextResponse.json({ error: "No CV to tailor from." }, { status: 400 });
  }

  const [cvs, profile] = await Promise.all([loadCvsForMatching(), loadMasterProfile()]);
  const baseCv = cvs.find((c) => c.id === baseCvId);
  if (!baseCv) {
    return NextResponse.json(
      { error: "That CV is not processed yet." },
      { status: 409 },
    );
  }

  try {
    const result = await tailorCv({
      baseCv,
      allCvs: cvs,
      profile,
      analysis,
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
      },
    });

    const existing = await prisma.cvVersion.count({
      where: { cvId: baseCv.id, kind: "TAILORED" },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const label =
      `${job.title}${job.company ? ` @ ${job.company}` : ""} - ${stamp}` +
      (existing ? ` (${existing + 1})` : "");

    const version = await prisma.cvVersion.create({
      data: {
        cvId: baseCv.id,
        jobId: job.id,
        kind: "TAILORED",
        label: label.slice(0, 160),
        content: result.markdown,
        generator: result.generator,
        changes: JSON.stringify({
          changesMade: result.changesMade,
          notAdded: result.notAdded,
          warnings: result.warnings,
        }),
      },
    });

    return NextResponse.json({ version, result }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
