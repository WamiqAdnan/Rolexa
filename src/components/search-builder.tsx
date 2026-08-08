"use client";

import { useMemo, useState } from "react";

import { Card, Pill, SectionTitle } from "@/components/ui";
import {
  boardUrl,
  buildQueries,
  JOB_BOARDS,
  type SearchProfile,
} from "@/lib/search-profile";

/**
 * Pick titles, keywords and a location; get query strings and deep links.
 *
 * All of it is derived client-side from the profile the server passed in, so
 * toggling is instant and nothing is sent anywhere.
 */
export function SearchBuilder({ profile }: { profile: SearchProfile }) {
  const [titles, setTitles] = useState<Set<string>>(
    () => new Set(profile.titles.filter((t) => t.recommended).map((t) => t.term)),
  );
  const [keywords, setKeywords] = useState<Set<string>>(
    () => new Set(profile.keywords.filter((k) => k.recommended).map((k) => k.term)),
  );
  const [seniority, setSeniority] = useState("");
  const [location, setLocation] = useState(
    () => profile.locations.find((l) => l.recommended)?.term ?? "",
  );
  const [mode, setMode] = useState<"broad" | "focused">("broad");

  const expanded = useMemo(
    () =>
      [...titles].map((t) => (seniority ? `${seniority} ${t}` : t)),
    [titles, seniority],
  );

  const queries = useMemo(
    () => buildQueries(expanded, [...keywords]),
    [expanded, keywords],
  );
  const query = queries[mode];

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------- titles */}
      <Card className="p-4">
        <SectionTitle hint="Titles you have held are on by default. The rest are transferable suggestions from the same role family — you have not held them, so treat them as a wider net.">
          Job titles
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {profile.titles.map((t) => {
            const on = titles.has(t.term);
            return (
              <button
                key={t.term}
                onClick={() => setTitles(toggle(titles, t.term))}
                title={`${t.why}${t.sources.length ? ` — ${t.sources.join(", ")}` : ""}`}
                className={`hairline rounded-full border px-3 py-1 text-sm transition-colors ${
                  on
                    ? "border-brand-500 bg-brand-600/15 font-medium"
                    : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
                }`}
              >
                {t.held ? "✓ " : ""}
                {t.term}
              </button>
            );
          })}
        </div>
        <p className="muted mt-3 text-xs">
          ✓ = a CV shows you held this title. Hover any chip for its evidence.
        </p>
      </Card>

      {/* ------------------------------------------------- seniority */}
      {profile.seniority.length > 1 ? (
        <Card className="p-4">
          <SectionTitle
            hint={
              profile.years
                ? `Based on ${profile.years.value} years${profile.years.derived ? " implied by your employment timeline" : " stated on your CVs"}. Levels above what your CVs evidence are not offered.`
                : "Only levels your CVs evidence are offered."
            }
          >
            Seniority
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {profile.seniority.map((s) => (
              <button
                key={s || "none"}
                onClick={() => setSeniority(s)}
                className={`hairline rounded-full border px-3 py-1 text-sm ${
                  seniority === s
                    ? "border-brand-500 bg-brand-600/15 font-medium"
                    : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
                }`}
              >
                {s || "No prefix"}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {/* -------------------------------------------------- keywords */}
      <Card className="p-4">
        <SectionTitle hint="Skills recruiters index on, strongest first. Soft skills are left out — they return noise on job boards. Adding more than three or four narrows results sharply.">
          Skill keywords
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {profile.keywords.map((k) => {
            const on = keywords.has(k.term);
            return (
              <button
                key={k.term}
                onClick={() => setKeywords(toggle(keywords, k.term))}
                title={`${k.confidence.replace("_", " ").toLowerCase()} · ${k.sources.join(", ") || "no sources"}`}
                className={`hairline rounded-full border px-3 py-1 text-sm transition-colors ${
                  on
                    ? "border-brand-500 bg-brand-600/15 font-medium"
                    : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
                }`}
              >
                {k.term}
                <span className="muted ml-1 text-xs">·{k.sourceCount}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* -------------------------------------------------- location */}
      <Card className="p-4">
        <SectionTitle hint="Where your CVs say you are, plus everywhere you have worked. If your CVs disagree on location, each one is a search worth running.">
          Location
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {profile.locations.map((l) => (
            <button
              key={l.term}
              onClick={() => setLocation(l.term)}
              title={l.why}
              className={`hairline rounded-full border px-3 py-1 text-sm ${
                location === l.term
                  ? "border-brand-500 bg-brand-600/15 font-medium"
                  : "muted hover:bg-ink-100 dark:hover:bg-ink-800"
              }`}
            >
              {l.term}
            </button>
          ))}
        </div>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="…or type a location"
          className="hairline mt-3 w-full rounded-md border bg-transparent px-3 py-2 text-sm sm:w-72"
        />
      </Card>

      {/* ----------------------------------------------------- query */}
      <Card className="p-4">
        <SectionTitle
          hint="Paste into any job board's keyword field. Boolean works on LinkedIn, Indeed and most ATS searches."
          action={
            <div className="hairline flex overflow-hidden rounded-md border text-xs">
              {(["broad", "focused"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 ${
                    mode === m ? "bg-brand-600 font-medium text-white" : "muted"
                  }`}
                >
                  {m === "broad" ? "Broad" : "Focused"}
                </button>
              ))}
            </div>
          }
        >
          Your search query
        </SectionTitle>

        <p className="muted mb-2 text-xs">
          {mode === "broad"
            ? "Titles only — the widest useful net. Start here."
            : "Titles AND at least one skill keyword. Far fewer results; use when Broad is too noisy."}
        </p>

        <QueryBox label="Boolean" value={query.boolean} />
        <div className="mt-3">
          <QueryBox label="Plain text" value={query.plain} />
        </div>

        <div className="mt-4">
          <h4 className="muted mb-2 text-xs font-semibold tracking-wide uppercase">
            Open a search
          </h4>
          <div className="flex flex-wrap gap-2">
            {JOB_BOARDS.map((board) => (
              <a
                key={board.id}
                href={boardUrl(board, query, location)}
                target="_blank"
                rel="noreferrer noopener"
                title={board.note}
                className="hairline rounded-md border px-3 py-1.5 text-sm hover:border-brand-400 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                {board.name} ↗
              </a>
            ))}
          </div>
          <p className="muted mt-2 text-xs">
            Country domains vary — Indeed in particular. Edit{" "}
            <code>JOB_BOARDS</code> in <code>src/lib/search-profile.ts</code> to add your own
            boards.
          </p>
        </div>
      </Card>

      {profile.industries.length ? (
        <Card className="p-4">
          <SectionTitle hint="Useful as an extra filter on boards that have an industry field.">
            Industries
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {profile.industries.map((i) => (
              <Pill key={i.term} title={i.sources.join(", ")}>
                {i.term}
              </Pill>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function QueryBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="muted mb-1 text-xs">{label}</div>
      <div className="flex items-stretch gap-2">
        <code className="hairline min-w-0 flex-1 overflow-x-auto rounded-md border bg-[var(--surface-sunken)] px-3 py-2 text-xs whitespace-pre">
          {value || "— select at least one title —"}
        </code>
        <button
          disabled={!value}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="hairline shrink-0 rounded-md border px-3 text-xs hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-ink-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
