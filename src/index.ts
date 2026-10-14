/**
 * electronics-math — the calculations behind a bench engineer's arithmetic.
 *
 * Every module is a namespace rather than a flat re-export, because six of
 * them export a function called `solve` and three export a type called
 * `Solution`. Flattening would have meant renaming them all to
 * `solveVoltageDivider`, `solveRcFilter` and so on, which reads worse at the
 * call site than the thing it is replacing:
 *
 *     import { rc } from 'electronics-math';
 *     rc.solve({ fc: 1_000 }, 0.01, 0.1);
 *
 * Each namespace is also its own entry point, so importing one does not pull
 * the rest in:
 *
 *     import { solve } from 'electronics-math/rc';
 */

/** Engineering-notation formatting for volts, amps, watts, hertz, seconds, farads. */
export * as units from './units.ts';

/** IEC 60063 preferred values: E6 through E192, nearest and neighbouring values. */
export * as eseries from './eseries.ts';

/** IEC 60062 resistor colour bands: decode and encode 4, 5 and 6 band codes. */
export * as colorcode from './colorcode.ts';

/** Ohm's law and the power equations: solve from any two of V, I, R, P. */
export * as ohmslaw from './ohmslaw.ts';

/** Parallel and series combinations, and finding a pair that hits a target. */
export * as parallel from './parallel.ts';

/** Resistive dividers with tolerance stack-up and standard-value selection. */
export * as voltagedivider from './voltagedivider.ts';

/** First-order RC filters: cutoff, time constant, settling, step response. */
export * as rc from './rc.ts';

/** LED series resistors, including worst-case current and power rating. */
export * as ledresistor from './ledresistor.ts';

/** I²C pull-up sizing from bus capacitance, rise time and sink current. */
export * as i2cpullup from './i2cpullup.ts';

/** PCB trace width to IPC-2221, plus trace resistance over temperature. */
export * as trace from './trace.ts';

/** NTC thermistors: Beta model, Steinhart–Hart, curve fitting, ADC counts. */
export * as thermistor from './thermistor.ts';
