import { test, expect } from "@playwright/test";
import { computeLayout } from "../src/game/field";
import { goalHalf } from "../src/game/engine";
import { pitchShape, isPhoneViewport } from "../src/game/presets";

const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.setTimeout(30_000);

for (const [name, width, height] of [
  ["phone portrait", 393, 852],
  ["small phone portrait", 375, 667],
  ["phone landscape", 844, 390],
  ["tablet portrait", 768, 1024],
  ["desktop", 1440, 900],
] as [string, number, number][]) {
  test(`Pass is reachable near bottom and transfers the turn (${name})`, async ({ browser }) => {
    const phone = isPhoneViewport(width, height);
    const landscape = width > height;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: phone,
      hasTouch: phone,
      deviceScaleFactor: phone ? 2 : 1,
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "Начать матч" }).click();
    const pass = page.getByRole("button", { name: /Пас — завершить ход/ });
    await expect(pass).toHaveCount(0); // no pass before the first line
    await page.waitForTimeout(2700); // coin toss completes

    const shape = pitchShape("classic", phone, landscape);
    const rect = await page.locator("canvas").boundingBox();
    const wrap = await page.locator("canvas").locator("..").boundingBox();
    expect(rect).not.toBeNull();
    expect(wrap).not.toBeNull();
    const w = wrap!.width;
    const h = wrap!.height;
    const portrait = h > w;
    const short = h < 560;
    const topInset = short
      ? Math.min(88, Math.max(62, Math.round(h * 0.2)))
      : portrait && phone
        ? Math.min(96, Math.max(82, Math.round(h * 0.115)))
        : portrait
          ? Math.min(112, Math.max(80, Math.round(h * 0.12)))
          : Math.min(150, Math.max(92, Math.round(h * 0.15)));
    const bottomPad = short
      ? Math.min(24, Math.max(12, Math.round(h * 0.045)))
      : portrait
        ? Math.min(30, Math.max(16, Math.round(h * 0.035)))
        : Math.min(56, Math.max(30, Math.round(h * 0.05)));
    const L = computeLayout(w, h, shape.cols, shape.rows, {
      compact: !(w >= 1100 && h >= 700),
      phone,
      topInset,
      bottomPad,
    });
    const mx = (shape.cols - 1) / 2;
    const my = (shape.rows - 1) / 2;
    // A clean, quiet landing one row towards the north goal.
    await page.mouse.click(rect!.x + L.ox + mx * L.cellW, rect!.y + L.oy + (my - 1) * L.cellH);
    await expect(pass).toBeVisible({ timeout: 4_000 });
    await expect(pass).toBeEnabled();
    // On a small phone the goal may be further down a scrollable pitch. The
    // button must travel with it, not remain pinned to the viewport bottom.
    if (phone) await pass.scrollIntoViewIfNeeded();
    const b = await pass.boundingBox();
    const currentCanvas = await page.locator("canvas").boundingBox();
    expect(b).not.toBeNull();
    expect(currentCanvas).not.toBeNull();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(b!.y + b!.height).toBeLessThanOrEqual(height + 1);

    // The bottom goal occupies the central nodes, one cell outward from y1.
    const goalLeft = currentCanvas!.x + L.ox + (mx - goalHalf(shape.cols)) * L.cellW;
    const goalRight = currentCanvas!.x + L.ox + (mx + goalHalf(shape.cols)) * L.cellW;
    const goalTop = currentCanvas!.y + L.oy + (shape.rows - 1) * L.cellH;
    const goalBottom = goalTop + L.cellH;
    if (phone) {
      expect(b!.x, "Pass sits to the RIGHT of the goal posts").toBeGreaterThan(goalRight + 4);
      expect(b!.y, "Pass is beside the goal, not below the whole field").toBeGreaterThan(goalTop);
      expect(b!.y, "Pass remains vertically next to the goal").toBeLessThan(goalBottom);
    } else {
      expect(Math.abs(b!.x + b!.width / 2 - width / 2), "tablet/desktop Pass remains centred").toBeLessThan(2);
      expect(b!.y).toBeGreaterThan(goalBottom);
    }
    const overlapsGoal = b!.x < goalRight && b!.x + b!.width > goalLeft &&
      b!.y < goalBottom && b!.y + b!.height > goalTop;
    expect(overlapsGoal, "Pass must not cover the goal mouth").toBe(false);

    const fieldTop = currentCanvas!.y + L.oy;
    const fieldBottom = fieldTop + (shape.rows - 1) * L.cellH;
    const fieldLeft = currentCanvas!.x + L.ox;
    const fieldRight = fieldLeft + (shape.cols - 1) * L.cellW;
    const visibleFieldBottom = Math.min(fieldBottom, wrap!.y + wrap!.height);
    const overlapsPitch = b!.x < fieldRight && b!.x + b!.width > fieldLeft &&
      b!.y < visibleFieldBottom && b!.y + b!.height > fieldTop;
    console.log(`${name}: button=${JSON.stringify(b)} visiblePitch=${JSON.stringify({ fieldLeft, fieldRight, fieldTop, visibleFieldBottom })} overlap=${overlapsPitch}`);
    expect(overlapsPitch, "Pass must not cover playable nodes").toBe(false);

    await pass.click();
    await expect(pass).toHaveCount(0);
    await expect(page.getByText("0/3", { exact: true })).toBeVisible();
    await context.close();
  });
}
