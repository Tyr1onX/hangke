// Verify the real Windows single-instance and window-restore behavior with an isolated executable.
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const repo = path.resolve(__dirname, "..");
const exe = path.resolve(
  process.argv[2] || path.join(repo, "work/windows-single-instance-build/target/release/hangke.exe"),
);
const runtimeRoot = path.resolve(
  process.argv[3] || path.join(repo, "work/windows-single-instance-runtime-20260907"),
);
const profile = path.join(runtimeRoot, "webview-data");
const port = Number(process.argv[4] || 9371);
const reportPath = path.join(repo, "artifacts", "windows-single-instance-verification.json");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let primary;
let connection;
let gracefulCloseCount = 0;
let forcedCloseCount = 0;

function assertOwnedRuntimeRoot() {
  const workRoot = path.join(repo, "work") + path.sep;
  const normalized = path.normalize(runtimeRoot);
  assert.ok(
    normalized.startsWith(workRoot) && path.basename(normalized).startsWith("windows-single-instance-runtime-"),
    `Refusing to remove a runtime root outside the isolated work directory: ${runtimeRoot}`,
  );
}

function runPowerShellJson(script, extraEnv = {}) {
  const utf8Script = `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n${script}`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", utf8Script],
    {
      cwd: repo,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PowerShell failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : null;
}

function ownedProcesses() {
  const items = runPowerShellJson(
    `
$exe = [System.IO.Path]::GetFullPath($env:HANGKE_SINGLE_INSTANCE_EXE)
$items = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -eq $exe } |
    Select-Object ProcessId,ExecutablePath,CommandLine
)
@($items) | ConvertTo-Json -Compress -Depth 6
`,
    { HANGKE_SINGLE_INSTANCE_EXE: exe },
  );
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function windowState(pid) {
  return runPowerShellJson(
    `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HangkeSingleInstanceWindow {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$p = Get-Process -Id ([int]$env:HANGKE_SINGLE_INSTANCE_PID) -ErrorAction SilentlyContinue
if (-not $p) {
  [pscustomobject]@{ Exists = $false } | ConvertTo-Json -Compress
  exit
}
$h = $p.MainWindowHandle
$foreground = [HangkeSingleInstanceWindow]::GetForegroundWindow()
[uint32]$foregroundPid = 0
if ($foreground -ne [IntPtr]::Zero) {
  [void][HangkeSingleInstanceWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
}
[pscustomobject]@{
  Exists = $true
  Pid = $p.Id
  HWnd = $h.ToInt64()
  Iconic = if ($h -ne [IntPtr]::Zero) { [HangkeSingleInstanceWindow]::IsIconic($h) } else { $false }
  ForegroundPid = [int]$foregroundPid
} | ConvertTo-Json -Compress
`,
    { HANGKE_SINGLE_INSTANCE_PID: String(pid) },
  );
}

function minimizeWindow(pid) {
  runPowerShellJson(
    `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HangkeSingleInstanceMinimize {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
$p = Get-Process -Id ([int]$env:HANGKE_SINGLE_INSTANCE_PID) -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { throw 'main window handle is empty' }
[void][HangkeSingleInstanceMinimize]::ShowWindow($h, 6)
[pscustomobject]@{ Pid = $p.Id; HWnd = $h.ToInt64() } | ConvertTo-Json -Compress
`,
    { HANGKE_SINGLE_INSTANCE_PID: String(pid) },
  );
}

function postClose(pid) {
  runPowerShellJson(
    `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HangkeSingleInstanceClose {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$p = Get-Process -Id ([int]$env:HANGKE_SINGLE_INSTANCE_PID) -ErrorAction SilentlyContinue
if ($p) {
  $h = $p.MainWindowHandle
  if ($h -ne [IntPtr]::Zero) { [void][HangkeSingleInstanceClose]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
}
[pscustomobject]@{ Pid = [int]$env:HANGKE_SINGLE_INSTANCE_PID } | ConvertTo-Json -Compress
`,
    { HANGKE_SINGLE_INSTANCE_PID: String(pid) },
  );
}

async function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  if (lastError) throw new Error(`${description}: ${lastError.message}`);
  throw new Error(description);
}

function spawnApp() {
  const child = spawn(exe, [], {
    cwd: repo,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: "ignore",
  });
  child.spawnError = undefined;
  child.once("error", (error) => {
    child.spawnError = error;
  });
  return child;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    wait(timeoutMs).then(() => false),
  ]);
}

async function connectToPage(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null) throw new Error(`primary process exited before WebView startup (${child.exitCode})`);
    try {
      connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const pages = connection.contexts().flatMap((context) => context.pages());
      const page = pages.find((candidate) => candidate.url() !== "about:blank");
      if (page) {
        page.setDefaultTimeout(15000);
        await page.locator("#app").waitFor({ state: "attached" });
        await page.locator("#app > *").first().waitFor({ state: "attached" });
        const resources = await page.evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          appChildren: document.querySelector("#app")?.children.length || 0,
          bodyTextLength: document.body?.innerText?.length || 0,
        }));
        assert.notEqual(resources.url, "about:blank");
        assert.equal(resources.readyState, "complete");
        assert.ok(resources.appChildren > 0);
        assert.ok(resources.bodyTextLength > 0);
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

async function launchPrimary() {
  assert.equal(ownedProcesses().length, 0, "an owned test process is already running before launch");
  primary = spawnApp();
  const page = await connectToPage(primary);
  await waitUntil(
    () => ownedProcesses().length === 1,
    5000,
    "primary launch did not leave exactly one executable process",
  );
  return page;
}

async function closePrimary() {
  const process = primary;
  if (connection) {
    await connection.close().catch(() => {});
    connection = undefined;
  }
  if (!process) return;
  if (process.exitCode === null) {
    postClose(process.pid);
    await waitForExit(process, 4000);
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
  await waitUntil(
    () => ownedProcesses().length === 0,
    5000,
    "owned executable process remained after close",
  );
  primary = undefined;
}

async function launchDuplicate() {
  const duplicate = spawnApp();
  const exited = await waitForExit(duplicate, 10000);
  if (!exited) {
    duplicate.kill();
    spawnSync("taskkill.exe", ["/PID", String(duplicate.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    throw new Error("duplicate launch remained alive instead of handing off to the primary instance");
  }
  assert.equal(duplicate.spawnError, undefined);
  await waitUntil(
    () => ownedProcesses().length === 1,
    5000,
    "duplicate launch did not leave exactly one executable process",
  );
  return { pid: duplicate.pid, exitCode: duplicate.exitCode, signal: duplicate.signalCode };
}

async function terminateAnyPrimary() {
  try {
    await closePrimary();
  } catch (error) {
    console.error(`Cleanup close failed: ${error.message}`);
    if (primary?.pid) {
      spawnSync("taskkill.exe", ["/PID", String(primary.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
  }
}

async function main() {
  assertOwnedRuntimeRoot();
  if (!fs.existsSync(exe)) throw new Error(`Missing Windows executable: ${exe}`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });

  const observations = [];
  const page = await launchPrimary();
  const firstPid = primary.pid;
  const initialWindow = await waitUntil(
    () => {
      const state = windowState(firstPid);
      return state.Exists && state.HWnd !== 0 ? state : false;
    },
    5000,
    "primary launch did not expose a native window",
  );
  assert.equal(ownedProcesses().length, 1);
  observations.push({
    step: "first launch",
    pid: firstPid,
    windowHandle: initialWindow.HWnd,
    resources: await page.evaluate(() => ({
      url: location.href,
      appChildren: document.querySelector("#app")?.children.length || 0,
    })),
  });

  const duplicateWhileVisible = await launchDuplicate();
  const focusedWindow = await waitUntil(
    () => {
      const state = windowState(firstPid);
      return state.Exists && !state.Iconic && state.ForegroundPid === firstPid ? state : false;
    },
    5000,
    "duplicate launch did not focus the visible primary window",
  );
  assert.equal(duplicateWhileVisible.signal, null);
  assert.equal(ownedProcesses().length, 1);
  assert.equal(connection.contexts().flatMap((context) => context.pages()).length, 1);
  observations.push({
    step: "duplicate launch while visible",
    primaryPid: firstPid,
    duplicatePid: duplicateWhileVisible.pid,
    duplicateExitCode: duplicateWhileVisible.exitCode,
    foregroundPid: focusedWindow.ForegroundPid,
    processCount: ownedProcesses().length,
  });

  minimizeWindow(firstPid);
  await waitUntil(() => windowState(firstPid).Iconic === true, 3000, "primary window did not minimize");
  const duplicateWhileMinimized = await launchDuplicate();
  const restoredWindow = await waitUntil(
    () => {
      const state = windowState(firstPid);
      return state.Exists && !state.Iconic && state.ForegroundPid === firstPid ? state : false;
    },
    5000,
    "duplicate launch did not restore and focus the minimized primary window",
  );
  assert.equal(duplicateWhileMinimized.signal, null);
  assert.equal(ownedProcesses().length, 1);
  observations.push({
    step: "duplicate launch while minimized",
    primaryPid: firstPid,
    duplicatePid: duplicateWhileMinimized.pid,
    duplicateExitCode: duplicateWhileMinimized.exitCode,
    iconic: restoredWindow.Iconic,
    foregroundPid: restoredWindow.ForegroundPid,
    processCount: ownedProcesses().length,
  });

  await closePrimary();
  const relaunchedPage = await launchPrimary();
  const relaunchedPid = primary.pid;
  assert.notEqual(relaunchedPid, firstPid);
  assert.ok(await relaunchedPage.locator("#home-stage").count());
  assert.equal(ownedProcesses().length, 1);
  observations.push({
    step: "normal close and relaunch",
    previousPid: firstPid,
    relaunchedPid,
    processCount: ownedProcesses().length,
  });
  await closePrimary();

  const result = {
    executable: exe,
    runtimeRoot,
    profile,
    cdpPort: port,
    isolatedProcessPath: exe,
    singleInstance: true,
    gracefulCloseCount,
    forcedCloseCount,
    observations,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error.stack || error);
    await terminateAnyPrimary();
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      assertOwnedRuntimeRoot();
      fs.rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
    } catch (error) {
      console.error(`Unable to remove isolated runtime root: ${error.message}`);
    }
  });
