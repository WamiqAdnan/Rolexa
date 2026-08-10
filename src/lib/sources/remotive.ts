/**
 * Remotive — curated remote roles, open JSON, no key.
 * Docs: https://github.com/remotive-com/remote-jobs-api
 *
 * Remote-only by definition, so a search with a city location will mostly
 * return nothing useful from here. That's expected, not an error.
 */

import { getJson, matchesKeywords, stripHtml, toDate } from "./http";
import type { FetchedJob, JobProvider, ProviderQuery } from "./types";

type RemotiveResponse = {
  jobs?: {
    id?: number;
    url?: string;
    title?: string;
    company_name?: string;
    category?: string;
    job_type?: string;
    publication_date?: string;
    candidate_required_location?: string;
    salary?: string;
    description?: string;
  }[];
};

export const remotive: JobProvider = {
  id: "remotive",
  name: "Remotive",
  blurb: "Curated remote roles. Free, no key needed.",

  unavailableReason: () => null,

  async fetch(query: ProviderQuery): Promise<FetchedJob[]> {
    const params = new URLSearchParams({
      search: query.keywords,
      limit: String(Math.min(query.limit, 50)),
    });
    const data = await getJson<RemotiveResponse>(
      `https://remotive.com/api/remote-jobs?${params}`,
    );

    return (data.jobs ?? [])
      .filter((j) => j.title && j.description)
      .map((j) => ({
        externalId: j.id != null ? String(j.id) : null,
        title: j.title!.trim(),
        company: j.company_name?.trim() || null,
        location: j.candidate_required_location?.trim() || "Remote",
        description: stripHtml(j.description!),
        url: j.url ?? null,
        salary: j.salary?.trim() || null,
        postedAt: toDate(j.publication_date),
        remote: true,
      }))
      // Remotive's own `search` matches tags and category as well as the text,
      // so a query for "full stack engineer" comes back carrying copywriting
      // and support roles. Its search is the recall step; this is precision.
      .filter((job) => matchesKeywords(`${job.title} ${job.description}`, query.keywords))
      .slice(0, query.limit);
  },
};
