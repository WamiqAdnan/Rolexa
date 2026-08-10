import { NextResponse } from "next/server";

import { providerStatuses } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which boards are wired up, and what's missing for the ones that aren't. */
export async function GET() {
  return NextResponse.json({ sources: providerStatuses() });
}
