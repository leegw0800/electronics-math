# electronics-math

The arithmetic you do on the bench, as pure functions with no dependencies.

E-series preferred values, resistor colour bands, Ohm's law, voltage dividers
with tolerance stack-up, RC filters, LED series resistors, I²C pull-ups, PCB
trace width, and NTC thermistors including Steinhart–Hart fitting.

Every function is pure: numbers in, numbers out. No DOM, no I/O, no globals.
134 tests, written against the standards and the boundary values rather than
against the implementation.

```bash
npm install electronics-math
```

## Why this exists

These calculations are not hard, which is exactly why they get retyped into a
scratch file on every project and quietly get a decimal point wrong. They are
also mostly *defined* — IEC 60063 says what an E24 value is, IPC-2221 says how
wide the trace has to be — so there is a correct answer to check against, and
a library is a better place to keep it than a spreadsheet.

The code was extracted from the calculators at
[firmgod.com/tools](https://www.firmgod.com/tools), where it had already been
separated from the UI and tested. Each section below links to the browser
version if you want to poke at the numbers before wiring the function in.

## Conventions

Getting these wrong is the most likely reason your first call throws, so they
are listed before the examples:

| Quantity | Unit | Example |
| --- | --- | --- |
| Resistance | ohms | `4700`, not `4.7` |
| Capacitance | farads | `1e-8`, not `10` for 10 nF |
| Time | seconds | `300e-9` for 300 ns |
| Current | amps | `0.02` for 20 mA |
| **Tolerance** | **fraction** | **`0.05` for ±5 %, not `5`** |
| Temperature | celsius | `25` |

Bad input throws with a sentence saying what was wrong, rather than returning
`NaN` for you to discover three steps later.

## Usage

Each module is its own entry point, so you can import one without pulling in
the rest:

```js
import { nearest, formatOhms } from 'electronics-math/eseries';
```

Or take them as namespaces, which is how the names stay short — six modules
export a function called `solve`:

```js
import { rc, colorcode } from 'electronics-math';
```

### Resistor colour code — [try it](https://www.firmgod.com/tools/resistor-color-code-calculator)

IEC 60062, 4/5/6 bands, both directions. `decode` also reports whether reading
the bands the other way round gives a different valid value, which is the
actual problem with an unmarked resistor in your hand.

```js
import { decode, encode } from 'electronics-math/colorcode';

decode(['brown', 'black', 'red', 'gold']).value;   // 1000
encode(4700, 4, 0.05);                             // ['yellow','violet','red','gold']
```

### E-series preferred values — part of every selector below

IEC 60063, E6 through E192.

```js
import { nearest, neighbours, isStandard, formatOhms } from 'electronics-math/eseries';

formatOhms(nearest(3300, 'E24'));       // '3.3k'
neighbours(5000, 'E12');                // { below: 4700, above: 5600 }
isStandard(4700, 'E24');                // true
```

### Ohm's law — [try it](https://www.firmgod.com/tools/ohms-law-calculator)

Give any two of V, I, R, P and get the other two, plus which pair the answer
came from.

```js
import { solve } from 'electronics-math/ohmslaw';

solve({ v: 5, r: 220 });
// { v: 5, i: 0.0227…, r: 220, p: 0.1136…, from: ['v','r'] }
```

### Voltage divider — [try it](https://www.firmgod.com/tools/voltage-divider-calculator)

Picks standard pairs for a target output and reports the worst case across
tolerance, which is the number that decides whether the divider is usable.

```js
import { solve, worstCase } from 'electronics-math/voltagedivider';

solve({ vin: 5, vout: 3.3, series: 'E24', r2Decade: 10000 })[0];
// → r1 47k, r2 91k, vout 3.297 V

worstCase(5, 47000, 91000, 0.01);   // { min: …, max: … }
```

### Parallel and series — [try it](https://www.firmgod.com/tools/parallel-resistor-calculator)

Combination, and the standard-value pair that lands nearest a target.

```js
import { parallel, pairsFor } from 'electronics-math/parallel';

parallel([1000, 1000]);              // 500
pairsFor(3300, 'E24');               // nearest pairs, closest first
```

A pair is only offered when both legs do real work: a leg more than 100× the
other is a trim resistor, not a combination, and gets dropped even though its
arithmetic error is tiny.

### RC filter — [try it](https://www.firmgod.com/tools/rc-filter-calculator)

First-order low-pass and high-pass. Cutoff, time constant, rise time, settling
to a given number of bits, and the magnitude/phase response at a frequency.

```js
import { cutoff, settlingTime, response, solve } from 'electronics-math/rc';

cutoff(10000, 1e-8);                    // 1591.55 Hz
settlingTime(12, 10000 * 1e-8);         // 8.32e-4 s to settle to 12 bits
response(1000, 1591.55, 'lowpass');     // { magnitude: 0.847, db: -1.45, phaseDeg: -32.1 }

// every capacitor in the decade, paired with its nearest standard resistor,
// ranked by how close the cutoff lands. Tolerances are R then C.
solve({ fc: 1000, rSeries: 'E24', cSeries: 'E12', cDecade: 1e-8 }, 0.01, 0.1)[0];
// → r 16k, c 10n, fc 994.72 Hz
```

### LED series resistor — [try it](https://www.firmgod.com/tools/led-resistor-calculator)

Includes the two things that actually bite: the current if every LED's forward
voltage runs high, and the smallest standard power rating with 2× margin.

```js
import { solve } from 'electronics-math/ledresistor';

const s = solve({ supply: 5, forward: 2.0, current: 0.02, count: 1,
                  series: 'E24', tolerance: 0.05 });
s.candidates.find(c => c.isNearest);
// → r 150, current 0.02, rating 0.125, ifForwardHigh, worst: { min, max }
```

### I²C pull-ups — [try it](https://www.firmgod.com/tools/i2c-pullup-calculator)

The window between the minimum the weakest device can pull low and the maximum
that still meets the mode's rise time, using the figures from NXP UM10204.

```js
import { getMode, solve } from 'electronics-math/i2cpullup';

const fast = getMode('fast');
solve({ supply: 3.3, capacitance: 100e-12, riseTimeMax: fast.riseTimeMax,
        sinkCurrent: fast.sinkCurrent, outputLow: fast.outputLow, series: 'E24' });
// → min 966.7 Ω, max 3.54 kΩ, with standard values between
```

High-speed mode is deliberately absent: it uses an active current source
during transfers, so "what resistor" is not the question being asked.

### PCB trace width — [try it](https://www.firmgod.com/tools/pcb-trace-width-calculator)

IPC-2221, external and internal layers, in both directions, plus trace
resistance at temperature.

```js
import { widthForCurrent, currentForWidth, traceResistance } from 'electronics-math/trace';

widthForCurrent(2, 10, 1, 'external');       // { mils, mm } for 2 A, 10 °C rise, 1 oz
currentForWidth(0.5, 20, 1, 'internal');
traceResistance(0.5, 1, 100, 85);            // ohms, 85 °C
```

### NTC thermistor — [try it](https://www.firmgod.com/tools/ntc-thermistor-calculator)

Beta model and Steinhart–Hart, a least-squares fit from three or more measured
points, and the ADC side: counts to resistance, resolution per count, and
self-heating.

```js
import { resistanceAt, temperatureAt, fitSteinhartHart,
         steinhartTemperature } from 'electronics-math/thermistor';

const ntc = { r0: 10000, t0: 25, beta: 3950 };
resistanceAt(60, ntc);                        // 2486 Ω
temperatureAt(2486, ntc);                     // 60 °C

const sh = fitSteinhartHart([
  { celsius: 0,  resistance: 32650 },
  { celsius: 25, resistance: 10000 },
  { celsius: 60, resistance: 2488 },
]);
steinhartTemperature(2488, sh);
```

Beta is a two-point fit: exact where it was measured and drifting in between.
Fit Steinhart–Hart if the datasheet gives you a table.

### Unit formatting

```js
import { formatFrequency, formatFarads, formatTime } from 'electronics-math/units';

formatFrequency(1591.5494);   // '1.59 kHz'
formatFarads(1e-8);           // '10n'
formatTime(1e-4);             // '100 µs'
```

## Standards

- **IEC 60063** — preferred number series (E6 … E192)
- **IEC 60062** — marking codes for resistors and capacitors
- **IPC-2221** — generic standard on printed board design, trace width
- **NXP UM10204** — I²C-bus specification, Table 10

Where a standard defines the answer, the tests assert against the standard's
own numbers. Where it does not — the trace-width curve fit, for instance —
the tests assert the documented formula and its boundaries.

## Development

```bash
npm test     # node --test, no build step, no loader
npm run check # type-check including the tests
npm run build # tsc to dist/, ESM + .d.ts
```

Tests run straight off the TypeScript sources under Node's own type stripping,
which is why the source imports carry `.ts` extensions;
`rewriteRelativeImportExtensions` turns them into `.js` on the way out.

Requires Node 18+ to consume, Node 22+ to run the tests from source.

## Contributing

Bug reports with a worked example are the most useful thing — a value, the
result you got, and the figure from the datasheet or standard you expected.
Correctness is the whole point of this package, so a reproducible disagreement
is worth more than a feature request.

## License

MIT
