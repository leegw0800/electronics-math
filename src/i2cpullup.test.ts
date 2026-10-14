import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RISE_CONSTANT,
  MODES,
  getMode,
  minResistance,
  maxResistance,
  riseTimeFor,
  sinkCurrentFor,
  solve,
  standardValuesBetween,
  type PullupInputs,
} from './i2cpullup.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} !== ${expected}`);

/*
 * The worked example in TI SLVA689, "I2C Bus Pullup Resistor Calculation",
 * is the published figure this module is checked against. It uses a 3.3 V
 * bus with the specification's 0.4 V at 3 mA, and Standard-mode's 1 µs rise
 * budget against 100 pF.
 */
test('the TI application note example reproduces', () => {
  near(minResistance(3.3, 0.4, 3e-3), 966.6666666666667);
  near(maxResistance(1000e-9, 100e-12), 11802.2, 1e-5);
});

// 0.8473 is quoted in every note without derivation. It is ln(0.7/0.3): the
// time an RC edge takes between the two thresholds the specification names.
test('the rise constant is the 30 % to 70 % crossing, not a fudge factor', () => {
  near(RISE_CONSTANT, 0.8472978603872034);
  near(RISE_CONSTANT, Math.log(0.7) - Math.log(0.3));
  // Rounded to the four digits the application notes print.
  assert.equal(RISE_CONSTANT.toFixed(4), '0.8473');
});

test('the two limits invert back to the quantities that set them', () => {
  const r = maxResistance(300e-9, 200e-12);
  near(riseTimeFor(r, 200e-12), 300e-9);
  const rMin = minResistance(5, 0.4, 3e-3);
  near(sinkCurrentFor(5, 0.4, rMin), 3e-3);
});

// The supply cancels in tr = 0.8473·R·C. Raising it buys no rise-time
// headroom, which is the opposite of what a bigger swing suggests.
test('rise time does not depend on the supply', () => {
  near(maxResistance(300e-9, 100e-12), maxResistance(300e-9, 100e-12));
  const a = solve({ ...FAST, supply: 3.3 });
  const b = solve({ ...FAST, supply: 5 });
  near(a.max, b.max);
  assert.ok(b.min > a.min, 'a higher supply does raise the minimum');
});

test('the specification figures for each mode are the ones published', () => {
  assert.deepEqual(
    MODES.map((m) => [m.id, m.frequency, m.riseTimeMax, m.sinkCurrent]),
    [
      ['standard', 100e3, 1000e-9, 3e-3],
      ['fast', 400e3, 300e-9, 3e-3],
      ['fastPlus', 1e6, 120e-9, 20e-3],
    ],
  );
  assert.equal(getMode('fast').capacitanceMax, 400e-12);
  assert.equal(getMode('fastPlus').capacitanceMax, 550e-12);
  assert.throws(() => getMode('high-speed'), /No I²C mode/);
});

const FAST: PullupInputs = {
  supply: 3.3,
  capacitance: 100e-12,
  riseTimeMax: 300e-9,
  sinkCurrent: 3e-3,
  outputLow: 0.4,
  series: 'E24',
};

test('a typical fast-mode bus lands on the values people actually fit', () => {
  const { min, max, feasible, candidates } = solve(FAST);
  near(min, 966.6666666666667);
  near(max, 3540.66, 1e-4);
  assert.ok(feasible);

  const values = candidates.map((c) => c.r);
  assert.ok(values.includes(1000), '1 kΩ should be in the window');
  assert.ok(values.includes(2200), '2.2 kΩ should be in the window');
  assert.ok(values.includes(3300), '3.3 kΩ should be in the window');
  assert.ok(!values.includes(4700), '4.7 kΩ is outside it, which is the point of the tool');

  // Every value offered really does satisfy both limits.
  for (const c of candidates) {
    assert.ok(c.r >= min && c.r <= max, `${c.r} outside the window`);
    assert.ok(c.riseTimeUsed <= 1, `${c.r} exceeds the rise budget`);
    assert.ok(c.sinkCurrentUsed <= 1, `${c.r} asks for more sink current than rated`);
  }
});

test('exactly one value is recommended, and it is the geometric middle', () => {
  const { min, max, candidates } = solve(FAST);
  const recommended = candidates.filter((c) => c.isRecommended);
  assert.equal(recommended.length, 1);
  // √(966.7 × 3540.7) ≈ 1850, and 1.8 kΩ is the E24 value beside it.
  assert.equal(recommended[0].r, 1800);
  assert.ok(recommended[0].r > min && recommended[0].r < max);
});

/*
 * Capacitance is what closes the window: it only moves the upper limit, and
 * at Fast-mode Plus speeds a heavily loaded bus runs out of room. Reporting
 * that as a result rather than an error is the whole point — it says the bus
 * needs fewer devices or a shorter run, not a different resistor.
 */
test('too much capacitance closes the window instead of failing', () => {
  const crowded = solve({
    supply: 3.3,
    capacitance: 550e-12,
    riseTimeMax: 120e-9,
    sinkCurrent: 3e-3,
    outputLow: 0.4,
    series: 'E24',
  });
  assert.equal(crowded.feasible, false);
  assert.ok(crowded.max < crowded.min);
  assert.deepEqual(crowded.candidates, []);
  assert.ok(crowded.spread < 1);

  // The same bus is fine once the devices can sink the 20 mA the mode expects.
  const rated = solve({
    supply: 3.3,
    capacitance: 550e-12,
    riseTimeMax: 120e-9,
    sinkCurrent: 20e-3,
    outputLow: 0.4,
    series: 'E24',
  });
  assert.equal(rated.feasible, true);
  assert.ok(rated.candidates.length > 0);
});

test('standard values are returned across decade boundaries and land exact', () => {
  const values = standardValuesBetween(800, 12000, 'E24');
  assert.ok(values.includes(820) && values.includes(1000) && values.includes(10000));
  assert.deepEqual([...values].sort((a, b) => a - b), values, 'should come back ascending');
  // 4.7 × 10³ in binary floating point is not 4700; a value that misses the
  // window by 4.5e-13 must not be dropped from a list it belongs in.
  assert.ok(values.includes(4700));
  assert.deepEqual(standardValuesBetween(1000, 1000, 'E24'), [1000]);
  assert.deepEqual(standardValuesBetween(1010, 1090, 'E24'), []);
});

test('the tolerance flag marks values that survive the series spread', () => {
  const { candidates } = solve(FAST);
  const edge = candidates.find((c) => c.r === 1000);
  assert.ok(edge);
  // 1 kΩ E24 is ±5 %, so 950 Ω — below the 966.7 Ω floor.
  assert.equal(edge.holdsAtTolerance, false);
  const middle = candidates.find((c) => c.isRecommended);
  assert.equal(middle?.holdsAtTolerance, true);
});

test('impossible inputs are refused with a reason', () => {
  assert.throws(() => minResistance(0, 0.4, 3e-3), /Supply voltage/);
  assert.throws(() => minResistance(3.3, 0.4, 0), /Sink current/);
  assert.throws(() => minResistance(3.3, 3.3, 3e-3), /below the supply/);
  assert.throws(() => minResistance(3.3, -0.1, 3e-3), /cannot be negative/);
  assert.throws(() => maxResistance(0, 100e-12), /Rise time/);
  assert.throws(() => maxResistance(300e-9, 0), /Bus capacitance/);
  assert.throws(() => riseTimeFor(0, 100e-12), /Resistance/);
  assert.throws(() => sinkCurrentFor(3.3, 0.4, 0), /Resistance/);
});
