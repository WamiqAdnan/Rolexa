"use client";

import { useState } from "react";

import { JobList } from "@/components/job-list";
import { SavedSearches } from "@/components/saved-searches";

/**
 * Holds the two halves of the Jobs page together: a refresh finishing in the
 * search panel has to push the list to reload, since new rows arrive from the
 * server rather than from anything the list itself did.
 */
export function JobsScreen() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-8">
      <SavedSearches onRefreshed={() => setReloadKey((k) => k + 1)} />
      <JobList reloadKey={reloadKey} />
    </div>
  );
}
