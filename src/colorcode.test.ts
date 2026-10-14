import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_VALUES,
  decode,
  encode,
  rNotation,
  seriesForTolerance,
  DIGIT_COLORS,
  MULTIPLIER,
  TOLERANCE,
  TEMPCO,
  type Color,
} from './colorcode.ts';
import { baseValues, isStandard } from './eseries.ts';

test('the yellow-violet-red-gold everyone learns first is 4.7k 5%', () => {
  const d = decode(['yellow', 'violet', 'red', 'gold']);
  assert.equal(d.value, 4700);
  assert.equal(d.tolerance, 0.05);
  assert.equal(d.min, 4465);
  assert.equal(d.max, 4935);
  assert.equal(d.series, 'E24');
  assert.equal(d.isStandard, true);
  assert.equal(d.nearest, null);
  assert.equal(d.tempco, null);
});

test('five and six bands carry a third digit and a temperature coefficient', () => {
  const five = decode(['brown', 'black', 'black', 'red', 'brown']);
  assert.equal(five.value, 10000);
  assert.equal(five.tolerance, 0.01);
  assert.equal(five.series, 'E96');
  assert.equal(five.isStandard, true);

  const six = decode(['brown', 'black', 'black', 'red', 'brown', 'red']);
  assert.equal(six.value, 10000);
  assert.equal(six.tempco, 50);
  assert.equal(six.reversed, null, 'six-band codes are not checked backwards');
});

test('gold and silver as multipliers give values under ten ohms', () => {
  assert.equal(decode(['red', 'red', 'gold', 'gold']).value, 2.2);
  assert.equal(decode(['yellow', 'violet', 'silver', 'gold']).value, 0.47);
  assert.equal(decode(['red', 'red', 'black', 'gold']).value, 22);
});

test('a missing tolerance band means 20%', () => {
  const d = decode(['brown', 'black', 'red', 'none']);
  assert.equal(d.value, 1000);
  assert.equal(d.tolerance, 0.2);
  assert.equal(d.series, 'E6');
});

test('a value nobody makes is flagged with the neighbours that are', () => {
  // Yellow-green-red reads 45 x 100 = 4.5k, which is not an E24 value.
  const d = decode(['yellow', 'green', 'red', 'gold']);
  assert.equal(d.value, 4500);
  assert.equal(d.isStandard, false);
  assert.deepEqual(d.nearest, { below: 4300, above: 4700 });
});

test('a 4-band 1% part is judged against E96, where its 2-digit value may still exist', () => {
  const d = decode(['brown', 'black', 'red', 'brown']); // 1k 1%
  assert.equal(d.series, 'E96');
  assert.equal(d.isStandard, true);
  // 1.1k is in both series (E96 has 1.10). 1.2k is E24 only: E96 goes 1.18, 1.21.
  assert.equal(decode(['brown', 'brown', 'red', 'brown']).isStandard, true);
  assert.equal(decode(['brown', 'red', 'red', 'brown']).isStandard, false);
});

test('a code that is also valid read backwards reports both readings', () => {
  // Brown-black-orange-red is 10k 2%; the same bands the other way are 23 R 1%.
  const forward = decode(['brown', 'black', 'orange', 'red']);
  assert.equal(forward.value, 10000);
  assert.ok(forward.reversed);
  assert.equal(forward.reversed.value, 23);
  assert.equal(forward.reversed.tolerance, 0.01);
  assert.equal(forward.reversed.reversed, null, 'only one level deep');

  const backward = decode(['red', 'orange', 'black', 'brown']);
  assert.equal(backward.value, 23);
  assert.equal(backward.reversed?.value, 10000);

  // Gold cannot start a code, so the common case has no reverse reading.
  assert.equal(decode(['yellow', 'violet', 'red', 'gold']).reversed, null);
});

test('bad codes are refused with the band named', () => {
  assert.throws(() => decode(['red', 'red', 'red']), /four, five or six/);
  assert.throws(() => decode(['gold', 'red', 'red', 'gold']), /first band \(gold\)/);
  assert.throws(() => decode(['red', 'none', 'red', 'gold']), /second band \(none\)/);
  assert.throws(() => decode(['red', 'red', 'none', 'gold']), /third band \(none\) is not a multiplier/);
  assert.throws(() => decode(['red', 'red', 'red', 'orange']), /fourth band \(orange\) is not a tolerance/);
  assert.throws(() => decode(['red', 'red', 'red', 'red', 'brown', 'gold']), /sixth band \(gold\)/);
});

test('encode produces the textbook bands', () => {
  assert.deepEqual(encode(4700, 4, 0.05), ['yellow', 'violet', 'red', 'gold']);
  assert.deepEqual(encode(10000, 5, 0.01), ['brown', 'black', 'black', 'red', 'brown']);
  assert.deepEqual(encode(2.2, 4, 0.05), ['red', 'red', 'gold', 'gold']);
  assert.deepEqual(encode(0.47, 4, 0.05), ['yellow', 'violet', 'silver', 'gold']);
  assert.deepEqual(encode(1e6, 4, 0.1), ['brown', 'black', 'green', 'silver']);
  assert.deepEqual(encode(4750, 5, 0.01), ['yellow', 'violet', 'green', 'brown', 'brown']);
  assert.deepEqual(encode(10000, 5, 0.01, 50), ['brown', 'black', 'black', 'red', 'brown', 'red']);
  assert.deepEqual(encode(1000, 4, 0.2), ['brown', 'black', 'red', 'none']);
});

test('encode refuses what the bands cannot say', () => {
  assert.throws(() => encode(4750, 4, 0.05), /five-band/);
  assert.throws(() => encode(4751, 5, 0.01), /more than three significant/);
  assert.throws(() => encode(4700, 4, 0.03), /not a marked tolerance/);
  assert.throws(() => encode(0, 4, 0.05), /Zero-ohm/);
  assert.throws(() => encode(1e11, 4, 0.05), /outside the range/);
  assert.throws(() => encode(10000, 5, 0.01, 30), /not a marked temperature/);
});

test('every E24 value round-trips through four bands across the decades', () => {
  for (const mantissa of baseValues('E24')) {
    for (const decade of [0.1, 1, 10, 1e3, 1e5, 1e6]) {
      const value = Number((mantissa * decade).toPrecision(12));
      const bands = encode(value, 4, 0.05);
      assert.equal(decode(bands).value, value, `${value}`);
    }
  }
});

test('every E96 value round-trips through five bands', () => {
  for (const mantissa of baseValues('E96')) {
    const value = Number((mantissa * 1000).toPrecision(12));
    assert.equal(decode(encode(value, 5, 0.01)).value, value, `${value}`);
  }
});

test('R notation replaces the point with the unit letter', () => {
  assert.equal(rNotation(4700), '4K7');
  assert.equal(rNotation(470), '470R');
  assert.equal(rNotation(10), '10R');
  assert.equal(rNotation(1500000), '1M5');
  assert.equal(rNotation(0.22), 'R22');
  assert.equal(rNotation(4750), '4K75');
  assert.equal(rNotation(1000), '1K');
  assert.equal(rNotation(100), '100R');
  assert.equal(rNotation(2.2), '2R2');
});

test('tolerance maps to the series it is sold in', () => {
  assert.equal(seriesForTolerance(0.2), 'E6');
  assert.equal(seriesForTolerance(0.1), 'E12');
  assert.equal(seriesForTolerance(0.05), 'E24');
  assert.equal(seriesForTolerance(0.02), 'E48');
  assert.equal(seriesForTolerance(0.01), 'E96');
  assert.equal(seriesForTolerance(0.005), 'E192');
  assert.equal(seriesForTolerance(0.001), 'E192');
});

test('the tables are the IEC 60062 ones', () => {
  assert.equal(DIGIT_COLORS.length, 10);
  assert.equal(DIGIT_COLORS[0], 'black');
  assert.equal(DIGIT_COLORS[9], 'white');
  assert.equal(MULTIPLIER.gold, 0.1);
  assert.equal(MULTIPLIER.silver, 0.01);
  assert.equal(TOLERANCE.gold, 0.05);
  assert.equal(TOLERANCE.silver, 0.1);
  assert.equal(TOLERANCE.brown, 0.01);
  assert.equal(TEMPCO.brown, 100);
  assert.equal(TEMPCO.red, 50);
  assert.equal(TEMPCO.blue, 10);
  const digitsAndMultipliers: Color[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
  for (const c of digitsAndMultipliers) assert.equal(MULTIPLIER[c], 10 ** DIGIT_COLORS.indexOf(c), c);
});

test('every common value is a part that can actually be bought', () => {
  /*
   * The list drives the chart and the colour-sequence lookup, both of which
   * state a value and its bands as fact. A value that is not in E24 has a
   * perfectly valid four-band code and no manufacturer, so putting one in the
   * list would publish bands for a resistor nobody sells.
   */
  for (const value of COMMON_VALUES) {
    assert.ok(isStandard(value, 'E24'), `${value} is not an E24 value`);
    assert.doesNotThrow(() => encode(value, 4, 0.05), `${value} has no four-band code`);
  }

  // Ordered, so the list reads as a reference rather than a ranking.
  const sorted = [...COMMON_VALUES].sort((a, b) => a - b);
  assert.deepEqual([...COMMON_VALUES], sorted, 'the list is out of order');
  assert.equal(new Set(COMMON_VALUES).size, COMMON_VALUES.length, 'duplicate value');
});
