"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const STATUSES = [
  { value: "NEW", label: "New" },
  { value: "SHORTLISTED", label: "Shortlisted" },
  { value: "APPLIED", label: "Applied" },
  { value: "INTERVIEWING", label: "Interviewing" },
  { value: "OFFER", label: "Offer" },
  { value: "REJECTED", label: "Rejected" },
  { value: "DISCARDED", label: "Discarded" },
] as const;

/**
 * Where you are with this job. Kept apart from `status`, which is Rolexa's own
 * processing state — one is about you, the other about the pipeline.
 */
export function ApplicationStatus({
  jobId,
  current,
  appliedAt,
}: {
  jobId: string;
  current: string;
  appliedAt: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();

  async function change(next: string) {
    setValue(next);
    await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationStatus: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="muted">Your status</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => void change(e.target.value)}
        className="hairline rounded-md border bg-transparent px-2 py-1 text-xs disabled:opacity-50"
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {appliedAt ? (
        <span className="muted">applied {new Date(appliedAt).toLocaleDateString()}</span>
      ) : null}
    </label>
  );
}
