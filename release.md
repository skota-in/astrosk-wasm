# astrosk-wasm v0.2.0

Swiss Ephemeris in WebAssembly, validated against Jagannatha Hora.

## Highlights

- **Verified against Jagannatha Hora 8.0.** 8 reference charts (4 True
  Chitra + 4 True Pushya), spanning 2010–2025 across India, USA, Japan,
  and the UK. All 80 ayanamsa and planet checks agree with JHora's
  display to sub-arcsecond precision.
- **Strict alignment with the upstream `sweph` (Node binding) flag
  convention.** `getAyanamsaExUt` no longer ships an opinionated
  default — callers pass the same flags they would to the C library.
  Pick `SWIEPH` for apparent (astronomical) values, or
  `SWIEPH | NONUT | TRUEPOS` for JHora-compatible mean/geometric
  values, and use the same flags on `calcUt`.
- **Top-of-README usage guide.** New "Verified against Jagannatha Hora"
  section shows the exact 5-step recipe (sid mode → UT → ayanamsa →
  planets → Ketu) that reproduces JHora's chart output.

## What's new

### JHora validation suite

A new test (`tests/jhora.spec.ts`) parses the 8 chart printouts in
`examples/chart{1..8}.txt`, infers the sidereal mode from the header,
converts local civil time to UT using each chart's printed timezone,
and validates ayanamsa plus Sun/Moon/Mars/Mercury/Jupiter/Venus/Saturn/
Rahu/Ketu against JHora's displayed DMS values.

Tolerances: 5″ for ayanamsa and planets, 15″ for the Moon.
Result: **80 passed, 0 failed.**

Run it locally:

```bash
npm run build
npm run test:jhora
```

### New `test:jhora` npm script

Wraps `node --experimental-strip-types tests/jhora.spec.ts` so the
TypeScript spec runs directly under Node 22.6+ without a build step.

### README rewrite

- Hero block at the top: validation evidence + reproducible test
  command + drop-in code recipe for JHora-style output.
- Clear note on the `SWIEPH` vs `SWIEPH | NONUT | TRUEPOS` choice and
  what each one means for the displayed numbers.
- Existing API reference, Angular integration guide, and ephemeris
  notes preserved.

## Behavior change (vs the reverted 1.0.1)

If you were on the unreleased `1.0.1` build that defaulted
`getAyanamsaExUt` to `SWIEPH | NONUT | TRUEPOS`, that default has been
removed. To keep JHora-compatible output, pass the flags explicitly:

```ts
const JHORA = SE.FLG.SWIEPH | SE.FLG.NONUT | SE.FLG.TRUEPOS;
const ayanamsa = astrosk.getAyanamsaExUt(jdUt, JHORA);
const sun = astrosk.calcUt(jdUt, SE.SUN, JHORA | SE.FLG.SIDEREAL | SE.FLG.SPEED);
```

This keeps astrosk-wasm a thin, faithful wrapper over the C library —
matching the `sweph` Node binding's convention of leaving policy
decisions to the caller.

## Upgrade notes

- No source-level API changes vs `0.1.0`.
- If your code was relying on `getAyanamsaExUt(jd)` (no flags) to
  return a specific convention, decide between apparent (`SWIEPH`) and
  mean/geometric (`SWIEPH | NONUT | TRUEPOS`) and pass it explicitly.
  See the README's JHora section for the recipe.

## Verification

- `npm test` — tropical and sidereal positions vs native `swetest`
  output captured from Swiss Ephemeris 2.10.03 (tolerance 1e-6° on
  tropical longitudes).
- `npm run test:jhora` — 8 JHora reference charts, sub-arcsecond.

## Install

```bash
npm install astrosk-wasm@0.2.0
```

## Credits

Swiss Ephemeris by Astrodienst AG. JHora reference data by PVR
Narasimha Rao (Jagannatha Hora 8.0).
