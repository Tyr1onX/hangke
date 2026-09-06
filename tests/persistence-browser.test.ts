import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build, normalizePath } from 'vite';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Starts the real application in disposable browser contexts. No planner or map assertions.
let server;
let browser;
let url;
const now = 1800000000000;
const flight = { id: 'browser-regression', originIata: 'HND', destinationIata: 'SFO', task: '核心验收', durationSeconds: 600, startedAt: now - 300000, endsAt: now + 300000, distanceKm: 8300, pausedAt: null };
const initial = () => ({ activeFlight: { ...flight }, flights: [], lastAirportIata: 'CGQ' });
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('hangke.v1')));
async function open(t, state = initial()) {
  const context = await browser.newContext();
  t.after(() => context.close());
  // External tiles are irrelevant to persistence and must not make these tests network-dependent.
  await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "application must not throw uncaught errors"));
  await page.clock.setFixedTime(now);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.evaluate(state => localStorage.setItem('hangke.v1', JSON.stringify(state)), state);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
  await page.locator('#pause-flight').waitFor({ state: 'attached' });
  return page;
}
async function tick(page, at) {
  await page.clock.setFixedTime(at);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function holdCancel(page) {
  await page.locator('#cancel').dispatchEvent('keydown', { key: 'Enter', repeat: false });
  await page.waitForTimeout(1300);
  await page.locator('#cancel').dispatchEvent('keyup', { key: 'Enter' });
}
before(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    plugins: [{ name: 'core-test-map-boundary', enforce: 'pre', load(id) {
      if (normalizePath(id).endsWith('/src/map.ts'))
        return "export class FlightMap { constructor() { throw new Error('Renderer excluded from core acceptance'); } }";
    } }],
    build: { write: false, minify: false },
  });
  const assets = new Map(result.output.map(item => [ '/' + item.fileName, item.type === 'asset' ? item.source : item.code ]));
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const content = assets.get(path === '/' ? '/index.html' : path);
    if (content === undefined) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
test('application pause, reload and resume persist the same flight and effective time', async t => {
  const page = await open(t);
  assert.equal(await page.locator('#timer').textContent(), '05:00');
  await page.locator('#pause-flight').evaluate(button => button.click());
  const paused = await read(page);
  assert.equal(paused.activeFlight.pausedAt, now);
  await tick(page, now + 3600000);
  assert.equal(await page.locator('#timer').textContent(), '05:00');
  assert.deepEqual(await read(page), paused);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#timer').textContent(), '05:00');
  await page.locator('#pause-flight').evaluate(button => button.click());
  const resumed = await read(page);
  assert.deepEqual(resumed.activeFlight, { ...flight, endsAt: flight.endsAt + 3600000 });
  await tick(page, resumed.activeFlight.endsAt - 1);
  assert.equal(await page.locator('#timer').textContent(), '00:01');
  assert.equal((await read(page)).flights.length, 0);
  await tick(page, resumed.activeFlight.endsAt);
  const landed = await read(page);
  assert.equal(landed.activeFlight, null);
  assert.equal(landed.lastAirportIata, 'SFO');
  assert.equal(landed.flights.length, 1);
  assert.equal(landed.flights[0].completedAt, resumed.activeFlight.endsAt);
  assert.equal(landed.flights[0].startedAt, flight.startedAt);
  assert.equal('pausedAt' in landed.flights[0], false);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
  await tick(page, resumed.activeFlight.endsAt + 600000);
  assert.deepEqual(await read(page), landed);
});

test('startup after sleep finalizes an expired flight once and retains previous history', async t => {
  const old = { id: 'previous', originIata: 'CGQ', destinationIata: 'HND', task: '先前航程', durationSeconds: 600, startedAt: now - 2000000, completedAt: now - 1400000, distanceKm: 1600 };
  const state = { ...initial(), flights: [old], activeFlight: { ...flight, startedAt: now - 900000, endsAt: now - 300000 } };
  const page = await open(t, state);
  const landed = await read(page);
  assert.equal(landed.activeFlight, null);
  assert.equal(landed.flights.length, 2);
  assert.deepEqual(landed.flights[0], old);
  assert.equal(landed.flights[1].completedAt, now - 300000);
  for (let index = 0; index < 2; index++) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
    await tick(page, now + index * 1000);
    assert.deepEqual(await read(page), landed);
  }
});

test('failed pause write preserves running state and allows retry', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'hangke.v1') throw new DOMException('test quota failure', 'QuotaExceededError');
      return window.originalStorageWrite.call(this, key, value);
    };
  });
  await page.locator('#pause-flight').evaluate(button => button.click());
  assert.deepEqual(await read(page), initial());
  assert.match(await page.locator('#notice').textContent(), /无法保存/);
  await tick(page, now + 60000);
  assert.equal(await page.locator('#timer').textContent(), '04:00');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; delete window.originalStorageWrite; });
  await page.locator('#pause-flight').evaluate(button => button.click());
  assert.equal((await read(page)).activeFlight.pausedAt, now + 60000);
});

test('failed completion write retains active flight and retry writes exactly one history record', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('test quota failure', 'QuotaExceededError'); };
  });
  await tick(page, flight.endsAt);
  assert.deepEqual(await read(page), initial());
  assert.match(await page.locator('#notice').textContent(), /无法保存/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; delete window.originalStorageWrite; });
  await tick(page, flight.endsAt + 1000);
  const landed = await read(page);
  assert.equal(landed.activeFlight, null);
  assert.equal(landed.flights.length, 1);
  assert.equal(landed.flights[0].completedAt, flight.endsAt);
  await tick(page, flight.endsAt + 2000);
  assert.deepEqual(await read(page), landed);
});

test('storage read failure falls back safely and recovers on the next launch', async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'read failure must be handled without an uncaught error'));
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (this === localStorage && key === 'hangke.v1' && sessionStorage.getItem('hangke.read.fail.once') === null) {
        sessionStorage.setItem('hangke.read.fail.once', '1');
        throw new DOMException('test storage read failure', 'SecurityError');
      }
      return original.call(this, key);
    };
  });
  await page.clock.setFixedTime(now);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#planner').waitFor({ state: 'visible' });
  assert.match(await page.locator('#notice').textContent(), /无法读取本地航程/);
  assert.equal(await page.locator('#flight').isVisible(), false);

  await page.evaluate(state => localStorage.setItem('hangke.v1', JSON.stringify(state)), initial());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#flight').isVisible(), true);
  assert.deepEqual(await read(page), initial());
});

test('failed resume write keeps the paused state and retry resumes once', async t => {
  const paused = { ...initial(), activeFlight: { ...flight, pausedAt: now } };
  const page = await open(t, paused);
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'hangke.v1') throw new DOMException('test quota failure', 'QuotaExceededError');
      return window.originalStorageWrite.call(this, key, value);
    };
  });
  await page.locator('#pause-flight').evaluate(button => button.click());
  assert.deepEqual(await read(page), paused);
  assert.equal(await page.locator('#pause-flight').getAttribute('aria-label'), '继续飞行');
  assert.match(await page.locator('#notice').textContent(), /无法保存/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; delete window.originalStorageWrite; });
  await page.locator('#pause-flight').evaluate(button => button.click());
  const resumed = await read(page);
  assert.equal(resumed.activeFlight.pausedAt, null);
  assert.equal(resumed.activeFlight.endsAt, paused.activeFlight.endsAt);
});

test('failed cancel write keeps the active flight and retry cancels without touching history', async t => {
  const page = await open(t);
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('test quota failure', 'QuotaExceededError'); };
  });
  await holdCancel(page);
  assert.deepEqual(await read(page), initial());
  assert.match(await page.locator('#notice').textContent(), /无法保存/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageWrite; delete window.originalStorageWrite; });
  await holdCancel(page);
  const cancelled = await read(page);
  assert.equal(cancelled.activeFlight, null);
  assert.deepEqual(cancelled.flights, []);
  assert.equal(cancelled.lastAirportIata, 'CGQ');
});








test('application cancellation requires a hold and preserves previous history after reload', async t => {
  const old = { id: 'previous', originIata: 'CGQ', destinationIata: 'HND', task: '先前航程', durationSeconds: 600, startedAt: now - 2000000, completedAt: now - 1400000, distanceKm: 1600 };
  const state = { ...initial(), flights: [old] };
  const page = await open(t, state);
  await page.locator('#cancel').evaluate(button => button.click());
  assert.deepEqual(await read(page), state);
  await page.locator('#cancel').dispatchEvent('keydown', { key: 'Enter', repeat: false });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('hangke.v1')).activeFlight === null);
  await page.locator('#cancel').dispatchEvent('keyup', { key: 'Enter' });
  const cancelled = { ...state, activeFlight: null };
  assert.deepEqual(await read(page), cancelled);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#timer').waitFor({ state: 'attached' });
  assert.deepEqual(await read(page), cancelled);
});
