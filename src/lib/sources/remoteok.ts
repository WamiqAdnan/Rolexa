/**
 * RemoteOK — open JSON feed, no key.
 * Docs: https://remoteok.com/api
 *
 * The feed has no search parameter: it returns the current board and we filter
 * locally against the saved search's keywords. The first array element is a
 * legal notice rather than a job, so it is dropped.
 */

import { formatSalary, getJson, matchesKeywords, stripHtml, toDate } from "./http";
import type { FetchedJob, JobProvider, ProviderQuery } from "./types";

type RemoteOkItem = {
  legal?: string;
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  tags?: string[];
  date?: string;
  epoch?: number;
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
};

export const remoteok: JobProvider = {
  id: "remoteok",
  name: "RemoteOK",
  blurb: "Remote board, tech-heavy. Free, no key needed.",

  unavailableReason: () => null,

  async fetch(query: ProviderQuery): Promise<FetchedJob[]> {
    const items = await getJson<RemoteOkItem[]>("https://remoteok.com/api");

    return items
      .filter((item) => !item.legal && item.position)
      .map((item) => {
        const description = stripHtml(item.description ?? "");
        return {
          externalId: item.id != null ? String(item.id) : (item.slug ?? null),
          title: item.position!.trim(),
          company: item.company?.trim() || null,
          location: item.location?.trim() || "Remote",
          description,
          url: item.url ?? item.apply_url ?? null,
          salary: formatSalary(item.salary_min, item.salary_max, "USD", "year"),
          postedAt: toDate(item.date ?? item.epoch),
          remote: true,
        };
      })
      .filter(
        (job) =>
          job.description.length > 40 &&
          matchesKeywords(`${job.title} ${job.description}`, query.keywords),
      )
      .slice(0, query.limit);
  },
};
