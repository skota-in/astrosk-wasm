// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 skota.in

/**
 * jhora.spec.ts — validate astrosk-wasm against Jagannatha Hora chart
 * printouts in examples/chart{1..8}.txt.
 *
 * Charts 1–4 use True Chitra (Lahari/Chitra), charts 5–8 use True Pushya.
 *
 * Run (Node 22.6+ has built-in TS stripping):
 *   node --experimental-strip-types tests/jhora.spec.ts
 *
 * Requires `npm run build` to have produced dist/ and wasm/.
 *
 * Goal: confirm the wrapper is called correctly (flags, sidereal mode,
 * UT conversion) so values land within JHora's display tolerance. If they
 * don't, adjust how we call the API here — do not change library code.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distEntry = pathToFileURL(join(root, 'dist', 'index.js')).href;
const { Astrosk, SE } = await import(distEntry);

// ---- helpers ----------------------------------------------------------

const SIGNS: Record<string, number> = {
  Ar: 0, Ta: 30, Ge: 60, Cn: 90, Le: 120, Vi: 150,
  Li: 180, Sc: 210, Sg: 240, Cp: 270, Aq: 300, Pi: 330,
};

/** Parse "23-59-09.19" (D-M-S) into decimal degrees. */
function dmsToDeg(s: string): number {
  const m = s.trim().match(/^(-?\d+)-(\d+)-([\d.]+)$/);
  if (!m) throw new Error(`bad DMS: ${s}`);
  const sign = m[1].startsWith('-') ? -1 : 1;
  const d = Math.abs(parseInt(m[1], 10));
  return sign * (d + parseInt(m[2], 10) / 60 + parseFloat(m[3]) / 3600);
}

/** Parse "9 Cn 53' 37.52\"" → decimal degrees of 360° zodiac. */
function jhoraLonToDeg(s: string): number {
  const m = s.trim().match(/^(\d+)\s+([A-Z][a-z])\s+(\d+)'\s*([\d.]+)"?$/);
  if (!m) throw new Error(`bad JHora longitude: ${s}`);
  const deg = parseInt(m[1], 10);
  const sign = SIGNS[m[2]];
  if (sign === undefined) throw new Error(`unknown sign: ${m[2]}`);
  const min = parseInt(m[3], 10);
  const sec = parseFloat(m[4]);
  return sign + deg + min / 60 + sec / 3600;
}

interface Chart {
  file: string;
  ayanamsaName: string;
  sidMode: number;
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  tzHours: number; // east-of-GMT positive (JHora prints East/West label)
  ayanamsaDeg: number;
  longitudes: Record<string, number>;
}

// Bodies present in JHora printout and their SE numbers. JHora's "Rahu" is
// the mean lunar node by default. Ketu is 180° opposite — we recompute it.
const BODY_SE: Record<string, number> = {
  Sun: SE.SUN,
  Moon: SE.MOON,
  Mars: SE.MARS,
  Mercury: SE.MERCURY,
  Jupiter: SE.JUPITER,
  Venus: SE.VENUS,
  Saturn: SE.SATURN,
  Rahu: SE.MEAN_NODE,
};

async function parseChart(path: string): Promise<Chart> {
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);

  let ayanamsaName = '';
  for (const line of lines) {
    const m = line.match(/^Ayanamsa:\s+(.+)$/);
    if (m && !/^\d/.test(m[1])) { ayanamsaName = m[1].trim(); break; }
  }
  // chart files with "Natal Chart" at top but no leading Ayanamsa header
  // get the name from "Ayanamsa:      XX-XX-XX.XX" line below; for those
  // we'll infer mode from the filename grouping (1-4 Chitra, 5-8 Pushya).
  const fileNum = parseInt(path.match(/chart(\d+)\.txt$/)?.[1] ?? '0', 10);
  let sidMode: number;
  if (ayanamsaName.includes('Chitra') || ayanamsaName.includes('Lahari')) {
    sidMode = SE.SIDM.TRUE_CITRA;
  } else if (ayanamsaName.includes('Pushya')) {
    sidMode = SE.SIDM.TRUE_PUSHYA;
  } else if (fileNum >= 1 && fileNum <= 4) {
    sidMode = SE.SIDM.TRUE_CITRA;
    ayanamsaName = 'True Chitra (inferred)';
  } else if (fileNum >= 5 && fileNum <= 8) {
    sidMode = SE.SIDM.TRUE_PUSHYA;
    ayanamsaName = 'True Pushya (inferred)';
  } else {
    throw new Error(`cannot determine sidereal mode for ${path}`);
  }

  const dateM = text.match(/^Date:\s+(\w+)\s+(\d+),\s+(\d+)/m)!;
  const timeM = text.match(/^Time:\s+(\d+):(\d+):(\d+)/m)!;
  const tzM = text.match(/^Time Zone:\s+(\d+):(\d+):(\d+)\s+\(([^)]+)\)/m)!;
  const ayanM = text.match(/^Ayanamsa:\s+([-\d.]+)\s*$/m)!;

  const months: Record<string, number> = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
  };
  const month = months[dateM[1]];
  const day = parseInt(dateM[2], 10);
  const year = parseInt(dateM[3], 10);
  const hour = parseInt(timeM[1], 10);
  const minute = parseInt(timeM[2], 10);
  const second = parseInt(timeM[3], 10);
  const tzH = parseInt(tzM[1], 10) + parseInt(tzM[2], 10) / 60 + parseInt(tzM[3], 10) / 3600;
  const tzSign = /East/.test(tzM[4]) ? 1 : -1;
  const tzHours = tzSign * tzH;
  const ayanamsaDeg = dmsToDeg(ayanM[1]);

  // Parse planet longitudes from the body table. Each line looks like:
  //   "Sun - AK                25 Ar 51' 15.82" Bhar      4    Ar   Sc"
  const longitudes: Record<string, number> = {};
  const TRACKED = new Set([...Object.keys(BODY_SE), 'Ketu']);
  for (const line of lines) {
    const bodyM = line.match(/^([A-Z][a-z]+)(?:\s*\(R\))?(?:\s+-\s+\w+)?\s+(\d+\s+[A-Z][a-z]\s+\d+'\s*[\d.]+")/);
    if (bodyM && TRACKED.has(bodyM[1]) && longitudes[bodyM[1]] === undefined) {
      longitudes[bodyM[1]] = jhoraLonToDeg(bodyM[2]);
    }
  }

  return {
    file: path,
    ayanamsaName, sidMode,
    year, month, day, hour, minute, second,
    tzHours, ayanamsaDeg, longitudes,
  };
}

// ---- runner -----------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

// Tolerance: JHora rounds to 0.01 arcsec on display and uses slightly older
// deltaT tables. 5 arcsec = 5/3600 = 0.001389° catches real bugs without
// flagging cosmetic drift.
const AYAN_TOL_DEG = 5 / 3600;
const PLANET_TOL_DEG = 5 / 3600;
// Moon moves ~30 arcsec per minute; deltaT/leap-second slop between JHora
// and current swisseph can shift it by ~10 arcsec.
const MOON_TOL_DEG = 15 / 3600;

function approx(actual: number, expected: number, tol: number, label: string) {
  let diff = Math.abs(actual - expected);
  if (diff > 180) diff = 360 - diff; // wrap
  const ok = diff <= tol;
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}  Δ=${(diff * 3600).toFixed(2)}"`);
  } else {
    failed++;
    failures.push(`${label}: got ${actual.toFixed(7)}, expected ${expected.toFixed(7)}, Δ=${(diff * 3600).toFixed(2)}" > ${(tol * 3600).toFixed(2)}"`);
    console.log(`  ✗ ${label}  Δ=${(diff * 3600).toFixed(2)}" (> ${(tol * 3600).toFixed(2)}")`);
  }
}

const astrosk = await Astrosk.init();

const epheFiles = ['sepl_18.se1', 'semo_18.se1', 'seas_18.se1', 'seleapsec.txt'];
for (const name of epheFiles) {
  try {
    const bytes = await readFile(join(root, 'deps', 'ephe', name));
    astrosk.loadEphemerisFile(name, new Uint8Array(bytes));
  } catch {
    // optional — seas_18 not bundled, swisseph will fall back
  }
}

const charts: Chart[] = [];
for (let i = 1; i <= 8; i++) {
  charts.push(await parseChart(join(root, 'examples', `chart${i}.txt`)));
}

for (const c of charts) {
  console.log(`\n=== ${c.file.split(/[\\/]/).pop()} — ${c.ayanamsaName} ===`);
  console.log(`    ${c.year}-${c.month}-${c.day} ${c.hour}:${c.minute}:${c.second} local, TZ=${c.tzHours >= 0 ? '+' : ''}${c.tzHours}h`);

  // Convert local → UT. JHora gives local civil time; UT = local - tzHours (east positive).
  const localHour = c.hour + c.minute / 60 + c.second / 3600;
  const utHour = localHour - c.tzHours;
  let y = c.year, mo = c.month, d = c.day, h = utHour;
  if (h < 0) { h += 24; d -= 1; }
  if (h >= 24) { h -= 24; d += 1; }
  const jdUt = astrosk.julday(y, mo, d, h, SE.GREG_CAL);

  astrosk.setSidMode(c.sidMode);

  // JHora reports the *mean / geometric* ayanamsa and positions: no
  // nutation, no aberration / light-time. To reproduce them, pass
  // SWIEPH | NONUT | TRUEPOS. Plain SWIEPH gives apparent values that
  // disagree with JHora's display by ~20-40 arcsec.
  const jhoraFlags = SE.FLG.SWIEPH | SE.FLG.NONUT | SE.FLG.TRUEPOS;

  const ayan = astrosk.getAyanamsaExUt(jdUt, jhoraFlags);
  approx(ayan, c.ayanamsaDeg, AYAN_TOL_DEG, `ayanamsa (JHora ${c.ayanamsaDeg.toFixed(7)}°)`);

  // Planet positions: sidereal mode + same JHora-matching flags + SPEED.
  const flagsSid = jhoraFlags | SE.FLG.SIDEREAL | SE.FLG.SPEED;
  for (const [name, body] of Object.entries(BODY_SE)) {
    const expected = c.longitudes[name];
    if (expected === undefined) continue;
    const r = astrosk.calcUt(jdUt, body, flagsSid);
    const tol = name === 'Moon' ? MOON_TOL_DEG : PLANET_TOL_DEG;
    approx(r.longitude, expected, tol, `${name} sidereal`);
  }

  // Ketu = Rahu + 180°.
  if (c.longitudes['Ketu'] !== undefined) {
    const rahu = astrosk.calcUt(jdUt, SE.MEAN_NODE, flagsSid);
    let ketu = rahu.longitude + 180;
    if (ketu >= 360) ketu -= 360;
    approx(ketu, c.longitudes['Ketu'], PLANET_TOL_DEG, 'Ketu sidereal (Rahu + 180°)');
  }
}

astrosk.close?.();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
