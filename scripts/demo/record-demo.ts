/**
 * Record the "How to use" walkthrough as a real video (.webm) by driving the
 * live demo with a headless Chromium and Playwright's built-in video capture.
 *
 * Prereqs:
 *   - dev server up on :3000 in demo mode (pnpm dev, DEMO_MODE=1)
 *   - briefs regenerated (scripts/db/regen-briefs.ts) so numbers are correct
 *   - pnpm add -D playwright && pnpm exec playwright install chromium
 *
 * Usage:
 *   pnpm exec tsx scripts/demo/record-demo.ts
 *   DEMO_SUB_ID=<uuid> DEMO_BASE_URL=http://localhost:3000 pnpm exec tsx scripts/demo/record-demo.ts
 *
 * Output: docs/product/demo/renewal-radar-how-to.webm
 *
 * Note: Playwright video does not render a mouse cursor; the walkthrough reads
 * through state changes (nav highlight, panel open, answer appearing, claim
 * expanding), which is what a viewer follows anyway.
 */
import { chromium, type Page } from "playwright";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const SUB_ID = process.env.DEMO_SUB_ID ?? "99587a38-bf29-483f-b376-9ac8b8f89fd5";
const OUT_DIR = path.resolve("docs/product/demo");
const OUT_FILE = path.join(OUT_DIR, "renewal-radar-how-to.webm");
const FRAMES_DIR = path.join(OUT_DIR, "frames");

const hold = (page: Page, ms: number) => page.waitForTimeout(ms);

async function clearWebm(dir: string) {
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((f) => f.endsWith(".webm"))
      .map((f) => rm(path.join(dir, f)).catch(() => {}))
  );
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(FRAMES_DIR, name) }).catch(() => {});

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(FRAMES_DIR, { recursive: true });
  await clearWebm(OUT_DIR);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  // ── Scene 1 — dashboard ──────────────────────────────────────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await hold(page, 1800);
  const skip = page.getByText(/skip tour/i).first();
  if (await skip.count().catch(() => 0)) await skip.click().catch(() => {});
  await hold(page, 1200);
  await shot(page, "1-dashboard.png");
  await hold(page, 3000);

  // ── Scene 2 — Needs you ──────────────────────────────────────────────────
  await page.goto(`${BASE}/action-queue`, { waitUntil: "domcontentloaded" });
  await hold(page, 1600);
  await shot(page, "2-needs-you.png");
  await hold(page, 600);
  await page.mouse.wheel(0, 320);
  await hold(page, 1800);
  await page.mouse.wheel(0, -320);
  await hold(page, 1200);

  // ── Scene 3 — Renewal Intelligence Brief ─────────────────────────────────
  await page.goto(`${BASE}/subscriptions/${SUB_ID}`, { waitUntil: "domcontentloaded" });
  await hold(page, 2600);
  const claim = page.getByText(/days to the notice deadline/i).first();
  if (await claim.count().catch(() => 0)) await claim.click().catch(() => {});
  await hold(page, 1400);
  await shot(page, "3-brief.png");
  await hold(page, 1200);
  await page.mouse.wheel(0, 520);
  await hold(page, 3200); // reveal "Prepared for you" + missing info
  await page.mouse.wheel(0, -520);
  await hold(page, 900);

  // ── Scene 4 — Ask Renewal Radar ──────────────────────────────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await hold(page, 1600);
  await page.getByRole("button", { name: /ask renewal radar/i }).click().catch(() => {});
  await hold(page, 1200);
  await page
    .getByRole("button", { name: /what's my biggest risk\?/i })
    .click()
    .catch(() => {});
  await page
    .getByText(/biggest risk:/i)
    .first()
    .waitFor({ timeout: 12000 })
    .catch(() => {});
  await hold(page, 1500);
  await shot(page, "4-ask.png");
  await hold(page, 3300);

  // Finalize the video.
  const video = page.video();
  await context.close();
  await browser.close();

  // Rename the generated file to a friendly, stable name.
  let src = await video?.path().catch(() => undefined);
  if (!src) {
    const webms = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".webm"));
    let newest: { f: string; t: number } | null = null;
    for (const f of webms) {
      const s = await stat(path.join(OUT_DIR, f));
      if (!newest || s.mtimeMs > newest.t) newest = { f, t: s.mtimeMs };
    }
    if (newest) src = path.join(OUT_DIR, newest.f);
  }
  if (src && path.resolve(src) !== OUT_FILE) {
    await rm(OUT_FILE).catch(() => {});
    await rename(src, OUT_FILE);
  }
  console.log(`✓ recorded ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
