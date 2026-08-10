import { NextResponse } from "next/server";

import { refreshSearches } from "@/lib/job-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Network fan-out across every provider — well past the default budget. */
export const maxDuration = 120;

/**
 * Runs the fetch inline rather than detaching it, so the button can report what
 * actually happened. Scoring the new arrivals is what runs in the background.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { searchId?: string };
  const report = await refreshSearches(body.searchId);
  return NextResponse.json({ report });
}
