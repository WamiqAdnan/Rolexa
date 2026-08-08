import { canonicalSkill, slug } from "../normalize";
import { emptyExtraction, type CvExtraction, type ExperienceEntry } from "../types";

/**
 * Deterministic CV parser.
 *
 * This is the no-API-key path. It reads section headings, date ranges and a
 * skill dictionary. It is deliberately conservative: where it cannot tell, it
 * leaves the field empty rather than guessing, so the master profile flags the
 * gap instead of inheriting a fabrication.
 */

type Section =
  | "SUMMARY"
  | "EXPERIENCE"
  | "EDUCATION"
  | "SKILLS"
  | "CERTIFICATIONS"
  | "PROJECTS"
  | "LANGUAGES"
  | "AWARDS"
  | "PUBLICATIONS"
  | "OTHER";

const HEADINGS: [Section, RegExp][] = [
  ["SUMMARY", /^(professional\s+)?(summary|profile|about( me)?|personal statement|objective|career objective)\b/i],
  ["EXPERIENCE", /^(work\s+|professional\s+|employment\s+|career\s+)?(experience|history|employment)\b/i],
  ["EDUCATION", /^(education|academic|qualifications|academic background)\b/i],
  ["SKILLS", /^(technical\s+|core\s+|key\s+|it\s+)?(skills|competencies|expertise|proficiencies|technologies)\b/i],
  ["CERTIFICATIONS", /^(certifications?|certificates?|licences?|licenses?|accreditations?|training)\b/i],
  ["PROJECTS", /^(projects?|key projects|selected projects|portfolio)\b/i],
  ["LANGUAGES", /^languages?\b/i],
  ["AWARDS", /^(awards?|honou?rs|achievements|accomplishments)\b/i],
  ["PUBLICATIONS", /^(publications?|papers|research)\b/i],
];

const MONTH =
  "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_TOKEN = `(?:${MONTH}\\s*[/,-]?\\s*)?(?:19|20)\\d{2}`;
const PRESENT = "(?:present|current|now|to date|ongoing)";
const DATE_RANGE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${DATE_TOKEN}|${PRESENT})`,
  "i",
);

const DEGREE_RE =
  /\b(ph\.?d|doctorate|m\.?sc|m\.?a\b|m\.?eng|mba|m\.?tech|master'?s?|b\.?sc|b\.?a\b|b\.?eng|b\.?tech|bachelor'?s?|hnd|hnc|foundation degree|diploma|associate degree|a[- ]levels?|high school)\b/i;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s,;]+|(?:linkedin\.com|github\.com)\/[^\s,;]+/gi;
const YEARS_RE =
  /(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+(?:of\s+)?(?:progressive\s+|professional\s+|relevant\s+|hands[- ]on\s+)?experience)?/i;

export function extractWithRules(text: string): CvExtraction {
  const out = emptyExtraction();
  const lines = text.split("\n").map((l) => l.trim());
  const sections = splitSections(lines);

  /* ---- personal -------------------------------------------------- */
  const head = lines.slice(0, 15).join("\n");
  out.personal.email = head.match(EMAIL_RE)?.[0] ?? text.match(EMAIL_RE)?.[0] ?? "";
  out.personal.phone = (head.match(PHONE_RE)?.[0] ?? "").trim();
  out.personal.links = Array.from(new Set(head.match(URL_RE) ?? []));
  out.personal.fullName = guessName(lines);
  out.personal.location = guessLocation(lines.slice(0, 12));

  const summaryLines = sections.get("SUMMARY") ?? [];
  out.personal.summary = summaryLines.join(" ").trim();
  if (!out.personal.headline) {
    const idx = lines.findIndex((l) => l && l === out.personal.fullName);
    const next = idx >= 0 ? lines.slice(idx + 1, idx + 4).find(looksLikeHeadline) : undefined;
    out.personal.headline = next ?? "";
  }

  /* ---- stated years ---------------------------------------------- */
  const yearsHaystack = [out.personal.summary, out.personal.headline, head].join("\n");
  const ym = yearsHaystack.match(YEARS_RE);
  if (ym) {
    out.totalYearsExperience = ym[1];
    out.totalYearsEvidence = ym[0].trim();
  }

  /* ---- experience ------------------------------------------------ */
  out.experience = parseExperience(sections.get("EXPERIENCE") ?? []);

  /* ---- education ------------------------------------------------- */
  for (const line of sections.get("EDUCATION") ?? []) {
    if (line.length < 4) continue;
    const degree = line.match(DEGREE_RE)?.[0] ?? "";
    const range = line.match(DATE_RANGE);
    const singleYear = line.match(/(?:19|20)\d{2}/);
    const parts = line.split(/\s*[|•,]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    const institution =
      parts.find((p) => /\b(university|college|institute|school|academy|polytechnic)\b/i.test(p)) ?? "";
    if (!degree && !institution) continue;
    out.education.push({
      degree,
      field: extractField(line, degree),
      institution,
      location: "",
      startDate: range?.[1] ?? "",
      endDate: range?.[2] ?? (range ? "" : (singleYear?.[0] ?? "")),
      grade: line.match(/\b(first class|2:1|2:2|upper second|lower second|distinction|merit|gpa\s*[:\s]*[\d.]+)\b/i)?.[0] ?? "",
    });
  }

  /* ---- skills ---------------------------------------------------- */
  const seenSkills = new Set<string>();
  for (const line of sections.get("SKILLS") ?? []) {
    for (const raw of splitList(line)) {
      const name = raw.replace(/\(.*?\)/g, "").trim();
      if (name.length < 2 || name.length > 60) continue;
      const key = canonicalSkill(name).key;
      if (seenSkills.has(key)) continue;
      seenSkills.add(key);
      out.skills.push({ name, kind: guessSkillKind(name) });
    }
  }
  // Dictionary sweep catches skills named only inside role bullets. Only known
  // terms — never invent from free text. Education is excluded: a degree "in
  // Statistics" is a qualification subject, not a claimed skill.
  const skillHaystack = [...sections.entries()]
    .filter(([section]) => section !== "EDUCATION")
    .flatMap(([, lines]) => lines)
    .join("\n");
  for (const found of sweepKnownSkills(skillHaystack)) {
    if (seenSkills.has(found.key)) continue;
    seenSkills.add(found.key);
    out.skills.push({ name: found.label, kind: found.kind });
  }

  /* ---- certifications -------------------------------------------- */
  for (const line of sections.get("CERTIFICATIONS") ?? []) {
    if (line.length < 4) continue;
    for (const item of splitList(line)) {
      if (item.length < 4) continue;
      out.certifications.push({
        name: item.replace(/\s*[-–|,]\s*(?:19|20)\d{2}.*$/, "").trim(),
        issuer: "",
        issueDate: item.match(/(?:19|20)\d{2}/)?.[0] ?? "",
        expiryDate: "",
      });
    }
  }

  /* ---- languages -------------------------------------------------- */
  for (const line of sections.get("LANGUAGES") ?? []) {
    for (const item of splitList(line)) {
      const m = item.match(/^([A-Za-z ]+?)\s*[-–(:]\s*(.+?)\)?$/);
      if (m) out.languages.push({ language: m[1].trim(), proficiency: m[2].trim() });
      else if (item.length > 1 && item.length < 30) {
        out.languages.push({ language: item.trim(), proficiency: "" });
      }
    }
  }

  /* ---- projects / awards / publications --------------------------- */
  for (const line of sections.get("PROJECTS") ?? []) {
    if (line.length < 8) continue;
    const [name, ...rest] = line.split(/\s*[-–:|]\s*/);
    out.projects.push({
      name: (name ?? line).trim(),
      description: rest.join(" - ").trim(),
      role: "",
      technologies: sweepKnownSkills(line).map((s) => s.label),
      outcomes: [],
    });
  }
  out.awards = (sections.get("AWARDS") ?? []).filter((l) => l.length > 5);
  out.publications = (sections.get("PUBLICATIONS") ?? []).filter((l) => l.length > 5);

  out.industries = Array.from(
    new Set(out.experience.map((e) => e.industry).filter(Boolean)),
  );
  if (out.personal.headline) out.targetRoles = [out.personal.headline];

  return out;
}

/* ------------------------------------------------------------------ */

function splitSections(lines: string[]): Map<Section, string[]> {
  const map = new Map<Section, string[]>();
  let current: Section = "OTHER";
  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      current = heading;
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (!line) continue;
    if (!map.has(current)) map.set(current, []);
    map.get(current)!.push(stripBullet(line));
  }
  return map;
}

function matchHeading(line: string): Section | null {
  const cleaned = line.replace(/[:•\-–—_*#]/g, " ").trim();
  if (!cleaned || cleaned.length > 45) return null;
  // A heading is a short line with few words and no sentence punctuation.
  if (cleaned.split(/\s+/).length > 5) return null;
  if (/[.,;]$/.test(line.trim())) return null;
  for (const [section, re] of HEADINGS) {
    if (re.test(cleaned)) return section;
  }
  return null;
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*+>◦o]\s+|\d+[.)]\s+)/, "").trim();
}

function looksLikeHeadline(line: string): boolean {
  if (!line || line.length < 4 || line.length > 80) return false;
  if (EMAIL_RE.test(line) || PHONE_RE.test(line)) return false;
  return /[a-z]/.test(line) && !/[.]$/.test(line);
}

function guessName(lines: string[]): string {
  for (const line of lines.slice(0, 8)) {
    if (!line || line.length > 60) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || URL_RE.test(line)) continue;
    if (matchHeading(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    // All-caps or Title Case, no digits.
    if (/\d/.test(line)) continue;
    const titleCase = words.every((w) => /^[A-Z][A-Za-z'’.-]*$/.test(w));
    const allCaps = /^[A-Z\s'’.-]+$/.test(line);
    if (titleCase || allCaps) return line.replace(/\s+/g, " ").trim();
  }
  return "";
}

function guessLocation(lines: string[]): string {
  for (const line of lines) {
    if (!line || line.length > 70) continue;
    const m = line.match(
      /\b([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+)?),\s*([A-Z]{2,}|[A-Z][a-zA-Z]+)\b/,
    );
    if (m && !EMAIL_RE.test(m[0])) return m[0];
    if (/\b(dubai|abu dhabi|sharjah|london|manchester|riyadh|doha|singapore|remote)\b/i.test(line)) {
      return line.replace(/[|•]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
    }
  }
  return "";
}

/**
 * Walk an experience section.
 *
 * CVs put the role header, the employer and the dates on one, two or three
 * lines in any order, so each line is classified before it is consumed: a line
 * that is *only* a date range completes the header above it rather than
 * starting a new role.
 */
function parseExperience(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let current: ExperienceEntry | null = null;

  const blank = (): ExperienceEntry => ({
    jobTitle: "",
    company: "",
    location: "",
    industry: "",
    startDate: "",
    endDate: "",
    responsibilities: [],
    achievements: [],
    technologies: [],
  });

  const push = () => {
    if (current && (current.jobTitle || current.company)) entries.push(current);
    current = null;
  };

  const startEntry = (header: string): ExperienceEntry => {
    const { title, company, location } = splitTitleCompany(header);
    const entry = blank();
    entry.jobTitle = title;
    entry.company = company;
    entry.location = location;
    return entry;
  };

  const setDates = (entry: ExperienceEntry, range: RegExpMatchArray) => {
    entry.startDate = normaliseDate(range[1]);
    entry.endDate = /present|current|now|to date|ongoing/i.test(range[2])
      ? "Present"
      : normaliseDate(range[2]);
  };

  const addBullet = (entry: ExperienceEntry, raw: string) => {
    const bullet = stripBullet(raw);
    if (bullet.length < 3) return;
    if (
      hasMetric(bullet) ||
      /\b(achiev|deliver|reduc|increas|improv|saved|grew|won|launched)\w*\b/i.test(bullet)
    ) {
      entry.achievements.push(bullet);
    } else {
      entry.responsibilities.push(bullet);
    }
    for (const s of sweepKnownSkills(bullet)) {
      if (!entry.technologies.includes(s.label)) entry.technologies.push(s.label);
    }
  };

  for (const line of lines) {
    if (!line) continue;

    const bulletPrefixed = /^\s*(?:[-*+>◦o]\s+|\d+[.)]\s+)/.test(line);
    if (bulletPrefixed && current) {
      addBullet(current, line);
      continue;
    }

    const range = line.match(DATE_RANGE);
    if (range) {
      const remainder = line.replace(DATE_RANGE, "").replace(/[|•]/g, " ").replace(/\s+/g, " ").trim();
      const remainderIsNoise = remainder.replace(/[^A-Za-z0-9]/g, "").length < 3;

      if (current && !current.startDate && remainderIsNoise) {
        // Bare date line completing the header directly above it.
        setDates(current, range);
        continue;
      }
      if (current && !current.startDate && !current.company && !remainderIsNoise) {
        // "Acme Retail Group | Jan 2021 - Present" under a bare title line.
        const { title, company, location } = splitTitleCompany(remainder);
        current.company = company || title;
        current.location = current.location || location;
        setDates(current, range);
        continue;
      }
      // Anything else with a date range is a new role.
      push();
      current = startEntry(remainder);
      setDates(current, range);
      continue;
    }

    if (!current) {
      if (isHeaderish(line)) current = startEntry(line);
      continue;
    }

    const started = current.startDate || current.responsibilities.length || current.achievements.length;

    if (!started && !current.company && isHeaderish(line)) {
      // Employer on the line below the job title.
      const { title, company, location } = splitTitleCompany(line);
      current.company = company || title;
      current.location = current.location || location;
      continue;
    }

    if (started && isHeaderish(line)) {
      push();
      current = startEntry(line);
      continue;
    }

    addBullet(current, line);
  }
  push();
  return entries;
}

/** Verbs that open a duty bullet — never a role header. */
const BULLET_VERBS =
  /^(built|led|managed|created|developed|designed|delivered|implemented|produced|wrote|ran|owned|supported|coordinated|automated|migrated|reduced|improved|increased|analys|analyz|partnered|cleaned|maintained|collaborated|presented|worked|assisted|handled|oversaw|established|drove|achieved|ensured|provided|conducted|performed|prepared|reviewed|tracked|monitored|streamlined|optimis|optimiz|spearheaded|executed|launched|negotiated|mentored|trained|defined|documented|tested|deployed|configured|integrated|resolved|reported|responsible|liaised|generated)/i;

/**
 * Does this line look like a role header rather than a duty bullet? Headers are
 * short, don't read as sentences, and either carry a separator or are only a
 * few words long.
 */
function isHeaderish(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 110) return false;
  if (/[.;:]$/.test(text)) return false;
  if (/^[a-z]/.test(text)) return false;
  if (BULLET_VERBS.test(text)) return false;

  const words = text.split(/\s+/).length;
  if (words > 12) return false;

  const hasSeparator = /,|\||\sat\s|\s[-–—]\s|@/.test(text);
  return hasSeparator || words <= 6;
}

function splitTitleCompany(line: string): { title: string; company: string; location: string } {
  const cleaned = line.replace(/\s{2,}/g, " ").replace(/[,;]\s*$/, "").trim();
  // Comma and pipe need no leading space; "at"/"-" do, so they don't chop
  // hyphenated titles like "Analyst - Reporting".
  const m = cleaned.match(/^(.*?)\s*(?:,|\||\s+at\s+|\s+@\s+|\s+[-–—]\s+)\s*(.*)$/i);
  if (!m || !m[2].trim()) return { title: cleaned, company: "", location: "" };
  const title = m[1].trim();
  const parts = m[2]
    .trim()
    .split(/\s*[,|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    title,
    company: parts[0] ?? "",
    location: parts.length > 1 ? parts.slice(1).join(", ") : "",
  };
}

function normaliseDate(raw: string): string {
  const year = raw.match(/(?:19|20)\d{2}/)?.[0];
  if (!year) return raw.trim();
  const monthName = raw.match(new RegExp(MONTH, "i"))?.[0]?.slice(0, 3).toLowerCase();
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  return monthName && months[monthName] ? `${year}-${months[monthName]}` : year;
}

function hasMetric(s: string): boolean {
  return /\d+\s*%|\$\s?\d|£\s?\d|€\s?\d|\bAED\b|\b\d{3,}\b|\b\d+x\b/i.test(s);
}

function extractField(line: string, degree: string): string {
  const after = degree ? line.slice(line.indexOf(degree) + degree.length) : line;
  // Stop at the first comma — what follows is the institution, not the subject.
  const m = after.match(/\b(?:in|of)\s+([A-Za-z&' ]{3,60})/i);
  return m ? m[1].replace(/\s*(?:from|at)\s*$/i, "").trim() : "";
}

function splitList(line: string): string[] {
  const body = line.replace(/^[^:]{2,30}:\s*/, ""); // drop "Databases: " style prefixes
  return body
    .split(/\s*[,;|•·]\s*|\s+\/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 70);
}

function guessSkillKind(name: string): string {
  const canon = canonicalSkill(name);
  switch (canon.group) {
    case "SOFT": return "soft";
    case "TOOL": return "tool";
    case "MANAGEMENT": return "methodology";
    case "CORE": return "methodology";
    default: return "technical";
  }
}

/** Scan text for dictionary skills only — never coins new ones. */
function sweepKnownSkills(text: string): { key: string; label: string; kind: string }[] {
  const found: { key: string; label: string; kind: string }[] = [];
  const seen = new Set<string>();
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9+#/. ]+/g, " ").replace(/\s+/g, " ")} `;
  for (const probe of DICTIONARY_PROBES) {
    if (seen.has(probe.key)) continue;
    if (hay.includes(` ${probe.needle} `)) {
      seen.add(probe.key);
      found.push({ key: probe.key, label: probe.label, kind: probe.kind });
    }
  }
  return found;
}

/**
 * Built once from the shared skill dictionary. Very short needles (1–2 chars,
 * e.g. "r", "go") are excluded — they produce false positives in prose.
 */
const DICTIONARY_PROBES: { key: string; label: string; needle: string; kind: string }[] = (() => {
  const probes: { key: string; label: string; needle: string; kind: string }[] = [];
  const candidates = [
    "SQL", "T-SQL", "PL/SQL", "MySQL", "PostgreSQL", "SQL Server", "Oracle", "MongoDB",
    "Snowflake", "BigQuery", "Redshift", "Databricks", "Python", "JavaScript", "TypeScript",
    "Java", "Scala", "VBA", "DAX", "Power Query", "Power BI", "PowerBI", "Tableau", "Looker",
    "Qlik", "SSRS", "SSIS", "SSAS", "Excel", "PowerPoint", "Google Sheets", "data analysis",
    "data analytics", "business analysis", "data visualisation", "data visualization",
    "reporting", "dashboards", "data modelling", "data modeling", "ETL", "data warehouse",
    "data warehousing", "data quality", "data governance", "statistics", "forecasting",
    "machine learning", "financial modelling", "financial modeling", "budgeting", "AWS",
    "Azure", "GCP", "Docker", "Kubernetes", "Git", "Airflow", "Spark", "Hadoop", "REST API",
    "Agile", "Scrum", "Kanban", "Waterfall", "PRINCE2", "Six Sigma", "process improvement",
    "requirements gathering", "user stories", "UAT", "gap analysis", "process mapping",
    "project management", "programme management", "program management",
    "stakeholder management", "team leadership", "vendor management", "risk management",
    "change management", "mentoring", "communication", "presentation", "problem solving",
    "collaboration", "negotiation",
  ];
  const seen = new Set<string>();
  for (const c of candidates) {
    const needle = c.toLowerCase().replace(/[^a-z0-9+#/. ]+/g, " ").replace(/\s+/g, " ").trim();
    if (needle.length < 3) continue;
    const canon = canonicalSkill(c);
    const dedupe = `${canon.key}|${needle}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    probes.push({
      key: canon.key || slug(c),
      label: canon.label,
      needle,
      kind: canon.group === "SOFT" ? "soft" : canon.group === "TOOL" ? "tool" : "technical",
    });
  }
  return probes;
})();
