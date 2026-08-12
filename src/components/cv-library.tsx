"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Card, Empty, Pill, SectionTitle, StatusPill } from "@/components/ui";

type CvRow = {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  targetRole: string | null;
  industry: string | null;
  status: string;
  error: string | null;
  extractedBy: string | null;
  _count: { versions: number };
};

const BUSY = new Set(["PENDING", "PARSING", "EXTRACTING"]);

export function CvLibrary() {
  const [cvs, setCvs] = useState<CvRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [industry, setIndustry] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cvs", { cache: "no-store" });
    const data = (await res.json()) as { cvs: CvRow[] };
    setCvs(data.cvs);
    return data.cvs;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Processing happens in the background, so poll while anything is in flight.
  useEffect(() => {
    if (!cvs?.some((cv) => BUSY.has(cv.status))) return;
    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [cvs, load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);

    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    if (targetRole.trim()) form.append("targetRole", targetRole.trim());
    if (industry.trim()) form.append("industry", industry.trim());

    try {
      const res = await fetch("/api/cvs", { method: "POST", body: form });
      const data = (await res.json()) as {
        created?: { id: string }[];
        rejected?: { fileName: string; reason: string }[];
        error?: string;
      };
      if (data.error) setMessage(data.error);
      else if (data.rejected?.length) {
        setMessage(
          data.rejected.map((r) => `${r.fileName}: ${r.reason}`).join(" · "),
        );
      }
      if (data.created?.length) {
        setTargetRole("");
        setIndustry("");
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function rename(cv: CvRow) {
    const name = window.prompt("Rename this CV", cv.name);
    if (name === null || name.trim() === cv.name) return;
    await fetch(`/api/cvs/${cv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await load();
  }

  async function remove(cv: CvRow) {
    if (!window.confirm(`Delete "${cv.name}" and all of its versions? This cannot be undone.`)) return;
    await fetch(`/api/cvs/${cv.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <Card className="p-5">
        <SectionTitle hint="PDF, DOCX or TXT. Upload as many versions as you have — the profile gets better with each one.">
          Add CVs
        </SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="muted mb-1 block text-xs">Target role (optional)</span>
            <input
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. Senior Data Analyst"
              className="hairline w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="muted mb-1 block text-xs">Industry (optional)</span>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Banking"
              className="hairline w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
            onChange={(e) => void upload(e.target.files)}
            disabled={uploading}
            className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700 disabled:opacity-50"
          />
          {uploading ? <span className="muted text-sm">Uploading…</span> : null}
        </div>

        {message ? (
          <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {message}
          </p>
        ) : null}
      </Card>

      <section>
        <SectionTitle
          hint={
            cvs?.length
              ? `${cvs.length} CV${cvs.length === 1 ? "" : "s"} in your private library`
              : undefined
          }
        >
          CV Library
        </SectionTitle>

        {cvs === null ? (
          <Empty>Loading…</Empty>
        ) : cvs.length === 0 ? (
          <Empty>
            No CVs yet. Upload your first one above — then add the other versions you keep for
            different roles, industries or countries.
          </Empty>
        ) : (
          <div className="space-y-3">
            {cvs.map((cv) => (
              <Card key={cv.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/cvs/${cv.id}`} className="font-medium hover:underline">
                        {cv.name}
                      </Link>
                      <StatusPill status={cv.status} />
                      {cv.extractedBy === "rules" && cv.status === "READY" ? (
                        <Pill tone="neutral" title="Parsed without a model. Configure ANTHROPIC_API_KEY or OLLAMA_MODEL and re-extract for better results.">
                          built-in parser
                        </Pill>
                      ) : null}
                      {cv._count.versions > 1 ? (
                        <Pill tone="blue">{cv._count.versions} versions</Pill>
                      ) : null}
                    </div>
                    <p className="muted mt-1 truncate text-xs">
                      {cv.fileName} · {(cv.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                      {new Date(cv.uploadedAt).toLocaleDateString()}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {cv.targetRole ? <Pill>🎯 {cv.targetRole}</Pill> : null}
                      {cv.industry ? <Pill>🏢 {cv.industry}</Pill> : null}
                    </div>
                    {cv.error ? (
                      <p
                        className={`mt-2 text-xs ${
                          cv.status === "FAILED"
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {cv.error}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 text-sm">
                    <button onClick={() => void rename(cv)} className="hairline rounded-md border px-2.5 py-1 hover:bg-ink-100 dark:hover:bg-ink-800">
                      Rename
                    </button>
                    <Link href={`/cvs/${cv.id}`} className="hairline rounded-md border px-2.5 py-1 hover:bg-ink-100 dark:hover:bg-ink-800">
                      Open
                    </Link>
                    <button
                      onClick={() => void remove(cv)}
                      className="hairline rounded-md border px-2.5 py-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
