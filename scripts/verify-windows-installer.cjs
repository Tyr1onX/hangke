// Verify an isolated Tauri NSIS install, launch, persistence, and uninstall flow.
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const repo = path.resolve(__dirname, "..");
const installer = path.resolve(
  process.argv[2] ||
    path.join(
      repo,
      "work/windows-installer-acceptance-20260907/target/release/bundle/nsis/航刻验收_0.1.0_x64-setup.exe",
    ),
);
const runtimeRoot = path.resolve(
  process.argv[3] || path.join(repo, "work/windows-installer-runtime-20260907"),
);
const installDir = path.join(runtimeRoot, "installed");
const profile = path.join(runtimeRoot, "webview-profile");
const dataDir = path.join(runtimeRoot, "webview-data");
const port = Number(process.argv[4] || 9361);
const storageKey = "hangke.v1";
const productName = process.env.HANGKE_ACCEPTANCE_PRODUCT_NAME || "航刻验收";
const identifier = process.env.HANGKE_ACCEPTANCE_IDENTIFIER || "com.tyr1onx.hangke.acceptance";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let child;
let connection;
let uninstalled = false;
let gracefulCloseCount = 0;
let forcedCloseCount = 0;

function assertIsOwnedRuntimeRoot() {
  const workRoot = path.join(repo, "work") + path.sep;
  const normalized = path.normalize(runtimeRoot);
  assert.ok(
    normalized.startsWith(workRoot) && path.basename(normalized).startsWith("windows-installer-runtime-"),
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

function inspectSystemSurface() {
  return runPowerShellJson(
    `
$name = $env:HANGKE_ACCEPTANCE_PRODUCT_NAME
$identifier = $env:HANGKE_ACCEPTANCE_IDENTIFIER
$install = $env:HANGKE_ACCEPTANCE_INSTALL_DIR
$uninstallRoots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$registry = @(
  foreach ($root in $uninstallRoots) {
    if (Test-Path -LiteralPath $root) {
      foreach ($key in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
        try {
          $value = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
          if (
            $value.DisplayName -eq $name -or
            $value.InstallLocation -eq $install -or
            $key.PSChildName -eq $identifier -or
            $value.UninstallString -like "*$identifier*"
          ) {
            [pscustomobject]@{
              Path = $key.PSPath
              DisplayName = $value.DisplayName
              DisplayVersion = $value.DisplayVersion
              InstallLocation = $value.InstallLocation
              UninstallString = $value.UninstallString
            }
          }
        } catch {}
      }
    }
  }
)
$shortcutRoots = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:PUBLIC 'Desktop'),
  (Join-Path $env:USERPROFILE 'Desktop')
)
$shortcuts = @(
  foreach ($root in $shortcutRoots) {
    if (Test-Path -LiteralPath $root) {
      Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*$name*.lnk" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    }
  }
)
$processes = @(Get-CimInstance Win32_Process -Filter "Name='hangke.exe'" -ErrorAction SilentlyContinue |
  Select-Object ProcessId,ExecutablePath,CommandLine)
[pscustomobject]@{
  Registry = @($registry)
  Shortcuts = @($shortcuts)
  HangkeProcesses = @($processes)
} | ConvertTo-Json -Compress -Depth 8
`,
    {
      HANGKE_ACCEPTANCE_PRODUCT_NAME: productName,
      HANGKE_ACCEPTANCE_IDENTIFIER: identifier,
      HANGKE_ACCEPTANCE_INSTALL_DIR: installDir,
    },
  );
}

function inspectProductionInstall() {
  return runPowerShellJson(`
$appDir = Join-Path $env:LOCALAPPDATA '航刻'
$shortcut = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\航刻.lnk'
$registry = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\com.tyr1onx.hangke',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\com.tyr1onx.hangke',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\com.tyr1onx.hangke'
) | Where-Object { Test-Path -LiteralPath $_ }
[pscustomobject]@{
  AppDirectory = $appDir
  AppDirectoryExists = Test-Path -LiteralPath $appDir
  Shortcut = $shortcut
  ShortcutExists = Test-Path -LiteralPath $shortcut
  RegistryKeys = @($registry)
} | ConvertTo-Json -Compress -Depth 8
`);
}

function fileVersion(file) {
  return runPowerShellJson(
    "$item = Get-Item -LiteralPath $env:HANGKE_FILE; [pscustomobject]@{ProductVersion=$item.VersionInfo.ProductVersion;FileVersion=$item.VersionInfo.FileVersion;Length=$item.Length} | ConvertTo-Json -Compress",
    { HANGKE_FILE: file },
  );
}

function readState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}

function writeState(page, state) {
  return page.evaluate(
    ([key, value]) => localStorage.setItem(key, JSON.stringify(value)),
    [storageKey, state],
  );
}

function webviewProcesses() {
  return runPowerShellJson(
    `
$needle = $env:HANGKE_DATA_DIR
$items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'msedgewebview2*' -and $_.CommandLine -and $_.CommandLine -like "*$needle*" } |
  Select-Object ProcessId,Name,CommandLine)
@($items) | ConvertTo-Json -Compress -Depth 8
`,
    { HANGKE_DATA_DIR: dataDir },
  );
}

async function launch(exe) {
  child = spawn(exe, [], {
    cwd: installDir,
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: dataDir,
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
          hasHomeStage: Boolean(document.querySelector("#home-stage")),
          bodyTextLength: document.body?.innerText?.length || 0,
        }));
        assert.notEqual(resources.url, "about:blank");
        assert.equal(resources.readyState, "complete");
        assert.ok(resources.appChildren > 0);
        assert.ok(resources.bodyTextLength > 0);
        return { page, resources };
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
  throw new Error(`Installed Windows app did not start on CDP port ${port}`);
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
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HangkeInstallerClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam); }'; $p=Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue; if ($p) { $h=$p.MainWindowHandle; if ($h -ne [IntPtr]::Zero) { [HangkeInstallerClose]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) } }`,
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

async function waitForWebviewExit() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const processes = webviewProcesses();
    if (!processes || (Array.isArray(processes) && processes.length === 0)) return;
    await wait(250);
  }
}

function install() {
  const result = spawnSync(installer, ["/S", `/D=${installDir}`], {
    cwd: repo,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `NSIS installer failed: ${result.stderr || result.stdout}`);
}

function uninstall(uninstaller) {
  const result = spawnSync(uninstaller, ["/S"], {
    cwd: installDir,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `NSIS uninstaller failed: ${result.stderr || result.stdout}`);
  uninstalled = true;
}

async function waitForUninstallSurface() {
  let current = inspectSystemSurface();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (current.Registry.length === 0 && current.Shortcuts.length === 0) return current;
    await wait(250);
    current = inspectSystemSurface();
  }
  return current;
}

async function main() {
  assertIsOwnedRuntimeRoot();
  assert.ok(fs.existsSync(installer), `Missing NSIS installer: ${installer}`);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const productionInstall = inspectProductionInstall();
  const before = inspectSystemSurface();
  assert.equal(before.Registry.length, 0, `Acceptance registry entry already exists: ${JSON.stringify(before.Registry)}`);
  assert.equal(before.Shortcuts.length, 0, `Acceptance shortcut already exists: ${JSON.stringify(before.Shortcuts)}`);
  assert.equal(before.HangkeProcesses.length, 0, "A hangke.exe process is already running; refusing to stop it");

  install();
  const installedExe = path.join(installDir, "hangke.exe");
  const uninstaller = path.join(installDir, "uninstall.exe");
  assert.ok(fs.existsSync(installedExe), `Installed executable missing: ${installedExe}`);
  assert.ok(fs.existsSync(uninstaller), `Uninstaller missing: ${uninstaller}`);
  const installedVersion = fileVersion(installedExe);
  const installedSurface = inspectSystemSurface();
  assert.ok(installedSurface.Shortcuts.length > 0, "NSIS install did not create an acceptance shortcut");

  const launchResult = await launch(installedExe);
  const firstPage = launchResult.page;
  assert.ok(fs.existsSync(dataDir), `WebView2 data directory was not created: ${dataDir}`);
  const firstWebviewProcesses = webviewProcesses();
  const now = Date.now();
  const history = {
    id: "windows-installer-history",
    originIata: "HND",
    destinationIata: "SFO",
    task: "Windows 安装验收",
    durationSeconds: 600,
    startedAt: now - 900000,
    endsAt: now - 300000,
    distanceKm: 8300,
    pausedAt: null,
    completedAt: now - 300000,
  };
  const expectedState = { activeFlight: null, flights: [history], lastAirportIata: "SFO" };
  await writeState(firstPage, expectedState);
  await firstPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  assert.deepEqual(await readState(firstPage), expectedState);
  await closeApp();

  const restarted = await launch(installedExe);
  assert.deepEqual(await readState(restarted.page), expectedState);
  const restartResources = restarted.resources;
  await closeApp();
  await waitForWebviewExit();

  const beforeUninstall = inspectSystemSurface();
  uninstall(uninstaller);
  const afterUninstall = await waitForUninstallSurface();
  const installFilesRemoved = !fs.existsSync(installedExe) && !fs.existsSync(uninstaller);
  const dataRetained = fs.existsSync(dataDir);
  assert.ok(installFilesRemoved, "NSIS uninstall left the installed executable or uninstaller");
  assert.equal(afterUninstall.Shortcuts.length, 0, `Acceptance shortcuts remain: ${JSON.stringify(afterUninstall.Shortcuts)}`);
  assert.equal(afterUninstall.Registry.length, 0, `Acceptance registry entries remain: ${JSON.stringify(afterUninstall.Registry)}`);

  const result = {
    installer,
    installerType: "Tauri 2 NSIS x64",
    productName,
    identifier,
    productionInstall,
    isolatedInstallDir: installDir,
    installedExecutable: installedExe,
    installedVersion,
    installedShortcutCount: installedSurface.Shortcuts.length,
    resourcesOnFirstLaunch: launchResult.resources,
    resourcesOnRestart: restartResources,
    webviewDataDir: dataDir,
    webviewDataDirExistsAfterUninstall: dataRetained,
    webviewProcessesOnFirstLaunch: firstWebviewProcesses,
    historyAfterRestart: expectedState.flights.length,
    historyIdsAfterRestart: expectedState.flights.map((flight) => flight.id),
    beforeUninstall,
    afterUninstall,
    installFilesRemoved,
    gracefulCloseCount,
    forcedCloseCount,
    update: { status: "unverified", reason: "没有可确认的不同版本旧安装包；当前可见旧包和本次包均为 0.1.0" },
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
  .finally(async () => {
    if (!uninstalled && fs.existsSync(path.join(installDir, "uninstall.exe"))) {
      try {
        await closeApp();
        uninstall(path.join(installDir, "uninstall.exe"));
      } catch {}
    }
  });
