import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { code } = await ctx.params;
  const rows = await db.select().from(rooms).where(eq(rooms.code, code.toUpperCase())).limit(1);
  const room = rows[0];
  if (!room) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({
    code: room.code,
    status: room.status,
    seq: room.seq,
    state: room.state,
    chains: room.chains,
    players: { home: true, away: room.tokens.away !== null },
    updatedAt: room.updatedAt,
  });
}
