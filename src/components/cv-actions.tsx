"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReprocessButton({ cvId }: { cvId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/cvs/${cvId}/reprocess`, { method: "POST" });
        // Extraction runs in the background; give it a moment before refreshing.
        setTimeout(() => {
          router.refresh();
          setBusy(false);
        }, 1500);
      }}
      className="hairline rounded-md border px-2.5 py-1 text-sm hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
    >
      {busy ? "Re-extracting…" : "Re-extract"}
    </button>
  );
}

export function DeleteVersionButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Delete this generated version?")) return;
        setBusy(true);
        await fetch(`/api/versions/${versionId}`, { method: "DELETE" });
        router.refresh();
        setBusy(false);
      }}
      className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
    >
      Delete version
    </button>
  );
}
