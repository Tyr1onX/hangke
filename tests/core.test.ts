import { test } from "node:test";
import assert from "node:assert/strict";
import { distance, interpolate, route, bearing } from "../src/geo.ts";
import {
  emptyState,
  finalize,
  cancel,
  decode,
  progress,
} from "../src/state.ts";
const flight = {
  id: "test",
  originIata: "HND",
  destinationIata: "SFO",
  task: "专注",
  durationSeconds: 600,
  startedAt: 1000,
  endsAt: 601000,
  distanceKm: 8300,
};
test("elapsed wall time drives recovery and is clamped", () => {
  assert.equal(progress(flight, 301000), 0.5);
  assert.equal(progress(flight, 999999), 1);
  assert.equal(progress(flight, -10), 0);
});
test("expired flight lands exactly once, including after reload", () => {
  const active = { ...emptyState(), activeFlight: flight };
  assert.equal(finalize(active, 600999), active);
  const landed = finalize(decode(JSON.stringify(active)), 900000);
  assert.equal(landed.flights.length, 1);
  assert.equal(landed.flights[0].completedAt, flight.endsAt);
  assert.equal(landed.lastAirportIata, "SFO");
  assert.equal(landed.activeFlight, null);
  assert.equal(finalize(landed, 999999).flights.length, 1);
  assert.equal(
    finalize({ ...landed, activeFlight: flight }, 999999).flights.length,
    1,
  );
});
test("cancel retains previous arrival and no partial history", () => {
  const s = cancel({
    ...emptyState(),
    lastAirportIata: "CGQ",
    activeFlight: flight,
  });
  assert.equal(s.lastAirportIata, "CGQ");
  assert.equal(s.flights.length, 0);
  assert.equal(s.activeFlight, null);
});
test("corrupt and structurally invalid storage resets safely", () => {
  for (const raw of [
    "{",
    "null",
    "{}",
    JSON.stringify({ ...emptyState(), activeFlight: { ...flight, endsAt: 9 } }),
  ])
    assert.deepEqual(decode(raw), emptyState());
});
test("Tokyo to San Francisco takes the short Pacific route", () => {
  const a: [number, number] = [139.78, 35.55],
    b: [number, number] = [-122.38, 37.62];
  assert.ok(distance(a, b) > 8200 && distance(a, b) < 8400);
  const points = route(a, b);
  for (let i = 1; i < points.length; i++)
    assert.ok(Math.abs(points[i][0] - points[i - 1][0]) < 5);
  assert.ok(points.at(-1)![0] > 180);
  assert.ok(Math.abs(interpolate(a, b, 0.5)[0]) > 170);
});
test("degenerate, polar and antipodal paths remain finite and preserve endpoints", () => {
  for (const [a, b] of [
    [
      [0, 0],
      [180, 0],
    ],
    [
      [0, 90],
      [20, -90],
    ],
    [
      [2, 3],
      [2, 3],
    ],
  ] as [number[], number[]][]) {
    const start = a as [number, number],
      end = b as [number, number];
    assert.deepEqual(interpolate(start, end, 0), start);
    assert.deepEqual(interpolate(start, end, 1), end);
    for (const p of route(start, end)) assert.ok(p.every(Number.isFinite));
    assert.ok(Number.isFinite(bearing(start, end)));
  }
});
