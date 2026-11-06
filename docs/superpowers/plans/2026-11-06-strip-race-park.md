# Strip Race Park Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Strip's procedural grid city with a daytime race park (paddock, ring road, road circuit, stadium, drag strip) modelled in Blender, exported as one glb plus a JSON of race data that the client and the server both read.

**Architecture:** Blender is the source of truth: `apps/sim/assets/strip/district.blend` holds the scenery in a `Track` collection and the race data (route curves, road curves, wall meshes, empties) in a `Data` collection. `tools/blender/export_strip.py` writes `apps/sim/public/strip/district.glb` and `apps/sim/src/world/strip/district.json`. In the game, `world/strip/district.ts` types and exposes the JSON; `routes.ts`, `roadGraph.ts`, `ai.ts`, `events.ts`, `park.ts` and `scene.ts` consume it; the grid (`N`, `CELL`, block rectangles, node routes) is removed. The driving model is untouched.

**Tech Stack:** Blender 5.2 (Python 3.13, bpy, glTF exporter), TypeScript 5.9, three 0.160.1, `GLTFLoader` from three-stdlib 2.36.1 (already a dependency), vitest 2, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-11-06-strip-race-park-design.md`

## Global Constraints

- No dependency upgrades or additions; `three-stdlib` is already in `apps/sim/package.json`.
- Work on branch `strip-tracks` in the worktree `C:\Users\Owner\Micar-com-strip-tracks` (cut from `origin/main`); never on `main`.
- Do not edit `apps/sim/src/world/physics.ts`, `driver.ts`, `input.ts`, `cameras.ts`, `audio.ts`. In `apps/sim/src/VanillaThreeScene.tsx` touch nothing beyond what Task 9 lists (a sibling branch is editing it).
- Units: Blender and the JSON are **metres**, physics is SI; the THREE scene is world units, `WORLD_PER_M = 2` (`apps/sim/src/world/units.ts`). Game coordinates from Blender: `x = bx`, `z = -by`, `y = bz` (the glTF Y-up conversion).
- Event **ids, types, laps, loop, prize, rep, stage, noTraffic** in `apps/sim/src/world/data.ts` do not change; names do.
- Asset budget: `district.glb` ≤ 3 MB, `district.json` ≤ 300 kB, no Draco, ≤ 150k triangles.
- Copy in English and Spanish wherever the UI shows it (`apps/sim/src/i18n.tsx`).
- Commits by `lasting-oasis <blueoceanlegacies@gmail.com>` (repo config), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Shell: prepend `C:\Users\Owner\.fnm\node-versions\v22.23.4\installation` to `PATH` and set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`; tests run as `pnpm --filter @micar/sim test` (vitest, node environment, no DOM).
- Tests must run in node without a DOM, fetch or WebGL: anything that loads the glb is skipped when `typeof document === 'undefined'`.

## Review Focus

1. **Driving off the park's edge.** The outer boundary of the district must be a closed wall so a car can never leave the bounds: tested in Task 6 (a car past `bounds` is pushed back).
2. **Start grid in a barrier.** Every event's four start slots (lanes ±3 m, 0 and −8 m back along the route; a drag's four lanes at ±2.5 and ±7.5 m) must be at least 1.5 m from any wall: tested in Task 3 against the exported data.
3. **GPS from the grass.** A GPS asked for while the car is off every road must still produce a path: `shortestPath` snaps both ends to the nearest road point: tested in Task 5.
4. **The model fails to load** (offline, 404). The park must stay playable on the data-built roads: `buildPark` resolves `modelReady` and logs instead of throwing: tested in Task 8 with a rejecting loader.
5. **A stale export.** If `district.json` and `data.ts` disagree (an event without a route, a different `version`), the test suite must fail, not the player at Enter: tested in Task 3.

---

### Task 1: The park in Blender (layout, build script, `.blend`)

This task is done in the connected Blender instance by the main session (the Blender MCP tools), not by a subagent.

**Files:**
- Create: `tools/blender/build_strip.py`
- Create: `apps/sim/assets/strip/district.blend` (saved from Blender)

**Interfaces:**
- Produces: a `.blend` with collections `Track` (visual meshes) and `Data` (curves `route.<id>`, `road.<name>`, meshes `wall.<name>`, empties `spawn`, `exit`, `rental.bay`, `rental.cam`, `rental.kiosk`, optional `marker.<id>`), as the spec's "The Blender file" section defines.

Layout (Blender metres, x east, y north; the game's z is −y). Start from these and tune to the length targets, measuring each curve's length in the script's report:

| Element | Where | Target |
|---|---|---|
| Paddock apron | centred (0, −60), 180 × 90 m, north of the ring's south straight | `spawn` at (0, −30) facing north (game h = π); `exit` at (70, −30), r 9; `rental.bay` at (−50, −30) facing north; `rental.cam` at (−72, −52) height 5; `rental.kiosk` at (−30, −45) |
| `road.ring` | rounded rectangle centreline, x ∈ [−420, 420], y ∈ [−120, 420], corner radius 80, cyclic, width 12 | 1,500 ± 200 m |
| `road.circuit` | the road circuit inside the ring's west half, pit straight along x = −100 from y = −40 north to y = 200, then ten corners through about (−100, 230), (−20, 300), (80, 330), (140, 260), (60, 200), (120, 120), (40, 60), (140, −20), (60, −50), (−40, −60); Bezier, cyclic, width 12 | 2,400 ± 300 m |
| `road.stadium_short`, `road.stadium_long` | inside a bowl centred (300, 150), radius 110; a tight loop (hairpin, sweeper, chicane) of 550 ± 80 m and a longer loop of 800 ± 100 m sharing the start straight; width 10 | as given |
| `road.drag` | straight along y = −250 from x = −480 to x = 520, width 20 | start line at x = −420 so the quarter (402 m) and half (805 m) marks fall on the strip; 100 m run-off past 805 |
| `road.pit_access`, `road.stadium_access`, `road.drag_access` | ring ↔ circuit pit entry at (−100, −120); ring ↔ stadium at (420, 150); paddock ↔ drag staging at (−420, −200); width 10 | each ≤ 250 m |

Routes (curves in `Data`, control points = checkpoints, first = start, direction = travel):

| id | curve | notes |
|---|---|---|
| ci1 | `road.circuit` clockwise, 10–12 control points at the corners | loop |
| ci2 | the same corners anticlockwise | loop |
| sp1 | spawn → west along the ring → `road.pit_access` → pit straight, finishing at the circuit's start line | 700–1,000 m, 5–7 checkpoints |
| sp2 | spawn → east along the ring, the full loop clockwise, into the pit access, finishing at the circuit start | 1,700–2,100 m |
| sp3 | spawn → ring to the pit access → one circuit lap → finishing at the circuit start | 2,900–3,500 m |
| sx1 | `road.stadium_short` | loop |
| sx2 | `road.stadium_long` | loop |
| df1 | `road.stadium_short` reversed | loop |
| df2 | `road.stadium_long` reversed | loop |
| dr1 | two points on `road.drag`'s centreline: x = −420 and x = −18 | 402 m straight |
| dr2 | x = −420 and x = 385 | 805 m straight |

Walls (`wall.*` meshes, edges near the ground are the segments): the outer fence 50 m outside the roads' bounds (closed rectangle); the stadium bowl (closed, radius 110, as a 48-gon); both sides of the drag strip over its full length, 12 m from the centreline; tyre barriers on the outside of each circuit corner (6 m from the centreline, 40–80 m long); the paddock's north and side fences (open to the ring road). No walls along the ring road or the circuit straights.

Visual meshes (`Track`): tarmac ribbons swept from every `road.*` at its width (dark grey, 2 m sampling, flat at z = 0.01); red/white kerb strips 0.6 m wide at the circuit's and stadium's edges on corners; a 2 m run-off strip (sand colour) outside the circuit kerbs; barrier boxes (0.5 × 1 × 2 m) along every wall segment; two grandstands (stepped boxes, 60 × 14 m) on the pit straight and the drag strip; pit garages (6 boxes, 12 × 8 × 5 m) along the paddock; the stadium bowl as a stepped ring; a drag Christmas tree (a pole with 6 coloured spheres) at the start line and gantries at 402 and 805 m; 40 light poles; 60 low-poly trees (cone + cylinder) outside the ring; a MiCar sign (a box, paint yellow `#ffd23f`) over the paddock. Materials are flat colours (`Principled BSDF` base colour, no textures), one object per material after joining: `tarmac`, `kerb_red`, `kerb_white`, `runoff`, `barrier`, `concrete`, `steel`, `foliage`, `paint`, `tree_lights`.

- [ ] **Step 1: Check the Blender scene** with `get_objects_summary`: the default `Collection` with Cube, Camera, Light, unsaved. Delete the Cube only (keep Camera and Light; they are not exported).
- [ ] **Step 2: Write `tools/blender/build_strip.py`**: a `LAYOUT` dict (roads, routes, walls, empties, props as above), functions `make_curve(name, pts, cyclic, bezier)`, `sweep(curve, width, z, material) -> mesh`, `wall_mesh(name, pts, closed)`, `barriers_along(pts)`, `grandstand(at, size, facing)`, `empty(name, x, y, z=0, heading=None, props={})`, `build()` that clears both collections and rebuilds everything, `report()` that returns `{name: length_m}` for every curve. Idempotent: running it twice gives the same scene.
- [ ] **Step 3: Run it in Blender** (`execute_blender_code` with the file's text, then `build(); result = report()`). Compare the lengths with the targets; adjust `LAYOUT` and re-run until every target in the tables holds.
- [ ] **Step 4: Look at it**: `render_viewport_to_path` to the scratchpad from a top view and a low angle over the paddock; fix anything crossing (an access road through a grandstand, a wall across a road).
- [ ] **Step 5: Save** `bpy.ops.wm.save_as_mainfile(filepath='C:/Users/Owner/Micar-com-strip-tracks/apps/sim/assets/strip/district.blend')`; confirm its size is under 20 MB.
- [ ] **Step 6: Commit** `tools/blender/build_strip.py` and `apps/sim/assets/strip/district.blend`: `strip: the race park modelled in Blender (build script and .blend)`.

### Task 2: The exporter (`district.glb`, `district.json`)

Done by the main session in Blender, like Task 1.

**Files:**
- Create: `tools/blender/export_strip.py`
- Create: `apps/sim/public/strip/district.glb`, `apps/sim/src/world/strip/district.json`

**Interfaces:**
- Produces `district.json` of type `DistrictData` (Task 3) exactly:
  ```ts
  type Pt = [number, number];
  type DistrictData = {
    version: 1;
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
    spawn: { x: number; z: number; h: number };
    exit: { x: number; z: number; r: number };
    rental: { bay: { x: number; z: number; h: number }; cam: { x: number; y: number; z: number }; kiosk: { x: number; z: number } };
    routes: Record<string, { pts: Pt[]; loop: boolean; cps: number[] }>;
    roads: { id: string; pts: Pt[]; loop: boolean; width: number }[];
    wander: string;
    walls: [number, number, number, number][];
    markers: Record<string, Pt>;
  };
  ```
  Heading `h` of an empty = `atan2(dx, dz)` of its local +Y axis in game coordinates (a car with `h` faces `(sin h, cos h)` in x, z). `cps[0] = 0`; for a non-loop route the last `cps` equals the route length. Sampling ≤ 2 m, numbers rounded to 2 decimals. `markers[id]` defaults to the route's first point. Walls: every edge of every `wall.*` mesh whose two vertices both have world z < 1 m.

- [ ] **Step 1: Write `tools/blender/export_strip.py`** with `EVENT_IDS = ['sp1','ci1','sx1','dr1','df1','sp2','ci2','dr2','df2','sx2','sp3']`, `sample_curve(obj, step=2.0) -> list[(x, z)]` (evaluates Bezier segments with `mathutils.geometry.interpolate_bezier`, 16 per segment, then resamples at the step; control-point distances recorded for `cps`), `export_json(path)`, `export_glb(path)` (select every object in `Track`, `bpy.ops.export_scene.gltf(filepath, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False, export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=False)`), checks that raise `RuntimeError` on: a missing route for an `EVENT_IDS` id, a drag route (`dr*`) whose points deviate more than 0.5 m from the chord, non-increasing `cps`, any non-finite number, a glb over 3,000,000 bytes.
- [ ] **Step 2: Run it** in Blender against the saved file; output to the worktree paths. Report the glb size, the JSON size, route lengths and wall count.
- [ ] **Step 3: Validate the JSON in node**: `node -e "const d=require('./apps/sim/src/world/strip/district.json'); console.log(Object.keys(d.routes), d.roads.length, d.walls.length)"` from the worktree prints eleven ids.
- [ ] **Step 4: Commit** `tools/blender/export_strip.py`, `apps/sim/public/strip/district.glb`, `apps/sim/src/world/strip/district.json`: `strip: export the park to glb and race data json`.

### Task 3: `district.ts`, the typed data

**Files:**
- Create: `apps/sim/src/world/strip/district.ts`
- Test: `apps/sim/src/world/strip/district.test.ts`

**Interfaces:**
- Consumes: `district.json` (Task 2); `buildRoute(pts, loop, cps)` and `Route` from Task 4 (write `district.ts` against that signature; Tasks 3 and 4 land together in one commit if needed, or Task 3's `routeFor` is added after Task 4 — do Task 4 first if `routes.ts` is still the grid version).
- Produces (all exported from `district.ts`):
  ```ts
  export type Pt = [number, number];
  export type RoadData = { id: string; pts: Pt[]; loop: boolean; width: number };
  export type RouteData = { pts: Pt[]; loop: boolean; cps: number[] };
  export type DistrictData = /* as Task 2 */;
  export const DISTRICT: DistrictData;
  export const ROADS: RoadData[]; export const WALLS: [number, number, number, number][];
  export const SPAWN: { x: number; z: number; h: number }; export const EXIT: { x: number; z: number; r: number };
  export const RENTAL: DistrictData['rental']; export const BOUNDS: DistrictData['bounds'];
  export function roadById(id: string): RoadData;          // throws on unknown
  export function routeFor(eventId: string): Route;        // cached buildRoute(data.pts, data.loop, data.cps); throws on unknown
  export function markerFor(eventId: string): Pt;
  ```

- [ ] **Step 1: Write the failing tests** in `district.test.ts`:
  - `every event in EVENTS has a route and a marker` — for each `EVENTS[i].id`, `routeFor(id).len > 50`, `markerFor(id)` finite.
  - `version is 1 and routes carry only known ids` — `DISTRICT.version === 1`; `Object.keys(DISTRICT.routes)` ⊆ event ids.
  - `checkpoint distances increase and end on the route` — each route: `cps[0] === 0`, strictly increasing, `cps[last] <= len + .01`; non-loop: `cps[last]` within 1 m of `len`.
  - `drag routes are straight and 402 / 805 m` — `routeFor('dr1').len` within 2 of 402, `dr2` within 2 of 805; every point within 0.5 m of the chord.
  - `roads have points and widths; the ring is the wander road` — each road `pts.length >= 2`, `width` in [8, 24]; `roadById(DISTRICT.wander).loop === true`.
  - `spawn, exit and rental are inside bounds` and `walls are finite and inside bounds ± 60`.
  - `start grids clear the walls` — for each non-drag event, the four slots `place(lane, back)` for `[[-3,0],[3,0],[-3,-8],[3,-8]]` from `routePoint(route, 0)` are ≥ 1.5 m from every wall segment (point–segment distance); for drag events, the lanes `[-7.5,-2.5,2.5,7.5]` at the start likewise.
  - `the asset is within budget` — `fs.statSync('public/strip/district.glb').size <= 3_000_000` (path from `import.meta.dirname` or `process.cwd()` — vitest runs from `apps/sim`); `district.json` ≤ 300 kB.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- district` → fails (module not found).
- [ ] **Step 3: Implement `district.ts`** as the Interfaces block says; `import data from './district.json'` typed through `DistrictData` (`satisfies` or a cast).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `strip: typed district data from the Blender export`.

### Task 4: `routes.ts` on polylines, the grid removed

**Files:**
- Modify: `apps/sim/src/world/strip/routes.ts` (rewrite)
- Test: `apps/sim/src/world/strip/routes.test.ts` (rewrite)

**Interfaces:**
- Produces:
  ```ts
  export type Pt = [number, number];                          // re-exported from district.ts
  export type Route = { pts: Pt[]; cum: number[]; len: number; loop: boolean; cps: number[] };
  export function buildRoute(pts: Pt[], loop: boolean, cps?: number[]): Route;  // cps default: loop → [0]; else [0, len]
  export function routePoint(route: Route, s: number): { x: number; z: number; tx: number; tz: number };   // unchanged
  export function routeProgress(route: Route, x: number, z: number, sGuess: number, span?: number): { s: number; d: number }; // unchanged
  export function cpPoint(route: Route, k: number): { x: number; z: number };  // routePoint at cps[k % cps.length]
  export function roadRoute(id: string): Route;               // cached buildRoute of roadById(id)
  export function nearestRoadPoint(x: number, z: number): { x: number; z: number; tx: number; tz: number; road: RoadData; s: number };
  export function snapToRoad(V: Vehicle): void;               // onto nearestRoadPoint, heading along ±tangent (the sign nearer V.h), u=v=w=vx=vz=0, gear 1
  ```
- Removed: `N`, `CELL`, `RW`, `BL`, `SPAN`, `Node`, `blockRect`, `nearestNode`, `nodeNeighbors`, `gridPath`. `buildRoute` no longer cuts corners (the curves are smooth already); it only computes `cum`/`len` and keeps `cps`.

- [ ] **Step 1: Rewrite `routes.test.ts`**:
  - `a square polyline loop is 4 sides long` — `buildRoute([[0,0],[100,0],[100,100],[0,100]], true).len` ≈ 400; `cps` equals `[0]`.
  - `a sprint's default checkpoints are its ends` — `buildRoute([[0,0],[300,0]], false).cps` equals `[0, 300]`.
  - `routePoint wraps on a loop and clamps on a sprint` (as today's test, on the new routes).
  - `routeProgress finds the nearest point near the guess` (as today).
  - `cpPoint k wraps to the start on a loop` — `cpPoint(loop, loop.cps.length)` equals `routePoint(loop, 0)`.
  - `nearestRoadPoint snaps a point beside the ring road onto it` — take `p = routePoint(roadRoute('ring'), 100)`, offset 5 m along the normal, expect the result within 0.5 m of `p` and `road.id === 'ring'`.
  - `snapToRoad stops the car on the road facing along it` — a vehicle beside the ring with `h` roughly along the tangent: after `snapToRoad`, `u === 0`, position within 0.5 m of the road, `|cos(h − atan2(tx,tz))| > .99`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- routes` → fails.
- [ ] **Step 3: Rewrite `routes.ts`** per the Interfaces block (`nearestRoadPoint`: coarse scan of every road's points, then refine on the two adjacent segments by projection).
- [ ] **Step 4: Run** the routes and district tests → PASS. (Other suites still fail until Tasks 5–9: that is expected; `tsc` is not run until Task 9.)
- [ ] **Step 5: Commit** `strip: routes on polylines from the district data; the grid goes`.

### Task 5: `roadGraph.ts`, paths and wandering on the roads

**Files:**
- Create: `apps/sim/src/world/strip/roadGraph.ts`
- Test: `apps/sim/src/world/strip/roadGraph.test.ts`

**Interfaces:**
- Consumes: `ROADS`, `Pt` (Task 3), `nearestRoadPoint` (Task 4).
- Produces:
  ```ts
  export function shortestPath(from: Pt, to: Pt): Pt[];        // along the roads; both ends snapped to the nearest road point; ≥ 2 points, first ≈ from's snap, last ≈ to's snap
  export function wanderFrom(at: Pt, length: number): Pt[];     // a random walk along the roads from the road point nearest `at`, at least `length` m long, carrying straight on at junctions 60 % of the time, never reversing when it can go on
  export function extendWander(path: Pt[], length: number): Pt[]; // continues `path` (its last two points give the direction) by at least `length` m; returns the new path
  export function pointOnRoad(roadId: string, s: number): Pt;  // routePoint of roadRoute(id) at s (wrapped)
  ```
  Graph: a node per road sample point; edges between consecutive points of a road (both ways on a cyclic road's wrap) and between points of different roads within 3 m (junctions). Built once, lazily, from `ROADS`.

- [ ] **Step 1: Write the failing tests**:
  - `the shortest path between two ring points follows the ring` — from `pointOnRoad('ring', 0)` to `pointOnRoad('ring', 300)`: path length within 10 % of 300.
  - `every marker is reachable from the spawn` — for each event id, `shortestPath([SPAWN.x, SPAWN.z], markerFor(id)).length >= 2` and the last point within 3 m of the marker's nearest road point.
  - `a GPS from the grass still finds a road` — from a point 40 m off the ring road: the first point is on a road (nearestRoadPoint distance < 0.5).
  - `wanderFrom stays on the roads and is long enough` — 20 random walks of 400 m from `pointOnRoad('ring', 0)`: total polyline length ≥ 400; every point within 0.5 m of some road.
  - `extendWander keeps going` — `extendWander(wanderFrom(p, 100), 200)` length ≥ 300 and starts with the original path.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement `roadGraph.ts`** (Dijkstra with a binary heap or a simple array for ≤ 5k nodes).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `strip: road graph for the GPS and the wandering traffic`.

### Task 6: `ai.ts`, walls and wandering

**Files:**
- Modify: `apps/sim/src/world/strip/ai.ts`
- Test: `apps/sim/src/world/strip/ai.test.ts` (rewrite the grid tests)

**Interfaces:**
- Consumes: `WALLS`, `BOUNDS`, `Pt` (Task 3), `buildRoute`, `routeProgress`, `routePoint` (Task 4), `wanderFrom`, `extendWander`, `pointOnRoad` (Task 5).
- Produces:
  ```ts
  export type AI = { ...as today, path: Pt[] | null, ... };
  export function setWander(A: AI, at: Pt): void;             // path = wanderFrom(at, 400), route = buildRoute(path, false), placed on it in its lane
  export function collideWalls(V: Vehicle, walls?: [number, number, number, number][]): number;  // replaces collideBlocks; same two circles (r .98 at ±1.25), push-out, 1.3 bounce, .92 damping, yaw kick, syncBody; returns the impact
  ```
  `stepAI` extends the wander when `A.s > A.route.len - 60` with `extendWander(A.path.slice(-3), 400)` and re-finds `A.s`. Everything else in `stepAI`, `separateAIs`, `collideCar`, `parkAI`, `makeAI` is unchanged. A module-level spatial hash (40 m cells) over the walls is built on first use (and per `walls` argument identity, so tests may pass their own).

- [ ] **Step 1: Rewrite the failing tests**:
  - `a wandering AI advances along the ring road` — `setWander(A, pointOnRoad('ring', 0))`, step 5 s at 60 Hz: `A.s` grew by > 20, `|v| > 5`, the AI is within 8 m of some road (`nearestRoadPoint` distance).
  - `a long wander keeps extending without stalling` — 120 s: `A.s` keeps increasing and `A.route.len` ≥ 400 after.
  - `collideWalls pushes a car out of a wall and bounces it` — with `walls = [[0, -50, 0, 50]]`, a car at x = 0.5, heading along z, `vx = -10`: `hit > 0`, `V.x > .98 - 1e-6` and `V.vx > 0`.
  - `no hit on open tarmac` — same wall, car at x = 20: `collideWalls === 0`.
  - `the park is fenced` — a car 10 m outside `BOUNDS` on each side moving outward: `collideWalls(V)` (default `WALLS`) > 0 on at least the side it crosses, i.e. put the car exactly on `BOUNDS.minX - 0.5` etc. and expect a hit from the fence 50 m out: place it at the fence instead: `x = BOUNDS.minX - 50 + .5`. Assert hit > 0.
  - `collideCar` test unchanged.
- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `strip: the AI wanders the roads and the car collides with walls`.

### Task 7: Events, HUD, garage and payout on the new routes; event names

**Files:**
- Modify: `apps/sim/src/world/data.ts:101-116` (`EventDef`, `EVENTS`), `apps/sim/src/world/strip/events.ts`, `apps/sim/src/world/hud.ts:145-146`, `apps/sim/src/world/garage.ts:85`, `apps/sim/src/world/payout.ts:33-39`
- Test: `apps/sim/src/world/strip/events.test.ts`, `apps/sim/src/world/payout.test.ts`, `apps/sim/src/world/data.test.ts`, `apps/sim/src/world/garage.test.ts`, `apps/sim/src/world/hud.test.ts` (whatever referenced `nodes`/`CELL`)

**Interfaces:**
- Consumes: `routeFor`, `markerFor` (Task 3), `Route.cps`, `cpPoint`, `snapToRoad`, `routePoint`, `routeProgress` (Task 4), `setWander(A, Pt)`, `pointOnRoad` (Tasks 5–6).
- Produces:
  - `EventDef = { id; type; name; loop?; laps?; prize; rep; stage; noTraffic? }` (no `nodes`). New names: sp1 *Paddock Sprint*, ci1 *Park GP*, sx1 *Bowl Party*, dr1 *Quarter Mile*, df1 *Bowl Drift*, sp2 *Ring Run*, ci2 *Grand Circuit*, dr2 *Half Mile*, df2 *Long Bowl Drift*, sx2 *Long Bowl X*, sp3 *Park Dash*.
  - `EventFx.placeCp(p: { x: number; z: number } | null)` (was a `Node`).
  - `EventRunner.start` gets its route from `routeFor(ev.id)`; the checkpoint test becomes `const nCp = r.cps.length; const cpS = a.pCp < nCp ? a.pLap * r.len + r.cps[a.pCp] : (a.pLap + 1) * r.len;` with the same branch structure as today (`nN` → `nCp`); `placeCpMark` passes `cpPoint(r, a.pCp % nCp)`; `cleanup` re-wanders parked traffic with `setWander(A, pointOnRoad(DISTRICT.wander, Math.random() * roadRoute(DISTRICT.wander).len))`; `quit` calls the new `snapToRoad`.
  - `hud.ts`: `const k = a.pCp % a.route.cps.length; const p = cpPoint(a.route, k); tx = p.x; tz = p.z;` and the GPS branch reads `s.gps.target[0]`, `s.gps.target[1]` (the `Gps` type changes in Task 9: `{ label: string; target: Pt; path: Pt[] }` — define it in `scene.ts` and import the type; hud compiles once Task 9 lands).
  - `garage.ts` `lenOf` and `payout.ts` `eventDistance` use `routeFor(ev.id).len`.

- [ ] **Step 1: Update the tests**: `events.test.ts` — `runner()` wanders its AIs with `setWander(A, pointOnRoad('ring', i * 100))`; `teleportToEnd` hops along `routeFor(ev.id)` and ends at `cpPoint(route, route.cps.length - 1)`; add `a circuit counts three laps through its checkpoints` (ci1: hop around the loop three times at 20 m, expect `state === 'done'` and `results().pos >= 1`) and `a drag finishes at its length` (teleport to `route.len` along the drag's direction). `payout.test.ts`: `eventDistance(ci1) === routeFor('ci1').len * 3` and `raceFloor(dr1)` ≈ 402 / 50. `data.test.ts`: every event has a name and no `nodes` key.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- events payout data garage hud` → fails.
- [ ] **Step 3: Implement** the changes listed in Interfaces.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `strip: events, HUD, garage and payout read the park's routes; park names`.

### Task 8: `park.ts`, the scene (daylight, data roads, glb), rental lot and gate from the data

**Files:**
- Create: `apps/sim/src/world/strip/park.ts`; Delete: `apps/sim/src/world/strip/city.ts`, `city.test.ts`
- Modify: `apps/sim/src/world/rental.ts:14-16`, `apps/sim/src/scene/world/gate.ts:17`, `apps/sim/src/scene/world/rentalLot.ts`
- Test: `apps/sim/src/world/strip/park.test.ts`, `apps/sim/src/world/rental.test.ts` (if it reads the constants), `apps/sim/src/scene/world/rentalLot.test.ts` (create if none)

**Interfaces:**
- Consumes: `ROADS`, `EXIT`, `RENTAL`, `BOUNDS`, `markerFor` (Task 3), `roadRoute` (Task 4); `EVENTS`, `EV_COL` (data).
- Produces:
  ```ts
  export type StripMarker = { ev: EventDef; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh };   // world units, as today
  export type Park = { scene: THREE.Scene; markers: StripMarker[]; cpMark: THREE.Group; modelReady: Promise<void>; dispose(): void };
  export type ParkOpts = { loadModel?: (url: string) => Promise<THREE.Object3D>; modelUrl?: string };
  export function buildPark(opts?: ParkOpts): Park;
  export const SKY = 0x9fc5ee; export const ACCENT = '#ffd23f'; export const TUBE_BLUE = '#79a6ff'; export const CHROME = '#f3f6fb';
  export function radialTexture(): THREE.CanvasTexture | null;   // moved from city.ts unchanged
  export function roadRibbons(): THREE.BufferGeometry;            // every road as a flat ribbon at its width, y .01 m, world units (merged)
  ```
  `buildPark`: `scene.background = SKY`, `FogExp2(SKY, .0009 / W)`, `HemisphereLight(0xcfe3ff, 0x7a8a5a, .9 * Math.PI)`, `DirectionalLight(0xfff1dc, 2.4)` at (200, 300, 100) × W, `castShadow = false`; a `PlaneGeometry` ground 3,000 × 3,000 m at y 0 (grass 0x5e7a3a, `MeshStandardMaterial` roughness .95) named `ground`; a `Mesh(roadRibbons(), MeshStandardMaterial 0x2c2f35 roughness .7)` named `roads`; markers (ring + beam, exactly as `buildCity` made them) at `markerFor(ev.id)`; `cpMark` as today. Then, when `opts.loadModel` is given or `typeof document !== 'undefined'`, call the loader (default: `new GLTFLoader().loadAsync(url)` from `three-stdlib`, url default `import.meta.env.BASE_URL + 'strip/district.glb'`, read via a small `modelUrl` default so tests never touch `import.meta.env`), scale the root by `W`, set `matrixAutoUpdate = false` and `updateMatrix()` on it, add it as `model`, and hide the `roads` ribbon mesh; on rejection `console.warn('strip park model', err)` and keep the ribbons. `modelReady` resolves in both cases (and at once when no loader runs). `dispose` frees every geometry, material and texture it made and traverses the model to dispose its geometries and materials.
  - `rental.ts`: `export const RENTAL_BAY = RENTAL.bay; export const RENTAL_CAM = RENTAL.cam; export const RENTAL_KIOSK = RENTAL.kiosk;` (`RENTAL_BLOCK` removed; `rentalLot.ts`'s own `RENTAL_KIOSK` goes, it imports this one). `rentalLot.ts`: the slab becomes 40 × 30 m centred 6 m behind the bay (along −heading); kiosk at `RENTAL_KIOSK`; no `CELL`/`BL`/`RW`. The canopy spot light stays.
  - `gate.ts`: `export const STRIP_EXIT = { x: EXIT.x, z: EXIT.z, r: EXIT.r };`.

- [ ] **Step 1: Write the failing tests** `park.test.ts` (node): `buildPark places one marker per event at markerFor in world units`; `the roads ribbon covers every road` (bounding box of `roads` geometry ⊇ `BOUNDS` × W within 20 m); `a failing model load leaves the park usable` (`buildPark({ loadModel: () => Promise.reject(new Error('offline')) })`: `await modelReady` resolves, `scene.getObjectByName('roads')!.visible === true`, no throw); `a loaded model hides the ribbons and is scaled to world units` (`loadModel: async () => new THREE.Group()` → after `modelReady`, `getObjectByName('model')!.scale.x === W`, ribbons hidden); `dispose frees every geometry and material` (as `city.test.ts` did, by spying on `dispose`). `rentalLot.test.ts`: `buildRentalLot().group` has a child whose world position is within 1 m × W of `RENTAL_KIOSK`.
- [ ] **Step 2: Run** → fails. **Step 3: Implement**, delete `city.ts` and `city.test.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `strip: the park scene in daylight, roads from data, the model from glb; rental lot and gate from the data`.

### Task 9: `StripScene` on the park; the minimal main-scene and copy edits

**Files:**
- Modify: `apps/sim/src/world/strip/scene.ts`, `apps/sim/src/VanillaThreeScene.tsx` (imports only: `STRIP_SPAWN`, `snapToRoad`, `routePoint` keep their names; nothing else changes), `apps/sim/src/i18n.tsx:52`, `apps/sim/src/strip/StripEntry.tsx` (only if it says "night")
- Test: `apps/sim/src/world/strip/scene.test.ts`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  ```ts
  export const STRIP_SPAWN = SPAWN;                                 // { x, z, h } metres
  export type Gps = { label: string; target: Pt; path: Pt[] };
  export function ribbon(path: Pt[], width: number, y: number): THREE.BufferGeometry;   // metres in, world units out (as today, without × CELL)
  ```
  `load()`: `buildPark({ })` (the renderer env map as today, but `makeEnv` becomes a daylight env: sky 0x9fc5ee above, ground 0x5e7a3a below, a sun box); the rental lot added; `spawnTraffic`/`spawnRivals` use `setWander(A, pointOnRoad(DISTRICT.wander, Math.random() * len))`; `placeCp(p)` positions `cpMark` at `p.x * W, 0, p.z * W`; `setGps(ev)`: `path = shortestPath([PV.x, PV.z], markerFor(ev.id))`, `target = markerFor(ev.id)`, the ribbon drawn from `path`; the GPS clears within 14 m of `target`; `mapItems` carry `target` instead of `node`; `drawMapInto` frames `BOUNDS` (with 40 m margin) into w × h, fills the background 0x5e7a3a-ish dark map colour `#1b2a1b`, strokes every road in `ROADS` with `lineWidth = width` in `rgba(200,205,215,.8)`, then markers, the hot route (`routeFor(ev.id).pts`), the GPS path, rivals and the player exactly as today. Everything else unchanged.
  - `i18n.tsx` `setup.placeStripDesc`: en `Six kinds of race at the race park behind the Speedway gate. Playable today.`, es `Seis tipos de carrera en el parque de carreras tras la puerta del Speedway. Ya se puede jugar.`

- [ ] **Step 1: Update `scene.test.ts`**: the existing tests keep their intent with the new data (`STRIP_SPAWN` from the data; markers at `markerFor`; the lobby camera at `RENTAL_CAM`); add `setGps draws a ribbon along the roads to the marker` (`S.enter(PV, car)`, `S.setGps(EVENTS[0])`: `S.gpsTarget!.path.length >= 2`, a mesh named by `renderOrder === 1` exists) and `the map draws without a DOM` (a stub 2D context object recording calls; `drawMapInto(ctx, 300, 300)` calls `stroke` at least `ROADS.length` times).
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test` → the scene suite fails.
- [ ] **Step 3: Implement** `scene.ts`; edit `i18n.tsx`; check `StripEntry.tsx` for "night"/"noche" and change to park wording if present.
- [ ] **Step 4: Run** `pnpm --filter @micar/sim test` → all PASS; `pnpm --filter @micar/sim exec tsc --noEmit` → clean (this is the first point the whole tree compiles; fix any leftover `nodes`/`CELL` reference it finds, in the file that owns it).
- [ ] **Step 5: Commit** `strip: StripScene on the race park; GPS and map on the roads; park copy`.

### Task 10: Build, smoke, browser verification at phone width, PR

Done by the main session.

**Files:**
- Modify (if needed): `apps/sim/e2e/strip.smoke.mjs`

- [ ] **Step 1:** `pnpm --filter @micar/sim build`, `pnpm --filter @micar/value test`, `pnpm site` (with `C:\Program Files\Git\bin` on the path) → all pass; note the Strip chunk sizes.
- [ ] **Step 2:** start the game server (`pnpm --filter @micar/sim run server`, port 3000) and vite (`pnpm --filter @micar/sim exec vite --port <free>`) with `preview_start` entries in `.claude/launch.json`; open the sim, enter the Strip through the gate; `read_console_messages` has no errors; screenshot the paddock.
- [ ] **Step 3:** at `resize_window` mobile (375 px): race one event of each type to the results card with a prize (use the pause menu's quick race if present, else drive to the markers; `window.__micar.place` for positioning), an outrun on the ring road, open the map, set a GPS, respawn with R onto a road, return through the exit gate. Note the frame time (sample `requestAnimationFrame` over 2 s via `javascript_tool`) on Low.
- [ ] **Step 4:** run the e2e smoke as its header says (production build on port 3123, `SMOKE=1`); fix the smoke if it depends on grid coordinates.
- [ ] **Step 5:** whole-branch review (subagent-driven-development's final review); fix findings; re-run tests and `tsc`.
- [ ] **Step 6:** push `strip-tracks`, open the PR in the browser pane (description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), bind it with the PR tools, read CI; do not merge.
