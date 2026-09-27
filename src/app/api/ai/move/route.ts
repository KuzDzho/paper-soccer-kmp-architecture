import { NextRequest, NextResponse } from "next/server";
import { runAiTask } from "@/game/ai-task";
import type { AiRequest } from "@/game/ai-protocol";

export const runtime = "nodejs";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const axis = (v: unknown): v is number => int(v, 5, 29) && v % 2 === 1;
const side = (v: unknown) => v === 0 || v === 1;

/** Bound memory / search inputs. This endpoint computes a suggestion only:
 * it neither changes a match nor writes anything to the database. */
function validRequest(raw: unknown): raw is AiRequest {
  if (!isRecord(raw) || !int(raw.id, 1, Number.MAX_SAFE_INTEGER)) return false;
  if (raw.level !== "easy" && raw.level !== "medium" && raw.level !== "hard") return false;
  const s = raw.state;
  if (!isRecord(s) || !isRecord(s.cfg)) return false;
  const cfg = s.cfg;
  const cols = cfg.cols ?? cfg.size;
  const rows = cfg.rows ?? cfg.size;
  if (!axis(cfg.size) || !axis(cols) || !axis(rows) || !int(cfg.winScore, 1, 99)) return false;
  if (s.status !== "playing" || !side(s.current) || s.winner !== null) return false;
  if (s.lastScorer !== null && !side(s.lastScorer)) return false;
  if (!Array.isArray(s.scores) || s.scores.length !== 2 || !s.scores.every((n) => int(n, 0, 99))) return false;
  if (!Array.isArray(s.ball) || s.ball.length !== 2 || !int(s.ball[0], 0, cols - 1) || !int(s.ball[1], 0, rows - 1)) return false;
  if (!int(s.moveCount, 0, 1_000_000)) return false;
  if (s.turnMoves !== undefined && !int(s.turnMoves, 0, cols * rows * 4)) return false;
  if (s.bouncePending !== undefined && typeof s.bouncePending !== "boolean") return false;
  if (!Array.isArray(s.edges) || s.edges.length > cols * rows * 4) return false;
  const seen = new Set<string>();
  for (const e of s.edges) {
    if (!Array.isArray(e) || e.length !== 5) return false;
    if (!int(e[0], 0, cols - 1) || !int(e[1], 0, rows - 1) || !int(e[2], 0, cols - 1) || !int(e[3], 0, rows - 1) || !side(e[4])) return false;
    const dx = Math.abs(e[0] - e[2]);
    const dy = Math.abs(e[1] - e[3]);
    if (dx > 1 || dy > 1 || dx + dy === 0) return false;
    const a = e[1] * cols + e[0];
    const b = e[3] * cols + e[2];
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Non-blocking fallback for browsers where dedicated workers are unavailable.
 * Normal supported browsers never call it; their AI stays entirely local. */
export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? 0) > 160_000) {
    return NextResponse.json({ error: "request-too-large" }, { status: 413 });
  }
  const raw: unknown = await request.json().catch(() => null);
  if (!validRequest(raw)) {
    return NextResponse.json({ error: "invalid-ai-request" }, { status: 400 });
  }
  if (request.signal.aborted) return new NextResponse(null, { status: 499 });
  const result = runAiTask(raw);
  return NextResponse.json(result, {
    status: result.ok ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}
