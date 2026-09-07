// Verify real Tauri/WebView2 lifecycle persistence with an isolated executable and profile.
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const repo = path.resolve(__dirname, "..");
const exe = path.resolve(process.argv[2] || path.join(repo, "src-tauri/target/release/hangke.exe"));
const runtimeRoot = path.resolve(process.argv[3] || path.join(repo, "work/windows-lifecycle-runtime"));
const profile = path.join(runtimeRoot, "webview-profile");
const port = Number(process.argv[4] || 9347);
const key = "hangke.v1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let connection;
let gracefulCloseCount = 0;
let forcedCloseCount = 0;

function readState(page) {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
}

function writeState(page, state) {
  return page.evaluate(
    ([storageKey, value]) => localStorage.setItem(storageKey, JSON.stringify(value)),
    [key, state],
  );
}

async function launch() {
  child = spawn(exe, [], {
    cwd: repo,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const pages = connection.contexts().flatMap((context) => context.pages());
      const page = pages.find((candidate) => candidate.url() !== "about:blank");
      if (page) {
        page.setDefaultTimeout(15000);
        await page.locator("#app").waitFor({ state: "attached" });
        await page.locator("#pause-flight").waitFor({ state: "attached" });
        return page;
      }
      await connection.close();
      connection = undefined;
    } catch {
      if (connection) {
        await connection.close().catch(() => {});
        connection = undefined;
      }
    }
    await wait(250);
  }
  throw new Error(`Windows WebView did not start on CDP port ${port}`);
}

async function waitForLanding(page) {
  await page.waitForFunction(
    (storageKey) => {
      const state = JSON.parse(localStorage.getItem(storageKey));
      return state?.activeFlight === null && state?.flights?.length === 1;
    },
    key,
    { timeout: 15000 },
  );
}

async function closeApp() {
  const process = child;
  child = undefined;
  if (connection) {
    await connection.close().catch(() => {});
    connection = undefined;
  }
  if (!process) return;
  if (process.exitCode === null) {
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HangkeLifecycleClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'; $h=(Get-Process -Id ${process.pid}).MainWindowHandle; if ($h -ne [IntPtr]::Zero) { [HangkeLifecycleClose]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) }`,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    await Promise.race([
      new Promise((resolve) => process.once("exit", resolve)),
      wait(3000),
    ]);
    if (process.exitCode !== null) gracefulCloseCount += 1;
  }
  if (process.exitCode === null) {
    forcedCloseCount += 1;
    process.kill();
    spawnSync("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await wait(1000);
  }
}

async function cleanupProfile() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      return;
    } catch (error) {
      if (attempt === 7) {
        console.error(`Unable to remove isolated WebView2 profile: ${error.message}`);
        return;
      }
      await wait(500);
    }
  }
}

async function main() {
  if (!fs.existsSync(exe)) throw new Error(`Missing Windows executable: ${exe}`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });

  const firstNow = Date.now();
  const flight = {
    id: "windows-lifecycle-flight",
    originIata: "HND",
    destinationIata: "SFO",
    task: "Windows 生命周期验收",
    durationSeconds: 600,
    startedAt: firstNow - 300000,
    endsAt: firstNow + 300000,
    distanceKm: 8300,
    pausedAt: null,
  };
  const initial = {
    activeFlight: flight,
    flights: [],
    lastAirportIata: "CGQ",
  };
  const observations = [];

  let page = await launch();
  await writeState(page, initial);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await page.locator("#flight").waitFor({ state: "visible" });
  assert.deepEqual(await readState(page), initial);
  observations.push("启动并恢复飞行中状态");
  await closeApp();

  page = await launch();
  await page.locator("#flight").waitFor({ state: "visible" });
  assert.deepEqual(await readState(page), initial);
  observations.push("关闭后重启保留飞行中状态");

  await page.locator("#pause-flight").click();
  const paused = await readState(page);
  assert.ok(Number.isFinite(paused.activeFlight.pausedAt));
  assert.ok(paused.activeFlight.pausedAt >= paused.activeFlight.startedAt);
  assert.ok(paused.activeFlight.pausedAt < paused.activeFlight.endsAt);
  assert.equal(await page.locator("#pause-flight").getAttribute("aria-label"), "继续飞行");
  await closeApp();

  page = await launch();
  await page.locator("#flight").waitFor({ state: "visible" });
  assert.deepEqual(await readState(page), paused);
  assert.equal(await page.locator("#pause-flight").getAttribute("aria-label"), "继续飞行");
  observations.push("暂停后关闭重启保留暂停状态");

  await page.locator("#pause-flight").click();
  const resumed = await readState(page);
  assert.equal(resumed.activeFlight.pausedAt, null);
  const closingNow = Date.now();
  const closingFlight = {
    ...resumed.activeFlight,
    startedAt: closingNow - resumed.activeFlight.durationSeconds * 1000,
    endsAt: closingNow + 2500,
    pausedAt: null,
  };
  await writeState(page, { ...resumed, activeFlight: closingFlight });
  await closeApp();
  await wait(3500);

  page = await launch();
  await waitForLanding(page);
  const landed = await readState(page);
  assert.equal(landed.activeFlight, null);
  assert.equal(landed.flights.length, 1);
  assert.equal(landed.flights[0].id, closingFlight.id);
  assert.equal(landed.flights[0].completedAt, closingFlight.endsAt);
  assert.equal(landed.lastAirportIata, "SFO");
  observations.push("关闭期间跨过截止时间后，重启完成一次降落");
  await closeApp();

  page = await launch();
  const restarted = await readState(page);
  assert.deepEqual(restarted, landed);
  assert.equal(restarted.flights.length, 1);
  assert.equal(restarted.activeFlight, null);
  observations.push("完成后关闭重启不重复写入历史");
  await closeApp();

  const result = {
    executable: exe,
    profile: profile,
    cdpPort: port,
    realProcessRestart: true,
    gracefulCloseCount,
    forcedCloseCount,
    observations,
    historyCountAfterRestart: restarted.flights.length,
    completedAt: restarted.flights[0].completedAt,
  };
  fs.writeFileSync(path.join(runtimeRoot, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error.stack || error);
    await closeApp();
    process.exitCode = 1;
  })
  .finally(cleanupProfile);
