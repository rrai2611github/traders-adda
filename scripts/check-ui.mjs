// A real-browser check of the app: opens each main page and the stock drawer at desktop and phone width and reports sideways scrolling,
// script errors, failed requests and missing key text, with screenshots. Run it with the site up:  npm run check:ui
//   npm run check:ui -- --flow     also tries the "I bought it" flow with a throwaway position (added, then removed again)
//   npm run check:ui -- --base=http://127.0.0.1:3107 --out=tmp/ui-check
// It uses Google Chrome with a brand-new temporary profile that is deleted afterwards; it never touches any saved browser profile.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://127.0.0.1:3107");
const OUT = arg("out", "tmp/ui-check");
const FLOW = process.argv.includes("--flow");
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!CHROME) { console.error("Google Chrome was not found. Set CHROME_PATH to its location."); process.exit(2); }

const WIDTHS = [["desktop", 1280, 900], ["phone", 390, 844]];
const PAGES = [
  { path: "/", name: "home", wait: 4000, expect: ["my positions", "live strategy check", "strategy health"] },
  { path: "/positions", name: "positions", wait: 2500, expect: ["my positions", "i bought a stock", "plan email"] },
  { path: "/tracker", name: "tracker", wait: 3500, expect: ["live strategy check"] },
  { path: "/backtest", name: "backtest", wait: 2500, expect: ["backtest"] },
  { path: "/radar", name: "radar", wait: 3000, expect: ["email track record"] },
];

mkdirSync(OUT, { recursive: true });
const failures = [];
const fail = (where, what) => { failures.push(`${where}: ${what}`); console.log(`  FAIL ${where}: ${what}`); };
const ok = (where, what) => console.log(`  ok   ${where}: ${what}`);

/** The first load after a restart takes about a minute while the market scan builds. */
async function warmUp() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/market/screen`, { signal: AbortSignal.timeout(120_000) });
      if (res.ok && (await res.json()).rows?.length) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}

const profile = mkdtempSync(join(tmpdir(), "traders-ui-check-"));
let context;
try {
  try { await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) }); } catch { console.error(`The site is not running at ${BASE}. Start it first (npm run start).`); process.exit(2); }
  console.log("Waiting for the market scan to be ready…");
  if (!(await warmUp())) fail("start", "the market scan did not become ready in time");

  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, args: ["--no-first-run", "--no-default-browser-check"] });
  const page = context.pages()[0] ?? (await context.newPage());
  let problems = [];
  page.on("pageerror", (e) => problems.push(`script error: ${e.message.slice(0, 140)}`));
  // Fyers answers 401 when it is not logged in; the charts then use Yahoo, so that is normal, not a fault.
  const expected401 = (url) => url.includes("/api/fyers/");
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text()) && !/status of 401/.test(m.text())) problems.push(`console error: ${m.text().slice(0, 140)}`); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(BASE)) problems.push(`request failed: ${r.url().replace(BASE, "")}`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes("/_next/") && !/favicon/.test(r.url()) && !(r.status() === 401 && expected401(r.url()))) problems.push(`HTTP ${r.status()}: ${r.url().replace(BASE, "")}`); });
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

  for (const [wname, w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of PAGES) {
      const where = `${p.name} @ ${wname}`;
      problems = [];
      await page.goto(BASE + p.path, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForTimeout(p.wait);
      const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
      const missing = p.expect.filter((t) => !text.includes(t));
      if (missing.length) fail(where, `missing text: ${missing.join(", ")}`); else ok(where, "key text present");
      if (await sideways()) fail(where, "the page scrolls sideways"); else ok(where, "no sideways scrolling");
      // The bottom tab bar: on phones only, with this page's tab marked as current.
      const bar = page.locator('nav[aria-label="Main tabs"]');
      const barShown = await bar.isVisible();
      if (barShown !== (wname === "phone")) fail(where, wname === "phone" ? "the bottom tab bar is missing" : "the bottom tab bar shows on a wide screen");
      else if (barShown) {
        const current = await bar.locator('a[aria-current="page"]').getAttribute("href");
        if (current !== p.path) fail(where, `the bottom tab bar marks "${current}" instead of "${p.path}"`); else ok(where, "bottom tab bar shows the right tab");
      }
      if (problems.length) fail(where, [...new Set(problems)].slice(0, 4).join(" | "));
      await page.screenshot({ path: join(OUT, `${p.name}-${wname}.png`) });
    }

    // "Today in numbers": a tile opens the list of its stocks, and the list is as long as the number on the tile.
    {
      const listWhere = `numbers list @ ${wname}`;
      problems = [];
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const tile = page.getByRole("button", { name: /Near 52-wk high/i }).first();
      if (!(await tile.count())) fail(listWhere, "the Near 52-wk high tile is not a button");
      else {
        const shown = Number((await tile.innerText()).split("\n").map((s) => s.trim()).filter(Boolean)[1]);
        await tile.click();
        await page.waitForTimeout(700);
        const heading = await page.getByRole("region", { name: "Near the 52-week high" }).locator("h4").innerText().catch(() => "");
        if (!heading.includes(`(${shown})`)) fail(listWhere, `the tile says ${shown} but the list says "${heading.replace(/\s+/g, " ")}"`);
        else if (await sideways()) fail(listWhere, "the page scrolls sideways");
        else ok(listWhere, `opens with ${shown} stocks, matching the tile`);
      }
      if (problems.length) fail(listWhere, [...new Set(problems)].slice(0, 4).join(" | "));
    }

    // The glossary on About & risk, and a tap-to-explain word: the note must open fully on screen, never widen the page, and close again.
    {
      const termWhere = `glossary @ ${wname}`;
      problems = [];
      await page.goto(`${BASE}/#about`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      const words = await page.locator("dl dt").count();
      if (words < 15) fail(termWhere, `only ${words} words listed on About & risk`);
      else if (await sideways()) fail(termWhere, "the page scrolls sideways");
      else ok(termWhere, `${words} words listed`);
      await page.goto(`${BASE}/positions`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      const word = page.locator('button[title^="What is"]').first();
      if (!(await word.count())) ok(termWhere, "no explained word on screen today, popover not checked");
      else {
        await word.scrollIntoViewIfNeeded();
        await word.click();
        await page.waitForTimeout(300);
        const tip = page.locator('[role="tooltip"]');
        const box = await tip.boundingBox();
        if (!box || box.x < 0 || box.x + box.width > w || box.y < 0 || box.y + box.height > h) fail(termWhere, "the explanation does not fit on screen");
        else if (await sideways()) fail(termWhere, "the explanation widened the page");
        else {
          await page.keyboard.press("Escape");
          if (await tip.count()) fail(termWhere, "the explanation did not close with Escape"); else ok(termWhere, "explanation opens on screen and closes");
        }
      }
      if (problems.length) fail(termWhere, [...new Set(problems)].slice(0, 4).join(" | "));
    }

    // The stock drawer, from the first Top pick.
    const where = `stock drawer @ ${wname}`;
    problems = [];
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const pick = page.locator('section[aria-label="Top picks"] ul li button').first();
    if (!(await pick.count())) { ok(where, "no Top pick on screen today, drawer not checked"); continue; }
    await pick.click();
    await page.waitForTimeout(5000);
    const drawer = (await page.locator('[role="dialog"]').innerText()).toLowerCase();
    for (const needed of ["setup check", "company health", "trade plan"]) if (!drawer.includes(needed)) fail(where, `missing: ${needed}`);
    if (drawer.includes("status ·")) fail(where, "the old status chip is back");
    if (await sideways()) fail(where, "the page scrolls sideways"); else ok(where, "opens, no sideways scrolling");
    if (problems.length) fail(where, [...new Set(problems)].slice(0, 4).join(" | "));
    await page.screenshot({ path: join(OUT, `drawer-${wname}.png`) });
    await page.keyboard.press("Escape");
  }

  if (FLOW) {
    // "I bought it": the link from a pick pre-fills the form; a throwaway position is added with a slightly different price and removed again.
    const where = "I bought it flow";
    const api = (b) => fetch(`${BASE}/api/positions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    let addedId = null;
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      const link = page.locator('section[aria-label="Top picks"] a[href^="/positions"]').first();
      if (!(await link.count())) { ok(where, "no buyable pick today, flow skipped"); }
      else {
        await link.click();
        await page.waitForURL(/\/positions/);
        await page.waitForTimeout(3500);
        const form = page.locator('form[aria-label="Add a position"]');
        const price = form.locator("label", { hasText: "Price paid" }).locator("input");
        const planned = Number(await price.inputValue());
        if (!(planned > 0)) fail(where, "the form was not pre-filled with the planned price");
        await price.fill((planned * 1.006).toFixed(2));
        await form.locator("label", { hasText: "Note" }).locator("input").fill("UI-CHECK-THROWAWAY");
        await form.getByRole("button", { name: "Add position" }).click();
        await page.waitForTimeout(2500);
        const view = await fetch(`${BASE}/api/positions`).then((r) => r.json());
        const added = view.open.find((o) => o.holding.note === "UI-CHECK-THROWAWAY");
        addedId = added?.holding.id ?? null;
        if (!added) fail(where, "the position was not saved (the form may have refused the price)");
        else if (added.holding.plannedPrice !== planned) fail(where, "the planned price was not recorded");
        else ok(where, `saved with planned ₹${planned} and paid ₹${added.holding.buyPrice}`);
      }
    } finally {
      if (addedId) await api({ action: "remove", id: addedId });
    }
  }
} finally {
  if (context) await context.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} problem${failures.length === 1 ? "" : "s"} found. Screenshots are in ${OUT}.` : `\nAll checks passed. Screenshots are in ${OUT}.`);
process.exit(failures.length ? 1 : 0);
