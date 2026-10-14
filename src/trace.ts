/**
 * PCB trace width for a current, per IPC-2221.
 *
 *   I = k · ΔT^0.44 · A^0.725
 *
 * with I in amps, ΔT the temperature rise in °C, A the copper cross-section
 * in square mils, and k = 0.048 for outer layers or 0.024 for inner ones.
 * The formula is a curve fit to charts from the 1950s that IPC-2221 carried
 * forward; IPC-2152 (2009) replaced the charts with better ones, but the
 * 2221 fit is still what nearly every calculator uses and is conservative
 * for outer traces on ordinary boards. Its stated range is 0–35 A, 10–100 °C,
 * widths to 400 mil and copper from ½ to 3 oz; outside that the numbers are
 * extrapolation and the tool says so.
 */

export type Layer = 'external' | 'internal';

export const K: Record<Layer, number> = { external: 0.048, internal: 0.024 };

/** 1 oz/ft² of copper is 35 µm nominal, 1.378 mil. */
export const OZ_TO_UM = 35;
export const MIL_TO_MM = 0.0254;

export const COPPER_WEIGHTS = [0.5, 1, 2, 3];

/** Copper at 20 °C, and how fast it rises with temperature. */
export const RHO_COPPER = 1.68e-8;
export const ALPHA_COPPER = 0.00393;

/** Widths a fab will make without comment, mm. */
export const STANDARD_WIDTHS_MM = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export interface TraceInputs {
  current: number;
  /** Allowed rise above ambient, °C. */
  tempRise: number;
  ozCopper: number;
  layer: Layer;
  lengthMm: number;
  ambient: number;
}

export interface StandardWidth {
  mm: number;
  /** Rise this width actually produces at the requested current. */
  tempRise: number;
}

export interface Solution {
  widthMm: number;
  widthMils: number;
  areaMils2: number;
  /** Fab widths bracketing the minimum, with the rise each gives. */
  below: StandardWidth | null;
  above: StandardWidth | null;
  resistance20: number;
  resistanceHot: number;
  voltageDrop: number;
  powerLoss: number;
  operatingTemp: number;
  warnings: string[];
}

export function thicknessMils(ozCopper: number): number {
  return (ozCopper * OZ_TO_UM) / (MIL_TO_MM * 1000);
}

export function areaForCurrent(current: number, tempRise: number, layer: Layer): number {
  return (current / (K[layer] * tempRise ** 0.44)) ** (1 / 0.725);
}

export function currentForArea(area: number, tempRise: number, layer: Layer): number {
  return K[layer] * tempRise ** 0.44 * area ** 0.725;
}

export function tempRiseForArea(area: number, current: number, layer: Layer): number {
  return (current / (K[layer] * area ** 0.725)) ** (1 / 0.44);
}

export function widthForCurrent(current: number, tempRise: number, ozCopper: number, layer: Layer): { mils: number; mm: number; areaMils2: number } {
  check(current, tempRise, ozCopper);
  const areaMils2 = areaForCurrent(current, tempRise, layer);
  const mils = areaMils2 / thicknessMils(ozCopper);
  return { mils, mm: mils * MIL_TO_MM, areaMils2 };
}

export function currentForWidth(widthMm: number, tempRise: number, ozCopper: number, layer: Layer): number {
  if (!(widthMm > 0)) throw new Error('Width must be greater than zero.');
  return currentForArea((widthMm / MIL_TO_MM) * thicknessMils(ozCopper), tempRise, layer);
}

export function tempRiseForWidth(widthMm: number, current: number, ozCopper: number, layer: Layer): number {
  if (!(widthMm > 0)) throw new Error('Width must be greater than zero.');
  return tempRiseForArea((widthMm / MIL_TO_MM) * thicknessMils(ozCopper), current, layer);
}

/** DC resistance of a trace, Ω, at the given copper temperature. */
export function traceResistance(widthMm: number, ozCopper: number, lengthMm: number, tempC = 20): number {
  const w = widthMm / 1000;
  const t = ozCopper * OZ_TO_UM * 1e-6;
  const l = lengthMm / 1000;
  const r20 = (RHO_COPPER * l) / (w * t);
  return r20 * (1 + ALPHA_COPPER * (tempC - 20));
}

/** The fab width just under the minimum and the first one at or over it. */
export function standardWidthsAround(mm: number): { below: number | null; above: number | null } {
  let below: number | null = null;
  let above: number | null = null;
  for (const w of STANDARD_WIDTHS_MM) {
    if (w < mm) below = w;
    if (above === null && w >= mm) above = w;
  }
  return { below, above };
}

export function warnings(inputs: TraceInputs, widthMils: number): string[] {
  const out: string[] = [];
  if (inputs.tempRise < 10) out.push('IPC-2221 is fitted for rises of 10 °C and more; below that the result is an extrapolation.');
  if (inputs.tempRise > 100) out.push('IPC-2221 is fitted up to a 100 °C rise; beyond it the result is an extrapolation.');
  if (inputs.current > 35) out.push('IPC-2221 is fitted up to 35 A; above that the result is an extrapolation.');
  if (widthMils > 400) out.push('The width is beyond the 400 mil the IPC-2221 charts cover; consider a copper pour or a wider bus.');
  if (inputs.ozCopper < 0.5 || inputs.ozCopper > 3) out.push('IPC-2221 covers copper from ½ oz to 3 oz.');
  if (inputs.ambient + inputs.tempRise > 105) out.push(`The copper would run at ${Math.round(inputs.ambient + inputs.tempRise)} °C, which is uncomfortable for standard FR-4 (Tg around 130 °C) and for anything soldered nearby.`);
  return out;
}

export function solve(inputs: TraceInputs): Solution {
  const { current, tempRise, ozCopper, layer, lengthMm, ambient } = inputs;
  if (!(lengthMm >= 0)) throw new Error('Length cannot be negative.');
  const { mils, mm, areaMils2 } = widthForCurrent(current, tempRise, ozCopper, layer);

  const around = standardWidthsAround(mm);
  const describe = (w: number | null): StandardWidth | null =>
    w === null ? null : { mm: w, tempRise: tempRiseForWidth(w, current, ozCopper, layer) };

  const operatingTemp = ambient + tempRise;
  const resistance20 = traceResistance(mm, ozCopper, lengthMm);
  const resistanceHot = traceResistance(mm, ozCopper, lengthMm, operatingTemp);

  return {
    widthMm: mm,
    widthMils: mils,
    areaMils2,
    below: describe(around.below),
    above: describe(around.above),
    resistance20,
    resistanceHot,
    voltageDrop: current * resistanceHot,
    powerLoss: current * current * resistanceHot,
    operatingTemp,
    warnings: warnings(inputs, mils),
  };
}

function check(current: number, tempRise: number, ozCopper: number): void {
  if (!(current > 0) || !Number.isFinite(current)) throw new Error('Current must be greater than zero.');
  if (!(tempRise > 0) || !Number.isFinite(tempRise)) throw new Error('Temperature rise must be greater than zero.');
  if (!(ozCopper > 0)) throw new Error('Copper weight must be greater than zero.');
}
