/**
 * Readable engineering units. Values are chosen at the scale someone reads
 * them off a meter: 331 µA rather than 0.000331 A, 1.65 mW rather than
 * 0.00165 W. Three significant figures, trailing zeros dropped.
 */

export function formatCurrent(amps: number): string {
  if (amps >= 1) return `${trim(amps, 3)} A`;
  if (amps >= 1e-3) return `${trim(amps * 1e3, 3)} mA`;
  if (amps >= 1e-6) return `${trim(amps * 1e6, 3)} µA`;
  return `${trim(amps * 1e9, 3)} nA`;
}

export function formatPower(watts: number): string {
  if (watts >= 1) return `${trim(watts, 3)} W`;
  if (watts >= 1e-3) return `${trim(watts * 1e3, 3)} mW`;
  if (watts >= 1e-6) return `${trim(watts * 1e6, 3)} µW`;
  return `${trim(watts * 1e9, 3)} nW`;
}

export function formatVolts(volts: number): string {
  const v = Math.abs(volts);
  if (v >= 0.9995 || v === 0) return `${trim(volts, 4)} V`;
  if (v >= 1e-3 * 0.9995) return `${trim(volts * 1e3, 3)} mV`;
  return `${trim(volts * 1e6, 3)} µV`;
}

// The 0.9995 guard keeps a value that rounds up to the next unit (999.7 Hz)
// from printing as "1000 Hz" instead of "1 kHz".
export function formatFrequency(hz: number): string {
  if (hz >= 1e9 * 0.9995) return `${trim(hz / 1e9, 3)} GHz`;
  if (hz >= 1e6 * 0.9995) return `${trim(hz / 1e6, 3)} MHz`;
  if (hz >= 1e3 * 0.9995) return `${trim(hz / 1e3, 3)} kHz`;
  return `${trim(hz, 3)} Hz`;
}

export function formatTime(seconds: number): string {
  if (seconds >= 0.9995) return `${trim(seconds, 3)} s`;
  if (seconds >= 1e-3 * 0.9995) return `${trim(seconds * 1e3, 3)} ms`;
  if (seconds >= 1e-6 * 0.9995) return `${trim(seconds * 1e6, 3)} µs`;
  if (seconds >= 1e-9 * 0.9995) return `${trim(seconds * 1e9, 3)} ns`;
  return `${trim(seconds * 1e12, 3)} ps`;
}

/** 1e-7 -> "100n", 4.7e-9 -> "4.7n", 1e-5 -> "10µ". No unit letter; the caller adds F. */
export function formatFarads(farads: number): string {
  if (farads >= 0.9995) return `${trim(farads, 3)}`;
  if (farads >= 1e-3 * 0.9995) return `${trim(farads * 1e3, 3)}m`;
  if (farads >= 1e-6 * 0.9995) return `${trim(farads * 1e6, 3)}µ`;
  if (farads >= 1e-9 * 0.9995) return `${trim(farads * 1e9, 3)}n`;
  return `${trim(farads * 1e12, 3)}p`;
}

/**
 * Reads capacitance the way it is written on a schematic: "100n", "0.1u",
 * "100nF", "4n7", "10µ", "1000p". A trailing F is optional.
 */
export function parseFarads(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('Enter a capacitance.');

  const match = /^(\d+)(?:[.,](\d+))?\s*([pnuµmF]?)\s*(\d*)\s*F?$/.exec(trimmed);
  if (!match) throw new Error(`"${trimmed}" is not a capacitance. Try 100n, 0.1u, 4n7 or 10µF.`);

  const [, whole, fraction, prefix, trailing] = match;
  if (fraction !== undefined && trailing !== '') {
    throw new Error(`"${trimmed}" mixes a decimal point with the 4n7 style; use one or the other.`);
  }

  const mantissa = Number(`${whole}.${fraction ?? trailing ?? '0'}`);
  const multiplier =
    prefix === 'p' ? 1e-12 : prefix === 'n' ? 1e-9 : prefix === 'u' || prefix === 'µ' ? 1e-6 : prefix === 'm' ? 1e-3 : 1;

  const value = mantissa * multiplier;
  if (!(value > 0)) throw new Error('Capacitance must be greater than zero.');
  return Number(value.toPrecision(12));
}

function trim(value: number, digits: number): string {
  return String(Number(value.toPrecision(digits)));
}
