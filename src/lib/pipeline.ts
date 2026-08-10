import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { json, prisma } from "./db";
import { extractCv } from "./extract";
import { extractText } from "./extract/text";
import { analyzeJob, type CvForMatching } from "./job-match";
import { loadMasterProfile, rebuildMasterProfile } from "./master-profile";
import type { CvExtraction, JobAnalysis } from "./types";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function saveUpload(file: File): Promise<{
  storedPath: string;
  sizeBytes: number;
}> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.name) || "";
  const storedPath = path.join(UPLOAD_DIR, `${randomUUID()}${ext}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(storedPath, bytes);
  return { storedPath, sizeBytes: bytes.length };
}

/**
 * Parse and extract one CV, then refresh the master profile.
 *
 * Runs detached from the upload request so the UI can show progress; status
 * transitions are written to the row as it goes.
 */
export async function processCv(cvId: string): Promise<void> {
  const cv = await prisma.cv.findUnique({ where: { id: cvId } });
  if (!cv) return;

  try {
    await prisma.cv.update({
      where: { id: cvId },
      data: { status: "PARSING", error: null },
    });

    const text = await extractText(cv.storedPath, cv.mimeType, cv.fileName);

    await prisma.cv.update({
      where: { id: cvId },
      data: { status: "EXTRACTING", parsedText: text },
    });

    const { extraction, extractedBy, note } = await extractCv(text);

    await prisma.cv.update({
      where: { id: cvId },
      data: {
        status: "READY",
        extraction: JSON.stringify(extraction),
        extractedBy,
        error: note ?? null,
      },
    });

    // Keep the ORIGINAL version in sync with what was parsed, creating it the
    // first time. Tailored versions are never touched.
    const original = await prisma.cvVersion.findFirst({
      where: { cvId, kind: "ORIGINAL" },
    });
    if (original) {
      await prisma.cvVersion.update({
        where: { id: original.id },
        data: { content: text },
      });
    } else {
      await prisma.cvVersion.create({
        data: { cvId, kind: "ORIGINAL", label: "Original", content: text },
      });
    }

    await rebuildMasterProfile();
  } catch (err) {
    await prisma.cv.update({
      where: { id: cvId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/** Every processed CV, in the shape the matcher and tailorer want. */
export async function loadCvsForMatching(): Promise<CvForMatching[]> {
  const rows = await prisma.cv.findMany({
    where: { status: "READY", extraction: { not: null } },
    orderBy: { uploadedAt: "asc" },
  });
  return rows.map((cv) => ({
    id: cv.id,
    name: cv.name,
    parsedText: cv.parsedText ?? "",
    extraction: json<CvExtraction>(cv.extraction, {} as CvExtraction),
  }));
}

export async function processJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "ANALYZING", error: null },
    });

    const [cvs, profile] = await Promise.all([loadCvsForMatching(), loadMasterProfile()]);

    if (!cvs.length) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error: "No processed CVs yet. Upload at least one CV, then re-analyse.",
        },
      });
      return;
    }

    const analysis: JobAnalysis = await analyzeJob(
      {
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
      },
      cvs,
      profile,
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "READY",
        analysis: JSON.stringify(analysis),
        professionalMatch: analysis.professionalMatch,
        cvMatch: analysis.cvMatch,
        recommendedCvId: analysis.recommendedCvId,
        recommendedCvName: analysis.recommendedCvName,
        analyzedBy: analysis.analyzedBy,
      },
    });
  } catch (err) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/** Fire-and-forget a background step without leaving an unhandled rejection. */
export function detach(work: Promise<unknown>): void {
  void work.catch((err) => {
    console.error("[rolexa] background task failed:", err);
  });
}
