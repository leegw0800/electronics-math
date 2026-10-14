import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIES_NAMES,
  SERIES_TOLERANCE,
  baseValues,
  geometricValue,
  nearest,
  neighbours,
  isStandard,
  formatOhms,
  parseOhms,
} from './eseries.ts';

test('each series has the number of values its name says', () => {
  for (const name of SERIES_NAMES) {
    assert.equal(baseValues(name).length, Number(name.slice(1)), name);
  }
});

test('every series is strictly increasing within [1, 10)', () => {
  for (const name of SERIES_NAMES) {
    const values = baseValues(name);
    assert.equal(values[0], 1);
    assert.ok(values[values.length - 1] < 10);
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1], `${name} is not increasing at ${i}`);
    }
  }
});

test('the coarser series are subsets of the finer ones', () => {
  const contains = (outer: number[], inner: number[]) => inner.every((v) => outer.includes(v));
  assert.ok(contains(baseValues('E12'), baseValues('E6')));
  assert.ok(contains(baseValues('E24'), baseValues('E12')));
  assert.ok(contains(baseValues('E96'), baseValues('E48')));
  assert.ok(contains(baseValues('E192'), baseValues('E96')));
});

test('E24 keeps the historical values the formula would not produce', () => {
  // These four are the well-known cases where the published table and
  // 10^(i/24) disagree; they are the reason E24 is tabulated, not computed.
  const e24 = baseValues('E24');
  for (const v of [2.7, 3.3, 3.9, 4.7]) assert.ok(e24.includes(v), `E24 lacks ${v}`);
  assert.equal(geometricValue(24, 10), 2.61); // the formula's answer for position 10 is not 2.7
});

test('the formula reproduces the published E96 table at every position', () => {
  const e96 = baseValues('E96');
  for (let i = 0; i < 96; i++) {
    assert.equal(geometricValue(96, i), e96[i], `E96 position ${i}`);
  }
});

test('E192 carries the one published exception to the formula', () => {
  const e192 = baseValues('E192');
  assert.equal(e192[185], 9.2);
  assert.equal(geometricValue(192, 185), 9.19, 'the formula alone gives 9.19 here');
  assert.ok(!e192.includes(9.19));
});

test('tolerance is tighter for finer series', () => {
  let previous = 1;
  for (const name of SERIES_NAMES) {
    assert.ok(SERIES_TOLERANCE[name] < previous);
    previous = SERIES_TOLERANCE[name];
  }
});

test('nearest snaps across decades and handles the top of a decade', () => {
  assert.equal(nearest(5151.5, 'E24'), 5100);
  assert.equal(nearest(4700, 'E6'), 4700);
  assert.equal(nearest(9800, 'E24'), 10000); // 10k is nearer than 9.1k
  assert.equal(nearest(0.1, 'E12'), 0.1);
  assert.equal(nearest(1, 'E192'), 1);
  assert.equal(nearest(6.233e3, 'E96'), 6190);
  assert.throws(() => nearest(0, 'E24'), /positive/);
  assert.throws(() => nearest(-5, 'E24'), /positive/);
});

test('neighbours bracket a value with the standard values either side', () => {
  assert.deepEqual(neighbours(5151.5, 'E24'), { below: 5100, above: 5600 });
  assert.deepEqual(neighbours(9800, 'E24'), { below: 9100, above: 10000 });
  assert.deepEqual(neighbours(1050, 'E24'), { below: 1000, above: 1100 });
});

test('isStandard is exact, not approximate', () => {
  assert.equal(isStandard(4700, 'E24'), true);
  assert.equal(isStandard(4750, 'E24'), false);
  assert.equal(isStandard(4750, 'E96'), true);
});

test('formatOhms uses the prefix engineers expect', () => {
  assert.equal(formatOhms(4700), '4.7k');
  assert.equal(formatOhms(10000), '10k');
  assert.equal(formatOhms(470), '470');
  assert.equal(formatOhms(1e6), '1M');
  assert.equal(formatOhms(0.22), '0.22');
  assert.equal(formatOhms(4750), '4.75k');
  assert.equal(formatOhms(9760000), '9.76M');
  assert.equal(formatOhms(1010), '1.01k');
  assert.equal(formatOhms(976), '976');
});

test('parseOhms reads every common spelling', () => {
  assert.equal(parseOhms('4.7k'), 4700);
  assert.equal(parseOhms('4k7'), 4700);
  assert.equal(parseOhms('10M'), 1e7);
  assert.equal(parseOhms('470'), 470);
  assert.equal(parseOhms('470R'), 470);
  assert.equal(parseOhms('0.22'), 0.22);
  assert.equal(parseOhms('2M2'), 2.2e6);
  assert.equal(parseOhms('100 ohm'), 100);
  assert.equal(parseOhms('1kΩ'), 1000);
  assert.equal(parseOhms('220m'), 0.22); // milli, not mega
  assert.throws(() => parseOhms(''), /Enter a resistance/);
  assert.throws(() => parseOhms('abc'), /not a resistance/);
  assert.throws(() => parseOhms('4.7k7'), /mixes/);
});
