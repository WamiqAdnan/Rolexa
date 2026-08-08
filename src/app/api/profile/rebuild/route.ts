import { NextResponse } from "next/server";

import { rebuildMasterProfile } from "@/lib/master-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await rebuildMasterProfile();
  return NextResponse.json(result);
}
