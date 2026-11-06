# The Strip as a race park: Blender-modelled venues — design

The Strip is today a procedural 8×8 night grid city (Night Tuner's `buildCity`): its streets are the tracks, races are lists of grid intersections, collisions are the blocks. Driving around corners of 90 m blocks at right angles is the part the user calls terrible, after the driving feel itself (a sister branch). This phase replaces the grid city with a **daytime race park**: three purpose-built venues joined by a ring road around a paddock, modelled in Blender and loaded as one glTF asset. The race types, the eleven events, the career stages, the rental lot, the gate, the outruns, the server-paid prizes and the stamps all stay; only the ground they race on changes.

## What the player sees

1. Through the Speedway gate (or `/strip`) the player arrives at the **paddock**: a sunlit tarmac apron with the rental lot and its kiosk, the exit gate ring back to town, pit garages along one side, a MiCar sign. The light is day: a blue sky, a sun, haze in the distance, no neon.
2. A two-lane **ring road** (about 1.5 km) leaves the paddock and loops past the three venues and back. Traffic cars and the three rivals wander it; outruns and near misses work as before. The world map (M) shows the roads and the markers; the GPS ribbon routes along the roads.
3. **Three venues** off the ring road, each with its event markers at its start line:
   - **The road circuit** (about 2.4 km, 12 m wide, ten corners of varied radius, a pit straight with a grandstand, kerbs, run-off and tyre barriers). Hosts the circuits (Four Block Loop → *Park GP*, Downtown GP → *Grand Circuit*), and the sprints as point-to-point runs that start on the ring road and finish on the circuit (*Harbor Run*, *Crosstown*, *Grid Dash* get park names).
   - **The stadium** (a tight course of about 550 m inside a bowl of barriers and bleachers, a figure-eight-like layout with a hairpin, a sweeper and a chicane). Hosts street X (*Block Party*, *Tight Eight*) and drift (*Warehouse Drift*, *Switchback Drift*); the stage-2 and stage-3 layouts use more of the bowl.
   - **The drag strip** (a 20 m wide, 1,000 m straight with a Christmas tree, lane lines, a quarter-mile and a half-mile gantry, grandstands on both sides and a run-off). Hosts *Quarter Mile* (402 m) and *Half Mile* (805 m).
4. Racing is as today: drive into a marker, Enter, a countdown, checkpoints shown by the mark and the HUD arrow, laps, results, the server pays. Hitting a barrier bounces as hitting a block did. R or the respawn button puts the car back on the nearest road.
5. Phones: the park loads in a few seconds on 4G and keeps the frame rate the grid city had on Low. While the model downloads, the ground, the roads' markings and the markers are already there (built from the data), so a race can start before the scenery arrives.

Names: event **ids, prizes, REP, stages, laps and types do not change**, so wins and best times saved under those ids still apply; only the display names move from city to park (English and Spanish where the UI shows them).

## Decisions

1. **Blender is the source of truth; the game gets two exports.** The `.blend` holds the visual meshes *and* the race data as named curves, meshes and empties. One export script writes `district.glb` (the scenery) and `district.json` (routes, checkpoints, roads, walls, spawn points). The game and the server read the JSON; nothing in the game derives race data from the mesh. This is the "Blender first" pipeline the user chose over data-first.
2. **Flat.** The physics has x, z and heading only, and the driving model is being reworked on another branch, so the venues stay at ground level. Elevation and banking are out of scope.
3. **One asset, one district.** Paddock, ring road and the three venues are one glTF file under 3 MB (Draco-free, so no decoder to ship), vertex colours and a few small textures, merged by material into a few dozen draw calls. A second district later is a second `.blend` and JSON behind the same gate.
4. **The grid goes away entirely.** `N`, `CELL`, the block rectangles, grid paths and node routes are removed, not kept beside the new data. Every consumer (routes, AI wander, collisions, GPS, map, HUD arrow, garage event list, server distance check, rental lot, exit gate, spawn) reads the district data.
5. **Daytime.** The chosen look is a professional track-day complex. The Strip scene gets a sky, a sun light with the existing shadow setting, a hemisphere fill and distance haze; the night sign and lamp pools of the city are gone. The town stays as it is.
6. **Checkpoints are the route curve's control points**, exactly as grid nodes were: the first is the start/finish, the rest are passed in order; a loop route's lap closes at the first. This keeps `EventRunner` logic the same shape.
7. **Collision is wall segments**, not block rectangles: every barrier, kerb edge the car must not cross, pit wall and stadium bowl is an edge in the `Walls` meshes, exported as 2D segments and tested with the same two-circle car model, push-out and bounce as today. Roads and run-off have no walls, so going off the track costs time, not a crash.
8. **No change to the driving model.** `physics.ts`, `driver.ts`, `input.ts`, `cameras.ts` are not touched. `VanillaThreeScene.tsx` changes only where it names grid things (the spawn constant and the respawn's `snapToRoad`), to keep the merge with the driving-feel branch clean.

## The Blender file

`apps/sim/assets/strip/district.blend`, metres, Z up (Blender's default; the glTF exporter turns it into Y up). Game coordinates: **x = Blender x, z = −Blender y, y = Blender z**, the mapping glTF export applies, so the JSON exporter applies the same one and the model and the data line up without a correction in the game. The game multiplies both by `WORLD_PER_M` (2) when it draws.

Collections:

- `Track` — exported to the glb: tarmac, kerbs, run-off, grass, barriers, grandstands, pit garages, the kiosk's slab, signs, light poles, trees, the drag tree and gantries, the stadium bowl. Low poly (target under 150k triangles in all), materials by vertex colour plus a tiling asphalt texture and a small kerb stripe texture; objects joined per material before export.
- `Data` — never exported to the glb, read by the JSON exporter:
  - `route.<eventId>` — one curve per event (`sp1`, `ci1`, …, eleven in all): poly or Bezier, `cyclic` for loop events, the control points being the checkpoints in order, the first the start/finish, direction the direction of travel. A sprint's curve starts on the ring road and ends on the circuit. A drag's curve has two control points on the strip's centreline, start and finish, and the exporter checks it is straight.
  - `road.<name>` — the drivable roads' centrelines (the ring road, the venue access roads, the paddock lanes, the circuit and the stadium course as roads too, so the map draws them and the player can be snapped onto them); custom property `width` in metres; `cyclic` where it loops. `road.ring` is the ring road, the one traffic and rivals wander.
  - `wall.<name>` — meshes whose **edges** are the collision segments; only edges with both ends within 1 m of the ground are taken (so a barrier's top edges do not double them).
  - Empties: `spawn` (the arrival point, its rotation about Z the heading), `exit` (the gate ring, `radius` property), `rental.bay` (the car's spot, heading from rotation), `rental.cam` (the lobby camera, its height from the empty's z), `marker.<eventId>` optional (where the event's ring sits; default: the route's first point).

The visual meshes are built with a helper script, `tools/blender/build_strip.py`, which sweeps the road curves into tarmac with kerbs and lays out the repeatable props (barriers along walls, grandstand rows, poles), after which the scene is dressed by hand. It is a convenience for authoring, committed so the file can be rebuilt; the `.blend` remains what is exported.

### The exporter

`tools/blender/export_strip.py`, run inside Blender (through the MCP connection, or headless: `blender -b apps/sim/assets/strip/district.blend -P tools/blender/export_strip.py`). It:

1. Exports the `Track` collection to `apps/sim/public/strip/district.glb` (binary glTF, Y up, +Y up, no Draco, no animations, no cameras or lights, materials with vertex colours and textures embedded, geometry merged by the exporter where possible).
2. Walks `Data` and writes `apps/sim/src/world/strip/district.json`:
   - `routes[id]`: `pts` (the curve sampled at ≤ 2 m, Bezier evaluated; metres, 2 decimals), `loop`, `cps` (the distance along the route of each control point, `cps[0] = 0`, strictly increasing, in metres).
   - `roads[]`: `{ id, pts, loop, width }`, sampled the same way.
   - `wander`: `"ring"` (the road id traffic and rivals follow).
   - `walls[]`: `[x1, z1, x2, z2]`, world transform applied.
   - `spawn: {x, z, h}`, `exit: {x, z, r}`, `rental: { bay: {x, z, h}, cam: {x, y, z} }`, `markers[id]: [x, z]`.
   - `bounds: {minX, minZ, maxX, maxZ}` from the roads, for the map.
3. Fails loudly when an event id in `EVENTS` has no route (the ids are listed in the script to match `data.ts`), a drag route is not straight within 0.5 m, a `cps` is not increasing, or any value is not finite.

Both exports are committed. The JSON is about 100–200 kB; it is imported statically (`resolveJsonModule`) by the client and the server alike.

## Code

### Data (`apps/sim/src/world/strip/`)

- `district.ts` (new, pure): imports `district.json`, types it (`DistrictData`), and exposes `DISTRICT`, `routeFor(eventId): Route`, `roadById(id)`, `ROADS`, `WALLS`, `SPAWN`, `EXIT`, `RENTAL`, `markerFor(eventId)`. One place to swap for another district later.
- `routes.ts`: `Route` becomes `{ pts, cum, len, loop, cps: number[] }` (the `nodes`/`nodeS` pair becomes `cps`, the distance of each checkpoint). `buildRoute(pts, loop, cps?)` takes a polyline (no grid, no corner cutting; the curves are already smooth). `routePoint`, `routeProgress` are unchanged. New: `nearestRoadPoint(x, z)` (the closest point on any road, with its tangent), `snapToRoad(V)` uses it, `cpPoint(route, k)`. Removed: `N`, `CELL`, `RW`, `BL`, `SPAN`, `blockRect`, `nearestNode`, `nodeNeighbors`, `gridPath`.
- `roadGraph.ts` (new, pure): the roads as a graph for the GPS and for wandering. Nodes are road sample points; junctions are road points within 3 m of another road's point. `shortestPath(from: {x,z}, to: {x,z}): [x, z][]`, `wanderFrom(point, length)` (random walk along roads preferring to carry straight on, the same taste as today's `wanderPath`).
- `ai.ts`: `collideBlocks` becomes `collideWalls(V)` against the wall segments through a 40 m spatial hash built once from `WALLS` (same two circles of 0.98 m at ±1.25 m, same push-out, 1.3 bounce and yaw kick); `setWander(A, at)` takes a point and uses `wanderFrom`; `stepAI`'s route extension does the same. `collideCar`, `separateAIs`, `stepAI`'s speed planning are unchanged.
- `events.ts`: checkpoint passing reads `route.cps` (`cpS = pLap * len + cps[pCp]`), `placeCp` passes a point `{x, z}`; the drag uses the route's start and direction as now; `quit` snaps to the nearest road. Drag lanes stay `DRAG_LANES`, the strip is 20 m wide to fit them.
- `data.ts`: `EventDef` drops `nodes`; the eleven entries keep id, type, laps, loop, prize, rep, stage, `noTraffic`, with new names. `EV_NAME`, `EV_COL`, `prizeFor` unchanged.
- `hud.ts` (line 145): the checkpoint arrow targets `cpPoint(a.route, k)`.
- `garage.ts`: event length from `routeFor(ev.id).len`.
- `payout.ts`: `eventDistance` from `routeFor`; `VMAX` floors unchanged (the server still refuses impossible times).
- `rental.ts`: `RENTAL_BAY`, `RENTAL_CAM` read from `DISTRICT.rental`; `RENTAL_BLOCK` removed. `gate.ts`: `STRIP_EXIT` from `DISTRICT.exit`. `scene.ts`: `STRIP_SPAWN` from `DISTRICT.spawn`.

### Scene (`apps/sim/src/world/strip/`)

- `city.ts` becomes `district.ts`'s sibling `park.ts` (`buildPark(opts)`), the city builder is deleted. It makes the Strip's `THREE.Scene`: sky colour and `FogExp2` haze, a `DirectionalLight` sun (shadow-casting when the quality setting allows, like the town's) and a `HemisphereLight`; a large ground plane (grass colour) under everything; **from the data**, immediately: road surfaces as flat ribbons from `ROADS` with their widths (so the roads exist before the model arrives), the event markers' rings and beams at `markerFor`, the checkpoint mark; then it **loads** `/strip/district.glb` with `GLTFLoader` from `three-stdlib`, scales the root by `WORLD_PER_M`, sets `matrixAutoUpdate = false` on the statics, enables shadows per the quality setting, and swaps the ribbons' material to a transparent "under the model" state (or removes them) when the model is in. `park.ready` is true at once (data), `park.modelReady` is a promise. In tests (node, no DOM, no fetch) the loader is not called.
- `scene.ts` (`StripScene`): `load()` calls `buildPark`; the rental lot (`buildRentalLot`) places itself from `DISTRICT.rental`; traffic and rivals spawn with `setWander` at random points of `road.ring`; `setGps(ev)` uses `shortestPath` from the car to the marker and draws the same ribbon; `drawMapInto` draws `ROADS` as stroked polylines (width-scaled), the markers, the hot route, the GPS path, the cars and the player, framed by `bounds`; `promptText`, `pressEnter`, events, outruns, the lobby camera are unchanged in behaviour.
- `rentalLot.ts`: the slab, canopy and kiosk are placed around `RENTAL_BAY` and the kiosk offset rather than on a grid block; otherwise unchanged.
- `VanillaThreeScene.tsx`: `STRIP_SPAWN` and `snapToRoad` keep their names and signatures, so the imports stand; `GATE_RETURN` is untouched (town side). No other edit.
- `i18n.tsx`: the Strip's description line ("night city") becomes "race park" in English and Spanish; `StripEntry` copy likewise if it says night.
- Environment map: `makeEnv` becomes a daylight one (sky above, ground below, a sun spot) so car paint reflects day.

### Assets and loading

- `apps/sim/public/strip/district.glb` served statically by Vite and Express as today's `public/` is. Fetched once per session when the Strip is first entered or the lobby opens; the loader's progress is not shown (the roads and markers already are).
- Budget (checked by a test that reads the committed file): glb ≤ 3 MB, JSON ≤ 300 kB. In the browser: ≤ 60 draw calls for the park, ≤ 150k triangles, textures ≤ 1024² (three at most).

### Server

`server.ts` imports `payout.ts`, which imports `routes.ts` and `district.ts`, so the server reads the same JSON and `eventDistance`, `raceFloor` and `validateFinish` work unchanged. Nothing else on the server knows the grid.

## Testing

- Unit (vitest, node): `district.test.ts` (every `EVENTS` id has a route; every route's `cps` is increasing and ends under `len`; drag routes are straight and 402/805 m ± 2; roads have ≥ 2 points and a width; walls are finite; spawn, exit and rental are inside `bounds`; the glb file exists and is ≤ 3 MB). `routes.test.ts` (polyline routes, `routePoint`/`routeProgress` on a loop and a sprint, `nearestRoadPoint`, `snapToRoad`). `roadGraph.test.ts` (shortest path between two ring points, a path from the paddock to each marker exists, `wanderFrom` stays on roads). `ai.test.ts` (`collideWalls` pushes a car out of a wall and bounces it, no hit on open tarmac). `events.test.ts` (a circuit's three laps count checkpoints through `cps`; a drag finishes at `len`; a sprint finishes at its last checkpoint). `scene.test.ts` (the Strip builds in node without the loader; the map draws; traffic wanders on the ring). `payout.test.ts` (`eventDistance` for the new routes; floors). Existing tests referring to `nodes`, `CELL`, `blockRect` are rewritten.
- Exporter: the committed JSON is regenerated from the `.blend` in CI-free fashion (a documented manual step); a test asserts the JSON's `version` and the event ids match `data.ts`, so a stale export fails the build.
- Browser (the pane, phone width 375 px and desktop): enter the Strip, see the park, race one event of each type to results with a prize, an outrun on the ring road, the map and GPS, respawn onto a road, return through the gate. Frame rate on Low read from the HUD's counter if present, else from a `requestAnimationFrame` sample.
- `pnpm --filter @micar/sim test`, `exec tsc --noEmit`, `build`, `pnpm --filter @micar/value test`, `pnpm site`; the e2e smoke (`e2e/strip.smoke.mjs`) updated where it places the car by grid coordinates.

## Out of scope

Elevation and banking; a night variant of the park; new race types; changes to prizes, stages or the driving model; multiplayer ghosts; Draco or KTX compression; a second district. The grid city is removed, not kept as an option.
