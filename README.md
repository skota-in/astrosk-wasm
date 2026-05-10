# astrosk-wasm

Swiss Ephemeris compiled to WebAssembly. Lightweight, TypeScript-first
astronomical and astrological calculations for the browser, Node.js,
and Angular apps.

Built directly from the official Swiss Ephemeris C source (v2.10.03)
to ensure calculations match the reference C library exactly.

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
const flagsSid =
  SE.FLG.SWIEPH | SE.FLG.SIDEREAL | SE.FLG.NONUT | SE.FLG.TRUEPOS | SE.FLG.SPEED;
const sunSid = astrosk.calcUt(jd, SE.SUN, flagsSid);
console.log('Sun sidereal:', sunSid.longitude); // 26.7408° (matches JHora)

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
- `getAyanamsaUt(jdUt)` → degrees — legacy, always returns the apparent
  (with-nutation, with-aberration) value. Prefer `getAyanamsaExUt`.
- `getAyanamsaExUt(jdUt, flags?)` → degrees — **preferred**. Default flag
  is `SWIEPH | NONUT | TRUEPOS`, which returns the mean / geometric
  ayanamsa that JHora displays and Vedic astrology software conventionally
  uses. Override the flag only if you specifically want the apparent
  (instantaneous, with-nutation) value.
- `getAyanamsaName(mode)` → string

#### Flag conventions for body-derived ayanamsas

True Pushya, True Citra, True Revati, True Mula and True Sheoran are all
defined by the position of a specific fixed star. Their values depend on
whether you ask for the *apparent* or *true geometric* star position:

| Flag combination | Star position | Ayanamsa style | Matches JHora? |
|------------------|---------------|----------------|----------------|
| `SWIEPH` only            | apparent (with nutation + aberration) | "instantaneous" | no (off ~2-6") |
| `SWIEPH \| NONUT`        | apparent (no nutation, with aberration) | partial | no (off ~3-6") |
| `SWIEPH \| TRUEPOS`      | geometric (with nutation, no aberration) | partial | no (off ~6") |
| **`SWIEPH \| NONUT \| TRUEPOS`** | geometric (no nutation, no aberration) | **mean / Vedic** | **yes (≤10 mas)** |

For sidereal `calcUt`, propagate the same flags:
`SWIEPH | SIDEREAL | NONUT | TRUEPOS | SPEED`.

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

Tests in `tests/verify.mjs` compare every value to two independent
reference sources:

- **Tropical** numbers (planet longitudes, latitudes, distances, deltaT,
  julday) are checked against native `swetest` output captured from
  Swiss Ephemeris 2.10.03. Tolerance: 1e-5° (~36 mas).
- **Sidereal True Pushya** numbers (ayanamsa + sidereal longitudes) are
  checked against Jagannatha Hora chart printouts (PVR Narasimha Rao).
  Tolerance: 5" for slow planets, 10" for the Moon.

The Vedic test reproduces three JHora chart printouts to within ~10 mas
on the ayanamsa and a few arcsec on the planet longitudes — see
[tests/README.md](./tests/README.md) for the workflow to add new dates.

```bash
npm run build
npm test            # verify suite
npm run test:jhora  # spec-style single-date JHora check
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
