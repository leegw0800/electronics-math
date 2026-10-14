import test from 'node:test';
import assert from 'node:assert/strict';
import { pairsFor, parallel, partnerFor, series } from './parallel.ts';

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test('the cases everyone knows by heart', () => {
  // Two equal resistors halve; N equal resistors divide by N.
  close(parallel([1000, 1000]), 500);
  close(parallel([100, 100, 100, 100]), 25);
  close(parallel([4700]), 4700);

  // The worked example from every textbook: 6 and 3 in parallel is 2.
  close(parallel([6, 3]), 2);
  // And 10 with 40 is 8.
  close(parallel([10, 40]), 8);
});

test('series is the sum, including the degenerate cases', () => {
  close(series([1000, 2200, 470]), 3670);
  close(series([4700]), 4700);
  close(series([1000, 0]), 1000);
});

test('a parallel total is always below the smallest leg', () => {
  /*
   * The property that makes the reverse problem solvable, and the one a
   * transposed formula breaks.
   */
  for (const legs of [[1000, 2200], [10, 1e6], [47, 47, 47], [1, 2, 3, 4, 5]]) {
    const total = parallel(legs);
    assert.ok(total < Math.min(...legs), `${total} is not below ${Math.min(...legs)}`);
    assert.ok(total > 0);
  }
});

test('a zero-ohm leg is refused rather than returning zero', () => {
  /*
   * Arithmetically a 0Ω leg gives a 0Ω total, which is correct and useless —
   * it means the thing has been shorted out, not that a resistance was
   * computed.
   */
  assert.throws(() => parallel([1000, 0]), /short/);
  assert.throws(() => parallel([-100, 1000]), /greater than zero/);
  assert.throws(() => parallel([]), /at least one/);
  assert.throws(() => parallel([1000, Number.NaN]), /must be a number/);
});

test('the partner that lands a known resistor on a target', () => {
  // 1k in parallel with 1k is 500, so the partner for 500 given 1k is 1k.
  close(partnerFor(500, 1000)!, 1000);
  // 2 given 3 is 6, from the 6‖3 = 2 example read backwards.
  close(partnerFor(2, 3)!, 6);
  close(partnerFor(8, 10)!, 40);
});

test('and says so when there is no partner', () => {
  /*
   * Parallel only ever goes down. Asking to reach a target at or above the
   * known leg has no answer, and null says that rather than a negative
   * resistance looking like one.
   */
  assert.equal(partnerFor(2000, 1000), null);
  assert.equal(partnerFor(1000, 1000), null);
  assert.throws(() => partnerFor(0, 1000), /greater than zero/);
});

test('standard pairs for a target that no single E12 part reaches', () => {
  /*
   * 3.3k is in E24 but not in E12, where the neighbours are 2.7k and 3.9k —
   * 18% and 18% out. A pair has to do better than that to be worth showing.
   */
  const pairs = pairsFor(3300, 'E12', 5);
  assert.ok(pairs.length > 0);
  assert.ok(
    Math.abs(pairs[0]!.errorPct) < 1,
    `best E12 pair for 3.3k is ${pairs[0]!.errorPct.toFixed(2)}% out: ${pairs[0]!.r1}‖${pairs[0]!.r2}`,
  );
  // And the reported total is what those two actually make.
  close(pairs[0]!.total, parallel([pairs[0]!.r1, pairs[0]!.r2]), 1e-12);
});

test('every pair is ordered, distinct, and really in the series', () => {
  const pairs = pairsFor(1234, 'E24', 20);
  const seen = new Set<string>();
  for (const pair of pairs) {
    assert.ok(pair.r1 <= pair.r2, `${pair.r1} > ${pair.r2}: pairs should be ordered`);
    const key = `${pair.r1}/${pair.r2}`;
    assert.ok(!seen.has(key), `duplicate pair ${key}`);
    seen.add(key);
    close(pair.total, parallel([pair.r1, pair.r2]), 1e-12);
  }
});

test('results are sorted by how close they land', () => {
  const pairs = pairsFor(5000, 'E12', 10);
  const errors = pairs.map((p) => Math.abs(p.errorPct));
  assert.deepEqual(errors, [...errors].sort((a, b) => a - b));
});

test('a target that is itself a standard value still gets exact pairs', () => {
  // 500Ω from two 1k parts, which the search must find rather than skip
  // because the target is reachable another way.
  const pairs = pairsFor(500, 'E12', 8);
  assert.ok(pairs.some((p) => p.r1 === 1000 && p.r2 === 1000), JSON.stringify(pairs.slice(0, 3)));
  close(pairs[0]!.errorPct, 0, 1e-9);
});

test('a finer series lands closer than a coarse one', () => {
  /*
   * The reason the series is a control on the page. If E96 did not beat E12
   * the search would be ignoring most of the parts it was given.
   */
  for (const target of [3300, 1234, 47_000, 68]) {
    const coarse = Math.abs(pairsFor(target, 'E12', 1)[0]!.errorPct);
    const fine = Math.abs(pairsFor(target, 'E96', 1)[0]!.errorPct);
    assert.ok(fine <= coarse + 1e-9, `${target}: E96 ${fine}% is worse than E12 ${coarse}%`);
  }
});

test('targets across nine decades all find something', () => {
  for (const target of [0.5, 5, 50, 500, 5000, 50_000, 500_000, 5e6]) {
    const pairs = pairsFor(target, 'E24', 3);
    assert.ok(pairs.length > 0, `nothing for ${target}`);
    assert.ok(Math.abs(pairs[0]!.errorPct) < 5, `${target}: best is ${pairs[0]!.errorPct}% out`);
  }
});

test('a leg so large it does nothing is not offered as half a pair', () => {
  /*
   * The first version answered a 3.3k target with 3.3k and 9.1M, three times
   * over with different megohm partners. All of them land within 0.05%, and
   * all of them mean "use a 3.3k and add a resistor that changes nothing".
   *
   * A pair is two resistors that both matter, so a leg beyond 100x the target
   * — where the partner is within 1% of the target itself — is excluded.
   */
  for (const [target, seriesName] of [[3300, 'E24'], [1000, 'E12'], [47, 'E24']] as const) {
    for (const pair of pairsFor(target, seriesName, 8)) {
      assert.ok(
        pair.r2 <= target * 100,
        `${target}: ${pair.r1}‖${pair.r2} — the second leg is ${(pair.r2 / target).toFixed(0)}x the target`,
      );
    }
  }
});

test('equally close pairs are ordered by the smaller second leg', () => {
  // So a compact pair beats a wide one that lands the same distance away.
  const pairs = pairsFor(3300, 'E24', 8);
  for (let i = 1; i < pairs.length; i += 1) {
    const before = pairs[i - 1]!;
    const after = pairs[i]!;
    if (Math.abs(before.errorPct) === Math.abs(after.errorPct)) {
      assert.ok(before.r2 <= after.r2, `${before.r1}‖${before.r2} should not precede ${after.r1}‖${after.r2}`);
    }
  }
});

test('an impossible target is refused', () => {
  assert.throws(() => pairsFor(0, 'E12'), /greater than zero/);
  assert.throws(() => pairsFor(-100, 'E12'), /greater than zero/);
});
