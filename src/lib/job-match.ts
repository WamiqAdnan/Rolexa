import { hasModel, modelTag, structured } from "./anthropic";
import { JOB_REQUIREMENTS_SCHEMA, JOB_REQUIREMENTS_SYSTEM } from "./extract/schema";
import {
  canonicalRole,
  canonicalSkill,
  contentTokens,
  countMentions,
  degreeLevel,
  degreeSubject,
  parseYears,
  skillSurfaceForms,
  skillsRelated,
  slug,
  stripSkillFiller,
  tokenOverlap,
} from "./normalize";
import type {
  Confidence,
  CvAlignment,
  CvExtraction,
  GapBucket,
  JobAnalysis,
  JobRequirement,
  MasterProfile,
  MatchLevel,
  ProfileAttribute,
  RequirementImportance,
  RequirementKind,
  RequirementMatch,
} from "./types";

export type CvForMatching = {
  id: string;
  name: string;
  parsedText: string;
  extraction: CvExtraction;
};

export type JobInput = {
  title: string;
  company?: string | null;
  location?: string | null;
  description: string;
};

/* ------------------------------------------------------------------ */
/* Requirement extraction                                              */
/* ------------------------------------------------------------------ */

type RawRequirements = {
  title: string;
  company: string;
  location: string;
  seniority: string;
  requirements: {
    label: string;
    kind: string;
    importance: string;
    quote: string;
  }[];
};

export async function extractRequirements(
  job: JobInput,
): Promise<{ requirements: JobRequirement[]; by: "claude" | "ollama" | "rules" }> {
  if (hasModel()) {
    try {
      const raw = await structured<RawRequirements>({
        system: JOB_REQUIREMENTS_SYSTEM,
        user:
          `Job title: ${job.title}\n` +
          (job.company ? `Company: ${job.company}\n` : "") +
          (job.location ? `Location: ${job.location}\n` : "") +
          `\n<advert>\n${job.description}\n</advert>`,
        schema: JOB_REQUIREMENTS_SCHEMA,
        maxTokens: 16000,
        effort: "medium",
      });
      const requirements = dedupeRequirements(
        (raw.requirements ?? [])
          .filter((r) => r?.label?.trim())
          .map((r) => toRequirement(r.label, r.kind, r.importance, r.quote)),
      );
      if (requirements.length) return { requirements, by: modelTag() };
    } catch {
      // fall through to the deterministic reader
    }
  }
  return { requirements: requirementsFromRules(job), by: "rules" };
}

function toRequirement(
  label: string,
  kind: string,
  importance: string,
  quote: string,
): JobRequirement {
  const cleanLabel = label.trim().replace(/\s+/g, " ");
  const upperKind = kind?.toUpperCase();
  const resolvedKind: RequirementKind = (
    ["SKILL", "TOOL", "ROLE", "EXPERIENCE", "EDUCATION", "CERTIFICATION", "LANGUAGE", "SOFT", "OTHER"].includes(
      upperKind,
    )
      ? upperKind
      : "OTHER"
  ) as RequirementKind;

  return {
    label: cleanLabel,
    key: keyFor(cleanLabel, resolvedKind),
    kind: resolvedKind,
    importance: (importance?.toUpperCase() === "NICE" ? "NICE" : "MUST") as RequirementImportance,
    // Drop the advert's own bullet glyph so the quote reads as a sentence.
    quote: (quote || cleanLabel).trim().replace(/^\s*(?:[-*+•·]\s*|\d+[.)]\s*)/, ""),
  };
}

function keyFor(label: string, kind: RequirementKind): string {
  if (kind === "ROLE") return canonicalRole(label).key;
  if (kind === "SKILL" || kind === "TOOL" || kind === "SOFT") {
    // Adverts pad skill names ("Advanced SQL skills"). Strip the padding first
    // or the key becomes `sql-skills` and stops matching the profile's `sql`.
    return canonicalSkill(stripSkillFiller(label) || label).key;
  }
  return slug(label).slice(0, 80);
}

function dedupeRequirements(list: JobRequirement[]): JobRequirement[] {
  const map = new Map<string, JobRequirement>();
  for (const req of list) {
    const existing = map.get(req.key);
    if (!existing) {
      map.set(req.key, req);
    } else if (existing.importance === "NICE" && req.importance === "MUST") {
      // A requirement stated in both lists is essential.
      map.set(req.key, { ...existing, importance: "MUST" });
    }
  }
  return [...map.values()];
}

/** No-API-key path: read the advert with a dictionary and some structure cues. */
function requirementsFromRules(job: JobInput): JobRequirement[] {
  const lines = job.description.split("\n").map((l) => l.trim());
  const found: JobRequirement[] = [];

  let importance: RequirementImportance = "MUST";
  const niceHeading = /\b(desirable|nice[- ]to[- ]have|preferred|bonus|advantageous|a plus)\b/i;
  const mustHeading = /\b(essential|required|requirements|must[- ]have|what you'?ll need|qualifications)\b/i;

  const seen = new Set<string>();
  const push = (label: string, kind: RequirementKind, quote: string) => {
    const req = toRequirement(label, kind, importance, quote);
    if (seen.has(req.key)) return;
    seen.add(req.key);
    found.push(req);
  };

  for (const line of lines) {
    if (!line) continue;
    if (line.length < 60 && niceHeading.test(line)) importance = "NICE";
    else if (line.length < 60 && mustHeading.test(line)) importance = "MUST";

    // Dictionary skills named on this line.
    for (const label of DICTIONARY_LABELS) {
      const forms = skillSurfaceForms(canonicalSkill(label).key, label);
      if (countMentions(line, forms) > 0) push(label, "SKILL", line);
    }

    const years = line.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i);
    if (years) push(`${years[1]}+ years of experience`, "EXPERIENCE", line);

    const degree = line.match(
      /\b(bachelor'?s?|master'?s?|b\.?sc|m\.?sc|mba|ph\.?d|degree|diploma)\b[^.,;]{0,60}/i,
    );
    if (degree) push(degree[0].trim(), "EDUCATION", line);

    const cert = line.match(
      /\b(pmp|prince2|cfa|cpa|acca|cima|csm|cbap|aws certified|azure certified|google certified|itil|six sigma)\b/i,
    );
    if (cert) push(cert[0].trim(), "CERTIFICATION", line);

    const lang = line.match(/\b(arabic|english|french|german|spanish|mandarin|hindi|urdu)\b/i);
    if (lang && /\b(fluent|speaker|proficiency|language|bilingual)\b/i.test(line)) {
      push(lang[0], "LANGUAGE", line);
    }
  }

  // The advertised title is itself a requirement.
  if (job.title) {
    const req = toRequirement(job.title, "ROLE", "MUST", `Job title: ${job.title}`);
    if (!seen.has(req.key)) found.unshift(req);
  }

  return found;
}

const DICTIONARY_LABELS = [
  "SQL", "Python", "R", "Power BI", "Tableau", "Excel", "Looker", "Qlik", "SSRS", "SSIS",
  "DAX", "Power Query", "Snowflake", "BigQuery", "Redshift", "Databricks", "AWS", "Azure",
  "GCP", "Docker", "Kubernetes", "Git", "Airflow", "Spark", "Hadoop", "JavaScript",
  "TypeScript", "Java", "Scala", "VBA", "MySQL", "PostgreSQL", "SQL Server", "Oracle",
  "MongoDB", "Data Analysis", "Business Analysis", "Data Visualisation", "Reporting",
  "Dashboarding", "Data Modelling", "ETL", "Data Warehousing", "Data Quality",
  "Data Governance", "Statistics", "Forecasting", "Machine Learning", "Financial Modelling",
  "Budgeting", "Agile", "Scrum", "Kanban", "PRINCE2", "Six Sigma", "Process Improvement",
  "Requirements Gathering", "User Stories", "UAT", "Gap Analysis", "Process Mapping",
  "Project Management", "Programme Management", "Stakeholder Management", "Team Leadership",
  "Vendor Management", "Risk Management", "Change Management", "Mentoring", "Communication",
  "Presentation", "Problem Solving", "Collaboration", "Negotiation",
];

/* ------------------------------------------------------------------ */
/* Profile index                                                       */
/* ------------------------------------------------------------------ */

type ProfileIndex = {
  byCategory: Record<string, ProfileAttribute[]>;
  skills: Map<string, ProfileAttribute>;
  roles: Map<string, ProfileAttribute>;
  roleFamilies: Map<string, ProfileAttribute[]>;
  statedYears: number | null;
  derivedYears: number | null;
};

function indexProfile(profile: MasterProfile): ProfileIndex {
  const skills = new Map<string, ProfileAttribute>();
  const roles = new Map<string, ProfileAttribute>();
  const roleFamilies = new Map<string, ProfileAttribute[]>();

  // A fact the user marked "not applicable" is not evidence for a job match.
  const byCategory: Record<string, ProfileAttribute[]> = {};
  for (const [category, attrs] of Object.entries(profile.byCategory)) {
    byCategory[category] = attrs.filter((a) => a.userStatus !== "REJECTED");
  }

  for (const attr of byCategory.SKILL ?? []) skills.set(attr.key, attr);
  for (const attr of byCategory.ROLE ?? []) {
    roles.set(attr.key, attr);
    const family = attr.data?.family;
    if (!family) continue;
    const bucket = roleFamilies.get(family);
    if (bucket) bucket.push(attr);
    else roleFamilies.set(family, [attr]);
  }

  const yearsAttr = (byCategory.EXPERIENCE_YEARS ?? [])[0];
  const statedYears = yearsAttr
    ? parseYears(String(yearsAttr.resolvedValue ?? yearsAttr.data?.value ?? ""))
    : null;

  return {
    byCategory,
    skills,
    roles,
    roleFamilies,
    statedYears,
    derivedYears: deriveYearsFromTimeline(byCategory.EXPERIENCE ?? []),
  };
}

/**
 * Years implied by the employment timeline. This is a derived figure used only
 * for matching — it never becomes a profile fact, and any requirement it
 * satisfies is reported as UNCLEAR so the user verifies it.
 */
function deriveYearsFromTimeline(experience: ProfileAttribute[]): number | null {
  const spans: [number, number][] = [];
  const now = new Date().getFullYear() + new Date().getMonth() / 12;

  for (const attr of experience) {
    const start = yearValue(String(attr.data?.startDate ?? ""));
    if (start === null) continue;
    const endRaw = String(attr.data?.endDate ?? "");
    const end = /present/i.test(endRaw) ? now : yearValue(endRaw);
    spans.push([start, end ?? start]);
  }
  if (!spans.length) return null;

  // Union of the intervals, so concurrent roles aren't double-counted.
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  total += ce - cs;
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

function yearValue(v: string): number | null {
  const m = v.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

type ProfileHit = {
  level: MatchLevel;
  attribute: ProfileAttribute | null;
  confidence: Confidence | null;
  note?: string;
};

function matchProfile(req: JobRequirement, idx: ProfileIndex): ProfileHit {
  const miss: ProfileHit = { level: "NONE", attribute: null, confidence: null };

  switch (req.kind) {
    case "SKILL":
    case "TOOL":
    case "SOFT": {
      const key = canonicalSkill(stripSkillFiller(req.label) || req.label).key;
      const direct = idx.skills.get(key);
      if (direct) return { level: "DIRECT", attribute: direct, confidence: direct.confidence };
      for (const [otherKey, attr] of idx.skills) {
        if (skillsRelated(key, otherKey)) {
          return { level: "RELATED", attribute: attr, confidence: attr.confidence };
        }
      }
      return fuzzy(req, [...idx.skills.values()]) ?? miss;
    }

    case "ROLE": {
      const canon = canonicalRole(req.label);
      const direct = idx.roles.get(canon.key);
      if (direct) return { level: "DIRECT", attribute: direct, confidence: direct.confidence };
      if (canon.family) {
        const family = idx.roleFamilies.get(canon.family);
        if (family?.length) {
          return { level: "RELATED", attribute: family[0], confidence: family[0].confidence };
        }
      }
      return fuzzy(req, [...idx.roles.values()]) ?? miss;
    }

    case "EXPERIENCE": {
      const wanted = parseYears(req.label);
      if (wanted !== null) {
        if (idx.statedYears !== null) {
          const attr = (idx.byCategory.EXPERIENCE_YEARS ?? [])[0] ?? null;
          return idx.statedYears >= wanted
            ? { level: "DIRECT", attribute: attr, confidence: attr?.confidence ?? null }
            : { level: "RELATED", attribute: attr, confidence: attr?.confidence ?? null,
                note: `Profile states ${idx.statedYears} years against ${wanted} required` };
        }
        if (idx.derivedYears !== null) {
          return {
            level: idx.derivedYears >= wanted ? "RELATED" : "NONE",
            attribute: null,
            confidence: null,
            note:
              `~${idx.derivedYears} years implied by the employment timeline. ` +
              `No CV states a total — please verify.`,
          };
        }
        return miss;
      }
      // Domain experience, e.g. "experience in retail banking".
      const pool = [
        ...(idx.byCategory.INDUSTRY ?? []),
        ...(idx.byCategory.EXPERIENCE ?? []),
        ...(idx.byCategory.COMPANY ?? []),
        ...idx.skills.values(),
      ];
      return fuzzy(req, pool) ?? miss;
    }

    case "EDUCATION": {
      const held = idx.byCategory.EDUCATION ?? [];
      const byLevel = matchDegree(req.label, held.map((a) => ({ text: a.label, attr: a })));
      if (byLevel) {
        return { level: byLevel.level, attribute: byLevel.attr, confidence: byLevel.attr.confidence };
      }
      return fuzzy(req, held, 0.3) ?? miss;
    }
    case "CERTIFICATION":
      return fuzzy(req, idx.byCategory.CERTIFICATION ?? [], 0.4) ?? miss;
    case "LANGUAGE":
      return fuzzy(req, idx.byCategory.LANGUAGE ?? [], 0.5) ?? miss;
    default: {
      const pool = [
        ...idx.skills.values(),
        ...(idx.byCategory.EXPERIENCE ?? []),
        ...(idx.byCategory.ACHIEVEMENT ?? []),
        ...(idx.byCategory.PROJECT ?? []),
      ];
      return fuzzy(req, pool) ?? miss;
    }
  }
}

/**
 * Match a qualification requirement by level, so "BSc in Statistics" satisfies
 * "Bachelor's degree in a quantitative discipline" and a Master's satisfies a
 * Bachelor's ask. A named subject that doesn't overlap downgrades to RELATED
 * rather than claiming an exact match.
 */
function matchDegree<T>(
  requirement: string,
  held: { text: string; attr: T }[],
): { level: MatchLevel; attr: T } | null {
  const wanted = degreeLevel(requirement);
  if (wanted === null || !held.length) return null;

  const wantedSubject = degreeSubject(requirement);
  let best: { level: MatchLevel; attr: T } | null = null;

  for (const item of held) {
    const level = degreeLevel(item.text);
    if (level === null || level < wanted) continue;

    const subjectMatches =
      !wantedSubject || tokenOverlap(wantedSubject, degreeSubject(item.text)) > 0;
    const result = { level: (subjectMatches ? "DIRECT" : "RELATED") as MatchLevel, attr: item.attr };
    if (result.level === "DIRECT") return result;
    best ??= result;
  }
  return best;
}

function fuzzy(
  req: JobRequirement,
  pool: ProfileAttribute[],
  relatedFloor = 0.34,
): ProfileHit | null {
  let best: { attr: ProfileAttribute; score: number } | null = null;
  for (const attr of pool) {
    const score = Math.max(
      tokenOverlap(req.label, attr.label),
      ...attr.sources.map((s) => tokenOverlap(req.label, s.rawLabel)),
    );
    if (!best || score > best.score) best = { attr, score };
  }
  if (!best || best.score < relatedFloor) return null;
  return {
    level: best.score >= 0.6 ? "DIRECT" : "RELATED",
    attribute: best.attr,
    confidence: best.attr.confidence,
  };
}

/* ------------------------------------------------------------------ */
/* Per-CV alignment                                                    */
/* ------------------------------------------------------------------ */

type CvIndex = {
  cv: CvForMatching;
  skills: Set<string>;
  roles: Set<string>;
  roleFamilies: Set<string>;
  certs: string[];
  education: string[];
  languages: string[];
  freeText: string;
};

function indexCv(cv: CvForMatching): CvIndex {
  const ext = cv.extraction;
  const skills = new Set<string>();
  for (const s of ext.skills ?? []) skills.add(canonicalSkill(s.name, s.kind).key);
  for (const role of ext.experience ?? []) {
    for (const tech of role.technologies) skills.add(canonicalSkill(tech).key);
  }
  for (const p of ext.projects ?? []) {
    for (const tech of p.technologies) skills.add(canonicalSkill(tech).key);
  }

  const roles = new Set<string>();
  const roleFamilies = new Set<string>();
  for (const role of ext.experience ?? []) {
    const canon = canonicalRole(role.jobTitle);
    roles.add(canon.key);
    if (canon.family) roleFamilies.add(canon.family);
  }

  return {
    cv,
    skills,
    roles,
    roleFamilies,
    certs: (ext.certifications ?? []).map((c) => c.name),
    education: (ext.education ?? []).map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(" ")),
    languages: (ext.languages ?? []).map((l) => l.language),
    freeText: cv.parsedText,
  };
}

function matchCv(req: JobRequirement, idx: CvIndex): MatchLevel {
  switch (req.kind) {
    case "SKILL":
    case "TOOL":
    case "SOFT": {
      const key = canonicalSkill(stripSkillFiller(req.label) || req.label).key;
      if (idx.skills.has(key)) return "DIRECT";
      for (const other of idx.skills) if (skillsRelated(key, other)) return "RELATED";
      return mentionsIn(req, idx) ? "RELATED" : "NONE";
    }
    case "ROLE": {
      const canon = canonicalRole(req.label);
      if (idx.roles.has(canon.key)) return "DIRECT";
      if (canon.family && idx.roleFamilies.has(canon.family)) return "RELATED";
      return "NONE";
    }
    case "CERTIFICATION":
      return bestOverlap(req.label, idx.certs) >= 0.5 ? "DIRECT" : "NONE";
    case "EDUCATION": {
      const byLevel = matchDegree(
        req.label,
        idx.education.map((text) => ({ text, attr: text })),
      );
      if (byLevel) return byLevel.level;
      return bestOverlap(req.label, idx.education) >= 0.3 ? "DIRECT" : "NONE";
    }
    case "LANGUAGE":
      return bestOverlap(req.label, idx.languages) >= 0.5 ? "DIRECT" : "NONE";
    case "EXPERIENCE": {
      const wanted = parseYears(req.label);
      if (wanted !== null) {
        const stated = parseYears(idx.cv.extraction.totalYearsExperience ?? "");
        if (stated !== null) return stated >= wanted ? "DIRECT" : "RELATED";
        return "NONE";
      }
      return mentionsIn(req, idx) ? "DIRECT" : "NONE";
    }
    default:
      return mentionsIn(req, idx) ? "DIRECT" : "NONE";
  }
}

function mentionsIn(req: JobRequirement, idx: CvIndex): boolean {
  return mentionCount(req, idx.freeText) > 0;
}

function mentionCount(req: JobRequirement, text: string): number {
  if (!text) return 0;
  if (req.kind === "SKILL" || req.kind === "TOOL" || req.kind === "SOFT") {
    const canon = canonicalSkill(stripSkillFiller(req.label) || req.label);
    return countMentions(text, skillSurfaceForms(canon.key, canon.label));
  }
  const tokens = contentTokens(req.label).filter((t) => t.length > 3);
  if (!tokens.length) return countMentions(text, [req.label]);
  // Count lines that carry most of the requirement's content words.
  const needed = Math.max(1, Math.ceil(tokens.length * 0.6));
  let hits = 0;
  for (const line of text.toLowerCase().split("\n")) {
    if (tokens.filter((t) => line.includes(t)).length >= needed) hits++;
  }
  return hits;
}

function bestOverlap(label: string, pool: string[]): number {
  return pool.reduce((max, item) => Math.max(max, tokenOverlap(label, item)), 0);
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const WEIGHT: Record<RequirementImportance, number> = { MUST: 3, NICE: 1 };

const CONFIDENCE_FACTOR: Record<Confidence, number> = {
  CONFIRMED: 1,
  NEEDS_REVIEW: 0.8,
  CONFLICTING: 0.6,
};

function profileCredit(hit: ProfileHit): number {
  if (hit.level === "NONE") return 0;
  const base = hit.level === "DIRECT" ? 1 : 0.5;
  const factor = hit.confidence ? CONFIDENCE_FACTOR[hit.confidence] : 0.7;
  return base * factor;
}

function cvCredit(level: MatchLevel, mentions: number): number {
  if (level === "NONE") return 0;
  if (level === "RELATED") return 0.45;
  if (mentions >= 3) return 1;
  if (mentions === 2) return 0.95;
  if (mentions === 1) return 0.8;
  return 0.7; // in the structured extraction but barely present in the prose
}

function weightedScore(pairs: { weight: number; credit: number }[]): number {
  const totalWeight = pairs.reduce((s, p) => s + p.weight, 0);
  if (!totalWeight) return 0;
  const earned = pairs.reduce((s, p) => s + p.weight * p.credit, 0);
  return Math.round((earned / totalWeight) * 100);
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export async function analyzeJob(
  job: JobInput,
  cvs: CvForMatching[],
  profile: MasterProfile,
): Promise<JobAnalysis> {
  const { requirements, by } = await extractRequirements(job);
  const idx = indexProfile(profile);

  const profileHits = new Map<string, ProfileHit>();
  for (const req of requirements) profileHits.set(req.key, matchProfile(req, idx));

  const professionalMatch = weightedScore(
    requirements.map((req) => ({
      weight: WEIGHT[req.importance],
      credit: profileCredit(profileHits.get(req.key)!),
    })),
  );

  /* -- per-CV alignment ------------------------------------------- */
  const jobFamily = canonicalRole(job.title).family;
  const alignments: CvAlignment[] = cvs.map((cv) => {
    const ci = indexCv(cv);
    const levels: Record<string, MatchLevel> = {};
    const mentions: Record<string, number> = {};
    let covered = 0;

    const pairs = requirements.map((req) => {
      const level = matchCv(req, ci);
      const count = mentionCount(req, ci.freeText);
      levels[req.key] = level;
      mentions[req.key] = count;
      if (level === "DIRECT") covered++;
      return { weight: WEIGHT[req.importance], credit: cvCredit(level, count) };
    });

    return {
      cvId: cv.id,
      cvName: cv.name,
      score: weightedScore(pairs),
      covered,
      total: requirements.length,
      levels,
      mentions,
    };
  });

  const ranked = [...alignments].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break on how close this CV's own history is to the advertised role.
    const familyBonus = (cvId: string) => {
      const cv = cvs.find((c) => c.id === cvId);
      if (!cv || !jobFamily) return 0;
      return (cv.extraction.experience ?? []).some(
        (e) => canonicalRole(e.jobTitle).family === jobFamily,
      )
        ? 1
        : 0;
    };
    return familyBonus(b.cvId) - familyBonus(a.cvId);
  });

  const best = ranked[0] ?? null;

  /* -- gap analysis against the recommended CV -------------------- */
  const matches: RequirementMatch[] = requirements.map((req) => {
    const hit = profileHits.get(req.key)!;
    const cvLevel = best ? best.levels[req.key] : "NONE";
    const cvMentions = best ? (best.mentions[req.key] ?? 0) : 0;

    return {
      requirement: req,
      profileLevel: hit.level,
      profileConfidence: hit.confidence,
      profileEvidence:
        hit.attribute?.sources.map((s) => ({ cvName: s.cvName, rawLabel: s.rawLabel })) ?? [],
      matchedLabel: hit.attribute?.label ?? hit.note ?? null,
      cvLevel,
      cvMentions,
      gap: bucket(hit, cvLevel, cvMentions),
    };
  });

  const recommendedCv = best ? cvs.find((c) => c.id === best.cvId) ?? null : null;

  return {
    requirements,
    professionalMatch,
    cvMatch: best?.score ?? 0,
    recommendedCvId: best?.cvId ?? null,
    recommendedCvName: best?.cvName ?? null,
    recommendationReason: recommendationReason(best, requirements, recommendedCv, jobFamily),
    alignments: ranked,
    matches,
    verdict: verdict(professionalMatch, best?.score ?? 0, matches),
    analyzedBy: by,
  };
}

function bucket(hit: ProfileHit, cvLevel: MatchLevel, mentions: number): GapBucket {
  if (hit.level === "NONE") return "MISSING";
  if (hit.confidence === "CONFLICTING") return "UNCLEAR";
  if (hit.level === "RELATED") return "UNCLEAR";
  if (cvLevel === "DIRECT" && mentions >= 2) return "HAVE";
  return "HAVE_NOT_EMPHASISED";
}

function recommendationReason(
  best: CvAlignment | null,
  requirements: JobRequirement[],
  cv: CvForMatching | null,
  jobFamily: string | null,
): string {
  if (!best || !cv) return "No processed CVs to choose from yet.";

  const musts = requirements.filter((r) => r.importance === "MUST");
  const coveredMusts = musts.filter((r) => best.levels[r.key] === "DIRECT").length;

  const bits = [
    `Covers ${coveredMusts} of the ${musts.length} essential requirement${musts.length === 1 ? "" : "s"} directly`,
  ];
  if (jobFamily) {
    const sameFamily = (cv.extraction.experience ?? []).some(
      (e) => canonicalRole(e.jobTitle).family === jobFamily,
    );
    if (sameFamily) bits.push("and its employment history sits in the same role family as this job");
  }
  return `${bits.join(" ")}.`;
}

function verdict(professional: number, cvScore: number, matches: RequirementMatch[]) {
  const missingMusts = matches.filter(
    (m) => m.requirement.importance === "MUST" && m.gap === "MISSING",
  );
  const underplayed = matches.filter((m) => m.gap === "HAVE_NOT_EMPHASISED");
  const communicationGap = professional - cvScore;

  if (professional < 50 || missingMusts.length >= Math.max(3, matches.length * 0.3)) {
    return {
      decision: "POOR_FIT",
      headline: "Probably not worth applying",
      detail:
        missingMusts.length > 0
          ? `${missingMusts.length} essential requirement${missingMusts.length === 1 ? " has" : "s have"} no supporting evidence in any of your CVs: ` +
            `${missingMusts.slice(0, 4).map((m) => m.requirement.label).join(", ")}.`
          : "Your combined profile covers too little of what this employer is asking for.",
    };
  }

  if (communicationGap >= 12) {
    return {
      decision: "APPLY_AFTER_TAILORING",
      headline: "Strong fit, weakly communicated",
      detail:
        `Your profile matches ${professional}% of this job but the recommended CV only communicates ${cvScore}% of it. ` +
        `${underplayed.length} requirement${underplayed.length === 1 ? " is" : "s are"} supported by your experience yet barely visible in that CV. Tailor before applying.`,
    };
  }

  if (professional >= 75) {
    return {
      decision: "APPLY",
      headline: "Good fit — apply",
      detail:
        missingMusts.length === 0
          ? "Every essential requirement has supporting evidence, and your CV already communicates it."
          : `Only ${missingMusts.length} essential requirement${missingMusts.length === 1 ? "" : "s"} unevidenced (${missingMusts.map((m) => m.requirement.label).join(", ")}).`,
    };
  }

  return {
    decision: "STRETCH",
    headline: "Stretch — worth a look",
    detail:
      `You cover a fair amount of this role but not all of it. ` +
      (missingMusts.length
        ? `Unevidenced essentials: ${missingMusts.map((m) => m.requirement.label).join(", ")}.`
        : "No essential requirement is completely unevidenced."),
  };
}
