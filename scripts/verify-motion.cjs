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
    const plane = document.querySelector('.plane');
    const started = performance.now();
    let frames = 0, changed = 0, fractional = 0, remounts = 0, previous;
    const gaps = [], deltas = [], headings = [];
    let lastChange = started, firstPoint;
    const observer = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) if (n === plane) remounts++;
    });
    observer.observe(plane.parentElement,{childList:true});
    function frame() {
      const now = performance.now(); frames++;
      const transform = plane.style.transform;
      const match = transform.match(/translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/);
      const rotation = Number(transform.match(/rotateZ\(([-\d.e+]+)deg\)/)?.[1]);
      if (match) {
        const p = [Number(match[1]),Number(match[2])];
        firstPoint ??= p;
        if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) fractional++;
        if (previous && (p[0] !== previous[0] || p[1] !== previous[1])) {
          changed++; gaps.push(now-lastChange); lastChange=now;
          deltas.push(Math.hypot(p[0]-previous[0],p[1]-previous[1]));
        }
        previous=p;
        headings.push(rotation);
      }
      if (now-started < ms) requestAnimationFrame(frame);
      else {
        observer.disconnect(); gaps.sort((a,b)=>a-b);
        let maxHeadingStep=0;
        for(let i=1;i<headings.length;i++) maxHeadingStep=Math.max(maxHeadingStep,Math.abs(((headings[i]-headings[i-1]+540)%360)-180));
        resolve({elapsed:now-started,frames,changed,updatesPerSecond:changed/((now-started)/1000),fractional,remounts,medianGap:gaps[Math.floor(gaps.length/2)],p95Gap:gaps[Math.floor(gaps.length*.95)],maxPixelStep:Math.max(...deltas),maxHeadingStep,firstPoint,lastPoint:previous});
      }
    }
    requestAnimationFrame(frame);
  }),milliseconds);
}
async function createFlight(page) {
  await page.locator('#origin').fill('HND'); await page.locator('#origin').press('Enter');
  await page.locator('#destination').fill('SFO'); await page.locator('#destination').press('Enter');
  await page.locator('#task').fill('连续飞行验证'); await page.locator('#duration').selectOption('10');
  await page.locator('#takeoff').click(); await page.locator('.plane').waitFor();
  await pause(2500);
}
function windowState(command) {
  const result = spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HangkeMotionTest { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }'; $h=(Get-Process -Id ${child.pid}).MainWindowHandle; [HangkeMotionTest]::ShowWindow($h,${command}) | Out-Null; [HangkeMotionTest]::IsIconic($h)`],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}
async function pose(page) {
  return page.evaluate(()=>{
    const value=document.querySelector('.plane').style.transform.match(/translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/);
    return {point:[Number(value[1]),Number(value[2])],now:Date.now(),probe:{...window.__motionProbe}};
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
  assert.ok(result.updatesPerSecond > 20, 'Plane must move on display frames, not 250ms ticks');
  assert.ok(result.fractional > result.frames*.9, 'Slow motion must retain subpixel positions');
  assert.equal(result.remounts,0,'Existing Marker must remain mounted');
  assert.ok(result.maxHeadingStep < 1,'Heading must not jitter');
  const initial=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')).activeFlight);
  const before=await pose(page);
  assert.equal(windowState(6),'True','Test window must actually be minimized');
  await pause(10000);
  assert.equal(windowState(9),'False','Test window must be restored');
  await page.waitForFunction(()=>window.__motionProbe.lastDraw > Date.now()-100);
  const after=await pose(page);
  const speed=Math.hypot(result.lastPoint[0]-result.firstPoint[0],result.lastPoint[1]-result.firstPoint[1])/result.elapsed;
  const moved=Math.hypot(after.point[0]-before.point[0],after.point[1]-before.point[1]);
  assert.ok(moved > speed*(after.now-before.now)*.8 && moved < speed*(after.now-before.now)*1.2,'Restore must catch up to elapsed wall time');
  result.minimize={elapsed:after.now-before.now,moved,expectedApprox:speed*(after.now-before.now)};
  result.resumed=await sample(page,3000);
  assert.ok(result.resumed.updatesPerSecond > 20);
  await stop(); page=await launch();
  await page.locator('.plane').waitFor();await pause(2500);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')).activeFlight),initial);
  result.reopened=await sample(page,3000);
  assert.ok(result.reopened.updatesPerSecond > 20);
  await page.locator('#cancel').click();await page.locator('#continue').click();
  await page.evaluate(()=>{for(let i=0;i<10;i++)window.dispatchEvent(new Event('focus'));});
  assert.equal((await pose(page)).probe.maxPending,1);
  await page.locator('#cancel').click();await page.locator('#end').click();
  result.cancel=await assertStopped(page);
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,0);assert.equal(state.lastAirportIata,null);
  await createFlight(page);
  // Preserve legal duration, accelerate only the disposable fixture to observe real landing.
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('hangke.v1'));s.activeFlight.startedAt=Date.now()-596000;s.activeFlight.endsAt=s.activeFlight.startedAt+600000;localStorage.setItem('hangke.v1',JSON.stringify(s));});
  await page.reload();await page.locator('#landing').waitFor({state:'visible'});
  result.landing=await assertStopped(page);
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,1);assert.equal(state.lastAirportIata,'SFO');assert.equal(state.activeFlight,null);
  await stop(); page=await launch();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  assert.equal(state.flights.length,1);assert.equal(state.activeFlight,null);
  await page.locator('#history-toggle').click();await page.locator('.history-item').click();
  assert.match(await page.locator('#details').innerText(),/连续飞行验证/);
  fs.writeFileSync(resolve(directory,'after.json'),JSON.stringify(result,null,2));
  console.log('Lifecycle PASS',result);
  await stop();
})().catch(async error => {console.error(error);await stop();process.exit(1);});
