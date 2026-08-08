import { prisma, json } from "./db";
import {
  canonicalRole,
  canonicalSkill,
  normaliseScalar,
  parseYears,
  skillSurfaceForms,
  slug,
} from "./normalize";
import type {
  Confidence,
  CvExtraction,
  MasterProfile,
  ProfileAttribute,
} from "./types";

/**
 * Master Professional Profile builder.
 *
 * This is an aggregation and understanding layer over the CV library. It may
 * unify wording and recognise that two CVs describe the same thing; it must
 * never manufacture a fact. Every attribute therefore carries the list of CVs
 * it came from and the exact wording each one used, and disagreements are
 * surfaced as conflicts rather than silently resolved.
 */

const CATEGORY_ORDER = [
  "PERSONAL",
  "EXPERIENCE_YEARS",
  "EXPERIENCE",
  "ROLE",
  "COMPANY",
  "INDUSTRY",
  "SKILL",
  "EDUCATION",
  "CERTIFICATION",
  "PROJECT",
  "ACHIEVEMENT",
  "LANGUAGE",
  "LICENCE",
  "AWARD",
  "PUBLICATION",
  "TARGET_ROLE",
  "TARGET_INDUSTRY",
] as const;

type SourceDraft = {
  cvId: string;
  cvName: string;
  rawLabel: string;
  snippet: string | null;
  data: unknown;
};

type AddOpts = {
  category: string;
  key: string;
  label: string;
  group?: string | null;
  cv: CvInput;
  rawLabel: string;
  snippet?: string | null;
  data?: unknown;
  /**
   * Value(s) compared across CVs to detect a conflict. Pass a record to compare
   * field by field; an empty value means "this CV didn't say", which is silence
   * rather than disagreement.
   */
  scalar?: string | Record<string, string>;
  /** Merge this source's payload into the attribute-level payload. */
  merge?: (current: any, incoming: any) => any;
};

type AddFn = (opts: AddOpts) => void;

type AttributeDraft = {
  category: string;
  group: string | null;
  key: string;
  label: string;
  data: any;
  sources: SourceDraft[];
  /** cvId -> { field: value } used for conflict detection. */
  scalars: Map<string, Record<string, string>>;
};

type CvInput = {
  id: string;
  name: string;
  targetRole: string | null;
  industry: string | null;
  parsedText: string | null;
  extraction: CvExtraction;
};

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export async function rebuildMasterProfile(): Promise<{ attributes: number; cvs: number }> {
  const cvRows = await prisma.cv.findMany({
    where: { status: "READY", extraction: { not: null } },
    orderBy: { uploadedAt: "asc" },
  });

  const cvs: CvInput[] = cvRows.map((cv) => ({
    id: cv.id,
    name: cv.name,
    targetRole: cv.targetRole,
    industry: cv.industry,
    parsedText: cv.parsedText,
    extraction: json<CvExtraction>(cv.extraction, {} as CvExtraction),
  }));

  const drafts = collect(cvs);

  // Preserve user decisions across rebuilds — they are keyed by the stable
  // (category, key) pair, not the row id.
  const existing = await prisma.attribute.findMany({
    select: {
      category: true,
      key: true,
      userStatus: true,
      resolvedValue: true,
      resolvedAt: true,
      userNote: true,
    },
  });
  const overrides = new Map(
    existing.map((a) => [`${a.category}::${a.key}`, a]),
  );

  await prisma.$transaction(async (tx) => {
    await tx.attribute.deleteMany({});

    for (const draft of drafts) {
      const override = overrides.get(`${draft.category}::${draft.key}`);
      const { confidence, variants } = assess(draft, cvs.length, override ?? null);

      await tx.attribute.create({
        data: {
          category: draft.category,
          group: draft.group,
          key: draft.key,
          label: draft.label,
          data: JSON.stringify(draft.data ?? null),
          confidence,
          variants: variants ? JSON.stringify(variants) : null,
          userStatus: override?.userStatus ?? null,
          resolvedValue: override?.resolvedValue ?? null,
          resolvedAt: override?.resolvedAt ?? null,
          userNote: override?.userNote ?? null,
          sources: {
            create: draft.sources.map((s) => ({
              cvId: s.cvId,
              rawLabel: s.rawLabel,
              snippet: s.snippet,
              data: JSON.stringify(s.data ?? null),
            })),
          },
        },
      });
    }

    await tx.meta.upsert({
      where: { key: "profileRebuiltAt" },
      create: { key: "profileRebuiltAt", value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });
  });

  return { attributes: drafts.length, cvs: cvs.length };
}

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

function collect(cvs: CvInput[]): AttributeDraft[] {
  const map = new Map<string, AttributeDraft>();

  const add: AddFn = (opts) => {
    if (!opts.key) return;
    const id = `${opts.category}::${opts.key}`;
    let draft = map.get(id);
    if (!draft) {
      draft = {
        category: opts.category,
        group: opts.group ?? null,
        key: opts.key,
        label: opts.label,
        data: undefined,
        sources: [],
        scalars: new Map(),
      };
      map.set(id, draft);
    }
    if (!draft.sources.some((s) => s.cvId === opts.cv.id)) {
      draft.sources.push({
        cvId: opts.cv.id,
        cvName: opts.cv.name,
        rawLabel: opts.rawLabel,
        snippet: opts.snippet ?? null,
        data: opts.data ?? null,
      });
    }
    if (opts.scalar !== undefined) {
      draft.scalars.set(
        opts.cv.id,
        typeof opts.scalar === "string" ? { value: opts.scalar } : opts.scalar,
      );
    }
    draft.data = opts.merge
      ? opts.merge(draft.data, opts.data)
      : (draft.data ?? opts.data ?? null);
  };

  for (const cv of cvs) {
    const ext = cv.extraction;
    if (!ext || !ext.personal) continue;
    const text = cv.parsedText ?? "";

    /* -- personal ------------------------------------------------- */
    const personalFields: [string, string, string][] = [
      ["name", "Full name", ext.personal.fullName],
      ["location", "Location", ext.personal.location],
      ["email", "Email", ext.personal.email],
      ["phone", "Phone", ext.personal.phone],
    ];
    for (const [key, label, value] of personalFields) {
      if (!value) continue;
      add({
        category: "PERSONAL",
        key,
        label,
        cv,
        rawLabel: value,
        data: { value },
        scalar: value,
      });
    }

    /* -- stated years of experience ------------------------------- */
    if (ext.totalYearsExperience) {
      add({
        category: "EXPERIENCE_YEARS",
        key: "total-years",
        label: "Years of experience",
        cv,
        rawLabel: ext.totalYearsEvidence || `${ext.totalYearsExperience} years`,
        snippet: ext.totalYearsEvidence || null,
        data: { value: ext.totalYearsExperience },
        scalar: String(parseYears(ext.totalYearsExperience) ?? ext.totalYearsExperience),
      });
    }

    /* -- employment ------------------------------------------------ */
    for (const role of ext.experience) {
      const canon = canonicalRole(role.jobTitle);
      const companyKey = slug(role.company);
      const expKey = companyKey
        ? `${companyKey}--${canon.family ?? slug(role.jobTitle)}`
        : `no-company--${slug(role.jobTitle)}`;

      const period = [role.startDate, role.endDate].filter(Boolean).join(" - ");

      add({
        category: "EXPERIENCE",
        key: expKey,
        label: role.company ? `${role.jobTitle} — ${role.company}` : role.jobTitle,
        cv,
        rawLabel: role.company ? `${role.jobTitle}, ${role.company}` : role.jobTitle,
        snippet: role.achievements[0] ?? role.responsibilities[0] ?? null,
        data: role,
        scalar: { startDate: role.startDate, endDate: role.endDate },
        merge: mergeExperience,
      });

      if (role.jobTitle) {
        add({
          category: "ROLE",
          key: canon.key,
          label: canon.label,
          cv,
          rawLabel: role.jobTitle,
          data: {
            family: canon.family,
            familyLabel: canon.familyLabel,
            seniority: canon.seniority,
          },
        });
      }
      if (role.company) {
        add({
          category: "COMPANY",
          key: companyKey,
          label: role.company,
          cv,
          rawLabel: role.company,
          data: { period },
        });
      }
      if (role.industry) {
        add({
          category: "INDUSTRY",
          key: slug(role.industry),
          label: role.industry,
          cv,
          rawLabel: role.industry,
        });
      }
      for (const tech of role.technologies) {
        addSkill(add, cv, tech, "tool", role.jobTitle);
      }
      for (const achievement of role.achievements) {
        addAchievement(add, cv, achievement, role.company || role.jobTitle);
      }
    }

    for (const industry of ext.industries) {
      if (!industry) continue;
      add({
        category: "INDUSTRY",
        key: slug(industry),
        label: industry,
        cv,
        rawLabel: industry,
      });
    }

    /* -- skills ---------------------------------------------------- */
    for (const skill of ext.skills) {
      addSkill(add, cv, skill.name, skill.kind, null, text);
    }

    /* -- education -------------------------------------------------- */
    for (const edu of ext.education) {
      const key = [slug(edu.degree), slug(edu.field), slug(edu.institution)]
        .filter(Boolean)
        .join("--");
      if (!key) continue;
      const label = [edu.degree, edu.field && `in ${edu.field}`, edu.institution && `— ${edu.institution}`]
        .filter(Boolean)
        .join(" ");
      add({
        category: "EDUCATION",
        key,
        label,
        cv,
        rawLabel: label,
        data: edu,
        scalar: { startDate: edu.startDate, endDate: edu.endDate, grade: edu.grade },
      });
    }

    /* -- certifications --------------------------------------------- */
    for (const cert of ext.certifications) {
      add({
        category: "CERTIFICATION",
        key: slug(cert.name),
        label: cert.name,
        cv,
        rawLabel: [cert.name, cert.issuer].filter(Boolean).join(" — "),
        data: cert,
        scalar: { issuer: cert.issuer, issueDate: cert.issueDate },
      });
    }

    /* -- projects ---------------------------------------------------- */
    for (const project of ext.projects) {
      add({
        category: "PROJECT",
        key: slug(project.name),
        label: project.name,
        cv,
        rawLabel: project.name,
        snippet: project.description || null,
        data: project,
      });
      for (const tech of project.technologies) {
        addSkill(add, cv, tech, "tool", project.name);
      }
    }

    /* -- languages ---------------------------------------------------- */
    for (const lang of ext.languages) {
      add({
        category: "LANGUAGE",
        key: slug(lang.language),
        label: lang.language,
        cv,
        rawLabel: lang.proficiency ? `${lang.language} (${lang.proficiency})` : lang.language,
        data: { proficiency: lang.proficiency },
        // Only conflict when both CVs state a proficiency and they disagree.
        scalar: lang.proficiency || undefined,
      });
    }

    /* -- misc lists ---------------------------------------------------- */
    for (const [category, items] of [
      ["LICENCE", ext.licences],
      ["AWARD", ext.awards],
      ["PUBLICATION", ext.publications],
    ] as const) {
      for (const item of items) {
        if (!item) continue;
        add({ category, key: slug(item).slice(0, 80), label: item, cv, rawLabel: item });
      }
    }
    for (const award of ext.awards) addAchievement(add, cv, award, "Award");

    /* -- targets -------------------------------------------------------- */
    const targetRoles = [...ext.targetRoles, cv.targetRole ?? ""].filter(Boolean);
    for (const target of targetRoles) {
      const canon = canonicalRole(target);
      add({
        category: "TARGET_ROLE",
        key: canon.key,
        label: canon.label,
        cv,
        rawLabel: target,
        data: { family: canon.family, familyLabel: canon.familyLabel },
      });
    }
    if (cv.industry) {
      add({
        category: "TARGET_INDUSTRY",
        key: slug(cv.industry),
        label: cv.industry,
        cv,
        rawLabel: cv.industry,
      });
    }
  }

  const drafts = [...map.values()];
  drafts.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]);
    const cb = CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]);
    if (ca !== cb) return ca - cb;
    if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
    return a.label.localeCompare(b.label);
  });
  return drafts;
}

function addSkill(
  add: AddFn,
  cv: CvInput,
  raw: string,
  kind: string,
  context: string | null,
  text?: string,
) {
  const name = raw.trim();
  if (name.length < 2 || name.length > 70) return;
  const canon = canonicalSkill(name, kind);
  add({
    category: "SKILL",
    key: canon.key,
    label: canon.label,
    group: canon.group,
    cv,
    rawLabel: name,
    snippet: context
      ? `Used in: ${context}`
      : text
        ? findSnippet(text, skillSurfaceForms(canon.key, canon.label))
        : null,
    data: { family: canon.family, known: canon.known },
    merge: (current: any, incoming: any) => ({
      family: current?.family ?? incoming?.family ?? null,
      known: current?.known || incoming?.known || false,
    }),
  });
}

function addAchievement(add: AddFn, cv: CvInput, text: string, context: string) {
  const trimmed = text.trim();
  if (trimmed.length < 12) return;
  add({
    category: "ACHIEVEMENT",
    key: slug(trimmed).slice(0, 90),
    label: trimmed,
    cv,
    rawLabel: trimmed,
    snippet: context || null,
    data: { context },
  });
}

/** Union the two descriptions of the same role without losing either wording. */
function mergeExperience(current: any, incoming: any) {
  if (!current) return { ...incoming, titles: [incoming.jobTitle].filter(Boolean) };
  const uniq = (a: string[] = [], b: string[] = []) => {
    const seen = new Map<string, string>();
    for (const item of [...a, ...b]) {
      const k = normaliseScalar(item);
      if (k && !seen.has(k)) seen.set(k, item);
    }
    return [...seen.values()];
  };
  const preferLater = (a: string, b: string) => {
    if (/present/i.test(a) || /present/i.test(b)) return "Present";
    return a > b ? a : b;
  };
  return {
    ...current,
    titles: uniq(current.titles ?? [current.jobTitle], [incoming.jobTitle]),
    company: current.company || incoming.company,
    location: current.location || incoming.location,
    industry: current.industry || incoming.industry,
    startDate:
      current.startDate && incoming.startDate
        ? current.startDate < incoming.startDate
          ? current.startDate
          : incoming.startDate
        : current.startDate || incoming.startDate,
    endDate:
      current.endDate && incoming.endDate
        ? preferLater(current.endDate, incoming.endDate)
        : current.endDate || incoming.endDate,
    responsibilities: uniq(current.responsibilities, incoming.responsibilities),
    achievements: uniq(current.achievements, incoming.achievements),
    technologies: uniq(current.technologies, incoming.technologies),
  };
}

function findSnippet(text: string, terms: string[]): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.length > 30 && line.length < 240 && terms.some((t) => lower.includes(t.toLowerCase()))) {
      return line.trim();
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

type Override = {
  userStatus: string | null;
  resolvedValue: string | null;
} | null;

function assess(
  draft: AttributeDraft,
  cvCount: number,
  override: Override,
): { confidence: Confidence; variants: string[] | null } {
  const variants = findConflict(draft);
  const conflicting = variants !== null;

  // An explicit user decision wins over everything computed.
  if (override?.userStatus === "CONFIRMED" || override?.resolvedValue) {
    return { confidence: "CONFIRMED", variants };
  }
  if (conflicting) return { confidence: "CONFLICTING", variants };

  // With a single CV in the library there is nothing to corroborate against,
  // so "clearly stated in a CV" is the strongest signal available.
  if (cvCount <= 1) return { confidence: "CONFIRMED", variants: null };

  return {
    confidence: draft.sources.length >= 2 ? "CONFIRMED" : "NEEDS_REVIEW",
    variants: null,
  };
}

/**
 * Compare each tracked field across CVs. A CV that simply omits a value is
 * silent, not contradictory — only two CVs *stating different things* is a
 * conflict. Returns one variant line per distinct value, naming every CV that
 * asserted it, or null when the sources agree.
 */
function findConflict(draft: AttributeDraft): string[] | null {
  if (draft.scalars.size < 2) return null;

  const cvName = new Map(draft.sources.map((s) => [s.cvId, s.cvName]));
  const fields = new Set<string>();
  for (const record of draft.scalars.values()) {
    for (const field of Object.keys(record)) fields.add(field);
  }

  const conflicts: string[] = [];

  for (const field of fields) {
    // Compare on the normalised form, but show the value as the CV wrote it.
    const byValue = new Map<string, { display: string; cvs: string[] }>();
    for (const [cvId, record] of draft.scalars) {
      const raw = (record[field] ?? "").trim();
      const value = normaliseScalar(raw);
      if (!value) continue;
      const entry = byValue.get(value);
      if (entry) entry.cvs.push(cvName.get(cvId) ?? cvId);
      else byValue.set(value, { display: raw, cvs: [cvName.get(cvId) ?? cvId] });
    }
    if (byValue.size < 2) continue;

    const prefix = fields.size > 1 ? `${humanise(field)}: ` : "";
    for (const { display, cvs } of byValue.values()) {
      conflicts.push(`${prefix}${display} — ${cvs.join(", ")}`);
    }
  }

  return conflicts.length ? conflicts : null;
}

function humanise(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function loadMasterProfile(): Promise<MasterProfile> {
  const [rows, cvCount] = await Promise.all([
    prisma.attribute.findMany({
      include: { sources: { include: { cv: { select: { id: true, name: true } } } } },
    }),
    prisma.cv.count({ where: { status: "READY" } }),
  ]);

  const attributes: ProfileAttribute[] = rows.map((row) => ({
    id: row.id,
    category: row.category,
    group: row.group,
    key: row.key,
    label: row.label,
    data: json<any>(row.data, null),
    confidence: row.confidence as Confidence,
    variants: json<string[] | null>(row.variants, null),
    userStatus: row.userStatus,
    resolvedValue: row.resolvedValue,
    userNote: row.userNote,
    sources: row.sources.map((s) => ({
      cvId: s.cvId,
      cvName: s.cv.name,
      rawLabel: s.rawLabel,
      snippet: s.snippet,
      data: json<unknown>(s.data, null),
    })),
  }));

  attributes.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]);
    const cb = CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]);
    if (ca !== cb) return ca - cb;
    if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
    return a.label.localeCompare(b.label);
  });

  const byCategory: Record<string, ProfileAttribute[]> = {};
  for (const attr of attributes) {
    (byCategory[attr.category] ??= []).push(attr);
  }

  return {
    attributes,
    byCategory,
    cvCount,
    conflicts: attributes.filter((a) => a.confidence === "CONFLICTING"),
    needsReview: attributes.filter((a) => a.confidence === "NEEDS_REVIEW"),
  };
}

export async function profileRebuiltAt(): Promise<Date | null> {
  const row = await prisma.meta.findUnique({ where: { key: "profileRebuiltAt" } });
  return row ? new Date(row.value) : null;
}

/** Sort employment newest-first for the timeline view. */
export function sortExperience(attrs: ProfileAttribute[]): ProfileAttribute[] {
  const rank = (a: ProfileAttribute) => {
    const end = String(a.data?.endDate ?? "");
    if (/present/i.test(end)) return "9999";
    return end || String(a.data?.startDate ?? "") || "0000";
  };
  return [...attrs].sort((a, b) => rank(b).localeCompare(rank(a)));
}
