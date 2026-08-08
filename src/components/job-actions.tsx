"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TailorButton({
  jobId,
  cvs,
  recommendedCvId,
}: {
  jobId: string;
  cvs: { id: string; name: string }[];
  recommendedCvId: string | null;
}) {
  const router = useRouter();
  const [cvId, setCvId] = useState(recommendedCvId ?? cvs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/tailor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Tailoring failed.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tailoring failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cvId}
          onChange={(e) => setCvId(e.target.value)}
          className="hairline rounded-md border bg-[var(--surface-raised)] px-2 py-1.5 text-sm"
        >
          {cvs.map((cv) => (
            <option key={cv.id} value={cv.id}>
              {cv.name}
              {cv.id === recommendedCvId ? " (recommended)" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => void run()}
          disabled={busy || !cvId}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Tailoring…" : "Tailor CV for this job"}
        </button>
      </div>
      {busy ? (
        <p className="muted text-xs">
          This takes up to a minute. The original CV is never modified — the result is saved as a
          new version.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function ReanalyseButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/jobs/${jobId}`, { method: "POST" });
        setTimeout(() => {
          router.refresh();
          setBusy(false);
        }, 1500);
      }}
      className="hairline rounded-md border px-2.5 py-1 text-sm hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
    >
      {busy ? "Re-analysing…" : "Re-analyse"}
    </button>
  );
}

export function DeleteJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Delete this job and its analysis?")) return;
        setBusy(true);
        await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
        router.push("/jobs");
      }}
      className="hairline rounded-md border px-2.5 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
    >
      Delete
    </button>
  );
}
