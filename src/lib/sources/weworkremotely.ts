/**
 * We Work Remotely — RSS, no key.
 *
 * There is no JSON API, so this parses the feed. WWR packs company and role
 * into one title as "Company: Position"; both are recovered where the pattern
 * holds, and the whole string stays as the title when it doesn't rather than
 * guessing at a split.
 */

import { getText, stripHtml, toDate } from "./http";
import type { FetchedJob, JobProvider, ProviderQuery } from "./types";
import { matchesKeywords } from "./http";

const FEED = "https://weworkremotely.com/remote-jobs.rss";

function tag(block: string, name: string): string | null {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  if (!match) return null;
  return match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

export const weworkremotely: JobProvider = {
  id: "weworkremotely",
  name: "We Work Remotely",
  blurb: "Remote board, RSS feed. Free, no key needed.",

  unavailableReason: () => null,

  async fetch(query: ProviderQuery): Promise<FetchedJob[]> {
    const xml = await getText(FEED, {}, "application/rss+xml");
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

    return blocks
      .map((block): FetchedJob | null => {
        const rawTitle = tag(block, "title");
        const descriptionHtml = tag(block, "description");
        if (!rawTitle || !descriptionHtml) return null;

        const title = stripHtml(rawTitle);
        // "Acme Corp: Senior Data Analyst" — split on the first colon only.
        const split = title.match(/^([^:]{2,60}):\s*(.+)$/);
        const link = tag(block, "link");

        return {
          externalId: link ? link.split("/").filter(Boolean).pop() ?? null : null,
          title: (split ? split[2] : title).trim(),
          company: split ? split[1].trim() : null,
          location: tag(block, "region") ?? "Remote",
          description: stripHtml(descriptionHtml),
          url: link,
          salary: null,
          postedAt: toDate(tag(block, "pubDate")),
          remote: true,
        };
      })
      .filter((job): job is FetchedJob => {
        if (!job) return false;
        return (
          job.description.length > 40 &&
          matchesKeywords(`${job.title} ${job.description}`, query.keywords)
        );
      })
      .slice(0, query.limit);
  },
};
