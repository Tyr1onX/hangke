// Isolated end-to-end checks against the actual release executable.
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const exe = path.resolve("src-tauri/target/release/hangke.exe");
const profile = path.resolve("artifacts/windows-restart-profile");
let child;
let connection;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function setDuration(page, minutes) {
  await page.locator(`#duration-track [data-minutes="${minutes}"]`).evaluate((element) => element.click());
  await page.waitForFunction((value) => document.querySelector('#duration')?.getAttribute('aria-valuenow') === String(value) && document.querySelector('#duration')?.dataset.motion === 'idle', minutes);
  await pause(140);
}
async function createFlight(page) {
  await page.locator("#home-stage").waitFor({ state: "visible" });
  await page.locator("#home-change-origin").click();
  await page.locator("#origin").fill("HND");
  await page.locator("#origin").press("Enter");
  await page.locator("#origin-confirm").waitFor({ state: "visible" });
  await page.locator("#origin-apply").click();
  await page.locator("#start-preflight").click();
  await page.locator("#flight-stage").waitFor({ state: "visible" });
  await setDuration(page, 30);
  await page.locator("#flight-carousel .flight-card").first().click();
  await page.locator("#choose-flight").click();
  await page.locator("[data-seat]").first().click();
  await page.locator("#focus-picker").waitFor({ state: "visible" });
  await page.locator("[data-task]").first().click();
  await page.locator("#confirm-seat").click();
  await page.locator("#next-step").click();
  await page.locator("#checkin-stub").press("Enter");
  await page.locator("#airplane-stage").waitFor({ state: "visible" });
  await page.locator("#boarding-action").click();
  await page.locator("#ready-stage").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("hangke.v1"))?.activeFlight ?? null), null);
  await page.locator("#go-takeoff").click();
  await page.locator("#flight").waitFor({ state: "visible" });
}
async function launch() {
  child = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9224",
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9224");
      connection = browser;
      const page = browser.contexts()[0].pages()[0];
      if (page) {
        await page.locator("#origin").waitFor({ state: "attached" });
        return { browser, page };
      }
    } catch {}
    await pause(250);
  }
  throw new Error("Windows WebView did not start");
}
async function stop() {
  if (connection) await connection.close();
  child.kill();
  await pause(1500);
}
(async () => {
  fs.mkdirSync("artifacts", { recursive: true });
  let { page } = await launch();
  await page.evaluate(() => localStorage.removeItem("hangke.v1"));
  await page.reload();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "artifacts/windows-globe.png" });
  await createFlight(page);
  const initial = await page.evaluate(
    () => JSON.parse(localStorage.getItem("hangke.v1"))?.activeFlight ?? null,
  );
  await stop();
  ({ page } = await launch());
  await page.locator("#flight").waitFor({ state: "visible" });
  const restored = await page.evaluate(
    () => JSON.parse(localStorage.getItem("hangke.v1"))?.activeFlight ?? null,
  );
  assert.deepEqual(restored, initial);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "artifacts/windows-pacific.png" });
  // Simulate resuming from sleep with four seconds left, then observe a live timer landing.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("hangke.v1"));
    s.activeFlight.startedAt = Date.now() - 1796000;
    s.activeFlight.endsAt = s.activeFlight.startedAt + 1800000;
    localStorage.setItem("hangke.v1", JSON.stringify(s));
  });
  await page.reload();
  await page.locator("#landing").waitFor({ state: "visible" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "artifacts/windows-landing.png" });
  let state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hangke.v1")),
  );
  assert.equal(state.flights.length, 1);
  assert.equal(state.lastAirportIata, initial.destinationIata);
  await stop();
  ({ page } = await launch());
  state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hangke.v1")),
  );
  assert.equal(state.flights.length, 1);
  assert.equal(state.activeFlight, null);
  assert.match(await page.locator("#origin").inputValue(), new RegExp(`^${initial.destinationIata}`));
  await page.locator("#history-toggle").click();
  await page.locator(".history-item").click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "artifacts/windows-restarted-history.png" });
  await page.locator("#history-toggle").click();
  const resized = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HangkeWindowTest { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int z, uint f); }'; $handle=(Get-Process -Id ${child.pid}).MainWindowHandle; [HangkeWindowTest]::SetWindowPos($handle,[IntPtr]::Zero,0,0,1125,790,6)`], {windowsHide:true,encoding:"utf8"});
  assert.equal(resized.status,0,resized.stderr);
  await page.waitForTimeout(2000);
  const size = await page.evaluate(() => ({width:innerWidth,height:innerHeight,button:document.querySelector('#start-preflight').getBoundingClientRect().right}));
  assert.ok(size.width < 1280 && size.button <= size.width,JSON.stringify(size));
  await page.screenshot({path:"artifacts/windows-native-resize.png"});
  const result = {
    realProcessRestart: true,
    wallClockPreserved: true,
    liveTimerLanding: true,
    historyAfterRestart: 1,
    nativeResize: size,
  };
  fs.writeFileSync(
    "artifacts/windows-restart-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
  await stop();
})().catch(async (e) => {
  console.error(e);
  if (child) await stop();
  process.exit(1);
});
