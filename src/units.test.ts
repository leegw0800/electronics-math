import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFrequency, formatTime, formatFarads, parseFarads, formatVolts } from './units.ts';

test('frequency picks the unit an engineer would say', () => {
  assert.equal(formatFrequency(159.155), '159 Hz');
  assert.equal(formatFrequency(1000), '1 kHz');
  assert.equal(formatFrequency(994.7), '995 Hz');
  assert.equal(formatFrequency(999.7), '1 kHz');
  assert.equal(formatFrequency(2.5e6), '2.5 MHz');
  assert.equal(formatFrequency(0.5), '0.5 Hz');
});

test('time steps down through ms, µs and ns', () => {
  assert.equal(formatTime(1e-3), '1 ms');
  assert.equal(formatTime(2.197e-3), '2.2 ms');
  assert.equal(formatTime(1.59e-4), '159 µs');
  assert.equal(formatTime(1e-9), '1 ns');
  assert.equal(formatTime(1.5), '1.5 s');
});

test('capacitance formats without the unit letter', () => {
  assert.equal(formatFarads(1e-7), '100n');
  assert.equal(formatFarads(4.7e-9), '4.7n');
  assert.equal(formatFarads(1e-5), '10µ');
  assert.equal(formatFarads(1e-12), '1p');
  assert.equal(formatFarads(2.2e-6), '2.2µ');
  assert.equal(formatFarads(1e-3), '1m');
});

test('parseFarads reads every common spelling', () => {
  assert.equal(parseFarads('100n'), 1e-7);
  assert.equal(parseFarads('0.1u'), 1e-7);
  assert.equal(parseFarads('100nF'), 1e-7);
  assert.equal(parseFarads('4n7'), 4.7e-9);
  assert.equal(parseFarads('10µ'), 1e-5);
  assert.equal(parseFarads('10uF'), 1e-5);
  assert.equal(parseFarads('1000p'), 1e-9);
  assert.equal(parseFarads('2.2n'), 2.2e-9);
  assert.equal(parseFarads('1F'), 1);
  assert.throws(() => parseFarads(''), /Enter a capacitance/);
  assert.throws(() => parseFarads('abc'), /not a capacitance/);
  assert.throws(() => parseFarads('4.7n7'), /mixes/);
});

test('volts step down to millivolts below one volt', () => {
  assert.equal(formatVolts(3.311258), '3.311 V');
  assert.equal(formatVolts(5), '5 V');
  assert.equal(formatVolts(0.01757), '17.6 mV');
  assert.equal(formatVolts(0.9996), '0.9996 V'); // four figures below a volt, still volts
  assert.equal(formatVolts(0.99996), '1 V');
  assert.equal(formatVolts(0.00032), '320 µV');
});
