/**
 * Recognising one advert posted to several portals.
 *
 * This is the same problem the Master Profile already solves for CVs — one fact
 * worded differently by different sources — so it takes the same shape: a
 * canonical `Job` with a `JobSource` per portal, each keeping that portal's own
 * wording and link.
 *
 * The bar for merging is deliberately high. Two adverts merge only when the
 * employer and role agree *and* a second signal agrees: the same location, or
 * substantially the same text. Company plus title alone is not enough — a large
 * employer really does run two different "Data Analyst" openings in two cities,
 * and collapsing those would hide one of them. A false merge loses a job you
 * never see; a missed merge shows a duplicate you can ignore. So when the
 * evidence is thin, they stay apart.
 */

import { canonicalRole, slug, stripSeniority, tokenOverlap } from "./normalize";
import type { FetchedJob } from "./sources/types";

/** Text similarity above which two adverts are treated as the same posting. */
const SAME_TEXT = 0.55;

/** Below this, two descriptions actively disagree — never merge. */
const DIFFERENT_TEXT = 0.25;

/**
 * Identity across portals: normalised employer + role, seniority stripped.
 *
 * Seniority comes out because portals rewrite it ("Senior Data Analyst" on
 * LinkedIn, "Data Analyst - Senior" on Indeed, "Data Analyst" in the ATS feed).
 * It is only the *candidate* key — the confirmation step below still has to
 * pass, so two genuinely different levels at one employer don't silently merge.
 */
export function dedupeKey(company: string | null, title: string): string {
  const role = stripSeniority(canonicalRole(title).label);
  return `${slug(normaliseCompany(company))}::${slug(role)}`;
}

/**
 * Strip the decoration employers accumulate across portals: "Acme Corp.",
 * "Acme Corporation", "Acme (Dubai)" and "Acme Corp" are one employer.
 */
export function normaliseCompany(raw: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,]/g, " ")
    .replace(
      /\b(inc|llc|ltd|limited|plc|corp|corporation|co|company|gmbh|bv|nv|sa|ag|pte|pty|llp|group|holdings?|international|global|mena|fz-?llc|fzco|dmcc)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The comparable part of a location: the city, without the country tail that
 * every portal writes differently ("Dubai" / "Dubai, UAE" / "Dubai, Dubai,
 * United Arab Emirates").
 */
export function locationKey(raw: string | null): string {
  if (!raw) return "";
  const first = raw.split(",")[0]?.trim() ?? "";
  if (/^remote$/i.test(first)) return "remote";
  return slug(first);
}

type Candidate = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  remote: boolean;
};

export type MergeDecision =
  | { merge: true; jobId: string; reason: string }
  | { merge: false };

/**
 * Decide whether an incoming advert is a copy of one already stored.
 *
 * `candidates` should already be narrowed to rows sharing the incoming job's
 * dedupeKey — this only runs the confirmation step.
 */
export function findMerge(incoming: FetchedJob, candidates: Candidate[]): MergeDecision {
  for (const candidate of candidates) {
    const overlap = tokenOverlap(incoming.description, candidate.description);

    // Two adverts describing visibly different work are not the same posting,
    // whatever the title says.
    if (overlap < DIFFERENT_TEXT) continue;

    if (overlap >= SAME_TEXT) {
      return {
        merge: true,
        jobId: candidate.id,
        reason: `same employer and role, ${Math.round(overlap * 100)}% identical text`,
      };
    }

    // Text is compatible but not conclusive — often because one portal truncated
    // its description. Let location settle it.
    const a = locationKey(incoming.location);
    const b = locationKey(candidate.location);
    if (a && b && a === b) {
      return { merge: true, jobId: candidate.id, reason: "same employer, role and location" };
    }
    if ((incoming.remote || a === "remote") && (candidate.remote || b === "remote")) {
      return { merge: true, jobId: candidate.id, reason: "same employer and role, both remote" };
    }
  }

  return { merge: false };
}

/**
 * Which of two descriptions to keep as the canonical text.
 *
 * Portals truncate differently — Adzuna's free tier caps at roughly 200
 * characters — and the requirement extractor is only as good as the text it
 * reads, so a materially fuller version replaces a thinner one. "Materially"
 * is a third longer, to avoid re-analysing a job over a formatting difference.
 */
export function shouldReplaceDescription(current: string, incoming: string): boolean {
  return incoming.length > current.length * 1.33 && incoming.length - current.length > 200;
}
