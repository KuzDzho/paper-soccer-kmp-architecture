import { test, expect } from "@playwright/test";
import { computeLayout } from "../src/game/field";

const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test("desktop Space performs the enabled Pass action", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole("button", { name: "Начать матч" }).click();
  await page.waitForTimeout(2700); // finish the opening coin toss

  const canvas = page.locator("canvas");
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  const layout = computeLayout(1440, 900, 19, 19, {
    compact: false,
    phone: false,
    topInset: 135,
    bottomPad: 45,
  });

  // Start at the centre ball and drag one clean, quiet line to a fresh node.
  const start = {
    x: rect!.x + layout.ox + 9 * layout.cellW,
    y: rect!.y + layout.oy + 9 * layout.cellH,
  };
  const target = {
    x: rect!.x + layout.ox + 9 * layout.cellW,
    y: rect!.y + layout.oy + 8 * layout.cellH,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();

  const pass = page.getByRole("button", { name: /Пас — завершить ход/ });
  await expect(pass).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press("Space");
  await expect(pass).toHaveCount(0);
  await expect(page.getByText("0/3", { exact: true })).toBeVisible();
  await context.close();
});

