// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 skota.in

/**
 * JHora ayanamsa spec.
 *
 * Drives astrosk-wasm with the inputs from a Jagannatha Hora chart
 * printout and asserts that the computed ayanamsa matches JHora's
 * displayed value (within 1.5 arcmin — the same tolerance verify.mjs
 * uses for JHora-display comparisons).
 *
 * Run:
 *   node tests/jHora.spec.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const distEntry = join(root, 'dist', 'index.js');
await readFile(distEntry).catch(() => {
  throw new Error(`${distEntry} not found. Run \`npm run build\` first.`);
});
// On Windows, dynamic import() requires a file:// URL, not a raw path.
const { Astrosk, SE } = await import(pathToFileURL(distEntry).href);

// ----- Data ------------------------------------------------------------

const data = {
  Date:         'May 10, 2026',
  Time:         '10:44:22',
  TimeZone:     '4:00:00 (West of GMT)',
  Ayanamsa:     '23-05-25.71',
  AyanamsaCode: 29, // SE_SIDM_TRUE_PUSHYA (PVR Narasimha Rao)
};

// ----- Helpers ---------------------------------------------------------

/** "23-05-25.71" → 23.0904750 */
const toDecimal = (dms) => {
  const [d, m, s] = dms.split('-').map(Number);
  return d + m / 60 + s / 3600;
};

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** "May 10, 2026" → { year, month, day } */
const parseDate = (str) => {
  const m = str.match(/^(\w{3})\w*\s+(\d+),\s*(\d+)$/);
  if (!m) throw new Error(`bad date: ${str}`);
  return { year: +m[3], month: MONTHS[m[1]], day: +m[2] };
};

/** "10:44:22" → 10.7394444 (decimal hours) */
const parseTime = (str) => {
  const [h, mi, s] = str.split(':').map(Number);
  return h + mi / 60 + s / 3600;
};

/** "4:00:00 (West of GMT)" → -4  (west of GMT is negative) */
const parseTzOffset = (str) => {
  const m = str.match(/(\d+):(\d+):(\d+)/);
  if (!m) throw new Error(`bad timezone: ${str}`);
  const hours = +m[1] + +m[2] / 60 + +m[3] / 3600;
  return /west/i.test(str) ? -hours : hours;
};

// ----- Setup -----------------------------------------------------------

const astrosk = await Astrosk.init();

const ephe = join(root, 'deps', 'ephe');
for (const name of ['sepl_18.se1', 'semo_18.se1', 'seleapsec.txt', 'sefstars.txt', 'seorbel.txt']) {
  astrosk.loadEphemerisFile(name, new Uint8Array(await readFile(join(ephe, name))));
}

// ----- Transform -------------------------------------------------------

const { year, month, day } = parseDate(data.Date);
const localHour = parseTime(data.Time);
const tzOffsetHours = parseTzOffset(data.TimeZone);
const utHour = localHour - tzOffsetHours; // UT = local - tz_offset

astrosk.setSidMode(data.AyanamsaCode);
const jd = astrosk.julday(year, month, day, utHour);
// Default flag set is SWIEPH | NONUT | TRUEPOS — the JHora-compatible
// mean/geometric ayanamsa. See astrosk.ts:getAyanamsaExUt for rationale.
const ayanamsaDecimal = astrosk.getAyanamsaExUt(jd);

// ----- Expect ----------------------------------------------------------

const expected = toDecimal(data.Ayanamsa);
// 0.1 arcsec — matches JHora to the precision of its on-screen display.
const tol = 0.1 / 3600;
const diff = Math.abs(ayanamsaDecimal - expected);

console.log(`Date:             ${data.Date} ${data.Time}  (tz ${tzOffsetHours}h, UT ${utHour.toFixed(7)}h)`);
console.log(`Ayanamsa code:    ${data.AyanamsaCode} (${astrosk.getAyanamsaName(data.AyanamsaCode)})`);
console.log(`Expected:         ${expected.toFixed(7)}°  (JHora: ${data.Ayanamsa})`);
console.log(`Computed:         ${ayanamsaDecimal.toFixed(7)}°`);
console.log(`Diff:             ${diff.toExponential(3)}°  (tol ${tol.toFixed(7)})`);

astrosk.close();

if (diff > tol) {
  console.error('\nFAIL: ayanamsa does not match JHora display within tolerance.');
  process.exit(1);
}
console.log('\nPASS');
