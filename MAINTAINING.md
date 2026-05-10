# Maintaining astrosk-wasm

This document is the canonical guide for keeping astrosk-wasm in sync
with upstream Swiss Ephemeris. Both humans and AI coding agents
(Claude, Copilot, Cursor) should follow these steps verbatim.

## What this library is

A 1:1 WebAssembly port of the C library at
<https://github.com/aloistr/swisseph> (upstream "swisseph"). We do not
fork or modify the algorithms — all calculation code in `deps/swisseph/`
is an unmodified copy of the upstream sources. The TypeScript layer in
`src/` is a thin marshalling wrapper that allocates pointers and reads
typed-array values from the WASM linear memory.

## The "source of truth" rule

**Calculation correctness has two reference sources, used in different
test sections:**

- **Tropical** values must match native `swetest` built from the same
  upstream commit. This is the strict "did the WASM compile faithfully"
  check.
- **Sidereal True Pushya** ayanamsa + planet longitudes are checked
  against **Jagannatha Hora chart printouts**, not swetest. Why: JHora
  is what real consumers compare against, and the swetest default flag
  set returns the *apparent* ayanamsa (with nutation + aberration on the
  reference star), which differs from JHora by 2-25 arcsec depending on
  date and mode. The conventional Vedic value — and what astrosk-wasm
  defaults to — is the *mean / geometric* ayanamsa via flag
  `SWIEPH | NONUT | TRUEPOS`. See `tests/verify.mjs` `flagsSid` and the
  default of `getAyanamsaExUt` in `src/astrosk.ts`.

If a verification test fails, the bug is in the WASM build configuration
or the JS wrapper, never in the C code.

## Repository layout

```
astrosk-wasm/
├── deps/
│   ├── swisseph/         # vendored upstream C source files (.c, .h)
│   └── ephe/             # bundled ephemeris files (.se1, .txt)
├── scripts/
│   └── build.sh          # Emscripten compile script
├── src/                  # TypeScript wrapper
│   ├── astrosk.ts
│   ├── constants.ts
│   ├── loader.ts
│   ├── types.ts
│   └── index.ts
├── tests/
│   ├── verify.mjs        # main test runner (regression sweep)
│   ├── jHora.spec.mjs    # single-date JHora cross-check
│   ├── reference.json    # fixtures: tropical from swetest, sidereal from JHora
│   └── README.md         # how to run + how to add a new date case
├── wasm/                 # build output (gitignored)
└── examples/
```

## Vendored files

The 9 `.c` source files and 10 `.h` headers compiled into the WASM
binary, copied verbatim from upstream `swisseph/`:

C sources (must match upstream `SWEOBJ` list in `Makefile`):
```
swedate.c  swehouse.c  swejpl.c  swemmoon.c  swemplan.c
sweph.c    swephlib.c  swecl.c   swehel.c
```

Headers needed for compilation:
```
swedate.h  swedll.h    swehouse.h  swejpl.h    sweodef.h
sweph.h    swephexp.h  swephlib.h  swemptab.h  swenut2000a.h
```

If upstream adds or renames a `.c` file in their `SWEOBJ` makefile
target, the same change MUST be reflected in:
1. The list above.
2. The list in `scripts/build.sh` under `SOURCES=(...)`.

## Sync procedure (when upstream releases updates)

Run this when a new Swiss Ephemeris version (e.g. 2.10.04 → 2.11.0)
is released. The whole process is reproducible and idempotent.

### 1. Get the new upstream

```bash
# Either clone fresh
git clone https://github.com/aloistr/swisseph /tmp/upstream-swisseph

# Or update existing
cd /home/user/swisseph
git fetch origin
git checkout master
git pull
```

### 2. Read upstream changelog

Check upstream `readme.md`, release notes, and `git log` for:
- New public functions in `swephexp.h` (search for `EXP32 ... swe_*`).
- Removed or renamed functions.
- Changes to `SWEOBJ` in `Makefile`.
- New constants in `swephexp.h` (search for `#define SE_`).

### 3. Copy vendored sources

```bash
# From inside astrosk-wasm/
UPSTREAM=/path/to/swisseph

# C sources
cp $UPSTREAM/swedate.c   deps/swisseph/
cp $UPSTREAM/swehouse.c  deps/swisseph/
cp $UPSTREAM/swejpl.c    deps/swisseph/
cp $UPSTREAM/swemmoon.c  deps/swisseph/
cp $UPSTREAM/swemplan.c  deps/swisseph/
cp $UPSTREAM/sweph.c     deps/swisseph/
cp $UPSTREAM/swephlib.c  deps/swisseph/
cp $UPSTREAM/swecl.c     deps/swisseph/
cp $UPSTREAM/swehel.c    deps/swisseph/

# Headers
cp $UPSTREAM/swedate.h      deps/swisseph/
cp $UPSTREAM/swedll.h       deps/swisseph/
cp $UPSTREAM/swehouse.h     deps/swisseph/
cp $UPSTREAM/swejpl.h       deps/swisseph/
cp $UPSTREAM/sweodef.h      deps/swisseph/
cp $UPSTREAM/sweph.h        deps/swisseph/
cp $UPSTREAM/swephexp.h     deps/swisseph/
cp $UPSTREAM/swephlib.h     deps/swisseph/
cp $UPSTREAM/swemptab.h     deps/swisseph/
cp $UPSTREAM/swenut2000a.h  deps/swisseph/
```

If `Makefile` `SWEOBJ` adds a new `.c`, add it both to the cp list above
**and** to `scripts/build.sh` `SOURCES=()`.

### 4. Update bundled ephemeris (optional)

Astrodienst occasionally publishes new asteroid lists. The default
shipped files (`sepl_18.se1`, `semo_18.se1`) cover years 1800-2400 and
do not change between releases. Only update if upstream `ephe/` files
in our subset have a newer timestamp.

### 5. Update exported functions list

If upstream added new `swe_*` public functions you want to expose:

1. Grep upstream for new names: `grep -E '^(int32 |double |void |int )?\s*EXP32?\s+swe_\w+' $UPSTREAM/*.h`.
2. Add `_swe_xxx` to `EXPORTS` in `scripts/build.sh`.
3. Add a typed wrapper method on the `Astrosk` class in `src/astrosk.ts`.
4. Add corresponding constants to `src/constants.ts` if any new `SE_*` constants were defined.

### 6. Capture new reference values from upstream

The fixture file is `tests/reference.json`. Tropical numbers come from
`swetest`; sidereal True Pushya numbers come from JHora chart printouts
(captured by inspection, not by tool).

```bash
cd $UPSTREAM
make swetest

# Tropical positions
./swetest -b15.5.2024 -ut12:00:00 -p0123456789 -fPlbrs -g, \
  -eswe -edirephe/ -head > /tmp/ref-tropical.csv
```

Update the `tropical_*` fixtures in `tests/reference.json` with any
values that drifted (should be 0 difference for any one date — Swiss
Ephemeris is stable).

**Do NOT regenerate the `true_pushya_*` `ayanamsa_deg` values from
swetest with its default flag.** Swetest's default returns the apparent
ayanamsa, which is what older versions of this fixture had — and it's
off by 2-25 arcsec vs JHora. The current values were captured from
astrosk-wasm itself using the library default flag
(`SWIEPH | NONUT | TRUEPOS`), which agrees with both native `sweph`
(Node binding) and JHora to ~10 mas.

If you need to recapture the True Pushya fixtures (e.g. after upstream
changes the deCnc proper-motion epoch), do it from the wasm:

```js
import { Astrosk, SE } from 'astrosk-wasm';
const astrosk = await Astrosk.init();
// ...load ephe files...
astrosk.setSidMode(SE.SIDM.TRUE_PUSHYA);
const jd = astrosk.julday(2026, 5, 10, 11.540555556);
const ayan = astrosk.getAyanamsaExUt(jd); // uses default SWIEPH|NONUT|TRUEPOS
const flagsSid = SE.FLG.SWIEPH | SE.FLG.SIDEREAL | SE.FLG.NONUT
               | SE.FLG.TRUEPOS | SE.FLG.SPEED;
const sun = astrosk.calcUt(jd, SE.SUN, flagsSid);
```

If `ayan` shifts more than ~10 mas after an upstream sync, upstream
changed the deCnc catalog entry or proper-motion epoch — investigate
before updating the fixture.

### 7. Build and test

```bash
source /opt/emsdk/emsdk_env.sh
npm run build
npm test
```

Expected output: every assertion in `tests/verify.mjs` passes within
the documented tolerance (1e-6° = 3.6 mas for tropical longitudes).

If a test fails after a sync, the diagnostic order is:

1. **Did upstream change a default?** Check the changelog for ayanamsa
   table updates, asteroid name changes, etc.
2. **Did the WASM build silently drop a symbol?** Check `wasm/astrosk.js`
   contains the function: `grep '_swe_calc_ut' wasm/astrosk.js`.
3. **Is the reference value wrong?** Re-run native `swetest` with the
   same inputs and compare.

### 8. Bump version

In `package.json`, update `version` following semver:
- Patch: pure upstream sync, no API change.
- Minor: new wrapper method or new exposed swe_* function.
- Major: breaking change to the TypeScript API.

Note the upstream version in the commit message:
```
chore(sync): swisseph 2.11.0
```

## Known traps

### Memory access pattern

`HEAPF64[ptr]` indexes by **8-byte elements**, not bytes. Always convert
byte pointers (returned by `_malloc`) using unsigned right-shift:

```ts
const idx = ptr >>> 3;            // double — RIGHT
const idx = ptr / 8;              // double — works but is float math
const idx = ptr >> 3;             // double — WRONG for ptr ≥ 2^31

const idx = ptr >>> 2;            // int32 — RIGHT
```

Using `/8` happens to work because `_malloc` returns 8-byte aligned
pointers, but it triggers de-optimization in V8 and JSC. Prefer `>>>`.

### Thread-local storage

`sweodef.h` defines TLS macros (`__thread` on Linux). Emscripten
supports these but only when `-pthread` is enabled, which adds size and
complexity. We compile **without** `-pthread`; the conditional in
`sweodef.h` falls through to non-TLS, which is correct because WASM
modules are single-threaded by default.

If a future upstream change requires real TLS, also add
`-pthread -s USE_PTHREADS=1` to `scripts/build.sh` and ensure the host
supports SharedArrayBuffer.

### Ephemeris path

`swe_set_ephe_path()` accepts a colon-separated list. Inside the WASM
virtual FS we use a single path (`/ephe`). If the user calls
`setEphePath()` with a path that doesn't exist, calls fall back to the
Moshier built-in model — silent degradation, **not** an error. Always
verify ephemeris files were written before relying on `SE.FLG.SWIEPH`.

### File size

The compiled WASM binary should be ~535 KB at `-O3`. If it grows much
beyond that:
- Check `EXPORTED_FUNCTIONS` for a runaway export list.
- Check upstream didn't add a large new `.c` file you don't actually
  need — the `SWEOBJ` list is the canonical "what's required".

## Quick reference for AI agents

If asked to "sync astrosk-wasm to latest swisseph":

1. Find the upstream repo (clone or update).
2. Read this entire file first.
3. Execute steps 3, 5, 7 above.
4. If tests pass, propose a commit. If they fail, diagnose with the
   order in step 7.
5. **Do not** modify `deps/swisseph/*.c` or `deps/swisseph/*.h` — these
   are vendored verbatim from upstream. Modifying them silently
   produces wrong values.
6. **Do not** change memory access pattern from `>>> 3` to `/ 8` —
   doing so reverts a known-bad pattern.
