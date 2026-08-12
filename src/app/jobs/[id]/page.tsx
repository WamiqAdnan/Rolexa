import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DeleteJobButton,
  ReanalyseButton,
  TailorButton,
} from "@/components/job-actions";
import { ApplicationStatus } from "@/components/application-status";
import { Markdown } from "@/components/markdown";
import {
  Card,
  Empty,
  GapBadge,
  Pill,
  ScoreDial,
  SectionTitle,
  StatusPill,
} from "@/components/ui";
import { json, prisma } from "@/lib/db";
import {
  generatorLabel,
  type GapBucket,
  type JobAnalysis,
  type RequirementMatch,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const GAP_ORDER: GapBucket[] = ["MISSING", "HAVE_NOT_EMPHASISED", "UNCLEAR", "HAVE"];

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [job, cvs] = await Promise.all([
    prisma.job.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { createdAt: "desc" }, include: { cv: { select: { id: true, name: true } } } },
        sources: { orderBy: { firstSeenAt: "asc" } },
      },
    }),
    prisma.cv.findMany({
      where: { status: "READY" },
      select: { id: true, name: true },
      orderBy: { uploadedAt: "asc" },
    }),
  ]);

  if (!job) notFound();
  const analysis = json<JobAnalysis | null>(job.analysis, null);

  return (
    <div className="space-y-8">
      <header>
        <Link href="/jobs" className="muted text-sm hover:underline">
          ← Jobs
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{job.title}</h1>
            <p className="muted mt-1 text-sm">
              {[job.company, job.location, job.salary].filter(Boolean).join(" · ") || "—"}
              {job.postedAt
                ? ` · posted ${new Date(job.postedAt).toLocaleDateString()}`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={job.status} />
              {job.remote ? <Pill tone="blue">Remote</Pill> : null}
              {analysis ? (
                <span className="muted text-xs">
                  requirements read by {generatorLabel(analysis.analyzedBy)}
                </span>
              ) : null}
            </div>

            {job.sources.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="muted text-xs">
                  Found on{job.sources.length > 1 ? ` ${job.sources.length} portals` : ""}:
                </span>
                {job.sources.map((s) => (
                  <a
                    key={s.id}
                    href={s.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={
                      s.title !== job.title
                        ? `Listed there as: "${s.title}"`
                        : `Listed on ${s.providerName}`
                    }
                    className="hairline rounded border px-1.5 py-0.5 text-[0.7rem] hover:bg-ink-100 dark:hover:bg-ink-800"
                  >
                    {s.providerName}
                  </a>
                ))}
              </div>
            ) : job.source ? (
              <p className="muted mt-2 text-xs">Source: {job.source}</p>
            ) : null}

            <div className="mt-2.5">
              <ApplicationStatus
                jobId={job.id}
                current={job.applicationStatus}
                appliedAt={job.appliedAt ? job.appliedAt.toISOString() : null}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <ReanalyseButton jobId={job.id} />
            <DeleteJobButton jobId={job.id} />
          </div>
        </div>
        {job.error ? (
          <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
            {job.error}
          </p>
        ) : null}
      </header>

      {!analysis ? (
        <Empty>
          {job.status === "FAILED"
            ? "Analysis failed — see the error above."
            : "Analysing this job against your Master Profile. Reload in a moment."}
        </Empty>
      ) : (
        <>
          {/* ------------------------------------------- two scores */}
          <Card className="p-5">
            <div className="flex flex-wrap gap-8">
              <ScoreDial
                value={analysis.professionalMatch}
                label="Professional match"
                hint="How well you actually fit, based on your combined profile across every CV."
              />
              <ScoreDial
                value={analysis.cvMatch}
                label="CV match"
                hint={`How well “${analysis.recommendedCvName ?? "—"}” communicates that fit.`}
                tone={
                  analysis.professionalMatch - analysis.cvMatch >= 12 ? "amber" : undefined
                }
              />
            </div>

            <div className="hairline mt-5 rounded-lg border p-4">
              <p className="text-sm font-semibold">{analysis.verdict.headline}</p>
              <p className="muted mt-1 text-sm">{analysis.verdict.detail}</p>
            </div>
          </Card>

          {/* --------------------------------------- recommended CV */}
          {analysis.recommendedCvId ? (
            <section>
              <SectionTitle>🎯 Recommended CV</SectionTitle>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/cvs/${analysis.recommendedCvId}`}
                      className="font-medium hover:underline"
                    >
                      {analysis.recommendedCvName}
                    </Link>
                    <p className="muted mt-0.5 text-sm">{analysis.recommendationReason}</p>
                  </div>
                  <Pill tone="green">{analysis.cvMatch}% CV alignment</Pill>
                </div>

                {analysis.alignments.length > 1 ? (
                  <div className="mt-4">
                    <h4 className="muted mb-1.5 text-xs font-semibold tracking-wide uppercase">
                      All CVs, scored against this job
                    </h4>
                    <ul className="space-y-1.5">
                      {analysis.alignments.map((a) => (
                        <li key={a.cvId} className="flex items-center gap-3 text-sm">
                          <Link href={`/cvs/${a.cvId}`} className="w-56 shrink-0 truncate hover:underline">
                            {a.cvName}
                          </Link>
                          <div className="hairline h-1.5 flex-1 overflow-hidden rounded-full border-0 bg-ink-200 dark:bg-ink-800">
                            <div
                              className={`h-full rounded-full ${a.cvId === analysis.recommendedCvId ? "bg-brand-500" : "bg-ink-400"}`}
                              style={{ width: `${Math.max(2, a.score)}%` }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right tabular-nums">
                            {a.score}%{" "}
                            <span className="muted text-xs">
                              ({a.covered}/{a.total})
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            </section>
          ) : null}

          {/* ------------------------------- requirement comparison */}
          <section>
            <SectionTitle hint="Master Profile is everything your CVs collectively evidence. Recommended CV is what this one document actually says.">
              Requirement comparison
            </SectionTitle>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="muted hairline border-b text-left text-xs uppercase">
                    <th className="px-4 py-2 font-medium">Requirement</th>
                    <th className="px-3 py-2 font-medium">Master Profile</th>
                    <th className="px-3 py-2 font-medium">Recommended CV</th>
                    <th className="px-4 py-2 font-medium">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.matches.map((m) => (
                    <tr key={m.requirement.key} className="hairline border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.requirement.label}</span>
                          {m.requirement.importance === "MUST" ? (
                            <Pill tone="neutral" title="Essential requirement">
                              must
                            </Pill>
                          ) : null}
                        </div>
                        <p className="muted mt-0.5 text-xs italic">“{m.requirement.quote}”</p>
                      </td>
                      <td className="px-3 py-2.5 text-center text-lg">
                        <Mark level={m.profileLevel} />
                      </td>
                      <td className="px-3 py-2.5 text-center text-lg">
                        <Mark level={m.cvLevel} />
                        {m.cvMentions > 0 ? (
                          <div className="muted text-[0.65rem]">{m.cvMentions}×</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <GapBadge gap={m.gap} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {/* --------------------------------------- gap analysis */}
          <section>
            <SectionTitle hint="Grouped by what you should actually do about each one.">
              Gap analysis
            </SectionTitle>
            <div className="space-y-4">
              {GAP_ORDER.map((bucket) => {
                const items = analysis.matches.filter((m) => m.gap === bucket);
                if (!items.length) return null;
                return <GapGroup key={bucket} bucket={bucket} items={items} />;
              })}
            </div>
          </section>

          {/* ------------------------------------------- tailoring */}
          <section>
            <SectionTitle hint="Starts from an existing CV, uses only what your CV library evidences, and saves the result as a new version.">
              Tailor a CV for this job
            </SectionTitle>
            <Card className="p-4">
              {cvs.length ? (
                <TailorButton
                  jobId={job.id}
                  cvs={cvs}
                  recommendedCvId={analysis.recommendedCvId}
                />
              ) : (
                <p className="muted text-sm">No processed CVs available.</p>
              )}
            </Card>
          </section>

          {job.versions.length ? (
            <section>
              <SectionTitle>Tailored CVs for this job</SectionTitle>
              <div className="space-y-3">
                {job.versions.map((version) => {
                  const changes = json<{
                    changesMade?: string[];
                    notAdded?: string[];
                    warnings?: string[];
                  }>(version.changes, {});
                  return (
                    <Card key={version.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{version.label}</p>
                          <p className="muted text-xs">
                            from{" "}
                            <Link href={`/cvs/${version.cv.id}`} className="hover:underline">
                              {version.cv.name}
                            </Link>{" "}
                            · {new Date(version.createdAt).toLocaleString()}
                            {version.generator === "rules"
                              ? " · built-in re-ordering pass"
                              : ""}
                          </p>
                        </div>
                        <a
                          href={`/api/versions/${version.id}?download=1`}
                          className="hairline rounded-md border px-2.5 py-1 text-xs hover:bg-ink-100 dark:hover:bg-ink-800"
                        >
                          Download .md
                        </a>
                      </div>

                      {changes.warnings?.length ? (
                        <div className="mt-3 rounded-md bg-red-100 p-3 text-sm dark:bg-red-950">
                          <p className="font-medium text-red-900 dark:text-red-200">
                            Verify before sending
                          </p>
                          <ul className="mt-1 list-disc pl-5 text-red-800 dark:text-red-300">
                            {changes.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="text-xs font-semibold tracking-wide uppercase">
                            Changes made
                          </h4>
                          <ul className="muted mt-1 list-disc pl-5 text-sm">
                            {(changes.changesMade ?? []).map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                            {!changes.changesMade?.length ? <li>—</li> : null}
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold tracking-wide uppercase">
                            Information intentionally NOT added
                          </h4>
                          <ul className="muted mt-1 list-disc pl-5 text-sm">
                            {(changes.notAdded ?? []).map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                            {!changes.notAdded?.length ? <li>—</li> : null}
                          </ul>
                        </div>
                      </div>

                      <details className="mt-3">
                        <summary className="muted cursor-pointer text-sm">
                          Preview the tailored CV
                        </summary>
                        <div className="hairline mt-2 max-h-[36rem] overflow-auto rounded-lg border p-4">
                          <Markdown source={version.content} />
                        </div>
                      </details>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <SectionTitle>Original advert</SectionTitle>
            <Card className="p-4">
              <details>
                <summary className="muted cursor-pointer text-sm">Show the pasted text</summary>
                <pre className="mt-3 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
                  {job.description}
                </pre>
              </details>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function Mark({ level }: { level: string }) {
  if (level === "DIRECT") return <span title="Direct match">✅</span>;
  if (level === "RELATED") return <span title="Related / transferable">🟡</span>;
  return <span title="No match">❌</span>;
}

const GAP_COPY: Record<GapBucket, { title: string; blurb: string }> = {
  MISSING: {
    title: "❌ You do not appear to have this",
    blurb:
      "No supporting evidence in any uploaded CV. Do not add these to a tailored CV — if you do have the experience, upload a CV that shows it.",
  },
  HAVE_NOT_EMPHASISED: {
    title: "⚠️ You have it, but this CV barely says so",
    blurb:
      "Supported by your Master Profile and under-represented in the recommended CV. This is what tailoring fixes.",
  },
  UNCLEAR: {
    title: "❓ Unclear — verify before relying on it",
    blurb:
      "Your CVs are ambiguous or contradictory here, or the match is only transferable rather than direct.",
  },
  HAVE: {
    title: "✅ You have it and the CV says so",
    blurb: "Directly evidenced and clearly stated. Nothing to do.",
  },
};

function GapGroup({ bucket, items }: { bucket: GapBucket; items: RequirementMatch[] }) {
  const copy = GAP_COPY[bucket];
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">
        {copy.title} <span className="muted font-normal">({items.length})</span>
      </h3>
      <p className="muted mt-0.5 mb-2 text-xs">{copy.blurb}</p>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.requirement.key} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{m.requirement.label}</span>
              {m.requirement.importance === "MUST" ? <Pill tone="neutral">must</Pill> : null}
              {bucket === "HAVE_NOT_EMPHASISED" ? (
                <span className="muted text-xs">
                  mentioned {m.cvMentions}× in the recommended CV
                </span>
              ) : null}
            </div>
            {m.matchedLabel && bucket !== "MISSING" ? (
              <p className="muted text-xs">Matched to: {m.matchedLabel}</p>
            ) : null}
            {m.profileEvidence.length ? (
              <p className="muted text-xs">
                Evidence: {Array.from(new Set(m.profileEvidence.map((e) => e.cvName))).join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
