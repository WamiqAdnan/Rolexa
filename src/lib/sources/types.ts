/**
 * Job source adapters.
 *
 * Every provider returns the same shape, so the fetch pipeline, the deduper and
 * the scorer never learn which portal a job came from. Adding a board means
 * adding one file here and listing it in `index.ts` — nothing downstream moves.
 *
 * A provider is a reader, never an author: it maps the portal's fields onto
 * `FetchedJob` and leaves anything the portal didn't say as null. Nothing is
 * inferred, in keeping with how the rest of Rolexa treats source material.
 */

export type FetchedJob = {
  /** The portal's own id. Null when it doesn't expose one — dedup handles it. */
  externalId: string | null;
  title: string;
  company: string | null;
  location: string | null;
  /** Plain text. Providers strip their own HTML before returning. */
  description: string;
  url: string | null;
  salary: string | null;
  postedAt: Date | null;
  remote: boolean;
  /**
   * The board this advert actually lives on, when an aggregator tells us —
   * JSearch reports "LinkedIn", "Indeed" and so on. Used for the source badge.
   */
  publisher?: string | null;
};

export type ProviderQuery = {
  keywords: string;
  location: string | null;
  remoteOnly: boolean;
  limit: number;
};

export type JobProvider = {
  id: string;
  name: string;
  /** One line for the UI: what this source covers. */
  blurb: string;
  /** Null when ready to run; otherwise why it can't (usually a missing key). */
  unavailableReason: () => string | null;
  fetch: (query: ProviderQuery) => Promise<FetchedJob[]>;
};

export type ProviderStatus = {
  id: string;
  name: string;
  blurb: string;
  available: boolean;
  reason: string | null;
};

/** What one provider did on one saved search. */
export type ProviderRunResult = {
  providerId: string;
  providerName: string;
  seen: number;
  added: number;
  merged: number;
  error: string | null;
};
