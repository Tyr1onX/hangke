// Check Windows release metadata and artifact provenance without installing anything.
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const tauriConfigPath = path.join(repo, "src-tauri", "tauri.conf.json");
const packageJsonPath = path.join(repo, "package.json");
const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageVersion = packageJson.version;
const version = config.version;
const productName = config.productName;
const expectedInstallerName = `${productName}_${version}_x64-setup.exe`;
const installer = path.resolve(
  process.argv[2] || path.join(repo, "src-tauri", "target", "release", "bundle", "nsis", expectedInstallerName),
);
const executable = path.resolve(
  process.argv[3] || path.join(repo, "src-tauri", "target", "release", "hangke.exe"),
);
const frontendDist = path.resolve(
  process.argv[4] || path.join(repo, "src-tauri", config.build.frontendDist),
);
const reportPath = path.resolve(
  process.argv[5] || path.join(repo, "artifacts", "windows-release-verification.json"),
);

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function peMachine(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null;
  const header = buffer.readUInt32LE(0x3c);
  if (header + 6 > buffer.length || buffer.toString("ascii", header, header + 4) !== "PE\0\0") return null;
  return `0x${buffer.readUInt16LE(header + 4).toString(16).padStart(4, "0")}`;
}

function windowsVersion(file) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $item=Get-Item -LiteralPath $env:HANGKE_RELEASE_FILE; [pscustomobject]@{ProductVersion=$item.VersionInfo.ProductVersion;FileVersion=$item.VersionInfo.FileVersion;Length=$item.Length} | ConvertTo-Json -Compress",
    ],
    {
      cwd: repo,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, HANGKE_RELEASE_FILE: file },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function cargoPackageVersion() {
  const cargo = fs.readFileSync(path.join(repo, "src-tauri", "Cargo.toml"), "utf8");
  const match = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  return match?.[1] || null;
}

function fileRecord(file) {
  if (!fs.existsSync(file)) return { path: file, exists: false };
  const stats = fs.statSync(file);
  return {
    path: file,
    exists: true,
    length: stats.size,
    sha256: sha256(file),
    peMachine: peMachine(file),
    version: windowsVersion(file),
  };
}

function check(name, actual, expected) {
  return { name, pass: actual === expected, actual, expected };
}

function checkPredicate(name, actual, predicate, expected) {
  return { name, pass: predicate(actual), actual, expected };
}

function main() {
  const statusText = git(["status", "--porcelain"]);
  const dirtyPaths = statusText ? statusText.split(/\r?\n/).filter(Boolean) : [];
  const targets = Array.isArray(config.bundle?.targets)
    ? config.bundle.targets
    : [config.bundle?.targets].filter(Boolean);
  const installerRecord = fileRecord(installer);
  const executableRecord = fileRecord(executable);
  const iconPath = path.join(repo, "src-tauri", "icons", "icon.ico");
  const frontendIndex = path.join(frontendDist, "index.html");
  const frontendAssets = fs.existsSync(path.join(frontendDist, "assets"))
    ? fs.readdirSync(path.join(frontendDist, "assets"))
    : [];
  const checks = [
    check("package version matches Tauri version", packageVersion, version),
    check("Cargo package version matches Tauri version", cargoPackageVersion(), version),
    check("bundle contains NSIS target", targets.includes("nsis"), true),
    check("installer filename matches product and version", path.basename(installer), expectedInstallerName),
    check("installer exists", installerRecord.exists, true),
    check("executable exists", executableRecord.exists, true),
    check("installer version matches config", installerRecord.version?.ProductVersion, version),
    check("executable version matches config", executableRecord.version?.ProductVersion, version),
    checkPredicate(
      "installer architecture is a supported NSIS stub",
      installerRecord.peMachine,
      (machine) => machine === "0x014c" || machine === "0x8664",
      ["0x014c", "0x8664"],
    ),
    check("executable architecture is x64", executableRecord.peMachine, "0x8664"),
    check("configured icon exists", fs.existsSync(iconPath), true),
    check("frontend index exists", fs.existsSync(frontendIndex), true),
    check("frontend includes MapLibre worker asset", frontendAssets.some((name) => name.includes("maplibre-gl-worker")), true),
  ];
  const allChecksPass = checks.every((item) => item.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      branch: git(["branch", "--show-current"]),
      commit: git(["rev-parse", "HEAD"]),
      commitDate: git(["show", "-s", "--format=%cI", "HEAD"]),
      clean: dirtyPaths.length === 0,
      dirtyPaths,
    },
    config: {
      productName,
      version,
      identifier: config.identifier,
      bundleTargets: targets,
      frontendDist: config.build.frontendDist,
    },
    artifact: {
      installer: installerRecord,
      executable: executableRecord,
      frontendDist,
      frontendIndex,
      frontendAssets,
      icon: fileRecord(iconPath),
    },
    checks,
    artifactChecksPass: allChecksPass,
    formalReleaseEligible: allChecksPass && dirtyPaths.length === 0,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!allChecksPass) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
