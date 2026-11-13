import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { autoLevels } from "../src/lib/chart/autoLevels.ts";
import { formatPrice } from "../src/lib/format.ts";

const base = "http://127.0.0.1:3107";
const executablePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
  .find((path) => path && existsSync(path));
assert.ok(executablePath, "Set CHROME_PATH to Chrome.");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let candles = Array.from({ length: 160 }, (_, index) => {
    const close = 100 + 10 * Math.sin(index * 0.6) + 2 * Math.sin(index * 0.13);
    return { t: Date.UTC(2026, 0, index + 1), open: close, close, high: close + 2, low: close - 2, volume: 10000 };
  });
  await page.route("**/api/fyers/candles?**", (route) => route.fulfill({ json: { candles } }));
  await page.route("**/api/market/history?**", (route) => route.fulfill({ json: { candles: { TCS: candles } } }));
  const expected = autoLevels(candles);
  const fullHistory = candles;
  assert.ok(expected.some((level) => level.kind === "support"));
  assert.ok(expected.some((level) => level.kind === "resistance"));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/?stock=TCS`);
    const section = page.getByRole("region", { name: "Support and resistance", exact: true });
    await section.getByText(/Fyers · daily candle/).waitFor();
    const text = await section.innerText();
    for (const level of expected) {
      assert.ok(text.includes(`₹${formatPrice(level.price)}`), `Missing level ${level.price}`);
      assert.ok(text.includes(`₹${formatPrice(level.zoneLow)}–₹${formatPrice(level.zoneHigh)}`));
      assert.ok(text.includes(`${level.touches} swing touches`));
    }
    assert.ok(text.includes("not another trade plan"));
    await section.scrollIntoViewIfNeeded();
    assert.equal(await section.evaluate((element) => element.scrollWidth > element.clientWidth + 2), false);
  }
  candles = candles.slice(0, 5);
  await page.goto(`${base}/?stock=TCS`);
  const section = page.getByRole("region", { name: "Support and resistance", exact: true });
  await section.getByText(/No qualifying support found/).waitFor();
  await section.getByText(/No qualifying resistance found/).waitFor();
  candles = [];
  await page.goto(`${base}/?stock=TCS`);
  await section.getByRole("status").waitFor();
  assert.match(await section.innerText(), /cannot be calculated/);
  candles = fullHistory;
  const row = {
    key: "TCS", symbol: "TCS", name: "Test stock", sector: "Technology", price: 100,
    changePercent: 1, stage: "forming", liquid: true, series: "EQ", rs: 92,
    ext: -3, vs50: 5, vs200: 30, fromHigh: 4, dry: 0.7, turnoverCr: 20,
    pivotPrice: 103, aboveLow: 80, coil: 0.5, baseWk: 10, baseDepth: 20,
    listedWk: 300, level: 1, mcap: 5000, screens: ["Blue sky"], badges: [],
    riskFlags: [], paRating: null, oscillatorScore: {
      score: 12, bearish: 0, levels: { entry: 105, buyZoneHigh: 108, stop: 99,
        target1: 117, target2: 123, riskPercent: 5.7, atr: 2, swingLow20: 99, swingLow50: 98 },
    },
  };
  await page.route("**/api/market/screen", (route) => route.fulfill({ json: {
    rows: [row], extraRows: [], feed: [], unavailable: [], updatedAt: Date.now(),
    source: { id: "fixture", label: "Browser test fixture", isRealtime: false },
    sessionDateKey: "2026-11-12", scanned: 1, eligible: 1,
    universe: { source: "fixture", count: 1, total: 1 },
  } }));
  let planFails = false;
  await page.route("**/api/market/trade-plan?**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("symbol");
    const close = symbol === "INFY" ? 200 : 100;
    return route.fulfill(planFails
    ? { status: 503, json: { error: "Plan unavailable for this test." } }
    : { json: {
      symbol, asOf: Date.now(), provisional: false, breadth50: 60,
      size: { key: "full", label: "Normal size", detail: "Browser test fixture." },
      inputs: { close, atr: 2, swingLow: close - 5, ema21: close - 3, ema50: close - 4, sma50: close - 6, sma100: close - 7, high52: close + 20 },
    } });
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/?stock=TCS`);
    const dialog = page.getByRole("dialog");
    const primary = dialog.getByRole("region", { name: "Trade plan", exact: true });
    await primary.getByRole("heading", { name: "Trade plan", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("heading", { name: "Trade plan", exact: true }).count(), 1);
    const planText = await primary.innerText();
    assert.match(planText, /₹100\.00/);
    assert.match(planText, /₹88\.00/);
    assert.match(planText, /₹124\.00/);
    assert.doesNotMatch(planText, /Other references:|swing-low stop/);
    assert.equal(await dialog.getByText("Reference levels · not a recommendation", { exact: true }).count(), 0);
    assert.equal(await dialog.getByText("T2", { exact: true }).count(), 0);
    await dialog.getByText("Optional partial profit", { exact: true }).waitFor();
    for (const [label, price] of [["Entry", 100], ["Stop", 88], ["Optional partial profit", 124], ["50-day exit", 94]]) {
      await dialog.getByTitle(`${label}: ₹${formatPrice(price)}`, { exact: true }).waitFor();
    }
    const rungs = await primary.locator(".space-y-1\\.5").innerText();
    await dialog.getByRole("button", { name: "Long term", exact: true }).click();
    assert.equal(await primary.locator(".space-y-1\\.5").innerText(), rungs, "Horizon research cannot alter the primary plan");
    const historical = dialog.locator("details").filter({ has: page.locator("summary", { hasText: "Historical simulation" }) });
    assert.equal(await historical.evaluate((element) => element.open), false);
  }
  await page.evaluate(() => {
    history.pushState({}, "", "?stock=INFY");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("dialog").getByRole("heading", { name: "INFY", exact: false }).waitFor();
  await page.getByRole("region", { name: "Trade plan", exact: true }).getByRole("heading", { name: "Trade plan", exact: true }).waitFor();
  await page.getByTitle(`Entry: ₹${formatPrice(200)}`, { exact: true }).waitFor();
  assert.equal(await page.getByTitle(`Entry: ₹${formatPrice(100)}`, { exact: true }).count(), 0);
  planFails = true;
  await page.evaluate(() => {
    history.pushState({}, "", "?stock=TCS");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("region", { name: "Trade plan", exact: true }).getByRole("alert").waitFor();
  assert.equal(await page.getByText("Optional partial profit", { exact: true }).count(), 0, "Failed plans must not leave chart plan lines");
  assert.deepEqual(errors, []);
  console.log("Text S/R, single primary plan, chart labels, horizon isolation, unavailable states and mobile layout passed.");
} finally {
  await browser.close();
}
