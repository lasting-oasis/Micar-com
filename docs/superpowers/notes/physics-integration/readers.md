# Readers of the driving model: HUD, sound, camera, car feel, card stats

Scope: code that only READS a `Vehicle` (`V`, `PV`) or its `Params` (`V.P`) to show or sound it.
All paths are under `/home/user/Micar-com/apps/sim/src/`. Line numbers are as of this reading.
Old model: `world/physics.ts` (184 lines). The new package `packages/physics/src` is empty at the time of writing.

Baseline: `npx vitest run` over the eleven reader test files passes (261 tests): `world/hud.test.ts`, `world/raceHud.test.ts`,
`world/audio.test.ts`, `world/cameras.test.ts`, `world/carFeel.test.ts`, `scene/carFeelAdapter.test.ts`, `sound/*.test.ts`,
`world/cardStats.test.ts`.

---

## 0. The short version

- None of the reader files calls a physics function. They import only `clamp` and the type `Vehicle` from `./physics`
  (`hud.ts:7`, `raceHud.ts:10`, `audio.ts:7`, `cameras.ts:8`, `carFeel.ts:1`, `carFeelAdapter.ts:2`).
  `carParams`, `makeVehicle`, `resetVehicle` are called only by their tests, as fixtures.
- Every reader takes a whole `Vehicle` object and reads plain fields. So the cheapest correct adapter keeps one
  `Vehicle`-shaped object (with a `Params`-shaped `P`) and fills it after each physics step.
- `sound/engineSound.ts`, `engine.worklet.ts`, `facts.ts`, `firing.ts`, `orders.ts`, `carSound.ts` never see a `Vehicle`.
  They see five numbers (`rpm, throttle, load, boost, cut`) made by `engineDrive(V)` in `audio.ts:15-18`, and a redline.
- `CardStatsPanel.tsx` and `cardStats.ts` read nothing of the driving model at all.
- Fields of `Vehicle` that no reader in this area reads: `v`, `steer`, `delta`, `perfect`, `perfectN`, `overRev`,
  `revHold`, `Fdrive`, `brk`, `odo`, `top`, `shiftFlash`, `bov`, `hit`, `lights`, `high`, `hyd.vf/vr/vl/hop`.
  (`bov`, `delta`, `brk`, `lights` are read by the scene's frame, section 9; `overRev`, `perfectN`, `hit` by `strip/events.ts`.)
  `shiftFlash`, `perfect`, `top`, `odo`, `high` have no reader anywhere outside `physics.ts`.

---

## 1. The old model's fields as the readers assume them

Written at `physics.ts` line shown. "Range" is what the old model actually produces.

| Field | Unit / type | Range in the old model | Written at | Meaning the readers rely on |
|---|---|---|---|---|
| `x`, `z` | metres, world plane | unbounded | 171 | Position. Scene = metres x `WORLD_PER_M` (2) (`units.ts`). |
| `h` | rad | unbounded, never wrapped (`V.h += V.w*dt`, 168) | 168 | Heading. `h = 0` faces +Z. Forward = `(sin h, cos h)`. `h` rising turns toward +X, which is the car's LEFT on screen. Mesh `rotation.y = h + PI` (`driver.ts:77`). |
| `u` | m/s, signed | negative in reverse | 165, 166 | Body-forward speed. Negative reversing. NOT total speed. |
| `v` | m/s | | 165, 167 | Body-lateral speed; positive toward `(cos h, -sin h)` = car's left. Read only through `beta`. |
| `w` | rad/s | | 165, 167 | Yaw rate; positive = `h` rising = left turn. |
| `vx`, `vz` | m/s, world | | 170 | `vx = u sin h + v cos h`, `vz = u cos h - v sin h`. Inverse is `syncBody` (174). |
| `ax` | m/s^2 | roughly +-1 g (not measured here) | 164 | Longitudinal acceleration, low-passed at 10/s. Positive speeding up. |
| `rpm` | rev/min | `>= P.idle` (900) always; NO upper cap | 97, 101 | Crank speed. Follows the wheels in gear (`abs(wheelRpm*total)`), so a manual downshift can send it to several redlines (`engineSound.ts:24` says about 4.7). |
| `gear` | integer | `-1` or `1 .. P.gears.length`; never 0 | 84-93 | `-1` is reverse. There is no neutral. Starts at 1. |
| `shift` | seconds left | `> 0` while a shift is in progress, else in `(-dt, 0]` | 87, 89-93 | A countdown, not a flag. Starts at `P.shiftT` (0.17 .. 0.42 s), x0.8 or x0.6 on a downshift. Drive torque is 0 while `> 0`. |
| `boost` | 0..1, no unit | 0..1; exactly 0 with no turbo (104) | 103-104 | Normalised spool state, not a pressure. |
| `nos` | seconds of bottle left | `0 .. P.nos.cap` | 108 | Drains 1/s while firing, refills at `P.nos.regen`/s. |
| `nosOn` | boolean | | 109 | Nitrous firing this step: button, bottle > 0, `thr > .1`, forward gear, not shifting. |
| `spinF`, `spinR` | 0..1 | 0..1 | 153 | A low-passed (8/s) FLAG, not a slip ratio: 1 when that axle's longitudinal force demand exceeded its grip. Set by wheelspin, by brake lock-up, and (rear) by the handbrake while moving. |
| `hand` | boolean | | 148 | Handbrake held this step (`I.hb`). |
| `beta` | rad | inside `(-PI/2, PI/2)` | 134 | `atan2(v, max(abs(u), 1.2))`. Body slip angle. Course over ground = `h + beta` when `u > 0`. Uses `abs(u)`, so it does not flip to near PI in reverse. One sub-step stale (computed before the integration). |
| `thr` | 0..1 | 0..1 | 86 | The EFFECTIVE throttle: `I.fwd` in a forward gear, `I.back` in reverse. 0 on an empty tank (`driver.ts:61`). |
| `brk` | 0..1 | 0..1 | 86 | Effective brake (the other pedal). |
| `perfectT` | seconds left | 0 .. 1.2 | 89, 112 | `> 0` for 1.2 s after a perfect manual upshift. |
| `bov` | seconds left | 0 .. 0.4 | 103, 105 | Set to 0.4 when boost drops; counts down. |
| `blown` | boolean | | (game) | Written by GAME code, not physics: `strip/events.ts:264` sets it, `VanillaThreeScene.tsx:742` and `resetVehicle` clear it. Physics obeys it (115). |
| `hyd.f`, `hyd.r` | metres of lift | spring toward 0 or 0.3, overshoots | 126 | Front / rear hydraulic lift. |
| `hyd.l` | no unit | spring toward 0 or +-0.25 | 126 | Side lean command. |

`Params` fields the readers use (everything else in `P` is unread here):

| Field | Unit / type | Old value | Used by |
|---|---|---|---|
| `P.redline` | rev/min, finite, stable | `spec.redline + 150*ecu` (`physics.ts:57`); data has 6200 .. 8100 | `hud.ts:129,136,151,203-204`; `raceHud.ts:212,214`; `audio.ts:16,17,188` |
| `P.nos.cap` | seconds; exactly 0 when no nitrous | `[0,4,6,8][tier] * (1 - .3*tune)` (`physics.ts:60`) | `hud.ts:135,150,211`; `raceHud.ts:227` |
| `P.turbo` | `null` when no turbo, else object | `{gain, spool}` or `null` (`physics.ts:59`) | truthiness: `hud.ts:148`, `raceHud.ts:228`, `audio.ts:188,197` |
| `P.turbo.gain` | fraction of torque at full boost | about 0.16 .. 0.46 | `audio.ts:198` (classic whine level) |
| `P.gears.length` | count of FORWARD gears | 6 in the data | `hud.ts:151`; `raceHud.ts:214` |
| `P.drive` | `'FWD' | 'RWD' | 'AWD'` | from the spec | `scene/carFeelAdapter.ts:34` |

Name clash to watch: `V.h` is heading (rad); `P.h` is centre-of-gravity height (m).

---

## 2. `world/hud.ts` (the gauge cluster, drag tach, GPS arrow, radar)

Entry: `Hud.draw(s: HudState)` (`hud.ts:121`); `s.PV` is the `Vehicle` (`hud.ts:18`, set at `VanillaThreeScene.tsx:1200`).

| Line | Reads | Assumes | If missing or different |
|---|---|---|---|
| 59 `kmhOf` | `V.u` | m/s; `abs(u)*3.6` is the speed shown | Total speed instead of forward speed changes the reading in a slide. `undefined` shows `NaN`. |
| 66 `gpsReached` | `PV.x`, `PV.z` | metres, same frame as the GPS target | Wrong scale: the GPS never clears, or clears early (14 m). |
| 129 | `P.redline` | rpm, finite. `maxR = ceil((red+800)/1000)*1000` is the dial's top | See Traps: `Infinity` hangs the frame (loops at 138, 207). rad/s gives a 0..2 dial. |
| 135 | `P.nos.cap`, `PV.nos`, `PV.nosOn` | arc = `PV.nos / P.nos.cap`, NOT clamped; glow 16 vs 6 when firing | `nos > cap` draws past the dial's end. `cap` 0 hides it. |
| 136-142 | `P.redline` | red zone from `red` to `maxR`; a tick every 500 rpm | |
| 143 | `PV.rpm` | needle at `min(maxR, rpm)`; no lower clamp | Negative rpm puts the needle left of zero. `NaN` draws no needle. |
| 147 | `PV.gear`, `PV.shift` | `-1` shows `R` in gold; `shift > 0` dims the digit; otherwise `String(gear)` | A neutral of 0 shows "0". 0-based gears read one low. A shift flag kept true dims it for good. |
| 148 | `P.turbo`, `PV.boost` | bar width `R*.8*boost`, NOT clamped | Boost in bar or psi overflows the bar. A non-null `turbo` on an NA car shows a BOOST bar. |
| 150 | `P.nos.cap`, `PV.nosOn` | NITROUS label brighter while firing | |
| 151 | `s.manual`, `PV.rpm`, `P.redline`, `PV.gear`, `P.gears.length` | SHIFT flashes when `rpm > red*.9` and `gear < gears.length` | If `P.gears` holds reverse or neutral, SHIFT flashes in top gear. |
| 189-190 | `PV.x`, `PV.z`, `PV.h` | `an = atan2(dx, dz) - PV.h`; `rotate(-an)` | Another heading convention points the arrow the wrong way. |
| 201-205 | `P.redline`, `PV.rpm` | drag tach: green band `red*.9 .. red+150`, red from `red+150`; bar `rpm/maxR` clamped | The green band is the old perfect-shift window (`physics.ts:89`), the red band the old fuel cut (`physics.ts:110`). Other windows in the new model make the band lie. |
| 208-209 | `PV.gear`, `PV.rpm` | gear as above; `Math.round(PV.rpm) + ' RPM'` | |
| 210 | `PV.perfectT` | `> 0` shows PERFECT SHIFT in green | Missing: the message never shows (`undefined > 0` is false). |
| 211 | `P.nos.cap`, `PV.nos` | bar `w * nos / cap`, not clamped | |
| 220 | `PV` -> `drawRouteMap` | `x`, `z`, `h` | |
| 224-225 | `PV.h`, `PV.x`, `PV.z` | radar: `rotate(PI + PV.h)`, `translate(-PV.x, -PV.z)`; roads within 600 m | |
| 229 | `PV.x`, `PV.z` | AI dots within 400 m | |
| 230 | `a.drag.ai[].V.x`, `.V.z` | a drag opponent is a `Vehicle` too | If opponents move to the new model, their object still needs `x`, `z` in metres. |

Not read in `hud.ts`: `shiftFlash`, `overRev`, `blown`, `bov`, `perfect`, `hyd`, `spinF/R`, `hand`, `beta`, `ax`, `thr`, `brk`.

Test fixture (`hud.test.ts:21-24`): `makeVehicle(carParams(ARCHETYPES.sports, ...))`, `resetVehicle(PV,100,100,0)`,
then `PV.u = 100/3.6` written directly, and the speed text is expected to follow.

---

## 3. `world/raceHud.ts` (lap-race dash, car card, route map)

`raceView` (40-57) reads no vehicle field (it uses the event, the standings and the timing).

`drawRaceHud` (166-238), `PV = s.PV`, `P = PV.P` (210):

| Line | Reads | Assumes | If missing or different |
|---|---|---|---|
| 212 | `P.redline`, `PV.rpm` | `frac = redline > 0 ? rpm/redline : 0`; ten rev lights fill from 45% to 95% of redline: `round(clamp((frac-.45)/.5,0,1)*10)` | rpm that idles above 45% of redline leaves lights on at idle. |
| 214 | `s.manual`, `PV.rpm`, `P.redline`, `PV.gear`, `P.gears.length` | all ten lights flash red when `rpm > redline*.9` and not in top gear | Same as the SHIFT light. |
| 221-222 | `PV.gear`, `PV.shift` | `-1` -> `R`; `shift > 0` greys the digit | Same as the cluster. |
| 223 | `kmhOf(PV)` -> `PV.u` | m/s | |
| 227 | `P.nos.cap`, `PV.nos`, `PV.nosOn` | bar `nos/cap`, clamped 0..1 by `bar()` (65) | |
| 228 | `P.turbo`, `PV.boost` | bar, clamped 0..1 | |

`drawRouteMap` (258-286) takes `PV: { x; z; h }`:
- 280: `px = clamp(X(PV.x))`, `py = clamp(Y(PV.z))`: metres, north-up map where screen x = x and screen y = z.
- 281: arrow turned by `PI - PV.h`. With `h = 0` it points down the screen (+Z); with `h = PI/2` it points right (+X).

---

## 4. `world/audio.ts` (the sound's only contact with the driving model)

### 4.1 `engineDrive(V)` (`audio.ts:15-18`), the bridge to the engine sound model

```ts
const cut = V.shift > 0 || V.blown || V.rpm > V.P.redline + 150 ? 1 : 0;
return { rpm: V.rpm, throttle: V.thr, load: V.thr > 0 ? V.thr : -0.3 * V.rpm / V.P.redline, boost: V.boost, cut };
```

| Output | From | Assumes |
|---|---|---|
| `rpm` | `V.rpm` | rev/min |
| `throttle` | `V.thr` | 0..1 |
| `load` | `V.thr` if `> 0`, else `-0.3 * rpm / redline` | -1..1; the model uses only the positive part for loudness |
| `boost` | `V.boost` | 0..1; 0 as soon as the turbo is gone |
| `cut` | `V.shift > 0`, `V.blown`, `V.rpm > V.P.redline + 150` | 0 or 1 |

Pinned by `audio.test.ts:28-39`: `{rpm:4200, thr:.6, boost:.4}` gives exactly
`{ rpm: 4200, throttle: 0.6, load: 0.6, boost: 0.4, cut: 0 }`; load is negative at `thr = 0`; cut is 1 for `shift = 0.2`,
for `rpm = redline + 200`, for `blown = true`. `audio.test.ts:43-55` pins boost reaching 0 after `Driver.rebuild` removes the turbo.

### 4.2 `Audio.engine(V, sp, on)` (`audio.ts:181-202`)

Called once per frame, halted or not: `audio.engine(V, Math.abs(V.u), !halt && !garageOpen)` (`VanillaThreeScene.tsx:1179`).
`sp` is m/s.

| Line | Reads | Use | If missing or different |
|---|---|---|---|
| 188 | `V.P.turbo` (truthiness), `V.P.redline` | When either differs from what was last sent, `send()` posts new facts and the worklet builds a NEW model on the audio thread | A redline that is not exactly stable from frame to frame (or is `NaN`, since `NaN !== NaN`) rebuilds the model every frame: clicks or silence. |
| 189-190 | `engineDrive(V)` | `setTargetAtTime(d[k], t, .01)` on the five AudioParams | Non-finite values throw (see Traps). |
| 193-194 | `V.rpm` | classic oscillators at `f = 28 + rpm/60*1.6` Hz, `f*.5`, `f*1.51` | Always scheduled, even in model mode (gain 0 there). |
| 195 | `V.thr`, `V.rpm` | low-pass corner `300 + thr*1800 + rpm*.25` Hz | |
| 196 | `V.thr`, `V.shift`, `V.blown` | classic gain `(.07 + thr*.09) * (shift > 0 ? .45 : 1) * (blown ? .2 : 1)` | |
| 197-198 | `V.P.turbo`, `V.P.turbo.gain`, `V.boost`, `V.rpm` | classic whine gain `boost*.014*(1 + gain*4)`; pitch `1400 + rpm*.5 + boost*800` Hz | `turbo` present without `gain` gives `NaN` gain and throws. |
| 199-200 | `V.beta`, `V.spinF`, `V.spinR`, `V.hand`, `sp` | tyre squeal (both modes): `clamp((abs(beta)-.14)*3,0,1)*min(1,sp/12) + max(spinF,spinR)*.6*min(1,sp/4) + (hand ? .5*min(1,sp/6) : 0)`, then `min(1, .)*.16` | A slip ratio in place of the 0..1 flag makes the squeal constant or absent. beta in degrees squeals always. |
| 201 | `V.nosOn`, `sp` | nitrous hiss 0.09 while on; wind `min(.12, sp*sp*.00006)` | |

`Audio.setCar(facts)` (107) resets `sentTurbo = false`, `sentRedline = facts.redline`. It is called from
`VanillaThreeScene.tsx:688` with `redline: driveSpec.spec.redline`, the STOCK `VehicleSpec.redline`, not `P.redline`.
`audio.test.ts:214-263` pins: an ECU remap (`P.redline = stock + 450`) reaches the model as one message; none is sent while it stays the same.

### 4.3 The one-shot sounds are edge-detected in the scene, from `V`

| Where | Condition | Sound | Depends on |
|---|---|---|---|
| `VanillaThreeScene.tsx:1175` | `V.shift > 0 && lastShift <= 0` | `'shift'` | `shift` being a countdown that returns to `<= 0` |
| `VanillaThreeScene.tsx:1177` | `V.bov > .38`, rising edge | `'bov'` | `bov` being set to 0.4 and counting down in seconds |
| `VanillaThreeScene.tsx:1178` | `V.nosOn && !lastNos` | `'nosfire'` | |
| `VanillaThreeScene.tsx:1174` | `impact > 3` | `'crash'`, camera shake | `Driver.stepFrame`'s `impact` |

---

## 5. `sound/*.ts` (no `Vehicle` anywhere)

| File | Contact with the driving model |
|---|---|
| `engineSound.ts` | Public inputs `rpm, throttle, load, boost, cut` (44-45) and `facts.redline` (76). Nothing else. |
| `engine.worklet.ts` | AudioParams `rpm, throttle, load, boost, cut, exhaust, intake, bay` (11), k-rate, default 0, no min/max (15). `process` copies `p.x[0]` into the model (33). Facts arrive by `port.postMessage({ facts })` (23). |
| `carSound.ts` | `soundFactsFor({ engine, bodyStyle, redline, wheelbaseM? })` (55). `redline` in rev/min sizes the pipe bore (`boreMm`, 19-22) and becomes `facts.redline`. Fed from `VehicleSpec.redline`. |
| `facts.ts` | Types only. `SoundFacts.redline` (44), rev/min. |
| `firing.ts`, `orders.ts` | None. |

What `engineSound.ts` assumes of the five inputs (so of `engineDrive`'s outputs):

| Input | Guard (`engineSound.ts:176-177`) | Thresholds that give it meaning |
|---|---|---|
| `rpm` | clamped to `0 .. 10 * redline`; `NaN` counts as 0 | The crank turns only above 60 rpm (188); 0 is silence. With the pedal off, fuel is cut above 1800 rpm and fully back by 1300 rpm (`FUEL_BACK_RPM` 1800, `FUEL_BACK_BAND` 500; lines 18-19, 145-146). Idle roughness scales with `1 - rpm/(0.45*redline)` (147). Pops need `rpm > 0.4*redline` (163). |
| `throttle` | 0..1 | Pedal counts as down at 0.06 (145). Intake noise goes as `thr^2` (159, 253). The model's own blow-off fires when throttle falls through 0.25 with `boost > 0.35` (262). |
| `load` | -1..1 | Only `max(0, load)` is used: loudness `0.22 + 0.78*load` (148), pulse sharpness (151), pipe heat above 0.4 (185). |
| `boost` | 0..1 | Loudness `1 + 0.6*boost` (148); whistle at `(25000 + 150000*sqrt(boost))/60` Hz (261). |
| `cut` | 0..1 | `>= 0.5` stops the firing (146); the engine then sounds motored (0.18 of full). |

Consequences for the driving model:
- An idle above about 1300 rpm with the pedal off sounds half fuel-cut; the old idle is 900 (`physics.ts:57`).
- Two blow-off sounds exist: the scene's `sfx('bov')` from `V.bov`, and the model's own from throttle and boost. Both play in model mode today.
- `soundMode` (`audio.ts:12`) defaults to `'model'`; `?sound=classic` selects the three oscillators.

---

## 6. `world/cameras.ts` (`ChaseCamera`)

| Method | Lines | Reads | Assumes |
|---|---|---|---|
| `reset(PV)` | 30-35 | `PV.h`, `PV.x`, `PV.z` | forward `(sin h, cos h)`; camera 6 m behind, 2 m up, in metres x `W` |
| `preview(route, t01, PV)` | 39-51 | `PV.h`, `PV.x`, `PV.z` | lands exactly on `reset(PV)`'s pose at `t01 = 1` (`cameras.test.ts:49`) |
| `update(PV, dt, nosOn)` | 53-70 | `PV.vx`, `PV.vz`, `PV.h`, `PV.beta`, `PV.x`, `PV.z`, and the `nosOn` argument | see below |

`update` in detail:
- 54: `sp = Math.hypot(PV.vx, PV.vz)`, world speed in m/s. Chase distance `6.0 + sp*.025` (63); fov `62 + min(16, sp*.2) + (nosOn ? 8 : 0)` (69).
- 55: yaw target `PV.h + clamp(PV.beta, -.6, .6) * .5` (hood mode: `PV.h` only), wrapped with `atan2(sin, cos)`, followed at 4.2/s (20/s in hood mode).
- 57: `nosOn` adds 0.12 to the shake.
- Call: `chase.update(V, simDt, V.nosOn)` (`VanillaThreeScene.tsx:1192`). `dt` is the physics time actually run this frame, 0 when halted.

Pinned by `cameras.test.ts:42-47`: with `PV.beta = .4` the yaw settles at `PV.h + .2`. So `beta` positive must mean
"the car is travelling toward +h of where it points".

If different: `vx`, `vz` left stale (the adapter sets only `u`) freezes the distance and fov at standstill values;
`beta` with the other sign swings the camera to the outside of a slide; `beta` in degrees pins the camera at +-0.3 rad.

---

## 7. `world/carFeel.ts` and `scene/carFeelAdapter.ts`

### 7.1 `carFeel.ts` (pure)

| Function | Lines | Reads | Formula | Notes |
|---|---|---|---|---|
| `feelStep(V, dt, F)` | 10-20 | `V.u`, `V.w`, `V.ax`, `V.hyd.f`, `V.hyd.r`, `V.hyd.l` | roll = `clamp(u*w*.012 + hyd.l*.6, -.08, .08)` rad; pitch = `clamp(-ax*.01 + (hyd.f - hyd.r)*.45, -.06, .06)` rad; lift = `(hyd.f + hyd.r)/2` m; each followed at 6/s | Line 11 returns `F` untouched unless `dt > 0` and all six are finite. `V.hyd` itself must exist or line 11 throws. |
| `wheelRollRate(V, front)` | 22-24 | `V.u`, `V.spinF` or `V.spinR` | `u * (1 + 1.5*spin)` m/s at the tread | `carFeel.test.ts:42-46`: `u=10, spinR=1` gives 25 rear, 10 front. |
| `smokeLevel(V)` | 26-32 | `V.spinR`, `V.spinF`, `V.hand`, `V.u`, `V.beta` | `max(spinR, spinF, hand && abs(u)>3 ? 1 : 0, slide)`; slide = `abs(beta)>.17 && abs(u)>8 ? min(1,(abs(beta)-.17)/.25) : 0` | 0..1 only if spin is 0..1. |
| `skidLevel(V)` | 34-39 | `V.hand`, `V.u`, `V.spinF`, `V.spinR`, `V.beta` | 1 if `hand && abs(u)>3`, or `max(spinF,spinR) > .5`, or `abs(beta)>.2 && abs(u)>6` | 0 or 1. |

Signs pinned by `carFeel.test.ts`: `u=20, w=.8` gives roll `> 0` (9-18); `ax=-8` gives pitch `> 0` (20-28).

### 7.2 `carFeelAdapter.ts`, `CarFeelAdapter.frame(mesh, V, simDt, wheelR, district, at, halt)` (22-52)

Called every frame after the mesh is posed (`VanillaThreeScene.tsx:1182-1184`); `simDt = steps * STEP` (1171), 0 when halted;
`wheelR` in world units (`VanillaThreeScene.tsx:933`).

| Line | Reads | Use |
|---|---|---|
| 25 | `feelStep(V, simDt, feel)` | as above |
| 26-27 | feel | `tilt.rotation.set(-pitch, 0, -roll)`; `tilt.position.y = lift * W` |
| 28-31 | `wheelRollRate(V, i < 2)` | `rotateX(-rate * W / wheelR * simDt)`; wheels 0,1 are front (FL, FR), 2,3 rear |
| 34 | `V.P.drive === 'FWD'` | smoke from wheels `[2,3,0,1]` on FWD, else `[2,3]`. Read ONCE per mesh (`smokeFor !== mesh`), not on every rebuild |
| 38 | `smokeLevel(V)` | `smoke.update(simDt, level)` |
| 40-49 | `skidLevel(V)`, `V.x`, `V.z` | a skid mark at each rear wheel every 0.4 m of travel (metres, from `V.x`, `V.z`), placed from `mesh.position` and `mesh.rotation.y` |

If different: `ax` in g instead of m/s^2 makes the body almost never pitch; a spin value above 1 spins the wheels
absurdly and holds smoke and marks on; a spin value that stays about 0.05 to 0.15 at the limit (a real slip ratio)
never reaches the 0.5 that lays a mark.

---

## 8. `world/CardStatsPanel.tsx` and `world/cardStats.ts`

They read NO `Vehicle`, NO `Params`, and call none of `simStats`, `dynoCurve`, `torqueAt`, `launchRpm`, `carParams`.

- `cardStats.ts:9-10` imports `baseStats`, `emptySpec`, `sourced`, `bodyClassFromSimStyle` and the type `VehicleSpec` from `@micar/engine`.
  That `VehicleSpec` is a DIFFERENT type from `physics.ts:6`'s `VehicleSpec`; only the name is shared.
- `engineSpecFor(car)` (28-44) builds it from the car table row (`getCarSpec`): `engine` text, `hp`, `weightLb`, `zeroToSixty`, `topSpeedMph`, `drive`.
- `cardStatsFor(car)` (47) = `baseStats(engineSpecFor(car))`. `CardStatsPanel.tsx:19` renders it.
- The file says so itself (`cardStats.ts:7-8`): "nothing here reads or changes the Strip, the Garage's stat panel or a grade."

The switch cannot affect these two files. They are, though, a second source of a car's figures (table horsepower, 0-60,
top speed) beside whatever the new engine computes.

---

## 9. Call order in one frame (`VanillaThreeScene.tsx`)

`V = D.V` is taken once at the top of the frame (1083). The same object is read by everything below.

| # | Line | Call | Reads |
|---|---|---|---|
| 1 | 1171 | `D.stepFrame(delta, I, opts)`: 0..6 sub-steps of 1/120 s (`driver.ts:11-14`), skipped when halted | writes `V` |
| 2 | 1174 | crash shake and sfx | `impact` |
| 3 | 1175-1178 | shift, bov, nosfire sfx | `V.shift`, `V.bov`, `V.nosOn` |
| 4 | 1179 | `audio.engine(V, abs(V.u), !halt && !garageOpen)` | section 4 |
| 5 | 1182-1183 | `D.pose()` to the mesh | `V.x`, `V.z`, `V.h` |
| 6 | 1184 | `carFeel.frame(mesh, V, simDt, wheelR, ...)` | section 7 |
| 7 | 1186 | steering pivots `q.rotation.y = V.delta` | `V.delta`, rad, positive left |
| 8 | 1188 | `setCarLights`: off if `!V.lights`; reverse if `V.gear === -1 && V.u < -0.5`; brake if `V.brk > 0 && V.u > 0.5` | `V.lights`, `V.gear`, `V.u`, `V.brk` |
| 9 | 1191-1192 | `chase.preview(route, t, V)` during a countdown, else `chase.update(V, simDt, V.nosOn)` | section 6 |
| 10 | 1200-1204 | `h.PV = V; ... hud.draw(h)` | sections 2, 3 |
| 11 | 1208 | `useDriveUi.setState({ nos })` on change | `V.nosOn` |
| 12 | 1218 | `drivingSpeed: Math.round(Math.abs(V.u) * 2.237)` (mph), 5 times a second | `V.u` |

`chase.reset(V)` is also called outside the frame: `VanillaThreeScene.tsx:724, 725, 841, 863, 878, 937, 1004, 1138, 1241`.
`audio.setCar(...)` is called when the driven car changes (688).

All readers sample `V` once per frame, after all of that frame's sub-steps. Nothing reads between sub-steps.

---

## What an adapter must provide

A `Vehicle`-shaped object, the same object for as long as the car is driven, refreshed after every `stepFrame`, with:

- [ ] `x`, `z` in metres; `h` in rad with `h = 0` facing +Z and forward `(sin h, cos h)`; `h` rising = turning left (toward +X).
- [ ] `u` = signed body-forward speed in m/s (negative in reverse), not total speed.
- [ ] `vx`, `vz` in m/s, world frame, consistent with `u`, `v`, `h` (`physics.ts:170`).
- [ ] `w` in rad/s, positive with `h` rising. `u*w` must be the lateral acceleration with the sign that gives roll `> 0` in a left turn.
- [ ] `ax` in m/s^2, positive accelerating, smoothed (the old one is low-passed at 10/s); always finite.
- [ ] `beta` in rad = `atan2(v, max(abs(u), 1.2))`, lateral `v` positive to the car's left; inside +-PI/2; small and steady at a standstill.
- [ ] `rpm` in rev/min, finite, `>= 0`; an idle near 900 (below 1300) with the pedal off.
- [ ] `gear`: `-1` for reverse, `1..n` forward. No 0, or a decision about what the HUD shows for it.
- [ ] `shift`: seconds left in a shift, `> 0` only while the drive is interrupted, back to `<= 0` after.
- [ ] `boost`: 0..1, exactly 0 with no turbo.
- [ ] `nos`: seconds left, `0 .. P.nos.cap`; `nosOn`: boolean, true only while nitrous is adding power.
- [ ] `spinF`, `spinR`: 0..1, where above 0.5 means "this axle is visibly spinning or locked". Map a slip ratio onto this; do not pass it through.
- [ ] `hand`: boolean, handbrake applied.
- [ ] `thr`, `brk`: 0..1 effective pedals (throttle is the reverse pedal in reverse gear; 0 on an empty tank).
- [ ] `perfectT`: seconds, `> 0` while the drag HUD should say PERFECT SHIFT.
- [ ] `bov`: jumps to 0.4 when the blow-off valve opens and counts down in seconds (or the scene's edge test at 1177 changes with it).
- [ ] `blown`: a plain writable boolean that the GAME sets and clears; the engine must stop driving while it is true.
- [ ] `hyd`: an object with finite `f`, `r` (metres of lift) and `l` (lean), even on a car with no hydraulics (zeros).
- [ ] `P.redline`: rev/min, finite, and identical from frame to frame until the build changes.
- [ ] `P.nos.cap`: seconds, exactly 0 without nitrous. `P.nos` must always be an object.
- [ ] `P.turbo`: `null` without a turbo; with one, an object with a finite `gain` (about 0.15 .. 0.5).
- [ ] `P.gears`: an array whose length is the number of forward gears.
- [ ] `P.drive`: `'FWD'`, `'RWD'` or `'AWD'`.
- [ ] `VehicleSpec.redline` (stock) still in rev/min for `soundFactsFor` (`VanillaThreeScene.tsx:688`).
- [ ] The limiter and the perfect-shift window where the readers draw them: fuel cut above `P.redline + 150`, perfect shift in `0.9 * P.redline .. P.redline + 150`. Or change `audio.ts:16` and `hud.ts:203-204` together with the engine, behind the same switch.
- [ ] With the switch off: `makeVehicle`, `carParams`, `resetVehicle` and plain writable fields unchanged. The reader tests build their fixtures with them and write `V.rpm`, `V.thr`, `V.boost`, `V.shift`, `V.blown`, `V.u`, `V.v`, `V.w`, `V.ax`, `V.beta`, `V.spinR`, `V.hand`, `V.P` directly.

---

## Traps

1. **A non-finite number reaching the sound stops the frame.** `audio.ts:190, 194, 195, 196, 198` call
   `AudioParam.setTargetAtTime(value, ...)`. In a browser that method takes a restricted `float`, so `NaN` or `Infinity`
   throws a `TypeError`. It is thrown at step 4 of the frame, before the car is posed, the camera moved and the HUD drawn.
   The test stubs do not throw, so no test shows it. (`engineSound.ts:176` guards `NaN` inside the model, but the throw comes first.)
2. **`P.redline` that is not exactly stable rebuilds the sound model every frame.** `audio.ts:188` compares with `!==`.
   A redline recomputed with rounding noise, or `NaN`, posts a message each frame and the worklet allocates a new `EngineSound` each time.
3. **`P.redline = Infinity` hangs the tab.** `hud.ts:138` and `hud.ts:207` loop `for (v = 0; v <= maxR; v += 500)`. A very
   large finite value (rad/s mistaken the other way, or rpm x 1000) costs thousands of canvas calls a frame.
4. **`P.turbo` must be `null`, not an empty or zero object, on a car without one.** Truthiness alone shows the BOOST bar
   (`hud.ts:148`, `raceHud.ts:228`) and tells the sound model the engine is turbocharged (`audio.ts:118, 188`): softer exhaust, a whistle.
5. **`spinF` / `spinR` are flags, not slip ratios.** Thresholds: skid marks at `> .5` (`carFeel.ts:36`), smoke level
   directly (27-28, 31), squeal x0.6 (`audio.ts:199`), wheel overspin `1 + 1.5*spin` (`carFeel.ts:23`). A raw slip ratio
   gives no marks at the limit of grip and wild wheels when it exceeds 1. In the old model the flag is also 1 under
   brake lock-up and under the handbrake, so the wheels are drawn spinning 2.5 times faster while locked; that is
   today's look and the switch-off path must keep it.
6. **`gear` 0.** The old model has no neutral. A neutral of 0 prints "0"; `PV.gear < P.gears.length` then counts it as
   a gear below top and the SHIFT light can flash in neutral. A 0-based gear index reads one low everywhere.
7. **`shift` as a flag or as progress 0..1.** `V.shift > 0` dims the gear digit (`hud.ts:147`, `raceHud.ts:221`), cuts
   the engine sound (`audio.ts:16`), drops the classic gain (`audio.ts:196`) and fires the shift click on its rising
   edge (`VanillaThreeScene.tsx:1175`). A value that rests above 0 mutes the engine for good and never clicks again.
8. **`boost` as a pressure.** `hud.ts:148` does not clamp: 1.2 bar draws the bar 20% past its track. The sound model clamps to 0..1, so it would sit at full whistle.
9. **`nos` above `P.nos.cap`, or a different unit.** `hud.ts:135` and `hud.ts:211` do not clamp the fraction.
   `P.nos` missing throws at `hud.ts:135`.
10. **`u` as total speed.** The HUD speed, the lights (`u < -0.5` for reverse), the feel and the sound all take `u` as
    signed forward speed. The camera takes `hypot(vx, vz)`. Feeding total speed into `u` loses reverse and changes the reading in a drift.
11. **`vx`, `vz` not refreshed.** Only the camera reads them here (`cameras.ts:54`), so the fault shows only as a
    camera that never pulls back or widens with speed.
12. **`beta` sign or unit.** Camera lag (`cameras.ts:55`), smoke (`carFeel.ts:30`), marks (`carFeel.ts:37`) and squeal
    (`audio.ts:199`) all take radians. At a standstill the old value is damped by the `max(abs(u), 1.2)` floor; a raw
    `atan2(v, u)` near zero speed flickers to +-PI/2, but the readers gate it by speed (`abs(u) > 8`, `> 6`, `sp/12`), except the camera, which would twitch.
13. **`V.hyd` absent.** `carFeel.ts:11` dereferences `V.hyd.f` inside the guard, so a missing object throws at step 6 of every frame.
14. **`ax` in g, or unsmoothed.** `-ax*.01` rad expects m/s^2; raw per-step acceleration makes the body nod, since the feel only follows at 6/s.
15. **The limiter.** The sound's limiter cut needs `V.rpm > V.P.redline + 150` (`audio.ts:16`). An engine that holds rpm
    exactly at its redline never triggers it and the limiter is silent. The drag HUD's green and red bands (`hud.ts:203-204`) are drawn from the same two numbers.
16. **`thr` is not the pedal.** It is the pedal after the reverse swap and the empty-tank cut. Passing the raw forward
    input makes reversing silent (`load` falls to engine braking) and keeps the engine roaring on an empty tank.
17. **`blown` and `overRev` are written from outside.** `strip/events.ts:264` sets `PV.blown = true`;
    `VanillaThreeScene.tsx:742` clears `blown` and `overRev`. If the object the readers see is a read-only view, or a copy
    refreshed from the new core each step, those writes are lost: the sound never goes quiet and the car keeps pulling.
18. **`V.P` is replaced, not mutated.** `driver.ts:45-46` assigns `V.P = P` on a Garage change, and `audio.test.ts:241`
    does the same. Readers take `PV.P` fresh each frame, so that is safe; but `carFeelAdapter.ts:34` reads `P.drive` once
    per mesh, so a drive-type change on the same mesh does not move the smoke.
19. **`bov` at low frame rates.** The scene tests `V.bov > .38` once per frame after up to 6 sub-steps (0.05 s). The
    old 0.4 s countdown is already below 0.38 after 3 sub-steps (0.4 - 3/120 = 0.375), so the sound can already be
    missed today in any frame that runs 3 or more sub-steps (below 60 fps). A new `bov` with another start value or
    decay changes how often.
20. **Two types named `VehicleSpec`.** `physics.ts:6` (mass, gears, torque table) and `@micar/engine`'s (sourced
    factory figures, used by `cardStats.ts`). A third from `packages/physics` would make three.
21. **`shiftFlash`, `perfect`, `top`, `odo`, `high` look like HUD inputs and are not.** Nothing reads them. The
    PERFECT SHIFT text comes from `perfectT` (`hud.ts:210`) and the banner from `perfectN` (`strip/events.ts:276`).
22. **Idle and overrun in the sound model are fixed in rpm, not in fractions of redline** (`engineSound.ts:18-19`): an
    engine that idles at 1500 or more sounds partly fuel-cut at rest.
23. **Drag opponents are `Vehicle`s on the HUD too** (`hud.ts:230` reads `o.V.x`, `o.V.z`).
