import {
  canonicalRole,
  familyLabel,
  familySearchTitles,
  parseYears,
  stripSeniority,
} from "./normalize";
import type { MasterProfile, ProfileAttribute } from "./types";

/**
 * Search terms derived from the Master Profile.
 *
 * These are the keywords, titles and locations you would type into a job board.
 * Everything here comes from the profile, so the same honesty rule applies: a
 * title you have never held is offered as a *transferable* suggestion and
 * labelled as one, and a seniority level is only suggested when your evidenced
 * experience supports it.
 */

export type SearchTitle = {
  term: string;
  /** true when a CV shows you actually held this title */
  held: boolean;
  familyLabel: string | null;
  why: string;
  sources: string[];
  /** on by default in the UI */
  recommended: boolean;
};

export type SearchKeyword = {
  term: string;
  group: string;
  confidence: string;
  sourceCount: number;
  sources: string[];
  recommended: boolean;
};

export type SearchLocation = {
  term: string;
  why: string;
  sources: string[];
  recommended: boolean;
};

export type SearchProfile = {
  titles: SearchTitle[];
  keywords: SearchKeyword[];
  locations: SearchLocation[];
  industries: { term: string; sources: string[] }[];
  /** Seniority words your evidence supports, e.g. ["", "Senior"] */
  seniority: string[];
  years: { value: number; derived: boolean } | null;
  notes: string[];
};

const MAX_TITLES = 14;
const MAX_KEYWORDS = 18;

/**
 * Skills too common in adverts to narrow a search. They stay in the list —
 * they're real skills and you may want them — but ANDing "Excel" into a query
 * excludes almost nothing, so they aren't switched on by default.
 */
const WEAK_SEARCH_KEYWORDS = new Set([
  "excel",
  "word",
  "powerpoint",
  "google-sheets",
  "reporting",
  "data-analysis",
  "communication",
  "presentation",
  "problem-solving",
  "collaboration",
  "time-management",
  "attention-to-detail",
]);

export function buildSearchProfile(profile: MasterProfile): SearchProfile {
  const live = (list: ProfileAttribute[] = []) =>
    list.filter((a) => a.userStatus !== "REJECTED");

  const notes: string[] = [];

  /* ---- seniority envelope --------------------------------------- */
  const yearsAttr = live(profile.byCategory.EXPERIENCE_YEARS)[0];
  // An unresolved conflict means there is no agreed figure, so don't pick one
  // of the competing values — fall through to the timeline.
  const yearsUnresolved = yearsAttr?.confidence === "CONFLICTING" && !yearsAttr.resolvedValue;
  const statedYears =
    yearsAttr && !yearsUnresolved
      ? parseYears(String(yearsAttr.resolvedValue ?? yearsAttr.data?.value ?? ""))
      : null;
  const derivedYears = deriveYears(live(profile.byCategory.EXPERIENCE));
  const years =
    statedYears !== null
      ? { value: statedYears, derived: false }
      : derivedYears !== null
        ? { value: derivedYears, derived: true }
        : null;

  if (yearsUnresolved) {
    notes.push(
      "Your CVs disagree on total years of experience, so seniority suggestions " +
        "use the employment timeline instead. Resolve it on your profile for a sharper set.",
    );
  }

  const heldRoles = live(profile.byCategory.ROLE);
  const heldSeniority = new Set(
    heldRoles.map((r) => r.data?.seniority).filter(Boolean) as string[],
  );
  const hasManagementEvidence = live(profile.byCategory.SKILL).some(
    (s) => s.group === "MANAGEMENT",
  );
  const seniority = seniorityWords(years?.value ?? null, heldSeniority, hasManagementEvidence);

  /* ---- titles ---------------------------------------------------- */
  const titles: SearchTitle[] = [];
  const seenTitle = new Set<string>();

  const pushTitle = (t: SearchTitle) => {
    const term = searchableTitle(t.term);
    const key = term.toLowerCase();
    if (!term || seenTitle.has(key)) return;
    seenTitle.add(key);
    titles.push({ ...t, term });
  };

  // Titles you have actually held, base form first — the base form casts a
  // wider net on a job board than the seniority-prefixed one.
  for (const role of heldRoles) {
    const base = stripSeniority(role.label);
    pushTitle({
      term: base || role.label,
      held: true,
      familyLabel: role.data?.familyLabel ?? null,
      why: "You have held this title",
      sources: role.sources.map((s) => s.cvName),
      recommended: true,
    });
  }

  // Target roles you set on an upload or that a CV headline states.
  for (const target of live(profile.byCategory.TARGET_ROLE)) {
    if (heldRoles.some((r) => r.key === target.key)) continue;
    pushTitle({
      term: stripSeniority(target.label) || target.label,
      held: false,
      familyLabel: target.data?.familyLabel ?? null,
      why: "You named this as a target role",
      sources: target.sources.map((s) => s.cvName),
      recommended: true,
    });
  }

  // Sibling titles from the same role family — transferable, not held.
  const families = new Set(
    [...heldRoles, ...live(profile.byCategory.TARGET_ROLE)]
      .map((r) => r.data?.family)
      .filter(Boolean) as string[],
  );
  for (const family of families) {
    for (const sibling of familySearchTitles(family)) {
      if (titles.length >= MAX_TITLES) break;
      pushTitle({
        term: sibling,
        held: false,
        familyLabel: familyLabel(family),
        why: `Same role family as your experience (${familyLabel(family) ?? family})`,
        sources: [],
        recommended: false,
      });
    }
  }

  /* ---- keywords -------------------------------------------------- */
  // Soft skills are excluded: "Communication" as a job-board keyword returns
  // noise, not matches.
  const GROUP_RANK: Record<string, number> = {
    TOOL: 0,
    TECHNICAL: 1,
    CORE: 2,
    MANAGEMENT: 3,
    INDUSTRY: 4,
  };
  const ranked = live(profile.byCategory.SKILL)
    .filter((s) => s.group !== "SOFT")
    .sort((a, b) => {
      const conf = confRank(a.confidence) - confRank(b.confidence);
      if (conf) return conf;
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
      return (GROUP_RANK[a.group ?? ""] ?? 9) - (GROUP_RANK[b.group ?? ""] ?? 9);
    })
    .slice(0, MAX_KEYWORDS);

  // Default-on: the strongest few that actually discriminate. Cap at four —
  // more than that over-narrows most job boards.
  const defaultOn = new Set(
    ranked
      .filter((s) => s.confidence !== "CONFLICTING" && !WEAK_SEARCH_KEYWORDS.has(s.key))
      .slice(0, 4)
      .map((s) => s.key),
  );

  const keywords: SearchKeyword[] = ranked.map((s) => ({
    term: s.label,
    group: s.group ?? "TECHNICAL",
    confidence: s.confidence,
    sourceCount: s.sources.length,
    sources: s.sources.map((x) => x.cvName),
    recommended: defaultOn.has(s.key),
  }));

  /* ---- locations ------------------------------------------------- */
  const locations: SearchLocation[] = [];
  const pushLoc = (term: string, why: string, sources: string[], recommended: boolean) => {
    const clean = term.trim().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
    if (!clean) return;
    const key = clean.toLowerCase();

    // "Dubai" and "Dubai, UAE" are the same search. Keep the more specific
    // form, and let a recommended flag from either occurrence win.
    const existing = locations.findIndex((l) => {
      const other = l.term.toLowerCase();
      return other === key || other.includes(key) || key.includes(other);
    });
    if (existing >= 0) {
      const kept = locations[existing];
      if (clean.length > kept.term.length) {
        locations[existing] = { ...kept, term: clean, recommended: kept.recommended || recommended };
      } else if (recommended && !kept.recommended) {
        locations[existing] = { ...kept, recommended: true };
      }
      return;
    }
    locations.push({ term: clean, why, sources, recommended });
  };

  const locAttr = live(profile.byCategory.PERSONAL).find((a) => a.key === "location");
  if (locAttr) {
    // A conflict here is useful rather than a problem: each CV's location is a
    // place worth searching.
    if (locAttr.resolvedValue) {
      pushLoc(locAttr.resolvedValue, "You confirmed this location", [], true);
    }
    for (const source of locAttr.sources) {
      pushLoc(source.rawLabel, `Stated on ${source.cvName}`, [source.cvName], true);
    }
  }

  // Places you have worked, from the employment history.
  for (const exp of live(profile.byCategory.EXPERIENCE)) {
    const where = String(exp.data?.location ?? "").trim();
    if (where) {
      pushLoc(where, "You have worked here", exp.sources.map((s) => s.cvName), false);
    }
  }
  pushLoc("Remote", "Worth running as a separate search", [], false);

  /* ---- industries ------------------------------------------------ */
  const industries = [
    ...live(profile.byCategory.INDUSTRY),
    ...live(profile.byCategory.TARGET_INDUSTRY),
  ]
    .filter((a, i, all) => all.findIndex((x) => x.key === a.key) === i)
    .map((a) => ({ term: a.label, sources: a.sources.map((s) => s.cvName) }));

  if (!titles.length) {
    notes.push(
      "No job titles found yet — upload a CV with an employment history, or set a " +
        "target role on an upload.",
    );
  }

  return { titles, keywords, locations, industries, seniority, years, notes };
}

/* ------------------------------------------------------------------ */
/* Query building                                                      */
/* ------------------------------------------------------------------ */

export type BuiltQuery = {
  /** Boolean string that works on LinkedIn, Indeed and most ATS searches */
  boolean: string;
  /** Plain space-separated terms, for boards that don't do boolean */
  plain: string;
};

/**
 * Turn selected titles and keywords into query strings.
 *
 * `broad` ORs the titles only — the widest useful net. `focused` also requires
 * one of the keywords, which cuts volume hard, so it is offered separately
 * rather than as the default.
 */
export function buildQueries(titles: string[], keywords: string[]): {
  broad: BuiltQuery;
  focused: BuiltQuery;
} {
  const orGroup = (terms: string[]) =>
    terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" OR ");

  const titleGroup = titles.length ? `(${orGroup(titles)})` : "";
  const keywordGroup = keywords.length ? `(${orGroup(keywords)})` : "";

  return {
    broad: {
      boolean: titleGroup,
      plain: titles.join(" "),
    },
    focused: {
      boolean: [titleGroup, keywordGroup].filter(Boolean).join(" AND "),
      plain: [...titles.slice(0, 2), ...keywords.slice(0, 3)].join(" "),
    },
  };
}

/**
 * Deep links into job-board searches.
 *
 * Only boards whose query-string format is stable and well known are included.
 * Add your own by appending to this array — `{q}` and `{l}` are substituted
 * with the URL-encoded query and location.
 */
export const JOB_BOARDS: {
  id: string;
  name: string;
  template: string;
  /** Some boards choke on boolean operators; give them the plain form. */
  prefersPlain?: boolean;
  note?: string;
}[] = [
  {
    id: "linkedin",
    name: "LinkedIn Jobs",
    template: "https://www.linkedin.com/jobs/search/?keywords={q}&location={l}",
  },
  {
    id: "indeed",
    name: "Indeed",
    template: "https://www.indeed.com/jobs?q={q}&l={l}",
    note: "Swap the domain for your country, e.g. indeed.ae or uk.indeed.com.",
  },
  {
    id: "google",
    name: "Google Jobs",
    template: "https://www.google.com/search?q={q}+jobs+{l}&ibp=htl;jobs",
    prefersPlain: true,
  },
  {
    id: "glassdoor",
    name: "Glassdoor",
    template: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={q}&locT=C&locKeyword={l}",
    prefersPlain: true,
  },
];

export function boardUrl(
  board: (typeof JOB_BOARDS)[number],
  query: BuiltQuery,
  location: string,
): string {
  const q = board.prefersPlain ? query.plain : query.boolean;
  return board.template
    .replace("{q}", encodeURIComponent(q))
    .replace("{l}", encodeURIComponent(location));
}

/* ------------------------------------------------------------------ */

function confRank(c: string): number {
  return c === "CONFIRMED" ? 0 : c === "NEEDS_REVIEW" ? 1 : 2;
}

/**
 * Reduce a CV title to something worth typing into a job board.
 *
 * A headline like "Project Manager - Data & Analytics" is accurate but a poor
 * search term: boards match it literally and return almost nothing. The
 * qualifier after a dash, pipe or bracket is dropped, which usually collapses
 * the title onto one already in the list.
 */
function searchableTitle(raw: string): string {
  const trimmed = raw
    .split(/\s+[-–—|/]\s+|\s*[(\[]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  // Anything still this long is a headline, not a title recruiters index on.
  if (!trimmed || trimmed.split(/\s+/).length > 5) return "";
  return trimmed;
}

/**
 * Which seniority words to offer. Only levels the evidence supports: a "Lead"
 * or "Manager" suggestion needs management experience on a CV, not just years
 * served.
 */
function seniorityWords(
  years: number | null,
  held: Set<string>,
  hasManagementEvidence: boolean,
): string[] {
  const out = new Set<string>([""]); // the bare title is always worth searching

  if (held.has("Senior")) out.add("Senior");
  if (held.has("Lead")) out.add("Lead");
  if (held.has("Manager") || held.has("Executive")) out.add("Manager");

  if (years !== null) {
    if (years < 2) out.add("Junior");
    if (years >= 4) out.add("Senior");
    if (years >= 8 && hasManagementEvidence) {
      out.add("Lead");
      out.add("Manager");
    }
  }
  return [...out];
}

/** Union of employment spans, in years. Used only to size seniority hints. */
function deriveYears(experience: ProfileAttribute[]): number | null {
  const now = new Date().getFullYear() + new Date().getMonth() / 12;
  const spans: [number, number][] = [];

  for (const attr of experience) {
    const start = yearValue(String(attr.data?.startDate ?? ""));
    if (start === null) continue;
    const endRaw = String(attr.data?.endDate ?? "");
    const end = /present/i.test(endRaw) ? now : yearValue(endRaw);
    spans.push([start, end ?? start]);
  }
  if (!spans.length) return null;

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
