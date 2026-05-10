// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 skota.in

/**
 * astrosk-wasm verification tests.
 *
 * Compares wasm output against authoritative reference values captured
 * from native `swetest` (Swiss Ephemeris 2.10.03 C library) and against
 * three Jagannatha Hora chart printouts (PVR Narasimha Rao's True
 * Pushya ayanamsa).
 *
 * Reference data lives in tests/reference.json. To regenerate after a
 * swisseph upstream sync, see MAINTAINING.md § "Capture new reference
 * values".
 *
 * Run:
 *   npm run build
 *   npm test
 *
 * Or directly:
 *   node tests/verify.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Tests are designed to run against built JS for fidelity.
const distEntry = join(root, 'dist', 'index.js');
await readFile(distEntry).catch(() => {
  throw new Error(`${distEntry} not found. Run \`npm run build\` (or \`npm run build:ts\`) first.`);
});
// On Windows, dynamic import() requires a file:// URL, not a raw path.
const { Astrosk, SE } = await import(pathToFileURL(distEntry).href);

const reference = JSON.parse(
  await readFile(join(here, 'reference.json'), 'utf8'),
);

// ----- Test runner -----------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

function approx(actual, expected, tol, label) {
  const diff = Math.abs(actual - expected);
  // Handle wrap-around at 360°
  const wrapDiff = Math.min(diff, Math.abs(diff - 360));
  if (wrapDiff <= tol) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(
      `  FAIL: ${label}\n    expected ${expected}, got ${actual}, diff ${wrapDiff.toExponential(3)}, tol ${tol}`,
    );
  }
}

function dmsToDeg(dms, sign) {
  // Parse "26 Ar 44' 27.31\"" → degrees in 0..360
  const signMap = {
    Ar: 0, Ta: 30, Ge: 60, Cn: 90, Le: 120, Vi: 150,
    Li: 180, Sc: 210, Sg: 240, Cp: 270, Aq: 300, Pi: 330,
  };
  const m = dms.match(/^\s*(\d+)\s+(\w+)\s+(\d+)'\s*([\d.]+)"/);
  if (!m) throw new Error(`bad dms: ${dms}`);
  const [, d, s, mi, sec] = m;
  return signMap[s] + Number(d) + Number(mi) / 60 + Number(sec) / 3600;
}

// ----- Init ------------------------------------------------------------

console.log('Loading WASM module...');
const astrosk = await Astrosk.init();

// Load minimal ephemeris files. They must be available from deps/ephe/.
const ephe = join(root, 'deps', 'ephe');
for (const name of [
  'sepl_18.se1',
  'semo_18.se1',
  'seleapsec.txt',
  'sefstars.txt',
  'seorbel.txt',
]) {
  const bytes = await readFile(join(ephe, name));
  astrosk.loadEphemerisFile(name, new Uint8Array(bytes));
}

console.log(`Swiss Ephemeris version: ${astrosk.version()}`);
console.log('');

// ----- Tropical tests --------------------------------------------------

const flagsTrop = SE.FLG.SWIEPH | SE.FLG.SPEED;
const TROP_TOL = 1e-5; // 36 milliarcsec — very tight

for (const key of [
  'tropical_2024_05_15_12_00_UT',
  'tropical_2025_05_10_02_02_26_UT',
  'tropical_2026_05_10_11_32_26_UT',
]) {
  const ref = reference[key];
  console.log(`Test: ${ref._label}`);
  const jd = astrosk.julday(ref.year, ref.month, ref.day, ref.hour);

  if (ref.jd_ut !== undefined) {
    approx(jd, ref.jd_ut, 1e-6, `  julday(${ref.year}-${ref.month}-${ref.day} ${ref.hour}h)`);
  }
  if (ref.delta_t_sec !== undefined) {
    // swe_deltat returns delta T in DAYS (so it's directly addable to a
    // Julian Day). Convert to seconds for comparison with swetest's display.
    approx(astrosk.deltaT(jd) * 86400, ref.delta_t_sec, 1e-3, `  deltaT (sec)`);
  }

  for (const planet of reference._planets_order) {
    const r = astrosk.calcUt(jd, SE[planet], flagsTrop);
    approx(r.longitude, ref.longitudes[planet], TROP_TOL, `  ${planet} longitude (tropical)`);
    if (ref.latitudes) {
      approx(r.latitude, ref.latitudes[planet], TROP_TOL, `  ${planet} latitude`);
    }
    if (ref.distances_au) {
      approx(r.distance, ref.distances_au[planet], 1e-7, `  ${planet} distance AU`);
    }
  }
  console.log('');
}

// ----- Sidereal True Pushya tests --------------------------------------

// SWIEPH | SIDEREAL | NONUT | TRUEPOS | SPEED — JHora's convention for body-derived
// ayanamsas (True Pushya/Citra/Revati). NONUT+TRUEPOS suppress nutation on the
// precession baseline and stellar aberration on the reference star (δ-Cnc for
// Pushya). Without these flags the result is the apparent (with-nutation, with-
// aberration) ayanamsa, which is off by 2-25 arcsec depending on date and mode.
const flagsSid = SE.FLG.SWIEPH | SE.FLG.SIDEREAL | SE.FLG.NONUT | SE.FLG.TRUEPOS | SE.FLG.SPEED;
const SID_TOL = 1e-4; // 0.36 arcsec
const JHORA_TOL = 5 / 3600;       // 5"  — slow planets match swisseph this tightly
const JHORA_MOON_TOL = 10 / 3600; // 10" — Moon moves ~30"/min; tiny deltaT differences with JHora's older epoch amplify

astrosk.setSidMode(SE.SIDM.TRUE_PUSHYA);
console.log(`Ayanamsa name: ${astrosk.getAyanamsaName(SE.SIDM.TRUE_PUSHYA)}`);
console.log('');

for (const key of [
  'true_pushya_2020_04_21_12_32_26_UT',
  'true_pushya_2025_05_10_02_02_26_UT',
  'true_pushya_2026_05_10_11_32_26_UT',
]) {
  const ref = reference[key];
  console.log(`Test: ${ref._label}`);
  const jd = astrosk.julday(ref.year, ref.month, ref.day, ref.hour);
  // Use the new default (SWIEPH | NONUT | TRUEPOS) — the JHora-compatible
  // mean/geometric ayanamsa. See astrosk.ts:getAyanamsaExUt for rationale.
  const ayan = astrosk.getAyanamsaExUt(jd);
  console.log(`  Ayanamsa: ${ayan.toFixed(7)}° (JHora reference: ${ref.ayanamsa_deg_jhora ?? 'n/a'})`);

  if (ref.ayanamsa_deg !== undefined) {
    approx(ayan, ref.ayanamsa_deg, SID_TOL, `  ayanamsa vs swisseph reference`);
  }
  if (ref.ayanamsa_deg_jhora !== undefined) {
    approx(ayan, ref.ayanamsa_deg_jhora, JHORA_TOL, `  ayanamsa vs JHora display`);
  }

  for (const planet of reference._planets_order) {
    const r = astrosk.calcUt(jd, SE[planet], flagsSid);
    approx(r.longitude, ref.longitudes[planet], SID_TOL, `  ${planet} sidereal longitude (vs swetest)`);

    if (ref.jhora_longitudes_dms && ref.jhora_longitudes_dms[planet]) {
      const expected = dmsToDeg(ref.jhora_longitudes_dms[planet]);
      const tol = planet === 'MOON' ? JHORA_MOON_TOL : JHORA_TOL;
      approx(r.longitude, expected, tol, `  ${planet} sidereal vs JHora display`);
    }
  }
  console.log('');
}

// ----- API surface sanity ----------------------------------------------

console.log('Test: API surface sanity');

// Planet name lookup
const sunName = astrosk.getPlanetName(SE.SUN);
assert(sunName === 'Sun', `  getPlanetName(SUN) === "Sun" (got "${sunName}")`);

// Ayanamsa name
const pushyaName = astrosk.getAyanamsaName(SE.SIDM.TRUE_PUSHYA);
assert(
  pushyaName.includes('Pushya'),
  `  getAyanamsaName(TRUE_PUSHYA) contains "Pushya" (got "${pushyaName}")`,
);

// Houses smoke test
const hjd = astrosk.julday(2026, 5, 10, 11.540555556);
const houses = astrosk.houses(hjd, 42.20278, -71.68611, 'P');
assert(
  Array.isArray(houses.cusps) && houses.cusps.length === 13,
  `  houses returns 13 cusps (0 unused + 12 houses)`,
);
assert(
  houses.ascmc.length === 8 && houses.ascmc[0] >= 0 && houses.ascmc[0] < 360,
  `  ascmc[0] (Asc) is a valid degree`,
);

// degnorm
approx(astrosk.degnorm(370), 10, 1e-9, `  degnorm(370) === 10`);
approx(astrosk.degnorm(-10), 350, 1e-9, `  degnorm(-10) === 350`);

// difdegn (angular distance)
approx(astrosk.difdegn(10, 350), 20, 1e-9, `  difdegn(10, 350) === 20`);

// Round-trip julday/revjul
const rev = astrosk.revjul(hjd);
assert(
  rev.year === 2026 && rev.month === 5 && rev.day === 10,
  `  revjul round-trip year/month/day`,
);
approx(rev.hour, 11.540555556, 1e-6, `  revjul round-trip hour`);

console.log('');

// ----- Cleanup ---------------------------------------------------------

astrosk.close();

// ----- Report ----------------------------------------------------------

console.log('========================================');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('========================================');

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll tests passed. Calculations match swisseph C source within tolerance.');
process.exit(0);
