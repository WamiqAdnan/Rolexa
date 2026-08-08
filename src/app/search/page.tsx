import Link from "next/link";

import { SearchBuilder } from "@/components/search-builder";
import { Empty } from "@/components/ui";
import { loadMasterProfile } from "@/lib/master-profile";
import { buildSearchProfile } from "@/lib/search-profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job Search Terms · Rolexa" };

export default async function SearchPage() {
  const profile = await loadMasterProfile();
  const search = buildSearchProfile(profile);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Job Search Terms</h1>
        <p className="muted mt-1 max-w-3xl text-sm">
          Search inputs derived from your Master Profile — the titles, keywords and locations
          your CVs actually support. Toggle what you want and copy the query into a job board.
        </p>
      </header>

      {search.notes.map((note) => (
        <p
          key={note}
          className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {note}
        </p>
      ))}

      {!profile.cvCount ? (
        <Empty>
          Nothing to derive terms from yet.{" "}
          <Link href="/cvs" className="text-brand-700 hover:underline dark:text-brand-400">
            Upload a CV
          </Link>{" "}
          first.
        </Empty>
      ) : (
        <SearchBuilder profile={search} />
      )}
    </div>
  );
}
