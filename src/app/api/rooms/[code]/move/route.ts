import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { rooms, matches, ChainRec } from "@/db/schema";
import { applyChain, deserialize, serialize, PlayerIdx, colsOf, rowsOf } from "@/game/engine";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ code: string }> };

interface MoveBody {
  token?: string;
  baseSeq?: number;
  chain?: { x: number; y: number }[];
  /** Player manually stopped after the first or second line. */
  ended?: boolean;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as MoveBody;
  if (!body.token || typeof body.baseSeq !== "number" || !Array.isArray(body.chain)) {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (body.chain.length < 1 || body.chain.length > 64 || (body.ended !== undefined && typeof body.ended !== "boolean")) {
    return NextResponse.json({ error: "bad-chain" }, { status: 400 });
  }

  const rows = await db.select().from(rooms).where(eq(rooms.code, code.toUpperCase())).limit(1);
  const room = rows[0];
  if (!room) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (room.status !== "playing" && room.status !== "finished") {
    return NextResponse.json({ error: "not-started" }, { status: 409 });
  }

  const role: PlayerIdx | null =
    body.token === room.tokens.home ? 0 : body.token === room.tokens.away ? 1 : null;
  if (role === null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (body.baseSeq !== room.seq) {
    return NextResponse.json({ error: "stale", seq: room.seq }, { status: 409 });
  }

  const m = deserialize(room.state);
  // sanitize chain points against the actual pitch rectangle
  const pitchCols = colsOf(m.cfg);
  const pitchRows = rowsOf(m.cfg);
  const chain = body.chain.map((p) => ({ x: p.x | 0, y: p.y | 0 }));
  for (const p of chain) {
    if (p.x < 0 || p.y < 0 || p.x >= pitchCols || p.y >= pitchRows) {
      return NextResponse.json({ error: "bad-point" }, { status: 400 });
    }
  }

  try {
    applyChain(m, chain, role, body.ended === true);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const chains = [...room.chains, { by: role, e: chain, ended: body.ended === true } as ChainRec].slice(-600);
  const finished = m.status === "finished";
  const updated = await db
    .update(rooms)
    .set({
      state: serialize(m),
      chains,
      seq: room.seq + 1,
      status: finished ? "finished" : "playing",
      updatedAt: new Date(),
    })
    .where(and(eq(rooms.code, room.code), eq(rooms.seq, room.seq)))
    .returning({ seq: rooms.seq });

  if (updated.length === 0) {
    return NextResponse.json({ error: "race", seq: room.seq }, { status: 409 });
  }

  if (finished) {
    try {
      await db.insert(matches).values({
        mode: "online",
        difficulty: null,
        scoreHome: m.scores[0],
        scoreAway: m.scores[1],
        winner: m.winner,
        moves: m.moveCount,
        winScore: m.cfg.winScore,
      });
    } catch (e) {
      console.error("match record failed", e);
    }
  }

  return NextResponse.json({ ok: true, seq: room.seq + 1 });
}
