import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteVersionButton, ReprocessButton } from "@/components/cv-actions";
import { Markdown } from "@/components/markdown";
import { Card, Empty, Pill, SectionTitle, StatusPill } from "@/components/ui";
import { json, prisma } from "@/lib/db";
import { canonicalSkill } from "@/lib/normalize";
import type { CvExtraction } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CvDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cv = await prisma.cv.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: "asc" }, include: { job: true } } },
  });
  if (!cv) notFound();

  const ext = json<CvExtraction | null>(cv.extraction, null);

  return (
    <div className="space-y-8">
      <header>
        <Link href="/cvs" className="muted text-sm hover:underline">
          ← CV Library
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{cv.name}</h1>
            <p className="muted mt-1 text-sm">
              {cv.fileName} · uploaded {new Date(cv.uploadedAt).toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={cv.status} />
              {cv.extractedBy ? (
                <Pill tone="neutral">
                  extracted by {cv.extractedBy === "claude" ? "Claude" : "built-in parser"}
                </Pill>
              ) : null}
              {cv.targetRole ? <Pill>🎯 {cv.targetRole}</Pill> : null}
              {cv.industry ? <Pill>🏢 {cv.industry}</Pill> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/cvs/${cv.id}/file`}
              className="hairline rounded-md border px-2.5 py-1 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
            >
              Download original
            </a>
            <ReprocessButton cvId={cv.id} />
          </div>
        </div>
        {cv.error ? (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-sm ${
              cv.status === "FAILED"
                ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            }`}
          >
            {cv.error}
          </p>
        ) : null}
      </header>

      {/* -------------------------------------------------- versions */}
      <section>
        <SectionTitle hint="The original is never overwritten. Every tailored CV is stored as a new version.">
          Versions
        </SectionTitle>
        <div className="space-y-3">
          {cv.versions.map((version) => {
            const changes = json<{
              changesMade?: string[];
              notAdded?: string[];
              warnings?: string[];
            }>(version.changes, {});
            return (
              <Card key={version.id} className="p-4">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                    <span>{version.label}</span>
                    <Pill tone={version.kind === "ORIGINAL" ? "neutral" : "blue"}>
                      {version.kind === "ORIGINAL" ? "Original" : "Tailored"}
                    </Pill>
                    {version.job ? (
                      <span className="muted text-xs">for {version.job.title}</span>
                    ) : null}
                    <span className="muted ml-auto text-xs">
                      {new Date(version.createdAt).toLocaleDateString()}
                    </span>
                  </summary>

                  <div className="mt-4 space-y-4">
                    {changes.warnings?.length ? (
                      <div className="rounded-md bg-red-100 p-3 text-sm dark:bg-red-950">
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

                    {changes.changesMade?.length ? (
                      <div>
                        <h4 className="text-xs font-semibold tracking-wide uppercase">
                          Changes made
                        </h4>
                        <ul className="muted mt-1 list-disc pl-5 text-sm">
                          {changes.changesMade.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {changes.notAdded?.length ? (
                      <div>
                        <h4 className="text-xs font-semibold tracking-wide uppercase">
                          Information intentionally NOT added
                        </h4>
                        <ul className="muted mt-1 list-disc pl-5 text-sm">
                          {changes.notAdded.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="hairline rounded-lg border p-4">
                      {version.kind === "ORIGINAL" ? (
                        <pre className="max-h-[28rem] overflow-auto text-xs whitespace-pre-wrap">
                          {version.content}
                        </pre>
                      ) : (
                        <div className="max-h-[36rem] overflow-auto">
                          <Markdown source={version.content} />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <a
                        href={`/api/versions/${version.id}?download=1`}
                        className="text-xs text-brand-700 hover:underline dark:text-brand-400"
                      >
                        Download .md
                      </a>
                      {version.kind !== "ORIGINAL" ? (
                        <DeleteVersionButton versionId={version.id} />
                      ) : null}
                    </div>
                  </div>
                </details>
              </Card>
            );
          })}
          {!cv.versions.length ? <Empty>No versions yet.</Empty> : null}
        </div>
      </section>

      {/* ------------------------------------------------ extraction */}
      <section>
        <SectionTitle hint="What Rolexa read out of this specific file. This feeds the Master Profile.">
          Extracted information
        </SectionTitle>

        {!ext ? (
          <Empty>
            {cv.status === "FAILED"
              ? "Extraction failed — see the error above."
              : "Still processing. Reload in a moment."}
          </Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Personal</h3>
              <Facts
                rows={[
                  ["Name", ext.personal.fullName],
                  ["Location", ext.personal.location],
                  ["Email", ext.personal.email],
                  ["Phone", ext.personal.phone],
                  ["Headline", ext.personal.headline],
                  [
                    "Stated years of experience",
                    ext.totalYearsExperience
                      ? `${ext.totalYearsExperience}${ext.totalYearsEvidence ? ` — “${ext.totalYearsEvidence}”` : ""}`
                      : "",
                  ],
                  ["Links", ext.personal.links.join(" · ")],
                ]}
              />
              {ext.personal.summary ? (
                <p className="muted mt-3 border-t pt-3 text-sm hairline">{ext.personal.summary}</p>
              ) : null}
            </Card>

            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">
                Skills{" "}
                <span className="muted font-normal">({ext.skills.length})</span>
              </h3>
              {ext.skills.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {ext.skills.map((s, i) => {
                    const canon = canonicalSkill(s.name, s.kind);
                    return (
                      <Pill
                        key={`${s.name}-${i}`}
                        title={
                          canon.label !== s.name
                            ? `Written as "${s.name}", normalised to "${canon.label}"`
                            : undefined
                        }
                      >
                        {s.name}
                      </Pill>
                    );
                  })}
                </div>
              ) : (
                <p className="muted text-sm">None found.</p>
              )}
            </Card>

            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold">
                Experience <span className="muted font-normal">({ext.experience.length})</span>
              </h3>
              {ext.experience.length ? (
                <ol className="space-y-4">
                  {ext.experience.map((role, i) => (
                    <li key={i} className="hairline border-l-2 pl-3">
                      <p className="text-sm font-medium">
                        {role.jobTitle}
                        {role.company ? ` — ${role.company}` : ""}
                      </p>
                      <p className="muted text-xs">
                        {[
                          [role.startDate, role.endDate].filter(Boolean).join(" – "),
                          role.location,
                          role.industry,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {role.achievements.length ? (
                        <ul className="mt-1.5 list-disc pl-4 text-sm">
                          {role.achievements.map((a, j) => (
                            <li key={j}>{a}</li>
                          ))}
                        </ul>
                      ) : null}
                      {role.responsibilities.length ? (
                        <ul className="muted mt-1 list-disc pl-4 text-sm">
                          {role.responsibilities.map((r, j) => (
                            <li key={j}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                      {role.technologies.length ? (
                        <p className="muted mt-1.5 text-xs">
                          Tech: {role.technologies.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted text-sm">No employment history found.</p>
              )}
            </Card>

            <ListCard
              title="Education"
              items={ext.education.map((e) =>
                [e.degree, e.field && `in ${e.field}`, e.institution && `— ${e.institution}`, e.endDate && `(${e.endDate})`, e.grade]
                  .filter(Boolean)
                  .join(" "),
              )}
            />
            <ListCard
              title="Certifications"
              items={ext.certifications.map((c) =>
                [c.name, c.issuer, c.issueDate].filter(Boolean).join(" — "),
              )}
            />
            <ListCard
              title="Projects"
              items={ext.projects.map((p) => [p.name, p.description].filter(Boolean).join(" — "))}
            />
            <ListCard
              title="Languages"
              items={ext.languages.map((l) =>
                l.proficiency ? `${l.language} (${l.proficiency})` : l.language,
              )}
            />
            <ListCard title="Licences" items={ext.licences} />
            <ListCard title="Awards" items={ext.awards} />
            <ListCard title="Publications" items={ext.publications} />
            <ListCard title="Other" items={ext.additional} />
          </div>
        )}
      </section>

      {/* ---------------------------------------------- parsed text */}
      {cv.parsedText ? (
        <section>
          <SectionTitle>Parsed text</SectionTitle>
          <Card className="p-4">
            <details>
              <summary className="muted cursor-pointer text-sm">
                Show the raw text Rolexa read from this file
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
                {cv.parsedText}
              </pre>
            </details>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  const present = rows.filter(([, value]) => value);
  if (!present.length) return <p className="muted text-sm">Nothing found.</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {present.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="muted text-xs whitespace-nowrap">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  const present = items.filter(Boolean);
  if (!present.length) return null;
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">
        {title} <span className="muted font-normal">({present.length})</span>
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {present.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}
