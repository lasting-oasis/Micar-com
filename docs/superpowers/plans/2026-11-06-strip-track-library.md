# Strip Track Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Strip's grid city with a daytime hub and a library of ten full-size world circuits traced from OpenStreetMap, modelled in Blender, exported per circuit as glb + JSON, loaded on demand, with about twenty events across the career stages.

**Architecture:** `tools/tracks/fetch_osm_tracks.mjs` turns OSM raceway ways into committed centreline files. `tools/blender/build_strip.py` builds the hub and every circuit in one `.blend`; `tools/blender/export_strip.py` writes `hub.glb/json`, `tracks/<id>.glb/json` and the `tracks.json` index. In the game, `world/strip/district.ts` exposes the hub data and loads a circuit's data lazily (the server reads all at startup); `zone.ts` says which roads and walls are live; `routes.ts`, `roadGraph.ts`, `ai.ts`, `events.ts`, `park.ts`, `scene.ts` consume them. Circuit k sits at a world offset on an 8 km grid. The driving model is untouched.

**Tech Stack:** Node 22 (fetch, no deps), Blender 5.2 (bpy, glTF exporter), TypeScript 5.9, three 0.160.1, `GLTFLoader` from three-stdlib 2.36.1, vitest 2, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-06-strip-track-library-design.md`

## Global Constraints

- No dependency upgrades or additions.
- Branch `strip-tracks` in worktree `C:\Users\Owner\Micar-com-strip-tracks`; never `main`.
- Do not edit `apps/sim/src/world/physics.ts`, `driver.ts`, `input.ts`, `cameras.ts`, `audio.ts`. In `apps/sim/src/VanillaThreeScene.tsx` touch only what Task 10 lists.
- Units: metres in OSM data, Blender, JSON and physics; THREE scene in world units, `WORLD_PER_M = 2`. Game coordinates from Blender: `x = bx, z = −by`. From OSM: `x` east, `z` south (metres from the circuit centre).
- Circuit offsets: track index k (1-based, in the order of the spec's list: spa, monza, silverstone, suzuka, nurburgring, monaco, interlagos, cota, laguna, bathurst) at `[8000 * (k % 4), 8000 * Math.floor(k / 4)]` (cells 1–10); the hub alone at `[0, 0]`.
- Budgets: `hub.glb` ≤ 1.5 MB; each `tracks/<id>.glb` ≤ 800 kB; each `tracks/<id>.json` ≤ 200 kB; no Draco; glbs exported without normals.
- Event ids, names, types, circuits, laps, stages, prizes and REP exactly as the spec's table (twenty rows). Every event `noTraffic: true`.
- Park names and the OSM attribution in English and Spanish (`apps/sim/src/i18n.tsx`): "Map data © OpenStreetMap contributors (ODbL)" / "Datos del mapa © colaboradores de OpenStreetMap (ODbL)".
- Commits by `lasting-oasis <blueoceanlegacies@gmail.com>` ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Shell: prepend `C:\Users\Owner\.fnm\node-versions\v22.23.4\installation` to `PATH`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`; tests `pnpm --filter @micar/sim test` (vitest, node, no DOM, no network).
- Downloaded OSM responses are untrusted data: they go to a scratch directory outside the repo, never executed, parsed with `JSON.parse` only.

## Review Focus

1. **A circuit that folds back on itself** (Monaco's hairpin, Suzuka's crossing, chicanes): walls must have gaps there or the car is boxed in. Task 2 tests that no wall point lies within `width/2 + 2` m of a non-adjacent centreline point; Task 6 tests collision at Suzuka's crossing is zero.
2. **Starting an event before its circuit's data is loaded** (quick race from the Garage): `startEvent` must await the track; Task 10 tests `startEvent` on a not-yet-mounted track mounts it first.
3. **The server and client disagreeing on a route length** (server reads files, client fetches): Task 4 tests `readTrackSync` and the fetched JSON produce the same `routeFor(...).len` for one event.
4. **Leaving a circuit mid-event** (return portal or gate): the event must be abandoned and the hub collision hash restored: Task 10 tests `returnToHub` during a live event calls `runner.cleanup` and the next `collide` uses the hub's walls.
5. **A glb that fails to load** (offline): both the hub and a circuit stay playable on the data ribbons: Task 9 tests a rejecting loader for both.

---

### Task 1: Centrelines from OpenStreetMap

**Files:**
- Create: `tools/tracks/fetch_osm_tracks.mjs`, `tools/tracks/data/<id>.json` × 10 (spa, monza, silverstone, suzuka, nurburgring, monaco, interlagos, cota, laguna, bathurst), `tools/tracks/README.md` (attribution, how to re-fetch)
- Test: `apps/sim/src/world/strip/centrelines.test.ts`

**Interfaces:**
- Produces `tools/tracks/data/<id>.json`: `{ id, name, source: 'OpenStreetMap', licence: 'ODbL', fetchedAt: ISO string, lapM: number, lenM: number, widthM: number, centre: [lat, lon], pts: [x, z][] }` with `pts` a closed loop (last ≠ first; the loop closes implicitly), sampled every 3 m, 2 decimals, running in the race direction from the start/finish line, `x` east and `z` south in metres from `centre`.
- Script CLI: `node tools/tracks/fetch_osm_tracks.mjs [id...]` fetches and writes; `--check` re-validates the committed files offline; exit 1 on any failure with the reason.

Table values (lap lengths in metres, direction, width, start hint):

| id | name | lapM | dir | width | centre lat, lon | start/finish lat, lon |
|---|---|---|---|---|---|---|
| spa | Ardennes | 7004 | cw | 12 | 50.4372, 5.9714 | 50.4443, 5.9653 |
| monza | Royal Park | 5793 | cw | 12 | 45.6156, 9.2811 | 45.6189, 9.2812 |
| silverstone | Airfield | 5891 | cw | 12 | 52.0786, -1.0169 | 52.0733, -1.0197 |
| suzuka | Figure Eight | 5807 | cw | 12 | 34.8431, 136.5410 | 34.8450, 136.5383 |
| nurburgring | Eifel | 5148 | cw | 12 | 50.3356, 6.9475 | 50.3328, 6.9412 |
| monaco | Harbour | 3337 | cw | 10 | 43.7347, 7.4206 | 43.7347, 7.4214 |
| interlagos | Lagoons | 4309 | ccw | 12 | -23.7036, -46.6997 | -23.7013, -46.6968 |
| cota | Lone Star | 5513 | ccw | 12 | 30.1328, -97.6411 | 30.1346, -97.6355 |
| laguna | Dry Lagoon | 3602 | ccw | 11 | 36.5841, -121.7530 | 36.5841, -121.7510 |
| bathurst | The Mountain | 6213 | ccw | 11 | -33.4422, 149.5500 | -33.4480, 149.5450 |

Filters: default `["highway"="raceway"]` within 3,500 m of the centre; exclude ways whose tags match `sport=karting`, `historic`, `note=draft`, `access=private`, `service`, or name matching `/pit|kart|paddock|support|moto|junior|ex circuito|oval|anello|sopraelevata|variant.*moto/i`; for Monza also exclude `38168756` (the motorcycle Rettifilo variant). Monaco: `["highway"]["name"~"Boulevard Albert 1er|Avenue d'Ostende|Avenue de Monte-Carlo|Place du Casino|Avenue des Spélugues|Boulevard Louis II|Avenue J.F. Kennedy|Avenue de la Quarantaine|Avenue Princesse Grace|Quai Albert 1er|Boulevard du Larvotto|Tunnel Louis II"]` within 1,200 m (the car tunnel is `tunnel=yes`; keep it). Bathurst: raceway, else `["highway"]["name"~"Mountain Straight|Conrod Straight|Pit Straight|Mount Panorama"]` within 3,500 m. Verify the hint coordinates against the fetched data (the start line point nearest the hint must be on the assembled loop); if a hint is off, correct it in the table and say so in the report.

Loop assembly: node graph from kept ways (shared node ids = connections; also merge node pairs within 2 m). Start from the way whose geometry is nearest the start hint; walk forward along way directions (`oneway=yes`) to the far end; at a node with more than one outgoing way, explore each in turn (depth-first, memoising) and keep the closed loop whose length is nearest `lapM`; reject when no loop within 3 %. Project: `x = (lon − lon0) · cos(lat0) · 111320`, `z = −(lat − lat0) · 110540`. Resample at 3 m; rotate so `pts[0]` is nearest the start hint; reverse if the direction (sign of the signed area: cw in the x-east/z-south frame has negative signed area in x/z, since z points south) does not match `dir`.

- [ ] **Step 1: Write the failing test** `centrelines.test.ts`: for each of the ten ids, `tools/tracks/data/<id>.json` exists; `|lenM − lapM| / lapM ≤ .03`; consecutive point spacing between 2 and 4 m, closing gap ≤ 4 m; signed area sign matches `dir` (as above); `pts.length === Math.round(lenM / 3) ± 2`; width in the table.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- centrelines` → fails (no files).
- [ ] **Step 3: Write the script**; run it for one circuit (Monza) first; check its `lenM`; then all ten. Where a circuit fails, fix the filter or hint in the table (never the output by hand), re-run, and report what changed.
- [ ] **Step 4: Run** `node tools/tracks/fetch_osm_tracks.mjs --check` → `ok` for ten; then the vitest → PASS.
- [ ] **Step 5: Commit** `strip: ten circuit centrelines from OpenStreetMap (fetch script and data)`.

### Task 2: The hub and the ten circuits in Blender; the exporter

Done in the connected Blender by the main session (Blender MCP). Both scripts committed.

**Files:**
- Modify: `tools/blender/build_strip.py` (rebuild: `HUB` layout + per-circuit builder reading `tools/tracks/data/*.json`)
- Create: `tools/blender/export_strip.py`, `apps/sim/assets/strip/district.blend`, `apps/sim/public/strip/hub.glb`, `apps/sim/public/strip/tracks/<id>.glb` × 10, `apps/sim/public/strip/tracks/<id>.json` × 10, `apps/sim/src/world/strip/hub.json`, `apps/sim/src/world/strip/tracks.json`

**Interfaces (produced JSON):**
```ts
type Pt = [number, number];
type HubData = { version: 1; bounds: { minX; minZ; maxX; maxZ }; spawn: { x; z; h }; exit: { x; z; r };
  rental: { bay: { x; z; h }; cam: { x; y; z }; kiosk: { x; z } };
  roads: { id: string; pts: Pt[]; loop: boolean; width: number }[]; wander: string;
  walls: Pt[][]; portals: Record<string, Pt> };                       // portals keyed by track id
type TrackData = { version: 1; id: string; offset: Pt; bounds: {…}; lobby: { x; z; h }; return: Pt;
  centre: { pts: Pt[]; width: number; loop: true }; routes: Record<string, { pts: Pt[]; loop: boolean; cps: number[] }>;
  walls: Pt[][]; markers: Record<string, Pt> };                        // all coordinates local to the circuit
type TracksIndex = { version: 1; tracks: { id: string; offset: Pt; lenM: number; events: string[] }[] };
```
Heading `h` as the race-park spec (car faces `(sin h, cos h)`). Hub layout: paddock 220 × 120 m centred (0, −70) (Blender), loop road a rounded rectangle x ∈ [−300, 300], y ∈ [−160, 160] r 60 width 12 (`road.loop`, the wander road), `spawn` (0, −30) heading north, `exit` (90, −110) r 9, `rental.bay` (−70, −30) north, `rental.cam` (−92, −52) h 5, `rental.kiosk` (−50, −45), portals in two rows of five along a boulevard at y = 40 and y = 90, x = −120 … 120 step 60, each a ring with a sign (paint) carrying the park name text is not modelled (a plain sign box; the game labels it). Per circuit: everything the spec's "Blender file" section lists, built from `tools/tracks/data/<id>.json`; events per circuit from the exporter's `EVENTS` table (copied from the spec); sectors by `s`-range constants in the build script: `harbour_drift` s ∈ [1400, 2300], `figure8_drift` s ∈ [300, 1500], `mountain_drift` s ∈ [2900, 4400] (the descent; verify on the drawn track and adjust to the real sector), `royal_drag` 402 m ending 60 m before the start line, `mountain_drag` 805 m of the longest straight (Bathurst's Conrod straight; COTA's back straight is not straight enough in OSM); sprints = the full loop as a non-loop route from `s = 0` to `s = len`. `lobby` 60 m before the start line; `return` 40 m before the lobby, 8 m to the right; markers 30 m apart along the pit straight from the start line forward, 8 m to the right of the centreline (outside the racing line); `cps` every nearest-500 m.

- [ ] **Step 1: Rewrite `build_strip.py`** (`build_hub()`, `build_track(data)`, `build_all()`, `report()`), run in Blender, read `report()` lengths and triangle counts; look at two circuits and the hub (`render_viewport_to_path`) and fix overlaps.
- [ ] **Step 2: Write `export_strip.py`** with the checks the spec lists (wall gaps near non-adjacent centreline, straight drags, budgets, `cps`); run; report every file's size.
- [ ] **Step 3: Save the `.blend`**; commit scripts, `.blend`, glbs and JSONs: `strip: the hub and ten circuits modelled and exported`.

### Task 3: `routes.ts` on polylines (grid removed) — as the race-park plan's Task 4, with `nearestRoadPoint(x, z, roads: RoadData[])` taking the roads explicitly.

**Files:** Modify `apps/sim/src/world/strip/routes.ts`; Test `routes.test.ts`.
**Produces:** `Route { pts, cum, len, loop, cps }`, `buildRoute(pts, loop, cps?)`, `routePoint`, `routeProgress` (unchanged), `cpPoint(route, k)`, `nearestRoadPoint(x, z, roads)`, `snapToRoad(V, roads)`, `offsetPts(pts, offset): Pt[]`. Removed: every grid export. `RoadData`/`Pt` types live in `district.ts` (Task 4) — define them in `routes.ts` for now as `export type Pt = [number, number]; export type RoadData = { id: string; pts: Pt[]; loop: boolean; width: number }` and have Task 4 re-export them.
- Steps as the race-park plan's Task 4 (tests on hand-made polylines: a 400 m square loop, a 300 m sprint, snapping beside a road, `cpPoint` wrap, `offsetPts` adds the offset). Commit `strip: routes on polylines; the grid goes`.

### Task 4: `district.ts` and `zone.ts`

**Files:** Create `apps/sim/src/world/strip/district.ts`, `zone.ts`; Test `district.test.ts`, `zone.test.ts`.
**Produces:**
```ts
export const HUB: HubData; export const TRACKS: TracksIndex['tracks']; export type TrackId = string;
export function offsetOf(trackId): Pt; export function trackOfEvent(eventId): TrackId;    // from the index
export function readTrackSync(trackId): TrackData;     // node: fs.readFileSync(resolve(process.cwd(), 'public/strip/tracks', id + '.json')) — path configurable via setTrackDir(dir)
export function loadTrack(trackId, fetcher?: (url: string) => Promise<TrackData>): Promise<TrackData>;  // cached; default fetcher uses fetch(BASE + 'strip/tracks/<id>.json'); BASE from setAssetBase(base), default '/'
export function trackLoaded(trackId): TrackData | undefined;
export function routeFor(eventId): Route;              // world metres (offset added); throws Error('track not loaded: <id>') if not
export function markerFor(eventId): Pt;                 // world metres
export const SPAWN, EXIT, RENTAL, BOUNDS (hub)
// zone.ts
export type Zone = { kind: 'hub' } | { kind: 'track'; track: TrackData };
export function zoneRoads(z): RoadData[];   // hub roads, or [{ id: 'centre', pts: offset pts, loop: true, width }]
export function zoneWalls(z): Pt[][];       // offset applied for a track
export function zoneBounds(z): { minX; minZ; maxX; maxZ };
export function zoneMarkers(z): { id: string; kind: 'event' | 'portal' | 'return'; at: Pt; label: { en: string; es: string } }[];
```
Tests (node, using `readTrackSync` with `setTrackDir`): index ↔ `EVENTS` ids agree and every event's track has its route; `cps` rules; drag routes straight and 402/805 ± 2; each track's lobby, return and markers inside bounds and ≥ 1.5 m from walls; start grids (±3 m, 0/−8 m) and drag lanes clear of walls; wall points ≥ `width/2 + 2` from non-adjacent centreline points; asset sizes within budget; `routeFor` adds the offset; `loadTrack` with a stub fetcher caches; `zoneWalls` of a track equals its walls plus the offset; `zoneMarkers('hub')` has ten portals. Commit `strip: typed hub and track data, zones`.

### Task 5: `roadGraph.ts` — as the race-park plan's Task 5, over `HUB.roads` only. Commit `strip: hub road graph for GPS and wandering`.

### Task 6: `ai.ts` — as the race-park plan's Task 6, with `collideWalls(V, walls: Pt[][])` over polylines and `setWallZone(walls)` rebuilding the spatial hash (40 m cells); plus a test that a car on Suzuka's crossing (the point where the centreline comes within 20 m of a non-adjacent part of itself, found in the test from the data) has `collideWalls === 0`, and the cell fence test. Commit `strip: wall collisions per zone; AI wanders the hub`.

### Task 7: `data.ts` events and names

**Files:** Modify `apps/sim/src/world/data.ts` (`EventDef`, `EVENTS`, add `TRACK_NAMES`, `freshStrip` migration helper `pruneStrip(rec)` dropping unknown ids from `wins`/`best`); Test `data.test.ts`.
`EventDef = { id; type; name; track: TrackId; loop?: boolean; laps?: number; prize; rep; stage; noTraffic?: true }`; the twenty rows verbatim; `TRACK_NAMES: Record<TrackId, { en; es }>` (Ardennes/Ardenas, Royal Park/Parque Real, Airfield/Aeródromo, Figure Eight/Ocho, Eifel/Eifel, Harbour/Puerto, Lagoons/Lagunas, Lone Star/Estrella Solitaria, Dry Lagoon/Laguna Seca, The Mountain/La Montaña). Tests: twenty events, stages 1–5 non-empty, every `track` in `TRACK_NAMES`, `pruneStrip` drops `sp1`. Commit `strip: the library's events and park names`.

### Task 8: Events, HUD, garage, payout, server startup — as the race-park plan's Task 7 (routes by `routeFor`, `cps`, `placeCp(point)`), plus: `EventRunner.start` throws if `routeFor` throws (the scene guarantees loading); `garage.ts` groups the event list by `TRACK_NAMES[ev.track]` and shows length from `routeFor` when loaded else `TRACKS` `lenM × laps`; `payout.ts` `eventDistance` via `routeFor`; `server.ts` calls `readTrackSync` for every `TRACKS` entry at startup (one line after the imports, with `setTrackDir(path.join(__dirname, 'public/strip/tracks'))`). Tests as before plus `payout.test.ts` loading tracks with `setTrackDir`. Commit `strip: events, HUD, garage, payout and the server read the library`.

### Task 9: `park.ts` — the daylight hub and mounted circuits

**Files:** Create `apps/sim/src/world/strip/park.ts`; Delete `city.ts`, `city.test.ts`; Modify `rental.ts`, `gate.ts`, `rentalLot.ts` (constants from `HUB`); Test `park.test.ts`.
**Produces:**
```ts
export type Loader = (url: string) => Promise<THREE.Object3D>;
export type Hub = { scene: THREE.Scene; markers: SceneMarker[]; cpMark: THREE.Group; modelReady: Promise<void>; dispose(): void };
export type Mounted = { group: THREE.Group; markers: SceneMarker[]; modelReady: Promise<void>; dispose(): void };
export type SceneMarker = { id: string; kind: 'event' | 'portal' | 'return'; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh };  // world metres x/z
export function buildHub(opts?: { loadModel?: Loader; assetBase?: string }): Hub;
export function mountTrack(scene: THREE.Scene, track: TrackData, opts?: { loadModel?: Loader; assetBase?: string }): Mounted;
export function roadRibbons(roads: RoadData[]): THREE.BufferGeometry;
export const SKY = 0x9fc5ee; ACCENT, TUBE_BLUE, CHROME, radialTexture as before
```
Hub: sky/fog/sun/hemisphere as the race-park spec; ground plane 60 km square (grass) at y 0; hub roads ribbon; portal rings (`EV_COL`-like per-track colour: use `'#ffd23f'`), beams, the cpMark; loads `hub.glb`. `mountTrack`: a group at `offset × W` holding the centre ribbon (hidden when the glb arrives), the event markers and the return portal at the track's local positions, the glb scaled by W; `modelReady` resolves on success or failure (warn). Tests: hub markers = ten portals at `HUB.portals`; a mounted track's group position equals offset × W and its markers' world x/z equal local + offset; rejected loaders keep ribbons visible for both; dispose frees geometries/materials. Commit `strip: daylight hub and mountable circuits`.

### Task 10: `StripScene` zones, portals, quick race; main-scene and copy edits

**Files:** Modify `scene.ts`, `VanillaThreeScene.tsx` (imports `STRIP_SPAWN`, `snapToRoad(V, roads)` → the scene exposes `S.snap(V)` so the main scene calls `S.snap(V)` instead of `snapToRoad(V)` at line 746 — the one edit there), `i18n.tsx`, `StripEntry.tsx` (attribution small print), `Footer.tsx` credits line if the footer has one (else skip); Test `scene.test.ts`.
**Produces:** `zone: Zone`, `enterTrack(id): Promise<void>`, `returnToHub(): void`, `snap(V)`, `promptText()` with portal/return prompts (`'Enter · ' + TRACK_NAMES[id].en`, `'Enter · Back to the paddock'`; Spanish via the existing i18n of the prompt layer if one exists, else English), `pressEnter()` handling portals and return, `startEvent(ev)` → `async`, awaiting `enterTrack(trackOfEvent(ev.id))` when needed; traffic hidden off-hub; `setWallZone` on zone change; `drawMapInto` frames `zoneBounds` and draws `zoneRoads`; `Gps { label, target, path }`. Tests: enter a track → `zone.kind === 'track'`, car at lobby + offset, hub traffic parked; `pressEnter` at a portal enters; return during a live event abandons it and restores hub walls (collide against a hub wall point hits); `startEvent` for an unmounted track mounts it; map draws for both zones. Commit `strip: zones, portals and quick race on the library; copy and attribution`. Then `pnpm --filter @micar/sim exec tsc --noEmit` clean (first full compile; fix leftover grid references in their owning files).

### Task 11: Build, smoke, browser verification, PR — as the race-park plan's Task 10, plus visiting all ten portals at 375 px with no console errors and a frame-time sample on Spa.
