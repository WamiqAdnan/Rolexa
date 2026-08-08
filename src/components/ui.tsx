import Link from "next/link";
import type { ReactNode } from "react";

import type { Confidence, GapBucket } from "@/lib/types";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`surface rounded-xl ${className}`}>{children}</div>;
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold tracking-wide uppercase">{children}</h2>
        {hint ? <p className="muted mt-0.5 text-xs">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="muted hairline rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
  title?: string;
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
    green: "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const CONFIDENCE_META: Record<
  Confidence,
  { icon: string; label: string; tone: "green" | "amber" | "red"; help: string }
> = {
  CONFIRMED: {
    icon: "🟢",
    label: "Confirmed",
    tone: "green",
    help: "Supported by more than one CV, or confirmed by you.",
  },
  NEEDS_REVIEW: {
    icon: "🟡",
    label: "Needs review",
    tone: "amber",
    help: "Appears in only one CV. Verify it still reflects reality.",
  },
  CONFLICTING: {
    icon: "🔴",
    label: "Conflicting",
    tone: "red",
    help: "Your CVs disagree about this. Pick the correct value.",
  },
};

export function ConfidenceBadge({
  confidence,
  withLabel = true,
}: {
  confidence: Confidence;
  withLabel?: boolean;
}) {
  const meta = CONFIDENCE_META[confidence];
  return (
    <Pill tone={meta.tone} title={meta.help}>
      <span aria-hidden>{meta.icon}</span>
      {withLabel ? meta.label : <span className="sr-only">{meta.label}</span>}
    </Pill>
  );
}

const GAP_META: Record<
  GapBucket,
  { label: string; tone: "green" | "amber" | "red" | "blue"; icon: string }
> = {
  HAVE: { label: "You have it", tone: "green", icon: "✅" },
  HAVE_NOT_EMPHASISED: { label: "Not emphasised", tone: "amber", icon: "⚠️" },
  MISSING: { label: "No evidence", tone: "red", icon: "❌" },
  UNCLEAR: { label: "Unclear", tone: "blue", icon: "❓" },
};

export function GapBadge({ gap }: { gap: GapBucket }) {
  const meta = GAP_META[gap];
  return (
    <Pill tone={meta.tone}>
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </Pill>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: "neutral" | "green" | "amber" | "red" | "blue"; label: string }> = {
    PENDING: { tone: "neutral", label: "Queued" },
    PARSING: { tone: "blue", label: "Reading file" },
    EXTRACTING: { tone: "blue", label: "Extracting" },
    ANALYZING: { tone: "blue", label: "Analysing" },
    READY: { tone: "green", label: "Ready" },
    FAILED: { tone: "red", label: "Failed" },
  };
  const meta = map[status] ?? { tone: "neutral" as const, label: status };
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

/** Big two-number score display used on job pages. */
export function ScoreDial({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint: string;
  tone?: "brand" | "amber";
}) {
  const colour =
    tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : value >= 75
        ? "text-brand-600 dark:text-brand-400"
        : value >= 55
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  return (
    <div className="flex-1">
      <div className="muted text-xs font-medium tracking-wide uppercase">{label}</div>
      <div className={`text-4xl font-bold tabular-nums ${colour}`}>{value}%</div>
      <div className="muted mt-1 text-xs leading-snug">{hint}</div>
      <div className="hairline mt-2 h-1.5 overflow-hidden rounded-full border-0 bg-ink-200 dark:bg-ink-800">
        <div
          className={`h-full rounded-full ${
            tone === "amber" || value < 55 ? "bg-amber-500" : "bg-brand-500"
          }`}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function EvidenceList({
  sources,
}: {
  sources: { cvId: string; cvName: string; rawLabel: string }[];
}) {
  if (!sources.length) return null;
  return (
    <div className="muted mt-1 flex flex-wrap items-center gap-1 text-xs">
      <span>Source{sources.length > 1 ? "s" : ""}:</span>
      {sources.map((s) => (
        <Link
          key={`${s.cvId}-${s.rawLabel}`}
          href={`/cvs/${s.cvId}`}
          title={`Written as: "${s.rawLabel}"`}
          className="hairline rounded border px-1.5 py-0.5 hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          {s.cvName}
        </Link>
      ))}
    </div>
  );
}
