import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { rooms } from "@/db/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const rows = await db.select().from(rooms).where(eq(rooms.code, code.toUpperCase())).limit(1);
  const room = rows[0];
  if (!room) return NextResponse.json({ error: "not-found" }, { status: 404 });

  // reconnect with an existing token
  if (body.token && (body.token === room.tokens.home || body.token === room.tokens.away)) {
    const role = body.token === room.tokens.home ? 0 : 1;
    return NextResponse.json({
      code: room.code,
      role,
      token: body.token,
      seq: room.seq,
      state: room.state,
      status: room.status,
    });
  }

  if (room.tokens.away !== null || room.status !== "waiting") {
    return NextResponse.json({ error: "room-full" }, { status: 409 });
  }

  const token = randomUUID();
  const updated = await db
    .update(rooms)
    .set({
      tokens: { ...room.tokens, away: token },
      status: "playing",
      seq: room.seq + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(rooms.code, room.code), eq(rooms.seq, room.seq)))
    .returning({ seq: rooms.seq });
  if (updated.length === 0) {
    return NextResponse.json({ error: "race" }, { status: 409 });
  }
  return NextResponse.json({
    code: room.code,
    role: 1,
    token,
    seq: room.seq + 1,
    state: room.state,
    status: "playing",
  });
}
