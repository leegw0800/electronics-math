import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KELVIN_OFFSET,
  toKelvin,
  toCelsius,
  resistanceAt,
  temperatureAt,
  betaFrom,
  fitSteinhartHart,
  steinhartTemperature,
  steinhartResistance,
  resistanceFromCounts,
  countsFromResistance,
  resolutionAt,
  selfHeating,
  table,
  type BetaModel,
  type FitPoint,
} from './thermistor.ts';

const near = (actual: number, expected: number, rel = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel + 1e-12, `${actual} !== ${expected}`);

/** The part everyone reaches for: 10 kΩ at 25 °C, B25/85 = 3950. */
const NTC: BetaModel = { r0: 10000, t0: 25, beta: 3950 };

test('absolute zero is 273.15, not 273', () => {
  assert.equal(KELVIN_OFFSET, 273.15);
  near(toKelvin(25), 298.15);
  near(toCelsius(298.15), 25);
  near(toCelsius(toKelvin(-40)), -40);
});

// The one figure the model must reproduce exactly: at the reference
// temperature the exponent is zero, so the resistance is R0 by definition.
test('at the reference temperature the resistance is the reference resistance', () => {
  assert.equal(resistanceAt(25, NTC), 10000);
  near(temperatureAt(10000, NTC), 25);
  assert.equal(resistanceAt(0, { r0: 5000, t0: 0, beta: 3000 }), 5000);
});

test('resistance and temperature invert each other', () => {
  for (const celsius of [-40, -10, 0, 25, 37, 85, 125]) {
    near(temperatureAt(resistanceAt(celsius, NTC), NTC), celsius, 1e-9);
  }
  for (const resistance of [500, 2000, 10000, 50000, 300000]) {
    near(resistanceAt(temperatureAt(resistance, NTC), NTC), resistance, 1e-9);
  }
});

test('an NTC gets less resistive as it warms', () => {
  const readings = [-40, 0, 25, 85, 125].map((c) => resistanceAt(c, NTC));
  for (let i = 1; i < readings.length; i++) {
    assert.ok(readings[i] < readings[i - 1], `${readings[i]} should be below ${readings[i - 1]}`);
  }
});

// Beta is a two-point fit, so recovering it from two points of its own curve
// has to return the figure it was built from.
test('beta derived from two points recovers the beta it came from', () => {
  const r25 = resistanceAt(25, NTC);
  const r85 = resistanceAt(85, NTC);
  near(betaFrom(r25, 25, r85, 85), 3950, 1e-9);
  near(betaFrom(resistanceAt(-40, NTC), -40, resistanceAt(125, NTC), 125), 3950, 1e-9);
});

test('impossible model parameters are refused', () => {
  assert.throws(() => resistanceAt(25, { ...NTC, r0: 0 }), /Reference resistance/);
  assert.throws(() => resistanceAt(25, { ...NTC, beta: 0 }), /Beta must be/);
  assert.throws(() => resistanceAt(-300, NTC), /above absolute zero/);
  assert.throws(() => temperatureAt(0, NTC), /Resistance must be/);
  assert.throws(() => betaFrom(10000, 25, 10000, 85), /resistances must differ/);
  assert.throws(() => betaFrom(10000, 25, 3000, 25), /temperatures must differ/);
});

/* ------------------------------------------------- Steinhart-Hart */

/*
 * Three points and three unknowns give one exact answer, so the fit must pass
 * through every point it was handed. That is the check value this model
 * carries with it: no published table is needed to know the solver is right.
 */
test('a fit reproduces the three points it was made from', () => {
  const points = [-40, 25, 125].map((celsius) => ({ celsius, resistance: resistanceAt(celsius, NTC) }));
  const sh = fitSteinhartHart(points);
  for (const point of points) {
    near(steinhartTemperature(point.resistance, sh), point.celsius, 1e-9);
  }
});

/*
 * A real part's Beta is not one number: a datasheet quoting B25/85 and
 * B25/100 gives two slightly different figures, because the curve is not
 * quite log-linear. Building the fit points that way is what gives a
 * non-zero C, and it is the only reason the three-coefficient form exists.
 */
const REAL: FitPoint[] = [
  { celsius: -40, resistance: resistanceAt(-40, { ...NTC, beta: 3900 }) },
  { celsius: 25, resistance: 10000 },
  { celsius: 125, resistance: resistanceAt(125, { ...NTC, beta: 4000 }) },
];

test('the closed-form inverse matches the forward equation', () => {
  const sh = fitSteinhartHart(REAL);
  assert.ok(Math.abs(sh.c) > 1e-12, 'a curve that is not log-linear needs a non-zero C');
  for (const celsius of [-40, -5, 25, 60, 125]) {
    const r = steinhartResistance(celsius, sh);
    near(steinhartTemperature(r, sh), celsius, 1e-8);
  }
  assert.throws(() => steinhartResistance(25, { a: 1e-3, b: 2e-4, c: 0 }), /C must be non-zero/);
});

/*
 * Beta is not an alternative to Steinhart-Hart, it is the C = 0 case of it:
 * 1/T = 1/T0 + ln(R/R0)/B is linear in ln(R), and the cubic term is what a
 * real part's curvature needs. Fitting three points off a Beta curve
 * therefore has to return C = 0 and reproduce Beta everywhere, not just at
 * the three points.
 */
test('Beta is the C = 0 case of Steinhart-Hart', () => {
  const sh = fitSteinhartHart([-40, 25, 125].map((c) => ({ celsius: c, resistance: resistanceAt(c, NTC) })));
  assert.ok(Math.abs(sh.c) < 1e-15, `C should vanish for a log-linear curve, got ${sh.c}`);
  near(sh.b, 1 / NTC.beta, 1e-9);
  for (const celsius of [-40, -10, 25, 70, 125]) {
    near(steinhartTemperature(resistanceAt(celsius, NTC), sh), celsius, 1e-9);
  }
});

// A part with curvature is where the two models separate, which is the whole
// argument for carrying three coefficients instead of one.
test('the two models separate on a curve that is not log-linear', () => {
  const sh = fitSteinhartHart(REAL);
  for (const point of REAL) {
    near(steinhartTemperature(point.resistance, sh), point.celsius, 1e-9);
  }
  /*
   * A Beta fitted at 25/85 reads about 0.65 °C high at -40 on this curve.
   * Small, but larger than the accuracy an NTC is usually chosen for, and
   * it is the error the third coefficient removes.
   */
  const betaSaid = temperatureAt(REAL[0].resistance, NTC);
  const off = Math.abs(betaSaid - -40);
  assert.ok(off > 0.3, `Beta should be visibly off at -40, was ${betaSaid}`);
  assert.ok(off < 5, `${off} °C is too far apart to be the same part`);
  near(steinhartTemperature(REAL[0].resistance, fitSteinhartHart(REAL)), -40, 1e-9);
});

test('a fit needs three distinct points', () => {
  assert.throws(() => fitSteinhartHart([{ resistance: 10000, celsius: 25 }]), /Three measurements/);
  assert.throws(
    () =>
      fitSteinhartHart([
        { resistance: 10000, celsius: 25 },
        { resistance: 10000, celsius: 50 },
        { resistance: 3000, celsius: 85 },
      ]),
    /resistances must differ/,
  );
  assert.throws(
    () =>
      fitSteinhartHart([
        { resistance: 10000, celsius: -300 },
        { resistance: 5000, celsius: 50 },
        { resistance: 3000, celsius: 85 },
      ]),
    /above absolute zero/,
  );
});

/* ------------------------------------------------------- the divider */

test('a half-scale reading means the two resistors are equal', () => {
  for (const topology of ['pullup', 'pulldown'] as const) {
    near(resistanceFromCounts(2048, 4096, 10000, topology), 10000);
    near(countsFromResistance(10000, 4096, 10000, topology), 2048);
  }
});

// The reading is a fraction of full scale, so the supply never enters. A
// 12-bit and a 16-bit ADC reading the same divider report the same ohms.
test('resistance is ratiometric, so ADC width does not change it', () => {
  const twelve = resistanceFromCounts(1000, 4095, 10000, 'pullup');
  const sixteen = resistanceFromCounts((1000 / 4095) * 65535, 65535, 10000, 'pullup');
  near(twelve, sixteen, 1e-9);
});

test('counts and resistance invert each other in both topologies', () => {
  for (const topology of ['pullup', 'pulldown'] as const) {
    for (const counts of [1, 500, 2048, 4000, 4094]) {
      const r = resistanceFromCounts(counts, 4095, 10000, topology);
      near(countsFromResistance(r, 4095, 10000, topology), counts, 1e-9);
    }
  }
});

// The two wirings move the reading in opposite directions. Swapping them
// gives a value that changes by the right amount the wrong way, which reads
// as a wiring fault rather than a software one.
test('the two topologies run opposite ways', () => {
  const cold = resistanceAt(0, NTC);
  const hot = resistanceAt(80, NTC);
  const pullupCold = countsFromResistance(cold, 4095, 10000, 'pullup');
  const pullupHot = countsFromResistance(hot, 4095, 10000, 'pullup');
  assert.ok(pullupCold > pullupHot, 'with the NTC to ground, counts fall as it warms');

  const downCold = countsFromResistance(cold, 4095, 10000, 'pulldown');
  const downHot = countsFromResistance(hot, 4095, 10000, 'pulldown');
  assert.ok(downHot > downCold, 'the other way round, counts rise as it warms');
});

test('readings at the rails are reported as an open circuit', () => {
  assert.throws(() => resistanceFromCounts(4095, 4095, 10000, 'pullup'), /open circuit/);
  assert.throws(() => resistanceFromCounts(0, 4095, 10000, 'pulldown'), /open circuit/);
  assert.throws(() => resistanceFromCounts(-1, 4095, 10000, 'pullup'), /between 0 and 4095/);
  assert.throws(() => resistanceFromCounts(4096, 4095, 10000, 'pullup'), /between 0 and 4095/);
  assert.throws(() => resistanceFromCounts(100, 0, 10000, 'pullup'), /Full scale/);
});

/* ----------------------------------------------------- design checks */

// Sensitivity peaks where the thermistor matches the fixed resistor and falls
// away either side, which is the argument for choosing the fixed resistor to
// suit the range that matters rather than to match R25 out of habit.
test('resolution is best where the thermistor matches the fixed resistor', () => {
  const at25 = resolutionAt(25, NTC, 4095, 10000, 'pullup');
  const at100 = resolutionAt(100, NTC, 4095, 10000, 'pullup');
  const atMinus30 = resolutionAt(-30, NTC, 4095, 10000, 'pullup');
  assert.ok(at25 < at100, `${at25} should be finer than ${at100}`);
  assert.ok(at25 < atMinus30, `${at25} should be finer than ${atMinus30}`);
  assert.ok(at25 < 0.1, `${at25} °C per count near the match point`);
});

test('self-heating follows the current through the part', () => {
  const { power, rise } = selfHeating(10000, 3.3, 10000, 2);
  // 3.3 V across 20 kΩ is 165 µA; 165 µA² × 10 kΩ = 272.25 µW.
  near(power, 0.00027225, 1e-9);
  near(rise, 0.1361, 1e-3);

  // Doubling the fixed resistor cuts the current and the heating with it.
  const gentler = selfHeating(10000, 3.3, 20000, 2);
  assert.ok(gentler.rise < rise / 2);
  assert.throws(() => selfHeating(10000, 3.3, 10000, 0), /dissipation constant/);
});

test('a table walks the range and stops where it is told', () => {
  const rows = table(-20, 100, 20, NTC, 4095, 10000, 'pullup');
  assert.equal(rows.length, 7);
  assert.equal(rows[0].celsius, -20);
  near(rows[rows.length - 1].celsius, 100, 1e-9);
  const at25 = table(25, 25, 5, NTC, 4095, 10000, 'pullup');
  assert.equal(at25.length, 1);
  assert.equal(at25[0].resistance, 10000);
  assert.throws(() => table(0, 100, 0, NTC, 4095, 10000, 'pullup'), /step must be/);
  assert.throws(() => table(100, 0, 5, NTC, 4095, 10000, 'pullup'), /must not be below/);
  assert.throws(() => table(0, 10000, 1, NTC, 4095, 10000, 'pullup'), /more than 1000 rows/);
});
