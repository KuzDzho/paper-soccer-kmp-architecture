import { test, expect, type Page } from "@playwright/test";
import type { AiRequest, AiResponse } from "../src/game/ai-protocol";

interface SearchSpan {
  id: number;
  started: number;
  ended?: number;
  computeMs?: number;
  cancelled?: boolean;
  position: string;
}
interface Probe {
  searches: SearchSpan[];
  frames: number[];
  longTasks: { start: number; duration: number }[];
  pending: number;
  maximumPending: number;
}
declare global {
  interface Window { __aiProbe: Probe }
}

const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
test.setTimeout(45_000);

async function instrument(page: Page, noWorker = false) {
  await page.addInitScript(({ noWorker }) => {
    // Deterministic coin toss: the red/CPU side kicks off, so no manual moves
    // are needed to measure a full Hard search through the real UI.
    Math.random = () => 0.75;
    const probe: Probe = {
      searches: [], frames: [], longTasks: [], pending: 0, maximumPending: 0,
    };
    window.__aiProbe = probe;
    const frame = (t: number) => { probe.frames.push(t); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((entries) => {
        for (const e of entries.getEntries()) probe.longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: "longtask" });
    }
    if (noWorker) {
      Object.defineProperty(window, "Worker", { value: undefined, configurable: true });
      return;
    }
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private spans = new Map<number, SearchSpan>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent<AiResponse>) => {
          const span = this.spans.get(event.data.id);
          if (!span || span.ended !== undefined) return;
          span.ended = performance.now();
          if (event.data.ok) span.computeMs = event.data.elapsedMs;
          probe.pending--;
        });
      }
      override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const job = message as AiRequest;
        if (job.state && typeof job.id === "number") {
          const span: SearchSpan = { id: job.id, started: performance.now(), position: JSON.stringify(job.state) };
          this.spans.set(job.id, span);
          probe.searches.push(span);
          probe.pending++;
          probe.maximumPending = Math.max(probe.maximumPending, probe.pending);
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      override terminate() {
        for (const span of this.spans.values()) {
          if (span.ended !== undefined) continue;
          span.ended = performance.now();
          span.cancelled = true;
          probe.pending--;
        }
        super.terminate();
      }
    };
  }, { noWorker });
}

async function startHard(page: Page) {
  await page.goto(base);
  await page.getByRole("button", { name: "Тяжёлый", exact: true }).click();
  await page.getByRole("button", { name: "Кик-офф", exact: true }).click();
}

for (const profile of [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
]) {
  test(`Hard runs off-thread and frames keep rendering (${profile.name})`, async ({ browser }) => {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    const errors: string[] = [];
    let serverFallbacks = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (r) => { if (r.url().includes("/api/ai/move")) serverFallbacks++; });
    await instrument(page);
    await startHard(page);
    await page.waitForFunction(() => window.__aiProbe.searches.filter((s) => s.computeMs !== undefined).length >= 3);
    const result = await page.evaluate(() => {
      const p = window.__aiProbe;
      return {
        maximumPending: p.maximumPending,
        unique: new Set(p.searches.map((s) => s.position)).size === p.searches.length,
        spans: p.searches.filter((s) => s.computeMs !== undefined).slice(0, 3).map((s) => {
          const end = s.ended!;
          const frames = p.frames.filter((t) => t >= s.started && t <= end);
          const gaps = [s.started, ...frames, end].slice(1).map((t, i) => t - [s.started, ...frames][i]);
          return {
            computeMs: s.computeMs!,
            frames: frames.length,
            maxFrameGap: Math.max(...gaps),
            blockingTasks: p.longTasks.filter((t) => t.start >= s.started && t.start <= end && t.duration >= 200),
          };
        }),
      };
    });
    console.log(profile.name, JSON.stringify(result));
    expect(errors).toEqual([]);
    expect(serverFallbacks, "worker must actually load in the production build").toBe(0);
    expect(result.maximumPending, "no per-frame duplicate job queue").toBe(1);
    expect(result.unique, "each search uses a new position").toBe(true);
    expect(page.workers().length).toBe(1);
    for (const span of result.spans) {
      expect(span.computeMs, "Hard retains its full-strength think time").toBeGreaterThan(300);
      expect(span.frames, "rAF keeps running during CPU-heavy search").toBeGreaterThan(8);
      expect(span.maxFrameGap).toBeLessThan(200);
      expect(span.blockingTasks).toEqual([]);
    }
    await context.close();
  });
}

test("leaving while Hard is calculating cancels the job without a late move", async ({ page }) => {
  await instrument(page);
  await startHard(page);
  await page.waitForFunction(() => window.__aiProbe.pending === 1);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(page.getByRole("button", { name: "Кик-офф", exact: true })).toBeVisible();
  const jobs = await page.evaluate(() => window.__aiProbe.searches.length);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__aiProbe.pending)).toBe(0);
  expect(await page.evaluate(() => window.__aiProbe.searches.length)).toBe(jobs);
  expect(await page.evaluate(() => window.__aiProbe.searches.some((s) => s.cancelled))).toBe(true);
  expect(page.workers().length).toBe(0);
});

test("worker-unavailable fallback keeps the full-strength bot asynchronous", async ({ page, request }) => {
  await instrument(page, true);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/ai/move") && r.status() === 200);
  await startHard(page);
  const body = (await (await response).json()) as AiResponse;
  expect(body.ok).toBe(true);
  if (body.ok) {
    expect(body.target).not.toBeNull();
    expect(body.elapsedMs).toBeGreaterThan(300);
  }
  expect(page.workers().length).toBe(0);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  const malformed = await request.post(`${base}/api/ai/move`, { data: { id: 1, state: { cfg: { size: 900000 } }, level: "hard" } });
  expect(malformed.status()).toBe(400);
});
