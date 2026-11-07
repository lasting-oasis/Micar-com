# Circuit centrelines

`data/<id>.json` holds the centreline of a real circuit, taken from OpenStreetMap, for the ten
strip circuits: spa, monza, silverstone, suzuka, nurburgring, monaco, interlagos, cota, laguna,
bathurst. The game builds full-size race circuits from these files; nothing in the game calls
OpenStreetMap.

Each file: `{ id, name, source, licence, fetchedAt, lapM, lenM, widthM, centre: [lat, lon], pts }`.
`pts` is a closed loop (the last point does not repeat the first) of `[x, z]` metres from `centre`
(x east, z south), sampled every 3 m, running in the race direction from the start/finish line.
`lapM` is the published lap length, `lenM` the length of the traced loop (within 3 %).

## Attribution

Map data (c) OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright

## Re-fetching

    node tools/tracks/fetch_osm_tracks.mjs               # all ten
    node tools/tracks/fetch_osm_tracks.mjs monza spa     # some
    node tools/tracks/fetch_osm_tracks.mjs monza --raw=<dir> [--cached]

One Overpass request per circuit, 2 s apart (fallback mirror: overpass.kumi.systems). `--raw`
keeps the raw responses in a directory outside the repo; `--cached` reuses them offline.
The circuit table (lap length, direction, width, centre, start hint, filters) lives at the top of
the script; fix a circuit by editing the table and re-running it, never the output.

## Checking

    node tools/tracks/fetch_osm_tracks.mjs --check

Offline. Prints `ok <id>` per file; exits 1 with the reason on any failure. The vitest suite
`apps/sim/src/world/strip/centrelines.test.ts` checks the same files.
