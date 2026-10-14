/**
 * Resistor colour code, IEC 60062.
 *
 * Reading the bands is a lookup; the trouble is everything that makes the
 * lookup come out wrong: which end to start from, whether there are four
 * bands or five, brown and red in bad light. So alongside the value this
 * module says whether that value is one anybody manufactures — a resistor
 * that decodes to 4.5 kΩ was almost certainly misread — and what the bands
 * would mean read from the other end when that reading is also valid.
 */
import { type SeriesName, isStandard, neighbours } from './eseries.ts';

export type Color =
  | 'black' | 'brown' | 'red' | 'orange' | 'yellow' | 'green'
  | 'blue' | 'violet' | 'grey' | 'white' | 'gold' | 'silver' | 'none';

/** The ten digit colours, in digit order. */
export const DIGIT_COLORS: Color[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

export const MULTIPLIER: Partial<Record<Color, number>> = {
  black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4, green: 1e5,
  blue: 1e6, violet: 1e7, grey: 1e8, white: 1e9, gold: 0.1, silver: 0.01,
};

/** Tolerance as a fraction. A missing fourth band means ±20 %. */
export const TOLERANCE: Partial<Record<Color, number>> = {
  brown: 0.01, red: 0.02, green: 0.005, blue: 0.0025, violet: 0.001,
  grey: 0.0005, gold: 0.05, silver: 0.1, none: 0.2,
};

/** Temperature coefficient, ppm/K, sixth band. */
export const TEMPCO: Partial<Record<Color, number>> = {
  black: 250, brown: 100, red: 50, orange: 15, yellow: 25, green: 20, blue: 10, violet: 5, grey: 1,
};

/** Display colours for drawing the bands. */
export const SWATCH: Record<Color, string> = {
  black: '#111111', brown: '#7a4a1e', red: '#d62828', orange: '#f77f00', yellow: '#ffd60a',
  green: '#2a9d3f', blue: '#1e5bd6', violet: '#7b2cbf', grey: '#8d8d8d', white: '#f5f5f5',
  gold: '#c9a227', silver: '#b8b8b8', none: 'transparent',
};

export const MULTIPLIER_COLORS = Object.keys(MULTIPLIER) as Color[];
export const TOLERANCE_COLORS = Object.keys(TOLERANCE) as Color[];
export const TEMPCO_COLORS = Object.keys(TEMPCO) as Color[];

/**
 * The values a drawer actually holds, in order.
 *
 * Two components render these — the chart gives the bands for each value, and
 * the lookup list spells the same bands out as a phrase — and a list typed into
 * both is a list that will disagree with itself eventually. Every entry is an
 * E24 value, which `colorcode.test.ts` holds to, so nothing here is a part that
 * cannot be bought.
 */
export const COMMON_VALUES = [
  10, 22, 47, 100, 220, 330, 470,
  1_000, 2_200, 4_700, 10_000, 22_000, 47_000,
  100_000, 220_000, 1_000_000,
] as const;

export type BandCount = 4 | 5 | 6;

export interface Decoded {
  value: number;
  tolerance: number;
  /** ppm/K from a sixth band, otherwise null. */
  tempco: number | null;
  min: number;
  max: number;
  bands: BandCount;
  /** The series this tolerance is normally sold in. */
  series: SeriesName;
  /** Whether the value is actually a member of that series. Null for zero ohms. */
  isStandard: boolean | null;
  /** The standard values either side when the decoded one is not standard. */
  nearest: { below: number; above: number } | null;
  /** What the same bands mean read from the other end, when that is a valid code too. */
  reversed: Decoded | null;
}

/** ±5 % parts are E24, ±1 % are E96, and so on. */
export function seriesForTolerance(tolerance: number): SeriesName {
  if (tolerance >= 0.2) return 'E6';
  if (tolerance >= 0.1) return 'E12';
  if (tolerance >= 0.05) return 'E24';
  if (tolerance >= 0.02) return 'E48';
  if (tolerance >= 0.01) return 'E96';
  return 'E192';
}

function clean(value: number): number {
  return Number(value.toPrecision(12));
}

function position(bands: Color[], index: number): string {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  return `The ${names[index]} band (${bands[index]})`;
}

export function decode(bands: Color[], withReversed = true): Decoded {
  const count = bands.length;
  if (count !== 4 && count !== 5 && count !== 6) {
    throw new Error('A resistor has four, five or six bands.');
  }
  const digitCount = count === 4 ? 2 : 3;

  let digits = 0;
  for (let i = 0; i < digitCount; i++) {
    const d = DIGIT_COLORS.indexOf(bands[i]);
    if (d === -1) throw new Error(`${position(bands, i)} has to be a digit colour — gold, silver and none cannot start a code.`);
    digits = digits * 10 + d;
  }

  const multiplier = MULTIPLIER[bands[digitCount]];
  if (multiplier === undefined) throw new Error(`${position(bands, digitCount)} is not a multiplier colour.`);

  const tolerance = TOLERANCE[bands[digitCount + 1]];
  if (tolerance === undefined) throw new Error(`${position(bands, digitCount + 1)} is not a tolerance colour.`);

  let tempco: number | null = null;
  if (count === 6) {
    const t = TEMPCO[bands[5]];
    if (t === undefined) throw new Error(`${position(bands, 5)} is not a temperature coefficient colour.`);
    tempco = t;
  }

  const value = clean(digits * multiplier);
  const series = seriesForTolerance(tolerance);
  const standard = value > 0 ? isStandard(value, series) : null;

  let reversed: Decoded | null = null;
  if (withReversed && count < 6) {
    try {
      const other = decode([...bands].reverse(), false);
      if (other.value !== value) reversed = other;
    } catch {
      // Reading from the other end is not a valid code, which is the normal case.
    }
  }

  return {
    value,
    tolerance,
    tempco,
    min: clean(value * (1 - tolerance)),
    max: clean(value * (1 + tolerance)),
    bands: count,
    series,
    isStandard: standard,
    nearest: standard === false ? neighbours(value, series) : null,
    reversed,
  };
}

function decadeOf(value: number): number {
  let decade = Math.floor(Math.log10(value));
  if (value / 10 ** decade >= 10) decade += 1;
  if (value / 10 ** decade < 1) decade -= 1;
  return decade;
}

function colorFor(table: Partial<Record<Color, number>>, wanted: number, what: string): Color {
  for (const [color, v] of Object.entries(table) as [Color, number][]) {
    if (Math.abs(v - wanted) <= wanted * 1e-9) return color;
  }
  throw new Error(what);
}

/**
 * Bands for a value. Four bands carry two significant digits, five carry
 * three, so 4.75 kΩ cannot be written in four bands and the error says so.
 */
export function encode(value: number, count: 4 | 5, tolerance: number, tempco?: number): Color[] {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error('Zero-ohm links are marked with a single black band; enter a value above zero.');
  }
  const sig = count === 4 ? 2 : 3;
  let multiplier = 10 ** (decadeOf(value) - (sig - 1));
  let digits = Math.round(value / multiplier);
  if (digits >= 10 ** sig) {
    digits /= 10;
    multiplier *= 10;
  }
  if (Math.abs(digits * multiplier - value) > value * 1e-9) {
    throw new Error(
      count === 4
        ? `${value} Ω needs three significant digits, which takes a five-band code.`
        : `${value} Ω has more than three significant digits; no colour code can show it.`,
    );
  }

  const multiplierColor = colorFor(MULTIPLIER, multiplier, `${value} Ω is outside the range the multiplier band can express.`);
  const toleranceColor = colorFor(TOLERANCE, tolerance, `±${tolerance * 100} % is not a marked tolerance.`);

  const bands: Color[] = String(digits)
    .padStart(sig, '0')
    .split('')
    .map((ch) => DIGIT_COLORS[Number(ch)]);
  bands.push(multiplierColor, toleranceColor);

  if (tempco !== undefined) {
    bands.push(colorFor(TEMPCO, tempco, `${tempco} ppm/K is not a marked temperature coefficient.`));
  }
  return bands;
}

/**
 * The letter-for-point notation from IEC 60062 used on schematics and BOMs:
 * 4K7, 10R, R22, 1M5. It survives photocopying where a decimal point does not.
 */
export function rNotation(value: number): string {
  const units: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'K'], [1, 'R']];
  for (const [scale, letter] of units) {
    if (value >= scale * 0.9995) {
      const text = String(Number((value / scale).toPrecision(4)));
      return text.includes('.') ? text.replace('.', letter) : `${text}${letter}`;
    }
  }
  return `R${String(Number(value.toPrecision(3))).slice(2)}`;
}
