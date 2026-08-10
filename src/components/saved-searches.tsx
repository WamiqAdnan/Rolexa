"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, Empty, Pill, SectionTitle } from "@/components/ui";

type SavedSearch = {
  id: string;
  name: string;
  keywords: string;
  location: string | null;
  remoteOnly: boolean;
  providers: string | null;
  minMatch: number | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastAdded: number | null;
  lastSeen: number | null;
  lastError: string | null;
  _count: { jobs: number };
};

type Source = {
  id: string;
  name: string;
  blurb: string;
  available: boolean;
  reason: string | null;
};

type RefreshReport = {
  totalAdded: number;
  totalMerged: number;
  totalSeen: number;
  scoring: number;
  notes: string[];
  searches: {
    searchName: string;
    added: number;
    merged: number;
    seen: number;
    error: string | null;
    providers: {
      providerId: string;
      providerName: string;
      seen: number;
      added: number;
      merged: number;
      error: string | null;
    }[];
  }[];
};

const EMPTY_FORM = {
  name: "",
  keywords: "",
  location: "",
  remoteOnly: false,
  minMatch: "",
  providers: [] as string[],
};

export function SavedSearches({ onRefreshed }: { onRefreshed?: () => void }) {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RefreshReport | null>(null);

  const load = useCallback(async () => {
    const [s, src] = await Promise.all([
      fetch("/api/searches", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/sources", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setSearches((s as { searches: SavedSearch[] }).searches);
    setSources((src as { sources: Source[] }).sources);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const available = sources.filter((s) => s.available);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          minMatch: form.minMatch ? Number(form.minMatch) : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save that search.");
        return;
      }
      setForm(EMPTY_FORM);
      setOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function refresh(searchId?: string) {
    setRefreshing(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/searches/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchId ? { searchId } : {}),
      });
      const data = (await res.json()) as { report?: RefreshReport; error?: string };
      if (!res.ok || !data.report) {
        setError(data.error ?? "The refresh failed.");
        return;
      }
      setReport(data.report);
      await load();
      onRefreshed?.();
    } catch {
      setError("The refresh failed — check your connection.");
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleActive(search: SavedSearch) {
    await fetch(`/api/searches/${search.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !search.isActive }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/searches/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card className="p-5">
      <SectionTitle
        hint="Stored queries, re-run against every configured board. Jobs found here are scored on arrival, so the feed comes back ranked."
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="hairline rounded-md border px-3 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              {open ? "Cancel" : "New search"}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={refreshing || !searches?.some((s) => s.isActive)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {refreshing ? "Fetching…" : "Refresh all"}
            </button>
          </div>
        }
      >
        Saved searches
      </SectionTitle>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <Pill key={s.id} tone={s.available ? "green" : "neutral"} title={s.reason ?? s.blurb}>
            {s.available ? "●" : "○"} {s.name}
          </Pill>
        ))}
      </div>

      {available.length === 0 ? (
        <p className="mb-4 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No sources are reachable. The three remote boards need no key — if they&apos;re showing
          as unavailable, check your connection. For LinkedIn and Indeed postings, add{" "}
          <code>RAPIDAPI_KEY</code> to <code>.env</code>.
        </p>
      ) : null}

      {open ? (
        <form onSubmit={create} className="mb-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Keywords *"
              value={form.keywords}
              onChange={(v) => setForm({ ...form, keywords: v })}
              placeholder="data analyst"
              required
            />
            <Field
              label="Location"
              value={form.location}
              onChange={(v) => setForm({ ...form, location: v })}
              placeholder="Dubai"
            />
            <Field
              label="Name"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="Defaults to the keywords"
            />
            <Field
              label="Hide below match %"
              value={form.minMatch}
              onChange={(v) => setForm({ ...form, minMatch: v.replace(/\D/g, "") })}
              placeholder="e.g. 50 — leave blank to keep everything"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.remoteOnly}
              onChange={(e) => setForm({ ...form, remoteOnly: e.target.checked })}
            />
            Remote only
          </label>

          <fieldset>
            <legend className="muted mb-1.5 text-xs">
              Sources — none selected means every configured one
            </legend>
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => (
                <label
                  key={s.id}
                  title={s.reason ?? s.blurb}
                  className={`hairline flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                    s.available ? "" : "opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!s.available}
                    checked={form.providers.includes(s.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        providers: e.target.checked
                          ? [...form.providers, s.id]
                          : form.providers.filter((p) => p !== s.id),
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>

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
            {saving ? "Saving…" : "Save search"}
          </button>
        </form>
      ) : null}

      {report ? <RefreshSummary report={report} /> : null}

      {searches === null ? (
        <Empty>Loading…</Empty>
      ) : searches.length === 0 ? (
        <Empty>
          No saved searches yet. Add one above — or copy a query from Search Terms, which builds
          them from your profile.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {searches.map((s) => (
            <li
              key={s.id}
              className="hairline flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-medium ${s.isActive ? "" : "muted line-through"}`}>
                    {s.name}
                  </span>
                  {s.remoteOnly ? <Pill tone="blue">Remote only</Pill> : null}
                  {s.minMatch ? <Pill tone="neutral">≥ {s.minMatch}%</Pill> : null}
                </div>
                <p className="muted mt-0.5 text-xs">
                  <code>{s.keywords}</code>
                  {s.location ? ` · ${s.location}` : ""} · {s._count.jobs} job
                  {s._count.jobs === 1 ? "" : "s"}
                  {s.lastRunAt
                    ? ` · last run ${new Date(s.lastRunAt).toLocaleString()} (+${s.lastAdded ?? 0} new of ${s.lastSeen ?? 0} seen)`
                    : " · never run"}
                </p>
                {s.lastError ? (
                  <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{s.lastError}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  onClick={() => void refresh(s.id)}
                  disabled={refreshing}
                  className="hairline rounded border px-2 py-1 hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
                >
                  Refresh
                </button>
                <button
                  onClick={() => void toggleActive(s)}
                  className="hairline rounded border px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800"
                >
                  {s.isActive ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => void remove(s.id)}
                  className="hairline rounded border px-2 py-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RefreshSummary({ report }: { report: RefreshReport }) {
  return (
    <div className="hairline mb-4 rounded-lg border bg-ink-50 px-3 py-2.5 text-sm dark:bg-ink-900">
      <p className="font-medium">
        {report.totalAdded} new · {report.totalMerged} already held · {report.totalSeen} seen
      </p>
      {report.scoring > 0 ? (
        <p className="muted mt-0.5 text-xs">
          Scoring {report.scoring} against your profile now — the list updates as they finish.
        </p>
      ) : null}
      {report.notes.map((note) => (
        <p key={note} className="muted mt-0.5 text-xs">
          {note}
        </p>
      ))}
      <ul className="muted mt-1.5 space-y-0.5 text-xs">
        {report.searches.flatMap((s) =>
          s.providers.map((p) => (
            <li key={`${s.searchName}-${p.providerId}`}>
              <span className="font-medium">{s.searchName}</span> · {p.providerName}:{" "}
              {p.error ? (
                <span className="text-red-600 dark:text-red-400">{p.error}</span>
              ) : (
                `${p.added} new of ${p.seen}`
              )}
            </li>
          )),
        )}
      </ul>
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
