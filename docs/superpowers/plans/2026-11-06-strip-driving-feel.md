# Strip Driving Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Strip's cars feel different from each other and alive (lean, dip, wheelspin, smoke, skids, a camera that shows a slide), give phones two-thumb driving controls, and make races on the track library read (route ribbon, gates, flyover), without touching the physics step.

**Architecture:** Pure modules first (`data.ts` specs, `carFeel.ts`), then scene adapters (a tilt node on the lofted car model, smoke and skid meshes, camera changes), then the DOM layer (DriveLayer touch layout, HUD inset), then the Strip's event visuals (`park.ts`, `scene.ts`). Everything in metres in physics space, world units (`WORLD_PER_M` = 2) in THREE, as the codebase does.

**Tech Stack:** TypeScript, React 18, three 0.160.1, zustand, vitest (node: no canvas, so lofted bodies are mocked in tests as `scene.test.ts` does), socket.io server (`apps/sim/server.ts`, tsx), pnpm 10.

**Spec:** `docs/superpowers/specs/2026-11-06-strip-driving-feel-design.md`

## Global Constraints

- Branch `strip-driving-feel` in worktree `C:\Users\Owner\Micar-com-strip-feel` (cut from `strip-tracks`); never `main`; never merge.
- `apps/sim/src/world/physics.ts`: `stepVehicle` and `engineStep` unchanged; the only edit is `carParams` reading `spec.gripMul ?? 1` (Task 3).
- No dependency upgrades or additions.
- Copy in English and Spanish (`apps/sim/src/i18n.tsx`); phones first; secrets only in Render or GitHub settings.
- Commits authored as `lasting-oasis <blueoceanlegacies@gmail.com>` (repo config), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Every shell command: prepend `C:\Users\Owner\.fnm\node-versions\v22.23.4\installation` to PATH, set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. Tests: `pnpm --filter @micar/sim test -- <pattern>`; types: `pnpm --filter @micar/sim exec tsc --noEmit`.
- Two Vite dev servers clash (HMR port); browser checks use the production build: `pnpm --filter @micar/sim build` then `NODE_ENV=production SMOKE=1 PORT=3123 pnpm --filter @micar/sim start`.

## Review Focus

1. An old client renting with a key that no longer exists (`coupe`) must be refused with "That car is not for rent.", not crash the server (Task 1 test).
2. A guest with the $500 stake asking for the Brute ($900) must get "Not enough money" and keep the $500 (Task 1 test).
3. A real car whose 0–60 the archetype cannot reach within the bisection bounds (a 2.5 s car on a van chassis) must still return finite torque and a finite final drive, clamped at the bounds, never NaN (Task 3 test).
4. `feelStep` with `dt = 0` (a halted frame) or a `V.ax` that is NaN after a reset must leave the tilt unchanged and finite (Task 4 test).
5. A touch button whose pointer is cancelled (a system gesture mid-press) must not stay held: `pointercancel` and `lostpointercapture` release it, and `releaseAll` on blur clears every touch (Task 8 test).

---

### Task 1: The rental fleet is the artifact's five cars

**Files:**
- Modify: `apps/sim/src/world/rental.ts`, `apps/sim/src/world/rental.test.ts`, `apps/sim/server.ts:1376-1392` (the `rent_car` handler), `apps/sim/src/world/DriveLayer.tsx` (`Counter`), `apps/sim/src/i18n.tsx`, `apps/sim/e2e/strip.smoke.mjs:117-119`.

**Interfaces:**
- Produces: `export type RentalKey = 'civet' | 'kanjo' | 'ronin' | 'tsubasa' | 'brute'`; `RENTAL_FLEET: ReadonlyArray<{ key: RentalKey; make: string; model: string; color: string; bodyStyle: 'hatchback' | 'coupe' | 'sedan' | 'sports'; price: number; blurb: string }>` with make/model `Civet R` (hatchback, $300, `#ffd23f`), `Kanjo S` (hatchback, $400, `#f3f6fb`), `Ronin GT` (coupe, $500, `#2a9df4`), `Tsubasa R4` (sedan, $700, `#e8463c`), `Brute 440` (sports, $900, `#0c0c0e`); `blurb` is the i18n key `strip.car.<key>`; `priceOf(key: RentalKey): number`; `canRent(player, key?: RentalKey)` (no key: the cheapest car); `rent(player, key, now)` charges `priceOf(key)` and sets `bodyStyle` from the fleet entry (the key is no longer a body style); `GUEST_STAKE` stays 500; `RENTAL_PRICE` is removed.

- [ ] **Step 1: Rewrite `rental.test.ts`**: `RENTAL_FLEET.map(f => f.key)` equals the five keys in order and `priceOf('civet') === 300`, `priceOf('brute') === 900`; `canRent(player(500), 'brute')` → `{ ok: false, reason: 'Not enough money' }` and the player still has 500; `canRent(player(500), 'ronin')` → ok; `canRent(player(299))` → not enough (cheapest is 300); a held rental refuses; `rent(player(500), 'ronin', t)` debits 500 and the car has `make 'Ronin'`, `model 'GT'`, `bodyStyle 'coupe'`, `rental true`, `district 'strip'`; keep the existing `returnRental`/`isVisitor` cases.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- rental` → FAIL.
- [ ] **Step 3: Implement** `rental.ts` as the Interfaces block says. `server.ts` `rent_car`: `if (!RENTAL_FLEET.some(f => f.key === key)) { deny('That car is not for rent.'); return; }` stays; `canRent(player, key)` gets the key. `Counter` in `DriveLayer.tsx`: each row shows `f.make f.model`, the blurb (`t(lang, f.blurb)`) and `t(lang, 'strip.oneEvent').replace('{price}', money(f.price))`; a row is disabled when `canRent(me, f.key)` fails; the reason line shows the cheapest car's reason as before. `i18n.tsx`: five `strip.car.<key>` keys, en/es, the artifact's lines: civet "Front-drive hatch. Light, forgiving, understeers when pushed." / "Hatchback de tracción delantera. Ligero, noble, subvira si lo apuras."; kanjo "Tiny high-revving front-driver. Lives above 6,000 rpm." / "Pequeño, de tracción delantera y muchas vueltas. Vive por encima de 6.000 rpm."; ronin "Rear-drive coupe. Balanced, and happy sideways." / "Cupé de propulsión. Equilibrado, y feliz de lado."; tsubasa "All-wheel-drive sedan. Launches hard, grips everywhere." / "Sedán de tracción total. Sale disparado y agarra en todas partes."; brute "Big-block muscle. Torque for days, needs a careful right foot." / "Muscle car de bloque grande. Par de sobra; pide un pie derecho cuidadoso." Smoke: `rent('coupe')` → `rent('ronin')` (still $500 → $0).
- [ ] **Step 4: Run** `pnpm --filter @micar/sim test -- rental` → PASS; `pnpm --filter @micar/sim exec tsc --noEmit` clean (fix every `RentalKey`/`RENTAL_PRICE` use it reports, including `types.ts` if it names the keys).
- [ ] **Step 5: Commit** `strip: the rental fleet is the artifact's five cars, priced by the car`.

### Task 2: Fleet specs drive the fleet; the car panel shows them

**Files:**
- Modify: `apps/sim/src/world/data.ts` (`FLEET_SPECS`, `specFor`), `apps/sim/src/world/data.test.ts`, `apps/sim/src/carSpecs.ts` (`MODEL_SPECS`), `apps/sim/src/carSpecs.test.ts` (create if absent).

**Interfaces:**
- Consumes: `RentalKey`, `RENTAL_FLEET` (Task 1); `CARS` in `data.ts` (the five artifact records, already there).
- Produces: `export const FLEET_SPECS: Record<RentalKey, VehicleSpec>` (civet → `CARS.civet`, kanjo → `CARS.kanjo`, ronin → `CARS.ronin`, tsubasa → `CARS.tsubasa`, brute → `CARS.brute`, cloned, `name` set to the fleet make + model); `specFor(car: { make?; model?; bodyStyle?; rental? })` returns the fleet spec when `car.rental` is true and make + model match a fleet entry, before the real-car path.

- [ ] **Step 1: Tests** in `data.test.ts`: `specFor({ make: 'Brute', model: '440', bodyStyle: 'sports', rental: true })` has `mass 1720`, `drive 'RWD'`, `redline 6200`; the five fleet specs' `t100` (from `simStats(carParams(spec, STOCK_CFG.perf, TUNE_DEF))`) differ pairwise by ≥ 0.5 s; `specFor({ make: 'Brute', model: '440', bodyStyle: 'sports' })` (no `rental`) falls to the archetype path. In `carSpecs.test.ts`: for each fleet entry `getCarSpec({ make, model }).hp` is within 10 % of `simStats(...).hp` and `zeroToSixty` within 10 % of `t100 − 0.3`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- data carSpecs` → FAIL.
- [ ] **Step 3: Implement.** `MODEL_SPECS` gains `'Civet R'`, `'Kanjo S'`, `'Ronin GT'`, `'Tsubasa R4'`, `'Brute 440'` with engine strings `'2.0L I4'`, `'1.6L I4'`, `'3.0L V6'`, `'2.5L Turbo I4'`, `'7.2L V8'`, hp and 0–60 rounded from `simStats` (run it once in a scratch script and paste the numbers: hp to the unit, 0–60 to 0.1 s, top speed in mph to the unit, weight = mass / 0.4536 rounded to 10), drive from the record.
- [ ] **Step 4: Run** the two tests → PASS. `tsc` clean.
- [ ] **Step 5: Commit** `strip: fleet cars drive on the artifact's specs; the car panel shows them`.

### Task 3: Real cars fitted to 0–60 and top speed; grip by body style

**Files:**
- Modify: `apps/sim/src/world/data.ts` (`specFor`, `STYLE_CHASSIS`), `apps/sim/src/world/physics.ts:48-64` (`carParams`: `mu` × `spec.gripMul ?? 1`; `VehicleSpec` gains `gripMul?: number`), `apps/sim/src/world/data.test.ts`, `apps/sim/src/world/physics.test.ts`.

**Interfaces:**
- Produces: `export const STYLE_CHASSIS: Record<BodyStyle, { gripMul: number; h?: number }>` = sports 1.06, coupe 1.02, sedan 1.0, hatchback 1.0, suv `{ gripMul: .94, h: .58 }`, van `{ .92, .60 }`, truck `{ .90, .62 }`; `fitSpec(base: VehicleSpec, real: CarSpec): VehicleSpec` (exported for tests): mass, drive, redline by engine string ("Hybrid" → 6000, "V8" → 6200, "Turbo" → 6500, else base), then final-drive multiplier bisected in [0.6, 1.6] (14 iterations) so `simStats().top` ≈ `topSpeedMph × 1.609`, then torque multiplier bisected in [0.1, 8] (14 iterations) so `simStats().t100` ≈ `zeroToSixty + 0.3`; `specFor` uses it for known models and applies `STYLE_CHASSIS[style]` to every non-fleet spec.

- [ ] **Step 1: Tests** (`data.test.ts`): Corvette `t100 < 4.0` and `top > 280`; Camry `t100` in [7.4, 8.4] and `top` in [205, 230]; F-150 `t100` in [6.0, 7.2]; Prius `t100 > 9.5`; `specFor({ bodyStyle: 'truck', make: 'Zork', model: 'Blat' }).gripMul === .9` and `.h === .62`; a synthetic record `{ engine: 'V8', hp: 900, weightLb: 4500, zeroToSixty: 1.5, topSpeedMph: 400, drive: 'AWD' }` on the van archetype gives finite `tq` and `fin` (the Review Focus case). Replace the old "scales to horsepower" Mustang assertion with `t100` in [4.3, 5.0]. (`physics.test.ts`): `carParams({ ...ronin, gripMul: .9 }, STOCK_PERF, TUNE_DEF).mu` equals `.9 ×` the plain value.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- data physics` → FAIL.
- [ ] **Step 3: Implement** `fitSpec`, `STYLE_CHASSIS`, the `carParams` line.
- [ ] **Step 4: Run** → PASS; `tsc` clean; `pnpm --filter @micar/sim test` whole suite green (the garage stat-bar tests may assert old hp values: update numbers, not logic).
- [ ] **Step 5: Commit** `strip: real cars fitted to their 0-60 and top speed; grip and ride by body style`.

### Task 4: `carFeel.ts` (pure)

**Files:**
- Create: `apps/sim/src/world/carFeel.ts`, `apps/sim/src/world/carFeel.test.ts`.

**Interfaces:**
- Produces: `export type Feel = { roll: number; pitch: number; lift: number }`; `export const freshFeel = (): Feel`; `export function feelStep(V: Vehicle, dt: number, F: Feel): Feel` (targets roll = `clamp(V.u * V.w * .012 + V.hyd.l * .6, −.08, .08)`, pitch = `clamp(−V.ax * .01 + (V.hyd.f − V.hyd.r) * .45, −.06, .06)`, lift = `(V.hyd.f + V.hyd.r) / 2`, each eased by `min(1, dt * 6)`; non-finite inputs or `dt <= 0` leave F unchanged); `export function wheelRollRate(V: Vehicle, front: boolean): number` = `V.u * (1 + 1.5 * (front ? V.spinF : V.spinR))`; `export function smokeLevel(V: Vehicle): number` in 0..1 = max of `V.spinR`, `V.spinF`, `V.hand && |V.u| > 3 ? 1 : 0`, `|V.beta| > .17 && |V.u| > 8 ? min(1, (|V.beta| − .17) / .25) : 0`; `export function skidLevel(V: Vehicle): number` = max of `V.hand && |V.u| > 3`, `max(V.spinF, V.spinR) > .5`, `|V.beta| > .2 && |V.u| > 6` as 0/1.

- [ ] **Step 1: Tests**: a left turn (`u 20, w .8`) gives roll > 0 after 1 s of 1/60 steps and the clamp holds for `w 5`; `ax −8` gives pitch < 0 and pitch returns within 0.02 rad of 0 one second after `ax 0`; `dt 0` and `ax NaN` leave F equal and finite; `smokeLevel` 0 at `u 20` straight with no spin, 1 with `hand true, u 15`; `skidLevel` 1 at `beta .25, u 10`, 0 at `beta .1`; `wheelRollRate` rear = `u × 2.5` at `spinR 1`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- carFeel` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `world: carFeel — roll, pitch, wheel overspin, smoke and skid levels from the vehicle state`.

### Task 5: The tilt node and the camera's slip yaw

**Files:**
- Modify: `apps/sim/src/scene/carModel.ts:289-351` (`buildCarModel`, `CarParts`), `apps/sim/src/world/parts.ts:243-256` (`attachParts` root parent), `apps/sim/src/world/cameras.ts`, `apps/sim/src/world/cameras.test.ts`, `apps/sim/src/world/strip/scene.test.ts` (the carModel mock gains `tilt`).

**Interfaces:**
- Produces: `CarParts.tilt: THREE.Group` (child of the car group; parent of `body`, `trim`, `glass`, `farBody`, `farTrim`, `halos`, `smoke`; `wheelMesh` and the pivots stay on the group); `buildCarModel` returns `tilt` too; `attachParts` adds its `root` to `modelOf(car)?.tilt ?? car`; `ChaseCamera.update` eases `yaw` toward `PV.h + clamp(PV.beta, −.6, .6) * .5` (hood mode unchanged).

- [ ] **Step 1: Tests** (`cameras.test.ts`): a car with `beta .4` (set `V.v` so that `atan2(v, u)` ≈ .4 at `u 20`, then `V.beta = .4`) settles with `C.yaw` ≈ `h + .2` (±.01); the existing four cases still pass (beta 0). (`parts.test.ts`): a group with `userData.car = { body, tilt }` where `tilt` holds `body` gets the kit root under `tilt`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- cameras parts scene` → FAIL. **Step 3: Implement**; `CAR_LIFT` is applied to the tilt group's children as before (the tilt group itself at y 0). **Step 4: Run** → PASS; `tsc` clean.
- [ ] **Step 5: Commit** `world: a tilt node on the lofted car; the chase camera lags a slide`.

### Task 6: Smoke, skid marks, and the feel adapter in the scene

**Files:**
- Create: `apps/sim/src/scene/tireSmoke.ts`, `apps/sim/src/scene/skidMarks.ts`, `apps/sim/src/scene/skidMarks.test.ts`.
- Modify: `apps/sim/src/VanillaThreeScene.tsx:1012-1022` (the "car follows the physics" block) and the `enterStrip`/`exitStrip`/`endDriving` paths.

**Interfaces:**
- Consumes: Task 4 functions; `CarParts.tilt` (Task 5); `anchorsFor(style)` (`wheelX`, `axles`, `wheelR`, world units).
- Produces: `export class TireSmoke { constructor(parent: THREE.Object3D, points: THREE.Vector3[]) ; update(dt: number, level: number): void; dispose(): void }` (48 particles per point, grey, `0.9 s` life, rise `1.2 W/s`, grow ×3, emission `level × 40/s`); `export class SkidMarks { constructor(scene: THREE.Scene, max = 400); lay(x: number, z: number, h: number, alpha: number): void /* world units; a 0.3 × 0.6 W quad at y .045 W oriented by h */; fade(dt: number): void; clear(): void; dispose(): void; readonly count: number }`; the scene keeps `feel: Feel`, one `TireSmoke` per driven car (points at the two rear tyre contacts, plus the fronts for FWD), one `SkidMarks` per district scene; per frame after `D.pose()`: `feelStep`, `tilt.rotation.set(pitch, 0, roll)`, `tilt.position.y = lift * W`, rear/front wheels `rotateX(−wheelRollRate(V, front) * W / wheelR * simDt)`, `smoke.update(simDt, smokeLevel(V))`, and when `skidLevel(V) > 0` and the car moved ≥ 0.4 m since the last mark, `lay` at each rear tyre with alpha `.55`.

- [ ] **Step 1: Tests** (`skidMarks.test.ts`, three without a renderer): `lay` 401 times leaves `count` 400 and the geometry's draw range at 400 quads; `fade(10)` makes every alpha 0; `clear()` resets `count` to 0.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the two classes and the adapter; the SkidMarks of a district is cleared when the car leaves it. **Step 4: Run** → PASS; `tsc` clean.
- [ ] **Step 5: Browser check** (production build, desktop): a handbrake turn in the hub shows smoke and leaves marks; cornering on Monaco leans the body; braking dips the nose. Screenshot.
- [ ] **Step 6: Commit** `world: body lean and dip, wheel overspin, tire smoke and skid marks on the driven car`.

### Task 7: Two-thumb phone layout and the HUD inset

**Files:**
- Modify: `apps/sim/src/world/DriveLayer.tsx` (the `[data-k]` block and the tap buttons), `apps/sim/src/App.tsx:2149-2150` (D-pad only when not driving: `!useDriveUi(s => s.driving)`), `apps/sim/src/world/hud.ts` (`HudState.topInset?: number`; the arrow and label y add it; `small` tach radius 56), `apps/sim/src/world/hud.test.ts`, `apps/sim/src/VanillaThreeScene.tsx` (passes `topInset` from `useDriveUi`).
- Modify: `apps/sim/src/world/driveUi.ts` (`topInset: number`, written by DriveLayer from a `ResizeObserver` on App's car panel: `document.querySelector('[data-car-panel]')`; App marks its driving panel with `data-car-panel`).

**Interfaces:**
- Produces: DriveLayer draws, when `touch && driving && !results`: left cluster (`fixed left-4 bottom-6`): `Btn k="left" "◀"`, `Btn k="right" "▶"` (68 px, `gap-2.5`); right cluster (`fixed right-4 bottom-6`, a 2-column grid, `gap-2.5`): row 1 `dn "▼ Gear"`, `up "▲ Gear"` (hidden unless `gears`), row 2 `nos "NOS"`, `hb "E-brk"`, row 3 `brk "Brake"`, `thr "Gas"`; the pause/reset/map/GPS tap buttons `fixed right-4 bottom-[248px]` as a column.

- [ ] **Step 1: Tests** (`hud.test.ts`): with `gps` set and `topInset 80`, the GPS label's y (capture `fillText` args) is ≥ 80 px lower than with `topInset 0`; (`input.test.ts`): `setTouch('thr', true); setTouch('left', true)` → `fwd 1, steer −1`; `setTouch('up', true)` twice raises `shiftUp` once per press after `clearEdges`; `releaseAll()` clears `touch.thr`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- hud input` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `tsc` clean.
- [ ] **Step 5: Browser check** at 375 × 812 (production build; the pane's mobile preset): gas and ◀ held together drive a turning car; the tach, cash and minimap sit clear of the car; the D-pad is gone while driving and back on foot. Screenshot.
- [ ] **Step 6: Commit** `world: two-thumb driving controls on phones; the HUD clears the car panel`.

### Task 8: Phone render cap in the Strip

**Files:**
- Modify: `apps/sim/src/VanillaThreeScene.tsx` (`pixelRatioFor` gains the district: `district === 'strip' && touchUi ? Math.min(1.5, base) : base`; called on `enterStrip`, `exitStrip` and the quality change).

- [ ] **Step 1: Implement** (no unit test: the renderer is browser-only). **Step 2: Browser check**: on the mobile preset, `renderer.getPixelRatio()` (expose through `window.__micar.pixelRatio()`) reads ≤ 1.5 in the Strip and the device ratio in the town. **Step 3: `tsc` clean. Commit** `world: the Strip renders at a pixel ratio of at most 1.5 on phones`.

### Task 9: Route ribbon, checkpoint gates, racers in tuner cars

**Files:**
- Modify: `apps/sim/src/world/strip/park.ts` (`routeRibbon`, `gateMeshes`), `apps/sim/src/world/strip/park.test.ts`, `apps/sim/src/world/strip/events.ts` (`EventFx.placeCp(p: { x; z } | null, tangent?: { tx; tz })`; `placeCpMark` passes `routePoint(r, r.cps[k])`'s tangent), `apps/sim/src/world/strip/scene.ts` (`startEvent` adds the ribbon, `cleanup` path removes it; `placeCp` orients the gate; `spawnRacerMesh` picks `'coupe' | 'sports'`), `apps/sim/src/world/strip/scene.test.ts`, `apps/sim/src/world/strip/events.test.ts`.

**Interfaces:**
- Produces: `export function routeRibbon(route: Route, width = 2): THREE.Mesh` (accent `#ffd23f`, opacity .35, additive, `depthWrite false`, y `.06 W`, `renderOrder 1`, built like `roadRibbons`; a drag route gets four 0.3 m lane-edge strips at `DRAG_LANES ± 2` instead); `export function gateMeshes(width: number): THREE.Group` (two posts `.3 × 6 × .3 m` at `±width/2`, a beam `width × .4 × .3 m` at 6 m, `MeshBasicMaterial` accent, plus the existing ground ring); `StripScene.placeCp(p, t)` sets `cpMark.position` and `cpMark.rotation.y = atan2(t.tx, t.tz)` and rebuilds the gate at the zone road's width (`nearestRoadPoint(p.x, p.z, zoneRoads(zone)).road.width`).

- [ ] **Step 1: Tests**: (`park.test.ts`) `routeRibbon(buildRoute([[0,0],[100,0]], false))` has a bounding box x from 0 to 100 W and 2 vertices per sample; (`scene.test.ts`) after `startEvent` on a loaded event the scene has an object named `routeRibbon`, and none after `runner.cleanup()`; after the countdown the gate's `rotation.y` equals `atan2(tx, tz)` of the route at `cps[1]` (±.01); every racer mesh's `userData.strip.style` is `coupe` or `sports`; (`events.test.ts`) the `placeCp` stub receives a tangent with `hypot(tx, tz) ≈ 1`.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test -- park scene events` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `tsc` clean.
- [ ] **Step 5: Commit** `strip: a route ribbon and checkpoint gates on the track; racers in coupes and sports cars`.

### Task 10: The countdown flyover

**Files:**
- Modify: `apps/sim/src/world/cameras.ts` (`preview(route: Route, t01: number): void`), `apps/sim/src/world/cameras.test.ts`, `apps/sim/src/VanillaThreeScene.tsx` (`onEventStart` records the start time; while `strip.runner.active?.state === 'count'` the frame calls `chase.preview(route, (3.6 − a.t) / 3)` instead of `chase.update`; at `race` it calls `chase.reset(V)` once).

**Interfaces:**
- Produces: `ChaseCamera.preview(route, t01)`: at `t01 = 0` the camera is at `start − fwd × 40 + up × 28` (metres × W) looking at `routePoint(route, 150)`; at `t01 = 1` it equals the chase position and look-at for the car at the start (`PV` given to `reset`); in between, position and look-at are smoothstep-blended; `fov` eases to 62.

- [ ] **Step 1: Test**: `preview` at 0 has `position.y ≈ 28 W` and at 1 equals the position `reset` gave (±.01 W). **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `tsc` clean.
- [ ] **Step 5: Commit** `strip: the countdown flies over the first corner, then drops into the chase camera`.

### Task 11: Build, smoke, browser verification, PR

- [ ] **Step 1:** `pnpm --filter @micar/sim test`, `pnpm --filter @micar/sim exec tsc --noEmit`, `pnpm --filter @micar/sim build`, `pnpm --filter @micar/value test`, `pnpm site` → all green (paste the tails).
- [ ] **Step 2:** Production run on 3123; drive, as the spec's Verification lists: the five rentals on `royal_drag` (five distinct times), a town Camry and Corvette on it, Monaco corners (lean, slip camera), hub handbrake (smoke, marks), one circuit race to results (ribbon, gates, flyover, payout), the phone preset layout, a Spa frame-time sample at 375 px; the Garage's tires change the stat bars and the car.
- [ ] **Step 3:** Push `strip-driving-feel`; open the PR against `main` in the browser pane (signed in as `lasting-oasis`), noting it carries `strip-tracks` until that merges; description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; wait for CI.
