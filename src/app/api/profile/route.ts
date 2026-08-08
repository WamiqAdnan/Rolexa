import { NextResponse } from "next/server";

import { loadMasterProfile, profileRebuiltAt } from "@/lib/master-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [profile, rebuiltAt] = await Promise.all([loadMasterProfile(), profileRebuiltAt()]);
  return NextResponse.json({ profile, rebuiltAt });
}
