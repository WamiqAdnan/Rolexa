/**
 * Refresh: run every saved search against every configured source, merge what
 * comes back, and score the new arrivals against the Master Profile.
 *
 * The point of scoring on arrival is that the feed is ranked rather than raw —
 * a refresh answers "what came in that's worth my time", not "here are 200
 * adverts". Everything downstream of a stored job is unchanged, because a
 * fetched job and a pasted one are the same row.
 */

import { prisma } from "./db";
import { dedupeKey, findMerge, shouldReplaceDescription } from "./job-dedupe";
import { detach, processJob } from "./pipeline";
import { resolveProviders } from "./sources";
import type { FetchedJob, JobProvider, ProviderRunResult } from "./sources/types";

/** Per provider, per search. Enough to be useful, small enough to stay polite. */
const PER_PROVIDER_LIMIT = 30;

/**
 * How many new jobs one refresh will score automatically. With an API key each
 * one is a Claude call, so an unbounded refresh could quietly cost real money.
 * Anything past the cap stays PENDING and can be analysed from its own page.
 */
const MAX_AUTO_SCORE = 25;

/** An advert shorter than this can't support a useful analysis. */
const MIN_DESCRIPTION = 40;

export type SearchRunResult = {
  searchId: string;
  searchName: string;
  seen: number;
  added: number;
  merged: number;
  error: string | null;
  providers: ProviderRunResult[];
};

export type RefreshReport = {
  searches: SearchRunResult[];
  totalAdded: number;
  totalMerged: number;
  totalSeen: number;
  scoring: number;
  skippedScoring: number;
  /** Providers that are configured but returned nothing, with why. */
  notes: string[];
};

/**
 * Store one fetched advert.
 *
 * Returns "added" for a new job, "merged" when it joined one already held, and
 * "seen" when this exact posting was already recorded from this provider.
 */
async function ingest(
  job: FetchedJob,
  provider: JobProvider,
  savedSearchId: string | null,
): Promise<{ outcome: "added" | "merged" | "seen"; jobId: string | null }> {
  if (!job.title.trim() || job.description.trim().length < MIN_DESCRIPTION) {
    return { outcome: "seen", jobId: null };
  }

  // Already have this exact posting from this provider? Touch it and move on.
  if (job.externalId) {
    const existing = await prisma.jobSource.findUnique({
      where: { provider_externalId: { provider: provider.id, externalId: job.externalId } },
      select: { id: true, jobId: true },
    });
    if (existing) {
      await prisma.jobSource.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return { outcome: "seen", jobId: existing.jobId };
    }
  }

  const key = dedupeKey(job.company, job.title);
  const candidates = await prisma.job.findMany({
    where: { dedupeKey: key },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      description: true,
      remote: true,
    },
  });

  const decision = findMerge(job, candidates);

  // The board an advert actually lives on, where the aggregator tells us.
  const providerName = job.publisher
    ? `${job.publisher} (via ${provider.name})`
    : provider.name;

  if (decision.merge) {
    const canonical = candidates.find((c) => c.id === decision.jobId)!;

    await prisma.jobSource.create({
      data: {
        jobId: decision.jobId,
        provider: provider.id,
        providerName,
        externalId: job.externalId,
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        postedAt: job.postedAt,
      },
    });

    // A fuller copy of the same advert improves every downstream answer, so it
    // replaces the stored text and the job is re-analysed.
    if (shouldReplaceDescription(canonical.description, job.description)) {
      await prisma.job.update({
        where: { id: decision.jobId },
        data: { description: job.description, status: "PENDING", error: null },
      });
      return { outcome: "merged", jobId: decision.jobId };
    }

    return { outcome: "merged", jobId: null };
  }

  const created = await prisma.job.create({
    data: {
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      source: providerName,
      origin: provider.id,
      url: job.url,
      salary: job.salary,
      remote: job.remote,
      postedAt: job.postedAt,
      dedupeKey: key,
      savedSearchId,
      status: "PENDING",
      sources: {
        create: {
          provider: provider.id,
          providerName,
          externalId: job.externalId,
          url: job.url,
          title: job.title,
          company: job.company,
          location: job.location,
          salary: job.salary,
          postedAt: job.postedAt,
        },
      },
    },
    select: { id: true },
  });

  return { outcome: "added", jobId: created.id };
}

async function runSearch(search: {
  id: string;
  name: string;
  keywords: string;
  location: string | null;
  remoteOnly: boolean;
  providers: string | null;
}): Promise<{ result: SearchRunResult; newJobIds: string[] }> {
  const selected = search.providers ? (JSON.parse(search.providers) as string[]) : null;
  const providers = resolveProviders(selected);

  const result: SearchRunResult = {
    searchId: search.id,
    searchName: search.name,
    seen: 0,
    added: 0,
    merged: 0,
    error: providers.length ? null : "No sources are configured — add an API key, or enable a free remote board.",
    providers: [],
  };

  if (!providers.length) return { result, newJobIds: [] };

  const query = {
    keywords: search.keywords,
    location: search.location,
    remoteOnly: search.remoteOnly,
    limit: PER_PROVIDER_LIMIT,
  };

  // Providers are independent and network-bound: fetch in parallel, then write
  // serially because SQLite takes one writer.
  const fetched = await Promise.allSettled(providers.map((p) => p.fetch(query)));

  const newJobIds: string[] = [];

  for (const [index, provider] of providers.entries()) {
    const outcome = fetched[index];
    const run: ProviderRunResult = {
      providerId: provider.id,
      providerName: provider.name,
      seen: 0,
      added: 0,
      merged: 0,
      error: null,
    };

    if (outcome.status === "rejected") {
      run.error =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      result.providers.push(run);
      continue;
    }

    for (const job of outcome.value) {
      run.seen++;
      try {
        const { outcome: what, jobId } = await ingest(job, provider, search.id);
        if (what === "added") {
          run.added++;
          if (jobId) newJobIds.push(jobId);
        } else if (what === "merged") {
          run.merged++;
          // A merge that improved the description needs re-scoring.
          if (jobId) newJobIds.push(jobId);
        }
      } catch (err) {
        run.error = err instanceof Error ? err.message : String(err);
      }
    }

    result.seen += run.seen;
    result.added += run.added;
    result.merged += run.merged;
    result.providers.push(run);
  }

  const errors = result.providers.filter((p) => p.error);
  if (errors.length === result.providers.length && errors.length > 0) {
    result.error = errors.map((e) => `${e.providerName}: ${e.error}`).join("; ");
  }

  return { result, newJobIds };
}

/**
 * Analyse new arrivals one at a time in the background.
 *
 * Serial on purpose: the analyser loads every CV and the whole profile per job,
 * and with an API key each is a model call. A refresh that returns 25 jobs
 * should not fire 25 concurrent requests.
 */
async function scoreSequentially(jobIds: string[], minMatchBySearch: Map<string, number>) {
  for (const id of jobIds) {
    await processJob(id);

    const job = await prisma.job.findUnique({
      where: { id },
      select: { savedSearchId: true, professionalMatch: true, applicationStatus: true },
    });
    if (!job?.savedSearchId || job.professionalMatch == null) continue;
    if (job.applicationStatus !== "NEW") continue;

    const floor = minMatchBySearch.get(job.savedSearchId);
    // Below the floor the job is filed away rather than deleted — deleting it
    // would only mean fetching and scoring it again on the next refresh.
    if (floor != null && job.professionalMatch < floor) {
      await prisma.job.update({
        where: { id },
        data: { applicationStatus: "DISCARDED" },
      });
    }
  }
}

export async function refreshSearches(searchId?: string): Promise<RefreshReport> {
  const searches = await prisma.savedSearch.findMany({
    where: searchId ? { id: searchId } : { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const report: RefreshReport = {
    searches: [],
    totalAdded: 0,
    totalMerged: 0,
    totalSeen: 0,
    scoring: 0,
    skippedScoring: 0,
    notes: [],
  };

  if (!searches.length) {
    report.notes.push(
      searchId
        ? "That search no longer exists."
        : "No active saved searches yet. Add one to start pulling jobs.",
    );
    return report;
  }

  const allNewJobIds: string[] = [];
  const minMatchBySearch = new Map<string, number>();

  for (const search of searches) {
    if (search.minMatch != null) minMatchBySearch.set(search.id, search.minMatch);

    let outcome: { result: SearchRunResult; newJobIds: string[] };
    try {
      outcome = await runSearch(search);
    } catch (err) {
      outcome = {
        result: {
          searchId: search.id,
          searchName: search.name,
          seen: 0,
          added: 0,
          merged: 0,
          error: err instanceof Error ? err.message : String(err),
          providers: [],
        },
        newJobIds: [],
      };
    }

    await prisma.savedSearch.update({
      where: { id: search.id },
      data: {
        lastRunAt: new Date(),
        lastAdded: outcome.result.added,
        lastSeen: outcome.result.seen,
        lastError: outcome.result.error,
      },
    });

    report.searches.push(outcome.result);
    report.totalAdded += outcome.result.added;
    report.totalMerged += outcome.result.merged;
    report.totalSeen += outcome.result.seen;
    allNewJobIds.push(...outcome.newJobIds);
  }

  const toScore = allNewJobIds.slice(0, MAX_AUTO_SCORE);
  report.scoring = toScore.length;
  report.skippedScoring = allNewJobIds.length - toScore.length;

  if (report.skippedScoring > 0) {
    report.notes.push(
      `${report.skippedScoring} new job${report.skippedScoring === 1 ? "" : "s"} left unscored this run (cap is ${MAX_AUTO_SCORE}); open one to analyse it, or refresh again.`,
    );
  }

  if (toScore.length) detach(scoreSequentially(toScore, minMatchBySearch));

  return report;
}
