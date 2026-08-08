import { hasApiKey, structured } from "../anthropic";
import type { CvExtraction } from "../types";
import { extractWithRules } from "./rules";
import { CV_EXTRACTION_SCHEMA, CV_EXTRACTION_SYSTEM } from "./schema";

export type ExtractionResult = {
  extraction: CvExtraction;
  extractedBy: "claude" | "rules";
  note?: string;
};

/**
 * Extract structured information from one CV's plain text.
 *
 * Uses Claude when a key is configured, and falls back to the deterministic
 * parser otherwise — or if the API call fails, so an upload is never lost to a
 * transient error.
 */
export async function extractCv(text: string): Promise<ExtractionResult> {
  if (!hasApiKey()) {
    return { extraction: extractWithRules(text), extractedBy: "rules" };
  }

  try {
    const raw = await structured<CvExtraction>({
      system: CV_EXTRACTION_SYSTEM,
      user: `Extract this CV.\n\n<cv>\n${text}\n</cv>`,
      schema: CV_EXTRACTION_SCHEMA,
      maxTokens: 32000,
      effort: "medium",
    });
    return { extraction: verify(coerce(raw), text), extractedBy: "claude" };
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    return {
      extraction: extractWithRules(text),
      extractedBy: "rules",
      note: `Claude extraction failed (${note}); used the built-in parser instead.`,
    };
  }
}

/** Fill in anything the model omitted so downstream code never sees undefined. */
function coerce(raw: Partial<CvExtraction>): CvExtraction {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  return {
    personal: {
      fullName: str(raw.personal?.fullName),
      email: str(raw.personal?.email),
      phone: str(raw.personal?.phone),
      location: str(raw.personal?.location),
      headline: str(raw.personal?.headline),
      summary: str(raw.personal?.summary),
      links: strArr(raw.personal?.links),
    },
    totalYearsExperience: str(raw.totalYearsExperience),
    totalYearsEvidence: str(raw.totalYearsEvidence),
    experience: (raw.experience ?? []).map((e) => ({
      jobTitle: str(e?.jobTitle),
      company: str(e?.company),
      location: str(e?.location),
      industry: str(e?.industry),
      startDate: str(e?.startDate),
      endDate: str(e?.endDate),
      responsibilities: strArr(e?.responsibilities),
      achievements: strArr(e?.achievements),
      technologies: strArr(e?.technologies),
    })).filter((e) => e.jobTitle || e.company),
    skills: (raw.skills ?? [])
      .map((s) => ({ name: str(s?.name), kind: str(s?.kind) || "technical" }))
      .filter((s) => s.name.length > 1),
    education: (raw.education ?? []).map((e) => ({
      degree: str(e?.degree),
      field: str(e?.field),
      institution: str(e?.institution),
      location: str(e?.location),
      startDate: str(e?.startDate),
      endDate: str(e?.endDate),
      grade: str(e?.grade),
    })).filter((e) => e.degree || e.institution),
    certifications: (raw.certifications ?? []).map((c) => ({
      name: str(c?.name),
      issuer: str(c?.issuer),
      issueDate: str(c?.issueDate),
      expiryDate: str(c?.expiryDate),
    })).filter((c) => c.name),
    projects: (raw.projects ?? []).map((p) => ({
      name: str(p?.name),
      description: str(p?.description),
      role: str(p?.role),
      technologies: strArr(p?.technologies),
      outcomes: strArr(p?.outcomes),
    })).filter((p) => p.name),
    languages: (raw.languages ?? []).map((l) => ({
      language: str(l?.language),
      proficiency: str(l?.proficiency),
    })).filter((l) => l.language),
    licences: strArr(raw.licences),
    awards: strArr(raw.awards),
    publications: strArr(raw.publications),
    industries: strArr(raw.industries),
    targetRoles: strArr(raw.targetRoles),
    additional: strArr(raw.additional),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Evidence check on the one field most likely to be inferred rather than read:
 * a stated years-of-experience figure must actually appear in the CV text. If
 * it doesn't, the model computed it, so we drop it rather than let a derived
 * number enter the profile as a stated fact.
 */
function verify(extraction: CvExtraction, text: string): CvExtraction {
  if (!extraction.totalYearsExperience) return extraction;

  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const n = extraction.totalYearsExperience.match(/\d+/)?.[0];
  const evidence = extraction.totalYearsEvidence.toLowerCase().replace(/\s+/g, " ").trim();

  const evidenceFound = evidence.length > 3 && haystack.includes(evidence);
  const numberFound =
    !!n && new RegExp(`${n}\\s*\\+?\\s*(?:years?|yrs?)`, "i").test(haystack);

  if (!evidenceFound && !numberFound) {
    return { ...extraction, totalYearsExperience: "", totalYearsEvidence: "" };
  }
  return extraction;
}
