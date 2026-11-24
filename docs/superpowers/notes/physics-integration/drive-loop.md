# Drive loop map: how the car is driven every frame, outside races

Scope: `apps/sim/src/world/{physics,driver,input,sticks,units,driveUi}.ts`, `world/{TouchSticks,DriveLayer}.tsx`,
`VanillaThreeScene.tsx` (the driving parts) and `world/strip/scene.ts`. Paths below are relative to `apps/sim/src/`.
`VTS` = `VanillaThreeScene.tsx`. Everything here was read from the code; the three test files
(`world/driver.test.ts`, `world/input.test.ts`, `world/sticks.test.ts`) were run and pass (29 tests), and the
steering sign was checked by running the old model once (section 3.1).
Two statements are from reading only and are marked "(by reading, no test)" or "(by reading; ...)".

## 1. One-screen summary

- One `Driver` (world/driver.ts:31) exists while a car is driven. It owns one `Vehicle` object, `driver.V`, made by
  `makeVehicle(carParams(spec, cfg.perf, tune))` (driver.ts:39). Everything else in the game reads and writes that
  same object by reference.
- Each render frame `driveFrame` (VTS:1082) builds one `Input`, then calls `driver.stepFrame(delta, I, opts)`
  (VTS:1171), which runs 0 to 6 fixed sub-steps of 1/120 s. Each sub-step is: map input, cut throttle if the tank is
  empty, `stepVehicle`, burn fuel, collide.
- The only call into the old dynamics from the drive loop is `stepVehicle(V, J, STEP, opts.drift)` at driver.ts:62.
  The only constructors are `makeVehicle(carParams(...))` at driver.ts:39 and `carParams` at driver.ts:45 (rebuild),
  plus a placeholder vehicle at world/strip/scene.ts:141.
- Collisions, the Strip's event runner, respawn and the Garage write `Vehicle` fields directly, between sub-steps.

## 2. Units and coordinates

| Thing | Convention | Where |
|---|---|---|
| Physics units | SI: metres, seconds, kg, radians, N, N·m | world/units.ts:1 |
| Scene units | world units = metres × `WORLD_PER_M` (= 2) | world/units.ts:2 |
| Ground plane | x/z, y up. The model has no height: `pose().y` is always 0 | driver.ts:77 |
| Heading `h` | radians, `h = 0` faces **+Z**; forward = `(sin h, cos h)` | driver.ts:3, physics.ts:169-170 |
| `h` increasing | turns **left** (toward +X from +Z; counter-clockwise seen from above) | physics.ts:168 with 133 |
| Driver's right at `h = 0` | **−X** (three.js is right-handed, y up) | derived; matches cameras.ts:31-34 |
| `h` range | never wrapped by `stepVehicle` (`V.h += V.w * dt`); the camera wraps the difference itself (cameras.ts:55) | physics.ts:168 |
| Body frame | `u` forward m/s (negative in reverse), `v` lateral m/s, **positive = left**, `w` yaw rate rad/s, **positive = left** | physics.ts:165, 170 |
| World velocity | `vx = u·sin h + v·cos h`, `vz = u·cos h − v·sin h` | physics.ts:170 |
| Inverse (`syncBody`) | `u = vx·sin h + vz·cos h`, `v = vx·cos h − vz·sin h` | physics.ts:174 |
| Mesh transform | `position = (x·W, 0, z·W)`, `rotation.y = h + π` (lofted bodies face −Z) | driver.ts:75-79, VTS:1183 |
| Scene → physics | `x = worldX / W`, `z = worldZ / W`, `h = rotY − π` | VTS:932, 860, 1241 |
| `(x, z)` reference point | the mesh origin = the car's middle. Collision circles sit ±1.25 m along the heading from it | driver.ts:82, 95 |

Constants in mixed units (easy to confuse):

| Constant | Units | Where |
|---|---|---|
| `STRIP_SPAWN` `{x:0, z:30, h:3.1416}`, `RENTAL_BAY` `{x:-70, z:30, h:3.1416}` | metres, `h` | strip/scene.ts:45, world/rental.ts:20 |
| `STRIP_EXIT` (`isOnExit(V.x, V.z)`) | metres | scene/world/gate.ts:17, 103; VTS:1149 |
| `GATE_RETURN` `{x, z, rotY}` | **world units**, scene `rotY` | scene/world/gateSpot.ts:7; VTS:860 divides by W and subtracts π |
| `gate.isOnGate(mesh.position.x, mesh.position.z)` | world units | VTS:1155 |
| `staticCollisionBoxes` (`THREE.Box3[]`) | world units; `townCollider` divides by W | VTS:145, driver.ts:99 |
| `TOP = 1.6` (overhead box cut-off) | **world units**, compared with `box.min.y` | driver.ts:84, 98 |
| `OFFS = ±1.25`, `R = .98` | metres | driver.ts:82 |

## 3. The old model's types as the drive loop uses them (world/physics.ts)

### 3.1 `Input` (physics.ts:35-38), exact meaning

| Field | Range | Meaning | Read at |
|---|---|---|---|
| `fwd` | 0..1 | the "up" pedal. Forward gears: throttle. `gear === -1`: **brake** | physics.ts:84-85 |
| `back` | 0..1 | the "down" pedal. Forward gears: brake. Held alone for 0.25 s with `u < 0.8` it selects reverse (`gear = -1`) and becomes the throttle | physics.ts:85 |
| `steer` | −1..+1 | **+1 = right, −1 = left** (driver's and screen's right). The model negates it: `const tgt = -I.steer` | physics.ts:133 |
| `nos` | bool, held | nitrous; fires only with `V.nos > 0 && thr > .1 && gear > 0 && shift <= 0` | physics.ts:107 |
| `hb` | bool, held | hand brake (rear axle locked) | physics.ts:148 |
| `manual` | bool | manual gearbox; automatic when false | physics.ts:88-94 |
| `shiftUp`, `shiftDn` | bool, one-shot | gear edges, honoured only when `manual` | physics.ts:89-90 |
| `hyd` | bool | hydraulics mode (H held and the car has the kit) | physics.ts:123 |
| `hydF`, `hydR`, `hydL`, `hydRt` | bool | raw up / down / left / right keys, used only when `hyd` | physics.ts:123 |
| `hop` | bool, one-shot | hydraulic hop | physics.ts:124 |

Both pedals can be 1 at once. `NO_INPUT` (physics.ts:79) is a shared constant: the frame passes it as-is when frozen
(VTS:1112), and `Driver.stepFrame` copies it into its own object before use (driver.ts:54).

Steering sign chain: `I.steer = +1` → `V.steer` → −1 → `V.delta` < 0 → `V.w` < 0 → `h` decreases → the car goes toward −X
from heading +Z = right on screen. `V.steer` and `V.delta` are **positive = left**; the front-wheel pivots take
`rotation.y = V.delta` unchanged (VTS:1186).

Checked by running the old model (physics.ts transpiled to the scratchpad, a stock 1340 kg RWD car, 2 s straight from
`h = 0`, then 1 s with `steer: +1`): `h` changed by −0.872 rad, `x` by −3.48 m, `w = −1.253`, `V.steer = −1.00`.
In that run `V.delta` was +0.158 while `V.steer` was −1: `delta` includes the counter-steer assist
(`kcs · beta`, physics.ts:136-138), so in a slide the drawn wheels point against the turn. `delta` is not `steer × lock`.

### 3.2 `Vehicle` fields (physics.ts:26-33): units, and who reads or writes them in the drive loop

| Field | Units / range | Written by (besides `stepVehicle`) | Read by |
|---|---|---|---|
| `P` | `Params` | `Driver.rebuild` (driver.ts:46) | HUD, audio, events, VTS:1231 |
| `x`, `z` | m | colliders; `resetVehicle`; `snapToRoad`; events `postStep` | pose, camera, HUD, map, events, net pose (VTS:757) |
| `h` | rad | `resetVehicle`; `snapToRoad`; drag `postStep` | pose, colliders, camera, map (strip/scene.ts:571), net pose |
| `u` | m/s, signed | `syncBody` after a hit; events | fuel burn, lights, speedo (`\|u\|·2.237` mph, VTS:1218), Garage prompt (`\|u\| < 1.5`, VTS:1156), audio, feel, events |
| `v` | m/s, + left | `syncBody`; events | (model only) |
| `w` | rad/s, + left | colliders add a yaw kick | feel (roll = `u·w·.012`) |
| `vx`, `vz` | m/s world | colliders; events | colliders, camera speed (cameras.ts:54) |
| `ax` | m/s², smoothed longitudinal | reset | feel (pitch) |
| `rpm` | rev/min, ≥ `P.idle` (900) | rebuild, reset | HUD, audio, VTS:1231 |
| `gear` | −1 reverse, 1..n | reset (1), `snapToRoad` (1) | **fuel cut (driver.ts:61)**, lights (VTS:1188), HUD |
| `shift` | s left in a gear change (> 0 = no drive) | reset (0) | shift sound on rising edge (VTS:1175), HUD, audio |
| `boost` | 0..1 | reset (0) | HUD, audio |
| `nos` | s of nitrous left, 0..`P.nos.cap` | rebuild clamps; events refill (events.ts:106, 119) | HUD |
| `nosOn` | bool | | sound edge (VTS:1178), vignette (VTS:1208), camera fov (VTS:1192) |
| `spinF`, `spinR` | 0..1 smoothed wheelspin | | feel, audio |
| `hand` | bool | | feel, audio |
| `beta` | rad, `atan2(v, max(\|u\|, 1.2))` | reset | camera, feel, audio, drift scoring |
| `steer` | −1..1, + left | reset | (model only) |
| `delta` | rad road-wheel angle, + left | reset | wheel pivots (VTS:1186) |
| `thr`, `brk` | 0..1 after the gear logic | | **fuel burn (driver.ts:63)**, brake lights (`brk > 0 && u > .5`), audio |
| `overRev` | s, 0..3 | reset; `mendEngine` (VTS:742) | drag "engine blown" (events.ts:264) |
| `blown` | bool (true = no drive torque) | events set; reset and `mendEngine` clear | audio |
| `bov` | s; set to .4 on a blow-off | | sound when `> .38` (VTS:1177) |
| `hit` | m/s into the wall, largest this frame | **`stepFrame` every frame (driver.ts:69)**; events zero it (events.ts:252) | drift scoring (`> 4`) |
| `lights`, `high` | bool | VTS:1116 toggles `lights` | VTS:1188 |
| `hyd` | `{f, r, l, vf, vr, vl, hop}` springs | | feel (needs all finite, carFeel.ts:11) |
| `perfectT`, `perfect`, `perfectN`, `shiftFlash`, `revHold`, `Fdrive`, `odo`, `top` | see physics.ts | | HUD (`perfectT`), events |

`resetVehicle(V, x, z, h)` (physics.ts:175) sets: `x z h`; `u v w vx vz ax = 0`; `gear = 1`; `shift = 0`; `rpm = idle`;
`steer delta beta = 0`; `boost = 0`; `overRev = 0`; `blown = false`; `hit = 0`. It does **not** touch `nos`, `nosOn`,
`spinF/R`, `hand`, `thr`, `brk`, `lights`, `hyd`, `odo`, `top`, `perfect*`, `revHold`, `bov`.

`Params` fields read outside physics.ts in this area: `P.redline` (VTS:1231, HUD, audio), `P.nos.cap` (HUD, events),
`P.turbo` (truthy or null: HUD, audio), `P.gears.length` (hud.ts:151), `P.drive` (scene/carFeelAdapter.ts:34),
`P.idle` (rebuild). The Strip passes the whole `P` to `simStats` (`playerTopMs`, `playerAccel`, strip/scene.ts:409,
events.ts:76-77, 120) and to `makeVehicle` for drag opponents (events.ts:110).

## 4. world/driver.ts

| Item | Lines | Exact behaviour |
|---|---|---|
| `STEP`, `MAX_FRAME`, `MAX_STEPS` | 11-14 | 1/120 s, 0.05 s, 6 |
| `FUEL_PER_THR`, `FUEL_PER_MS` | 16 | 0.09 tank units/s at full throttle; 0.00004 units/s per m/s. Tank is 0..100 |
| `DriveState` | 18 | `{ cfg: CarCfg; tune: Tune }`; only `cfg.perf` and `tune` are used |
| `DriveOpts` | 19-29 | `drift`, `fuel()`, `burn(f)`, `collide(V) → impact m/s`, optional `map(I, dt) → Input` |
| constructor | 38-41 | `makeVehicle(carParams(spec, state.cfg.perf, state.tune))`, then `resetVehicle(V, start.x, start.z, start.h)` (metres, `h`) |
| `rebuild(spec, state)` | 44-47 | `V.P = carParams(...)`; `V.nos = min(V.nos, P.nos.cap)`; `rpm` raised to `P.idle`. Position, heading, speeds and gear are kept. **Same `V` object** |
| `place(x, z, h)` | 50 | `resetVehicle(V, x, z, h); this.acc = 0` |
| `stepFrame` | 53-72 | see below; returns one reused object `{ impact, steps }` |
| `pose()` | 75-79 | one reused object `{ x: V.x·W, y: 0, z: V.z·W, rotY: V.h + π }` |
| `townCollider(boxes)` | 90-118 | see section 7 |

`stepFrame(dtFrame, input, opts)`, in order:

```ts
const V = this.V, I = Object.assign(this.I, input);          // 54: the Driver's own copy of the input
this.acc += Math.min(MAX_FRAME, Math.max(0, dtFrame));       // 55
while (this.acc >= STEP - 1e-9 && steps < MAX_STEPS) {       // 57
  this.acc -= STEP;
  const J = opts.map ? opts.map(I, STEP) : I;                // 59: the Strip's EventRunner.input
  const empty = opts.fuel() <= 0;
  if (empty) { if (V.gear === -1) J.back = 0; else J.fwd = 0; }   // 61
  stepVehicle(V, J, STEP, opts.drift);                       // 62  <- the one call into the dynamics
  if (!empty) opts.burn((FUEL_PER_THR * V.thr + FUEL_PER_MS * Math.abs(V.u)) * STEP);  // 63
  const imp = opts.collide(V); if (imp > impact) impact = imp;                          // 64
  I.shiftUp = I.shiftDn = I.hop = false; // one-shot edges reach one sub-step           // 65
  steps++;
}
if (this.acc > STEP) this.acc = STEP;                        // 68
V.hit = impact;                                              // 69: also on a 0-step frame (then 0)
```

What `world/driver.test.ts` pins: at most 6 steps for a 0.5 s frame; 119 to 120 steps over 60 frames of 1/60 s; at most
0.05 s simulated for a 0.1 s frame; a gear edge reaches exactly one sub-step (seen through `opts.map`); 60 s at full
throttle burns between 0 and 10 units; with an empty tank and `fwd: 1` the car slows; a town box stops a 20 m/s car
(`|u| < 6` after 2 s) without passing it; `pose()` of `{x:3, z:4, h:0}` equals `{x:6, y:0, z:8, rotY: π}`; `rebuild`
gives a new `P` with a larger `tqMul` and leaves `[x, z, h]` exactly; empty and overhead boxes do not collide; a car
unknown to carSpecs drives (`u > 0` after 1 s).

## 5. world/input.ts, sticks.ts, TouchSticks.tsx: how `Input` is filled

`InputMap` is constructed once (VTS:679) with `manual: () => getOptions().manual || isDrag()` and
`hydraulics: () => the driven car's cfg.hydraulics`. `attach(layerRoot)` on getting in (VTS:936), `detach()` on getting out
(VTS:953). `build()` returns **one reused object** (input.ts:227-229).

Held keys (`KM`, by `e.code`, input.ts:11-15) and edges (`EDGE_KEYS`, input.ts:18-20):

| Key | Control |
|---|---|
| ArrowUp, W | `fwd` |
| ArrowDown, S | `back` |
| ArrowLeft, A | `left` → `steer −1`; also edge `laneL` |
| ArrowRight, D | `right` → `steer +1`; also edge `laneR` |
| Alt (either) | `nos` |
| Space | `hb` |
| H | `hyd` (only with the hydraulics kit) |
| Shift (either) | edge `shiftUp` |
| Ctrl (either) | edge `shiftDn` |
| B | look back (camera) |
| G | edge `lights` |
| C camera, R reset (Strip only), J hop, N horn, X drift mode, Enter, M map, Esc / P pause, T races | edges |

`build()` merge order (input.ts:228-257); later rules override earlier ones:

| Step | Lines | Rule |
|---|---|---|
| 1 keys and `[data-k]` buttons | 231-235 | `fwd = (K.fwd && !hyd) \|\| T.thr ? 1 : 0`; `back` likewise with `T.brk`; `steer = right − left` (−1, 0, +1); `nos`, `hb`; `manual = opts.manual()`; `hyd = K.hyd && kit`; `hydF/R/L/Rt` = raw `K.fwd/back/left/right`; `shiftUp/Dn` = edges; `hop = edge.hop && kit` |
| 2 phone sticks | 237-247 | `stickToInput(steerX, gasY)`; stick steer replaces when `st.steer !== 0 && \|st.steer\| >= \|I.steer\|`; `fwd`, `back` take the max; `S.nos` holds NOS; a fresh `S.drift` press sets `kick = 36`; while `kick > 0`: `kick--`, `hb = true`; lane and gear taps become edges |
| 3 gamepad | 248-255 | `axes[0]`: if `\|ax\| > .15`, `steer = sign(ax)·min(1, (\|ax\| − .15)/.85)`; button 7 (RT) value `> .05` → `fwd = max`; button 6 (LT) → `back = max`; button 0 → `nos`; button 2 → `hb`; d-pad 14 → `steer = −1`, 15 → `steer = +1` |
| 4 legacy keys (in VTS, after `build`) | VTS:1067-1072 | unless `I.hyd`: `keys.w → fwd = 1`; `keys.s → back = 1`; `keys.a \|\| keys.d → steer = (d ? 1 : 0) − (a ? 1 : 0)` |

Gamepad edges are read once per frame by `poll()` (input.ts:210-221): 3 camera, 5 `shiftUp`, 4 `shiftDn`, 8 map,
0 enter, 9 pause, 14 `laneL`, 15 `laneR`. Button 0 is both Enter (edge) and NOS (held).

Legacy keys: `VTS:514-557` keeps its own `keys = { w, a, s, d, e, r }` from `e.key` (W/A/S/D and the arrows), and the
phone D-pad in App.tsx calls `window.setMobileKey('w' | 'a' | 's' | 'd', pressed)` (VTS:519-526, App.tsx:1807-1832).
So a keyboard press reaches the car twice, through `InputMap` (by `e.code`) and through `legacyInput` (by `e.key`).

Sticks (world/sticks.ts):

| Item | Lines | Value |
|---|---|---|
| `touchSticks` | 34-43 | `steerX`, `gasY` raw −1..1 (**x right, y up**), `drift`, `nos`, lane and shift taps |
| `shapeAxis(v, dead, power)` | 15-19 | 0 inside the dead zone; else `sign(v)·((\|v\| − dead)/(1 − dead))^power` |
| `DEAD`, `STEER_POWER`, `GAS_POWER` | 6-8 | 0.14, 1.8, 1.4 |
| `stickToInput` | 22-25 | `steer = shape(steerX)` (right positive), `fwd = max(0, g)`, `back = max(0, −g)` |
| `DRIFT_KICK_STEPS` | 10 | 36 |
| `laneEdge` | 28-32 | fires past ±0.6, re-arms under 0.3 |
| `releaseSticks()` | 57-60 | zeroes everything and tells every on-screen stick to let go; called by `InputMap.releaseAll` (input.ts:180) |

TouchSticks.tsx only writes `touchSticks`: `x = (clientX − cx)/r` (right positive), `y = −(clientY − cy)/r` (up positive)
(26); `steerMove` → `setSteerStick(x)` (96); `gasMove` → `touchSticks.gasY = y` (97); Drift and NOS hold buttons (98-99);
gear taps (113-114). The drawn wheel turns `x·180°` clockwise (103), which agrees with `+1 = right`.

What `input.test.ts` and `sticks.test.ts` pin: `keys.left` → `steer −1`; touch `right` → `steer +1`; stick −1 → `steer −1`;
gas stick +1 → `fwd 1`, −1 → `back 1`; a key (±1) beats a stick at −0.3; `hb` is true for exactly 36 `build()` calls after
a fresh Drift press; hydraulics take `fwd` off the car (`fwd 0`, `hyd`, `hydF` true) and `hop` needs the kit;
`clearEdges` clears every edge; gear buttons are edges, never held.

## 6. VanillaThreeScene.tsx: creating, stepping, placing

### 6.1 Where a Driver comes from

| Step | Lines | Detail |
|---|---|---|
| The only `new Driver` | 932 | `new Driver(specOf(car), b, { x: mesh.position.x / W, z: mesh.position.z / W, h: headingOf(mesh) - Math.PI })` |
| `b` | 675, 930 | `buildOf(carId)` = `useGameStore.getState().strip?.cars[carId] ?? { cfg: STOCK_CFG, tune: TUNE_DEF }` |
| `specOf(car)` | 684-691 | one cached `VehicleSpec` keyed `id\|make\|model\|style\|rental\|testCar`; on a miss calls `specFor({ make, model, bodyStyle, rental, testCar })` (~20 ms) **and** `audio.setCar(... redline: spec.redline)` |
| `specFor` | world/data.ts:233-249 | fleet spec for a rental or test car; else the body-style archetype (default `sedan`) with `STYLE_CHASSIS` grip and height, fitted by `fitSpec` when the car has figures |
| `headingOf(o)` | 613 | true yaw from the quaternion (`'YXZ'` Euler), not `rotation.y` |
| Callers of `beginDriving` | 1461 (E key), 1238 (`__micar.drive`), 1334 (Garage "Your cars" swap), 1339 (quick race), 994 (`driveRental`) | refuses when a driver already exists |
| Also set on getting in | 928-942 | `localFuel = car.fuel ?? 100`; `paramsKey = perfKey(b)`; `im.attach(layerRoot)`; `chase.reset(driver.V)`; `driftMode = false` |
| Driver dropped | 957 (`dropCar`) | `driver = null`; `im.detach()`; kit, sound, HUD cleared. Getting out and back in makes a new `Driver` (new `V`) |
| Build changed | 703-709, 1092 | when the store's `strip` record object changes: `driver.rebuild(specOf(car), b)` if `JSON(cfg.perf) + JSON(tune)` changed |

### 6.2 Per-frame order (`animate` → `driveFrame`)

`animate` (1305): `delta = Math.min(clock.getDelta(), 0.1)` (1309). `driveFrame(delta, me)` runs when
`localDrivingCarId && driver && carMeshes[id] && me` (1829-1830).

| # | Lines | What |
|---|---|---|
| 1 | 1088-1091 | fuel: adopt a server refuel (section 8) |
| 2 | 1092 | `syncBuild()` if the store's strip record changed → `driver.rebuild` |
| 3 | 1093-1094 | Garage open → `im.releaseAll()` |
| 4 | 1097-1099 | `im.poll()` (pad edges); take the layer's `tap` |
| 5 | 1111 | `frozen = garageOpen \|\| paused \|\| resultsShown \|\| strip.mapOpen \|\| racesOpen` |
| 6 | 1112-1113 | `let I: Input = NO_INPUT; if (!frozen) { I = im.build(); legacyInput(I); }` |
| 7 | 1114-1118 | edges: camera, horn, `V.lights = !V.lights`, X toggles `driftMode`; look-back |
| 8 | 1123-1160 | Strip: pause, map, **reset → `respawn(S, D)`**, lane edges, exit ring, Enter. Town: **Backspace or the reset tap → `D.place(V.x, V.z, V.h)`** (1154), gate ring → `enterStrip()`, own lot and `\|V.u\| < 1.5` → Garage |
| 9 | 1164 | `halt = paused \|\| (inStrip && strip.mapOpen) \|\| racesOpen` |
| 10 | 1168-1172 | if not halted: `opts = inStrip ? stripOpts : townOpts`; `opts.drift = driftMode \|\| im.driftHeld() \|\| (inStrip && active event type === 'drift')`; `r = D.stepFrame(delta, I, opts)`; `impact = r.impact`; `simDt = r.steps * STEP` |
| 11 | 1173 | `im.clearEdges()` (every frame, stepped or not) |
| 12 | 1174-1179 | `impact > 3` → camera shake and crash sound; shift, blow-off and nitrous sounds from `V.shift`, `V.bov`, `V.nosOn`; `audio.engine(V, \|V.u\|, !halt && !garageOpen)` |
| 13 | 1182-1183 | `p = D.pose(); mesh.position.set(p.x, 0, p.z); mesh.rotation.set(0, p.rotY, 0)` |
| 14 | 1184-1188 | `carFeel.frame(mesh, V, simDt, ...)`; pivots `rotation.y = V.delta`; lights from `V.lights`, `V.gear`, `V.u`, `V.brk` |
| 15 | 1189 | in the Strip: `strip.update(simDt, live)` (AI, events, outrun), `challengeFrame(delta)` |
| 16 | 1190-1192 | camera: `chase.preview(...)` during a countdown, else `chase.update(V, simDt, V.nosOn)` |
| 17 | 1195-1206 | HUD: `hudState.PV = V` |
| 18 | 1216-1221 | fuel gauge, fuel to the server, car position to the server (town only) |
| 19 | 1222 | `if (leave) exitStrip()` |

Frozen is not halted: with the Garage open or a results card up, the physics still steps, with `NO_INPUT` (the car coasts
and collides). Halted (pause, the Strip's map, the race menu) means `stepFrame` is not called at all and `simDt = 0`.

The two option objects (1058-1063), reused and mutated (`drift`) every frame:

```ts
const townOpts: DriveOpts = { drift: false, fuel: fuelNow, burn: burnFuel, collide: townCollider(staticCollisionBoxes) };
const stripOpts: DriveOpts = {
    drift: false, fuel: fuelNow, burn: burnFuel,
    collide: V => { const S = strip!; const i = S.collide(V); S.runner.postStep(STEP); return i; },
    map: (I, dt) => strip!.runner.input(I, dt),
};
```

So one Strip sub-step is: `runner.input` → fuel cut → `stepVehicle` → burn → `collideWalls` → `collideCar` per AI →
`runner.postStep`.

### 6.3 Reset and place: every way the car is put somewhere

| Caller | Lines | Call | Note |
|---|---|---|---|
| getting in | 932 | constructor → `resetVehicle` | from the mesh, world units ÷ W, `rotY − π` |
| town reset (Backspace, R tap) | 1154 | `D.place(V.x, V.z, V.h)` | stops the car where it stands |
| tester's Garage from the pause menu | 1141 | `D.place(V.x, V.z, V.h)` | same |
| into the Strip | 835-836 | `driver.place(STRIP_SPAWN.x, .z, .h)`, then `S.enter(driver.V, mesh)` | metres |
| back to the town | 860-862 | `driver.place(GATE_RETURN.x / W, GATE_RETURN.z / W, GATE_RETURN.rotY - Math.PI)`, then mesh from `pose()` | |
| rental | 1000-1001 | `D.place(RENTAL_BAY.x, .z, .h)`, `S.enter(D.V, mesh)` | |
| Strip reset in a live race | 875-876 | `D.place(p.x, p.z, Math.atan2(p.tx, p.tz))` | route point and tangent |
| Strip reset, free roam | 877 | `S.snap(V)` → `snapToRoad` (strip/routes.ts:46-51) + `mendEngine()` | **direct write**: `x z h`, `u v w vx vz = 0`, `gear = 1`; not `resetVehicle`, `Driver.acc` untouched |
| `__micar.place(x, z, rotY)` | 1241 | `driver.place(x / W, z / W, rotY - Math.PI)` | smoke-test handle, world units |
| circuit lobby, back to hub | strip/scene.ts:280-283, 302, 341 | `resetVehicle(this.PV, x, z, h)` + car group transform | **direct**, bypasses `Driver.place` |
| event grid | strip/events.ts:106, 119 | `resetVehicle(PV, ...)`; `PV.nos = PV.P.nos.cap` | direct |
| `mendEngine` | 742 | `V.blown = false; V.overRev = 0` | direct |

After every `place` the scene calls `chase.reset(driver.V)`.

## 7. Collisions

All three run after `stepVehicle` in the same sub-step, read world-frame velocity, edit it, and call `syncBody` when
there was an impact.

| Function | Where | Reads from `V` | Writes to `V` | Returns |
|---|---|---|---|---|
| `townCollider(boxes)(V)` | driver.ts:90-118 | `h`, `x`, `z`, `vx`, `vz` | `x`, `z`, `vx`, `vz`, `w`; then `syncBody` → `u`, `v` | largest `−vn` (m/s) |
| `collideWalls(V, walls?)` | strip/ai.ts:86-111 | same | same | same |
| `collideCar(V, A)` | strip/ai.ts:113-129 | same, plus `A.x z h v parked` | same; also `A.x`, `A.z`, `A.v *= .85`, `A.stun` | largest `−rvn` (m/s) |

Shared response (driver.ts:110-112, ai.ts:103-105):

```ts
V.x += nx * pen; V.z += nz * pen;
const vn = V.vx * nx + V.vz * nz;
if (vn < 0) { V.vx -= 1.3 * vn * nx; V.vz -= 1.3 * vn * nz; V.vx *= .92; V.vz *= .92;
              V.w += off * (nx * ch - nz * sh) * (-vn) * .05; hit = Math.max(hit, -vn); }
...
if (hit > 0) syncBody(V);
```

- Shape: two circles of radius 0.98 m at ±1.25 m along the heading from `(x, z)` (town and walls). Car against car: points
  at ±1.2 m on each car, contact under 2.1 m, 60 / 40 push-out, `1.4` instead of `1.3`, yaw gain `.04` (ai.ts:117-124).
- Town boxes are read live each call (gate barriers open by emptying their box); a box is skipped when `min.y > 1.6`
  world units or it is empty (driver.ts:98).
- `collideWalls` with no second argument uses a module-level wall hash set by `setWallZone` (ai.ts:84), which
  `StripScene` sets on load and on every zone change (strip/scene.ts:171, 298, 311, 593).
- `StripScene.collide(V)` (strip/scene.ts:449-454): walls first, then each AI car, except in a drag race and except
  other people in a challenge.
- `syncBody` runs only when `hit > 0`. A push-out with no closing speed moves `x`, `z` only.
- Impact use: `V.hit` = the frame's largest (driver.ts:69); `impact > 3` shakes the camera (VTS:1174); a drift run is
  lost at `PV.hit > 4` (events.ts:252).

## 8. Fuel

| What | Where | Exact |
|---|---|---|
| Tank | VTS:164 | `localFuel: number \| null`, 0..100, client-side while driving |
| Start | VTS:929 | `localFuel = car.fuel ?? 100` |
| `fuel()` / `burn(f)` | VTS:1056-1057 | `localFuel ?? 100`; `localFuel = max(0, localFuel − f)` |
| Burn per sub-step | driver.ts:63 | `(0.09 · V.thr + 0.00004 · \|V.u\|) · (1/120)`; nothing when empty |
| Empty | driver.ts:60-61 | `fuel() <= 0` → `J.back = 0` when `V.gear === -1`, else `J.fwd = 0`, before `stepVehicle`. Brakes, steering and nitrous input are untouched |
| Server refuel adopted | VTS:1091 | when `liveCar.fuel − localFuel > 15`, or a refuel was asked for, the game state object changed and `liveCar.fuel >= 100` |
| Gauge | VTS:1218 | every 0.2 s: `drivingFuel = round(localFuel)`, `drivingSpeed = round(\|V.u\| · 2.237)` |
| To the server | VTS:1219, 1495 | every 1.5 s `consumeFuel(id, round(localFuel))`; once more on getting out |
| Refuel | VTS:1832-1837 | town only, within 9 world units of a pump, legacy R key, `localFuel < 99` → `refuel(carId)` |

## 9. world/strip/scene.ts: what it does with the player's vehicle

| Lines | What | Fields |
|---|---|---|
| 141 | placeholder `PV = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF))` until `enter()` | old model, directly |
| 155 | `new EventRunner(this.PV, this.ais, this.fx, () => this.PV.P, ...)` | the runner reads `PV.P` live |
| 277 | `snap(V)` → `snapToRoad` | direct write (section 6.3) |
| 280-283 | `placePlayer` → `resetVehicle(this.PV, ...)`; car group `position = (x·W, 0, z·W)`, `rotation.y = h + π` | direct |
| 347-357 | `enter(PV, carGroup)`: **`this.PV = PV; this.runner.PV = PV`** (the Driver's `V`, by reference); reparents the car group into the Strip's scene and sets its transform from `PV` | `x`, `z`, `h` |
| 359-372 | `exit()`: ends events, gives the car group back to its old parent | |
| 391, 397-409 | prompts and Enter: `PV.x`, `PV.z`; outrun uses `playerTopMs(PV.P)`, `playerAccel(PV.P)` (both run `simStats`) | `P` |
| 449-454 | `collide(V)` | section 7 |
| 458-501 | `update(dt, live)`, once per frame after the player's physics: steps AI, `runner.update(dt)`, outrun, GPS; near miss needs `\|PV.u\| > 22` | `u`, `x`, `z` |
| 535, 571 | GPS path from `[PV.x, PV.z]`; map arrow `g.rotate(Math.PI - PV.h)` | |
| 244, 494 | AI and drag opponents use the same convention: `position = (x·W, 0, z·W)`, `rotation.y = h + π` | |

The header comment (strip/scene.ts:9-10) states the contract: the main scene steps the player, calling `runner.input`
before and `collide` + `runner.postStep` after each sub-step.

`EventRunner.input` and `postStep` (strip/events.ts:161-174), because they sit inside the sub-step:

- Countdown: input gets `steer: 0, hb: false, nos: false` (throttle kept); after the step
  `PV.u = PV.v = PV.w = PV.vx = PV.vz = 0` and `PV.x`, `PV.z` are pinned to the start.
- Drag race: input gets `steer: 0, hb: false, manual: true`; after the step `PV.h = dir; PV.v = 0; PV.w = 0;
  PV.vx = fwd[0]·u; PV.vz = fwd[1]·u`, and `x`, `z` slide toward the lane at 7 m/s.

## 10. DriveLayer.tsx and driveUi.ts

Neither touches the driving model.

| File | Lines | Relevance |
|---|---|---|
| DriveLayer.tsx | 191 | `rootRef` is the element `InputMap.attach` wires (`layerRef` → `layerRoot`, VTS:654, 936) |
| DriveLayer.tsx | 292-303 | the `[data-k]` buttons: `left`, `right`, `dn`, `up`, `nos`, `hb`, `brk`, `thr`. Always mounted, shown by style, because `InputMap` wires them once on getting in |
| DriveLayer.tsx | 162, 291 | `sticks = getOptions().controls === 'sticks'` (default) mounts `<TouchSticks gears={gears} />` instead of the buttons |
| DriveLayer.tsx | 20, 29-31, 305-311 | tap buttons write `useDriveUi.tap` (`pause`, `reset`, `map`, `races`, `enter`); the frame takes it at VTS:1098 |
| driveUi.ts | 17 | `DriveTap` values |
| driveUi.ts | 20-23 | `HELP`: the key list shown to the player (town reset is Backspace, Strip reset is R) |
| driveUi.ts | 39, 49 | `gears` (manual or a drag: gear buttons show), `nos` (vignette, from `V.nosOn`) |

Options live in world/options.ts (`getOptions()`, one localStorage key: `manual`, `units`, `cam`, `mute`, `controls`,
`models`); the frame reads them every frame (VTS:1083).

## What an adapter must provide

- [ ] The same `Vehicle` object for the whole life of a `Driver` (`driver.V`). `StripScene.enter` and `EventRunner` keep
      the reference (strip/scene.ts:350); `rebuild` must change it in place.
- [ ] A step with the signature and timing of driver.ts:62: one call per 1/120 s sub-step, an `Input` with the meanings
      of section 3.1, and the `drift` flag.
- [ ] Before each sub-step, take the state from the `Vehicle` fields, not from a private copy: `x`, `z`, `h`, `u`, `v`,
      `w`, `gear`, `nos`, `blown`, `overRev`, `P`. They are rewritten from outside between steps (sections 6.3, 7, 9).
- [ ] After each sub-step, write back every field in the table of section 3.2 that has a reader, with the same units and
      signs: `x z h u v w vx vz ax rpm gear shift boost nos nosOn spinF spinR hand beta steer delta thr brk overRev
      blown bov perfectT perfect perfectN shiftFlash odo top hyd`.
- [ ] `vx = u·sin h + v·cos h` and `vz = u·cos h − v·sin h` true after every step, so the colliders and `syncBody` agree.
- [ ] `gear === -1` for reverse and `thr` as the applied throttle 0..1 (fuel cut and burn, driver.ts:61-63).
- [ ] `fwd` / `back` as pedals whose role flips in reverse, including the 0.25 s hold that selects reverse and the
      automatic return to first (physics.ts:84-85).
- [ ] `resetVehicle` semantics for `place`: stopped, first gear, idle, `blown` and `overRev` cleared, `nos` and
      `lights` kept; `Driver.place` also zeroes the time accumulator.
- [ ] `rebuild` semantics: new parameters, position, heading, speed and gear kept, `nos` clamped to the new capacity.
- [ ] A `P` that still satisfies its readers: `P.redline`, `P.idle`, `P.nos.cap`, `P.turbo`, `P.gears.length`,
      `P.drive`, and (while the Strip's events stay on the old model) a whole `Params` that `simStats` and
      `makeVehicle` accept.
- [ ] `pose()` unchanged: `{ x·2, 0, z·2, h + π }`, one reused object.
- [ ] `stepFrame`'s result unchanged: `steps` (the scene's `simDt = steps · STEP`) and `impact` in m/s.
- [ ] With the switch off: the 10 tests of world/driver.test.ts, 13 of input.test.ts and 6 of sticks.test.ts pass
      unmodified, and driver.ts:62 still reaches `stepVehicle` with the same arguments in the same order.

## Traps

1. **Steering is negated inside the model.** `I.steer = +1` is right; `V.steer`, `V.delta`, `V.w` and `V.v` are
   positive to the left; `h` grows to the left (physics.ts:133). An engine with the opposite yaw sign mirrors the car
   and also the wheel pivots (VTS:1186), the body roll (carFeel.ts:12) and the collision yaw kick.
2. **`h = 0` is +Z, and the mesh is turned by π.** Forward is `(sin h, cos h)`, not `(cos h, sin h)`; `rotation.y = h + π`.
   At `h = 0` the driver's right is −X.
3. **Two unit systems.** Physics is metres, the scene is metres × 2. `townCollider` takes world-unit boxes, `TOP = 1.6`
   is world units, `GATE_RETURN` is world units with a scene `rotY`; `STRIP_SPAWN`, `RENTAL_BAY`, `STRIP_EXIT` are
   metres with `h`.
4. **The `Vehicle` is written from outside the step.** Colliders, `snapToRoad`, `StripScene.placePlayer`, the event
   runner's `postStep` and grid placement, `mendEngine` and the lights toggle all write fields directly, and three of
   them bypass `Driver.place`. An engine that keeps its own position, velocity or wheel state and only copies out would
   ignore walls, creep during a countdown and drift off the drag lane.
5. **Velocity has two homes.** `stepVehicle` integrates `u, v, w` and derives `vx, vz`; the colliders edit `vx, vz` and
   call `syncBody` to rebuild `u, v`, but only when there was an impact. Both must stay consistent after every step.
6. **The `Vehicle` identity is captured.** `StripScene.PV` and `EventRunner.PV` hold `driver.V`. Replacing the object
   on rebuild leaves the Strip driving a dead vehicle.
7. **`VehicleSpec` numbers are fitted to the old model.** `fitSpec` (world/data.ts:201-225) scales the torque table and
   the final drive until `simStats` of the old model matches the real 0-60 and top speed. Only `mass`, `drive` and
   sometimes `redline` come from the real car; `a`, `b`, `h`, `cd`, `area`, `r` and `gears` are the body style's.
   Feeding `spec.tq` and `spec.fin` into a different engine does not give the real car.
8. **Reused objects.** `pose()`, the `stepFrame` result, `InputMap.build()` and the Driver's input copy are each one
   object, overwritten on the next call. `NO_INPUT` is shared and must never be mutated (it is passed as-is when frozen).
9. **One-shot edges reach one sub-step only** (driver.ts:65), and `im.clearEdges()` runs every frame (VTS:1173). A frame
   with zero sub-steps (a display faster than 120 Hz) drops a gear press. (By reading, no test.) Existing behaviour;
   changing it changes the switch-off game.
10. **The Drift button's hand-brake kick counts `build()` calls**, and the frame calls `build()` once (VTS:1113), not
    once per sub-step, so 36 means 36 frames, not 0.3 s. Calling `build()` per sub-step would shorten it. (By reading;
    the test pins "36 `build()` calls".)
11. **The empty-tank cut depends on `V.gear` and edits the mapped input** (driver.ts:61). An engine that reports reverse
    differently, or reads the input before the cut, lets an empty car drive.
12. **Frozen is not halted.** With the Garage open or results showing, the car still steps with `NO_INPUT` and still
    collides. Only pause, the Strip's map and the race menu stop the step.
13. **The sim clock is `steps · STEP`.** The Strip's AI and events, the wheels, the smoke and the camera run on `simDt`
    (VTS:1171, 1184, 1189, 1192). A different sub-step count or size puts the player out of step with the opponents.
14. **`V.hit` is overwritten every frame** by `stepFrame` (0 on a frame with no steps), and drift scoring zeroes it.
15. **`resetVehicle` leaves things alone:** `nos` (events refill it themselves), `lights`, `hyd`, `thr`, `brk`,
    `spinF/R`, `hand`. A reset that clears more changes a race start and the lights.
16. **`specOf` has a side effect and a cost:** it sets the car's sound (`audio.setCar`) and `specFor` takes about 20 ms,
    so it is cached to one car. Calling `specFor` per frame, or bypassing `specOf`, breaks one or the other.
17. **Input arrives by two keyboard paths and a phone path.** `InputMap` (by `e.code`) and the scene's legacy
    `keys` (by `e.key`, also set by the phone D-pad through `window.setMobileKey`); `legacyInput` runs last and
    overrides a stick or pad steer. Reading only `InputMap.build()` loses the phone D-pad.
18. **Global wall state.** `collideWalls` reads a module-level hash set by `setWallZone`; the town collider reads its
    box array live. Neither is passed per call.
19. **`townOpts` / `stripOpts` are mutated each frame** (`opts.drift`), and the drift flag has three sources
    (X toggle, the phone's Drift button, a drift event).
20. **`carFeel` skips the frame if `u`, `w`, `ax` or the `hyd` springs are not finite** (carFeel.ts:11): a field left
    `undefined` freezes the body lean silently instead of failing.
