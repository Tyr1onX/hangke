const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const jsQR = require("jsqr");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem("hangke.v1")) || { activeFlight: null, flights: [], lastAirportIata: null });
const position = page => page.locator("#duration").evaluate(el => ({ left: el.scrollLeft, motion: el.dataset.motion, value: Number(el.getAttribute("aria-valuenow")), transform: el.firstElementChild.style.transform }));
async function setDuration(page, value) {
  await page.locator(`#duration-track [data-minutes="${value}"]`).evaluate(el => el.click());
  await page.waitForFunction(value => {
    const el = document.querySelector("#duration");
    return el.dataset.motion === "idle" && el.getAttribute("aria-valuenow") === String(value) && Math.abs(el.scrollLeft - (value - 10) / 5 * 24) < .5;
  }, value, { timeout: 10000 });
}
async function origin(page, code) {
  await page.locator("#home-change-origin").click();
  await page.locator("#origin").fill(code);
  await page.locator("#origin").press("Enter");
  await page.locator("#origin-confirm").waitFor({ state: "visible" });
  assert.equal(await page.locator("#origin-cancel").innerText(), "\u53d6\u6d88");
  assert.equal(await page.locator("#origin-apply").innerText(), "\u786e\u8ba4");
  await page.locator("#origin-apply").click();
}
async function decodeQR(page, id) {
  const image = await page.locator(id).evaluate(canvas => {
    const { width, height } = canvas;
    return { width, height, data: Array.from(canvas.getContext("2d").getImageData(0, 0, width, height).data) };
  });
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  assert.ok(result, `${id} must decode as a standard QR code`);
  return result.data;
}
async function run() {
  fs.mkdirSync("artifacts", { recursive: true });
  const desktop = !!process.env.HANGKE_CDP;
  const browser = desktop ? await chromium.connectOverCDP(process.env.HANGKE_CDP) : await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = desktop ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = desktop ? context.pages()[0] : await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (!desktop) await page.goto(process.env.HANGKE_PREVIEW_URL || "http://127.0.0.1:4173"); else await page.reload();
    await page.evaluate(() => localStorage.removeItem("hangke.v1"));
    await page.reload();
    await origin(page, "CGQ");
    await page.locator("#start-preflight").click();
    await page.locator("#flight-stage").waitFor({ state: "visible" });
    await setDuration(page, 60);
    const original = await position(page);
    assert.equal(original.left, 240);
    const ruler = await page.locator("#duration").boundingBox();
    await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    await page.mouse.wheel(0, 160);
    const samples = [];
    for (let i = 0; i < 8; i++) { await pause(30); samples.push((await position(page)).left); }
    assert.ok(new Set(samples.map(x => Math.round(x))).size >= 4, `wheel must animate continuously: ${samples}`);
    await page.waitForFunction(() => document.querySelector("#duration").dataset.motion === "idle", null, { timeout: 10000 });
    const wheeled = await position(page);
    assert.ok(wheeled.left > original.left, "wheel must move the scale");
    assert.equal(wheeled.value % 5, 0);
    await setDuration(page, 60);
    await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    await page.mouse.down();
    await page.mouse.move(ruler.x + ruler.width / 2 - 110, ruler.y + ruler.height / 2, { steps: 8 });
    const released = (await position(page)).left;
    await page.mouse.up();
    await pause(160);
    const coast = (await position(page)).left;
    assert.ok(coast > released + 1, `release must preserve drag velocity: ${released} -> ${coast}`);
    await page.waitForFunction(() => document.querySelector("#duration").dataset.motion === "idle", null, { timeout: 10000 });
    await setDuration(page, 10);
    await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    await page.mouse.down();
    await page.mouse.move(ruler.x + ruler.width / 2 + 260, ruler.y + ruler.height / 2, { steps: 8 });
    const elastic = await position(page);
    assert.ok(elastic.transform !== "translate3d(0px,0,0)" && elastic.transform !== "translate3d(0,0,0)", "edge must visually stretch");
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#duration").dataset.motion === "idle", null, { timeout: 10000 });
    assert.equal((await position(page)).left, 0);
    await setDuration(page, 180);
    assert.equal((await position(page)).left, 816);
    await setDuration(page, 60);
    const first = page.locator("#flight-carousel .flight-card").first();
    await first.click();
    const selectedIata = await first.getAttribute("data-iata");
    await pause(550);
    assert.equal(await page.locator("#flight-carousel .flight-card[aria-selected=true]").count(), 1, "settling must not clear a selected destination");
    assert.equal(await page.locator("#draft-destination-code").innerText(), selectedIata);
    const cities = await page.locator(".flight-card-city").allInnerTexts();
    assert.ok(cities.every(text => /[\u3400-\u9fff]/u.test(text) && !/[A-Za-z\ufffd]/u.test(text)), JSON.stringify(cities));
    await page.locator("#choose-flight").click();
    await page.locator("#seat-stage").waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-seat]").count(), 88);
    const cabin = page.locator(".seat-cabin");
    const bounds = await cabin.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    assert.ok(bounds.scroll > bounds.client + 400, JSON.stringify(bounds));
    await page.locator('[data-seat="22F"]').click();
    assert.ok(await cabin.evaluate(el => el.scrollTop > 0), "rear rows must be reachable by scrolling");
    await page.locator("#focus-picker").waitFor({ state: "visible" });
    await page.locator('[data-task-key="code"]').click();
    assert.equal(await page.locator('[data-seat="22F"]').getAttribute("data-focus-key"), "code");
    await page.setViewportSize({ width: 900, height: 600 }).catch(() => {});
    await page.locator("#confirm-seat").click();
    await page.locator("#boarding-stage").waitFor({ state: "visible" });
    assert.equal((await state(page)).activeFlight, null);
    assert.equal(await page.locator("#boarding-seat").innerText(), "22F");
    const boardingTime = await page.locator("#boarding-time").innerText();
    const boardingDate = await page.locator("#boarding-date").innerText();
    assert.match(boardingTime, /^\d{2}:\d{2}$/);
    assert.match(boardingDate, /^\d{4}\.\d{2}\.\d{2}$/);
    const qr1 = await decodeQR(page, "#boarding-qr");
    assert.ok(qr1.startsWith("HANGKE|1|CGQ|"));
    assert.ok(qr1.includes("|22F|60|"));
    assert.ok(await page.locator("#boarding-barcode").evaluate(el => el.width > 100 && el.height > 20));
    await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-boarding-pass.png` });
    await page.locator("#next-step").click();
    await page.locator("#checkin-stage").waitFor({ state: "visible" });
    assert.equal(await decodeQR(page, "#checkin-qr"), qr1);
    assert.equal(await page.locator("#checkin-time").innerText(), boardingTime);
    assert.equal(await page.locator("#checkin-date").innerText(), boardingDate);
    assert.equal((await state(page)).activeFlight, null);
    const stub = page.locator("#checkin-stub");
    const handle = page.locator("#checkin-tear-handle");
    const ticket = page.locator("#checkin-ticket");
    assert.equal(await stub.getAttribute("aria-orientation"), "horizontal");
    const appearance = await ticket.evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      map: getComputedStyle(el.querySelector(".ticket-world-map")).backgroundImage,
      hint: getComputedStyle(el.querySelector(".tear-handle svg")).animationName,
    }));
    assert.equal(appearance.background, "rgb(36, 41, 44)");
    assert.ok(appearance.map.includes("ticket-world"));
    assert.equal(appearance.hint, "ticket-tear-hint");
    const box = await stub.boundingBox();
    assert.ok(box.width > 300 && box.height > 90, JSON.stringify(box));
    const start = await handle.boundingBox();
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 65, y, { steps: 6 });
    const partial = await ticket.evaluate(el => Number(el.style.getPropertyValue("--tear-progress")));
    assert.ok(partial > 0 && partial < .85, `partial horizontal tear: ${partial}`);
    await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-tear.png` });
    await page.mouse.up();
    await page.waitForFunction(() => Number(document.querySelector("#checkin-ticket").style.getPropertyValue("--tear-progress")) === 0);
    assert.equal((await state(page)).activeFlight, null);
    const retry = await handle.boundingBox();
    const x2 = retry.x + retry.width / 2, y2 = retry.y + retry.height / 2;
    await page.mouse.move(x2, y2); await page.mouse.down();
    await page.mouse.move(x2 - 80, y2, { steps: 6 }); await page.mouse.up();
    assert.equal(await ticket.evaluate(el => Number(el.style.getPropertyValue("--tear-progress"))), 0);
    const seam = await ticket.locator(".boarding-tear-line").boundingBox();
    const again = await handle.boundingBox();
    const x3 = again.x + again.width / 2, y3 = again.y + again.height / 2;
    await page.mouse.move(x3, y3); await page.mouse.down();
    await page.mouse.move(seam.x + seam.width - 20, y3, { steps: 18 }); await page.mouse.up();
    await page.locator("#airplane-stage").waitFor({ state: "visible" });
    await page.locator("#boarding-action").click();
    await page.locator("#ready-stage").waitFor({ state: "visible" });
    assert.equal(await page.locator("#ready-title").innerText(), "\u98de\u884c\u5373\u5c06\u5f00\u59cb");
    assert.equal(await page.locator("#go-takeoff").innerText(), "\u51fa\u53d1\uff01");
    assert.equal((await state(page)).activeFlight, null);
    await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-ready.png` });
    await page.locator("#go-takeoff").click();
    const active = (await state(page)).activeFlight;
    assert.equal(active.durationSeconds, 3600);
    assert.equal(active.destinationIata, selectedIata);
    assert.equal(active.task, "\u4ee3\u7801");
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(JSON.stringify({ desktop, checks: "wheel-inertia/drag-inertia/edge-elastic/snap/selection-stability/88-seats/rear-scroll/focus/QR-decode/Code128/horizontal-tear-reset/horizontal-tear-complete/ready/GO", sampleCount: new Set(samples.map(x => Math.round(x))).size, decodedQR: true, errors }, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
