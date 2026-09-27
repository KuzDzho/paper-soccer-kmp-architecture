import { Director } from "../src/game/director";
import type { BotSearch } from "../src/game/ai-client";
import type { BotLevel } from "../src/game/ai";
import type { Pt, SerializedState } from "../src/game/engine";

class ManualSearch implements BotSearch {
  jobs: { state: SerializedState; level: BotLevel; resolve: (t: Pt | null) => void; reject: (e: Error) => void }[] = [];
  warmup() {}
  choose(state: SerializedState, level: BotLevel): Promise<Pt | null> {
    return new Promise((resolve, reject) => this.jobs.push({ state, level, resolve, reject }));
  }
  cancel() {}
  dispose() {}
}

const search = new ManualSearch();
const d = new Director(search);
(d as any).mode; // demo by default
d.startDemo();
console.log("after startDemo: mode=", (d as any).mode, "attractActive=", (d as any).attractActive);

// 1) before the delay: no job scheduled
let now = performance.now();
(d as any).idleAt = now - 119_000;
d.tick(now, 0.016);
console.log("t+119s: attractActive=", (d as any).attractActive, "jobs=", search.jobs.length, "(expect false/0)");

// 2) past the delay: attract must flip on and schedule exactly one job
(d as any).idleAt = performance.now() - 121_000;
now = performance.now();
d.tick(now, 0.016);
console.log("t+121s: attractActive=", (d as any).attractActive, "jobs=", search.jobs.length, "thinking=", (d as any).thinking, "(expect true/1)");

// 3) resolve the job -> move must apply on a later frame (notBefore = +650ms)
if (search.jobs.length > 0) {
  search.jobs[0].resolve({ x: 9, y: 10 });
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
  d.tick(performance.now() + 1000, 0.016);
  console.log("after resolve+tick: moveCount=", d.match.moveCount, "ball=", JSON.stringify(d.match.ball), "(expect 1)");
} else {
  console.log("NO JOB SCHEDULED — demo never starts (bug reproduced)");
}

// 4) activity must halt a running demo and restart the clock
d.notifyActivity();
console.log("after notifyActivity: attractActive=", (d as any).attractActive, "moveCount=", d.match.moveCount, "(expect false/0)");
