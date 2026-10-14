/**
 * Ohm's law and the power relations, solved from any two of V, I, R and P.
 *
 * The twelve formulas printed on every wheel chart are six pairs, each giving
 * the other two quantities:
 *
 *   V, I  →  R = V/I      P = V·I
 *   V, R  →  I = V/R      P = V²/R
 *   V, P  →  I = P/V      R = V²/P
 *   I, R  →  V = I·R      P = I²·R
 *   I, P  →  V = P/I      R = P/I²
 *   R, P  →  V = √(P·R)   I = √(P/R)
 *
 * Strictly only `V = I·R` is Ohm's law; the power relations are Joule's. They
 * are solved together because that is how the question arrives — you know two
 * of the four and want the rest.
 *
 * What this module refuses is as important as what it computes. A resistance
 * of zero with a voltage across it is not "infinite current", it is a short
 * and the question is wrong; a current of zero does not determine a
 * resistance. Returning Infinity or NaN there would put a number on the screen
 * that looks like an answer.
 */

export type Quantity = 'v' | 'i' | 'r' | 'p';

export const QUANTITIES: Quantity[] = ['v', 'i', 'r', 'p'];

export interface Values {
  /** Volts. */
  v: number;
  /** Amps. */
  i: number;
  /** Ohms. */
  r: number;
  /** Watts. */
  p: number;
}

/** Which two inputs produced a result, so the page can show the formulas used. */
export interface Solution extends Values {
  from: [Quantity, Quantity];
}

const NAME: Record<Quantity, string> = {
  v: 'voltage',
  i: 'current',
  r: 'resistance',
  p: 'power',
};

/**
 * Solve for all four quantities from exactly two.
 *
 * Both inputs must be finite and non-negative. Zero is allowed only where it
 * is physically meaningful: a resistor can dissipate zero watts when no
 * current flows, but a resistance of zero in a voltage pair describes a short
 * rather than a circuit to compute.
 */
export function solve(known: Partial<Values>): Solution {
  const given = QUANTITIES.filter((q) => known[q] !== undefined && known[q] !== null);

  if (given.length < 2) throw new Error('Enter any two values.');
  if (given.length > 2) throw new Error('Enter exactly two values — the other two are computed.');

  const [a, b] = given as [Quantity, Quantity];
  for (const q of [a, b]) {
    const value = known[q]!;
    if (!Number.isFinite(value)) throw new Error(`The ${NAME[q]} must be a number.`);
    if (value < 0) throw new Error(`The ${NAME[q]} cannot be negative.`);
  }

  const key = [a, b].sort().join('') as 'iv' | 'rv' | 'pv' | 'ir' | 'ip' | 'pr';
  const v = known.v!;
  const i = known.i!;
  const r = known.r!;
  const p = known.p!;

  let out: Values;
  switch (key) {
    case 'iv':
      if (i === 0) throw new Error('With no current there is nothing to determine the resistance.');
      out = { v, i, r: v / i, p: v * i };
      break;
    case 'rv':
      if (r === 0) throw new Error('A resistance of zero across a voltage is a short, not a circuit.');
      out = { v, i: v / r, r, p: (v * v) / r };
      break;
    case 'pv':
      if (v === 0) throw new Error('With no voltage there is nothing to determine the current.');
      if (p === 0) throw new Error('With no power dissipated there is no current to find.');
      out = { v, i: p / v, r: (v * v) / p, p };
      break;
    case 'ir':
      out = { v: i * r, i, r, p: i * i * r };
      break;
    case 'ip':
      if (i === 0) throw new Error('With no current there is nothing to determine the voltage.');
      out = { v: p / i, i, r: p / (i * i), p };
      break;
    case 'pr':
      if (r === 0) throw new Error('A resistance of zero dissipates no power at any current.');
      out = { v: Math.sqrt(p * r), i: Math.sqrt(p / r), r, p };
      break;
  }

  return { ...out, from: [a, b] };
}

/** The two formulas a given pair of inputs uses, for showing the working. */
export function formulas(from: [Quantity, Quantity]): [string, string] {
  switch ([...from].sort().join('')) {
    case 'iv':
      return ['R = V / I', 'P = V × I'];
    case 'rv':
      return ['I = V / R', 'P = V² / R'];
    case 'pv':
      return ['I = P / V', 'R = V² / P'];
    case 'ir':
      return ['V = I × R', 'P = I² × R'];
    case 'ip':
      return ['V = P / I', 'R = P / I²'];
    default:
      return ['V = √(P × R)', 'I = √(P / R)'];
  }
}

/** The six ways two of the four quantities can be known. */
export const PAIRS: [Quantity, Quantity][] = [
  ['v', 'i'], ['v', 'r'], ['v', 'p'], ['i', 'r'], ['i', 'p'], ['r', 'p'],
];

/**
 * The twelve formulas grouped by the quantity each one gives — the arrangement
 * of the wheel chart, which is why the page can draw one.
 *
 * Derived from `formulas()` rather than listed again. The wheel beside a
 * calculator that disagreed with it would be worse than no wheel, and the
 * half nobody tests is always the half that is wrong.
 */
export function wheel(): Record<Quantity, string[]> {
  const out: Record<Quantity, string[]> = { v: [], i: [], r: [], p: [] };
  for (const pair of PAIRS) {
    for (const formula of formulas(pair)) {
      const gives = formula[0]!.toLowerCase() as Quantity;
      out[gives].push(formula);
    }
  }
  return out;
}

export { formatCurrent, formatPower, formatVolts } from './units.ts';
export { formatOhms, parseOhms } from './eseries.ts';
