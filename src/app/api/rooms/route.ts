import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { Match, MatchConfig, serialize } from "@/game/engine";

export const runtime = "nodejs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

const okAxis = (n: number) => Number.isInteger(n) && n >= 9 && n <= 29 && n % 2 === 1;

function validCfg(raw: unknown): MatchConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Partial<MatchConfig>;
  const size = Number(c.size);
  const winScore = Number(c.winScore);
  // Rectangular pitches (phones) send cols/rows; legacy clients only send size.
  const cols = c.cols === undefined ? size : Number(c.cols);
  const rows = c.rows === undefined ? size : Number(c.rows);
  if (!okAxis(size) || !okAxis(cols) || !okAxis(rows)) return null;
  if (!Number.isInteger(winScore) || winScore < 1 || winScore > 7) return null;
  return { size: cols, winScore, cols, rows };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { cfg?: unknown };
    const cfg = validCfg(body.cfg) ?? { size: 19, winScore: 3 };
    const m = new Match(cfg);
    // Coin toss, like real football: the opening kickoff is random.
    m.current = Math.random() < 0.5 ? 0 : 1;
    const token = randomUUID();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeCode();
      try {
        await db.insert(rooms).values({
          code,
          status: "waiting",
          cfg,
          tokens: { home: token, away: null },
          state: serialize(m),
          chains: [],
          seq: 0,
        });
        return NextResponse.json({
          code,
          role: 0,
          token,
          seq: 0,
          state: serialize(m),
          status: "waiting",
        });
      } catch (e) {
        // primary-key collision → retry with a new code
        if (attempt === 5) throw e;
      }
    }
    return NextResponse.json({ error: "code-collision" }, { status: 500 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed-to-create" }, { status: 500 });
  }
}
