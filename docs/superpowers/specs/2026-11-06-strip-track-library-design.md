# The Strip as a track library: ten world circuits to scale — design

Supersedes `2026-11-06-strip-race-park-design.md` (the single race park), after the user asked for "the top 10 tracks in the world", to scale, as a library.

The Strip is today a procedural 8×8 night grid city whose streets are the tracks. This phase replaces it with a **daytime hub** and a **library of ten full-size circuits** traced from OpenStreetMap, each loaded on demand: Spa-Francorchamps, Monza, Silverstone, Suzuka, the Nürburgring GP circuit, Monaco, Interlagos, Circuit of the Americas, Laguna Seca and Mount Panorama (Bathurst). The race types, the career stages, the rental lot, the gate, the outruns, server-paid prizes and stamps stay; the eleven grid events are replaced by about nineteen events spread over the ten circuits.

## What the player sees

1. Through the Speedway gate (or `/strip`) the player arrives at the **hub**: a sunlit paddock with the rental lot and kiosk, the exit gate ring back to town, pit garages, and a **boulevard of ten portals**, each a ring on the tarmac under a sign with the circuit's park name and its country's flag colours. A **loop road** (about 1.2 km) runs round the paddock; traffic and the three rivals wander it, so outruns, near misses and rival tags work as today. The world map (M) shows the hub's roads, the portals and, when you are on a circuit, that circuit.
2. **Drive into a portal and press Enter**: the car is placed on that circuit's **pit straight** facing the direction of travel (the "track lobby"), the circuit's scenery already there or arriving within a couple of seconds (the roads are drawn from the data at once). Along the pit straight stand the circuit's **event markers** (one to three: circuit race, and where it suits, sprint, drift, street X or drag) and a **return portal** back to the hub. Enter at a marker starts the event as today: countdown, checkpoints, laps, results, the server pays.
3. **Circuits are full size and flat.** Spa is 7.0 km, Monaco 3.3 km; hills and banking are flattened (the driving model has no height). Suzuka's crossover is a flat crossing. Corner shapes, straights and widths follow the mapped centreline. Kerbs mark the bends, white lines the edges, barriers line both sides with gaps where the track crosses or folds back on itself, gravel outside the corners, a grandstand and a pit building on the pit straight, trees around.
4. **Names are the park's own**: Ardennes (Spa), Royal Park (Monza), Airfield (Silverstone), Figure Eight (Suzuka), Eifel (Nürburgring GP), Harbour (Monaco), Lagoons (Interlagos), Lone Star (COTA), Dry Lagoon (Laguna Seca), The Mountain (Bathurst). Real circuit names and logos are not used in the game; the OpenStreetMap attribution is.
5. **Phones**: the hub is one small download; each circuit is its own glb (under 800 kB) plus a data file (under 200 kB), fetched when its portal is entered and kept for the session.

## Decisions

1. **Centrelines come from OpenStreetMap** (`highway=raceway` ways, or named streets for Monaco), fetched once by a committed script into committed data files, projected to local metres around each circuit's centre, assembled into one loop and checked against the published lap length (±3 %). The repo carries the derived centrelines; the game never calls OSM. Attribution "Map data © OpenStreetMap contributors (ODbL)" goes in the Strip's entry card and the site footer's credits line, in English and Spanish.
2. **Blender is still the source of the scenery and the data exports.** The build script lays each circuit out from its centreline file (tarmac, kerbs, lines, walls, gravel, grandstand, pit building, trees) and the hub from a layout table, in one `.blend`; the exporter writes a glb per circuit, a glb for the hub, a JSON per circuit and a JSON for the hub. Everything derived is committed. A circuit's visual meshes are built in Blender from the same sampled centreline the exporter writes, so they agree by construction.
3. **One scene, offsets per circuit.** The hub sits at the origin; circuit k (1–10) is placed at offset `(8000 · ((k−1) mod 4), 8000 · floor((k−1) / 4))` metres (a 4×3 grid, every circuit within ±4 km of its cell centre, nothing beyond about 28 km from the origin). Physics coordinates include the offset; nothing in the game needs a per-zone frame, other players' tags keep working, and `district: 'strip'` is unchanged. The glb of a circuit is authored around its own origin and placed at the offset by the loader.
4. **Lazy per-circuit assets.** The hub's data is imported statically (small). A circuit's JSON and glb are fetched when its portal is entered; the server reads every circuit JSON from `apps/sim/public/strip/tracks/` at startup for `eventDistance` and the finish floor. Nothing is shipped in the main chunk beyond the hub.
5. **Flat.** No elevation, no banking; the driving model is not touched.
6. **Collision is wall polylines** on both sides of every circuit at `width/2 + 4` m, with gaps wherever that offset would land within `width/2 + 2` m of another, non-adjacent part of the same centreline (Suzuka's crossing, Monaco's hairpin, chicanes), plus the hub's fences and the outer fence of every circuit's cell. The same two-circle car collision as today.
7. **Checkpoints every 400–600 m** along a route (the exporter places them at equal spacing so that the gap is nearest 500 m; the start is checkpoint 0; a non-loop route's last checkpoint is its end). Partial routes (a sprint, a drift or drag sector) are `s`-ranges of the circuit's loop, named in the layout and cut by the exporter.
8. **Events** (ids new; the eleven grid ids and their saved records are dropped — a `freshStrip()` migration clears `wins`/`best` keys that no longer exist). Names are the park names plus the type; prizes scale roughly with distance.

| id | type | circuit | route | laps | stage | prize $ | rep |
|---|---|---|---|---|---|---|---|
| harbour_gp | circuit | Monaco | full loop | 2 | 1 | 1,500 | 150 |
| lagoons_sprint | sprint | Interlagos | one lap, start to start | – | 1 | 1,400 | 140 |
| harbour_drift | drift | Monaco | sector from the harbour chicane to the pool section (about 900 m) | – | 1 | 1,500 | 150 |
| royal_drag | drag | Monza | 402 m of the main straight | – | 1 | 1,800 | 150 |
| drylagoon_x | streetx | Laguna Seca | full loop | 2 | 1 | 1,300 | 130 |
| royal_gp | circuit | Monza | full loop | 2 | 2 | 2,200 | 220 |
| lagoons_gp | circuit | Interlagos | full loop | 3 | 2 | 2,400 | 240 |
| airfield_sprint | sprint | Silverstone | one lap | – | 2 | 2,200 | 220 |
| figure8_drift | drift | Suzuka | the esses sector (about 1,200 m) | – | 2 | 2,400 | 220 |
| mountain_drag | drag | Bathurst | 805 m of the long straight (Conrod) | – | 2 | 2,800 | 220 |
| figure8_gp | circuit | Suzuka | full loop | 2 | 3 | 3,000 | 300 |
| eifel_gp | circuit | Nürburgring GP | full loop | 2 | 3 | 2,800 | 280 |
| harbour_x | streetx | Monaco | full loop | 3 | 3 | 2,600 | 220 |
| mountain_sprint | sprint | Bathurst | one lap | – | 3 | 3,200 | 320 |
| lonestar_gp | circuit | COTA | full loop | 2 | 4 | 3,600 | 360 |
| airfield_gp | circuit | Silverstone | full loop | 2 | 4 | 3,600 | 360 |
| mountain_drift | drift | Bathurst | the descent sector (about 1,500 m) | – | 4 | 3,400 | 300 |
| ardennes_gp | circuit | Spa | full loop | 2 | 5 | 5,000 | 500 |
| mountain_gp | circuit | Bathurst | full loop | 2 | 5 | 4,500 | 450 |
| ardennes_sprint | sprint | Spa | one lap | – | 5 | 4,200 | 420 |

`noTraffic` is true for every event (circuits have no wandering traffic; the hub's traffic never leaves the hub). `prizeFor`, stages and the stamps are unchanged.

9. **The hub replaces free roam.** Rivals, traffic, outruns, the GPS and the map work in the hub (roads from its data). On a circuit there is no traffic and no GPS; the map shows the circuit and the player.
10. **Daytime** everywhere: sky, sun (no shadow map), hemisphere fill, haze. The town stays as it is.

## Data pipeline

### 1. Centrelines from OpenStreetMap (`tools/tracks/`)

`tools/tracks/fetch_osm_tracks.mjs` (Node 22, no dependencies) with a table `TRACKS`: `{ id, osm: { centre: [lat, lon], radius: m, filter: Overpass QL way filter, exclude: RegExp on name/tags }, lapM: published lap length, startHint: [lat, lon] of the start/finish line, direction: 'cw' | 'ccw' }` for the ten. For each: query `way[filter](around:radius,lat,lon); out geom;`, drop ways matching `exclude` (pit lanes, karting, `historic`, `note=draft`, `access=private`, service roads), build the node graph, walk the one-way ways into one closed loop (at a fork, take the branch that closes the loop with a length nearest `lapM`), project to metres with an equirectangular projection about `centre` (x east, z south, matching the game), rotate nothing, resample at 3 m, rotate the loop so it starts at the point nearest `startHint` and runs in `direction`, and write `tools/tracks/data/<id>.json`: `{ id, source: 'OpenStreetMap', fetchedAt, lapM, lenM, pts: [x, z][] }`. Fails loudly when `|lenM − lapM| > 3 %` or no closed loop is found. The raw Overpass responses are kept out of the repo (a scratch directory). Monaco's filter is the named streets of the circuit (Boulevard Albert 1er, Avenue d'Ostende, Avenue de Monte-Carlo, Avenue des Spélugues, Boulevard Louis II, Avenue J.F. Kennedy, Avenue de la Quarantaine…), listed in the table. Bathurst's is `highway=raceway` or the named roads (Mountain Straight, Conrod Straight, Pit Straight) if the raceway tag is missing.

Width per circuit is a constant in the table (12 m, Monaco 10 m, Monza 12 m, Spa 12 m, Bathurst 11 m), since OSM widths are patchy.

### 2. The Blender file (`apps/sim/assets/strip/district.blend`)

Built by `tools/blender/build_strip.py` from `tools/tracks/data/*.json` and its own `HUB` layout; metres, Z up; the game's `x = bx, z = −by`. Collections:

- `Hub` (visual) and `Hub.Data` (curves `road.*`, meshes `wall.*`, empties `spawn`, `exit`, `rental.bay`, `rental.cam`, `rental.kiosk`, `portal.<trackId>`).
- `Track.<trackId>` (visual, authored around the circuit's own origin) and `Track.<trackId>.Data` (curve `centre` with `width`; curve `route.<eventId>` per event on this circuit, carrying `loop`, `laps_hint`, and for sectors the `s0`,`s1` it was cut from; mesh `wall.left`, `wall.right`, `wall.fence`; empties `lobby` (the track-lobby spawn, on the pit straight 60 m before the start line, heading along), `return` (the portal home), `marker.<eventId>`).

Visuals per circuit: tarmac strip (shared vertices, 3 m rows), white edge lines, kerbs (alternating red/white, 0.6 m) where the bend exceeds 1/150 m⁻¹, gravel (sand colour, 4 m) outside bends, wall strips 1 m high along `wall.left/right` (double-sided material, no thickness), a 60 m grandstand and a 50 m pit building beside the pit straight, 30 light poles, 120 trees scattered 30–200 m from the centreline, a start gantry over the start line, a portal ring at `return`. Flat colours only; one mesh object per material per circuit.

### 3. The exporter (`tools/blender/export_strip.py`)

Writes:
- `apps/sim/public/strip/hub.glb` and `apps/sim/src/world/strip/hub.json` (`HubData`: `bounds, spawn, exit, rental{bay,cam,kiosk}, roads[], wander, walls[][] (polylines), portals: Record<trackId, {x, z}>`).
- For each circuit: `apps/sim/public/strip/tracks/<trackId>.glb` and `apps/sim/public/strip/tracks/<trackId>.json` (`TrackData`: `id, name, offset: [x, z], bounds, lobby {x, z, h}, return {x, z}, centre: {pts, width}, routes: Record<eventId, {pts, loop, cps}>, walls: Pt[][], markers: Record<eventId, Pt>`) — coordinates **local to the circuit** (the game adds `offset`), sampled at 3 m, 2 decimals.
- `apps/sim/src/world/strip/tracks.json`: the index `{ version: 1, tracks: [{ id, name, offset, events: eventId[] }] }`, imported statically by client and server.

Fails loudly when an event id in the exporter's `EVENTS` table has no route, a drag route is not straight within 0.5 m or not 402/805 ± 2 m, `cps` are not increasing, any value is not finite, a glb exceeds its budget (hub 1.5 MB, a circuit 800 kB) or a JSON exceeds 200 kB.

## Code (`apps/sim/src/world/strip/`)

- `district.ts` (pure): `HUB` from `hub.json`, `TRACKS` index from `tracks.json`, `offsetOf(trackId)`, `trackOfEvent(eventId)`, `loadTrack(trackId): Promise<TrackData>` (client: `fetch(BASE_URL + 'strip/tracks/<id>.json')`, cached; server: `readFileSync` of `public/strip/tracks/<id>.json`, synchronous variant `readTrackSync`), `routeFor(eventId): Route` in **world metres** (local pts + offset; needs the track loaded: throws "track not loaded" otherwise; the server loads all at startup, the client before any event of that track can start, which the portal guarantees and the quick-race path awaits).
- `routes.ts`: polyline routes with `cps` (as the race-park spec), `nearestRoadPoint` over the **current zone's** roads (the hub's roads, or the current circuit's centreline), `snapToRoad`.
- `roadGraph.ts`: the hub's roads as a graph for the GPS and wandering (as the race-park spec).
- `zone.ts` (new, pure): `type Zone = { kind: 'hub' } | { kind: 'track'; track: TrackData }`; `zoneRoads(zone): RoadData[]`, `zoneWalls(zone): Pt[][]` (offset applied), `zoneBounds(zone)`.
- `ai.ts`: `collideWalls(V, walls)` over polylines with a spatial hash rebuilt when the zone changes; `setWander(A, at)` on the hub graph.
- `events.ts`: as the race-park spec (routes by id, `cps`, `placeCp(point)`), plus `noTraffic` parks the hub's traffic (all events).
- `data.ts`: `EventDef = { id; type; name; track: TrackId; loop?; laps?; prize; rep; stage; noTraffic? }`; the twenty events above; `TRACK_NAMES: Record<TrackId, { en: string; es: string }>`.
- `park.ts` (scene): daylight scene; `buildHub()` (roads ribbon from data, portals' rings and signs, markers, cpMark, rental lot, gate ring, loads `hub.glb`); `mountTrack(track: TrackData)` (roads ribbon at the offset at once, event markers and the return portal, loads the glb, places it at `offset × W`; returns `{ group, ready, dispose }`); `unmountTrack()`.
- `scene.ts` (`StripScene`): `zone: Zone`, `enterTrack(id)` (await `loadTrack`, mount, place the car at `lobby + offset`, set the zone, rebuild the collision hash, hide the hub's traffic), `returnToHub()` (unmount, place at the hub's `spawn`, zone hub), portal handling in `promptText`/`pressEnter` (`'Enter · Ardennes'`, `'Enter · Back to the paddock'`), markers of the current zone only, GPS and wandering hub-only, `drawMapInto` framing the current zone's bounds and drawing its roads. Quick race from the Garage: `startEvent(ev)` awaits `enterTrack(trackOfEvent(ev.id))` first when not already there.
- `rental.ts`, `gate.ts`: constants from `HUB`. `payout.ts`: `eventDistance` from `routeFor`. `hud.ts`: checkpoint arrow from `cpPoint`. `garage.ts`: event list grouped by circuit name (English/Spanish by `TRACK_NAMES`), lengths from `routeFor` where loaded, else from the index's `lenM`.
- `VanillaThreeScene.tsx`: only `STRIP_SPAWN` and `snapToRoad` keep their names; the Strip's `pressEnter` already routes through `StripScene`.
- `i18n.tsx`: the Strip description, the portal prompts, "Back to the paddock", the attribution line; `StripEntry.tsx` shows the attribution line in small print.
- `server.ts`: at startup `readTrackSync` for every track in the index (so `routeFor` works for `eventDistance`); nothing else.

## Budgets and performance

Hub glb ≤ 1.5 MB; each circuit glb ≤ 800 kB and JSON ≤ 200 kB; ≤ 60 draw calls and ≤ 150k triangles for a circuit; no normals in the glbs (flat shading). Only the hub and at most one circuit are mounted at a time. Pixel ratio and quality settings as today.

## Testing

- `tools/tracks/fetch_osm_tracks.mjs` has `--check` that re-validates the committed centreline files (closed loop, length within 3 %, 3 m sampling) without network; a vitest test runs the same checks on the committed files.
- Unit (node): `district.test.ts` (index ↔ `EVENTS` ids agree; every event's route in its track's JSON; `cps` rules; drag routes straight and 402/805 ± 2; markers and lobby inside bounds and ≥ 1.5 m from walls; start grids and drag lanes clear of walls; asset sizes within budget), `routes`, `roadGraph`, `zone` (walls offset, bounds), `ai` (walls, fence at the cell edge, wander), `events` (laps through `cps`, sprint finish, drift sector finish, drag at `len`), `park` (hub and a mounted track in node without the loader; a rejected glb load keeps the ribbons), `scene` (enter a track, markers switch, return home, map draws), `payout`, `data` (names en/es for every track).
- Browser at 375 px and desktop: hub, every portal once (ten circuits load, each with no console errors), one event of each type to results with a prize, an outrun in the hub, the map, respawn, return through the gate; frame time on Low on the longest circuit.
- `pnpm --filter @micar/sim test`, `exec tsc --noEmit`, `build`, `pnpm --filter @micar/value test`, `pnpm site`, and the e2e smoke updated for the hub.

## Out of scope

Elevation and banking; night; real circuit names or logos; traffic on circuits; ghosts; Draco/KTX; more than ten circuits; editing circuit shapes by hand (OSM is the source; corrections go in the fetch script's table).
