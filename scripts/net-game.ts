import { Match, deserialize, serialize, applyChain } from "../src/game/engine";
import { chooseEdge } from "../src/game/ai";

const BASE = "http://localhost:3000";
const j = (r: Response) => r.json();

async function main() {
  const room = await fetch(`${BASE}/api/rooms`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cfg: { size: 9, winScore: 1 } }),
  }).then(j);
  const code = room.code as string;
  const homeTok = room.token as string;
  const join = await fetch(`${BASE}/api/rooms/${code}/join`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }).then(j);
  const awayTok = join.token as string;
  let seq = join.seq as number;

  // Server-authoritative start: hydrate from the room state (includes the coin toss!)
  const local = deserialize(join.state);
  let guard = 0;
  while (local.status !== "finished" && guard++ < 200) {
    const role = local.current;
    const token = role === 0 ? homeTok : awayTok;
    // Build one complete 1–3-line turn locally. Easy may voluntarily pass
    // rather than walk into its own goal; forced bounces are kept in the chain.
    const chain: { x: number; y: number }[] = [];
    let ended = false;
    while (local.current === role && local.status === "playing") {
      const t = chooseEdge(local, "easy", Math.random);
      if (!t) {
        if (local.canEndTurn()) {
          local.endTurn();
          ended = true;
          break;
        }
        throw new Error("bot-stalled-without-pass");
      }
      local.doEdge(t);
      chain.push(t);
      if (local.status !== "playing") break;
    }
    const res = await fetch(`${BASE}/api/rooms/${code}/move`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, baseSeq: seq, chain, ended }),
    });
    if (!res.ok) {
      console.error("move rejected:", await res.text(), "chain:", JSON.stringify(chain), "state:", serialize(local));
      process.exit(1);
    }
    seq++;
  }
  const roomSnap = await fetch(`${BASE}/api/rooms/${code}`).then(j);
  // server state may linger at 'goal' — force the lazy reset locally for comparison
  const server = deserialize(roomSnap.state);
  if (server.status === "goal" && local.status === "playing") server.resetAfterGoal();
  const same =
    JSON.stringify(serialize(server)) === JSON.stringify(serialize(local)) ||
    (server.status === "finished" && local.status === "finished" && server.winner === local.winner && server.moveCount === local.moveCount);
  console.log("client finished:", local.status, "winner:", local.winner, "moves:", local.moveCount);
  console.log("server status:", roomSnap.status, "seq:", roomSnap.seq, "match+server in sync:", same);
  const matches = await fetch(`${BASE}/api/matches`).then(j);
  console.log("matches rows:", matches.recent.length, JSON.stringify(matches.recent[0] ?? null));
  if (!same) { console.error("STATE MISMATCH"); process.exit(1); }
  if (matches.recent.length === 0) { console.error("NO MATCH RECORDED"); process.exit(1); }
  console.log("NET GAME OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
