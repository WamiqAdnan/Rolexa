import Link from "next/link";

import {
  ConflictResolver,
  RebuildButton,
  ReviewActions,
} from "@/components/attribute-actions";
import {
  Card,
  ConfidenceBadge,
  Empty,
  EvidenceList,
  Pill,
  SectionTitle,
} from "@/components/ui";
import { loadMasterProfile, profileRebuiltAt, sortExperience } from "@/lib/master-profile";
import type { ProfileAttribute } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Professional Profile · Rolexa" };

const SKILL_GROUPS: [string, string, string][] = [
  ["CORE", "Core", "Disciplines you practise, independent of tooling"],
  ["TECHNICAL", "Technical", "Languages and technical capabilities"],
  ["TOOL", "Tools & platforms", "Named software you have used"],
  ["MANAGEMENT", "Management", "Leading people, projects and suppliers"],
  ["INDUSTRY", "Industry", "Domain-specific knowledge"],
  ["SOFT", "Soft skills", "Ways of working"],
];

export default async function ProfilePage() {
  const [profile, rebuiltAt] = await Promise.all([loadMasterProfile(), profileRebuiltAt()]);
  const { byCategory } = profile;

  const active = (list: ProfileAttribute[] = []) =>
    list.filter((a) => a.userStatus !== "REJECTED");

  if (!profile.cvCount) {
    return (
      <div>
        <h1 className="text-2xl font-bold">My Professional Profile</h1>
        <p className="muted mt-1 mb-6 text-sm">
          Built by combining every CV in your library.
        </p>
        <Empty>
          Nothing to aggregate yet.{" "}
          <Link href="/cvs" className="text-brand-700 hover:underline dark:text-brand-400">
            Upload a CV
          </Link>{" "}
          to get started.
        </Empty>
      </div>
    );
  }

  const skills = active(byCategory.SKILL);
  const experience = sortExperience(active(byCategory.EXPERIENCE));

  return (
    <div className="space-y-10">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">My Professional Profile</h1>
            <p className="muted mt-1 max-w-3xl text-sm">
              One combined view of your background, aggregated across{" "}
              <strong>{profile.cvCount}</strong> CV{profile.cvCount === 1 ? "" : "s"}. Every item
              keeps the CVs it came from. This is an understanding layer over your documents — it
              never adds anything they do not say.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <RebuildButton />
            {rebuiltAt ? (
              <span className="muted text-xs">
                updated {new Date(rebuiltAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Facts" value={profile.attributes.length} />
          <Stat label="🟢 Confirmed" value={profile.attributes.length - profile.needsReview.length - profile.conflicts.length} />
          <Stat label="🟡 Needs review" value={profile.needsReview.length} />
          <Stat label="🔴 Conflicting" value={profile.conflicts.length} />
        </div>
      </header>

      {profile.conflicts.length ? (
        <section>
          <SectionTitle hint="Your CVs disagree. Pick the correct value — Rolexa will not choose for you.">
            ⚠️ Conflicts to resolve
          </SectionTitle>
          <div className="space-y-3">
            {profile.conflicts.map((attr) => (
              <Card key={attr.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{attr.label}</span>
                  <Pill tone="neutral">{attr.category.replace(/_/g, " ").toLowerCase()}</Pill>
                </div>
                <EvidenceList sources={attr.sources} />
                <ConflictResolver attribute={attr} />
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------- identity */}
      {active(byCategory.PERSONAL).length || active(byCategory.EXPERIENCE_YEARS).length ? (
        <section>
          <SectionTitle>Identity</SectionTitle>
          <Card className="divide-y p-0 [&>*]:hairline">
            {[...active(byCategory.PERSONAL), ...active(byCategory.EXPERIENCE_YEARS)].map((attr) => (
              <div key={attr.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="muted w-40 text-xs">{attr.label}</span>
                <span className="text-sm font-medium">
                  {attr.resolvedValue ?? attr.data?.value ?? "—"}
                </span>
                <ConfidenceBadge confidence={attr.confidence} withLabel={false} />
                <div className="ml-auto">
                  <EvidenceList sources={attr.sources} />
                </div>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {/* ------------------------------------------------ experience */}
      <section>
        <SectionTitle hint="Merged across CVs — where two CVs describe the same role differently, both wordings are kept.">
          Experience
        </SectionTitle>
        {experience.length ? (
          <ol className="space-y-3">
            {experience.map((attr) => {
              const d = attr.data ?? {};
              const titles: string[] = d.titles ?? [d.jobTitle].filter(Boolean);
              return (
                <li key={attr.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {titles[0]}
                          {d.company ? <span className="muted"> · {d.company}</span> : null}
                        </p>
                        <p className="muted text-xs">
                          {[
                            [d.startDate, d.endDate].filter(Boolean).join(" – "),
                            d.location,
                            d.industry,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {titles.length > 1 ? (
                          <p className="muted mt-1 text-xs">
                            Also described as: {titles.slice(1).join("; ")}
                          </p>
                        ) : null}
                      </div>
                      <ConfidenceBadge confidence={attr.confidence} />
                    </div>

                    {d.achievements?.length ? (
                      <ul className="mt-2 list-disc pl-5 text-sm">
                        {d.achievements.slice(0, 6).map((a: string, i: number) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                    {d.responsibilities?.length ? (
                      <ul className="muted mt-1 list-disc pl-5 text-sm">
                        {d.responsibilities.slice(0, 6).map((r: string, i: number) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : null}

                    <EvidenceList sources={attr.sources} />
                    {attr.confidence === "CONFLICTING" ? (
                      <ConflictResolver attribute={attr} />
                    ) : attr.confidence === "NEEDS_REVIEW" ? (
                      <div className="mt-2">
                        <ReviewActions attribute={attr} />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty>No employment history extracted yet.</Empty>
        )}
      </section>

      {/* ---------------------------------------------------- skills */}
      <section>
        <SectionTitle hint="Normalised across CVs — “PowerBI”, “Microsoft Power BI” and “Power BI” are one skill. Hover a chip to see how each CV wrote it.">
          Skills
        </SectionTitle>
        {skills.length ? (
          <div className="space-y-4">
            {SKILL_GROUPS.map(([group, title, hint]) => {
              const items = skills.filter((s) => s.group === group);
              if (!items.length) return null;
              return (
                <Card key={group} className="p-4">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="muted mb-2 text-xs">{hint}</p>
                  <ul className="flex flex-wrap gap-2">
                    {items.map((attr) => (
                      <li key={attr.id}>
                        <details className="group">
                          <summary className="hairline flex cursor-pointer list-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm hover:bg-ink-100 dark:hover:bg-ink-800">
                            <ConfidenceBadge confidence={attr.confidence} withLabel={false} />
                            {attr.label}
                            <span className="muted text-xs">{attr.sources.length}</span>
                          </summary>
                          <div className="hairline mt-1 rounded-lg border p-2 text-xs">
                            {attr.sources.map((s) => (
                              <div key={s.cvId} className="py-0.5">
                                <Link href={`/cvs/${s.cvId}`} className="font-medium hover:underline">
                                  {s.cvName}
                                </Link>
                                <span className="muted"> — written as “{s.rawLabel}”</span>
                                {s.snippet ? (
                                  <p className="muted mt-0.5 italic">{s.snippet}</p>
                                ) : null}
                              </div>
                            ))}
                            {attr.confidence === "NEEDS_REVIEW" ? (
                              <div className="mt-1.5">
                                <ReviewActions attribute={attr} />
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty>No skills extracted yet.</Empty>
        )}
      </section>

      <EvidenceSection
        title="Education"
        attrs={active(byCategory.EDUCATION)}
        detail={(d) => [d.institution, d.endDate, d.grade].filter(Boolean).join(" · ")}
      />
      <EvidenceSection
        title="Certifications"
        attrs={active(byCategory.CERTIFICATION)}
        detail={(d) => [d.issuer, d.issueDate].filter(Boolean).join(" · ")}
      />
      <EvidenceSection
        title="Projects"
        attrs={active(byCategory.PROJECT)}
        detail={(d) => d?.description ?? ""}
      />
      <EvidenceSection
        title="Achievements"
        attrs={active(byCategory.ACHIEVEMENT)}
        detail={(d) => d?.context ?? ""}
      />
      <EvidenceSection
        title="Languages"
        attrs={active(byCategory.LANGUAGE)}
        detail={(d) => d?.proficiency ?? ""}
      />
      <EvidenceSection title="Licences" attrs={active(byCategory.LICENCE)} />
      <EvidenceSection title="Awards" attrs={active(byCategory.AWARD)} />
      <EvidenceSection title="Publications" attrs={active(byCategory.PUBLICATION)} />

      <section className="grid gap-4 md:grid-cols-2">
        <ChipSection
          title="Target roles"
          hint="From CV headlines and the target role you set on each upload."
          attrs={active(byCategory.TARGET_ROLE)}
        />
        <ChipSection
          title="Target industries"
          hint="From the industry you set on each upload."
          attrs={active(byCategory.TARGET_INDUSTRY)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ChipSection
          title="Companies"
          hint="Every employer named across your CVs."
          attrs={active(byCategory.COMPANY)}
        />
        <ChipSection
          title="Industries worked in"
          hint="Extracted from your employment history."
          attrs={active(byCategory.INDUSTRY)}
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="muted text-xs">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </Card>
  );
}

function EvidenceSection({
  title,
  attrs,
  detail,
}: {
  title: string;
  attrs: ProfileAttribute[];
  detail?: (data: any) => string;
}) {
  if (!attrs.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-2">
        {attrs.map((attr) => {
          const extra = detail?.(attr.data) ?? "";
          return (
            <Card key={attr.id} className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {attr.resolvedValue ? `${attr.label} (${attr.resolvedValue})` : attr.label}
                  </p>
                  {extra ? <p className="muted text-xs">{extra}</p> : null}
                </div>
                <ConfidenceBadge confidence={attr.confidence} />
              </div>
              <EvidenceList sources={attr.sources} />
              {attr.confidence === "CONFLICTING" ? (
                <ConflictResolver attribute={attr} />
              ) : attr.confidence === "NEEDS_REVIEW" ? (
                <div className="mt-1.5">
                  <ReviewActions attribute={attr} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function ChipSection({
  title,
  hint,
  attrs,
}: {
  title: string;
  hint: string;
  attrs: ProfileAttribute[];
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="muted mb-2 text-xs">{hint}</p>
      {attrs.length ? (
        <div className="flex flex-wrap gap-1.5">
          {attrs.map((attr) => (
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
        <p className="muted text-sm">Nothing yet.</p>
      )}
    </Card>
  );
}
