"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProfileAttribute } from "@/lib/types";

async function send(body: Record<string, unknown>) {
  const res = await fetch("/api/profile/attributes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Could not save that.");
  }
}

/** Pick the correct value for a conflicting attribute. */
export function ConflictResolver({ attribute }: { attribute: ProfileAttribute }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options = (attribute.variants ?? []).map((v) => {
    const [value, ...rest] = v.split(" — ");
    return { value: value.trim(), source: rest.join(" — ") };
  });

  async function resolve(value: string) {
    setBusy(true);
    setError(null);
    try {
      await send({ category: attribute.category, key: attribute.key, action: "resolve", value });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  if (attribute.resolvedValue) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="muted">You confirmed:</span>
        <strong>{attribute.resolvedValue}</strong>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await send({ category: attribute.category, key: attribute.key, action: "clear" });
            router.refresh();
            setBusy(false);
          }}
          className="muted text-xs hover:underline"
        >
          undo
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-900 dark:text-red-200">
        ⚠️ Conflicting information detected — which is correct?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value + opt.source}
            disabled={busy}
            onClick={() => void resolve(opt.value)}
            className="hairline rounded-md border bg-[var(--surface-raised)] px-3 py-1.5 text-left text-sm hover:border-brand-500 disabled:opacity-50"
          >
            <span className="font-medium">{opt.value}</span>
            {opt.source ? <span className="muted block text-xs">from {opt.source}</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…or type the correct value"
          className="hairline min-w-48 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm"
        />
        <button
          disabled={busy || !custom.trim()}
          onClick={() => void resolve(custom.trim())}
          className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          Save
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

/** Confirm or reject a single-source ("needs review") attribute. */
export function ReviewActions({ attribute }: { attribute: ProfileAttribute }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: "confirm" | "reject" | "clear") {
    setBusy(true);
    await send({ category: attribute.category, key: attribute.key, action });
    router.refresh();
    setBusy(false);
  }

  if (attribute.userStatus === "REJECTED") {
    return (
      <span className="muted text-xs">
        Marked as not applicable ·{" "}
        <button onClick={() => void act("clear")} disabled={busy} className="hover:underline">
          undo
        </button>
      </span>
    );
  }

  return (
    <span className="flex gap-2 text-xs">
      <button
        onClick={() => void act("confirm")}
        disabled={busy}
        className="text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-400"
      >
        This is correct
      </button>
      <span className="muted">·</span>
      <button
        onClick={() => void act("reject")}
        disabled={busy}
        className="muted hover:underline disabled:opacity-50"
      >
        Not applicable
      </button>
    </span>
  );
}

export function RebuildButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/profile/rebuild", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
      className="hairline rounded-md border px-2.5 py-1 text-sm hover:bg-ink-100 disabled:opacity-50 dark:hover:bg-ink-800"
    >
      {busy ? "Rebuilding…" : "Rebuild profile"}
    </button>
  );
}
