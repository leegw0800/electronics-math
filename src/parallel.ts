/**
 * Resistors in parallel and in series, and the reverse problem.
 *
 * Forwards is one formula — 1/Rt = Σ 1/Ri in parallel, Rt = Σ Ri in series.
 * The part worth writing carefully is backwards: you need 3.3k, you have a
 * drawer of E12 parts, and no single one is close enough. Two in parallel will
 * land nearer than either alone, and `pairsFor` searches the series for the
 * combination that lands nearest.
 *
 * That search is why this is a module and not a line in a component. A naive
 * loop over every pair in every decade is tens of thousands of combinations
 * and most of them are the same ratio scaled by ten; `pairsFor` walks one
 * resistor over the decades that can possibly contribute and solves for the
 * other, which is a few hundred candidates with no duplicates.
 */
import { type SeriesName, baseValues, nearest } from './eseries.ts';

/** Total of resistors wired in parallel. */
export function parallel(values: number[]): number {
  if (values.length === 0) throw new Error('Enter at least one resistor.');
  for (const r of values) {
    if (!Number.isFinite(r)) throw new Error('Every resistance must be a number.');
    if (r <= 0) throw new Error('Every resistance must be greater than zero — a zero-ohm leg is a short.');
  }
  return 1 / values.reduce((sum, r) => sum + 1 / r, 0);
}

/** Total of resistors wired in series. */
export function series(values: number[]): number {
  if (values.length === 0) throw new Error('Enter at least one resistor.');
  for (const r of values) {
    if (!Number.isFinite(r)) throw new Error('Every resistance must be a number.');
    if (r < 0) throw new Error('A resistance cannot be negative.');
  }
  return values.reduce((sum, r) => sum + r, 0);
}

/**
 * The partner that puts `known` in parallel onto `target`.
 *
 * Returns null when it cannot be done: a parallel combination is always
 * smaller than its smallest leg, so no partner brings 1k up to 2k, and a
 * partner for a target equal to `known` would have to be infinite.
 */
export function partnerFor(target: number, known: number): number | null {
  if (!(target > 0) || !(known > 0)) throw new Error('Both values must be greater than zero.');
  if (known <= target) return null;
  return (target * known) / (known - target);
}

export interface Pair {
  r1: number;
  r2: number;
  /** What the pair actually measures. */
  total: number;
  /** Signed, relative to the target, in percent. */
  errorPct: number;
}

/**
 * The largest leg worth pairing, as a multiple of the target.
 *
 * A leg far above the target needs a partner barely below it: at 100x the
 * partner is within 1% of the target itself, so the pair is "the value you
 * wanted, plus a resistor that does nothing". Those dominate the results for
 * any target that is already close to a standard value — the first run of this
 * search answered a 3.3k target with 3.3k ‖ 9.1M, three times over — and they
 * are not what anyone means by a parallel pair.
 */
const MAX_LEG_RATIO = 100;

/**
 * The standard pairs that land closest to a target in parallel.
 *
 * Both legs come from the same series, which is how a drawer of parts
 * actually looks. A leg below the target cannot help, and a leg above
 * `MAX_LEG_RATIO` times it is a trim resistor rather than half of a pair.
 *
 * Ties are broken by the smaller second leg, which prefers a compact pair over
 * a wide one that lands equally close.
 */
export function pairsFor(target: number, seriesName: SeriesName, limit = 8): Pair[] {
  if (!(target > 0)) throw new Error('The target must be greater than zero.');

  const mantissas = baseValues(seriesName);
  const decades = decadesAround(target);
  const seen = new Set<string>();
  const out: Pair[] = [];

  for (const decade of decades) {
    for (const mantissa of mantissas) {
      const r1 = round(mantissa * decade);
      // Only legs above the target can be paired down onto it, and only by
      // enough that the partner is a real second resistor.
      if (r1 <= target) continue;
      if (r1 > target * MAX_LEG_RATIO) continue;

      const ideal = partnerFor(target, r1);
      if (ideal === null || !Number.isFinite(ideal)) continue;

      const r2 = nearest(ideal, seriesName);
      if (!(r2 > 0)) continue;

      const [lo, hi] = r1 <= r2 ? [r1, r2] : [r2, r1];
      const key = `${lo}/${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const total = parallel([lo, hi]);
      out.push({ r1: lo, r2: hi, total, errorPct: ((total - target) / target) * 100 });
    }
  }

  out.sort((a, b) => Math.abs(a.errorPct) - Math.abs(b.errorPct) || a.r2 - b.r2 || a.r1 - b.r1);
  return out.slice(0, limit);
}

/** Decades a useful leg can come from, given a target. */
function decadesAround(target: number): number[] {
  const base = Math.pow(10, Math.floor(Math.log10(target)));
  // Three decades covers everything inside MAX_LEG_RATIO; the fourth only
  // produced legs the cap rejects.
  return [base, base * 10, base * 100];
}

/** Keeps 2200.0000000000005 out of the results. */
const round = (value: number): number => Number(value.toPrecision(12));

export { formatOhms, parseOhms, SERIES_NAMES, type SeriesName } from './eseries.ts';
