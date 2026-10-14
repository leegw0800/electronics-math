/**
 * Pull-up resistors for an I²C bus.
 *
 * SDA and SCL are open-drain: a device can pull them down but never up, so
 * every edge back to the high level is a resistor charging the bus
 * capacitance. That leaves the resistor squeezed between two limits from
 * opposite directions, and both come from the I²C specification (NXP
 * UM10204):
 *
 *   Too small and the device cannot pull the line low enough. It can only
 *   sink so much current, and below that resistance the low level sits above
 *   V_OL and the bus stops being read as a zero.
 *
 *   Too large and the rise is too slow. The line has to cross from 0.3·VDD
 *   to 0.7·VDD inside the mode's rise-time budget, and an RC edge that misses
 *   it produces a bus that works on the bench and fails on a longer cable or
 *   with one more device on it.
 *
 * Between them is a window, and the interesting part of the answer is how
 * wide it is. A bus with a lot of capacitance can close the window entirely,
 * which is a real design result rather than an error: it says the bus needs
 * fewer devices, a shorter run, or an active termination.
 */
import { type SeriesName, SERIES_TOLERANCE, baseValues } from './eseries.ts';

/**
 * ln(0.7 / 0.3) ≈ 0.8473.
 *
 * An RC edge crossing the specification's 0.3·VDD and 0.7·VDD thresholds
 * takes t = RC·ln(0.7/0.3), independent of VDD. Application notes quote the
 * rounded 0.8473; deriving it keeps the constant honest and the comment
 * explains where the number every datasheet repeats actually comes from.
 */
export const RISE_CONSTANT = Math.log(0.7 / 0.3);

export interface Mode {
  id: string;
  label: string;
  /** Bus clock, Hz. */
  frequency: number;
  /** Longest permitted 30 %–70 % rise, seconds. */
  riseTimeMax: number;
  /** Most bus capacitance the mode allows, farads. */
  capacitanceMax: number;
  /** Current a compliant device must be able to sink, amps. */
  sinkCurrent: number;
  /** Low level guaranteed at that sink current, volts. */
  outputLow: number;
  note: string;
}

/**
 * The three modes an ordinary design meets, with the figures UM10204 Table 10
 * gives for each. High-speed mode is deliberately absent: it uses an active
 * current-source pull-up during transfers, so a resistor value is not the
 * question being asked.
 */
export const MODES: Mode[] = [
  {
    id: 'standard',
    label: 'Standard-mode (100 kHz)',
    frequency: 100e3,
    riseTimeMax: 1000e-9,
    capacitanceMax: 400e-12,
    sinkCurrent: 3e-3,
    outputLow: 0.4,
    note: 'The widest window. Almost any value between 1 kΩ and 10 kΩ works on a short bus.',
  },
  {
    id: 'fast',
    label: 'Fast-mode (400 kHz)',
    frequency: 400e3,
    riseTimeMax: 300e-9,
    capacitanceMax: 400e-12,
    sinkCurrent: 3e-3,
    outputLow: 0.4,
    note: 'The usual choice. The rise-time budget is a third of Standard-mode, so capacitance starts to matter.',
  },
  {
    id: 'fastPlus',
    label: 'Fast-mode Plus (1 MHz)',
    frequency: 1e6,
    riseTimeMax: 120e-9,
    capacitanceMax: 550e-12,
    sinkCurrent: 20e-3,
    outputLow: 0.4,
    note: 'Needs devices rated to sink 20 mA. Every part on the bus must support it, not just the controller.',
  },
];

export function getMode(id: string): Mode {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`No I²C mode with id "${id}".`);
  return mode;
}

/**
 * The smallest resistor the bus may use: Rp(min) = (VDD − V_OL) / I_OL.
 *
 * At this value the device sinks exactly its rated current to hold the line
 * at V_OL. Anything smaller asks for more current than the device promises,
 * and the low level rises with it.
 */
export function minResistance(supply: number, outputLow: number, sinkCurrent: number): number {
  if (!(supply > 0)) throw new Error('Supply voltage must be greater than zero.');
  if (!(sinkCurrent > 0)) throw new Error('Sink current must be greater than zero.');
  if (!(outputLow >= 0)) throw new Error('Output low voltage cannot be negative.');
  if (outputLow >= supply) throw new Error('Output low voltage must be below the supply.');
  return (supply - outputLow) / sinkCurrent;
}

/**
 * The largest resistor the bus may use: Rp(max) = tr / (0.8473 · Cb).
 *
 * Note that VDD cancels out. Raising the supply does not buy rise-time
 * headroom, which surprises people who expect a bigger swing to help.
 */
export function maxResistance(riseTime: number, capacitance: number): number {
  if (!(riseTime > 0)) throw new Error('Rise time must be greater than zero.');
  if (!(capacitance > 0)) throw new Error('Bus capacitance must be greater than zero.');
  return riseTime / (RISE_CONSTANT * capacitance);
}

/** The 30 %–70 % rise a given resistor produces on that capacitance. */
export function riseTimeFor(resistance: number, capacitance: number): number {
  if (!(resistance > 0)) throw new Error('Resistance must be greater than zero.');
  if (!(capacitance > 0)) throw new Error('Bus capacitance must be greater than zero.');
  return RISE_CONSTANT * resistance * capacitance;
}

/** Current the pulling device sinks while holding the line at V_OL. */
export function sinkCurrentFor(supply: number, outputLow: number, resistance: number): number {
  if (!(resistance > 0)) throw new Error('Resistance must be greater than zero.');
  return (supply - outputLow) / resistance;
}

export interface PullupInputs {
  /** Bus supply, volts. */
  supply: number;
  /** Total bus capacitance on one line, farads. */
  capacitance: number;
  /** Longest permitted rise, seconds. */
  riseTimeMax: number;
  /** Current the weakest device on the bus can sink, amps. */
  sinkCurrent: number;
  /** Low level that device guarantees at that current, volts. */
  outputLow: number;
  series: SeriesName;
}

export interface Candidate {
  r: number;
  /** Rise time this value gives, seconds. */
  riseTime: number;
  /** How much of the rise-time budget it uses, 0–1. */
  riseTimeUsed: number;
  /** Current a device sinks to hold the line low, amps. */
  sinkCurrent: number;
  /** How much of the device's sink rating it uses, 0–1. */
  sinkCurrentUsed: number;
  /** Continuous dissipation in the resistor while the line is held low, watts. */
  power: number;
  /** True for the value this tool recommends. */
  isRecommended: boolean;
  /** Still inside the window at the tolerance extremes of the series. */
  holdsAtTolerance: boolean;
}

export interface Solution {
  min: number;
  max: number;
  /** false when the two limits cross and no resistor satisfies both. */
  feasible: boolean;
  /** max / min. Below about 2 the design has little margin left. */
  spread: number;
  candidates: Candidate[];
}

/**
 * Standard values inside the window, with the geometric middle recommended.
 *
 * The middle is chosen because the two limits are ratios, not offsets: a
 * value at √(min·max) sits the same factor away from failing to pull low as
 * it does from rising too slowly. Picking the arithmetic middle, or simply
 * reaching for 4.7 kΩ, leaves those two margins lopsided.
 */
export function solve(inputs: PullupInputs): Solution {
  const { supply, capacitance, riseTimeMax, sinkCurrent, outputLow, series } = inputs;

  const min = minResistance(supply, outputLow, sinkCurrent);
  const max = maxResistance(riseTimeMax, capacitance);
  const feasible = min < max;
  const spread = max / min;

  if (!feasible) return { min, max, feasible, spread, candidates: [] };

  const target = Math.sqrt(min * max);
  const tolerance = SERIES_TOLERANCE[series];

  const values = standardValuesBetween(min, max, series);

  /*
   * The recommendation is chosen from the values that actually fit rather
   * than by rounding the target to the nearest standard value. In a narrow
   * window that rounding lands outside it, and the tool would then recommend
   * nothing at all — exactly when the reader most needs an answer.
   */
  const recommended = values.length
    ? values.reduce((best, r) => (Math.abs(Math.log(r / target)) < Math.abs(Math.log(best / target)) ? r : best))
    : null;

  const candidates = values.map((r) => ({
    r,
    riseTime: riseTimeFor(r, capacitance),
    riseTimeUsed: riseTimeFor(r, capacitance) / riseTimeMax,
    sinkCurrent: sinkCurrentFor(supply, outputLow, r),
    sinkCurrentUsed: sinkCurrentFor(supply, outputLow, r) / sinkCurrent,
    power: (supply - outputLow) ** 2 / r,
    isRecommended: r === recommended,
    holdsAtTolerance: r * (1 - tolerance) >= min && r * (1 + tolerance) <= max,
  }));

  return { min, max, feasible, spread, candidates };
}

/**
 * Every standard value of the series that falls inside the window.
 *
 * Walks decade by decade rather than generating a fixed range, so a window
 * spanning 800 Ω to 12 kΩ returns values from both decades and one spanning
 * a few hundred ohms returns the handful that fit.
 */
export function standardValuesBetween(min: number, max: number, series: SeriesName): number[] {
  if (!(min > 0) || !(max > 0)) throw new Error('Both limits must be greater than zero.');
  const base = baseValues(series);
  const out: number[] = [];
  const firstDecade = Math.floor(Math.log10(min));
  const lastDecade = Math.ceil(Math.log10(max));
  for (let decade = firstDecade; decade <= lastDecade; decade++) {
    for (const value of base) {
      const r = value * 10 ** decade;
      if (r >= min && r <= max) out.push(round(r));
    }
  }
  return out;
}

/**
 * Standard values are decimal by definition, but 4.7 × 10³ computed in
 * binary floating point is not exactly 4700, and a value that misses the
 * window by 4.5e-13 would be dropped from a list it belongs in.
 */
function round(value: number): number {
  const decade = Math.floor(Math.log10(value));
  const factor = 10 ** (decade - 3);
  return Math.round(value / factor) * factor;
}
