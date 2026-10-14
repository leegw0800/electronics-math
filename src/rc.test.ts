import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeConstant,
  cutoff,
  riseTime,
  stepFraction,
  timeToFraction,
  settlingTime,
  response,
  cutoffWorstCase,
  evaluate,
  solve,
  C_DECADES,
} from './rc.ts';
import { isStandard } from './eseries.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} !== ${expected}`);

test('10k and 100n is the one-millisecond textbook case', () => {
  near(timeConstant(10000, 1e-7), 1e-3);
  near(cutoff(10000, 1e-7), 1 / (2 * Math.PI * 1e-3)); // 159.155 Hz
  near(cutoff(10000, 1e-7), 159.15494309189535, 1e-12);
  near(timeConstant(1000, 1e-6), 1e-3, 1e-12);
});

test('rise time is tau times ln 9, and 0.35 over fc', () => {
  const tau = 1e-3;
  near(riseTime(tau), 2.1972245773362196e-3);
  // The 10 %–90 % definition and the ln 9 shortcut agree.
  near(timeToFraction(0.9, tau) - timeToFraction(0.1, tau), riseTime(tau));
  // 0.35 / fc is the usual rule of thumb; it is 0.3497, not exactly 0.35.
  near(riseTime(tau) * cutoff(10000, 1e-7), 0.34969, 1e-4);
});

test('step response hits the classic fractions at whole multiples of tau', () => {
  const tau = 1;
  near(stepFraction(1, tau), 0.6321205588285577);
  near(stepFraction(3, tau), 0.950212931632136);
  near(stepFraction(5, tau), 0.9932620530009145);
  near(timeToFraction(0.5, tau), Math.LN2);
  assert.throws(() => timeToFraction(1, tau), /between 0 and 1/);
  assert.throws(() => timeToFraction(0, tau), /between 0 and 1/);
});

test('settling to one LSB takes far more than one tau', () => {
  near(settlingTime(8, 1), 5.545177444479562);
  near(settlingTime(12, 1), 8.317766166719343);
  near(settlingTime(16, 1), 11.090354888959125);
  // Which is the same as reaching 1 - 2^-n of the step.
  near(settlingTime(12, 1), timeToFraction(1 - 2 ** -12, 1));
});

test('at the cutoff both filter types are -3 dB and 45 degrees', () => {
  const lp = response(100, 100, 'lowpass');
  near(lp.magnitude, Math.SQRT1_2);
  near(lp.db, -3.0102999566398125);
  near(lp.phaseDeg, -45);

  const hp = response(100, 100, 'highpass');
  near(hp.magnitude, Math.SQRT1_2);
  near(hp.phaseDeg, 45);
});

test('a decade past the cutoff a first-order filter gives about 20 dB', () => {
  const lp = response(1000, 100, 'lowpass');
  near(lp.magnitude, 1 / Math.sqrt(101));
  near(lp.db, -20.043213737826426);
  near(lp.phaseDeg, -84.28940686250037);
  // A decade below, the low-pass barely touches the signal.
  near(response(10, 100, 'lowpass').db, -0.04321373782642574);
  // And the high-pass mirrors it.
  near(response(10, 100, 'highpass').db, -20.043213737826426);
});

test('the capacitor tolerance dominates the worst-case band', () => {
  const r = 10000, c = 1e-7;
  const { min, max } = cutoffWorstCase(r, c, 0.01, 0.1);
  near(min, 1 / (2 * Math.PI * 10100 * 1.1e-7));
  near(max, 1 / (2 * Math.PI * 9900 * 0.9e-7));
  const nominal = cutoff(r, c);
  assert.ok(min < nominal && nominal < max);

  const rOnly = cutoffWorstCase(r, c, 0.01, 0);
  const cOnly = cutoffWorstCase(r, c, 0, 0.1);
  assert.ok(cOnly.max - cOnly.min > 5 * (rOnly.max - rOnly.min), 'a 10 % capacitor swamps a 1 % resistor');
});

test('the solver picks 1.6k and 100n for 1 kHz from E24 and E12', () => {
  const results = solve({ fc: 1000, rSeries: 'E24', cSeries: 'E12', cDecade: 1e-7 }, 0.05, 0.1);
  assert.ok(results.length > 0);
  const best = results[0];
  assert.equal(best.r, 1600);
  assert.equal(best.c, 1e-7);
  near(best.fc, 994.7183943243459);
  assert.ok(Math.abs(best.errorPct) < 1);
  // 1/(2π·1000·100n) = 1591.5 Ω, and 1.6k is the E24 value 8.5 Ω away.
  for (const p of results) {
    assert.ok(isStandard(p.r, 'E24'), `${p.r} not E24`);
    assert.ok(isStandard(p.c, 'E12'), `${p.c} not E12`);
    assert.ok(p.c >= 1e-7 && p.c < 1e-6, 'C stays in the requested decade');
  }
  for (let i = 1; i < results.length; i++) {
    assert.ok(Math.abs(results[i].errorPct) >= Math.abs(results[i - 1].errorPct), 'sorted by error');
  }
  // The pair the solver reports is exactly what evaluate says about it.
  near(evaluate(best.r, best.c, 0.05, 0.1, 1000).fc, best.fc);
});

test('evaluate carries the tolerances it was given', () => {
  const p = evaluate(10000, 1e-7, 0.01, 0.2, 159.155);
  assert.equal(p.worst.rTol, 0.01);
  assert.equal(p.worst.cTol, 0.2);
  near(p.tau, 1e-3);
  assert.ok(Math.abs(p.errorPct) < 0.001);
});

test('nonsense inputs are refused', () => {
  assert.throws(() => cutoff(0, 1e-7), /Resistance/);
  assert.throws(() => cutoff(1000, 0), /Capacitance/);
  assert.throws(() => solve({ fc: 0, rSeries: 'E24', cSeries: 'E12', cDecade: 1e-7 }, 0.05, 0.1), /Cutoff frequency/);
});

test('capacitor decades run from 10 pF to 100 µF in powers of ten', () => {
  assert.equal(C_DECADES[0], 1e-11);
  assert.equal(C_DECADES[C_DECADES.length - 1], 1e-4);
  for (let i = 1; i < C_DECADES.length; i++) near(C_DECADES[i] / C_DECADES[i - 1], 10);
});
