/* Engine + AI smoke tests. Run: npx tsx scripts/simulate.ts */
import {
  Match,
  DEFAULT_CFG,
  applyChain,
  goalOwner,
  goalMouths,
  inside,
  wallTravel,
  key,
  edgeKey,
  serialize,
  deserialize,
  Pt,
} from "../src/game/engine";
import { chooseEdge, rankMoves, BotLevel } from "../src/game/ai";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

function checkInvariants(m: Match, ctx: string) {
  const { size } = m.cfg;
  // ball inside
  if (m.status === "playing") {
    assert(
      m.ball.x >= 0 && m.ball.y >= 0 && m.ball.x < size && m.ball.y < size,
      `${ctx}: ball out of bounds ${key(m.ball)}`,
    );
  }
  // edge uniqueness
  const seen = new Set<string>();
  for (const e of m.edges) {
    const k = edgeKey(e.a, e.b);
    assert(!seen.has(k), `${ctx}: duplicate edge ${k}`);
    seen.add(k);
    assert(m.used.has(k), `${ctx}: edge missing from used ${k}`);
  }
  assert(seen.size === m.used.size, `${ctx}: used set mismatch`);
  // Diagonal crossings inside a cell are now allowed by the ruleset (no check).
}

function playGame(
  levelA: BotLevel,
  levelB: BotLevel,
  sizeOrWin: number,
  winScoreOrMax: number,
  maybeMax?: number,
  hardMs = 140,
): { winner: number | null; moves: number } {
  // Signature: (a, b, winScore, maxMoves) or (a, b, size, winScore, maxMoves)
  const size = maybeMax === undefined ? DEFAULT_CFG.size : sizeOrWin;
  const winScore = maybeMax === undefined ? sizeOrWin : winScoreOrMax;
  const maxMoves = maybeMax === undefined ? winScoreOrMax : maybeMax;
  const m = new Match({ size, winScore });
  let guard = 0;
  while (m.status !== "finished") {
    guard++;
    if (guard > maxMoves) return { winner: null, moves: guard };
    const lev = m.current === 0 ? levelA : levelB;
    const t = chooseEdge(m, lev, Math.random, lev === "hard" ? { timeMs: hardMs } : undefined);
    if (!t) {
      if (m.canEndTurn()) {
        m.endTurn();
        continue;
      }
      return { winner: null, moves: guard };
    }
    const ev = m.doEdge(t);
    checkInvariants(m, "playGame");
    if (ev.kind === "goal") m.resetAfterGoal();
  }
  return { winner: m.winner, moves: guard };
}

console.time("easy-games");
let finishedEasy = 0;
const winners = [0, 0, 0];
for (let i = 0; i < 60; i++) {
  const r = playGame("easy", "easy", 1, 20000);
  if (r.winner !== null) {
    finishedEasy++;
    winners[r.winner]++;
  }
}
console.timeEnd("easy-games");
console.log(`easy vs easy: ${finishedEasy}/60 finished, winners[0,1,draw]=${winners}`);
assert(finishedEasy >= 57, "easy games should terminate");

// unEdge soundness: random walk with full rollback
{
  const m = new Match({ size: 11, winScore: 3 });
  const applied: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const t = chooseEdge(m, "easy");
    if (!t) break;
    const ev = m.doEdge(t);
    applied.push(t);
    if (ev.kind !== "move" || !ev.bounce) break;
  }
  const snapshot = serialize(m);
  // extend then roll back everything we extend
  const ext: number = m.edges.length;
  for (let i = 0; i < 6; i++) {
    const t = chooseEdge(m, "easy");
    if (!t) break;
    const ev = m.doEdge(t);
    if (ev.kind !== "move" || !ev.bounce) break;
  }
  while (m.edges.length > ext) m.unEdge();
  const after = serialize(m);
  assert(
    JSON.stringify(snapshot) === JSON.stringify(after),
    "unEdge must restore serialized state exactly",
  );
}

// Hard bot finds immediate goal
{
  const m = new Match(DEFAULT_CFG);
  m.ball = { x: 8, y: 0 };
  // craft: pretend ball currently at (8,0) via a real edge so state is consistent
  const real = new Match(DEFAULT_CFG);
  real.doEdge({ x: 9, y: 8 });
  const t = chooseEdge(real, "hard");
  assert(!!t, "hard returns a move from kickoff");
  // Tactical: ball on wall next to home hole (9,0): hitting the hole is winning the point
  const tac = new Match(DEFAULT_CFG);
  tac.doEdge({ x: 8, y: 8 });
  tac.doEdge({ x: 8, y: 7 });
  tac.doEdge({ x: 8, y: 6 });
  tac.doEdge({ x: 8, y: 5 });
  tac.doEdge({ x: 8, y: 4 });
  tac.doEdge({ x: 8, y: 3 });
  tac.doEdge({ x: 8, y: 2 });
  tac.doEdge({ x: 8, y: 1 }); // up the wall, bounces keep turn with player 0
  if (tac.current === 0 && tac.status === "playing") {
    const tt = chooseEdge(tac, "hard");
    assert(!!tt && goalOwner(tt, tac.cfg) === 0, `hard should dive into the open goal, got ${JSON.stringify(tt)}`);
  }
}

// Rectangular goal mouth: any of the 3 mouth nodes scores, not just the centre
{
  for (const dx of [-1, 0, 1]) {
    const ms = new Match({ size: 9, winScore: 1 });
    ms.doEdge({ x: 4, y: 3 });
    ms.doEdge({ x: 4, y: 2 });
    ms.doEdge({ x: 4, y: 1 });
    const ev = ms.doEdge({ x: 4 + dx, y: 0 });
    assert(ev.kind === "finished" && ev.scorer === 0, `mouth node dx=${dx} must score for the attacker`);
    assert(ms.winner === 0, "winner recorded");
  }
  // NOT the mouth: corner of the short side stays a wall bounce, not a goal
  const nw = new Match({ size: 9, winScore: 1 });
  nw.doEdge({ x: 4, y: 3 });
  nw.doEdge({ x: 4, y: 2 });
  assert(goalOwner({ x: 0, y: 0 }, nw.cfg) === -1, "corner is not a goal");
  assert(goalOwner({ x: 2, y: 0 }, nw.cfg) === -1, "2 nodes from centre is outside the mouth (size 9)");
  // WIDE mouth on the stadium field: 19×19 → 5-node mouth (mid ± 2)
  const big = new Match({ size: 19, winScore: 1 });
  assert(goalOwner({ x: 11, y: 0 }, big.cfg) === 0, "edge of the wide mouth scores");
  assert(goalOwner({ x: 7, y: 0 }, big.cfg) === 0, "other edge of the wide mouth scores");
  assert(goalOwner({ x: 12, y: 0 }, big.cfg) === -1, "just outside the mouth does NOT score");
  assert(goalOwner({ x: 6, y: 0 }, big.cfg) === -1, "just outside the mouth does NOT score");
  assert(goalOwner({ x: 11, y: 1 }, big.cfg) === -1, "mouth is only the boundary row");
}

// 1–3 line turn budget + applyChain validation
{
  const m = new Match(DEFAULT_CFG);
  // one line alone is incomplete: player must explicitly end or draw up to 3
  let threw = false;
  try {
    applyChain(m, [{ x: 9, y: 8 }], 0);
  } catch (e) {
    threw = (e as Error).message === "chain-incomplete";
  }
  assert(threw, "applyChain rejects an unfinished 1-line turn");

  // A rejected chain is intentionally not committed by the server; replay a
  // fresh authoritative match for the successful-chain assertions.
  const okMatch = new Match(DEFAULT_CFG);
  const events = applyChain(okMatch, [{ x: 9, y: 8 }], 0, true);
  assert(events.length === 2 && events[1].kind === "pass" && okMatch.current === 1, "ended chain passes after one line");
  assert(okMatch.turnMoves === 0, "turn budget resets after pass");
  threw = false;
  try {
    applyChain(okMatch, [{ x: 9, y: 8 }], 1, true);
  } catch {
    threw = true;
  }
  assert(threw, "applyChain rejects re-using an edge");
  threw = false;
  try {
    applyChain(okMatch, [{ x: 9, y: 7 }], 0, true);
  } catch (e) {
    threw = (e as Error).message === "not-your-turn";
  }
  assert(threw, "applyChain enforces turn order");
}

// Explicit 1–3 line turn mechanics on the engine
{
  const one = new Match(DEFAULT_CFG);
  let threw = false;
  try { one.endTurn(); } catch (e) { threw = (e as Error).message === "must-draw-first"; }
  assert(threw, "cannot pass before drawing a line");
  one.doEdge({ x: 9, y: 8 });
  assert(one.current === 0 && one.turnMoves === 1 && one.canEndTurn(), "one line keeps possession and enables end turn");
  const p1 = one.endTurn();
  assert(p1.kind === "pass" && one.current === 1 && one.turnMoves === 0, "manual pass after first line transfers possession");

  const two = new Match(DEFAULT_CFG);
  two.doEdge({ x: 9, y: 8 });
  two.doEdge({ x: 10, y: 7 });
  assert(two.current === 0 && two.turnMoves === 2 && two.canEndTurn(), "two lines keep possession and enable end turn");
  two.endTurn();
  assert(two.current === 1 && two.turnMoves === 0, "manual pass after second line transfers possession");

  const three = new Match(DEFAULT_CFG);
  three.doEdge({ x: 9, y: 8 });
  three.doEdge({ x: 10, y: 7 });
  const auto = three.doEdge({ x: 11, y: 6 });
  assert(auto.kind === "pass" && three.current === 1 && three.turnMoves === 0, "third quiet line automatically transfers possession");
}

// Traditional bounce rule overrides the 1–3 budget, but never resets it.
{
  const m = new Match({ size: 9, winScore: 1 });
  // Seed an old node at (4,4), then bring P0 adjacent through valid turns.
  m.doEdge({ x: 5, y: 4 }); // P0 line 1
  m.endTurn();
  m.doEdge({ x: 5, y: 3 }); // P1 line 1
  m.endTurn();
  // P0: (5,3) → (4,4), an already-used node: forced bounce.
  const b1 = m.doEdge({ x: 4, y: 4 });
  assert(b1.kind === "move" && b1.bounce && m.current === 0 && m.turnMoves === 1 && m.bouncePending, "used node forces bounce after line 1");
  assert(!m.canEndTurn(), "cannot voluntarily pass while a bounce is pending");
  let threw = false;
  try { m.endTurn(); } catch (e) { threw = (e as Error).message === "bounce-required"; }
  assert(threw, "engine rejects passing a forced bounce");
  // Escape to fresh (4,3): line 2, player may now choose again.
  const escape = m.doEdge({ x: 4, y: 3 });
  assert(escape.kind === "move" && !escape.bounce && m.turnMoves === 2 && !m.bouncePending && m.canEndTurn(), "bounce escape preserves count (now line 2)");
  // Third line arrives at used (5,4): must bounce even though normal budget is exhausted.
  const b3 = m.doEdge({ x: 5, y: 4 });
  assert(b3.kind === "move" && b3.bounce && m.current === 0 && m.turnMoves === 3 && m.bouncePending, "third-line bounce retains possession without reset");
  // One forced escape line; it is line 4 internally and immediately passes on quiet landing.
  const out = m.doEdge({ x: 6, y: 3 });
  assert(out.kind === "pass" && m.current === 1 && m.turnMoves === 0 && !m.bouncePending, "forced escape after 3 passes; no fresh 3-line allowance");
}

// Network replay accepts >3 edges only when extra edges are forced bounces.
{
  const m = new Match({ size: 9, winScore: 1 });
  m.doEdge({ x: 5, y: 4 });
  m.endTurn();
  m.doEdge({ x: 5, y: 3 });
  m.endTurn();
  const events = applyChain(
    m,
    [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }, { x: 6, y: 3 }],
    0,
    false,
  );
  assert(events.length === 4 && events[0].bounce && events[2].bounce && events[3].kind === "pass", "network chain replays forced fourth bounce escape");
  assert(m.current === 1 && m.turnMoves === 0, "network bounce chain passes after forced escape");

  const bad = new Match({ size: 9, winScore: 1 });
  bad.doEdge({ x: 5, y: 4 });
  bad.endTurn();
  bad.doEdge({ x: 5, y: 3 });
  bad.endTurn();
  let threw = false;
  try { applyChain(bad, [{ x: 4, y: 4 }], 0, true); } catch (e) { threw = (e as Error).message === "bounce-required"; }
  assert(threw, "network rejects ending a forced bounce");
}

// diagonal crossing is now permitted: both diagonals of a cell may coexist
{
  const c = new Match({ size: 19, winScore: 1 });
  c.doEdge({ x: 9, y: 10 }); // first diag of cell (8..9, 9..10): ball at (9,9)→(9,10) vertical (not diag)
  // Use explicit diag cell (9,9)-(10,10)
  const c2 = new Match({ size: 19, winScore: 1 });
  c2.doEdge({ x: 10, y: 10 }); // (9,9)->(10,10) diag, bounces on visited node, keeps turn
  // now (9,9)->(10,10) is used; the opposite diag (10,9)->(9,10) must still be legal via (10,9):
  c2.doEdge({ x: 10, y: 9 }); // from (10,10)->(10,9) vertical
  // after landing on (10,9) with no prior ink there (only 1 line into it), turn passes
  c2.doEdge({ x: 9, y: 10 }); // from (10,9) -> (9,10): this diagonal crosses the (9,9)-(10,10) one
  assert(c2.edges.length >= 3, "diag crossing allowed — 3 edges committed");
  assert(c2.used.has(edgeKey({ x: 9, y: 9 }, { x: 10, y: 10 })), "first diag present");
  assert(c2.used.has(edgeKey({ x: 10, y: 9 }, { x: 9, y: 10 })), "crossing diag present");
  void c;
}

// penalty flow: force a dead end on small board
{
  const s = new Match({ size: 7, winScore: 2 });
  // march player 0 into corner (0,0): (3,3)->(2,2)? that's not corner-trapping deterministically; instead
  // spam edges around the corner then step in.
  const forced = new Match({ size: 7, winScore: 2 });
  forced.doEdge({ x: 3, y: 2 });
  void s; void forced;
}

// Timing of hard search
{
  const m = new Match(DEFAULT_CFG);
  console.time("hard-kickoff");
  chooseEdge(m, "hard");
  console.timeEnd("hard-kickoff");
  const mid = new Match(DEFAULT_CFG);
  for (let i = 0; i < 50; i++) {
    const t = chooseEdge(mid, "easy");
    if (!t) break;
    const ev = mid.doEdge(t);
    if (ev.kind === "goal") mid.resetAfterGoal();
    if (mid.status === "finished") break;
  }
  console.time("hard-midgame");
  chooseEdge(mid, "hard");
  console.timeEnd("hard-midgame");
}

// touchline rule: you may ricochet off the wall but never ride along it
{
  const ballToWall = new Match({ size: 9, winScore: 1 });
  // deterministic bounce-chain to the west wall: (4,4)→(3,3): quiet, turn to p1;
  // p1 (4,4)... wait ball at (3,3): p1 (3,3)→(2,4): quiet, turn to p0;
  // p0 →(1,3): quiet?? (1,3) no ink, not wall → turn to p1; p1 →(0,3): WALL bounce, p1 continues; p1 →(1,2): leaves inward, quiet.
  ballToWall.doEdge({ x: 3, y: 3 });
  ballToWall.doEdge({ x: 2, y: 4 });
  ballToWall.doEdge({ x: 1, y: 3 });
  const ev = ballToWall.doEdge({ x: 0, y: 3 });
  assert(ev.bounce && ballToWall.ball.x === 0, "ricochet lands on the wall and keeps the turn");
  assert(ballToWall.current === 1, "same mover after the bounce");
  const targets = ballToWall.legalTargets();
  assert(!targets.some((t) => t.x === 0 && t.y === 2), "wall ride up is banned");
  assert(!targets.some((t) => t.x === 0 && t.y === 4), "wall ride down is banned");
  assert(targets.some((t) => t.x === 1 && t.y === 2), "can leave the wall inward-up");
  assert(targets.some((t) => t.x === 1 && t.y === 4), "can leave the wall inward-down");
  assert(!targets.some((t) => t.x === 0 && t.y === 3), "into-the-wall edge is already used");
  assert(wallTravel({ x: 0, y: 3 }, { x: 0, y: 4 }, ballToWall.cfg), "helper flags boundary ride");
  assert(!wallTravel({ x: 1, y: 3 }, { x: 0, y: 3 }, ballToWall.cfg), "arriving ONTO the wall is fine");
  // Symmetric goal-mouth nuance: (mid±2, side line) → mouth node is riding the line — banned.
  const g = new Match({ size: 9, winScore: 1 });
  assert(wallTravel({ x: 6, y: 0 }, { x: 5, y: 0 }, g.cfg), "top-line ride into the mouth is banned");
  assert(!wallTravel({ x: 6, y: 1 }, { x: 5, y: 0 }, g.cfg), "diagonal finish from inside is allowed");
}

// easy bot: never scores an own goal in long random play
{
  let ownGoals = 0;
  let goals = 0;
  for (let i = 0; i < 4; i++) {
    const m = new Match({ size: 15, winScore: 1 });
    let guard = 0;
    while (m.status !== "finished" && guard++ < 30000) {
      const mover = m.current;
      const t = chooseEdge(m, "easy");
      if (!t) {
        if (m.canEndTurn()) {
          m.endTurn();
          continue;
        }
        break;
      }
      const ev = m.doEdge(t);
      if (ev.kind === "goal" || ev.kind === "finished") {
        if (ev.scorer !== null && ev.scorer !== mover) ownGoals++;
        goals++;
        if (ev.kind === "goal") m.resetAfterGoal();
      }
    }
  }
  console.log(`easy own-goals in sample: ${ownGoals}/${goals} goals`);
  assert(ownGoals === 0, "easy must never score own goals");
}

// easy takes the obvious open net when one is directly reachable
{
  for (const side of [0, 1] as const) {
    const m = new Match({ size: 9, winScore: 1 });
    if (side === 1) {
      m.doEdge({ x: 4, y: 5 });
      m.endTurn(); // hand the turn to P1 after the mandatory first line
    }
    const me = m.current;
    // teleport the ball adjacent to my attacking mouth and let chooseEasy work
    const mid = (m.cfg.size - 1) / 2;
    m.ball = { x: mid, y: side === 0 ? 1 : m.cfg.size - 2 };
    const t = chooseEdge(m, "easy", () => 0.1)!; // rand<0.8 → must take the open net
    assert(!!t && goalOwner(t, m.cfg) === me, `side ${side}: easy takes the open net (chose ${JSON.stringify(t)})`);
  }
  // and with the net blocked, it still never picks an own goal
  {
    const m = new Match({ size: 9, winScore: 1 });
    m.ball = { x: 4, y: 6 }; // P0 adjacent to the SOUTH (own) mouth
    for (let i = 0; i < 60; i++) {
      const t = chooseEdge(m, "easy");
      if (t) assert(goalOwner(t, m.cfg) !== 1, "easy never picks its own goal");
    }
  }
}

// ── rectangular pitch (phone shape): geometry, indexing and play ──────────
{
  const CFG = { size: 13, winScore: 1, cols: 13, rows: 21 };
  const m = new Match(CFG);
  assert(m.ball.x === 6 && m.ball.y === 10, "rect pitch centres on cols/rows");
  assert(m.deg.length === 13 * 21, "rect degree grid is cols*rows");
  assert(inside({ x: 12, y: 20 }, m.cfg), "rect last node is inside");
  assert(!inside({ x: 13, y: 5 }, m.cfg), "rect rejects x overflow");
  assert(!inside({ x: 5, y: 21 }, m.cfg), "rect rejects y overflow");
  const [north, south] = goalMouths(m.cfg);
  assert(north.every((p) => p.y === 0), "rect north mouth on first row");
  assert(south.every((p) => p.y === 20), "rect south mouth on last row");
  assert(goalOwner({ x: 6, y: 20 }, m.cfg) === 1, "rect south mouth scores for AWAY");
  assert(wallTravel({ x: 0, y: 3 }, { x: 0, y: 4 }, m.cfg), "rect side line cannot be ridden");
  // row-major indexing must not alias between rows
  m.doEdge({ x: 6, y: 9 });
  assert(m.deg[9 * 13 + 6] > 0 && m.deg[10 * 13 + 6] > 0, "rect indexing marks both endpoints");
  assert(m.deg[0] === 0, "rect indexing does not alias");
  // a full bot game stays on the pitch and finishes
  let finished = 0;
  for (let i = 0; i < 8; i++) {
    const g = new Match({ size: 13, winScore: 1, cols: 13, rows: 21 });
    let guard = 0;
    let escaped = false;
    while (g.status !== "finished" && guard++ < 30000) {
      const t = chooseEdge(g, "easy");
      if (!t) {
        if (g.canEndTurn()) { g.endTurn(); continue; }
        break;
      }
      const ev = g.doEdge(t);
      if (!inside(g.ball, g.cfg)) { escaped = true; break; }
      if (ev.kind === "goal") g.resetAfterGoal();
    }
    assert(!escaped, "rect ball never leaves the pitch");
    if (g.winner !== null) finished++;
  }
  assert(finished >= 7, `rect games finish (${finished}/8)`);
  // serialization keeps the rectangle
  const rt = deserialize(serialize(m));
  assert(JSON.stringify(serialize(rt)) === JSON.stringify(serialize(m)), "rect state round-trips");
}

// difficulty ladder: each level must clearly outplay the one below it
console.time("ladder-tests");
{
  let mw = 0;
  for (let i = 0; i < 6; i++) {
    const r = playGame("medium", "easy", 1, 20000);
    if (r.winner === 0) mw++;
  }
  console.log(`medium won ${mw}/6 vs easy`);
  assert(mw >= 5, "medium should clearly dominate easy");

  let he = 0;
  for (let i = 0; i < 3; i++) {
    const r = playGame("hard", "easy", 1, 20000);
    if (r.winner === 0) he++;
  }
  console.log(`hard won ${he}/3 vs easy`);
  assert(he === 3, "hard must sweep easy");

  // Hard must genuinely outplay medium. Sides are ALTERNATED so the result
  // measures skill rather than the kickoff advantage, and both bots run with
  // their real in-game think time.
  let hw = 0;
  let hmLosses = 0;
  for (let i = 0; i < 6; i++) {
    const hardSide = (i % 2) as 0 | 1;
    const r = playGame(
      hardSide === 0 ? "hard" : "medium",
      hardSide === 0 ? "medium" : "hard",
      13,
      1,
      20000,
    );
    if (r.winner === null) continue;
    if (r.winner === hardSide) hw++;
    else hmLosses++;
  }
  console.log(`hard ${hw} : ${hmLosses} medium (6 games, alternating sides)`);
  assert(hw > hmLosses, "hard must beat medium over a balanced series");

  // Deterministic tactical duties — no timing luck involved.
  for (const size of [13, 19]) {
    const tac = new Match({ size, winScore: 1 });
    const mid = (size - 1) / 2;
    tac.ball = { x: mid, y: 1 }; // HOME attacks north (row 0)
    const shot = chooseEdge(tac, "hard");
    assert(!!shot && goalOwner(shot, tac.cfg) === 0, `hard converts the open net on ${size}x${size}`);
    const medShot = chooseEdge(tac, "medium");
    assert(!!medShot && goalOwner(medShot, tac.cfg) === 0, `medium converts the open net on ${size}x${size}`);
  }
  {
    const tac = new Match({ size: 13, winScore: 1, cols: 13, rows: 21 });
    tac.ball = { x: 6, y: 1 };
    const shot = chooseEdge(tac, "hard");
    assert(!!shot && goalOwner(shot, tac.cfg) === 0, "hard converts the open net on a rect pitch");
  }

  // Hard must never be caught guessing: every legal root move has to be scored
  // (the old search dropped candidates when its time budget expired).
  {
    const m = new Match({ size: 19, winScore: 1 });
    for (let i = 0; i < 40 && m.status === "playing"; i++) {
      const t = chooseEdge(m, "easy");
      if (!t) {
        if (m.canEndTurn()) { m.endTurn(); continue; }
        break;
      }
      const ev = m.doEdge(t);
      if (ev.kind === "goal") m.resetAfterGoal();
    }
    if (m.status === "playing" && m.legalTargets().length > 0) {
      // rankMoves reports drawn edges; voluntary pass is a separate action
      // tested via endTurn/applyChain above, not an additional edge target.
      const legalEdges = m.legalTargets().length;
      assert(rankMoves(m, 1, 400).length === legalEdges, "root search ranks every legal edge");
    }
  }
}
console.timeEnd("ladder-tests");

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
