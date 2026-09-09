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
    return el.dataset.motion === "idle" && el.getAttribute("aria-valuenow") === String(value) && Math.abs(el.scrollLeft - (value - 30) / 5 * 24) < .5;
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
async function assertTicketInBounds(page, stage) {
  await page.waitForFunction(stage => {
    const frame = document.querySelector(`#${stage}-ticket-frame`);
    return frame && frame.style.getPropertyValue("--ticket-scale");
  }, stage, { timeout: 2000 }).catch(async () => {
    console.log("TICKET FIT DIAGNOSTIC", await page.evaluate(stage => {
      const ids = ["planner", `${stage}-stage`, `${stage}-ticket-viewport`, `${stage}-ticket-frame`, `${stage}-ticket`];
      return ids.map(id => {
        const el = document.getElementById(id);
        return {id, exists:!!el, hidden:el?.hidden, width:el?.clientWidth, height:el?.clientHeight, style:el?.getAttribute("style"), rect:el?.getBoundingClientRect().toJSON()};
      });
    }, stage));
    throw new Error("Ticket fitter did not complete");
  });
  const result = await page.evaluate(stage => {
    const bounds = el => {
      const r = el.getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
    };
    const viewport = bounds(document.querySelector(`#${stage}-ticket-viewport`));
    const ticket = bounds(document.querySelector(`#${stage}-ticket`));
    const stub = bounds(document.querySelector(`#${stage}-ticket .boarding-ticket-stub`));
    const qr = bounds(document.querySelector(`#${stage}-qr`));
    return {viewport,ticket,stub,qr};
  }, stage);
  for (const key of ["ticket","stub","qr"]) {
    const r=result[key],v=result.viewport;
    assert.ok(r.left >= v.left-2 && r.right <= v.right+2 && r.top >= v.top-2 && r.bottom <= v.bottom+2,
      `${stage} ${key} clipped: ${JSON.stringify(result)}`);
  }
  assert.ok(result.ticket.height > 0 && result.ticket.width > 0);
  return result;
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
    assert.equal(original.left, 144);
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
    await setDuration(page, 30);
    await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    await page.mouse.down();
    await page.mouse.move(ruler.x + ruler.width / 2 + 260, ruler.y + ruler.height / 2, { steps: 8 });
    const elastic = await position(page);
    assert.ok(elastic.transform !== "translate3d(0px,0,0)" && elastic.transform !== "translate3d(0,0,0)", "edge must visually stretch");
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#duration").dataset.motion === "idle", null, { timeout: 10000 });
    assert.equal((await position(page)).left, 0);
    await setDuration(page, 180);
    assert.equal((await position(page)).left, 720);
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
    const bounds = await page.locator("#seat-content").evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    assert.ok(bounds.scroll > bounds.client + 400, JSON.stringify(bounds));
    assert.equal(await page.locator("#focus-picker").isVisible(), false);
    const cabinBefore = await cabin.boundingBox();
    await page.locator('[data-seat="22F"]').click();
    assert.ok(await page.locator("#seat-content").evaluate(el => el.scrollTop > 0), "rear rows must be reachable by scrolling");
    await page.locator("#focus-picker").waitFor({ state: "visible" });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-seat="22F"]')).backgroundColor === "rgb(64, 111, 155)");
    const pendingSeatColor = await page.locator('[data-seat="22F"]').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(pendingSeatColor, "rgb(64, 111, 155)", "pending seat must use blue, not aviation yellow");
    assert.equal(await page.locator("#focus-picker-close").innerText(), "\u00d7");
    assert.equal(await page.locator("#focus-picker-close").getAttribute("aria-label"), "\u5173\u95ed\u4e13\u6ce8\u7c7b\u578b\u9009\u62e9");
    assert.equal(await page.locator("#focus-picker").evaluate(el => el.matches(":modal")), true);
    const cabinAfter = await cabin.boundingBox();
    assert.ok(Math.abs(cabinBefore.x - cabinAfter.x) < 1, "selecting a seat must not shift the cabin into a side column");
    await page.keyboard.press("Escape");
    await page.locator("#focus-picker").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#confirm-seat").isVisible(), false);
    await page.locator('[data-seat="22F"]').click();
    await page.locator("#focus-picker").waitFor({ state: "visible" });
    await page.locator('[data-task-key="code"]').click();
    await page.locator("#focus-picker").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#confirm-seat").isVisible(), true);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-seat="22F"]')).backgroundColor === "rgb(109, 88, 152)");
    const confirmedSeatColor = await page.locator('[data-seat="22F"]').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(confirmedSeatColor, "rgb(109, 88, 152)", "confirmed seat must keep its activity color");
    assert.equal((await state(page)).activeFlight, null);
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
    await page.waitForFunction(() => !document.querySelector("#planner").dataset.motion, null, { timeout: 6000 });
    await assertTicketInBounds(page, "boarding");
    if (!desktop) {
      for (const size of [{width:1111,height:754},{width:720,height:480},{width:900,height:600}]) {
        await page.setViewportSize(size);
        await pause(60);
        await assertTicketInBounds(page, "boarding");
      }
    }
    const paperSignature = prefix => page.evaluate(prefix => {
      const ticket=document.getElementById(`${prefix}-ticket`),main=ticket.querySelector(".boarding-ticket-main"),route=ticket.querySelector(".boarding-route strong"),details=ticket.querySelector(".boarding-details");
      return {width:ticket.offsetWidth,height:ticket.offsetHeight,background:getComputedStyle(ticket).backgroundColor,main:getComputedStyle(main).backgroundImage,routeFont:getComputedStyle(route).fontSize,detailsGrid:getComputedStyle(details).gridTemplateColumns,fields:["origin-code","origin-city","destination-code","destination-city","duration","seat","distance","time","date"].map(id=>document.getElementById(`${prefix}-${id}`).textContent)};
    },prefix);
    const issuedPaper=await paperSignature("boarding");
    await page.screenshot({ path: `artifacts/${desktop ? "windows" : "browser"}-boarding-pass.png` });
    await page.locator("#next-step").click();
    await page.locator("#checkin-stage").waitFor({ state: "visible" });
    assert.equal(await decodeQR(page, "#checkin-qr"), qr1);
    assert.equal(await page.locator("#checkin-time").innerText(), boardingTime);
    assert.equal(await page.locator("#checkin-date").innerText(), boardingDate);
    assert.equal((await state(page)).activeFlight, null);
    await assertTicketInBounds(page, "checkin");
    assert.deepEqual(await paperSignature("checkin"),issuedPaper,"issue and check-in must preserve paper dimensions, material and every field");
    const stub = page.locator("#checkin-stub");
    const handle = page.locator("#checkin-tear-handle");
    const ticket = page.locator("#checkin-ticket");
    assert.equal(await stub.getAttribute("aria-orientation"), "horizontal");
    const appearance = await ticket.evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      map: getComputedStyle(el.querySelector(".boarding-ticket-main")).backgroundImage,
      hint: getComputedStyle(el.querySelector(".tear-handle svg")).animationName,
    }));
    assert.equal(appearance.background, issuedPaper.background);
    assert.ok(appearance.map.includes("ticket-world"));
    assert.equal(appearance.hint, "ticket-tear-hint");
    const box = await stub.boundingBox();
    const paperScale=Number(await page.locator("#checkin-ticket-frame").evaluate(el=>el.style.getPropertyValue("--ticket-scale")));
    assert.ok(Math.abs(box.width-560*paperScale)<2 && Math.abs(box.height-88*paperScale)<2, JSON.stringify({box,paperScale}));
    const start = await handle.boundingBox();
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 65, y, { steps: 6 });
    const partial = await ticket.evaluate(el => Number(el.style.getPropertyValue("--tear-progress")));
    assert.ok(partial > 0 && partial < .85, `partial horizontal tear: ${partial}`);
    await assertTicketInBounds(page, "checkin");
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
    await page.waitForFunction(() => document.querySelector("#checkin-ticket").classList.contains("is-torn"));
    await pause(650);
    await assertTicketInBounds(page, "checkin");
    assert.equal((await state(page)).activeFlight, null);
    assert.equal(await page.locator("#checkin-stage").isVisible(), true);
    await page.locator("#airplane-stage").waitFor({ state: "visible" });
    await page.locator("#boarding-action").waitFor({ state: "visible" });
    await page.locator("#boarding-action").click();
    await page.locator("#ready-stage").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#planner").dataset.motion, null, { timeout: 5000 });
    await page.locator("#go-takeoff").waitFor({ state: "visible" });
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
