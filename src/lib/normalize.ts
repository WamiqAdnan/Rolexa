/**
 * Terminology normalisation.
 *
 * Rule from the spec: normalisation may unify *wording* ("PowerBI", "Microsoft
 * Power BI" and "Power BI" are one skill) and may recognise that two job titles
 * belong to the same family — but it must never change the underlying facts.
 * So every normalised attribute keeps the raw wording of each source alongside
 * the canonical label; nothing here invents or upgrades a claim.
 */

import type { SkillGroup } from "./types";

export function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Aggressive squash used for alias lookup: "Microsoft Power BI" -> "microsoftpowerbi" */
function squash(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type SkillDef = {
  key: string;
  label: string;
  group: SkillGroup;
  aliases: string[];
  /** Skills in the same family are "related but not the same". */
  family?: string;
};

/**
 * Curated skill dictionary. Anything not in here still normalises (via slug),
 * it just doesn't get alias-folding or family relationships.
 */
const SKILL_DEFS: SkillDef[] = [
  // --- Programming / query languages -------------------------------------
  { key: "sql", label: "SQL", group: "TECHNICAL", family: "query", aliases: ["structured query language", "ansi sql"] },
  { key: "t-sql", label: "T-SQL", group: "TECHNICAL", family: "query", aliases: ["tsql", "transact sql", "transact-sql"] },
  { key: "pl-sql", label: "PL/SQL", group: "TECHNICAL", family: "query", aliases: ["plsql"] },
  { key: "mysql", label: "MySQL", group: "TOOL", family: "database", aliases: [] },
  { key: "postgresql", label: "PostgreSQL", group: "TOOL", family: "database", aliases: ["postgres"] },
  { key: "sql-server", label: "SQL Server", group: "TOOL", family: "database", aliases: ["microsoft sql server", "mssql", "ms sql server"] },
  { key: "oracle", label: "Oracle", group: "TOOL", family: "database", aliases: ["oracle db", "oracle database"] },
  { key: "mongodb", label: "MongoDB", group: "TOOL", family: "database", aliases: ["mongo"] },
  { key: "snowflake", label: "Snowflake", group: "TOOL", family: "warehouse", aliases: [] },
  { key: "bigquery", label: "BigQuery", group: "TOOL", family: "warehouse", aliases: ["google bigquery"] },
  { key: "redshift", label: "Redshift", group: "TOOL", family: "warehouse", aliases: ["amazon redshift", "aws redshift"] },
  { key: "databricks", label: "Databricks", group: "TOOL", family: "warehouse", aliases: [] },

  { key: "python", label: "Python", group: "TECHNICAL", family: "programming", aliases: ["python3", "python 3"] },
  { key: "r", label: "R", group: "TECHNICAL", family: "programming", aliases: ["r language", "r programming"] },
  { key: "javascript", label: "JavaScript", group: "TECHNICAL", family: "programming", aliases: ["js", "ecmascript"] },
  { key: "typescript", label: "TypeScript", group: "TECHNICAL", family: "programming", aliases: ["ts"] },
  { key: "java", label: "Java", group: "TECHNICAL", family: "programming", aliases: [] },
  { key: "c-sharp", label: "C#", group: "TECHNICAL", family: "programming", aliases: ["csharp", "c sharp", "dotnet c#"] },
  { key: "cpp", label: "C++", group: "TECHNICAL", family: "programming", aliases: ["cplusplus", "c plus plus"] },
  { key: "go", label: "Go", group: "TECHNICAL", family: "programming", aliases: ["golang"] },
  { key: "scala", label: "Scala", group: "TECHNICAL", family: "programming", aliases: [] },
  { key: "vba", label: "VBA", group: "TECHNICAL", family: "programming", aliases: ["visual basic for applications", "visual basic"] },
  { key: "dax", label: "DAX", group: "TECHNICAL", family: "bi-language", aliases: ["data analysis expressions"] },
  { key: "power-query", label: "Power Query", group: "TECHNICAL", family: "bi-language", aliases: ["powerquery", "m query", "m language"] },

  // --- BI / visualisation -------------------------------------------------
  { key: "power-bi", label: "Power BI", group: "TOOL", family: "bi", aliases: ["powerbi", "microsoft power bi", "ms power bi", "power-bi", "power bi desktop", "power bi service"] },
  { key: "tableau", label: "Tableau", group: "TOOL", family: "bi", aliases: ["tableau desktop", "tableau server"] },
  { key: "looker", label: "Looker", group: "TOOL", family: "bi", aliases: ["google looker", "looker studio"] },
  { key: "qlik", label: "Qlik", group: "TOOL", family: "bi", aliases: ["qlikview", "qlik sense"] },
  { key: "google-data-studio", label: "Google Data Studio", group: "TOOL", family: "bi", aliases: ["data studio"] },
  { key: "ssrs", label: "SSRS", group: "TOOL", family: "bi", aliases: ["sql server reporting services"] },
  { key: "ssis", label: "SSIS", group: "TOOL", family: "etl", aliases: ["sql server integration services"] },
  { key: "ssas", label: "SSAS", group: "TOOL", family: "bi", aliases: ["sql server analysis services"] },
  { key: "excel", label: "Excel", group: "TOOL", family: "office", aliases: ["microsoft excel", "ms excel", "advanced excel", "excel advanced"] },
  { key: "powerpoint", label: "PowerPoint", group: "TOOL", family: "office", aliases: ["microsoft powerpoint", "ms powerpoint"] },
  { key: "word", label: "Word", group: "TOOL", family: "office", aliases: ["microsoft word", "ms word"] },
  { key: "google-sheets", label: "Google Sheets", group: "TOOL", family: "office", aliases: ["sheets"] },

  // --- Data / analytics disciplines --------------------------------------
  { key: "data-analysis", label: "Data Analysis", group: "CORE", family: "analysis", aliases: ["data analytics", "analytics", "data analyses"] },
  { key: "business-analysis", label: "Business Analysis", group: "CORE", family: "analysis", aliases: ["business analytics"] },
  { key: "data-visualisation", label: "Data Visualisation", group: "CORE", family: "analysis", aliases: ["data visualization", "dataviz", "visualisation", "visualization"] },
  { key: "reporting", label: "Reporting", group: "CORE", family: "analysis", aliases: ["mi reporting", "management reporting", "report development"] },
  { key: "dashboarding", label: "Dashboarding", group: "CORE", family: "analysis", aliases: ["dashboard development", "dashboards"] },
  { key: "data-modelling", label: "Data Modelling", group: "TECHNICAL", family: "data-eng", aliases: ["data modeling", "dimensional modelling", "dimensional modeling"] },
  { key: "etl", label: "ETL", group: "TECHNICAL", family: "data-eng", aliases: ["elt", "etl development", "data pipelines", "data pipeline"] },
  { key: "data-warehousing", label: "Data Warehousing", group: "TECHNICAL", family: "data-eng", aliases: ["data warehouse", "datawarehouse", "dwh"] },
  { key: "data-quality", label: "Data Quality", group: "CORE", family: "governance", aliases: ["data cleansing", "data cleaning"] },
  { key: "data-governance", label: "Data Governance", group: "CORE", family: "governance", aliases: [] },
  { key: "statistics", label: "Statistics", group: "TECHNICAL", family: "quant", aliases: ["statistical analysis", "statistical modelling", "statistical modeling"] },
  { key: "forecasting", label: "Forecasting", group: "TECHNICAL", family: "quant", aliases: ["demand forecasting", "time series", "time series analysis"] },
  { key: "machine-learning", label: "Machine Learning", group: "TECHNICAL", family: "quant", aliases: ["ml", "predictive modelling", "predictive modeling", "predictive analytics"] },
  { key: "financial-modelling", label: "Financial Modelling", group: "TECHNICAL", family: "finance", aliases: ["financial modeling", "financial analysis"] },
  { key: "budgeting", label: "Budgeting", group: "CORE", family: "finance", aliases: ["budget management", "budgets"] },

  // --- Engineering / cloud ------------------------------------------------
  { key: "aws", label: "AWS", group: "TOOL", family: "cloud", aliases: ["amazon web services"] },
  { key: "azure", label: "Azure", group: "TOOL", family: "cloud", aliases: ["microsoft azure", "azure cloud"] },
  { key: "gcp", label: "GCP", group: "TOOL", family: "cloud", aliases: ["google cloud", "google cloud platform"] },
  { key: "docker", label: "Docker", group: "TOOL", family: "devops", aliases: [] },
  { key: "kubernetes", label: "Kubernetes", group: "TOOL", family: "devops", aliases: ["k8s"] },
  { key: "git", label: "Git", group: "TOOL", family: "devops", aliases: ["github", "gitlab", "version control"] },
  { key: "airflow", label: "Airflow", group: "TOOL", family: "etl", aliases: ["apache airflow"] },
  { key: "spark", label: "Spark", group: "TOOL", family: "big-data", aliases: ["apache spark", "pyspark"] },
  { key: "hadoop", label: "Hadoop", group: "TOOL", family: "big-data", aliases: ["apache hadoop"] },
  { key: "rest-api", label: "REST APIs", group: "TECHNICAL", family: "engineering", aliases: ["rest", "restful api", "restful apis", "api development", "apis"] },

  // --- Methodologies ------------------------------------------------------
  { key: "agile", label: "Agile", group: "CORE", family: "delivery", aliases: ["agile methodology", "agile delivery"] },
  { key: "scrum", label: "Scrum", group: "CORE", family: "delivery", aliases: ["scrum master"] },
  { key: "kanban", label: "Kanban", group: "CORE", family: "delivery", aliases: [] },
  { key: "waterfall", label: "Waterfall", group: "CORE", family: "delivery", aliases: [] },
  { key: "prince2", label: "PRINCE2", group: "CORE", family: "delivery", aliases: ["prince 2"] },
  { key: "six-sigma", label: "Six Sigma", group: "CORE", family: "process", aliases: ["lean six sigma", "sixsigma"] },
  { key: "lean", label: "Lean", group: "CORE", family: "process", aliases: ["lean methodology"] },
  { key: "process-improvement", label: "Process Improvement", group: "CORE", family: "process", aliases: ["continuous improvement", "business process improvement", "bpi"] },
  { key: "requirements-gathering", label: "Requirements Gathering", group: "CORE", family: "ba", aliases: ["requirements elicitation", "requirement gathering", "requirements analysis"] },
  { key: "user-stories", label: "User Stories", group: "CORE", family: "ba", aliases: ["user story writing"] },
  { key: "uat", label: "UAT", group: "CORE", family: "ba", aliases: ["user acceptance testing"] },
  { key: "gap-analysis", label: "Gap Analysis", group: "CORE", family: "ba", aliases: [] },
  { key: "process-mapping", label: "Process Mapping", group: "CORE", family: "ba", aliases: ["business process mapping", "process modelling", "process modeling"] },

  // --- Management ---------------------------------------------------------
  { key: "project-management", label: "Project Management", group: "MANAGEMENT", family: "management", aliases: ["projects management", "project delivery"] },
  { key: "programme-management", label: "Programme Management", group: "MANAGEMENT", family: "management", aliases: ["program management"] },
  { key: "stakeholder-management", label: "Stakeholder Management", group: "MANAGEMENT", family: "management", aliases: ["stakeholder engagement"] },
  { key: "team-leadership", label: "Team Leadership", group: "MANAGEMENT", family: "management", aliases: ["leadership", "team management", "people management", "line management"] },
  { key: "vendor-management", label: "Vendor Management", group: "MANAGEMENT", family: "management", aliases: ["supplier management", "third party management"] },
  { key: "risk-management", label: "Risk Management", group: "MANAGEMENT", family: "management", aliases: [] },
  { key: "change-management", label: "Change Management", group: "MANAGEMENT", family: "management", aliases: [] },
  { key: "mentoring", label: "Mentoring", group: "MANAGEMENT", family: "management", aliases: ["coaching", "mentorship"] },

  // --- Soft ---------------------------------------------------------------
  { key: "communication", label: "Communication", group: "SOFT", family: "soft", aliases: ["communication skills", "verbal communication", "written communication"] },
  { key: "presentation", label: "Presentation", group: "SOFT", family: "soft", aliases: ["presentation skills", "presenting"] },
  { key: "problem-solving", label: "Problem Solving", group: "SOFT", family: "soft", aliases: ["problem-solving", "analytical thinking", "critical thinking"] },
  { key: "collaboration", label: "Collaboration", group: "SOFT", family: "soft", aliases: ["teamwork", "cross functional collaboration", "cross-functional collaboration"] },
  { key: "attention-to-detail", label: "Attention to Detail", group: "SOFT", family: "soft", aliases: ["detail oriented", "detail-oriented"] },
  { key: "time-management", label: "Time Management", group: "SOFT", family: "soft", aliases: ["prioritisation", "prioritization"] },
  { key: "negotiation", label: "Negotiation", group: "SOFT", family: "soft", aliases: ["negotiation skills"] },
];

const SKILL_BY_SQUASH = new Map<string, SkillDef>();
for (const def of SKILL_DEFS) {
  SKILL_BY_SQUASH.set(squash(def.label), def);
  SKILL_BY_SQUASH.set(squash(def.key), def);
  for (const alias of def.aliases) SKILL_BY_SQUASH.set(squash(alias), def);
}
const SKILL_BY_KEY = new Map(SKILL_DEFS.map((d) => [d.key, d]));

const GROUP_FROM_KIND: Record<string, SkillGroup> = {
  programming: "TECHNICAL",
  technical: "TECHNICAL",
  software: "TOOL",
  tool: "TOOL",
  platform: "TOOL",
  methodology: "CORE",
  soft: "SOFT",
  management: "MANAGEMENT",
  industry: "INDUSTRY",
};

export type CanonicalSkill = {
  key: string;
  label: string;
  group: SkillGroup;
  family: string | null;
  /** true when the term was found in the curated dictionary */
  known: boolean;
};

/** Fold a free-text skill onto its canonical form. */
export function canonicalSkill(raw: string, kindHint = ""): CanonicalSkill {
  const trimmed = raw.trim().replace(/\s+/g, " ").replace(/[.;,]+$/, "");
  const hit = SKILL_BY_SQUASH.get(squash(trimmed));
  if (hit) {
    return { key: hit.key, label: hit.label, group: hit.group, family: hit.family ?? null, known: true };
  }
  const group = GROUP_FROM_KIND[kindHint.toLowerCase()] ?? "TECHNICAL";
  return {
    key: slug(trimmed) || squash(trimmed),
    label: titleCaseIfNeeded(trimmed),
    group,
    family: null,
    known: false,
  };
}

export function skillByKey(key: string): CanonicalSkill | null {
  const d = SKILL_BY_KEY.get(key);
  if (!d) return null;
  return { key: d.key, label: d.label, group: d.group, family: d.family ?? null, known: true };
}

/** All alias spellings for a canonical key — used to count CV mentions. */
export function skillSurfaceForms(key: string, fallbackLabel: string): string[] {
  const d = SKILL_BY_KEY.get(key);
  if (!d) return [fallbackLabel];
  return Array.from(new Set([d.label, d.key.replace(/-/g, " "), ...d.aliases]));
}

/** Two skills are related when they sit in the same family but differ. */
export function skillsRelated(a: string, b: string): boolean {
  if (a === b) return false;
  const da = SKILL_BY_KEY.get(a);
  const db = SKILL_BY_KEY.get(b);
  if (!da || !db) return false;
  return !!da.family && da.family === db.family;
}

function titleCaseIfNeeded(s: string): string {
  if (/[A-Z]/.test(s)) return s; // author already cased it — leave alone
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Job titles                                                          */
/* ------------------------------------------------------------------ */

type RoleFamilyDef = {
  family: string;
  label: string;
  /** Matched as whole-ish phrases against the lowercased title. */
  markers: string[];
  /**
   * Titles worth typing into a job board for this family. Kept separate from
   * `markers` because some markers are deliberately partial ("engineer", "head
   * of", "pmo") — good for recognising a title, useless as a search term.
   */
  searchTitles: string[];
};

const ROLE_FAMILIES: RoleFamilyDef[] = [
  {
    family: "analytics",
    label: "Analytics & Insight",
    markers: [
      "data analyst", "business analyst", "bi analyst", "business intelligence analyst",
      "analytics consultant", "insight analyst", "insights analyst", "reporting analyst",
      "mi analyst", "management information analyst", "data scientist", "quantitative analyst",
      "research analyst", "performance analyst", "commercial analyst", "reporting specialist",
    ],
    searchTitles: ["Data Analyst", "Business Analyst", "BI Analyst", "Business Intelligence Analyst", "Analytics Consultant", "Insights Analyst", "Reporting Analyst", "MI Analyst", "Commercial Analyst", "Performance Analyst"],
  },
  {
    family: "data-engineering",
    label: "Data Engineering",
    markers: ["data engineer", "etl developer", "bi developer", "business intelligence developer", "analytics engineer", "database developer", "data architect"],
    searchTitles: ["Data Engineer", "Analytics Engineer", "BI Developer", "ETL Developer", "Data Architect", "Database Developer"],
  },
  {
    family: "project-delivery",
    label: "Project & Delivery",
    markers: ["project manager", "programme manager", "program manager", "project coordinator", "delivery manager", "scrum master", "project lead", "pmo", "project officer"],
    searchTitles: ["Project Manager", "Programme Manager", "Delivery Manager", "Project Coordinator", "Scrum Master", "PMO Analyst", "Project Lead"],
  },
  {
    family: "product",
    label: "Product",
    markers: ["product manager", "product owner", "product analyst"],
    searchTitles: ["Product Manager", "Product Owner", "Product Analyst"],
  },
  {
    family: "software",
    label: "Software Engineering",
    markers: ["software engineer", "software developer", "full stack developer", "backend developer", "frontend developer", "web developer", "application developer", "engineer"],
    searchTitles: ["Software Engineer", "Software Developer", "Backend Developer", "Frontend Developer", "Full Stack Developer", "Application Developer"],
  },
  {
    family: "finance",
    label: "Finance",
    markers: ["financial analyst", "finance analyst", "accountant", "finance manager", "financial controller", "fp&a"],
    searchTitles: ["Financial Analyst", "Finance Analyst", "Finance Manager", "FP&A Analyst", "Financial Controller"],
  },
  {
    family: "operations",
    label: "Operations",
    markers: ["operations manager", "operations analyst", "process analyst", "business process analyst", "operations executive"],
    searchTitles: ["Operations Manager", "Operations Analyst", "Process Analyst", "Business Process Analyst"],
  },
  {
    family: "consulting",
    label: "Consulting",
    markers: ["consultant", "advisor", "adviser"],
    searchTitles: ["Consultant", "Management Consultant", "Business Consultant", "Technology Consultant"],
  },
  {
    family: "leadership",
    label: "Leadership",
    markers: ["head of", "director", "chief", "vp ", "vice president", "general manager"],
    searchTitles: ["Head of Analytics", "Head of Data", "Director of Analytics", "Analytics Manager", "Data Manager"]
  },
];

const SENIORITY_MARKERS: [RegExp, string][] = [
  [/\b(intern|trainee|graduate|entry[- ]level)\b/i, "Entry"],
  [/\b(junior|jr\.?)\b/i, "Junior"],
  [/\b(senior|sr\.?)\b/i, "Senior"],
  [/\b(lead|principal|staff)\b/i, "Lead"],
  [/\b(head of|director|chief|vp|vice president)\b/i, "Executive"],
  [/\b(manager)\b/i, "Manager"],
];

export type CanonicalRole = {
  key: string;
  label: string;
  family: string | null;
  familyLabel: string | null;
  seniority: string | null;
};

/**
 * Canonicalise a job title. The seniority word is *kept* in the label — dropping
 * it would change a fact — but it is also surfaced separately so matching can
 * reason about level.
 */
export function canonicalRole(raw: string): CanonicalRole {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const lower = trimmed.toLowerCase();

  let family: RoleFamilyDef | null = null;
  let bestLen = 0;
  for (const f of ROLE_FAMILIES) {
    for (const m of f.markers) {
      if (lower.includes(m) && m.length > bestLen) {
        family = f;
        bestLen = m.length;
      }
    }
  }

  let seniority: string | null = null;
  for (const [re, level] of SENIORITY_MARKERS) {
    if (re.test(lower)) {
      seniority = level;
      break;
    }
  }

  return {
    key: slug(trimmed),
    label: trimmed,
    family: family?.family ?? null,
    familyLabel: family?.label ?? null,
    seniority,
  };
}

export function roleFamilyOf(raw: string): string | null {
  return canonicalRole(raw).family;
}

/** Job titles worth searching for within a role family. */
export function familySearchTitles(family: string): string[] {
  return ROLE_FAMILIES.find((f) => f.family === family)?.searchTitles ?? [];
}

export function familyLabel(family: string): string | null {
  return ROLE_FAMILIES.find((f) => f.family === family)?.label ?? null;
}

/** Strip the seniority word from a title: "Senior Data Analyst" -> "Data Analyst". */
export function stripSeniority(title: string): string {
  return title
    .replace(
      /\b(intern|trainee|graduate|entry[- ]level|junior|jr\.?|senior|sr\.?|lead|principal|staff|head of|chief)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trailing filler that job adverts add to a skill name. Stripping it before
 * canonicalisation turns "SQL Skills" back into "SQL" so it matches the profile.
 */
export function stripSkillFiller(text: string): string {
  return text
    .replace(
      /\b(skills?|proficiency|proficient|experience|expertise|knowledge|ability|competency|competence|literacy|advanced|expert|strong|hands[- ]on|working)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Education                                                           */
/* ------------------------------------------------------------------ */

/**
 * Rank a qualification so "BSc in Statistics" can satisfy "Bachelor's degree
 * required", and a Master's can satisfy a Bachelor's requirement. Returns null
 * when the text names no qualification level at all.
 */
export function degreeLevel(text: string): number | null {
  const t = ` ${text.toLowerCase().replace(/[.]/g, "")} `;
  if (/\b(phd|dphil|doctorate|doctoral)\b/.test(t)) return 5;
  if (/\b(mba|msc|ma|meng|mtech|mphil|master|masters|master's|postgraduate|pg)\b/.test(t)) return 4;
  if (/\b(bsc|ba|beng|btech|bcom|bachelor|bachelors|bachelor's|undergraduate|honours|hons)\b/.test(t)) return 3;
  if (/\b(hnd|hnc|foundation degree|associate degree|diploma)\b/.test(t)) return 2;
  if (/\b(a-level|a levels|high school|secondary|gcse)\b/.test(t)) return 1;
  // A bare "degree" with no level named means a first degree.
  if (/\bdegree\b/.test(t)) return 3;
  return null;
}

/** Subject words that carry meaning, with vague qualifiers dropped. */
export function degreeSubject(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(bsc|ba|beng|btech|bcom|msc|ma|meng|mtech|mba|phd|bachelor'?s?|master'?s?|doctorate|degree|diploma|hnd|hnc|honours|hons|in|of|a|an|the|or|equivalent|related|relevant|similar|field|discipline|subject|area|quantitative|numerate|technical|preferred|required)\b/g,
      " ",
    )
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "in", "on", "for", "with", "to", "or", "at",
  "by", "as", "is", "are", "be", "using", "use", "strong", "excellent", "good",
  "experience", "knowledge", "skills", "ability", "proven", "solid", "working",
]);

export function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard overlap of content words — a cheap "these mean roughly the same" test. */
export function tokenOverlap(a: string, b: string): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / new Set([...sa, ...sb]).size;
}

/** Count non-overlapping, word-boundary-ish occurrences of a term in text. */
export function countMentions(text: string, terms: string[]): number {
  const hay = text.toLowerCase();
  let total = 0;
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length < 2) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b misbehaves around "c#" / "c++", so allow a non-word boundary there.
    const boundary = /[a-z0-9]$/.test(t) ? "\\b" : "";
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}${boundary}`, "g");
    total += (hay.match(re) || []).length;
  }
  return total;
}

/** Normalise a scalar for conflict detection ("7 years" and "7" are the same). */
export function normaliseScalar(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
}

/** Pull a numeric year count out of free text like "7+ years". */
export function parseYears(v: string): number | null {
  const m = v.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
