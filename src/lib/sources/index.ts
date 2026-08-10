/**
 * The provider registry.
 *
 * Add a board by writing an adapter next to this file and appending it here.
 * Nothing downstream — dedup, scoring, the UI — needs to change.
 *
 * Deliberately absent: direct LinkedIn / Indeed / Glassdoor scrapers. All three
 * block automated access and LinkedIn bans the account behind the session used
 * to scrape it, so a scraper works until it silently doesn't. JSearch reaches
 * the same postings through the Google Jobs index instead.
 */

import { adzuna } from "./adzuna";
import { jsearch } from "./jsearch";
import { remoteok } from "./remoteok";
import { remotive } from "./remotive";
import { weworkremotely } from "./weworkremotely";
import type { JobProvider, ProviderStatus } from "./types";

export const PROVIDERS: JobProvider[] = [
  jsearch,
  adzuna,
  remotive,
  remoteok,
  weworkremotely,
];

export function providerById(id: string): JobProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Every provider with its current readiness, for the settings UI. */
export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => {
    const reason = p.unavailableReason();
    return {
      id: p.id,
      name: p.name,
      blurb: p.blurb,
      available: reason === null,
      reason,
    };
  });
}

/**
 * The providers a given saved search should actually hit: its own selection
 * where it made one, minus anything that isn't configured.
 */
export function resolveProviders(selected: string[] | null): JobProvider[] {
  const pool = selected?.length
    ? PROVIDERS.filter((p) => selected.includes(p.id))
    : PROVIDERS;
  return pool.filter((p) => p.unavailableReason() === null);
}

export type { FetchedJob, JobProvider, ProviderQuery, ProviderRunResult, ProviderStatus } from "./types";
