/**
 * Series resistor for an LED: R = (Vsupply − N·Vf) / If.
 *
 * The formula is trivial; what goes wrong in practice is everything it
 * hides. Vf is a range on the datasheet, not a number, so the current moves
 * with the part in the reel. The ideal resistor is never a stock value, and
 * rounding the wrong way pushes the LED past its rating. And the resistor
 * itself has to survive the power it burns. This module answers all three
 * with the standard values either side, the current each one really gives,
 * and the rating the resistor needs.
 */
import { type SeriesName, SERIES_TOLERANCE, nearest, neighbours, isStandard } from './eseries.ts';

export interface LedInputs {
  /** Supply voltage. */
  supply: number;
  /** Forward voltage of one LED at the target current. */
  forward: number;
  /** Target current in amps. */
  current: number;
  /** LEDs in series on the one resistor. */
  count: number;
  series: SeriesName;
}

export interface Candidate {
  r: number;
  /** Current the LED actually gets with this resistor. */
  current: number;
  /** Signed, relative to the target. */
  errorPct: number;
  /** True when the current does not exceed the target. */
  withinTarget: boolean;
  /** True for the standard value closest to the ideal. */
  isNearest: boolean;
  /** Dissipation in the resistor and in each LED, watts. */
  pResistor: number;
  pLed: number;
  /** Smallest standard rating that leaves 2× margin, or null above 5 W. */
  rating: number | null;
  /** Current range across the resistor's tolerance. */
  worst: { min: number; max: number; tolerance: number };
  /** Current if every LED's Vf runs 0.1 V above the figure entered. */
  ifForwardHigh: number;
}

export interface Solution {
  ideal: number;
  headroom: number;
  candidates: Candidate[];
}

/** Standard through-hole resistor power ratings, watts. */
export const RATINGS = [0.125, 0.25, 0.5, 1, 2, 5];

/**
 * Typical forward voltages at around 20 mA. They are starting points only:
 * the datasheet's own figure, and its spread, is what the resistor has to be
 * designed against.
 */
export const LED_PRESETS: { label: string; forward: number; note: string }[] = [
  { label: 'Red', forward: 2.0, note: 'AlGaInP, roughly 1.8–2.2 V' },
  { label: 'Yellow', forward: 2.1, note: 'Roughly 2.0–2.2 V' },
  { label: 'Green (GaP)', forward: 2.1, note: 'The older, dimmer green' },
  { label: 'Green (InGaN)', forward: 3.2, note: 'Bright green, same die family as blue' },
  { label: 'Blue', forward: 3.2, note: 'InGaN, roughly 3.0–3.4 V' },
  { label: 'White', forward: 3.2, note: 'Blue die with phosphor, roughly 3.0–3.4 V' },
  { label: 'IR', forward: 1.3, note: '850–940 nm emitters, roughly 1.2–1.5 V' },
];

/** Voltage left for the resistor after the LEDs take theirs. */
export function headroom(supply: number, forward: number, count: number): number {
  check(supply, forward, count);
  const left = supply - forward * count;
  if (left <= 0) {
    throw new Error(
      `${count > 1 ? `${count} LEDs at ${forward} V need ${(forward * count).toFixed(2)} V` : `A ${forward} V LED`} — a ${supply} V supply leaves nothing for the resistor.`,
    );
  }
  return left;
}

export function idealResistor(supply: number, forward: number, current: number, count: number): number {
  if (!(current > 0)) throw new Error('Current must be greater than zero.');
  return headroom(supply, forward, count) / current;
}

export function currentFor(supply: number, forward: number, count: number, r: number): number {
  return headroom(supply, forward, count) / r;
}

/** A resistor at the low edge of its tolerance passes the most current. */
export function currentWorstCase(
  supply: number,
  forward: number,
  count: number,
  r: number,
  tolerance: number,
): { min: number; max: number } {
  return {
    min: currentFor(supply, forward, count, r * (1 + tolerance)),
    max: currentFor(supply, forward, count, r * (1 - tolerance)),
  };
}

/**
 * Smallest standard rating with at least twice the dissipation in hand. A
 * resistor run at its full rating gets hot enough to drift and to shorten
 * its life; the 50 % rule is the usual derating.
 */
export function recommendedRating(watts: number): number | null {
  return RATINGS.find((rating) => rating >= watts * 2) ?? null;
}

export function describe(inputs: LedInputs, r: number, isNearest: boolean): Candidate {
  const { supply, forward, count, series } = inputs;
  const current = currentFor(supply, forward, count, r);
  const pResistor = current * current * r;
  const tolerance = SERIES_TOLERANCE[series];
  return {
    r,
    current,
    errorPct: ((current - inputs.current) / inputs.current) * 100,
    withinTarget: current <= inputs.current * (1 + 1e-9),
    isNearest,
    pResistor,
    pLed: forward * current,
    rating: recommendedRating(pResistor),
    worst: { ...currentWorstCase(supply, forward, count, r, tolerance), tolerance },
    ifForwardHigh: supply - (forward + 0.1) * count > 0 ? currentFor(supply, forward + 0.1, count, r) : 0,
  };
}

/**
 * The ideal value and the standard values that bracket it. When the ideal is
 * itself a standard value there are three rows; otherwise two, one of which
 * is the nearest. The larger value is always the one that keeps the current
 * at or under the target.
 */
export function solve(inputs: LedInputs): Solution {
  const ideal = idealResistor(inputs.supply, inputs.forward, inputs.current, inputs.count);
  const closest = nearest(ideal, inputs.series);
  const { below, above } = neighbours(ideal, inputs.series);

  const values = isStandard(ideal, inputs.series) ? [below, closest, above] : [below, above];
  const candidates = values.map((r) => describe(inputs, r, r === closest));
  candidates.sort((a, b) => a.r - b.r);

  return { ideal, headroom: headroom(inputs.supply, inputs.forward, inputs.count), candidates };
}

function check(supply: number, forward: number, count: number): void {
  if (!(supply > 0)) throw new Error('Supply voltage must be greater than zero.');
  if (!(forward > 0)) throw new Error('Forward voltage must be greater than zero.');
  if (!Number.isInteger(count) || count < 1) throw new Error('LED count must be a whole number of at least 1.');
}
