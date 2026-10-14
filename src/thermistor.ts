/**
 * NTC thermistor maths: ADC counts to resistance to temperature.
 *
 * A thermistor is the cheapest way to measure temperature and the most
 * awkward to get right, because three separate conversions sit between the
 * number a firmware reads and the number a person wants, and each has its own
 * way of being wrong.
 *
 *   counts → resistance   depends on which leg of the divider the NTC is in
 *   resistance → kelvin   the Beta equation, or Steinhart-Hart
 *   kelvin → celsius      273.15, not 273
 *
 * The resistance step is ratiometric: it uses the ADC reading as a fraction
 * of full scale and never needs the supply voltage, which is what makes the
 * result immune to a rail that sags. Code that converts counts to volts first
 * has thrown that away before the temperature is even computed.
 */

export const KELVIN_OFFSET = 273.15;

export const toKelvin = (celsius: number) => celsius + KELVIN_OFFSET;
export const toCelsius = (kelvin: number) => kelvin - KELVIN_OFFSET;

/* ------------------------------------------------------------ Beta model */

export interface BetaModel {
  /** Resistance at the reference temperature, ohms. */
  r0: number;
  /** Reference temperature, celsius — 25 on almost every datasheet. */
  t0: number;
  /** Beta constant, kelvin. */
  beta: number;
}

/**
 * Resistance at a temperature: R = R0 · exp(B · (1/T − 1/T0)).
 *
 * Beta is a two-point fit, so it is exact at the two temperatures it was
 * measured at and drifts away from the datasheet table between and beyond
 * them. A datasheet quoting B25/85 is telling you which two.
 */
export function resistanceAt(celsius: number, model: BetaModel): number {
  checkModel(model);
  const t = toKelvin(celsius);
  if (t <= 0) throw new Error('Temperature must be above absolute zero.');
  return model.r0 * Math.exp(model.beta * (1 / t - 1 / toKelvin(model.t0)));
}

/** Temperature at a resistance: 1/T = 1/T0 + ln(R/R0) / B. */
export function temperatureAt(resistance: number, model: BetaModel): number {
  checkModel(model);
  if (!(resistance > 0)) throw new Error('Resistance must be greater than zero.');
  const inverse = 1 / toKelvin(model.t0) + Math.log(resistance / model.r0) / model.beta;
  if (inverse <= 0) throw new Error('That resistance is outside the range the Beta equation can describe.');
  return toCelsius(1 / inverse);
}

/**
 * The Beta a pair of measurements implies: B = ln(R1/R2) / (1/T1 − 1/T2).
 *
 * Worth computing when a datasheet gives a resistance table but no Beta, and
 * worth comparing against a quoted Beta when readings are off at the ends of
 * the range.
 */
export function betaFrom(r1: number, celsius1: number, r2: number, celsius2: number): number {
  if (!(r1 > 0) || !(r2 > 0)) throw new Error('Both resistances must be greater than zero.');
  const t1 = toKelvin(celsius1);
  const t2 = toKelvin(celsius2);
  if (t1 === t2) throw new Error('The two temperatures must differ.');
  if (r1 === r2) throw new Error('The two resistances must differ.');
  return Math.log(r1 / r2) / (1 / t1 - 1 / t2);
}

function checkModel(model: BetaModel): void {
  if (!(model.r0 > 0)) throw new Error('Reference resistance must be greater than zero.');
  if (!(model.beta > 0)) throw new Error('Beta must be greater than zero.');
  if (toKelvin(model.t0) <= 0) throw new Error('Reference temperature must be above absolute zero.');
}

/* -------------------------------------------------- Steinhart-Hart model */

export interface SteinhartHart {
  a: number;
  b: number;
  c: number;
}

/** 1/T = A + B·ln(R) + C·ln(R)³. */
export function steinhartTemperature(resistance: number, { a, b, c }: SteinhartHart): number {
  if (!(resistance > 0)) throw new Error('Resistance must be greater than zero.');
  const l = Math.log(resistance);
  const inverse = a + b * l + c * l * l * l;
  if (inverse <= 0) throw new Error('That resistance is outside the range these coefficients describe.');
  return toCelsius(1 / inverse);
}

/**
 * The inverse, solved in closed form rather than by iteration.
 *
 * Substituting x = ln(R) turns the equation into the depressed cubic
 * x³ + (B/C)x + (A − 1/T)/C = 0, which Cardano's formula solves directly. A
 * thermistor curve gives one real root, so no root selection is needed.
 */
export function steinhartResistance(celsius: number, { a, b, c }: SteinhartHart): number {
  if (c === 0) throw new Error('C must be non-zero to invert the equation; use the Beta model instead.');
  const y = (a - 1 / toKelvin(celsius)) / c;
  const x = b / c;
  const discriminant = Math.sqrt((y * y) / 4 + (x * x * x) / 27);
  return Math.exp(Math.cbrt(-y / 2 + discriminant) + Math.cbrt(-y / 2 - discriminant));
}

export interface FitPoint {
  resistance: number;
  celsius: number;
}

/**
 * Fits A, B and C to three measurements.
 *
 * Three points, three unknowns, one exact answer — the fit passes through
 * every point it was given, which is what makes it verifiable: feed it three
 * rows of a datasheet table and it must reproduce those three rows.
 *
 * Spreading the points across the range that matters is the whole art. Three
 * points clustered around room temperature produce coefficients that are
 * excellent there and useless at the ends.
 */
export function fitSteinhartHart(points: FitPoint[]): SteinhartHart {
  if (points.length !== 3) throw new Error('Three measurements are needed to fit three coefficients.');
  for (const p of points) {
    if (!(p.resistance > 0)) throw new Error('Every resistance must be greater than zero.');
    if (toKelvin(p.celsius) <= 0) throw new Error('Every temperature must be above absolute zero.');
  }

  const [l1, l2, l3] = points.map((p) => Math.log(p.resistance));
  const [y1, y2, y3] = points.map((p) => 1 / toKelvin(p.celsius));

  if (l1 === l2 || l2 === l3 || l1 === l3) {
    throw new Error('The three resistances must differ from each other.');
  }

  const g2 = (y2 - y1) / (l2 - l1);
  const g3 = (y3 - y1) / (l3 - l1);

  const c = ((g3 - g2) / (l3 - l2)) / (l1 + l2 + l3);
  const b = g2 - c * (l1 * l1 + l1 * l2 + l2 * l2);
  const a = y1 - (b + l1 * l1 * c) * l1;

  return { a, b, c };
}

/* ----------------------------------------------------------- the divider */

/**
 * Which leg the thermistor sits in.
 *
 * `pullup` puts the fixed resistor between the supply and the node, with the
 * NTC from the node to ground: counts rise as it gets colder. `pulldown` is
 * the other way round and counts rise with temperature. Getting this
 * backwards gives a reading that moves the right amount in the wrong
 * direction, which reads as a wiring fault rather than a software one.
 */
export type Topology = 'pullup' | 'pulldown';

/**
 * Resistance implied by an ADC reading, as a fraction of full scale.
 *
 * `counts` and `fullScale` are used as a ratio, so the supply voltage never
 * enters. On a ratiometric ADC — one whose reference is the same rail that
 * feeds the divider — that makes the reading immune to supply variation,
 * which is the main reason this topology is used at all.
 */
export function resistanceFromCounts(
  counts: number,
  fullScale: number,
  fixed: number,
  topology: Topology,
): number {
  if (!(fullScale > 0)) throw new Error('Full scale must be greater than zero.');
  if (!(fixed > 0)) throw new Error('The fixed resistor must be greater than zero.');
  if (counts < 0 || counts > fullScale) throw new Error(`The reading must be between 0 and ${fullScale}.`);

  const ratio = counts / fullScale;
  if (topology === 'pullup') {
    if (ratio >= 1) throw new Error('A full-scale reading means the thermistor is open circuit.');
    return (fixed * ratio) / (1 - ratio);
  }
  if (ratio <= 0) throw new Error('A reading of zero means the thermistor is open circuit.');
  return fixed * (1 / ratio - 1);
}

/** The reading a resistance produces, for checking a design before it exists. */
export function countsFromResistance(
  resistance: number,
  fullScale: number,
  fixed: number,
  topology: Topology,
): number {
  if (!(resistance > 0)) throw new Error('Resistance must be greater than zero.');
  const ratio =
    topology === 'pullup' ? resistance / (resistance + fixed) : fixed / (resistance + fixed);
  return ratio * fullScale;
}

/* ------------------------------------------------------- design checks */

/**
 * Temperature change per ADC count, at a temperature.
 *
 * This is where a divider is chosen or regretted. Sensitivity peaks where the
 * thermistor's resistance is near the fixed resistor's and falls away sharply
 * either side, so a 10 kΩ part with a 10 kΩ resistor resolves well around
 * 25 °C and poorly at 100 °C. Measured as a central difference over one count,
 * which needs no derivative of the temperature model and so works for both.
 */
export function resolutionAt(
  celsius: number,
  model: BetaModel,
  fullScale: number,
  fixed: number,
  topology: Topology,
): number {
  const resistance = resistanceAt(celsius, model);
  const counts = countsFromResistance(resistance, fullScale, fixed, topology);
  const low = Math.max(0.5, Math.min(fullScale - 0.5, counts - 0.5));
  const high = Math.max(0.5, Math.min(fullScale - 0.5, counts + 0.5));
  if (high === low) return Number.POSITIVE_INFINITY;
  const tLow = temperatureAt(resistanceFromCounts(low, fullScale, fixed, topology), model);
  const tHigh = temperatureAt(resistanceFromCounts(high, fullScale, fixed, topology), model);
  return Math.abs(tHigh - tLow);
}

export interface SelfHeating {
  /** Power the thermistor dissipates, watts. */
  power: number;
  /** Temperature rise it causes, celsius. */
  rise: number;
}

/**
 * How much the measurement heats what it is measuring.
 *
 * Current through the thermistor warms it, and the reading follows. The
 * dissipation constant on the datasheet, in mW per °C, says how much. A rise
 * comparable to the accuracy being claimed means the divider is drawing too
 * much current, and the fix is a larger fixed resistor or switching the
 * divider on only while sampling.
 */
export function selfHeating(
  resistance: number,
  supply: number,
  fixed: number,
  dissipationConstant: number,
): SelfHeating {
  if (!(resistance > 0) || !(fixed > 0)) throw new Error('Resistances must be greater than zero.');
  if (!(dissipationConstant > 0)) throw new Error('The dissipation constant must be greater than zero.');
  const current = supply / (resistance + fixed);
  const power = current * current * resistance;
  return { power, rise: (power * 1000) / dissipationConstant };
}

export interface TableRow {
  celsius: number;
  resistance: number;
  counts: number;
  resolution: number;
}

/** A resistance and reading table across a range, for a lookup table or a sanity check. */
export function table(
  from: number,
  to: number,
  step: number,
  model: BetaModel,
  fullScale: number,
  fixed: number,
  topology: Topology,
): TableRow[] {
  if (!(step > 0)) throw new Error('The step must be greater than zero.');
  if (to < from) throw new Error('The end of the range must not be below its start.');
  if ((to - from) / step > 1000) throw new Error('That range and step would produce more than 1000 rows.');

  const rows: TableRow[] = [];
  for (let celsius = from; celsius <= to + 1e-9; celsius += step) {
    const resistance = resistanceAt(celsius, model);
    rows.push({
      celsius,
      resistance,
      counts: countsFromResistance(resistance, fullScale, fixed, topology),
      resolution: resolutionAt(celsius, model, fullScale, fixed, topology),
    });
  }
  return rows;
}
