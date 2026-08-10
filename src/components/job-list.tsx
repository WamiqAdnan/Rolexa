"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, Empty, Pill, SectionTitle, StatusPill } from "@/components/ui";

type JobSourceRow = {
  id: string;
  provider: string;
  providerName: string;
  url: string | null;
};

type JobRow = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  createdAt: string;
  status: string;
  error: string | null;
  professionalMatch: number | null;
  cvMatch: number | null;
  recommendedCvId: string | null;
  recommendedCvName: string | null;
  applicationStatus: string;
  appliedAt: string | null;
  origin: string;
  url: string | null;
  salary: string | null;
  remote: boolean;
  postedAt: string | null;
  sources: JobSourceRow[];
};

const BUSY = new Set(["PENDING", "ANALYZING"]);

const APPLICATION_STATUSES = [
  { value: "NEW", label: "New" },
  { value: "SHORTLISTED", label: "Shortlisted" },
  { value: "APPLIED", label: "Applied" },
  { value: "INTERVIEWING", label: "Interviewing" },
  { value: "OFFER", label: "Offer" },
  { value: "REJECTED", label: "Rejected" },
  { value: "DISCARDED", label: "Discarded" },
] as const;

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "NEW", label: "New" },
  { value: "SHORTLISTED", label: "Shortlisted" },
  { value: "APPLIED", label: "Applied" },
  { value: "INTERVIEWING", label: "Interviewing" },
  { value: "OFFER", label: "Offer" },
  { value: "REJECTED", label: "Rejected" },
  { value: "DISCARDED", label: "Discarded" },
] as const;

export function JobList({ reloadKey = 0 }: { reloadKey?: number }) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<"match" | "newest">("match");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    company: "",
    location: "",
    source: "",
    description: "",
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams({ applicationStatus: filter, sort });
    const res = await fetch(`/api/jobs?${params}`, { cache: "no-store" });
    const data = (await res.json()) as { jobs: JobRow[]; counts: Record<string, number> };
    setJobs(data.jobs);
    setCounts(data.counts ?? {});
  }, [filter, sort]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Poll only while something is mid-analysis — a refresh scores in the
  // background, so rows fill in their scores as they land.
  useEffect(() => {
    if (!jobs?.some((j) => BUSY.has(j.status))) return;
    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [jobs, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save that job.");
        return;
      }
      setForm({ title: "", company: "", location: "", source: "", description: "" });
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function setApplicationStatus(id: string, applicationStatus: string) {
    setJobs((prev) =>
      prev ? prev.map((j) => (j.id === id ? { ...j, applicationStatus } : j)) : prev,
    );
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationStatus }),
    });
    await load();
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <Card className="p-5">
        <SectionTitle
          hint="Anything the fetcher misses, paste by hand — it goes through the same analysis."
          action={
            <button
              onClick={() => setOpen((v) => !v)}
              className="hairline rounded-md border px-3 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              {open ? "Cancel" : "Paste a job"}
            </button>
          }
        >
          Add a job manually
        </SectionTitle>

        {open ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Senior Data Analyst" required />
              <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} placeholder="Acme Bank" />
              <Field label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="Dubai, UAE" />
              <Field label="Source / link" value={form.source} onChange={(v) => setForm({ ...form, source: v })} placeholder="LinkedIn" />
            </div>
            <label className="block text-sm">
              <span className="muted mb-1 block text-xs">Job description *</span>
              <textarea
                required
                rows={10}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Paste the full advert — responsibilities, requirements, nice-to-haves."
                className="hairline w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
              />
            </label>
            {error ? (
              <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Analyse this job"}
            </button>
          </form>
        ) : null}
      </Card>

      <section>
        <SectionTitle
          hint="Ranked by how well you fit, not by when it was posted."
          action={
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "match" | "newest")}
              className="hairline rounded-md border bg-transparent px-2 py-1 text-xs"
            >
              <option value="match">Best match first</option>
              <option value="newest">Newest first</option>
            </select>
          }
        >
          Jobs {total ? `(${total})` : ""}
        </SectionTitle>

        <div className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const count = f.value === "ALL" ? total : (counts[f.value] ?? 0);
            if (f.value !== "ALL" && f.value !== "NEW" && count === 0) return null;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  filter === f.value
                    ? "bg-ink-200 font-medium dark:bg-ink-700"
                    : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
                }`}
              >
                {f.label} {count ? <span className="tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {jobs === null ? (
          <Empty>Loading…</Empty>
        ) : jobs.length === 0 ? (
          <Empty>
            {filter === "ALL"
              ? "No jobs yet. Add a saved search above and hit Refresh, or paste an advert."
              : "Nothing in this bucket."}
          </Empty>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} onStatus={setApplicationStatus} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({
  job,
  onStatus,
}: {
  job: JobRow;
  onStatus: (id: string, status: string) => void;
}) {
  const meta = [job.company, job.location, job.salary].filter(Boolean).join(" · ");
  // The gap between what you can evidence and what the CV says is the reason
  // tailoring exists, so it's called out rather than left to be worked out.
  const gap =
    job.professionalMatch != null && job.cvMatch != null
      ? job.professionalMatch - job.cvMatch
      : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
              {job.title}
            </Link>
            {job.remote ? <Pill tone="blue">Remote</Pill> : null}
          </div>

          <p className="muted mt-0.5 text-xs">
            {meta || "—"}
            {job.postedAt ? ` · posted ${new Date(job.postedAt).toLocaleDateString()}` : ""}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {job.status !== "READY" ? <StatusPill status={job.status} /> : null}
            {job.sources.map((s) => (
              <a
                key={s.id}
                href={s.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                title={`Found on ${s.providerName}`}
                className="hairline rounded border px-1.5 py-0.5 text-[0.7rem] hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                {s.providerName}
              </a>
            ))}
            {job.sources.length > 1 ? (
              <Pill tone="neutral" title="The same advert, found on more than one portal and merged.">
                {job.sources.length} portals
              </Pill>
            ) : null}
            {job.origin === "MANUAL" && job.sources.length === 0 ? (
              <Pill tone="neutral">Pasted</Pill>
            ) : null}
          </div>

          {job.error ? (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{job.error}</p>
          ) : null}
        </div>

        {job.status === "READY" ? (
          <div className="flex shrink-0 gap-4 text-right">
            <Score label="Professional" value={job.professionalMatch ?? 0} />
            <Score label="CV" value={job.cvMatch ?? 0} />
          </div>
        ) : null}
      </div>

      {job.status === "READY" && job.recommendedCvName ? (
        <div className="hairline mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-ink-50 px-3 py-2 dark:bg-ink-900">
          <p className="text-xs">
            <span className="muted">Send: </span>
            {job.recommendedCvId ? (
              <Link href={`/cvs/${job.recommendedCvId}`} className="font-medium hover:underline">
                {job.recommendedCvName}
              </Link>
            ) : (
              <span className="font-medium">{job.recommendedCvName}</span>
            )}
            <span className="muted"> — communicates </span>
            <span className="font-semibold tabular-nums">{job.cvMatch ?? 0}%</span>
            <span className="muted"> of what this job asks for</span>
          </p>
          {gap != null && gap >= 10 ? (
            <Link href={`/jobs/${job.id}`} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
              {gap} points of your fit go unsaid — tailor it →
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={job.applicationStatus}
          onChange={(e) => onStatus(job.id, e.target.value)}
          className="hairline rounded-md border bg-transparent px-2 py-1 text-xs"
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {job.appliedAt ? (
          <span className="muted text-xs">
            Applied {new Date(job.appliedAt).toLocaleDateString()}
          </span>
        ) : null}
        {job.url ? (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="muted text-xs hover:underline"
          >
            Open advert ↗
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 75
      ? "text-brand-600 dark:text-brand-400"
      : value >= 55
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div>
      <div className="muted text-[0.65rem] tracking-wide uppercase">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}%</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="muted mb-1 block text-xs">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="hairline w-full rounded-md border bg-transparent px-3 py-2 text-sm"
      />
    </label>
  );
}
