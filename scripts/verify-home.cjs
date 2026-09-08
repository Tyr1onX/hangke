// Disposable data only: desktop callers must supply an isolated WebView profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const desktop=!!process.env.HANGKE_CDP;
 const browser=desktop?await chromium.connectOverCDP(process.env.HANGKE_CDP):await chromium.launch({channel:'msedge',headless:true});
 const dir=process.env.HANGKE_SHOTS||'work/screens-v2/browser';fs.mkdirSync(dir,{recursive:true});
 try{
  const context=desktop?browser.contexts()[0]:await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const page=desktop?context.pages()[0]:await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!desktop)await page.goto(process.env.HANGKE_PREVIEW_URL||'http://127.0.0.1:1420',{waitUntil:'domcontentloaded'});
  await page.locator('#home-overview').waitFor({state:'attached'});
  const original=await page.evaluate(()=>localStorage.getItem('hangke.v1'));
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hangke.v1')));
  const load=async state=>{await page.evaluate(s=>localStorage.setItem('hangke.v1',JSON.stringify(s)),state);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#home-overview').waitFor({state:'attached'});};
  const vis=selector=>page.locator(selector).waitFor({state:'visible'});
  const shot=async name=>{await pause(250);await page.screenshot({path:path.join(dir,`${name}.png`)});};
  const open=async name=>{await page.locator(`[data-home-page="${name}"]`).click();await vis(name==='mine'?'#history':'#home-detail');};
  const back=async()=>{await page.locator('#home-detail-back').click();};
  try{
   await load({activeFlight:null,flights:[],lastAirportIata:'HND'});await vis('#home-overview');
   assert.equal(await page.locator('[data-home-page="progress"]').isVisible(),false);
   assert.equal(await page.locator('[data-home-page]:visible').count(),3);
   await open('world');assert.match(await page.locator('.achievement-copy').innerText(),/0.00/);
   await page.locator('#world-airports-toggle').click();assert.match(await page.locator('#home-world-airports').innerText(),/完成/);await shot('world-empty');
   await page.locator('#world-roam').click();await vis('#roam-airport');assert.equal(await page.locator('#roam-airport option').count(),1);await back();assert.equal(await page.locator('#home-detail-title').innerText(),'世界');await back();
   await open('trends');assert.equal(await page.locator('.scene-chart circle').count(),1);assert.equal(await page.locator('.flight-calendar .flown').count(),0);await shot('trends-empty');await back();
   await open('mine');assert.match(await page.locator('#history-list').innerText(),/还没有/);await shot('mine-empty');await page.locator('#history-back').click();
   // Actual preflight -> home navigation must clear the retained map padding.
   await page.locator('#start-preflight').click();await vis('#flight-stage');assert.equal((await read()).activeFlight,null);await page.locator('#flight-back').click();await vis('#home-overview');await pause(600);
   const radar=await page.locator('#home-radar').evaluate(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:innerWidth,h:innerHeight}));
   assert.ok(Math.abs(radar.x-radar.w/2)<4&&Math.abs(radar.y-radar.h/2)<4,JSON.stringify(radar));
   const now=Date.now();const flights=[['HND','SYO','学习',60,5,340],['SYO','HND','写作',45,4,340],['HND','CGQ','学习',90,2,1524],['CGQ','HND','工作',60,1,1524]].map(([a,b,task,m,d,km],i)=>({id:`qa-${i}`,originIata:a,destinationIata:b,task,durationSeconds:m*60,distanceKm:km,startedAt:now-d*86400000-m*60000,completedAt:now-d*86400000}));
   await load({activeFlight:null,flights,lastAirportIata:'HND'});await vis('#home-overview');await pause(3000);await shot('home');
   await open('world');assert.match(await page.locator('.achievement-copy').innerText(),/3,728/);await shot('world');await page.locator('#world-airports-toggle').click();assert.equal(await page.locator('.home-world-airport').count(),3);await page.locator('.home-world-airport summary').first().click();assert.match(await page.locator('.home-world-airport').first().innerText(),/抵达/);await shot('airports');await page.locator('.home-world-airport button').first().click();await vis('#roam-airport-info');assert.match(await page.locator('#roam-airport-info').innerText(),/HND/);
   await page.locator('[data-roam="all"]').click();await pause(600);await shot('roam');
   for(const action of ['left','right','in','out'])await page.locator(`[data-roam="${action}"]`).click();
   const canvas=page.locator('.maplibregl-canvas');const box=await canvas.boundingBox();await page.mouse.move(box.width*.65,box.height*.65);await page.mouse.down();await page.mouse.move(box.width*.8,box.height*.6,{steps:8});await page.mouse.up();await page.mouse.wheel(0,-200);await pause(250);
   await page.locator('#roam-airport').selectOption('CGQ');assert.match(await page.locator('#roam-airport-info').innerText(),/CGQ/);await back();await back();assert.deepEqual((await read()).flights,flights);
   await open('trends');for(const period of ['year','month','week','day','total']){await page.locator(`[data-period="${period}"]`).click();assert.equal(await page.locator(`[data-period="${period}"]`).getAttribute('aria-pressed'),'true');}
   assert.equal(await page.locator('.trend-scenes li').count(),3);assert.match(await page.locator('#home-trend-metrics').innerText(),/4 小时 15/);await shot('trends');await page.locator('.trend-scenes').scrollIntoViewIfNeeded();await shot('scenes');await back();
   await open('mine');assert.equal(await page.locator('.history-item').count(),4);await page.locator('.history-item').first().click();await vis('#details');await shot('mine');await page.locator('#history-back').click();
   const active={id:'qa-active',originIata:'HND',destinationIata:'CGQ',task:'学习',durationSeconds:3600,startedAt:now-600000,endsAt:now+3000000,distanceKm:1524,pausedAt:now};
   await load({activeFlight:active,flights,lastAirportIata:'HND'});await vis('#flight');await page.locator('#flight-home').click();await vis('#home-overview');assert.equal(await page.locator('[data-home-page="progress"]').isVisible(),true);await open('progress');await vis('#home-active-route');await shot('progress');const time=await page.locator('#home-active-time').innerText();await pause(1100);assert.equal(await page.locator('#home-active-time').innerText(),time);await page.locator('#home-resume').click();await vis('#flight');assert.deepEqual((await read()).activeFlight,active);
   await page.locator('#flight-home').click();await open('world');await page.locator('#world-roam').click();await page.locator('[data-roam="left"]').click();await back();await back();await page.locator('#start-preflight').click();await vis('#flight');assert.deepEqual((await read()).activeFlight,active);
   // Completion while in roaming must leave no stale home overlay or roaming controls.
   const ending={...active,pausedAt:null,startedAt:Date.now()-3596000,endsAt:Date.now()+4000};await load({activeFlight:ending,flights,lastAirportIata:'HND'});await vis('#flight');await page.locator('#flight-home').click();await open('world');await page.locator('#world-roam').click();await vis('#landing');assert.equal(await page.locator('#roam-airport').isVisible(),false);await page.locator('#done').click();await vis('#home-overview');assert.equal(await page.locator('[data-home-page="progress"]').isVisible(),false);assert.equal((await read()).flights.length,5);
   if(!desktop){await page.setViewportSize({width:900,height:600});for(const name of ['world','trends','mine']){await open(name);const panel=page.locator(name==='mine'?'#history':'#home-detail');const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=900&&bounds.y+bounds.height<=600);assert.equal(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth),true);await shot(`${name}-narrow`);if(name==='mine')await page.locator('#history-back').click();else await back();}}
   assert.deepEqual(errors,[]);
   const result={desktop,homeVisibility:true,emptyAndPopulated:true,worldCards:true,airportDetails:true,roamingAndReturn:true,allTrendPeriods:true,sceneTotals:true,historyPreserved:true,pausedRecovery:true,landingWhileRoaming:true,paddingAfterPreflight:radar,errors};
   fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await page.evaluate(value=>value===null?localStorage.removeItem('hangke.v1'):localStorage.setItem('hangke.v1',value),original);await page.reload({waitUntil:'domcontentloaded'});}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
