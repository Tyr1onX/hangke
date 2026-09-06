// Uses only an isolated WebView profile; never attaches to the installed app.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const baseline = process.argv.includes('--baseline');
const directory = resolve('artifacts/motion');
const executable = resolve(baseline ? 'artifacts/motion/hangke-before.exe' : 'src-tauri/target/release/hangke.exe');
let child, connection;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function setDuration(page, minutes) {
  await page.locator(`#duration-track [data-minutes="${minutes}"]`).evaluate(element => element.click());
  await page.waitForFunction(value => document.querySelector('#duration')?.getAttribute('aria-valuenow') === String(value) && document.querySelector('#duration')?.dataset.motion === 'idle', minutes);
  await pause(140);
}
function installProbe() {
  if (window.__motionProbe) return;
  const pending = new Set();
  window.__motionProbe = {frames:0,maxPending:0,lastDraw:0,cancels:0,pending:0};
  const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    // Identify only the application flight callback, excluding MapLibre's own frames.
    const visual = callback.toString().includes('.endsAt');
    let id = raf(time => {
      if (visual) {
        pending.delete(id);
        Object.assign(window.__motionProbe,{frames:window.__motionProbe.frames+1,pending:pending.size,lastDraw:Date.now()});
      }
      callback(time);
    });
    if (visual) {
      pending.add(id);
      window.__motionProbe.pending=pending.size;
      window.__motionProbe.maxPending=Math.max(window.__motionProbe.maxPending,pending.size);
    }
    return id;
  };
  window.cancelAnimationFrame = id => {
    if (pending.delete(id)) { window.__motionProbe.cancels++; window.__motionProbe.pending=pending.size; }
    cancel(id);
  };
}
async function launch() {
  child = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9235',
    WEBVIEW2_USER_DATA_FOLDER: resolve(directory, baseline ? 'before-profile' : 'after-profile'),
  } });
  for (let i = 0; i < 40; i++) {
    try {
      connection = await chromium.connectOverCDP('http://127.0.0.1:9235');
      const page = connection.contexts()[0].pages()[0];
      if (page) {
        await page.locator('#origin').waitFor({state:'attached'});
        await page.context().addInitScript(installProbe);
        await page.evaluate(installProbe);
        return page;
      }
    } catch {}
    await pause(250);
  }
  throw new Error('Test WebView did not start');
}
async function stop() {
  if (connection) { await connection.close(); connection = undefined; }
  if (child) { child.kill(); child = undefined; }
  await pause(1000);
}
async function sample(page, milliseconds) {
  return page.evaluate(ms => new Promise(resolve => {
    const started = performance.now();
    const first = {...window.__motionProbe};
    setTimeout(() => {
      const second = {...window.__motionProbe};
      const elapsed = performance.now() - started;
      const frames = second.frames - first.frames;
      resolve({
        elapsed,
        frames,
        updatesPerSecond: frames / (elapsed / 1000),
        maxPending: second.maxPending,
        pending: second.pending,
        cancels: second.cancels,
      });
    }, ms);
  }), milliseconds);
}
async function createFlight(page) {
  await page.locator('#home-stage').waitFor({state:'visible'});
  await page.locator('#home-change-origin').click();
  await page.locator('#origin').fill('HND'); await page.locator('#origin').press('Enter'); await page.locator('#origin-confirm').waitFor({state:'visible'}); await page.locator('#origin-apply').click();
  await page.locator('#start-preflight').click();
  await page.locator('#flight-stage').waitFor({state:'visible'});
  await setDuration(page, 30);
  await page.locator('#flight-carousel .flight-card').first().click();
  await page.locator('#choose-flight').click();
  await page.locator('#seat-stage').waitFor({state:'visible'});
  await page.locator('[data-seat]').first().click();
  await page.locator('#focus-picker').waitFor({state:'visible'});
  await page.locator('[data-task]').nth(1).click();
  await page.locator('#confirm-seat').click();
  await page.locator('#boarding-stage').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1'))?.activeFlight ?? null),null);
  await page.locator('#next-step').click();
  await page.locator('#checkin-stub').press('Enter');
  await page.locator('#airplane-stage').waitFor({state:'visible'});
  await page.locator('#boarding-action').click();
  await page.locator('#ready-stage').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1'))?.activeFlight ?? null),null);
  await page.locator('#go-takeoff').click();
  await page.locator('.plane').waitFor();
  await page.locator('#route-view').click();
  await pause(2500);
}
function windowState(command) {
  const result = spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HangkeMotionTest { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'; $h=(Get-Process -Id ${child.pid}).MainWindowHandle; [HangkeMotionTest]::ShowWindow($h,${command}) | Out-Null; [HangkeMotionTest]::IsIconic($h)`],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}
async function pose(page) {
  return page.evaluate(()=>{
    const f=JSON.parse(localStorage.getItem('hangke.v1'))?.activeFlight ?? null;
    const now=Date.now();
    return {
      progress:f ? Math.max(0,Math.min(1,(now-f.startedAt)/(f.endsAt-f.startedAt))) : null,
      now,
      probe:{...window.__motionProbe},
    };
  });
}
async function assertStopped(page) {
  const first=await page.evaluate(()=>({...window.__motionProbe}));
  await pause(600);
  const second=await page.evaluate(()=>({...window.__motionProbe}));
  assert.equal(second.pending,0);
  assert.equal(second.frames,first.frames,'No visual callbacks after leaving flight');
  assert.equal(await page.locator('.plane').count(),0);
  assert.equal(second.maxPending,1,'Only one flight animation loop');
  return second;
}
(async () => {
  fs.mkdirSync(directory,{recursive:true});
  let page = await launch();
  await page.evaluate(()=>localStorage.removeItem('hangke.v1')); await page.reload();
  await createFlight(page);
  const result = await sample(page, baseline ? 6000 : 30000);
  fs.writeFileSync(resolve(directory,baseline ? 'before.json':'after.json'),JSON.stringify(result,null,2));
  console.log(result);
  assert.ok(result.updatesPerSecond > 20, 'Flight visuals must run on display frames, not 250ms ticks');
  assert.equal(result.maxPending,1,'Only one flight animation loop');
  const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1'))?.activeFlight ?? null);
  const before=await pose(page);
  assert.equal(windowState(6),'True','Test window must actually be minimized');
  await pause(10000);
  assert.equal(windowState(9),'False','Test window must be restored');
  await page.waitForFunction(()=>window.__motionProbe.lastDraw > Date.now()-100);
  const after=await pose(page);
  const progressed=after.progress-before.progress;
  const expected=(after.now-before.now)/(initial.endsAt-initial.startedAt);
  assert.ok(Math.abs(progressed-expected)<0.002,'Restore must catch up to elapsed wall time');
  result.minimize={elapsed:after.now-before.now,progressed,expectedApprox:expected};
  result.resumed=await sample(page,3000);
  assert.ok(result.resumed.updatesPerSecond > 20);
  await stop(); page=await launch();
  await page.locator('.plane').waitFor();await page.locator('#route-view').click();await pause(2500);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1'))?.activeFlight ?? null),initial);
  result.reopened=await sample(page,3000);
  assert.ok(result.reopened.updatesPerSecond > 20);
  const cancelBox=await page.locator('#cancel').boundingBox();
  await page.mouse.move(cancelBox.x+cancelBox.width/2,cancelBox.y+cancelBox.height/2);
  await page.mouse.down();await pause(300);await page.mouse.up();
  assert.equal(await page.locator('#flight').isVisible(),true);
  await page.evaluate(()=>{for(let i=0;i<10;i++)window.dispatchEvent(new Event('focus'));});
  assert.equal((await pose(page)).probe.maxPending,1);
  await page.mouse.down();await pause(1300);await page.mouse.up();
  result.cancel=await assertStopped(page);
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,0);assert.equal(state.lastAirportIata,null);
  await createFlight(page);
  // Preserve legal duration, accelerate only the disposable fixture to observe real landing.
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('hangke.v1'));s.activeFlight.startedAt=Date.now()-1796000;s.activeFlight.endsAt=s.activeFlight.startedAt+1800000;localStorage.setItem('hangke.v1',JSON.stringify(s));});
  await page.reload();await page.locator('#landing').waitFor({state:'visible'});
  result.landing=await assertStopped(page);
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,1);assert.equal(state.lastAirportIata,initial.destinationIata);assert.equal(state.activeFlight,null);
  await stop(); page=await launch();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,1);assert.equal(state.activeFlight,null);
  await page.locator('#history-toggle').click();await page.locator('.history-item').click();
  assert.match(await page.locator("#details").innerText(), /\u4ee3\u7801/);
  fs.writeFileSync(resolve(directory,'after.json'),JSON.stringify(result,null,2));
  console.log('Lifecycle PASS',result);
  await stop();
})().catch(async error => {console.error(error);await stop();process.exit(1);});
