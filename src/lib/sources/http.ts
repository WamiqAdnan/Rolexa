/** Shared fetch/parse helpers for the job source adapters. */

const TIMEOUT_MS = 15_000;

/** Identify ourselves. Several boards reject requests without a real UA. */
const USER_AGENT =
  "Rolexa/0.1 (personal job search tool; +https://github.com/local/rolexa)";

export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const body = await getText(url, headers, "application/json");
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("The source returned something that wasn't JSON.");
  }
}

export async function getText(
  url: string,
  headers: Record<string, string> = {},
  accept = "*/*",
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept, ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? "Rate limited — wait a minute before refreshing again."
          : res.status === 401 || res.status === 403
            ? `Rejected (HTTP ${res.status}) — check the API key.`
            : `HTTP ${res.status}`,
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Timed out after 15s.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: "…",
  bull: "•",
};

/**
 * HTML → plain text. Most boards return HTML descriptions; the requirement
 * extractor wants prose, and line structure carries meaning in an advert, so
 * block-level tags become newlines and list items keep their bullet.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|tr|section|article)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Portals report salary as separate numbers, a string, or not at all. */
export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency?: string | null,
  period?: string | null,
): string | null {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const unit = currency ? `${currency} ` : "";
  const per = period ? ` / ${period.toLowerCase()}` : "";
  if (min && max) {
    return min === max ? `${unit}${fmt(min)}${per}` : `${unit}${fmt(min)}–${fmt(max)}${per}`;
  }
  if (min) return `From ${unit}${fmt(min)}${per}`;
  if (max) return `Up to ${unit}${fmt(max)}${per}`;
  return null;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(typeof value === "number" ? value * 1000 : String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Local keyword filter, for the boards whose feeds have no search parameter.
 *
 * Every term must appear by default: someone who types "data analyst" means
 * both words, and matching either lets any advert that says "data" once through
 * — which in practice is most of them. An explicit uppercase `OR`, the form
 * /search emits in its boolean queries, switches to matching any term.
 */
export function matchesKeywords(haystack: string, keywords: string): boolean {
  const anyOf = /\bOR\b/.test(keywords);
  const terms = keywords
    .replace(/[()"']/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return true;
  const hay = haystack.toLowerCase();
  return anyOf ? terms.some((t) => hay.includes(t)) : terms.every((t) => hay.includes(t));
}
