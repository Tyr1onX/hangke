import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, decode, progress, pause, resume, finalize, cancel } from '../src/state.ts';

const flight = () => ({ id: 'regression', originIata: 'HND', destinationIata: 'SFO', task: '专注', durationSeconds: 600, startedAt: 1000000, endsAt: 1600000, distanceKm: 8300, pausedAt: null });
const active = () => ({ ...emptyState(), activeFlight: flight() });
const reload = state => decode(JSON.stringify(state));

test('idle and redundant transitions are no-ops; exact deadline cannot be paused', () => {
  const idle = emptyState();
  assert.equal(pause(idle, 0), idle);
  assert.equal(resume(idle, 0), idle);
  assert.equal(finalize(idle, 0), idle);
  const running = active();
  assert.equal(resume(running, 1100000), running);
  const paused = pause(running, 1100000);
  assert.equal(pause(paused, 1200000), paused);
  assert.equal(pause(running, 1600000), running);
  assert.equal(pause(running, 1600001), running);
  assert.equal(finalize(running, 1599999), running);
  assert.equal(finalize(running, 1600000).flights.length, 1);
});

test('repeated pause/reload/resume cycles count only effective flying time', () => {
  let state = active();
  let clock = 1000000;
  let elapsed = 0;
  let pausedTotal = 0;
  for (const [flyingMs, pausedMs] of [[100000, 3600000], [170000, 0], [230000, 86400000]]) {
    clock += flyingMs;
    elapsed += flyingMs;
    const before = JSON.stringify(state);
    const paused = pause(state, clock);
    assert.equal(JSON.stringify(state), before, 'pause must not mutate its input');
    assert.equal(progress(paused.activeFlight!, clock + pausedMs), elapsed / 600000);
    state = reload(paused);
    assert.equal(finalize(state, clock + pausedMs), state);
    clock += pausedMs;
    pausedTotal += pausedMs;
    state = reload(resume(state, clock));
    assert.equal(state.activeFlight!.startedAt, 1000000);
    assert.equal(state.activeFlight!.endsAt, 1600000 + pausedTotal);
    assert.equal(progress(state.activeFlight!, clock), elapsed / 600000);
  }
  const final = finalize(state, clock + 100000);
  assert.equal(final.activeFlight, null);
  assert.equal(final.flights.length, 1);
  assert.equal(final.flights[0].completedAt, 1600000 + pausedTotal);
  assert.equal(final.flights[0].durationSeconds, 600);
  assert.deepEqual(reload(final), final);
});

test('resume at the same timestamp and earlier clock never shortens the deadline', () => {
  const paused = pause(active(), 1200000);
  for (const clock of [1200000, 1199999]) {
    const restored = resume(paused, clock);
    assert.equal(restored.activeFlight!.endsAt, 1600000);
    assert.equal(restored.activeFlight!.pausedAt, null);
  }
});

test('completion appends history without mutation and duplicate recovery remains idempotent', () => {
  const first = finalize(active(), 1700000);
  const secondFlight = { ...flight(), id: 'second', originIata: 'SFO', destinationIata: 'HND', startedAt: 2000000, endsAt: 2600000 };
  const state = { ...first, activeFlight: secondFlight };
  const snapshot = JSON.stringify(state);
  const completed = finalize(state, 9000000);
  assert.equal(JSON.stringify(state), snapshot);
  assert.deepEqual(completed.flights.map(f => f.id), ['regression', 'second']);
  assert.equal(completed.lastAirportIata, 'HND');
  assert.equal(completed.flights[1].completedAt, 2600000);
  assert.equal('endsAt' in completed.flights[1], false);
  assert.equal('pausedAt' in completed.flights[1], false);
  assert.deepEqual(reload(completed), completed);
  const duplicate = finalize({ ...reload(completed), activeFlight: secondFlight }, 9000000);
  assert.deepEqual(duplicate, completed);
  assert.equal(finalize(duplicate, 9000001), duplicate);
});

test('cancel running or paused flight preserves prior history across reload', () => {
  const history = finalize(active(), 1600000);
  for (const pausedAt of [null, 1200000]) {
    const state = { ...history, activeFlight: { ...flight(), id: 'cancelled', pausedAt } };
    const snapshot = JSON.stringify(state);
    assert.deepEqual(reload(cancel(state)), history);
    assert.equal(JSON.stringify(state), snapshot);
  }
});

test('decoder accepts both supported duration limits and rejects invalid flight fields', () => {
  for (const durationSeconds of [600, 900, 10800]) {
    const state = active();
    Object.assign(state.activeFlight, { durationSeconds, endsAt: 1000000 + durationSeconds * 1000 });
    assert.deepEqual(reload(state), state);
  }
  const invalid = { id: ['', null, 42], originIata: ['hnd', 'HN', null, ['HND']], destinationIata: ['HND', 'SFOO', ['SFO']], task: ['', '  ', null], durationSeconds: [0, 599, 601, 10900, '600'], distanceKm: [-1, null, '10'], startedAt: [null, '1000000'], endsAt: [1599999, null, '1600000'], pausedAt: [999999, 1600000, '1200000'] };
  for (const [field, values] of Object.entries(invalid)) for (const value of values) {
    const state = active();
    state.activeFlight[field] = value;
    assert.deepEqual(reload(state), emptyState(), `${field}=${JSON.stringify(value)}`);
  }
});

test('decoder rejects malformed state and corrupt or duplicated completed history', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{}', 'false']) assert.deepEqual(decode(raw), emptyState());
  for (const patch of [{ flights: {} }, { flights: [null] }, { lastAirportIata: 'hnd' }, { lastAirportIata: ['HND'] }, { activeFlight: {} }])
    assert.deepEqual(reload({ ...emptyState(), ...patch }), emptyState());
  const valid = finalize(active(), 1600000);
  for (const patch of [{ completedAt: 1599999 }, { completedAt: null }, { task: ' ' }, { durationSeconds: 601 }, { originIata: ['HND'] }, { destinationIata: ['SFO'] }])
    assert.deepEqual(reload({ ...valid, flights: [{ ...valid.flights[0], ...patch }] }), emptyState());
  assert.deepEqual(reload({ ...valid, flights: [valid.flights[0], valid.flights[0]] }), emptyState());
  assert.deepEqual(reload(emptyState()), emptyState());
  const a = emptyState();
  const b = emptyState();
  assert.notEqual(a.flights, b.flights);
});
