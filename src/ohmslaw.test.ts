import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS, QUANTITIES, formulas, solve, wheel, type Quantity, type Values } from './ohmslaw.ts';

/**
 * Checked against worked examples rather than against itself.
 *
 * The figures below are the ones a datasheet or a textbook uses — a 220Ω LED
 * resistor on 5V, a 60W bulb on 120V, a 1kΩ pull-up on 3.3V — so a transcribed
 * formula that happens to be self-consistent still fails here.
 */

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test('every pair of inputs reproduces the same circuit', () => {
  /*
   * One circuit — 12V across 4Ω, so 3A and 36W — fed in as each of the six
   * pairs. All six have to come back to the same four numbers, which is the
   * property that catches a single mistyped formula.
   */
  const truth: Values = { v: 12, i: 3, r: 4, p: 36 };

  const pairs: [Quantity, Quantity][] = [
    ['v', 'i'],
    ['v', 'r'],
    ['v', 'p'],
    ['i', 'r'],
    ['i', 'p'],
    ['r', 'p'],
  ];

  for (const [a, b] of pairs) {
    const result = solve({ [a]: truth[a], [b]: truth[b] });
    for (const q of QUANTITIES) close(result[q], truth[q], 1e-12);
    assert.deepEqual(result.from, [a, b].sort((x, y) => QUANTITIES.indexOf(x as Quantity) - QUANTITIES.indexOf(y as Quantity)));
  }
});

test('a 220 ohm LED resistor on 5 V', () => {
  // The most-built circuit there is: 5 V, 220 Ω.
  const r = solve({ v: 5, r: 220 });
  close(r.i, 0.022727272727, 1e-9);
  close(r.p, 0.113636363636, 1e-9);
});

test('a 60 W bulb on 120 V draws half an amp through 240 ohms', () => {
  const r = solve({ p: 60, v: 120 });
  close(r.i, 0.5);
  close(r.r, 240);
});

test('a 1 kohm pull-up on 3.3 V', () => {
  const r = solve({ v: 3.3, r: 1000 });
  close(r.i, 0.0033);
  close(r.p, 0.01089, 1e-9);
});

test('power from resistance works both ways round', () => {
  // R and P is the one pair that needs a square root, so it gets its own case.
  const r = solve({ r: 100, p: 1 });
  close(r.v, 10);
  close(r.i, 0.1);
});

test('zero is allowed where it means something', () => {
  /*
   * No current through a resistor is a real state: no volts across it and no
   * power in it. That must not be confused with the cases below.
   */
  const r = solve({ i: 0, r: 470 });
  close(r.v, 0);
  close(r.p, 0);
});

test('and refused where it would print a number that is not an answer', () => {
  /*
   * Each of these would otherwise produce Infinity or NaN and render as though
   * it were a result. The message has to say which quantity is the problem.
   */
  assert.throws(() => solve({ v: 5, r: 0 }), /short/);
  assert.throws(() => solve({ v: 5, i: 0 }), /resistance/);
  assert.throws(() => solve({ p: 1, i: 0 }), /voltage/);
  assert.throws(() => solve({ p: 1, v: 0 }), /current/);
  assert.throws(() => solve({ p: 1, r: 0 }), /no power/);
});

test('fewer or more than two inputs is refused', () => {
  assert.throws(() => solve({ v: 5 }), /any two/);
  assert.throws(() => solve({}), /any two/);
  assert.throws(() => solve({ v: 5, i: 1, r: 5 }), /exactly two/);
});

test('negative and non-finite inputs are refused by name', () => {
  assert.throws(() => solve({ v: -5, r: 100 }), /voltage cannot be negative/);
  assert.throws(() => solve({ v: 5, r: -100 }), /resistance cannot be negative/);
  assert.throws(() => solve({ i: 1, p: -2 }), /power cannot be negative/);
  assert.throws(() => solve({ v: Number.NaN, r: 100 }), /voltage must be a number/);
  assert.throws(() => solve({ v: 5, r: Number.POSITIVE_INFINITY }), /resistance must be a number/);
});

test('the formulas shown match the pair that was entered', () => {
  // The page prints these as the working, so a wrong label is a wrong answer
  // even when the arithmetic is right.
  assert.deepEqual(formulas(['v', 'i']), ['R = V / I', 'P = V × I']);
  assert.deepEqual(formulas(['i', 'v']), ['R = V / I', 'P = V × I']);
  assert.deepEqual(formulas(['v', 'r']), ['I = V / R', 'P = V² / R']);
  assert.deepEqual(formulas(['v', 'p']), ['I = P / V', 'R = V² / P']);
  assert.deepEqual(formulas(['i', 'r']), ['V = I × R', 'P = I² × R']);
  assert.deepEqual(formulas(['i', 'p']), ['V = P / I', 'R = P / I²']);
  assert.deepEqual(formulas(['r', 'p']), ['V = √(P × R)', 'I = √(P / R)']);
});

test('results stay consistent across a sweep, not just at the checked points', () => {
  /*
   * A round trip over a wide range: compute from V and R, then feed each
   * other pair of the results back in and require the same circuit out.
   */
  for (const v of [0.001, 1.8, 3.3, 5, 12, 48, 230]) {
    for (const r of [0.1, 10, 220, 4700, 1e6]) {
      const base = solve({ v, r });
      for (const [a, b] of [['i', 'r'], ['v', 'p'], ['r', 'p'], ['i', 'p']] as [Quantity, Quantity][]) {
        const again = solve({ [a]: base[a], [b]: base[b] });
        for (const q of QUANTITIES) close(again[q], base[q], 1e-9);
      }
    }
  }
});

test('the wheel is the same twelve formulas, three to each quantity', () => {
  /*
   * The page draws a wheel chart from this. A wheel that disagreed with the
   * calculator beside it would be worse than no wheel at all, so it is derived
   * from `formulas()` and this holds the derivation to the arrangement every
   * printed wheel uses: four quadrants, three ways into each quantity.
   */
  const w = wheel();
  const fromPairs = PAIRS.flatMap((pair) => formulas(pair));

  assert.equal(fromPairs.length, 12);
  assert.equal(new Set(fromPairs).size, 12, 'a formula is listed twice');

  for (const q of QUANTITIES) {
    assert.equal(w[q].length, 3, `${q} has ${w[q].length} formulas, not 3`);
    for (const formula of w[q]) {
      assert.equal(formula[0]!.toLowerCase(), q, `${formula} is filed under ${q}`);
      assert.ok(fromPairs.includes(formula), `${formula} is not one the solver uses`);
    }
  }

  assert.deepEqual(
    QUANTITIES.flatMap((q) => w[q]).slice().sort(),
    fromPairs.slice().sort(),
    'the wheel and the solver do not hold the same set',
  );
});

test('every formula on the wheel actually computes its quantity', () => {
  /*
   * Not a string check: each of the twelve is evaluated against a known case
   * and has to land on the same number the solver does. A typo in a superscript
   * or a swapped numerator reads fine and fails here.
   */
  const truth: Values = { v: 12, i: 0.5, r: 24, p: 6 };
  const { v, i, r, p } = truth;
  const evaluate: Record<string, number> = {
    'V = I × R': i * r,
    'V = P / I': p / i,
    'V = √(P × R)': Math.sqrt(p * r),
    'I = V / R': v / r,
    'I = P / V': p / v,
    'I = √(P / R)': Math.sqrt(p / r),
    'R = V / I': v / i,
    'R = V² / P': (v * v) / p,
    'R = P / I²': p / (i * i),
    'P = V × I': v * i,
    'P = V² / R': (v * v) / r,
    'P = I² × R': i * i * r,
  };

  const w = wheel();
  for (const q of QUANTITIES) {
    for (const formula of w[q]) {
      const got = evaluate[formula];
      assert.notEqual(got, undefined, `${formula} is not covered by this test`);
      assert.ok(Math.abs(got! - truth[q]) < 1e-9, `${formula} gave ${got}, not ${truth[q]}`);
    }
  }
});
