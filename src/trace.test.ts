import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  K,
  OZ_TO_UM,
  MIL_TO_MM,
  thicknessMils,
  areaForCurrent,
  currentForArea,
  tempRiseForArea,
  widthForCurrent,
  currentForWidth,
  tempRiseForWidth,
  traceResistance,
  standardWidthsAround,
  warnings,
  solve,
  STANDARD_WIDTHS_MM,
  type TraceInputs,
} from './trace.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} !== ${expected}`);

const BASE: TraceInputs = { current: 1, tempRise: 10, ozCopper: 1, layer: 'external', lengthMm: 10, ambient: 25 };

test('one ounce of copper is 35 µm, which is 1.378 mil', () => {
  assert.equal(OZ_TO_UM, 35);
  near(thicknessMils(1), 1.378, 1e-3);
  near(thicknessMils(2), 2 * thicknessMils(1));
  near(MIL_TO_MM, 0.0254);
});

test('the IPC-2221 constants are the published ones', () => {
  assert.equal(K.external, 0.048);
  assert.equal(K.internal, 0.024);
});

test('the widely quoted answer: 1 A at 10 °C on 1 oz outer copper is about 11.8 mil', () => {
  const w = widthForCurrent(1, 10, 1, 'external');
  // Published calculators give 11.8–11.9 mil, 0.30 mm; the spread is the 1.37 vs 1.378 mil/oz choice.
  near(w.mils, 11.8, 0.01);
  near(w.mm, 0.30, 0.01);
  // 3 A at the same settings is quoted as about 53.7 mil.
  near(widthForCurrent(3, 10, 1, 'external').mils, 53.7, 0.01);
});

test('an inner layer needs about 2.6 times the width, not twice', () => {
  const outer = widthForCurrent(2, 10, 1, 'external').mm;
  const inner = widthForCurrent(2, 10, 1, 'internal').mm;
  // k halves, and area scales as (1/k)^(1/0.725): 2^(1/0.725) = 2.601.
  near(inner / outer, 2 ** (1 / 0.725));
  near(inner / outer, 2.601, 1e-3);
});

test('doubling the copper halves the width exactly', () => {
  const one = widthForCurrent(2, 10, 1, 'external').mm;
  const two = widthForCurrent(2, 10, 2, 'external').mm;
  near(two, one / 2);
});

test('the three forms of the formula invert each other', () => {
  const area = areaForCurrent(2.5, 20, 'external');
  near(currentForArea(area, 20, 'external'), 2.5);
  near(tempRiseForArea(area, 2.5, 'external'), 20);

  const w = widthForCurrent(2.5, 20, 1, 'internal');
  near(currentForWidth(w.mm, 20, 1, 'internal'), 2.5);
  near(tempRiseForWidth(w.mm, 2.5, 1, 'internal'), 20);
});

test('more current or less allowed rise means a wider trace', () => {
  const base = widthForCurrent(1, 10, 1, 'external').mm;
  assert.ok(widthForCurrent(2, 10, 1, 'external').mm > base);
  assert.ok(widthForCurrent(1, 20, 1, 'external').mm < base);
});

test('trace resistance, by hand: 10 mm of 0.3 mm 1 oz copper is 16 mΩ', () => {
  // ρ L / (w t) = 1.68e-8 × 0.01 / (0.3e-3 × 35e-6)
  near(traceResistance(0.3, 1, 10), 0.016);
  // At 45 °C copper is 1 + 0.00393 × 25 = 9.8 % higher.
  near(traceResistance(0.3, 1, 10, 45), 0.016 * 1.09825);
  // Twice the length, twice the resistance; twice the width, half.
  near(traceResistance(0.3, 1, 20), 0.032);
  near(traceResistance(0.6, 1, 10), 0.008);
});

test('standard widths bracket the minimum, and an exact hit counts as above', () => {
  assert.deepEqual(standardWidthsAround(0.3002), { below: 0.3, above: 0.4 });
  assert.deepEqual(standardWidthsAround(0.25), { below: 0.2, above: 0.25 });
  assert.deepEqual(standardWidthsAround(0.05), { below: null, above: 0.1 });
  assert.deepEqual(standardWidthsAround(12), { below: 10, above: null });
  for (let i = 1; i < STANDARD_WIDTHS_MM.length; i++) assert.ok(STANDARD_WIDTHS_MM[i] > STANDARD_WIDTHS_MM[i - 1]);
});

test('solve reports the bracketing widths with the rise each really gives', () => {
  const s = solve(BASE);
  near(s.widthMm, 0.30, 0.01);
  assert.ok(s.below && s.above);
  assert.equal(s.below.mm, 0.3);
  assert.equal(s.above.mm, 0.4);
  // The width just under the minimum runs slightly hotter than asked; the one over, cooler.
  assert.ok(s.below.tempRise > 10 && s.below.tempRise < 10.1);
  assert.ok(s.above.tempRise < 10);
  near(s.above.tempRise, tempRiseForWidth(0.4, 1, 1, 'external'));
  assert.equal(s.operatingTemp, 35);
  near(s.resistanceHot, s.resistance20 * (1 + 0.00393 * 15));
  near(s.voltageDrop, 1 * s.resistanceHot);
  near(s.powerLoss, s.resistanceHot);
  assert.deepEqual(s.warnings, []);
});

test('the stated range of IPC-2221 is enforced as warnings, not errors', () => {
  const w = (over: Partial<TraceInputs>) => warnings({ ...BASE, ...over }, 100);
  assert.ok(w({ tempRise: 5 }).some((m) => /10 °C/.test(m)));
  assert.ok(w({ tempRise: 150 }).some((m) => /100 °C/.test(m)));
  assert.ok(w({ current: 40 }).some((m) => /35 A/.test(m)));
  assert.ok(w({ ozCopper: 4 }).some((m) => /3 oz/.test(m)));
  assert.ok(w({ ambient: 80, tempRise: 30 }).some((m) => /FR-4/.test(m)));
  assert.ok(warnings(BASE, 450).some((m) => /400 mil/.test(m)));
  assert.equal(w({}).length, 0);
});

test('nonsense is refused', () => {
  assert.throws(() => widthForCurrent(0, 10, 1, 'external'), /Current/);
  assert.throws(() => widthForCurrent(1, 0, 1, 'external'), /rise/);
  assert.throws(() => widthForCurrent(1, 10, 0, 'external'), /Copper/);
  assert.throws(() => currentForWidth(0, 10, 1, 'external'), /Width/);
  assert.throws(() => solve({ ...BASE, lengthMm: -1 }), /Length/);
});
