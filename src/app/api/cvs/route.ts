import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { classify } from "@/lib/extract/text";
import { detach, processCv, saveUpload } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cvs = await prisma.cv.findMany({
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      name: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedAt: true,
      targetRole: true,
      industry: true,
      status: true,
      error: true,
      extractedBy: true,
      _count: { select: { versions: true } },
    },
  });
  return NextResponse.json({ cvs });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  }

  const created: { id: string; name: string }[] = [];
  const rejected: { fileName: string; reason: string }[] = [];

  for (const file of files) {
    if (classify(file.type, file.name) === "other") {
      rejected.push({ fileName: file.name, reason: "Only PDF, DOCX and TXT files are supported." });
      continue;
    }
    if (file.size > 20 * 1024 * 1024) {
      rejected.push({ fileName: file.name, reason: "File is larger than 20 MB." });
      continue;
    }

    const { storedPath, sizeBytes } = await saveUpload(file);
    const cv = await prisma.cv.create({
      data: {
        name: defaultName(file.name),
        fileName: file.name,
        storedPath,
        mimeType: file.type || "application/octet-stream",
        sizeBytes,
        targetRole: asString(form.get("targetRole")),
        industry: asString(form.get("industry")),
        status: "PENDING",
      },
    });
    created.push({ id: cv.id, name: cv.name });
    detach(processCv(cv.id));
  }

  return NextResponse.json({ created, rejected }, { status: created.length ? 201 : 400 });
}

function asString(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/** "Senior_Data-Analyst CV (final v2).pdf" -> "Senior Data Analyst CV" */
function defaultName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base
    .replace(/[_-]+/g, " ")
    .replace(/\((?:final|v\d+|copy|updated?)[^)]*\)/gi, "")
    .replace(/\b(final|copy|updated?|v\d+|\d{4}-\d{2}-\d{2})\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = cleaned || base || "Untitled CV";
  return name.length > 80 ? `${name.slice(0, 77)}...` : name;
}
