// Runs against a production preview, or an isolated Windows WebView2 CDP session.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function state(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("hangke.v1")) || {
      activeFlight: null,
      flights: [],
      lastAirportIata: null,
    },
  );
}
async function setDuration(page, minutes) {
  await page.locator(`#duration-track [data-minutes="${minutes}"]`).evaluate((element) => element.click());
  await page.waitForFunction(
    (value) => document.querySelector("#duration")?.getAttribute("aria-valuenow") === String(value),
    minutes,
  );
  await page.waitForFunction(() => document.querySelector("#duration")?.dataset.motion === "idle", null, { timeout: 10000 });
  await page.waitForFunction((value) => {
    const ruler = document.querySelector("#duration");
    return Math.abs(ruler.scrollLeft - (value - 10) / 5 * 24) < 0.5;
  }, minutes);
}
async function setOrigin(page, iata) {
  const opener = (await page.locator("#flight-stage").isVisible()) ? "#flight-origin" : "#home-change-origin";
  await page.locator(opener).click();
  await page.locator("#origin").fill(iata);
  await page.locator("#origin").press("Enter");
  await page.locator("#origin-confirm").waitFor({ state: "visible" });
  assert.equal(await page.locator("#origin-confirm-code").innerText(), iata);
  await page.locator("#origin-apply").click();
  await page.locator("#origin-sheet").waitFor({ state: "hidden" });
}
async function beginPlanning(page) {
  await page.locator("#start-preflight").click();
  await page.locator("#flight-stage").waitFor({ state: "visible" });
}
async function chooseFirstFlight(page) {
  const first = page.locator("#flight-carousel .flight-card").first();
  await first.waitFor({ state: "visible" });
  const iata = await first.getAttribute("data-iata");
  await first.click();
  assert.equal(await first.getAttribute("aria-selected"), "true");
  return iata;
}
async function completePreflight(page, { originIata, duration = 30, taskIndex = 1 } = {}) {
  await page.locator("#home-stage").waitFor({ state: "visible" });
  if (originIata) await setOrigin(page, originIata);
  await beginPlanning(page);
  await setDuration(page, duration);
  const destinationIata = await chooseFirstFlight(page);
  assert.equal((await state(page)).activeFlight, null, "flight selection is draft only");
  await page.locator("#choose-flight").click();
  await page.locator("#seat-stage").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-seat]").count(), 88);
  assert.equal(await page.locator("#focus-picker").isVisible(), false);
  await page.locator("[data-seat]").first().click();
  await page.locator("#focus-picker").waitFor({ state: "visible" });
  await page.locator("[data-task]").nth(taskIndex).click();
  await page.locator("#confirm-seat").waitFor({ state: "visible" });
  await page.locator("#confirm-seat").click();
  await page.locator("#boarding-stage").waitFor({ state: "visible" });
  assert.equal((await state(page)).activeFlight, null, "boarding pass is draft only");
  assert.equal(await page.locator("#boarding-seat").innerText(), "01A");
  assert.match(await page.locator("#boarding-time").innerText(), /^\d{2}:\d{2}$/);
  assert.match(await page.locator("#boarding-date").innerText(), /^\d{4}\.\d{2}\.\d{2}$/);
  assert.ok(await page.locator("#boarding-qr").evaluate(el => el.width > 0 && el.height > 0));
  assert.ok(await page.locator("#boarding-barcode").evaluate(el => el.width > 0 && el.height > 0));
  await page.locator("#next-step").click();
  await page.locator("#checkin-stage").waitFor({ state: "visible" });
  assert.equal((await state(page)).activeFlight, null, "check-in is draft only");
  await page.locator("#checkin-stub").waitFor({ state: "visible" });
  await page.locator("#checkin-stub").press("Enter");
  await page.locator("#checkin-continue").waitFor({ state: "visible" });
  await page.locator("#checkin-continue").click();
  await page.locator("#airplane-stage").waitFor({ state: "visible" });
  assert.equal((await state(page)).activeFlight, null, "airplane mode is draft only");
  await page.locator("#boarding-action").click();
  await page.locator("#ready-stage").waitFor({ state: "visible" });
  assert.equal((await state(page)).activeFlight, null, "ready state must not start the clock");
  await page.locator("#go-takeoff").click();
  await page.locator("#flight").waitFor({ state: "visible" });
  return destinationIata;
}

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
  const errors = [], tiles = [], workers = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGE ERROR:", e.message); });
  page.on("response", (r) => {
    if (/\/\d+\/\d+\/\d+\.(pbf|mvt)/.test(r.url()) && r.ok()) tiles.push(r.url());
  });
  page.on("worker", (w) => workers.push(w.url()));
  if (!desktop) await page.goto(process.env.HANGKE_PREVIEW_URL || "http://127.0.0.1:4173"); else await page.reload();
  await page.locator("#planner").waitFor();
  await page.evaluate(() => localStorage.removeItem("hangke.v1"));
  await page.reload();
  await page.locator("#home-stage").waitFor({ state: "visible" });
  assert.equal(await page.locator("#flight-stage").isVisible(), false);
  assert.equal((await state(page)).activeFlight, null);
  await setOrigin(page, "CGQ");
  assert.match(await page.locator("#home-origin-code").innerText(), /CGQ/);
  await beginPlanning(page);

  const candidateDistances = async () => {
    const labels = await page.locator("#flight-carousel .flight-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") || ""));
    return labels.map((text) => Number(text.match(/([\d,]+) km/)?.[1].replaceAll(",", "")));
  };
  await setDuration(page, 10);
  assert.equal(await page.locator("#duration").getAttribute("aria-valuemin"), "10");
  await setDuration(page, 30);
  let distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 375) < 110, JSON.stringify(distances));
  const first30 = distances[0];
  await setDuration(page, 60);
  distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 750) < 100, JSON.stringify(distances));
  assert.ok(!(await page.locator("#flight-carousel").innerText()).includes("HND"), "CGQ + 60 min must not offer HND");
  const first60 = distances[0];
  await setDuration(page, 120);
  distances = await candidateDistances();
  assert.ok(Math.abs(distances[0] - 1500) < 100, JSON.stringify(distances));
  const first120 = distances[0];
  assert.ok(first30 < first60 && first60 < first120);

  // Return home, then run the complete progressive flow with a legal 30 minute flight.
  await page.locator("#flight-back").click();
  const selectedIata = await completePreflight(page, { duration: 30, taskIndex: 1 });
  const active = (await state(page)).activeFlight;
  assert.equal(active.destinationIata, selectedIata);
  assert.equal(active.durationSeconds, 1800);
  assert.equal(active.task, "\u4ee3\u7801");
  await page.waitForFunction(() => document.querySelectorAll(".maplibregl-ctrl-attrib a").length >= 2);
  await pause(2000);
  await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-flight.png` });

  await page.reload();
  await page.locator("#flight").waitFor({ state: "visible" });
  assert.equal((await state(page)).activeFlight.id, active.id);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("hangke.v1"));
    s.activeFlight.startedAt = Date.now() - 900000;
    s.activeFlight.endsAt = s.activeFlight.startedAt + 1800000;
    localStorage.setItem("hangke.v1", JSON.stringify(s));
  });
  await page.reload();
  await page.locator("#timer").filter({ hasText: /1[45]:/ }).waitFor();
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("hangke.v1"));
    s.activeFlight.startedAt = Date.now() - 1800100;
    s.activeFlight.endsAt = s.activeFlight.startedAt + 1800000;
    localStorage.setItem("hangke.v1", JSON.stringify(s));
  });
  await page.reload();
  await page.locator("#landing").waitFor({ state: "visible" });
  let saved = await state(page);
  assert.equal(saved.flights.length, 1);
  assert.equal(saved.lastAirportIata, selectedIata);
  assert.equal(saved.activeFlight, null);
  await page.locator("#done").click();
  await page.locator("#home-stage").waitFor({ state: "visible" });
  assert.equal(await page.locator("#home-origin-code").innerText(), selectedIata);
  await page.reload();
  assert.equal(await page.locator("#home-origin-code").innerText(), selectedIata);

  await page.locator("#history-toggle").click();
  await page.locator(".history-item").click();
  assert.match(await page.locator("#details").innerText(), /\u4ee3\u7801/);
  await page.locator("#history-toggle").click();

  // A second draft can start and cancel without adding history.
  await completePreflight(page, { duration: 30, taskIndex: 2 });
  const cancelBox = await page.locator("#cancel").boundingBox();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
  await page.mouse.down(); await pause(350); await page.mouse.up();
  assert.equal(await page.locator("#flight").isVisible(), true);
  await page.mouse.down(); await pause(1300); await page.mouse.up();
  saved = await state(page);
  assert.equal(saved.flights.length, 1);
  assert.equal(saved.lastAirportIata, selectedIata);
  assert.equal(saved.activeFlight, null);
  await page.locator("#home-stage").waitFor({ state: "visible" });

  if (!desktop) await page.setViewportSize({ width: 900, height: 600 });
  await pause(1000);
  await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-resize.png` });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(tiles.length > 0, "Production vector tile response required");
  assert.ok(workers.some((w) => w.includes("maplibre-gl-worker")), "Bundled worker required");
  console.log(JSON.stringify({
    desktop,
    checks: "home/planning/ruler/carousel/seat-focus/boarding/checkin/airplane/ready/GO/reload/landing/history/cancel/resize",
    tileResponses: tiles.length,
    workers: [...new Set(workers)],
    errors,
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
