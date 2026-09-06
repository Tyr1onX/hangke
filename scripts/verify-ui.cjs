// Runs against a production preview, or an isolated Windows WebView2 CDP session.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync("artifacts", { recursive: true });
  const desktop = !!process.env.HANGKE_CDP;
  const browser = desktop
    ? await chromium.connectOverCDP(process.env.HANGKE_CDP)
    : await chromium.launch({ channel: "msedge", headless: true });
  const context = desktop
    ? browser.contexts()[0]
    : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = desktop ? context.pages()[0] : await context.newPage();
  const errors = [],
    tiles = [],
    workers = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGE ERROR:", e.message);
  });
  page.on("response", (r) => {
    if (/\/\d+\/\d+\/\d+\.(pbf|mvt)/.test(r.url()) && r.ok())
      tiles.push(r.url());
  });
  page.on("worker", (w) => workers.push(w.url()));
  if (!desktop) await page.goto("http://127.0.0.1:4173");
  else await page.reload();
  await page.locator("#origin").waitFor();
  // Only the disposable test profile is cleared.
  await page.evaluate(() => localStorage.removeItem("hangke.v1"));
  await page.reload();
  await page.locator("#origin").waitFor();
  assert.equal(await page.locator("#origin").inputValue(), "");
  assert.equal(await page.locator("#destination").inputValue(), "");
  assert.equal(await page.locator("#takeoff").isDisabled(), true);
  await page.locator("#origin").fill("CGQ");
  await page.locator("#origin").press("Enter");
  assert.match(await page.locator("#origin").inputValue(), /CGQ/);
  const candidateDistances = async () =>
    (await page.locator("#destination-results [role=option]").allInnerTexts()).map(
      (text) => Number(text.match(/([\d,]+) km/)?.[1].replaceAll(",", "")),
    );
  await page.locator("#duration").selectOption("25");
  let distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 312.5) < 100, JSON.stringify(distances));
  const first25 = distances[0];
  await page.locator("#duration").selectOption("60");
  distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 750) < 100, JSON.stringify(distances));
  assert.ok(
    !(await page.locator("#destination-results").innerText()).includes("HND"),
    "CGQ + 60 min must not offer HND",
  );
  const first60 = distances[0];
  await page.locator("#duration").selectOption("120");
  distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 1500) < 100, JSON.stringify(distances));
  const first120 = distances[0];
  assert.ok(first25 < first60 && first60 < first120);
  await page.locator("#duration").selectOption("10");
  await page.locator("#destination-results [role=option]").first().click();
  const selectedIata = (await page.locator("#destination").inputValue()).slice(0, 3);
  await page.locator("#task").fill("验收航程");
  assert.equal(await page.locator("#takeoff").isDisabled(), false);
  assert.match(await page.locator("#distance").innerText(), /km/);
  await page.waitForFunction(
    () => document.querySelectorAll(".maplibregl-ctrl-attrib a").length >= 2,
  );
  await page.waitForTimeout(7000);
  await page.screenshot({
    path: `artifacts/${desktop ? "windows" : "browser"}-planner.png`,
  });
  await page.locator("#takeoff").click();
  await page.locator("#flight").waitFor({ state: "visible" });
  const active = await page.evaluate(
    () => JSON.parse(localStorage.getItem("hangke.v1")).activeFlight,
  );
  assert.equal(active.destinationIata, selectedIata);
  await page.reload();
  await page.locator("#flight").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hangke.v1")).activeFlight.id,
    ),
    active.id,
  );
  // Advance the wall clock fixture, retaining the legal ten-minute duration.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("hangke.v1"));
    s.activeFlight.startedAt = Date.now() - 300000;
    s.activeFlight.endsAt = s.activeFlight.startedAt + 600000;
    localStorage.setItem("hangke.v1", JSON.stringify(s));
  });
  await page.reload();
  await page
    .locator("#timer")
    .filter({ hasText: /0[45]:/ })
    .waitFor();
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: `artifacts/${desktop ? "windows" : "browser"}-flight.png`,
  });
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("hangke.v1"));
    s.activeFlight.startedAt = Date.now() - 600100;
    s.activeFlight.endsAt = s.activeFlight.startedAt + 600000;
    localStorage.setItem("hangke.v1", JSON.stringify(s));
  });
  await page.reload();
  await page.locator("#landing").waitFor({ state: "visible" });
  let state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hangke.v1")),
  );
  assert.equal(state.flights.length, 1);
  assert.equal(state.lastAirportIata, selectedIata);
  assert.equal(state.activeFlight, null);
  await page.locator("#done").click();
  assert.match(await page.locator("#origin").inputValue(), new RegExp(`^${selectedIata}`));
  await page.reload();
  assert.match(await page.locator("#origin").inputValue(), new RegExp(`^${selectedIata}`));
  await page.locator("#history-toggle").click();
  await page.locator(".history-item").click();
  assert.match(await page.locator("#details").innerText(), /验收航程/);
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: `artifacts/${desktop ? "windows" : "browser"}-history.png`,
  });
  await page.locator("#history-toggle").click();
  await page.locator("#duration").selectOption("10");
  await page.locator("#destination-results [role=option]").first().click();
  await page.locator("#task").fill("取消测试");
  await page.locator("#takeoff").click();
  await page.locator("#cancel").click();
  await page.locator("#continue").click();
  assert.equal(await page.locator("#flight").isVisible(), true);
  await page.locator("#cancel").click();
  await page.locator("#end").click();
  state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hangke.v1")),
  );
  assert.equal(state.flights.length, 1);
  assert.equal(state.lastAirportIata, selectedIata);
  assert.equal(state.activeFlight, null);
  if (!desktop) await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: `artifacts/${desktop ? "windows" : "browser"}-resize.png`,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(tiles.length > 0, "Production vector tile response required");
  assert.ok(
    workers.some((w) => w.includes("maplibre-gl-worker")),
    "Bundled worker required",
  );
  console.log(
    JSON.stringify(
      {
        desktop,
        checks:
          "planner/duration-candidates/route/timer/reload/expired landing/idempotence/history/cancel/resize",
        tileResponses: tiles.length,
        workers: [...new Set(workers)],
        errors,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    `artifacts/${desktop ? "windows" : "browser"}-verification.json`,
    JSON.stringify(
      {
        desktop,
        tileResponses: tiles.length,
        workers: [...new Set(workers)],
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
