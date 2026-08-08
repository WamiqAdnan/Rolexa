/**
 * Shapes shared between the extractor, the master-profile builder and the UI.
 *
 * Every scalar in `CvExtraction` is a string, with `""` meaning "not stated in
 * this CV". That keeps the JSON schema we hand to Claude free of nullable
 * unions, and it keeps "absent" distinguishable from "zero".
 */

export type SkillGroup =
  | "CORE"
  | "TECHNICAL"
  | "TOOL"
  | "INDUSTRY"
  | "MANAGEMENT"
  | "SOFT";

export type ExtractedSkill = {
  name: string;
  /** technical | software | tool | platform | programming | methodology | soft */
  kind: string;
};

export type ExperienceEntry = {
  jobTitle: string;
  company: string;
  location: string;
  industry: string;
  /** "YYYY-MM" or "YYYY" or "" */
  startDate: string;
  /** "YYYY-MM", "YYYY", "Present" or "" */
  endDate: string;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
};

export type EducationEntry = {
  degree: string;
  field: string;
  institution: string;
  location: string;
  startDate: string;
  endDate: string;
  grade: string;
};

export type CertificationEntry = {
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
};

export type ProjectEntry = {
  name: string;
  description: string;
  role: string;
  technologies: string[];
  outcomes: string[];
};

export type LanguageEntry = {
  language: string;
  proficiency: string;
};

export type CvExtraction = {
  personal: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    headline: string;
    summary: string;
    links: string[];
  };
  /** Stated total years of experience, as a string. "" when not stated. */
  totalYearsExperience: string;
  /** Where the years figure came from, e.g. "summary: '7+ years in analytics'" */
  totalYearsEvidence: string;
  experience: ExperienceEntry[];
  skills: ExtractedSkill[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  projects: ProjectEntry[];
  languages: LanguageEntry[];
  licences: string[];
  awards: string[];
  publications: string[];
  industries: string[];
  targetRoles: string[];
  additional: string[];
};

export function emptyExtraction(): CvExtraction {
  return {
    personal: {
      fullName: "",
      email: "",
      phone: "",
      location: "",
      headline: "",
      summary: "",
      links: [],
    },
    totalYearsExperience: "",
    totalYearsEvidence: "",
    experience: [],
    skills: [],
    education: [],
    certifications: [],
    projects: [],
    languages: [],
    licences: [],
    awards: [],
    publications: [],
    industries: [],
    targetRoles: [],
    additional: [],
  };
}

/* ------------------------------------------------------------------ */
/* Master profile                                                      */
/* ------------------------------------------------------------------ */

export type Confidence = "CONFIRMED" | "NEEDS_REVIEW" | "CONFLICTING";

export type EvidenceSource = {
  cvId: string;
  cvName: string;
  rawLabel: string;
  snippet: string | null;
  data: unknown;
};

export type ProfileAttribute = {
  id: string;
  category: string;
  group: string | null;
  key: string;
  label: string;
  data: any;
  confidence: Confidence;
  variants: string[] | null;
  userStatus: string | null;
  resolvedValue: string | null;
  userNote: string | null;
  sources: EvidenceSource[];
};

export type MasterProfile = {
  attributes: ProfileAttribute[];
  byCategory: Record<string, ProfileAttribute[]>;
  cvCount: number;
  conflicts: ProfileAttribute[];
  needsReview: ProfileAttribute[];
};

/* ------------------------------------------------------------------ */
/* Job matching                                                        */
/* ------------------------------------------------------------------ */

export type RequirementImportance = "MUST" | "NICE";

export type RequirementKind =
  | "SKILL"
  | "TOOL"
  | "ROLE"
  | "EXPERIENCE"
  | "EDUCATION"
  | "CERTIFICATION"
  | "LANGUAGE"
  | "SOFT"
  | "OTHER";

export type JobRequirement = {
  /** Short display label, e.g. "Power BI" */
  label: string;
  /** Canonical key used for matching */
  key: string;
  kind: RequirementKind;
  importance: RequirementImportance;
  /** The line from the job ad this came from */
  quote: string;
};

export type MatchLevel = "DIRECT" | "RELATED" | "NONE";

export type RequirementMatch = {
  requirement: JobRequirement;
  /** How well the master profile covers this requirement */
  profileLevel: MatchLevel;
  profileConfidence: Confidence | null;
  profileEvidence: { cvName: string; rawLabel: string }[];
  matchedLabel: string | null;
  /** How well the recommended CV communicates it */
  cvLevel: MatchLevel;
  /** Times the term appears in that CV's text */
  cvMentions: number;
  /** HAVE | HAVE_NOT_EMPHASISED | MISSING | UNCLEAR */
  gap: GapBucket;
};

export type GapBucket = "HAVE" | "HAVE_NOT_EMPHASISED" | "MISSING" | "UNCLEAR";

export type CvAlignment = {
  cvId: string;
  cvName: string;
  score: number;
  covered: number;
  total: number;
  /** requirement key -> level within this CV */
  levels: Record<string, MatchLevel>;
  mentions: Record<string, number>;
};

export type JobAnalysis = {
  requirements: JobRequirement[];
  professionalMatch: number;
  cvMatch: number;
  recommendedCvId: string | null;
  recommendedCvName: string | null;
  recommendationReason: string;
  alignments: CvAlignment[];
  matches: RequirementMatch[];
  verdict: {
    /** APPLY | APPLY_AFTER_TAILORING | STRETCH | POOR_FIT */
    decision: string;
    headline: string;
    detail: string;
  };
  analyzedBy: string;
};

export type TailorResult = {
  markdown: string;
  changesMade: string[];
  notAdded: string[];
  warnings: string[];
  generator: string;
};
