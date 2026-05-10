// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 skota.in

/**
 * JHora examples spec.
 *
 * Auto-discovers every chart printout in examples/ and validates the
 * ayanamsa against astrosk-wasm:
 *
 *   examples/jHora-PVR-*.txt    → True Pushya (PVR), code 29
 *   examples/jHora-CITRA-*.txt  → True Citra, code 27
 *
 * Each file is parsed for:  Date, Time, Time Zone, Ayanamsa  (see the
 * top of every example for the exact format).
 *
 * Run:
 *   node tests/jHora-examples.spec.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const distEntry = join(root, 'dist', 'index.js');
await readFile(distEntry).catch(() => {
  throw new Error(`${distEntry} not found. Run \`npm run build\` first.`);
});
const { Astrosk, SE } = await import(pathToFileURL(distEntry).href);

// ----- Parsers --------------------------------------------------------

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const dmsToDeg = (dms) => {
  const [d, m, s] = dms.split('-').map(Number);
  return d + m / 60 + s / 3600;
};

const parseChartFile = (text) => {
  // "Date:          May 10, 2026"
  const date = text.match(/^Date:\s+(\w{3})\w*\s+(\d+),\s*(\d+)/m);
  // "Time:          10:44:22"
  const time = text.match(/^Time:\s+(\d+):(\d+):(\d+)/m);
  // "Time Zone:     4:00:00 (West of GMT)"   or   "5:30:00 (East of GMT)"
  const tz = text.match(/^Time Zone:\s+(\d+):(\d+):(\d+)\s+\((West|East)\s+of\s+GMT\)/im);
  // "Ayanamsa:      23-05-25.71"
  const ayan = text.match(/^Ayanamsa:\s+([\d.-]+)/m);

  if (!date || !time || !tz || !ayan) {
    throw new Error('Could not parse one of: Date / Time / Time Zone / Ayanamsa');
  }

  const tzHours = +tz[1] + +tz[2] / 60 + +tz[3] / 3600;
  const tzSigned = tz[4].toLowerCase() === 'west' ? -tzHours : tzHours;

  return {
    year: +date[3],
    month: MONTHS[date[1]],
    day: +date[2],
    localHour: +time[1] + +time[2] / 60 + +time[3] / 3600,
    tzOffsetHours: tzSigned,
    ayanamsaDms: ayan[1],
    ayanamsaDeg: dmsToDeg(ayan[1]),
  };
};

// ----- Discover examples ---------------------------------------------

const exDir = join(root, 'examples');
const files = (await readdir(exDir))
  .filter((f) => /^jHora-(PVR|CITRA)-.+\.txt$/i.test(f))
  .sort();

if (files.length === 0) {
  throw new Error(`No jHora-PVR-*.txt / jHora-CITRA-*.txt files in ${exDir}`);
}

// ----- Set up wasm ---------------------------------------------------

const astrosk = await Astrosk.init();
const ephe = join(root, 'deps', 'ephe');
for (const name of ['sepl_18.se1', 'semo_18.se1', 'seleapsec.txt', 'sefstars.txt', 'seorbel.txt']) {
  astrosk.loadEphemerisFile(name, new Uint8Array(await readFile(join(ephe, name))));
}

// ----- Run ------------------------------------------------------------

const TOL_ARCSEC = 0.1;
const tol = TOL_ARCSEC / 3600;

let passed = 0;
let failed = 0;
const rows = [];

for (const file of files) {
  const text = await readFile(join(exDir, file), 'utf8');
  const data = parseChartFile(text);

  const isPVR = /jHora-PVR-/i.test(file);
  const mode = isPVR ? SE.SIDM.TRUE_PUSHYA : SE.SIDM.TRUE_CITRA;
  const modeName = isPVR ? 'True Pushya' : 'True Citra';

  astrosk.setSidMode(mode);
  const utHour = data.localHour - data.tzOffsetHours;
  const jd = astrosk.julday(data.year, data.month, data.day, utHour);
  const computed = astrosk.getAyanamsaExUt(jd); // default flags

  const diffArcsec = Math.abs(computed - data.ayanamsaDeg) * 3600;
  const ok = diffArcsec <= TOL_ARCSEC;
  if (ok) passed++; else failed++;

  rows.push({
    file: basename(file),
    mode: modeName,
    date: `${data.year}-${String(data.month).padStart(2, '0')}-${String(data.day).padStart(2, '0')}`,
    tz: data.tzOffsetHours,
    expected: data.ayanamsaDms,
    computed: computed.toFixed(7),
    diff_arcsec: diffArcsec.toFixed(4),
    status: ok ? 'PASS' : 'FAIL',
  });
}

astrosk.close();

console.table(rows);
console.log('');
console.log(`${passed} passed, ${failed} failed   (tolerance ${TOL_ARCSEC}")`);

if (failed > 0) {
  process.exit(1);
}
