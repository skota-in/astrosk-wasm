# astrosk-wasm tests

Verification harness that compares this library's output against
authoritative reference values captured from native `swetest`
(Swiss Ephemeris 2.10.03 C library) and from Jagannatha Hora chart
printouts (True Pushya ayanamsa, PVR Narasimha Rao).

## Files

- [verify.mjs](./verify.mjs) — the test runner. Plain Node ESM, no test
  framework. Loads built `dist/index.js`, drives each fixture, and
  prints a `passed / failed` summary.
- [reference.json](./reference.json) — fixture file. Each top-level key
  is one test case with date, expected ayanamsa, and expected planet
  longitudes (both raw decimals from `swetest` and Jagannatha Hora DMS
  display values).

## Run

From the package root (`astrosk-wasm/`):

```bash
npm run build      # builds wasm + ts → dist/
npm test           # runs node tests/verify.mjs
```

If you have already built once and are only iterating on test logic or
fixtures:

```bash
node tests/verify.mjs
```

The runner exits with code `0` when all assertions pass and `1`
otherwise — suitable for CI.

### Prerequisites

- Node `>=18`
- Emscripten toolchain to rebuild the wasm (only needed if `wasm/` is
  stale; see [../MAINTAINING.md](../MAINTAINING.md))
- The minimal ephemeris files in [`../deps/ephe/`](../deps/ephe/):
  `sepl_18.se1`, `semo_18.se1`, `seleapsec.txt`, `sefstars.txt`,
  `seorbel.txt`. These ship with the repo.

## Tolerances

| Comparison                          | Tolerance         | Constant in verify.mjs |
| ----------------------------------- | ----------------- | ---------------------- |
| Tropical longitude / latitude       | 1e-5°  (~36 mas)  | `TROP_TOL`             |
| Distance (AU)                       | 1e-7              | inline                 |
| `julday`                            | 1e-6 days         | inline                 |
| `deltaT` (seconds)                  | 1e-3 s            | inline                 |
| Sidereal longitude vs prior capture | 1e-4°  (~0.36")   | `SID_TOL`              |
| Ayanamsa / slow planet vs JHora     | 5" (~0.0014°)     | `JHORA_TOL`            |
| Moon vs JHora                       | 10" (~0.0028°)    | `JHORA_MOON_TOL`       |

The JHora budget is generous-but-tight: the wasm output matches JHora to
~10 mas on the ayanamsa and a few arcsec on most planet longitudes. The
Moon needs extra slack because it moves ~30"/min and JHora 8.0 uses an
older deltaT table than Swiss Ephemeris 2.10.03, so even sub-second time
differences amplify.

### Flag conventions (important)

`verify.mjs` calls `getAyanamsaExUt(jd)` with **no explicit flag** — that
relies on the library default `SWIEPH | NONUT | TRUEPOS`, which is the
JHora-compatible mean/geometric ayanamsa. Sidereal `calcUt` calls use
`flagsSid = SWIEPH | SIDEREAL | NONUT | TRUEPOS | SPEED`.

**Do not pass plain `SWIEPH` for ayanamsa or sidereal calcs.** It returns
the apparent (with-nutation, with-aberration) value, which is off by
~2-25 arcsec depending on date and ayanamsa mode. See
[../README.md#flag-conventions-for-body-derived-ayanamsas](../README.md#flag-conventions-for-body-derived-ayanamsas)
for the full table.

---

## Adding a new date → expected-ayanamsa case

This is the workflow for "I have a date and I expect the True Pushya
ayanamsa to be `dd-mm-ss`."

### 1. Convert the expected DMS to decimal degrees

```
23° 05' 25.71"  →  23 + 5/60 + 25.71/3600  =  23.0904750°
```

Or in Node:

```js
const toDeg = (d, m, s) => d + m / 60 + s / 3600;
toDeg(23, 5, 25.71); // 23.09047500
```

### 2. Convert local time to UT

`verify.mjs` always works in **Universal Time**. Subtract the timezone
offset from the local clock time to get UT, then express the time as a
decimal hour:

```
Local: 2026-05-10  10:44:22  EDT  (UTC-4)
UT:    2026-05-10  14:44:22
Hour:  14 + 44/60 + 22/3600  =  14.7394444
```

### 3. Append a fixture to `reference.json`

Pick one of the existing shapes depending on what you want asserted:

**Just an ayanamsa expectation** (the common case for this workflow):

```json
"true_pushya_2026_05_10_14_44_22_UT": {
  "_label": "True Pushya, May 10 2026 14:44:22 UT (South Grafton MA, EDT 10:44:22)",
  "year": 2026, "month": 5, "day": 10, "hour": 14.7394444,
  "ayanamsa_deg_jhora": 23.0904750
}
```

**Asserted against a prior wasm capture** (tight, used for regression —
`SID_TOL = 1e-4°`):

```json
"ayanamsa_deg": 23.0904674
```

**Asserted against a JHora screenshot** (`JHORA_TOL = 5"`):

```json
"ayanamsa_deg_jhora": 23.0904722
```

`ayanamsa_deg` and `ayanamsa_deg_jhora` should now agree to ~10 mas —
they diverge only by JHora's display rounding and its older deltaT
table. You can include both; `verify.mjs` will run whichever keys are
present. Optionally add `longitudes` and `jhora_longitudes_dms` blocks
following the same shape as the existing entries to also assert planet
positions.

> **Capturing a new `ayanamsa_deg`**: run `getAyanamsaExUt(jd)` with the
> library default — *do not* pass `SWIEPH` explicitly, or you'll capture
> the apparent value and the regression check becomes meaningless.

### 4. Register the case in `verify.mjs`

Add the new key to the True Pushya loop in
[verify.mjs](./verify.mjs):

```js
for (const key of [
  'true_pushya_2020_04_21_12_32_26_UT',
  'true_pushya_2025_05_10_02_02_26_UT',
  'true_pushya_2026_05_10_11_32_26_UT',
  'true_pushya_2026_05_10_14_44_22_UT',   // ← new
]) {
  ...
}
```

### 5. Run

```bash
node tests/verify.mjs
```

The case prints as:

```
Test: True Pushya, May 10 2026 14:44:22 UT (South Grafton MA, EDT 10:44:22)
  Ayanamsa: 23.0904725° (JHora reference: 23.090475)
```

A `FAIL` line shows the expected value, the computed value, the
absolute difference, and the tolerance — making it obvious whether
the gap is a bug or a tolerance-budget issue.

## Single-date JHora check

[jHora.spec.mjs](./jHora.spec.mjs) (`npm run test:jhora`) is a smaller,
spec-style harness for the common workflow: "I have one JHora chart
printout, does astrosk-wasm match it?". Edit the `data` object inline,
re-run. Tolerance is 0.1" by default. Use this when you're investigating
one specific chart; use [verify.mjs](./verify.mjs) for the full regression
sweep.

---

## Regenerating reference values

When upstream Swiss Ephemeris is bumped, the `swetest`-derived numbers
in `reference.json` need to be recaptured. The exact `swetest`
invocations are documented in [../MAINTAINING.md](../MAINTAINING.md)
under "Capture new reference values".
