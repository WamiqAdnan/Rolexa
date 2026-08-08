import { describeClaudeError, hasApiKey, structured } from "./anthropic";
import { TAILOR_SCHEMA, TAILOR_SYSTEM } from "./extract/schema";
import type { CvForMatching } from "./job-match";
import {
  canonicalSkill,
  countMentions,
  skillSurfaceForms,
  tokenOverlap,
} from "./normalize";
import type {
  CvExtraction,
  JobAnalysis,
  MasterProfile,
  ProfileAttribute,
  TailorResult,
} from "./types";

/**
 * Tailored CV generation.
 *
 * The model is given the base CV plus an explicit evidence pack drawn from the
 * master profile, and is told it may use nothing else. Whatever comes back is
 * then checked against the union of the source CVs, so a fabricated metric or
 * credential is caught rather than shipped.
 */

export async function tailorCv(opts: {
  baseCv: CvForMatching;
  allCvs: CvForMatching[];
  profile: MasterProfile;
  analysis: JobAnalysis;
  job: { title: string; company?: string | null; location?: string | null; description: string };
}): Promise<TailorResult> {
  const { baseCv, allCvs, profile, analysis, job } = opts;

  if (hasApiKey()) {
    try {
      const raw = await structured<{
        markdown: string;
        changesMade: string[];
        notAdded: string[];
      }>({
        system: TAILOR_SYSTEM,
        user: buildPrompt(opts),
        schema: TAILOR_SCHEMA,
        maxTokens: 32000,
        effort: "high",
      });

      const markdown = (raw.markdown ?? "").trim();
      if (markdown.length > 120) {
        return {
          markdown,
          changesMade: clean(raw.changesMade),
          notAdded: clean(raw.notAdded).length
            ? clean(raw.notAdded)
            : defaultNotAdded(analysis),
          warnings: auditFabrication(markdown, allCvs, profile),
          generator: "claude",
        };
      }
    } catch (err) {
      const result = tailorWithRules(baseCv, profile, analysis, job);
      result.warnings.unshift(
        `Claude tailoring failed (${describeClaudeError(err)}). This version was ` +
          `produced by the built-in re-ordering pass instead — it only re-arranges ` +
          `and re-labels content that already exists in your CVs.`,
      );
      return result;
    }
  }

  return tailorWithRules(baseCv, profile, analysis, job);
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function buildPrompt(opts: {
  baseCv: CvForMatching;
  allCvs: CvForMatching[];
  profile: MasterProfile;
  analysis: JobAnalysis;
  job: { title: string; company?: string | null; location?: string | null; description: string };
}): string {
  const { baseCv, allCvs, profile, analysis, job } = opts;

  const evidence = evidenceLines(profile, baseCv.id);
  const missing = analysis.matches.filter((m) => m.gap === "MISSING");
  const underplayed = analysis.matches.filter((m) => m.gap === "HAVE_NOT_EMPHASISED");
  const unclear = analysis.matches.filter((m) => m.gap === "UNCLEAR");

  return `# The job

Title: ${job.title}
${job.company ? `Company: ${job.company}\n` : ""}${job.location ? `Location: ${job.location}\n` : ""}
<advert>
${job.description}
</advert>

# What this job asks for

${analysis.requirements
  .map((r) => `- [${r.importance}] ${r.label} — "${r.quote}"`)
  .join("\n")}

# The CV you are tailoring: "${baseCv.name}"

<base-cv>
${baseCv.parsedText}
</base-cv>

# EVIDENCE — facts from the candidate's OTHER CVs you may draw on

Each line names the CVs it came from. You may incorporate these because the
candidate wrote them about themselves. Anything not listed here and not in the
base CV above does not exist.

${evidence.length ? evidence.join("\n") : "(no additional CVs uploaded yet)"}

# What the analysis found

Supported by the profile but under-emphasised in this CV — pull these forward:
${underplayed.length ? underplayed.map((m) => `- ${m.requirement.label} (mentioned ${m.cvMentions}× in this CV; evidence: ${m.profileEvidence.map((e) => e.cvName).join(", ") || "base CV"})`).join("\n") : "- (none)"}

Ambiguous — mention only if the base CV already supports it, and never overstate:
${unclear.length ? unclear.map((m) => `- ${m.requirement.label}${m.matchedLabel ? ` (${m.matchedLabel})` : ""}`).join("\n") : "- (none)"}

No supporting evidence anywhere — DO NOT ADD THESE. List each in notAdded:
${missing.length ? missing.map((m) => `- ${m.requirement.label}`).join("\n") : "- (none)"}

# Task

Rewrite "${baseCv.name}" for this job. Re-order sections and bullets so the most
relevant experience is first, sharpen wording without changing meaning, and pull
in relevant facts from the EVIDENCE section. Keep every date, employer and
qualification exactly as stated.

${allCvs.length > 1 ? `The candidate has ${allCvs.length} CVs on file; the evidence above is the union of them.` : ""}`;
}

function evidenceLines(profile: MasterProfile, baseCvId: string): string[] {
  const lines: string[] = [];
  const interesting = [
    "SKILL",
    "EXPERIENCE",
    "CERTIFICATION",
    "EDUCATION",
    "PROJECT",
    "ACHIEVEMENT",
    "LANGUAGE",
  ];

  for (const category of interesting) {
    const attrs = (profile.byCategory[category] ?? []).filter((a) => a.userStatus !== "REJECTED");
    if (!attrs.length) continue;
    lines.push(`\n## ${category}`);
    for (const attr of attrs.slice(0, 80)) {
      const sources = attr.sources.map((s) => s.cvName).join(", ");
      const inBase = attr.sources.some((s) => s.cvId === baseCvId);
      const flag =
        attr.confidence === "CONFLICTING"
          ? " [CONFLICTING — do not state a specific value]"
          : attr.confidence === "NEEDS_REVIEW"
            ? " [single source]"
            : "";
      const detail = describeAttribute(attr);
      lines.push(
        `- ${attr.label}${detail ? ` — ${detail}` : ""} (from: ${sources}${inBase ? "; already in the base CV" : ""})${flag}`,
      );
    }
  }
  return lines;
}

function describeAttribute(attr: ProfileAttribute): string {
  const d = attr.data ?? {};
  switch (attr.category) {
    case "EXPERIENCE": {
      const period = [d.startDate, d.endDate].filter(Boolean).join(" – ");
      const bullets = [...(d.achievements ?? []), ...(d.responsibilities ?? [])].slice(0, 4);
      return [period, bullets.length ? `bullets: ${bullets.join(" | ")}` : ""]
        .filter(Boolean)
        .join("; ");
    }
    case "CERTIFICATION":
      return [d.issuer, d.issueDate].filter(Boolean).join(", ");
    case "EDUCATION":
      return [d.institution, d.endDate, d.grade].filter(Boolean).join(", ");
    case "LANGUAGE":
      return d.proficiency ?? "";
    case "PROJECT":
      return d.description ?? "";
    default:
      return "";
  }
}

function clean(list: unknown): string[] {
  return Array.isArray(list)
    ? list.filter((x): x is string => typeof x === "string" && x.trim().length > 2).map((s) => s.trim())
    : [];
}

function defaultNotAdded(analysis: JobAnalysis): string[] {
  return analysis.matches
    .filter((m) => m.gap === "MISSING")
    .map((m) => `${m.requirement.label} — no supporting evidence found in any uploaded CV`);
}

/* ------------------------------------------------------------------ */
/* Fabrication audit                                                   */
/* ------------------------------------------------------------------ */

/** Credential vocabulary worth checking. A claimed credential is expensive to get wrong. */
const CREDENTIALS = [
  "PMP", "PRINCE2", "CFA", "CPA", "ACCA", "CIMA", "CSM", "CBAP", "CISSP", "CISA",
  "ITIL", "Six Sigma", "Green Belt", "Black Belt", "AWS Certified", "Azure Certified",
  "Google Certified", "Salesforce Certified", "Scrum Master", "PhD", "Doctorate",
  "MBA", "MSc", "MEng", "MA ", "BSc", "BEng", "BA ", "Bachelor", "Master",
  "Chartered", "CCNA", "CompTIA", "Tableau Certified", "Microsoft Certified",
];

/**
 * Compare the generated CV against the union of the source CVs and report
 * anything that looks like a new claim. This is a safety net, not a substitute
 * for the instruction — but a fabricated metric or credential is exactly the
 * kind of thing worth catching automatically.
 */
export function auditFabrication(
  markdown: string,
  sources: CvForMatching[],
  profile?: MasterProfile,
): string[] {
  const warnings: string[] = [];
  const haystack = sources
    .map((c) => `${c.parsedText}\n${JSON.stringify(c.extraction)}`)
    .join("\n")
    .toLowerCase();

  /* -- unresolved conflicts restated as fact --------------------- */
  for (const attr of profile?.conflicts ?? []) {
    if (attr.resolvedValue) continue; // the user has already picked a value
    const stated = (attr.variants ?? [])
      .map((v) => v.split(" — ")[0].replace(/^[^:]+:\s*/, "").trim())
      .filter((v) => v.length > 1 && countMentions(markdown, [v]) > 0);
    if (stated.length) {
      warnings.push(
        `"${attr.label}" is still unresolved across your CVs (${(attr.variants ?? []).join("; ")}), ` +
          `and this CV states ${stated.map((v) => `"${v}"`).join(" / ")}. Resolve it on your profile first.`,
      );
    }
  }

  /* -- metrics --------------------------------------------------- */
  const metricRe = /(\d[\d,]*\.?\d*)\s*(%|percent|k\b|m\b|bn\b|x\b)|([$£€]\s?\d[\d,]*\.?\d*)|\bAED\s?\d[\d,]*/gi;
  const seenMetrics = new Set<string>();
  for (const match of markdown.matchAll(metricRe)) {
    const literal = match[0].trim();
    const digits = literal.replace(/[^\d]/g, "");
    if (!digits || digits.length < 1) continue;
    if (seenMetrics.has(digits)) continue;
    seenMetrics.add(digits);
    // Look for the bare number anywhere in the sources; formatting varies.
    const withCommas = Number(digits).toLocaleString("en-US");
    if (!haystack.includes(digits) && !haystack.includes(withCommas.toLowerCase())) {
      warnings.push(
        `The figure "${literal}" does not appear in any uploaded CV. Verify it before sending.`,
      );
    }
  }

  /* -- years of experience --------------------------------------- */
  for (const match of markdown.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi)) {
    const n = match[1];
    if (!new RegExp(`${n}\\s*\\+?\\s*(?:years?|yrs?)`, "i").test(haystack)) {
      warnings.push(
        `"${match[0].trim()}" is not stated in any uploaded CV — it may have been calculated. Verify it.`,
      );
    }
  }

  /* -- credentials ------------------------------------------------ */
  for (const credential of CREDENTIALS) {
    const inOutput = countMentions(markdown, [credential.trim()]) > 0;
    if (!inOutput) continue;
    if (countMentions(haystack, [credential.trim()]) === 0) {
      warnings.push(
        `"${credential.trim()}" appears in the tailored CV but in none of your uploaded CVs. Remove it unless you actually hold it.`,
      );
    }
  }

  return Array.from(new Set(warnings)).slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback                                              */
/* ------------------------------------------------------------------ */

/**
 * No-API-key tailoring: re-order and re-group only. Every line of output is
 * copied from an existing extraction, so this path cannot invent anything.
 */
export function tailorWithRules(
  baseCv: CvForMatching,
  profile: MasterProfile,
  analysis: JobAnalysis,
  job: { title: string; company?: string | null },
): TailorResult {
  const ext: CvExtraction = baseCv.extraction;
  const changesMade: string[] = [];
  const wanted = analysis.requirements.map((r) => r.label);
  const wantedKeys = new Set(
    analysis.requirements
      .filter((r) => r.kind === "SKILL" || r.kind === "TOOL" || r.kind === "SOFT")
      .map((r) => canonicalSkill(r.label).key),
  );

  const lines: string[] = [];
  const p = ext.personal;

  lines.push(`# ${p.fullName || baseCv.name}`);
  const contact = [p.location, p.email, p.phone, ...p.links].filter(Boolean);
  if (contact.length) lines.push("", contact.join(" · "));
  if (p.headline) lines.push("", `**${p.headline}**`);
  if (p.summary) {
    lines.push("", "## Summary", "", p.summary);
    changesMade.push("Kept the existing summary verbatim — no new claims were introduced.");
  }

  /* -- skills, job-relevant first --------------------------------- */
  const baseSkillKeys = new Set(ext.skills.map((s) => canonicalSkill(s.name, s.kind).key));
  const profileSkills = (profile.byCategory.SKILL ?? []).filter(
    (a) => a.userStatus !== "REJECTED",
  );

  const relevant: string[] = [];
  const rest: string[] = [];
  const pulledIn: string[] = [];

  for (const attr of profileSkills) {
    const isRelevant = wantedKeys.has(attr.key);
    const inBase = baseSkillKeys.has(attr.key);
    if (!inBase && !isRelevant) continue; // don't bloat the CV with unrelated extras
    if (!inBase) {
      pulledIn.push(`${attr.label} (from ${attr.sources.map((s) => s.cvName).join(", ")})`);
    }
    (isRelevant ? relevant : rest).push(attr.label);
  }

  if (relevant.length || rest.length) {
    lines.push("", "## Skills", "");
    if (relevant.length) lines.push(`**Relevant to this role:** ${relevant.join(", ")}`);
    if (rest.length) lines.push("", `**Also:** ${rest.join(", ")}`);
    if (relevant.length) {
      const shown = relevant.slice(0, 8).join(", ");
      changesMade.push(
        `Moved ${relevant.length} job-relevant skill${relevant.length === 1 ? "" : "s"} to the front of the skills section` +
          (relevant.length > 8 ? `, including ${shown}.` : `: ${shown}.`),
      );
    }
    for (const s of pulledIn) {
      changesMade.push(`Added ${s} — it is evidenced in another of your CVs and this job asks for it.`);
    }
  }

  /* -- experience, bullets re-ordered ------------------------------ */
  if (ext.experience.length) {
    lines.push("", "## Experience");
    let reordered = 0;
    for (const role of ext.experience) {
      const period = [role.startDate, role.endDate].filter(Boolean).join(" – ");
      lines.push(
        "",
        `### ${role.jobTitle}${role.company ? ` — ${role.company}` : ""}`,
        [period, role.location].filter(Boolean).join(" · "),
        "",
      );
      const bullets = [...role.achievements, ...role.responsibilities];
      const scored = bullets
        .map((b) => ({ b, score: relevanceOf(b, wanted) }))
        .sort((x, y) => y.score - x.score);
      if (scored.some((s, i) => bullets[i] !== s.b)) reordered++;
      for (const { b } of scored) lines.push(`- ${b}`);
    }
    if (reordered) {
      changesMade.push(
        `Re-ordered bullets in ${reordered} role${reordered === 1 ? "" : "s"} so the ones matching this job's requirements appear first.`,
      );
    }
  }

  /* -- the rest ---------------------------------------------------- */
  if (ext.education.length) {
    lines.push("", "## Education", "");
    for (const e of ext.education) {
      lines.push(
        `- ${[e.degree, e.field && `in ${e.field}`, e.institution && `— ${e.institution}`, e.endDate && `(${e.endDate})`, e.grade]
          .filter(Boolean)
          .join(" ")}`,
      );
    }
  }
  // Certifications and languages the job asks for and another CV evidences get
  // merged in — same rule as skills: present in the library, relevant here.
  const certs = ext.certifications.map((c) =>
    [c.name, c.issuer, c.issueDate].filter(Boolean).join(" — "),
  );
  for (const extra of borrow(profile.byCategory.CERTIFICATION, ext.certifications.map((c) => c.name), wanted)) {
    certs.push(extra.text);
    changesMade.push(`Added the ${extra.label} certification (from ${extra.from}) — this job asks for it.`);
  }
  if (certs.length) {
    lines.push("", "## Certifications", "");
    for (const c of certs) lines.push(`- ${c}`);
  }
  if (ext.projects.length) {
    lines.push("", "## Projects", "");
    for (const pr of ext.projects) {
      lines.push(`- **${pr.name}** ${pr.description}`.trim());
    }
  }
  const languages = ext.languages.map((l) =>
    l.proficiency ? `${l.language} (${l.proficiency})` : l.language,
  );
  for (const extra of borrow(profile.byCategory.LANGUAGE, ext.languages.map((l) => l.language), wanted)) {
    languages.push(extra.text);
    changesMade.push(`Added ${extra.label} to Languages (from ${extra.from}) — this job asks for it.`);
  }
  if (languages.length) {
    lines.push("", "## Languages", "", languages.join(", "));
  }

  const notAdded = defaultNotAdded(analysis);
  for (const m of analysis.matches.filter((x) => x.gap === "UNCLEAR")) {
    notAdded.push(
      `${m.requirement.label} — evidence is ambiguous${m.profileConfidence === "CONFLICTING" ? " (conflicting across CVs)" : ""}; not claimed`,
    );
  }

  changesMade.push(
    `Targeted at "${job.title}"${job.company ? ` at ${job.company}` : ""} using only content already present in your CV library.`,
  );

  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    markdown,
    changesMade,
    notAdded,
    warnings: auditFabrication(markdown, [baseCv], profile),
    generator: "rules",
  };
}

/**
 * Profile entries the job asks for that the base CV doesn't already list. The
 * proficiency or issuer is carried over verbatim so nothing is upgraded.
 */
function borrow(
  pool: ProfileAttribute[] | undefined,
  alreadyPresent: string[],
  wanted: string[],
): { text: string; label: string; from: string }[] {
  const have = new Set(alreadyPresent.map((s) => s.toLowerCase().trim()));
  const out: { text: string; label: string; from: string }[] = [];

  for (const attr of pool ?? []) {
    if (attr.userStatus === "REJECTED") continue;
    if (have.has(attr.label.toLowerCase().trim())) continue;
    if (!wanted.some((w) => tokenOverlap(w, attr.label) >= 0.5)) continue;

    const detail = attr.data?.proficiency || attr.data?.issuer || "";
    out.push({
      text: detail ? `${attr.label} (${detail})` : attr.label,
      label: attr.label,
      from: attr.sources.map((s) => s.cvName).join(", "),
    });
  }
  return out;
}

function relevanceOf(bullet: string, wanted: string[]): number {
  let score = 0;
  for (const term of wanted) {
    const canon = canonicalSkill(term);
    score += countMentions(bullet, skillSurfaceForms(canon.key, canon.label)) * 2;
  }
  if (/\d+\s*%|\$|£|€|\bAED\b/.test(bullet)) score += 1; // quantified bullets read stronger
  return score;
}
