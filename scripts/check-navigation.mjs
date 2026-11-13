// Read-only browser regression checks. Run against a built, running local app.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { buildTopPicks } from "../src/lib/screen/topPicks.ts";

const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:3107";
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => path && existsSync(path));
assert.ok(chrome, "Set CHROME_PATH to an installed Chrome executable.");
const profile = mkdtempSync(join(tmpdir(), "traders-nav-check-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const goto = async (path) => {
    await page.goto(base + path, { waitUntil: "domcontentloaded" });
    await page.locator("main").waitFor();
  };
  const closed = async (locator) => assert.equal(await locator.evaluate((element) => element.open), false);
  const opened = async (locator) => {
    await locator.locator(":scope > summary").click();
    assert.equal(await locator.evaluate((element) => element.open), true);
  };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await goto("/");
    if (width === 1280) {
      const nav = page.getByRole("navigation", { name: "Primary navigation" });
      for (const label of ["Today", "Positions & strategy", "Backtest (10 years)", "Email track record", "Watchlist", "Market overview", "Stock research", "Scanner directory", "Core Setups", "Monthly Setups", "Trade Triggers", "About & risk"]) {
        assert.ok(await nav.locator(`button[aria-label="${label}"]`).count(), `${label} appears in the workspace menu`);
      }
      const tools = nav.locator("details.sidenav-tools");
      await closed(tools);
      for (const label of ["Market overview", "Stock research", "Scanner directory", "Core Setups", "Monthly Setups", "Trade Triggers"]) {
        assert.equal(await tools.locator(`button[aria-label="${label}"]`).count(), 0, `${label} is not hidden under More tools`);
      }
      await opened(tools);
      for (const label of ["Older scanner picks", "Bottomed Out", "RSI Edge Scanners", "RPCI & Oscillators", "Paper trades & journal", "Index Scalp Desk"]) {
        assert.ok(await tools.locator(`button[aria-label="${label}"]`).count(), `${label} appears in More tools`);
      }
      await nav.locator('button[aria-label="Scanner directory"]').click();
      await page.waitForURL(/#scanner-directory$/);
    } else {
      const tabs = page.getByRole("navigation", { name: "Main tabs" });
      assert.deepEqual(await tabs.locator("a").allTextContents(), ["Today", "Portfolio", "Backtest", "Emails"]);
      assert.equal(await tabs.locator('a[aria-current="page"]').getAttribute("href"), "/");
      await tabs.getByRole("link", { name: "Portfolio", exact: true }).click();
      await page.waitForURL(/\/positions$/);
      await tabs.getByRole("link", { name: "Today", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/" && !url.hash);
      assert.equal(await page.locator(".sidenav").isVisible(), false, "Phone must not show a second navigation rail");
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `navigation overflow at ${width}px`);
    await page.getByRole("region", { name: "Market index snapshot" }).waitFor();
    await page.getByRole("heading", { name: "Breadth, last 6 months", exact: true }).waitFor();
    await page.getByRole("region", { name: "Top picks", exact: true }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Is it a good day to buy", exact: true }).count(), 0, "Do not repeat the market summary banner on home");
    await goto("/#scanner-directory");
    const catalog = page.locator("details").filter({ has: page.locator("summary", { hasText: "Find a scanner" }) });
    await closed(catalog);
    await page.getByRole("region", { name: "Research tasks" }).getByRole("button", { name: /^Watchlist/ }).click();
    await page.waitForURL(/#watchlist$/);
    await page.getByRole("button", { name: "Back to Research", exact: true }).click();
    await page.waitForURL(/#scanner-directory$/);
    await opened(catalog);
    assert.ok(await catalog.getByRole("button").count() > 5, "Scanner catalog remains accessible");

    await goto("/positions");
    for (const id of ["strategy-check", "order-approvals", "email-activity"]) {
      await closed(page.locator(`[data-portfolio-section="${id}"]`));
      await goto(`/positions#${id}`);
      await page.waitForFunction((id) => document.querySelector(`[data-portfolio-section="${id}"]`)?.open, id);
      await goto("/positions");
    }
    await goto("/positions?symbol=TCS&buy=3000&stop=2640");
    await page.waitForFunction(() => document.querySelector("#add-position")?.open);
    assert.equal(await page.locator('#add-position input').first().inputValue(), "TCS");

    for (const path of ["/backtest", "/radar"]) {
      await goto(path);
      await page.getByRole("link", { name: "Back to Results", exact: true }).click();
      await page.waitForURL(/\/performance$/);
    }
    if (width === 390) {
      await goto("/#scanner-directory");
      const tabs = page.getByRole("navigation", { name: "Main tabs" });
      await tabs.getByRole("link", { name: "Today", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/" && !url.hash);
      await page.goBack();
      await page.waitForURL(/#scanner-directory$/);
    }
    console.log(`Navigation, disclosure, deep-link and overflow checks passed at ${width}px.`);
  }
  // Browser-only fixtures verify populated and failed states even during server warm-up.
  const rows = Array.from({ length: 5 }, (_, index) => ({
    key: `NAVTEST${index}`, symbol: `NAVTEST${index}`, name: `Navigation test ${index}`,
    stage: "forming", liquid: true, series: "EQ", rs: 92 + index, ext: -3, vs50: 5,
    vs200: 30, fromHigh: 4, dry: 0.7, turnoverCr: 20, price: 100, pivotPrice: 103,
    aboveLow: 80, coil: 0.5, baseWk: 10, baseDepth: 20, listedWk: 300, level: 1,
    mcap: 5000, changePercent: 1, sector: "Technology", screens: [], badges: [],
    oscillatorScore: null, riskFlags: [],
  }));
  const source = { id: "fixture", label: "Browser test fixture", isRealtime: false };
  const updatedAt = Date.now();
  const expected = buildTopPicks(rows, []).map(({ symbol }) => symbol);
  let failedPositions = false;
  await page.route("**/api/market/screen", (route) => route.fulfill({ json: {
    updatedAt, source, rows, extraRows: [], feed: [], scanned: rows.length, eligible: rows.length,
    unavailable: [], universe: { source: "fixture", count: rows.length, total: rows.length },
    sessionDateKey: "2026-11-12", marketOpen: false,
  } }));
  await page.route("**/api/market/weekly-top5", (route) => route.fulfill({ json: {
    updatedAt, source, picks: [], qualifying: 0, breadth50: 53, provisional: false,
  } }));
  await page.route("**/api/positions", (route) => route.fulfill(failedPositions
    ? { status: 500, json: { error: "Browser test failure" } }
    : { json: { open: [{ assessment: { status: "stop-hit" } }] } }));
  for (const width of [1600, 1068, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await goto("/");
    const list = page.locator(".top-picks-grid");
    await list.locator(":scope > li").nth(4).waitFor();
    assert.deepEqual(await list.locator(":scope > li > div:first-child button").allTextContents(), expected);
    await list.locator("li").first().locator("details > summary").click();
    assert.match(await list.locator("li").first().innerText(), /103.*90\.64/s, "Entry and 12% stop remain unchanged");
    const boxes = await page.locator(".market-overview-grid > section").evaluateAll((cards) => cards.map((card) => {
      const { x, y, width, height } = card.getBoundingClientRect();
      return { x, y, width, height };
    }));
    assert.equal(boxes.length, 3);
    if (width === 1600) {
      assert.equal(boxes[0].y, boxes[2].y, "Wide screens align all three market cards");
      assert.ok(Math.abs(boxes[0].height - boxes[2].height) < 1, "Market cards have equal height");
    } else if (width === 1068) {
      assert.equal(boxes[0].y, boxes[1].y, "Medium screens align gauge and trend");
      assert.ok(Math.abs(boxes[0].height - boxes[1].height) < 1, "First-row cards have equal height");
      assert.ok(boxes[2].width > boxes[0].width * 1.9, "Statistics span the full second row, with no orphan gap");
    } else {
      assert.ok(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, "Phone cards stack");
    }
    await page.getByText("1 needs a decision", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
  }
  failedPositions = true;
  await goto("/");
  await page.getByRole("region", { name: "What to do today" }).getByText("Unavailable", { exact: true }).waitFor();
  assert.match(await page.getByRole("region", { name: "What to do today" }).innerText(), /Refresh failed/);
  console.log("Original stock cards, ordering, plans, responsive card alignment, holdings alerts and explicit failure states passed.");
  assert.deepEqual(errors, [], "No browser runtime errors");
} finally {
  if (context) await context.close();
  rmSync(profile, { recursive: true, force: true });
}
