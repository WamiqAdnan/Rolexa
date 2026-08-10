/**
 * Adzuna — aggregator with a free tier and good UK/EU/US/IN coverage.
 * Docs: https://developer.adzuna.com/
 *
 * Adzuna indexes by country, so ADZUNA_COUNTRY selects the market. It has no
 * UAE index — use JSearch for the Gulf.
 *
 * Note: the free tier truncates `description` to roughly 200 characters. Jobs
 * arriving this way are flagged so the UI can say the analysis is working from
 * a summary, not the full advert.
 */

import { formatSalary, getJson, stripHtml, toDate } from "./http";
import type { FetchedJob, JobProvider, ProviderQuery } from "./types";

const COUNTRIES = new Set([
  "gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es",
  "fr", "in", "it", "mx", "nl", "nz", "pl", "sg", "za",
]);

type AdzunaResponse = {
  results?: {
    id?: string;
    title?: string;
    description?: string;
    created?: string;
    redirect_url?: string;
    salary_min?: number;
    salary_max?: number;
    salary_is_predicted?: string;
    contract_time?: string;
    company?: { display_name?: string };
    location?: { display_name?: string; area?: string[] };
  }[];
};

function country(): string {
  const raw = (process.env.ADZUNA_COUNTRY ?? "gb").toLowerCase().trim();
  return COUNTRIES.has(raw) ? raw : "gb";
}

export const adzuna: JobProvider = {
  id: "adzuna",
  name: "Adzuna",
  blurb: "Aggregator, free tier. Strong UK/EU/US/IN coverage; no UAE index.",

  unavailableReason() {
    if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) {
      return "Set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env (free at developer.adzuna.com).";
    }
    return null;
  },

  async fetch(query: ProviderQuery): Promise<FetchedJob[]> {
    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID ?? "",
      app_key: process.env.ADZUNA_APP_KEY ?? "",
      results_per_page: String(Math.min(query.limit, 50)),
      what: query.keywords,
      "content-type": "application/json",
    });
    if (query.location) params.set("where", query.location);

    const url = `https://api.adzuna.com/v1/api/jobs/${country()}/search/1?${params}`;
    const data = await getJson<AdzunaResponse>(url);

    return (data.results ?? [])
      .filter((r) => r.title)
      .map((r) => {
        const location = r.location?.display_name ?? null;
        const description = stripHtml(r.description ?? "");
        const remote = /\bremote\b/i.test(`${r.title} ${location ?? ""} ${description}`);
        return {
          externalId: r.id ? String(r.id) : null,
          title: r.title!.trim(),
          company: r.company?.display_name?.trim() || null,
          location,
          description,
          url: r.redirect_url ?? null,
          // Predicted salaries are Adzuna's model, not the employer's figure.
          salary:
            r.salary_is_predicted === "1"
              ? null
              : formatSalary(r.salary_min, r.salary_max, null, r.contract_time),
          postedAt: toDate(r.created),
          remote,
        };
      })
      .filter((j) => j.description.length > 0);
  },
};
