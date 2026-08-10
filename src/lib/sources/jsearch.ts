/**
 * JSearch (RapidAPI) — indexes Google Jobs, which in turn carries LinkedIn,
 * Indeed, Glassdoor and ZipRecruiter postings. This is the supported route to
 * that inventory: those four block direct scraping, and LinkedIn in particular
 * will ban the account whose session you scrape with.
 *
 * Docs: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
 *
 * `job_publisher` names the board an advert actually lives on, so the source
 * badge can read "LinkedIn" rather than "JSearch" — and the deduper can tell
 * that the LinkedIn and Indeed copies of one advert are the same job.
 */

import { formatSalary, getJson, toDate } from "./http";
import type { FetchedJob, JobProvider, ProviderQuery } from "./types";

type JSearchResponse = {
  data?: {
    job_id?: string;
    job_title?: string;
    employer_name?: string;
    job_description?: string;
    job_apply_link?: string;
    job_publisher?: string;
    job_city?: string;
    job_state?: string;
    job_country?: string;
    job_is_remote?: boolean;
    job_posted_at_datetime_utc?: string;
    job_min_salary?: number;
    job_max_salary?: number;
    job_salary_currency?: string;
    job_salary_period?: string;
  }[];
};

export const jsearch: JobProvider = {
  id: "jsearch",
  name: "JSearch",
  blurb: "Google Jobs index — carries LinkedIn, Indeed and Glassdoor postings. Worldwide.",

  unavailableReason() {
    if (!process.env.RAPIDAPI_KEY) {
      return "Set RAPIDAPI_KEY in .env (free tier at rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch).";
    }
    return null;
  },

  async fetch(query: ProviderQuery): Promise<FetchedJob[]> {
    // JSearch takes one natural-language string, not separate fields.
    const parts = [query.keywords];
    if (query.location) parts.push(`in ${query.location}`);
    if (query.remoteOnly) parts.push("remote");

    const params = new URLSearchParams({
      query: parts.join(" "),
      page: "1",
      // 10 results per page; ask for enough pages to cover the limit.
      num_pages: String(Math.min(Math.ceil(query.limit / 10), 3)),
    });
    if (query.remoteOnly) params.set("remote_jobs_only", "true");

    const data = await getJson<JSearchResponse>(
      `https://jsearch.p.rapidapi.com/search?${params}`,
      {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY ?? "",
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
    );

    return (data.data ?? [])
      .filter((r) => r.job_title && r.job_description)
      .map((r) => ({
        externalId: r.job_id ?? null,
        title: r.job_title!.trim(),
        company: r.employer_name?.trim() || null,
        location:
          [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ") || null,
        description: r.job_description!.trim(),
        url: r.job_apply_link ?? null,
        salary: formatSalary(
          r.job_min_salary,
          r.job_max_salary,
          r.job_salary_currency,
          r.job_salary_period,
        ),
        postedAt: toDate(r.job_posted_at_datetime_utc),
        remote: Boolean(r.job_is_remote),
        publisher: r.job_publisher ?? null,
      }))
      .slice(0, query.limit);
  },
};
