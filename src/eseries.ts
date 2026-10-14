/**
 * IEC 60063 preferred numbers — the E series of standard resistor values.
 *
 * A calculator that answers "5151.5 Ω" has not finished the job, because no
 * such part exists. These tables are what the part you can actually order
 * looks like, so every electronics tool snaps to them and reports the error
 * the snap costs.
 *
 * The series are not all computed the same way. E48 and above follow
 * 10^(i/n) rounded to three significant figures. E6, E12 and E24 predate that
 * formula and were rounded by hand decades ago: E24 lists 2.7, 3.3, 3.9 and
 * 4.7 where the formula gives 2.6, 3.2, 3.8 and 4.6. Computing them would be
 * wrong, so they are tabulated.
 */

export type SeriesName = 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'E192';

export const SERIES_NAMES: SeriesName[] = ['E6', 'E12', 'E24', 'E48', 'E96', 'E192'];

/** The tolerance each series is normally sold at, as a fraction. */
export const SERIES_TOLERANCE: Record<SeriesName, number> = {
  E6: 0.2,
  E12: 0.1,
  E24: 0.05,
  E48: 0.02,
  E96: 0.01,
  E192: 0.005,
};

const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

const E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

// Tabulated rather than computed so the table, not the formula, is the
// authority; the formula is cross-checked against it in the tests.
const E96 = [
  1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24,
  1.27, 1.30, 1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58,
  1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.00,
  2.05, 2.10, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55,
  2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24,
  3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12,
  4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23,
  5.36, 5.49, 5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65,
  6.81, 6.98, 7.15, 7.32, 7.50, 7.68, 7.87, 8.06, 8.25, 8.45,
  8.66, 8.87, 9.09, 9.31, 9.53, 9.76,
];

/** E48 is every second E96 value, by definition of the series. */
const E48 = E96.filter((_, i) => i % 2 === 0);

/** 10^(i/n) rounded to three significant figures, the rule for E48 and up. */
export function geometricValue(n: number, index: number): number {
  return Math.round(10 ** (index / n) * 100) / 100;
}

/**
 * IEC 60063 lists 9.20 at E192 position 185, where 10^(185/192) = 9.1948
 * rounds to 9.19. It is the one place the published table and the formula
 * disagree above E24, so it is written down rather than left to arithmetic.
 */
const E192_OVERRIDES: Record<number, number> = { 185: 9.2 };

// Even positions are the E96 table (authoritative); odd positions come from
// the formula, which the tests confirm reproduces E96 at the even ones.
const E192 = Array.from({ length: 192 }, (_, i) =>
  i in E192_OVERRIDES ? E192_OVERRIDES[i] : i % 2 === 0 ? E96[i / 2] : geometricValue(192, i),
);

const TABLES: Record<SeriesName, number[]> = { E6, E12, E24, E48, E96, E192 };

/** The values in one decade, [1, 10), for a series. */
export function baseValues(series: SeriesName): number[] {
  return TABLES[series];
}

/** Trims the float noise that `mantissa * 10^decade` leaves behind. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/** floor(log10) with the float error at exact powers of ten corrected. */
function decadeOf(value: number): number {
  let decade = Math.floor(Math.log10(value));
  if (value / 10 ** decade >= 10) decade += 1;
  if (value / 10 ** decade < 1) decade -= 1;
  return decade;
}

/** Nearest standard value in the series, across every decade. */
export function nearest(value: number, series: SeriesName): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error('Resistance must be a positive number.');
  }
  const decade = decadeOf(value);
  const scale = 10 ** decade;
  // The next decade's first value is a candidate too: 9.8 is closer to 10 than
  // to 9.1, and 10 lives in the next table row.
  const candidates = [...baseValues(series).map((m) => m * scale), 10 * scale];
  let best = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return clean(best);
}

/** The standard values immediately below and above, for showing the choice. */
export function neighbours(value: number, series: SeriesName): { below: number; above: number } {
  const decade = decadeOf(value);
  const scale = 10 ** decade;
  const row = [...baseValues(series).map((m) => m * scale), 10 * scale];
  let below = baseValues(series)[baseValues(series).length - 1] * (scale / 10);
  let above = 10 * scale;
  for (const candidate of row) {
    if (candidate < value) below = candidate;
    if (candidate > value) {
      above = candidate;
      break;
    }
  }
  return { below: clean(below), above: clean(above) };
}

/** True when the value is exactly a member of the series. */
export function isStandard(value: number, series: SeriesName): boolean {
  return Math.abs(nearest(value, series) - value) < value * 1e-9;
}

/* --------------------------------------------------------------- formatting */

/** 4700 -> "4.7k", 1e6 -> "1M", 0.22 -> "0.22". Up to three significant figures. */
export function formatOhms(value: number): string {
  const prefixes: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
  ];
  for (const [scale, prefix] of prefixes) {
    if (value >= scale * 0.9995) {
      const mantissa = value / scale;
      const text = mantissa >= 100 ? mantissa.toPrecision(4) : mantissa.toPrecision(3);
      return `${Number(text)}${prefix}`;
    }
  }
  return String(Number(value.toPrecision(3)));
}

/**
 * Accepts the ways engineers actually write resistance: "4.7k", "4k7", "10M",
 * "470", "470R", "1 kΩ", "2M2". A lower-case m is milli and an upper-case M
 * is mega, which is the one place the case matters.
 */
export function parseOhms(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('Enter a resistance.');

  const match = /^(\d+)(?:[.,](\d+))?\s*([kKMmRrΩ]?)\s*(\d*)\s*(?:ohms?|Ω)?$/.exec(trimmed);
  if (!match) throw new Error(`"${trimmed}" is not a resistance. Try 4.7k, 4k7, 470R or 1M.`);

  const [, whole, fraction, prefix, trailing] = match;
  if (fraction !== undefined && trailing !== '') {
    throw new Error(`"${trimmed}" mixes a decimal point with the 4k7 style; use one or the other.`);
  }

  const mantissa = Number(`${whole}.${fraction ?? trailing ?? '0'}`);
  const multiplier =
    prefix === 'k' || prefix === 'K' ? 1e3 : prefix === 'M' ? 1e6 : prefix === 'm' ? 1e-3 : 1;

  const value = mantissa * multiplier;
  if (!(value > 0)) throw new Error('Resistance must be greater than zero.');
  return clean(value);
}
