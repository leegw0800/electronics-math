import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headroom,
  idealResistor,
  currentFor,
  currentWorstCase,
  recommendedRating,
  solve,
  RATINGS,
  LED_PRESETS,
  type LedInputs,
} from './ledresistor.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} !== ${expected}`);

const RED: LedInputs = { supply: 5, forward: 2, current: 0.02, count: 1, series: 'E24' };

test('the textbook case: a red LED from 5 V wants 150 ohms', () => {
  near(headroom(5, 2, 1), 3);
  near(idealResistor(5, 2, 0.02, 1), 150);
  // Three white LEDs from 12 V: 12 - 9.6 = 2.4 V over the resistor.
  near(idealResistor(12, 3.2, 0.02, 3), 120);
  // A white LED from 3.3 V leaves almost nothing.
  near(idealResistor(3.3, 3.2, 0.02, 1), 5);
});

test('current follows the resistor the other way', () => {
  near(currentFor(5, 2, 1, 150), 0.02);
  near(currentFor(5, 2, 1, 130), 3 / 130);
  near(currentFor(5, 2, 1, 160), 0.01875);
});

test('no headroom is refused with the numbers in the message', () => {
  assert.throws(() => headroom(3.3, 3.2, 2), /2 LEDs at 3.2 V need 6.40 V/);
  assert.throws(() => headroom(2, 2, 1), /leaves nothing/);
  assert.throws(() => idealResistor(5, 2, 0, 1), /Current must/);
  assert.throws(() => headroom(5, 2, 0), /whole number/);
  assert.throws(() => headroom(5, 2, 1.5), /whole number/);
  assert.throws(() => headroom(0, 2, 1), /Supply/);
});

test('worst case: a low resistor passes more current', () => {
  const { min, max } = currentWorstCase(5, 2, 1, 150, 0.05);
  near(min, 3 / 157.5);
  near(max, 3 / 142.5);
  assert.ok(min < 0.02 && 0.02 < max);
});

test('rating recommendation keeps 2x margin and stops at 5 W', () => {
  assert.equal(recommendedRating(0.06), 0.125); // 20 mA through 150 R
  assert.equal(recommendedRating(0.1), 0.25);
  assert.equal(recommendedRating(0.3), 1);
  assert.equal(recommendedRating(2.4), 5);
  assert.equal(recommendedRating(3), null);
  for (let i = 1; i < RATINGS.length; i++) assert.ok(RATINGS[i] > RATINGS[i - 1]);
});

test('an ideal that is itself standard gives three rows with the exact one in the middle', () => {
  const { ideal, candidates } = solve(RED);
  near(ideal, 150);
  assert.deepEqual(
    candidates.map((c) => c.r),
    [130, 150, 160],
  );
  const exact = candidates[1];
  assert.equal(exact.isNearest, true);
  near(exact.current, 0.02);
  assert.equal(exact.errorPct, 0);
  assert.equal(exact.withinTarget, true);
  near(exact.pResistor, 0.06);
  near(exact.pLed, 0.04);
  assert.equal(exact.rating, 0.125);
  // The smaller resistor overshoots the target and says so.
  assert.equal(candidates[0].withinTarget, false);
  assert.ok(candidates[0].errorPct > 0);
  // The larger one is the safe side.
  assert.equal(candidates[2].withinTarget, true);
  assert.ok(candidates[2].errorPct < 0);
});

test('a non-standard ideal gives the two neighbours, nearest flagged', () => {
  // White LED from 5 V: 1.8 V / 20 mA = 90 R, between E24 82 and 91.
  const { ideal, candidates } = solve({ ...RED, forward: 3.2 });
  near(ideal, 90);
  assert.deepEqual(
    candidates.map((c) => c.r),
    [82, 91],
  );
  assert.equal(candidates[0].isNearest, false);
  assert.equal(candidates[1].isNearest, true);
  near(candidates[1].current, 1.8 / 91);
  assert.equal(candidates[1].withinTarget, true);
  near(candidates[0].current, 1.8 / 82);
  assert.equal(candidates[0].withinTarget, false);
});

test('a high Vf drops the current, and drops it hardest with little headroom', () => {
  const comfortable = solve(RED).candidates[1]; // 150 R, 3 V headroom
  near(comfortable.ifForwardHigh, 2.9 / 150);
  const tight = solve({ ...RED, forward: 3.2 }).candidates[1]; // 91 R, 1.8 V headroom
  near(tight.ifForwardHigh, 1.7 / 91);
  // Relative change is larger when the headroom is smaller.
  const dropComfortable = (comfortable.current - comfortable.ifForwardHigh) / comfortable.current;
  const dropTight = (tight.current - tight.ifForwardHigh) / tight.current;
  assert.ok(dropTight > dropComfortable);
});

test('worst case is attached to every candidate at the series tolerance', () => {
  for (const c of solve({ ...RED, series: 'E96' }).candidates) {
    assert.equal(c.worst.tolerance, 0.01);
    assert.ok(c.worst.min < c.current && c.current < c.worst.max);
  }
});

test('presets are usable starting points', () => {
  const labels = new Set<string>();
  for (const p of LED_PRESETS) {
    assert.ok(p.forward > 0 && p.forward < 5, p.label);
    assert.ok(!labels.has(p.label), `duplicate ${p.label}`);
    labels.add(p.label);
  }
});
