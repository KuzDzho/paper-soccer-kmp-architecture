import { NextRequest, NextResponse } from "next/server";
import { desc, sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const recent = await db.select().from(matches).orderBy(desc(matches.createdAt)).limit(14);
  const byMode = await db
    .select({ mode: matches.mode, n: sql<number>`count(*)::int` })
    .from(matches)
    .groupBy(matches.mode);
  const bot = await db
    .select({
      difficulty: matches.difficulty,
      wins: sql<number>`count(*) filter (where ${matches.winner} = 0)::int`,
      losses: sql<number>`count(*) filter (where ${matches.winner} = 1)::int`,
    })
    .from(matches)
    .where(eq(matches.mode, "bot"))
    .groupBy(matches.difficulty);
  return NextResponse.json({ recent, byMode, bot });
}

const MODES = new Set(["bot", "local", "online"]);
const LEVELS = new Set(["easy", "medium", "hard"]);

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const mode = String(b.mode);
    if (!MODES.has(mode)) return NextResponse.json({ error: "bad-mode" }, { status: 400 });
    const difficulty = b.difficulty == null ? null : String(b.difficulty);
    if (difficulty !== null && !LEVELS.has(difficulty)) {
      return NextResponse.json({ error: "bad-difficulty" }, { status: 400 });
    }
    const scoreHome = Number(b.scoreHome);
    const scoreAway = Number(b.scoreAway);
    const winner = b.winner === null || b.winner === undefined ? null : Number(b.winner);
    const moves = Math.max(0, Math.min(5000, Number(b.moves) || 0));
    const winScore = Math.max(1, Math.min(7, Number(b.winScore) || 3));
    if (
      !Number.isInteger(scoreHome) ||
      !Number.isInteger(scoreAway) ||
      scoreHome < 0 ||
      scoreAway < 0 ||
      scoreHome > 9 ||
      scoreAway > 9 ||
      (winner !== null && winner !== 0 && winner !== 1)
    ) {
      return NextResponse.json({ error: "bad-score" }, { status: 400 });
    }
    await db.insert(matches).values({ mode, difficulty, scoreHome, scoreAway, winner, moves, winScore });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
