import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { distance } from '../src/geo.ts';

// Bundle the actual module and JSON in memory, without touching the shared Vite dev cache.
let api;
before(async () => {
  const [result] = await build({
    configFile: false,
    logLevel: 'error',
    build: { write: false, minify: false, lib: { entry: 'src/airports.ts', formats: ['es'] } },
  });
  const entry = result.output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(entry, 'airport module must build an entry chunk');
  api = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`);
});
test('canonical airports have unique identifiers and usable coordinates', () => {
  const { airports, airport, coordinates } = api;
  assert.ok(airports.length > 0);
  assert.equal(new Set(airports.map(a => a.iata)).size, airports.length);
  for (const a of airports) {
    assert.match(a.iata, /^[A-Z]{3}$/);
    for (const field of ['ident', 'name', 'country']) assert.ok(a[field].trim(), `${a.iata}: ${field}`);
    assert.ok(Number.isFinite(a.latitude) && Math.abs(a.latitude) <= 90, a.iata);
    assert.ok(Number.isFinite(a.longitude) && Math.abs(a.longitude) <= 180, a.iata);
    assert.deepEqual(coordinates(a), [a.longitude, a.latitude]);
    assert.equal(airport(a.iata), a);
  }
  assert.equal(airport(null), undefined);
  assert.equal(airport('not-an-airport'), undefined);
  assert.equal(airport('hnd'), undefined);
});

test('focus minutes convert to kilometres at current supported duration boundaries', () => {
  for (const [minutes, km] of [[10,125], [30,375], [60,750], [180,2250]])
    assert.equal(api.focusDistanceKm(minutes), km);
  for (let minutes = 15; minutes <= 180; minutes += 5)
    assert.equal(api.focusDistanceKm(minutes) - api.focusDistanceKm(minutes - 5), 62.5);
});

test('airport search handles empty, exact IATA, ICAO and canonical city queries', () => {
  assert.deepEqual(api.search('  '), []);
  assert.deepEqual(api.search('no-such-airport-123'), []);
  assert.equal(api.search(' hNd ')[0].iata, 'HND');
  assert.equal(api.search(api.airport('HND').ident)[0].iata, 'HND');
  assert.ok(api.search('Tokyo').some(a => a.iata === 'HND'));
  const matches = api.search('a');
  assert.equal(matches.length, 8);
  assert.equal(new Set(matches.map(a => a.iata)).size, matches.length);
  assert.deepEqual(api.search('a'), matches);
});

test('reachable routes obey the distance band, ranking and six-candidate cap for every supported duration', () => {
  const snapshot = JSON.stringify(api.airports);
  for (const iata of ['CGQ', 'HND', 'SFO', 'LHR', 'SYD']) {
    const origin = api.airport(iata);
    assert.ok(origin, iata);
    for (let minutes = 10; minutes <= 180; minutes += 5) {
      const target = minutes * 12.5;
      const tolerance = Math.max(200, target * .3);
      const all = api.airports.filter(a => a.iata !== iata).map(a => ({
        airport: a, distanceKm: distance(api.coordinates(origin), api.coordinates(a)),
      }));
      const eligible = all.filter(x => x.distanceKm >= target - tolerance && x.distanceKm <= target + tolerance);
      const selected = api.reachable(origin, minutes);
      assert.equal(selected.length, Math.min(6, eligible.length), `${iata}/${minutes}`);
      const ids = new Set(selected.map(x => x.airport.iata));
      assert.equal(ids.size, selected.length);
      assert.ok(!ids.has(iata));
      for (let index = 0; index < selected.length; index++) {
        const x = selected[index];
        assert.ok(eligible.some(y => y.airport.iata === x.airport.iata));
        assert.equal(x.distanceKm, all.find(y => y.airport.iata === x.airport.iata).distanceKm);
        const error = Math.abs(x.distanceKm - target);
        for (const omitted of eligible.filter(y => !ids.has(y.airport.iata)))
          assert.ok(error <= Math.abs(omitted.distanceKm - target));
        if (index) {
          const previous = selected[index - 1];
          const previousError = Math.abs(previous.distanceKm - target);
          assert.ok(previousError <= error);
          if (previousError === error) assert.ok(previous.airport.iata.localeCompare(x.airport.iata) <= 0);
        }
      }
    }
  }
  assert.equal(JSON.stringify(api.airports), snapshot);
});
