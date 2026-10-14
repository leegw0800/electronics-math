/**
 * First-order RC: time constant, −3 dB point, step response.
 *
 * τ = R·C and fc = 1 / (2π R C) are the same number looked at two ways, and
 * both are decided by two parts that come in coarse steps. The capacitor is
 * the coarse one — E6 or E12 values at ±10 % or ±20 % — so the solver picks
 * the capacitor from its series and lets the resistor, which comes in finer
 * steps at tighter tolerance, absorb the error. The worst-case band then
 * shows what the capacitor's tolerance does to the cutoff, which is usually
 * the answer to "why does my filter not match the calculation".
 */
import { type SeriesName, baseValues, nearest } from './eseries.ts';

export type FilterType = 'lowpass' | 'highpass';

/** Capacitor decades on offer: 10 pF up to 100 µF. */
export const C_DECADES = [1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4];

export interface RcTarget {
  /** Wanted −3 dB frequency, Hz. */
  fc: number;
  rSeries: SeriesName;
  cSeries: SeriesName;
  /** Decade the capacitor is chosen from: 1e-7 means 100 n to 820 n. */
  cDecade: number;
}

export interface RcPair {
  r: number;
  c: number;
  tau: number;
  fc: number;
  /** Signed, relative to the target; zero when there is no target. */
  errorPct: number;
  /** 10 % to 90 % on a step, seconds. */
  riseTime: number;
  /** Cutoff range once both parts sit at the edge of their tolerance. */
  worst: { min: number; max: number; rTol: number; cTol: number };
}

export function timeConstant(r: number, c: number): number {
  checkParts(r, c);
  return r * c;
}

export function cutoff(r: number, c: number): number {
  checkParts(r, c);
  return 1 / (2 * Math.PI * r * c);
}

/** 10 % to 90 %: τ·ln 9, or about 0.35 / fc. */
export function riseTime(tau: number): number {
  return tau * Math.log(9);
}

/** Fraction of a step reached after time t. */
export function stepFraction(t: number, tau: number): number {
  return 1 - Math.exp(-t / tau);
}

export function timeToFraction(fraction: number, tau: number): number {
  if (!(fraction > 0 && fraction < 1)) throw new Error('Fraction must be between 0 and 1.');
  return -tau * Math.log(1 - fraction);
}

/**
 * Time for the capacitor to settle to within one LSB of an n-bit converter:
 * τ·ln(2^n). Twelve bits needs 8.3 τ, not the one τ people reach for.
 */
export function settlingTime(bits: number, tau: number): number {
  return tau * Math.log(2 ** bits);
}

/** Magnitude, dB and phase at frequency f for a first-order filter with cutoff fc. */
export function response(f: number, fc: number, type: FilterType): { magnitude: number; db: number; phaseDeg: number } {
  const x = f / fc;
  const magnitude = type === 'lowpass' ? 1 / Math.sqrt(1 + x * x) : x / Math.sqrt(1 + x * x);
  const phase = type === 'lowpass' ? -Math.atan(x) : Math.PI / 2 - Math.atan(x);
  return { magnitude, db: 20 * Math.log10(magnitude), phaseDeg: (phase * 180) / Math.PI };
}

/** Both parts high pushes fc down; both low pushes it up. */
export function cutoffWorstCase(r: number, c: number, rTol: number, cTol: number): { min: number; max: number } {
  return {
    min: cutoff(r * (1 + rTol), c * (1 + cTol)),
    max: cutoff(r * (1 - rTol), c * (1 - cTol)),
  };
}

export function evaluate(r: number, c: number, rTol: number, cTol: number, targetFc?: number): RcPair {
  const tau = timeConstant(r, c);
  const fc = cutoff(r, c);
  return {
    r,
    c,
    tau,
    fc,
    errorPct: targetFc ? ((fc - targetFc) / targetFc) * 100 : 0,
    riseTime: riseTime(tau),
    worst: { ...cutoffWorstCase(r, c, rTol, cTol), rTol, cTol },
  };
}

/**
 * Every capacitor in the chosen decade paired with the nearest standard
 * resistor, ranked by how close the cutoff lands.
 */
export function solve(target: RcTarget, rTol: number, cTol: number, limit = 8): RcPair[] {
  if (!(target.fc > 0) || !Number.isFinite(target.fc)) throw new Error('Cutoff frequency must be greater than zero.');

  const results = baseValues(target.cSeries).map((mantissa) => {
    const c = Number((mantissa * target.cDecade).toPrecision(12));
    const r = nearest(1 / (2 * Math.PI * target.fc * c), target.rSeries);
    return evaluate(r, c, rTol, cTol, target.fc);
  });

  results.sort((a, b) => Math.abs(a.errorPct) - Math.abs(b.errorPct) || a.c - b.c);
  return results.slice(0, limit);
}

function checkParts(r: number, c: number): void {
  if (!(r > 0) || !Number.isFinite(r)) throw new Error('Resistance must be greater than zero.');
  if (!(c > 0) || !Number.isFinite(c)) throw new Error('Capacitance must be greater than zero.');
}
