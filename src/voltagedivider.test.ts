import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  idealRatio,
  idealR1,
  outputVoltage,
  worstCase,
  evaluate,
  solve,
  formatCurrent,
  formatPower,
  formatVolts,
  R2_DECADES,
} from './voltagedivider.ts';
import { isStandard } from './eseries.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} !== ${expected}`);

test('the divider formula, checked by hand', () => {
  // 5 V across 5.1k over 10k: 5 × 10 / 15.1
  near(outputVoltage(5, 5100, 10000), 3.311258278145695);
  near(outputVoltage(10, 10000, 10000), 5);
  near(outputVoltage(12, 20000, 10000), 4);
});

test('ideal ratio and ideal R1 invert the formula', () => {
  near(idealRatio(5, 3.3), 0.66);
  const r1 = idealR1(5, 3.3, 10000);
  near(r1, 5151.515151515152);
  near(outputVoltage(5, r1, 10000), 3.3);
});

test('a target that a series can hit exactly gives zero error', () => {
  // 10 V -> 5 V needs R1 = R2; every series has equal pairs.
  for (const series of ['E6', 'E24', 'E96'] as const) {
    const best = solve({ vin: 10, vout: 5, series, r2Decade: 10000 })[0];
    assert.equal(best.errorPct, 0, series);
    assert.equal(best.r1, best.r2);
  }
  // 12 V -> 4 V needs R1 = 2·R2, which E24 has: 2.2k/1.1k, 2.4k/1.2k, 3k/1.5k...
  const twoToOne = solve({ vin: 12, vout: 4, series: 'E24', r2Decade: 1000 })[0];
  assert.equal(twoToOne.errorPct, 0);
  near(twoToOne.r1, twoToOne.r2 * 2);
});

test('solutions use only standard values and come back best first', () => {
  const results = solve({ vin: 5, vout: 3.3, series: 'E24', r2Decade: 10000 });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.ok(isStandard(r.r1, 'E24'), `${r.r1} is not E24`);
    assert.ok(isStandard(r.r2, 'E24'), `${r.r2} is not E24`);
    assert.ok(r.r2 >= 10000 && r.r2 < 100000, 'R2 stays in the requested decade');
  }
  for (let i = 1; i < results.length; i++) {
    assert.ok(Math.abs(results[i].errorPct) >= Math.abs(results[i - 1].errorPct), 'sorted by error');
  }
  // The classic 3.3 V from 5 V answer is a fraction of a percent off, never worse.
  assert.ok(Math.abs(results[0].errorPct) < 0.2);
});

test('the well-known 5.1k / 10k pair for 3.3 V from 5 V is among the answers', () => {
  const results = solve({ vin: 5, vout: 3.3, series: 'E24', r2Decade: 10000 }, 24);
  const pair = results.find((r) => r.r1 === 5100 && r.r2 === 10000);
  assert.ok(pair, 'pair not found');
  near(pair.vout, 3.311258278145695);
  near(pair.errorPct, 0.3411599438089);
});

test('worst case opens in the direction the tolerances push it', () => {
  const { min, max } = worstCase(5, 5100, 10000, 0.05);
  const nominal = outputVoltage(5, 5100, 10000);
  assert.ok(min < nominal && nominal < max);
  // R2 up 5 %, R1 down 5 %: 5 × 10500 / (4845 + 10500)
  near(max, 3.4213098, 1e-6);
  // R2 down 5 %, R1 up 5 %: 5 × 9500 / (5355 + 9500)
  near(min, 3.1975766, 1e-6);
  // Tighter parts, narrower band.
  const tight = worstCase(5, 5100, 10000, 0.01);
  assert.ok(tight.max - tight.min < max - min);
});

test('evaluate reports current, dissipation and output impedance', () => {
  const e = evaluate(12, 20000, 10000, 0.01, 4);
  near(e.vout, 4);
  assert.equal(e.errorPct, 0);
  near(e.current, 12 / 30000);
  near(e.p1, (12 / 30000) ** 2 * 20000);
  near(e.p2, (12 / 30000) ** 2 * 10000);
  near(e.outputImpedance, (20000 * 10000) / 30000);
  assert.equal(e.worst.tolerance, 0.01);
});

test('impossible targets are refused with a reason', () => {
  assert.throws(() => solve({ vin: 5, vout: 5, series: 'E24', r2Decade: 10000 }), /below Vin/);
  assert.throws(() => solve({ vin: 5, vout: 6, series: 'E24', r2Decade: 10000 }), /below Vin/);
  assert.throws(() => solve({ vin: 5, vout: 0, series: 'E24', r2Decade: 10000 }), /greater than zero/);
  assert.throws(() => solve({ vin: 0, vout: 1, series: 'E24', r2Decade: 10000 }), /Vin must/);
  assert.throws(() => evaluate(5, 0, 100, 0.05), /Both resistors/);
});

test('every offered decade is a power of ten', () => {
  for (const d of R2_DECADES) assert.equal(Math.log10(d) % 1, 0);
});

test('units are formatted at the scale an engineer reads them', () => {
  assert.equal(formatCurrent(0.000331), '331 µA');
  assert.equal(formatCurrent(0.0125), '12.5 mA');
  assert.equal(formatCurrent(1.5), '1.5 A');
  assert.equal(formatPower(0.00165), '1.65 mW');
  assert.equal(formatPower(0.72), '720 mW');
  assert.equal(formatPower(1.2), '1.2 W');
  assert.equal(formatVolts(3.311258), '3.311 V');
  assert.equal(formatVolts(5), '5 V');
});
