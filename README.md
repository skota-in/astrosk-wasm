# astrosk-wasm

Swiss Ephemeris compiled to WebAssembly. Lightweight, TypeScript-first
astronomical and astrological calculations for the browser, Node.js,
and Angular apps.

Built directly from the official Swiss Ephemeris C source (v2.10.03)
to ensure calculations match the reference C library exactly.

## Verified against Jagannatha Hora

Vedic astrologers can trust the numbers. Every release is validated
against 8 reference charts produced by **Jagannatha Hora 8.0** (PVR
Narasimha Rao) — 4 charts using **True Chitra** ayanamsa and 4 using
**True Pushya**, spanning 2010–2025 across India, USA, Japan, and the
UK. All 80 ayanamsa and planet checks agree with JHora's display to
sub-arcsecond precision.

The reference printouts live in [`examples/chart{1..8}.txt`](./examples)
and the test runs locally:

```bash
npm run build
npm run test:jhora
```

### How to call the API to match JHora

JHora displays the **mean / geometric** sidereal position — no nutation,
no light-time aberration. To reproduce its output, combine
`SWIEPH | NONUT | TRUEPOS` on every ayanamsa and `calcUt` call:

```ts
import { Astrosk, SE } from 'astrosk-wasm';

const astrosk = await Astrosk.init();

// 1. Pick the ayanamsa JHora is configured for.
astrosk.setSidMode(SE.SIDM.TRUE_PUSHYA);   // or TRUE_CITRA, LAHIRI, etc.

// 2. Convert local civil time → UT, then to a Julian Day.
//    JHora prints "Time Zone: 5:30:00 (East of GMT)" → UT = local - 5.5h.
const jdUt = astrosk.julday(2025, 5, 10, 5.2395);   // 10:44:22 IST = 05:14:22 UT

// 3. Read the ayanamsa with the JHora-matching flags.
const JHORA = SE.FLG.SWIEPH | SE.FLG.NONUT | SE.FLG.TRUEPOS;
const ayanamsa = astrosk.getAyanamsaExUt(jdUt, JHORA);

// 4. Compute sidereal planet longitudes with the same flags + SIDEREAL.
const sun = astrosk.calcUt(jdUt, SE.SUN, JHORA | SE.FLG.SIDEREAL | SE.FLG.SPEED);
console.log(sun.longitude);   // matches JHora's "Sun ... longitude" line

// 5. Ketu is geometric: Rahu + 180°.
const rahu = astrosk.calcUt(jdUt, SE.MEAN_NODE, JHORA | SE.FLG.SIDEREAL | SE.FLG.SPEED);
const ketu = (rahu.longitude + 180) % 360;
```

If you instead use plain `SE.FLG.SWIEPH`, you get the **apparent**
position (with nutation + aberration applied) — which is correct
astronomically but will differ from JHora's display by 20–40 arcsec
depending on date and body. Pick the convention that matches your
upstream reference and use it consistently.

## Why another wrapper?

`astrosk-wasm` exists because existing WASM ports of Swiss Ephemeris
were producing wrong values for ayanamsa and planet positions. This
library is verified against the native C `swetest` binary on every
build (see `tests/verify.mjs`).

## Install

```bash
npm install astrosk-wasm
```

## Quick start

```ts
import { Astrosk, SE } from 'astrosk-wasm';

const astrosk = await Astrosk.init();

// Optional: load ephemeris files for high-precision dates 1800-2400 AD
const buf = await fetch('/assets/ephe/sepl_18.se1').then(r => r.arrayBuffer());
astrosk.loadEphemerisFile('sepl_18.se1', new Uint8Array(buf));

const buf2 = await fetch('/assets/ephe/semo_18.se1').then(r => r.arrayBuffer());
astrosk.loadEphemerisFile('semo_18.se1', new Uint8Array(buf2));

// May 10, 2026 11:32:26 UT
const jd = astrosk.julday(2026, 5, 10, 11.540556);

const sun = astrosk.calcUt(jd, SE.SUN, SE.FLG.SWIEPH | SE.FLG.SPEED);
console.log('Sun longitude:', sun.longitude); // 49.8273°

// Sidereal (Vedic) - True Pushya ayanamsa (PVR Narasimha Rao)
astrosk.setSidMode(SE.SIDM.TRUE_PUSHYA);
const sunSid = astrosk.calcUt(
  jd, SE.SUN, SE.FLG.SWIEPH | SE.FLG.SIDEREAL | SE.FLG.SPEED,
);
console.log('Sun sidereal:', sunSid.longitude); // 26.7361°

// Houses (Placidus)
const houses = astrosk.houses(jd, 42.20278, -71.68611, 'P');
console.log('Ascendant:', houses.ascmc[0]);
console.log('MC:', houses.ascmc[1]);

astrosk.close();
```

## Angular integration

Create a service:

```ts
// src/app/astrosk.service.ts
import { Injectable } from '@angular/core';
import { Astrosk, SE } from 'astrosk-wasm';

@Injectable({ providedIn: 'root' })
export class AstroskService {
  private instance?: Astrosk;
  private initPromise?: Promise<Astrosk>;

  async getInstance(): Promise<Astrosk> {
    if (this.instance) return this.instance;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const astrosk = await Astrosk.init({ ephePath: '/ephe' });

      // Load minimal ephemeris (1800-2400 AD)
      for (const name of ['sepl_18.se1', 'semo_18.se1', 'seleapsec.txt']) {
        const buf = await fetch(`/assets/ephe/${name}`).then(r => r.arrayBuffer());
        astrosk.loadEphemerisFile(name, new Uint8Array(buf));
      }

      this.instance = astrosk;
      return astrosk;
    })();

    return this.initPromise;
  }

  async sunLongitude(date: Date): Promise<number> {
    const a = await this.getInstance();
    const hours = date.getUTCHours()
      + date.getUTCMinutes() / 60
      + date.getUTCSeconds() / 3600;
    const jd = a.julday(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hours,
    );
    return a.calcUt(jd, SE.SUN).longitude;
  }
}
```

Configure assets in `angular.json`:

```json
"assets": [
  {
    "glob": "**/*",
    "input": "node_modules/astrosk-wasm/wasm",
    "output": "/wasm"
  },
  {
    "glob": "**/*",
    "input": "node_modules/astrosk-wasm/deps/ephe",
    "output": "/assets/ephe"
  }
]
```

If your bundler does not auto-resolve `astrosk.wasm`, locate it explicitly:

```ts
const astrosk = await Astrosk.init({
  locateWasm: '/wasm/astrosk.wasm',
});
```

## Ephemeris files

The npm package ships with a minimal set covering the **9 classical
planets (Sun through Pluto) for years 1800-2400 AD**:

- `sepl_18.se1` — planets 1800-2400 (476 KB)
- `semo_18.se1` — moon 1800-2400 (1.3 MB)
- `seleapsec.txt`, `sefstars.txt`, `seorbel.txt`

For wider date ranges, download additional `.se1` files from
[astro.com/ftp/swisseph/ephe](https://www.astro.com/ftp/swisseph/ephe/)
and load them via `loadEphemerisFile()`.

For the JPL DE441 ephemeris (~3 GB), serve `de441.eph` from your CDN
and call `setJplFile('de441.eph')` then use `SE.FLG.JPLEPH` in calc flags.
The JPL file is **not bundled** because of its size.

If no ephemeris file is loaded, the Moshier semi-analytical model is used
automatically when you pass `SE.FLG.MOSEPH`. Accuracy is ~0.01" (Sun) to
~7" (Moon) — sufficient for general astrology but not professional
astronomy.

## API

### `Astrosk.init(options?)`

Returns a Promise resolving to a configured `Astrosk` instance.

Options:
- `ephePath?: string` — virtual FS path for ephemeris (default `/ephe`)
- `locateWasm?: string | (defaultUrl) => string | ArrayBuffer` — override
  WASM binary location
- `noEphePath?: boolean` — skip auto-call to `swe_set_ephe_path`

### Date / time

- `julday(year, month, day, hour, gregFlag?)` → JD
- `revjul(jd, gregFlag?)` → `{ year, month, day, hour }`
- `utcToJd({year, month, day, hour, minute, second})` → `{ jdEt, jdUt }`
- `deltaT(jd)` → seconds
- `sidtime(jd)` → hours

### Planets

- `calcUt(jdUt, body, flags?)` → `CalcResult`
- `calc(jdEt, body, flags?)` → `CalcResult`
- `getPlanetName(planet)` → string

### Ayanamsa / sidereal

- `setSidMode(mode, t0?, ayan_t0?)`
- `getAyanamsaUt(jdUt)` → degrees
- `getAyanamsaExUt(jdUt, flags?)` → degrees (preferred)
- `getAyanamsaName(mode)` → string

### Houses

- `houses(jdUt, lat, lon, hsys?)` → `HousesResult`
- `housesEx(jdUt, flags, lat, lon, hsys?)` → `HousesResult`

### Lifecycle

- `setEphePath(path)`
- `setJplFile(name)`
- `loadEphemerisFile(name, bytes)`
- `setTopo(lon, lat, alt?)`
- `version()`
- `close()` — frees native scratch buffers; required to avoid leaks

## Verification

Tests in `tests/verify.mjs` compare every value to native `swetest`
output captured from Swiss Ephemeris 2.10.03 C library. Tolerance is
1e-6° (3.6 milliarcseconds) for tropical planet longitudes.

The Vedic suite (`tests/jhora.spec.ts`) reproduces 8 Jagannatha Hora
reference charts — 4 True Chitra + 4 True Pushya — and confirms every
ayanamsa and planet longitude agrees with JHora's display to within a
few arcseconds.

```bash
npm run build
npm test            # swetest suite (tropical + sidereal vs C reference)
npm run test:jhora  # JHora suite (8 reference charts)
```

## License

`astrosk-wasm` is licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later). See [LICENSE](./LICENSE).

This project incorporates the [Swiss Ephemeris](https://github.com/aloistr/swisseph) by Astrodienst AG (© 1997–2021), used under AGPL-3.0. See [NOTICE](./NOTICE) for full attribution.

### A note on the AGPL network clause

Because AGPL-3.0 §13 applies, any public network service that embeds `astrosk-wasm` must offer its users access to the complete corresponding source code of the deployed version. AstroSK satisfies this by making its source publicly available at <https://github.com/skota-in/astrosk> with releases tagged to match deployments.

### Commercial use

If the AGPL is incompatible with your project, you cannot use `astrosk-wasm` directly — you must obtain a [Swiss Ephemeris Professional License](https://www.astro.com/swisseph/) directly from Astrodienst AG and link against the upstream Swiss Ephemeris under that license.

## Credits

- [Swiss Ephemeris](https://www.astro.com/swisseph/) by Astrodienst AG.
- Inspired by `swisseph-wasm` (which had calculation bugs this library
  fixes).
