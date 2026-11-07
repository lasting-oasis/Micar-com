# Strip driving feel: distinct cars, car feedback, phone controls, readable races — design

Nov 6, 2026. Branch `strip-driving-feel`, cut from `strip-tracks` (the ten-circuit track library; see `2026-11-06-strip-track-library-design.md`). Decided with the owner after measuring the World against the Night Tuner artifact (`https://claude.ai/artifact/DjCwiLhqMwci3xZtFotoBY`).

## What was measured

The World's `world/physics.ts` is the artifact's `04-physics.js` ported verbatim, stepped at the same fixed 1/120 s. A scripted run of the Ronin coupe gives the same numbers in both: 0–100 km/h in 6.8 s, the same gear points, the same yaw rate in a corner (grip-limited at 17°/s at 121 km/h). So the driving model is not what feels wrong. What differs, and what the owner named:

1. **Every car feels the same.** The three rentals are near-identical (Civet 8.5 s, Ronin 6.4 s, Tsubasa 6.2 s to 100 km/h: the "Tsubasa" rental is the Ronin chassis with a different torque shape, not the artifact's AWD car). Real town cars are scaled to their horsepower only, so a Corvette and a Camry differ less than they should.
2. **The car gives no feedback.** The artifact leans the body in corners, dips it under braking and launch, and overspins the rear wheels on wheelspin. The World's car stays rigid. The chase camera's yaw follows the heading, so a slide does not show.
3. **Phone controls.** The phone drives with the walking D-pad (▲ over ◀ ▼ ▶: gas and steer under one thumb). The artifact has ◀ ▶ under the left thumb and GAS / BRAKE / E-BRK / NOS under the right. The tach sits on the car.
4. **The races did not read** on the grid city. The track library replaces the grid with real circuits; what remains is guidance: where the route goes, where the next gate is, who you race.
5. **Choppy on phones.** The World renders at the device pixel ratio up to 2 with the town's scene graph alive behind the Strip.

## Scope

Four pieces, one branch, one PR, built in this order: cars, feedback, phone, races. The physics step (`stepVehicle`, `engineStep`) is not changed; `carParams` gains one grip multiplier read from the spec (1b). The town drives the same car, so pieces 1–3 apply in the town too; piece 4 is the Strip's.

Out of scope: slope forces (the circuits are flat), new car bodies, online races, Garage changes beyond what the new specs show in its stat bars.

## 1. Cars that feel different

### 1a. The rental fleet is the artifact's lot

`world/rental.ts` `RENTAL_FLEET` becomes five cars, each carrying the artifact's spec record verbatim (`world/data.ts` keeps them as `FLEET_SPECS`, keyed by rental key; `CARS` already holds the five records):

| key | make / model | body (lofted style) | artifact spec | price per event |
|---|---|---|---|---|
| civet | Civet R | hatchback | FWD 1180 kg, 186 Nm, 7200 rpm | $300 |
| kanjo | Kanjo S | hatchback | FWD 1020 kg, 170 Nm, 8100 rpm | $400 |
| ronin | Ronin GT | coupe | RWD 1340 kg, 258 Nm, 7300 rpm | $500 |
| tsubasa | Tsubasa R4 | sedan | AWD 1540 kg, 310 Nm, 7000 rpm | $700 |
| brute | Brute 440 | sports | RWD 1720 kg, 440 Nm, 6200 rpm | $900 |

- `RentalKey` becomes the five keys; `RENTAL_PRICE` goes, replaced by `priceOf(key)`; `rent()` charges the car's price and `canRent(player, key)` checks it (the counter shows every car with its price, a guest with the $500 stake can take the first three; the reason strings stay).
- `specFor(car)` returns the fleet spec when `car.rental` names a fleet car (matched by make and model), before the real-car path.
- `carSpecs.ts` gains the five as `MODEL_SPECS` entries so the car panel's spec line ("2.0L I4 · 157 hp · 0–60 7.9s") shows them; the numbers are what `simStats` gives for the record (hp from the torque curve, 0–60 from the 0–100 time less 0.3 s), rounded, checked by a test to within 10 %.
- The counter copy gains a one-line character per car (English and Spanish), the artifact's: "Front-drive hatch. Light, forgiving, understeers when pushed." and so on.
- The server's rent handler and the e2e smoke use the new keys (`coupe` → `ronin`).

### 1b. Real cars fitted to their 0–60 and top speed

`specFor` for a car with a known `MODEL_SPECS` record (unchanged: `STYLE_SPECS` fallbacks keep the archetype) now:

1. takes the style archetype's chassis and gears;
2. sets mass from the curb weight and the drive from the record (4WD → AWD);
3. bisects a torque multiplier so `simStats(...).t100` lands on `zeroToSixty + 0.3` s (0–100 km/h is 0–62 mph) within 2 %;
4. bisects a final-drive multiplier in [0.6, 1.6] so `simStats(...).top` lands on the record's top speed in km/h within 3 % (if the two fights, the 0–60 fit wins: it is run last);
5. sets the redline by engine string: contains "Hybrid" → 6000, "V8" → 6200, "Turbo" → 6500, otherwise the archetype's.

Chassis by body style (multipliers on the archetype's `h` and on grip, applied in `carParams` through a new optional `spec.gripMul`, default 1): sports 1.06 grip, coupe 1.02, sedan and hatchback 1.0, suv 0.94 and `h` .58, van 0.92 and `h` .60, truck 0.90 and `h` .62. `carParams` multiplies `mu` by `spec.gripMul ?? 1`; nothing else in physics changes.

Tests (`data.test.ts`): Corvette t100 < 4.0 s and top > 280 km/h; Camry t100 in [7.4, 8.4]; F-150 in [6.0, 7.2]; Prius > 9.5; every fleet car's t100 differs from every other's by ≥ 0.5 s; fleet records equal the artifact's constants.

## 2. Feedback on the car

New module `world/carFeel.ts` (pure math, no THREE) and its scene adapter in `scene/carModel.ts` / `VanillaThreeScene.tsx`.

- **Tilt node.** `buildCarModel` wraps the body, trim, glass, far meshes, halos and smoke in a `tilt` group (`parts.tilt`); the wheel instanced mesh and the pivots stay on the car group so `syncCarWheels` is unchanged. `attachParts` adds its root to `parts.tilt` when present. Traffic and racers are untouched (their tilt stays at rest).
- **Roll and pitch** (`feelStep(V, dt, F)` on a `Feel` state `{ roll, pitch, lift }`): targets are the artifact's: roll = `u·w·.012` + hydraulics lean `H.l·.6`, pitch = `−ax·.01` + `(H.f − H.r)·.45`, lift = `(H.f + H.r)/2`; eased at 6/s; roll clamped to ±0.08 rad and pitch to ±0.06 rad. The driven car's `tilt.rotation` and `tilt.position.y` follow.
- **Wheels.** Rear wheels roll at `u·(1 + 1.5·spinR)`, fronts at `u·(1 + 1.5·spinF)` (the artifact spun the rears; FWD cars spin their fronts).
- **Tire smoke.** `smokeLevel(V)` = max(spinR, spinF, handbrake sliding, |beta| > .17 at speed > 8 m/s) in 0..1. A small `THREE.Points` emitter per driven axle (48 particles, grey, additive-free alpha, 0.9 s life, rising and growing) at the tyre contact points, emission rate `level × 40/s`. Off at level 0. Shared material; disposed with the car.
- **Skid marks.** `skidLevel(V)` = handbrake, or spin, or |beta| > .2 at speed > 6. A ring buffer of 400 dark quads (`SkidMarks` in `scene/skidMarks.ts`, one mesh per district scene, y 0.045) laid at each rear tyre's contact point every 0.4 m travelled while skidding; the oldest quad is reused; alpha fades with age. Cleared on leaving a district.
- **Camera.** `ChaseCamera` follows a yaw target of `h + clamp(beta, −.6, .6)·.5` instead of `h`, so a sliding car rotates in frame while the camera looks along the slide; everything else as the artifact (4.2/s ease, 6 m back, 2 m up, FOV 62 + speed, nitrous +8, crash shake).
- **Lights** as now (brake, reverse). Audio as now.

Tests (`carFeel.test.ts`): roll sign follows the turn direction and saturates at the clamp; pitch is negative under braking (`ax < 0` gives a nose-down pitch) and settles to 0 in under 1 s; `smokeLevel` is 0 driving straight at grip and 1 with the handbrake at speed; `skidLevel` triggers on a 0.25 rad slip at 10 m/s.

## 3. Phone

### 3a. Two-thumb driving layout

`world/DriveLayer.tsx` draws, whenever `driving` is true and the layout is the phone's (App's `isMobile` test), the artifact's layout, and App hides its `TouchDPad` while driving (`useDriveUi.driving`):

- Left cluster, bottom-left: `◀` `▶` (`data-k` left, right), 68 px round buttons, 10 px apart.
- Right cluster, bottom-right, a 2-column grid: row 1 `▼ GEAR` `▲ GEAR` (only when gears are shown: manual or a drag), row 2 `NOS` `E-BRK`, row 3 `BRAKE` `GAS` (`data-k` dn, up, nos, hb, brk, thr).
- `InputMap.attach` already wires every `[data-k]` with pointer capture; the buttons get `touch-action: none` and no selection. Several can be held at once (one pointer per button).
- The pause, reset and map tap buttons move to the right edge above the cluster; the minimap sits top-left under the cash; the tach is 56 px and sits above the right cluster. Nothing is drawn over the car.
- Keyboard and gamepad are unchanged. The town's driving uses the same layout; walking keeps the D-pad.

### 3b. The HUD's top inset

`HudState` gains `topInset` (px): the height of App's car panel plus its margin when it is shown (DriveLayer measures it with a ref), else 0. The GPS / checkpoint arrow and its label draw below `ty + topInset`. The desktop layout is otherwise unchanged.

### 3c. Phone render

In the Strip, on a touch device, the renderer's pixel ratio is capped at 1.5 (set on entering the Strip, restored on leaving; the Low quality setting still means 1). The town's scene is not updated while the Strip is the district (its `lightPool`, `atmosphere` and `updateCars` calls already skip; this spec adds nothing there but checks it in the browser).

Tests (`input.test.ts`): a `build()` with touch `thr` and `left` held gives `fwd 1, steer −1`; `up` raises a `shiftUp` edge once; `hud.test.ts`: the arrow's y respects `topInset`.

## 4. Readable races (the Strip)

- **Route ribbon.** From the countdown to the finish, a translucent accent ribbon (2 m wide, y 0.06, additive, the existing `roadRibbons`-style geometry) runs along the whole event route (a loop draws the lap). Built in `park.ts` from the route's points (`routeRibbon(route)`), added by `StripScene.startEvent`, removed in `cleanup`. Drags draw the four lanes' edges instead.
- **Checkpoint gates.** The checkpoint mark becomes an arch: two 6 m posts at the track edges (the zone's road width at that point, from `nearestRoadPoint`) and a lit beam across, oriented by the route tangent at `cps[k]`, in the accent colour, with the ground ring kept. `placeCp` gets the tangent along with the point (`placeCp(p, t)`).
- **Racers in tuner cars.** `spawnRacerMesh` picks a `coupe` or `sports` body (never a van, SUV or truck), with its kit as now.
- **Countdown flyover.** During `count` (3 s) the camera starts 28 m above and 40 m behind the start line looking down the first 150 m of the route and eases into the chase position by GO (`ChaseCamera.preview(route, t01)`; `reset` at GO). It runs on every start, restarts included: it is the countdown.
- **Arrow and label** clear of the car panel (3b); "Wrong way" and lap banners as now.

Tests (`park.test.ts`): `routeRibbon` of a 100 m straight has 2 quads per sample and a bounding box of the route; `scene.test.ts`: a started event adds the ribbon and removes it on cleanup; the gate's rotation equals the tangent at the checkpoint; `cameras.test.ts`: `preview` at t = 0 is above the start and at t = 1 equals the chase position.

## Files

- Modify: `apps/sim/src/world/rental.ts`, `world/data.ts` (`FLEET_SPECS`, `specFor`, `gripMul`), `world/physics.ts` (one line: `mu *= spec.gripMul ?? 1`; `VehicleSpec.gripMul?`), `carSpecs.ts`, `server.ts` (rent price), `apps/sim/e2e/strip.smoke.mjs` (rental key), `world/DriveLayer.tsx`, `App.tsx` (D-pad hidden while driving), `world/hud.ts` (`topInset`, tach size), `world/cameras.ts` (slip yaw, `preview`), `world/input.ts` (none expected), `scene/carModel.ts` (tilt), `world/parts.ts` (root under tilt), `world/strip/park.ts` (ribbon, gate), `world/strip/scene.ts` (ribbon lifecycle, gate placement, racer bodies), `world/strip/events.ts` (`placeCp(p, t)`), `VanillaThreeScene.tsx` (feel adapter, smoke, skids, pixel ratio, flyover hook), `i18n.tsx` (fleet copy).
- Create: `apps/sim/src/world/carFeel.ts` (+ test), `apps/sim/src/scene/skidMarks.ts`, `apps/sim/src/scene/tireSmoke.ts`.

## Verification

- `pnpm --filter @micar/sim test`, `exec tsc --noEmit`, `build`; `pnpm --filter @micar/value test`; `pnpm site`.
- Browser (the production build on its own port, as the track-library session found two Vite dev servers clash): rent each of the five cars and launch each on the Monza drag (five distinct runs by time); a Camry and a Corvette from a town account on the same drag; corners on Monaco with the body leaning and the camera lagging the slide; smoke and skid marks on a handbrake turn in the hub; a circuit race to results with the ribbon and gates; the flyover; at 375 px: the two-thumb layout, gas and steer held together, the tach clear of the car; frame-time sample on Spa at 375 px.
- The Garage: a tire or suspension part changes the stat bars and the car's grip (a Civet with Pro tires corners faster on the same bend).
