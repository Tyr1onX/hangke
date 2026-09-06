import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, interpolate } from '../src/geo.ts';

test('distance uses kilometres, is symmetric and handles the date line', () => {
  assert.equal(distance([0, 0], [0, 0]), 0);
  assert.ok(Math.abs(distance([0, 0], [1, 0]) - 111.195) < .001);
  assert.ok(Math.abs(distance([179, 0], [-179, 0]) - 222.390) < .001);
  assert.ok(Math.abs(distance([0, 0], [180, 0]) - 20015.114) < .001);
  for (const [a, b] of [[[139.78, 35.55], [-122.38, 37.62]], [[10, 90], [40, -90]], [[0, 0], [.00001, .00001]]]) {
    assert.ok(Number.isFinite(distance(a, b)));
    assert.ok(Math.abs(distance(a, b) - distance(b, a)) < 1e-9);
  }
});

test('great-circle fractions advance proportional distance and clamp at endpoints', () => {
  const a = [139.78, 35.55];
  const b = [-122.38, 37.62];
  const total = distance(a, b);
  for (const fraction of [.01, .25, .5, .75, .99]) {
    const point = interpolate(a, b, fraction);
    assert.ok(Math.abs(distance(a, point) - total * fraction) < 1e-6);
    assert.ok(Math.abs(distance(point, b) - total * (1 - fraction)) < 1e-6);
  }
  assert.deepEqual(interpolate(a, b, -1), a);
  assert.deepEqual(interpolate(a, b, 2), b);
});
