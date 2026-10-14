/**
 * Resistive voltage divider: Vout = Vin · R2 / (R1 + R2), R1 on top.
 *
 * The arithmetic is one line. The useful part is everything around it: the
 * ideal ratio almost never lands on two parts that exist, so the solver picks
 * the closest real pair from a standard series and reports what that costs —
 * the actual output, the current the divider draws, and the range the output
 * can wander over once the resistors' own tolerance is taken into account.
 */
import { type SeriesName, SERIES_TOLERANCE, baseValues, nearest } from './eseries.ts';

export interface DividerTarget {
  vin: number;
  vout: number;
  series: SeriesName;
  /** The decade R2 is chosen from: 1000 means R2 in [1k, 10k). */
  r2Decade: number;
}

export interface Evaluation {
  r1: number;
  r2: number;
  /** Output with the nominal resistor values. */
  vout: number;
  /** Signed, relative to the target. Zero when there is no target. */
  errorPct: number;
  /** Current through the divider with no load, in amps. */
  current: number;
  /** Dissipation in each resistor, in watts. */
  p1: number;
  p2: number;
  /** Thevenin source resistance the output presents to whatever it drives. */
  outputImpedance: number;
  /** Output range across the resistors' tolerance, both in the worst direction. */
  worst: { min: number; max: number; tolerance: number };
}

export const R2_DECADES = [100, 1_000, 10_000, 100_000, 1_000_000];

/** The fraction Vout / Vin that the divider has to produce. */
export function idealRatio(vin: number, vout: number): number {
  checkVoltages(vin, vout);
  return vout / vin;
}

/** R1 that would hit the target exactly for a given R2 — usually not a real part. */
export function idealR1(vin: number, vout: number, r2: number): number {
  checkVoltages(vin, vout);
  return (r2 * (vin - vout)) / vout;
}

export function outputVoltage(vin: number, r1: number, r2: number): number {
  return (vin * r2) / (r1 + r2);
}

/**
 * The output is highest when R2 is at the top of its tolerance and R1 at the
 * bottom, and lowest the other way round. Both resistors being off in the
 * same direction largely cancels, so the corners are what matter.
 */
export function worstCase(vin: number, r1: number, r2: number, tolerance: number): { min: number; max: number } {
  return {
    min: outputVoltage(vin, r1 * (1 + tolerance), r2 * (1 - tolerance)),
    max: outputVoltage(vin, r1 * (1 - tolerance), r2 * (1 + tolerance)),
  };
}

/** Everything worth knowing about one specific pair. */
export function evaluate(vin: number, r1: number, r2: number, tolerance: number, targetVout?: number): Evaluation {
  if (!(vin > 0)) throw new Error('Vin must be greater than zero.');
  if (!(r1 > 0) || !(r2 > 0)) throw new Error('Both resistors must be greater than zero.');

  const vout = outputVoltage(vin, r1, r2);
  const current = vin / (r1 + r2);
  return {
    r1,
    r2,
    vout,
    errorPct: targetVout ? ((vout - targetVout) / targetVout) * 100 : 0,
    current,
    p1: current * current * r1,
    p2: current * current * r2,
    outputImpedance: (r1 * r2) / (r1 + r2),
    worst: { ...worstCase(vin, r1, r2, tolerance), tolerance },
  };
}

/**
 * Every R2 in the chosen decade paired with the nearest standard R1, ranked
 * by how close the pair lands to the target. Only one decade of R2 is
 * searched because scaling both resistors by ten gives the same ratio, so
 * the other decades would just repeat each answer.
 */
export function solve(target: DividerTarget, limit = 8): Evaluation[] {
  checkVoltages(target.vin, target.vout);
  const tolerance = SERIES_TOLERANCE[target.series];

  const results = baseValues(target.series).map((mantissa) => {
    const r2 = Number((mantissa * target.r2Decade).toPrecision(12));
    const r1 = nearest(idealR1(target.vin, target.vout, r2), target.series);
    return evaluate(target.vin, r1, r2, tolerance, target.vout);
  });

  results.sort((a, b) => Math.abs(a.errorPct) - Math.abs(b.errorPct) || a.r2 - b.r2);
  return results.slice(0, limit);
}

function checkVoltages(vin: number, vout: number): void {
  if (!(vin > 0)) throw new Error('Vin must be greater than zero.');
  if (!(vout > 0)) throw new Error('Vout must be greater than zero.');
  if (vout >= vin) throw new Error('Vout must be below Vin — a resistive divider can only step down.');
}

export { formatCurrent, formatPower, formatVolts } from './units.ts';
