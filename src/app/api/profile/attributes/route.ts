import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  category: string;
  key: string;
  /** resolve | confirm | reject | clear */
  action: string;
  /** The correct value, when resolving a conflict. */
  value?: string;
  note?: string;
};

/**
 * Record a user decision about a master-profile attribute.
 *
 * Decisions are keyed by (category, key) rather than row id so they survive a
 * profile rebuild, which recreates every row.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const { category, key, action } = body;

  if (!category || !key) {
    return NextResponse.json({ error: "category and key are required." }, { status: 400 });
  }

  const attribute = await prisma.attribute.findUnique({
    where: { category_key: { category, key } },
  });
  if (!attribute) {
    return NextResponse.json({ error: "Attribute not found." }, { status: 404 });
  }

  switch (action) {
    case "resolve": {
      const value = body.value?.trim();
      if (!value) {
        return NextResponse.json(
          { error: "A value is required to resolve a conflict." },
          { status: 400 },
        );
      }
      const updated = await prisma.attribute.update({
        where: { id: attribute.id },
        data: {
          resolvedValue: value,
          resolvedAt: new Date(),
          userStatus: "CONFIRMED",
          userNote: body.note?.trim() || null,
          confidence: "CONFIRMED",
        },
      });
      return NextResponse.json({ attribute: updated });
    }

    case "confirm": {
      const updated = await prisma.attribute.update({
        where: { id: attribute.id },
        data: {
          userStatus: "CONFIRMED",
          resolvedAt: new Date(),
          userNote: body.note?.trim() || null,
          confidence: "CONFIRMED",
        },
      });
      return NextResponse.json({ attribute: updated });
    }

    case "reject": {
      // Kept, not deleted — a rebuild would only bring it straight back, and
      // the rejection is itself information worth keeping.
      const updated = await prisma.attribute.update({
        where: { id: attribute.id },
        data: {
          userStatus: "REJECTED",
          resolvedAt: new Date(),
          userNote: body.note?.trim() || null,
        },
      });
      return NextResponse.json({ attribute: updated });
    }

    case "clear": {
      const updated = await prisma.attribute.update({
        where: { id: attribute.id },
        data: {
          userStatus: null,
          resolvedValue: null,
          resolvedAt: null,
          userNote: null,
          // Fall back to the computed signal: a recorded conflict stays a
          // conflict once the override is removed.
          confidence: attribute.variants ? "CONFLICTING" : attribute.confidence,
        },
      });
      return NextResponse.json({ attribute: updated });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action "${action}".` },
        { status: 400 },
      );
  }
}
