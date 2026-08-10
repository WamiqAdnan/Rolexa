import Link from "next/link";

import { Card, ConfidenceBadge, Empty, Pill, SectionTitle } from "@/components/ui";
import { hasApiKey, MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { loadMasterProfile } from "@/lib/master-profile";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [profile, cvCount, jobs] = await Promise.all([
    loadMasterProfile(),
    prisma.cv.count(),
    prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        company: true,
        status: true,
        professionalMatch: true,
        cvMatch: true,
      },
    }),
  ]);

  const skills = (profile.byCategory.SKILL ?? []).filter((a) => a.userStatus !== "REJECTED");
  const topSkills = [...skills]
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, 14);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Rolexa</h1>
        <p className="muted mt-1 max-w-3xl text-sm">
          A private library of every CV you keep, plus a Master Professional Profile built by
          combining them. Jobs are scored against the whole profile first, then matched to the CV
          that communicates it best.
        </p>
      </header>

      {!hasApiKey() ? (
        <Card className="border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Running on the built-in parser
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            No <code>ANTHROPIC_API_KEY</code> is set, so CV extraction, job-requirement reading and
            CV tailoring use Rolexa&apos;s deterministic fallbacks. Everything works; extraction is
            just less accurate on unusual layouts. Add a key to <code>.env</code>, restart, then use{" "}
            <em>Re-extract</em> on each CV.
          </p>
        </Card>
      ) : (
        <p className="muted text-xs">
          Extraction, matching and tailoring use <code>{MODEL}</code>.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="CVs" value={cvCount} href="/cvs" />
        <StatCard label="Profile facts" value={profile.attributes.length} href="/profile" />
        <StatCard
          label="Needs review"
          value={profile.needsReview.length}
          href="/profile"
          tone={profile.needsReview.length ? "amber" : undefined}
        />
        <StatCard
          label="Conflicts"
          value={profile.conflicts.length}
          href="/profile"
          tone={profile.conflicts.length ? "red" : undefined}
        />
      </section>

      {profile.conflicts.length ? (
        <Card className="p-4">
          <SectionTitle
            hint="Rolexa will not silently pick a value for you."
            action={
              <Link
                href="/profile"
                className="text-sm text-brand-700 hover:underline dark:text-brand-400"
              >
                Resolve →
              </Link>
            }
          >
            ⚠️ Conflicting information
          </SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {profile.conflicts.slice(0, 5).map((attr) => (
              <li key={attr.id} className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge confidence={attr.confidence} withLabel={false} />
                <span className="font-medium">{attr.label}</span>
                <span className="muted text-xs">{(attr.variants ?? []).join("  vs  ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle
            hint="Ordered by how many of your CVs back them up."
            action={
              <Link
                href="/profile"
                className="text-sm text-brand-700 hover:underline dark:text-brand-400"
              >
                Full profile →
              </Link>
            }
          >
            Strongest skills
          </SectionTitle>
          {topSkills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {topSkills.map((attr) => (
                <Pill
                  key={attr.id}
                  title={`From: ${attr.sources.map((s) => s.cvName).join(", ")}`}
                >
                  {attr.label}
                  <span className="muted">·{attr.sources.length}</span>
                </Pill>
              ))}
            </div>
          ) : (
            <Empty>
              <Link href="/cvs" className="text-brand-700 hover:underline dark:text-brand-400">
                Upload a CV
              </Link>{" "}
              to start building your profile.
            </Empty>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle
            action={
              <Link
                href="/jobs"
                className="text-sm text-brand-700 hover:underline dark:text-brand-400"
              >
                All jobs →
              </Link>
            }
          >
            Recent jobs
          </SectionTitle>
          {jobs.length ? (
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/jobs/${job.id}`} className="min-w-0 truncate hover:underline">
                    {job.title}
                    {job.company ? <span className="muted"> · {job.company}</span> : null}
                  </Link>
                  {job.status === "READY" ? (
                    <span className="shrink-0 tabular-nums">
                      <span className="font-semibold">{job.professionalMatch}%</span>
                      <span className="muted"> / {job.cvMatch}%</span>
                    </span>
                  ) : (
                    <span className="muted shrink-0 text-xs">{job.status.toLowerCase()}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              <Link href="/jobs" className="text-brand-700 hover:underline dark:text-brand-400">
                Paste a job advert
              </Link>{" "}
              to see how well you match.
            </Empty>
          )}
        </Card>
      </section>

      <Card className="p-5">
        <SectionTitle>How it fits together</SectionTitle>
        <ol className="muted grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Step n={1} title="Upload every CV">
            Different versions for different roles, industries and countries. None is treated as
            the source of truth.
          </Step>
          <Step n={2} title="Build the Master Profile">
            Facts are merged across CVs and normalised. Each keeps the CVs it came from, and
            disagreements are flagged rather than resolved silently.
          </Step>
          <Step n={3} title="Score a job twice">
            Once against your real profile, once against the CV you would actually send. The gap
            between them is the actionable number.
          </Step>
          <Step n={4} title="Tailor, never invent">
            Re-order and re-emphasise what you can evidence. Anything unsupported is listed as
            deliberately left out.
          </Step>
        </ol>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "amber" | "red";
}) {
  const colour =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "";
  return (
    <Link href={href}>
      <Card className="p-3 transition-colors hover:border-brand-400">
        <div className="muted text-xs">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${colour}`}>{value}</div>
      </Card>
    </Link>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li>
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">
          {n}
        </span>
        <span className="font-medium" style={{ color: "var(--text)" }}>
          {title}
        </span>
      </div>
      <p className="mt-1 pl-7 text-xs leading-relaxed">{children}</p>
    </li>
  );
}
