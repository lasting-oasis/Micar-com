# Integration map: car specs, parts and the Garage

Scope: how `apps/sim` turns a car record into the old driving model's inputs, how parts and tune reach it, how the
Garage shows it, and how builds and options are stored. All paths are under `/home/user/Micar-com/apps/sim/` unless
they start with `packages/`. Line numbers are from the tree as read on 2026-11-14. The old model is
`src/world/physics.ts` (184 lines); nothing here was edited.

Verified green before writing (`npx vitest run`, 0.98 s): `src/world/data.test.ts` (18), `src/world/garage.test.ts` (9),
`src/world/options.test.ts` (5), `src/carSpecs.test.ts` (5), `src/world/rental.test.ts` (13).

---

## 0. The pipeline in one picture

```
Car (types.ts:13)  {make, model, bodyStyle?, rental?, testCar?}
   │  specFor()                                   data.ts:233     (~20-80 ms first time per car type, then cached)
   ▼
VehicleSpec (physics.ts:6)   archetype + style chassis, fitted to carSpecs.ts figures through the OLD model
   │                                   StripRecord.cars[carId] = { cfg: CarCfg (cfg.perf: PerfCfg), tune: Tune, owned: string[] }
   │  carParams(spec, cfg.perf, tune)             physics.ts:48
   ▼
Params (physics.ts:11)  ── makeVehicle ─► Vehicle ─► stepVehicle (Driver, 120 Hz)
   │
   ├─ simStats(P)   physics.ts:178   30 Hz straight-line run ─► Garage stat bars, fitSpec, AI pace
   └─ dynoCurve(P)  physics.ts:184   49 points ─► Garage dyno chart only
```

Call sites of the pipeline (non-test code):

| What | Where | Notes |
|---|---|---|
| `specFor` | `src/VanillaThreeScene.tsx:687` (in `specOf`, cached per `id\|make\|model\|style\|rental\|testCar`), `src/world/GarageMenu.tsx:31` (`useMemo` per car) | two separate calls → two different objects, equal by value |
| `carParams` | `src/world/driver.ts:39` (ctor), `:45` (`rebuild`), `src/world/garage.ts:283`, `src/world/data.ts:198` (`stockStats`), `src/world/strip/scene.ts:141` (placeholder sedan) | always `(spec, cfg.perf, tune)` |
| `simStats` | `src/world/data.ts:198` (fit), `src/world/garage.ts:104` (bars), `src/world/strip/events.ts:76-77` (`playerTopMs`, `playerAccel`: AI pace at `events.ts:120`, outrun at `strip/scene.ts:409`) | not cached in events.ts: 2 runs per event start |
| `dynoCurve` | `src/world/garage.ts:314` (`drawDyno`) only | |
| `torqueAt`, `launchRpm` | inside physics.ts only (plus tests) | |

---

## 1. Old-model types this area produces and consumes (`src/world/physics.ts`)

| Type | Line | Fields (units) |
|---|---|---|
| `VehicleSpec` | 6 | `id`, `name`, `drive: 'FWD'\|'RWD'\|'AWD'`, `mass` kg, `a` m (CG→front axle), `b` m (CG→rear axle), `h` m (CG height), `cd`, `area` m², `redline` rpm, `r` m (wheel radius), `fin` (final drive), `gears: number[]` (forward ratios, 1st first), `tq: [rpm, N·m][]`, `gripMul?` |
| `PerfCfg` | 8 | nine keys, each `0\|1\|2\|3`: `engine ecu turbo trans susp nos tires brakes weight` |
| `Tune` | 9 | eight sliders, each −1..1 (0.1 steps): `turbo nitrous aero bias ride stiff steer gears` |
| `Params` | 11-22 | see section 3 |

`simStats` return (physics.ts:178): `{ t100: s\|null, t200: s\|null, top: km/h, hp: integer, hpRpm: rounded to 100, grip: P.mu, brake: P.brakeMu }`.
`dynoCurve` return (physics.ts:184): 49 rows `[rpm, N·m, hp]`, rpm from 1000 to `P.redline` inclusive.
Horsepower everywhere is `N·m × rpm / 7121` (mechanical hp).

---

## 2. `src/world/data.ts` — specs

### 2.1 The base records

| Thing | Line | What it is |
|---|---|---|
| `CARS` | 14-25 | Night Tuner's five authored `VehicleSpec`s: civet (FWD 1180 kg), kanjo (FWD 1020), ronin (RWD 1340), tsubasa (AWD 1540), brute (RWD 1720). All six-speed. |
| `ARCHETYPES` | 33-42 | one `VehicleSpec` per `BodyStyle`; `id` = the style, `name` = 'Hatchback' etc. |
| `FLEET_SPECS` | 44-46 | clones of the five `CARS` records (the rental fleet). No `gripMul`. |
| `FLEET_NAMES` | 47 | `'Civet R'→'civet'`, `'Kanjo S'`, `'Ronin GT'`, `'Tsubasa R4'`, `'Brute 440'` (key is `` `${make} ${model}` ``) |
| `STYLES` | 48 | `['hatchback','coupe','sedan','sports','truck','suv','van']` |
| `STYLE_CHASSIS` | 193-196 | per style `{ gripMul, h? }` |

Archetype → base record:

| Style | Base | Overrides | `STYLE_CHASSIS` gripMul / h |
|---|---|---|---|
| hatchback | civet | — | 1.00 / — |
| coupe | ronin | — | 1.02 / — |
| sedan | tsubasa | — | 1.00 / — |
| sports | ronin | `redline 8100`, `tq` = kanjo's curve × (258/170) | 1.06 / — |
| truck | brute | `mass 2300, h .62, cd .42, area 2.9` | 0.90 / 0.62 |
| suv | brute | `tq × 0.85, mass 2000, h .58, cd .38, area 2.7, drive AWD` | 0.94 / 0.58 |
| van | tsubasa | `mass 1900, h .60, cd .36, area 2.8, drive FWD` | 0.92 / 0.60 |

### 2.2 `specFor(car)` in full (data.ts:233-249)

Input: `{ make?, model?, bodyStyle?, rental?, testCar? }`. Output: a fresh deep clone every call (`JSON` clone, line 10).

Order of decisions:

1. **Fleet** (234-235): if `car.rental || car.testCar` and `` FLEET_NAMES[`${make} ${model}`] `` exists → `clone(FLEET_SPECS[key])`. Returned before the cache; no `gripMul`, authored `h`, `id` is the fleet key (`'ronin'`), `name` is `'Ronin GT'`.
2. **Style** (236): `isStyle(car.bodyStyle) ? car.bodyStyle : 'sedan'`. Any unknown or missing style is a sedan.
3. **Cache** (237-239): key `` `${make}|${model}|${style}|${!!rental}` `` (not `testCar`). Module-level `Map`, never cleared. A hit returns `clone(hit)`.
4. **Base** (240-243): `clone(ARCHETYPES[style])`, then `base.gripMul = STYLE_CHASSIS[style].gripMul`, and `base.h = ch.h` when given.
5. **Result** (245-246):
   - `hasModelSpec(car)` (the make+model is in `carSpecs.ts` `MODEL_SPECS`) → `{ ...fitSpec(base, getCarSpec(car, style)), name: 'Make Model' }`. `id` stays the style.
   - else `rowByGameName(make, model)` (a finished 3D model listed by its game name) → `{ ...base, name: 'Make Model' }`: **unfitted**, drives on the style archetype.
   - else `base` (id and name are the style's: `'sports'`, `'Sports'`).

```ts
const out = hasModelSpec(car) ? { ...fitSpec(base, getCarSpec(car, style)), name: `${car.make} ${car.model}` }
  : rowByGameName(car.make, car.model) ? { ...base, name: `${car.make} ${car.model}` } : base;
```

The same make+model without `rental`/`testCar` takes the archetype path even for a fleet name (data.test.ts:40).

### 2.3 `fitSpec(base, real)` in full (data.ts:201-226)

What is fitted to what. `real` is a `CarSpec` (carSpecs.ts:5): `engine` string, `hp`, `weightLb`, `zeroToSixty` s, `topSpeedMph`, `drive`.

| Step | Lines | Sets | From | Method |
|---|---|---|---|---|
| mass | 202 | `out.mass` kg | `real.weightLb × 0.4536` | direct |
| drive | 202 | `out.drive` | `real.drive`, `'4WD' → 'AWD'` | direct |
| redline | 203 | `out.redline` | regex on `real.engine`: `/Hybrid/` → 6000; else `/V8/` → 6200; else `/Turbo/` → 6500; else the archetype's | direct. `'EcoBoost'` does not match `/Turbo/`; `'Twin-Turbo'` does. The `tq` rpm points are not moved. |
| targets | 205 | `topTarget = topSpeedMph × 1.609` km/h; `t100Target = zeroToSixty + 0.3` s | | 0-60 mph is treated as 0-100 km/h minus 0.3 s |
| torque seed | 208-210 | `out.tq = baseTq × k` | `stockStats(...).hp ≈ real.hp` | bisection of k in [0.1, 6], 12 rounds. Only a starting point: overwritten below. |
| final drive | 221-223 | `fit.fin = baseFin × m` | `stockStats(...).top` vs `topTarget` | bisection of m in [0.6, 1.6], 14 rounds; `top < target → hi = mid` (taller gearing). Assumes top speed falls as `fin` rises. |
| torque | 212-217, 223 | `fit.tq = baseTq × k` | smallest k whose `t100 ≤ goal`, `goal = max(t100Target, t100(k = 8) × 1.02)` | bisection of k in [0.1, 8], 14 rounds. The plateau clause: a traction-limited launch cannot reach the target, so it asks for 2% above the best possible. |
| repeat | 220 | | | final drive then torque, twice |

Never fitted: `a`, `b`, `h`, `cd`, `area`, `r`, `gears`, the shape of `tq`, `gripMul`. They stay the archetype's (plus the style's `gripMul`/`h`).

`stockStats` (198) is `simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF))`: the fit is made **through the old model**, at stock parts and
centred sliders, with the 30 Hz `simStats` integration. One `fitSpec` = 12 + 2 × (14 + 1 + 14) = 70 `simStats` runs = 147 000 `stepVehicle` calls.
Measured here: about 80 ms per car cold (the code comments say ~20 ms).

Consequence, measured with the current tree (stock, `TUNE_DEF`):

| Car (style) | real hp / 0-60 / top mph | fitted: sim hp / t100 s / top km/h | fin | peak N·m | mu |
|---|---|---|---|---|---|
| Toyota Camry (sedan) | 203 / 7.6 / 135 | 248 / 8.20 / 217.2 | 4.964 | 292 | 1.0200 |
| Honda Civic (sedan) | 158 / 8.2 / 125 | 207 / 8.77 / 201.1 | 5.362 | 243 | 1.0200 |
| Toyota Prius (hatchback) | 121 / 10.0 / 112 | 148 / 10.33 / 180.2 | 5.542 | 183 | 1.0200 |
| Ford F-150 (truck) | 325 / 6.2 / 107 | 327 / 6.53 / 208.3 | 5.920 | 478 | 0.9180 |
| Ford Mustang (sports) | 460 / 4.3 / 155 | 498 / 5.80 / 249.4 | 4.044 | 577 | 1.0812 |
| Chevy Corvette (sports) | 490 / 3.0 / 184 | 603 / 5.33 / 314.6 | 2.400 | 699 | 1.0812 |
| BMW M4 (coupe) | 473 / 3.8 / 155 | 448 / 6.07 / 249.4 | 4.234 | 523 | 1.0404 |
| Toyota Supra (sports) | 382 / 3.9 / 155 | 430 / 5.83 / 249.4 | 4.235 | 477 | 1.0812 |

The fitted `tq` and `fin` are artefacts of the old model: sim hp is not the real hp, and RWD cars sit on the traction plateau
(Mustang 5.80 s against a 4.6 s target). The F-150's top speed (208 km/h against a 172 km/h target) shows the gearing bound `m ≤ 1.6` being hit.

Stock baselines of the archetypes and fleet (old model, `TUNE_DEF`):

| Spec | mass | drive | redline | sim hp @ rpm | t100 s | t200 s | top km/h | h after tune |
|---|---|---|---|---|---|---|---|---|
| hatchback = fleet civet | 1180 | FWD | 7200 | 157 @ 6600 | 8.47 | 46.80 | 208.4 | 0.465 |
| fleet kanjo | 1020 | FWD | 8100 | 168 @ 7600 | 7.70 | 31.13 | 217.2 | 0.456 |
| coupe = fleet ronin | 1340 | RWD | 7300 | 221 @ 6700 | 6.40 | 28.50 | 230.8 | 0.446 |
| sedan = fleet tsubasa | 1540 | AWD | 7000 | 264 @ 6600 | 6.17 | 25.33 | 236.9 | 0.465 |
| fleet brute | 1720 | RWD | 6200 | 301 @ 5600 | 6.13 | 24.70 | 234.4 | 0.484 |
| sports | 1340 | RWD | 8100 | 255 @ 7600 | 6.23 | 23.27 | 239.8 | 0.446 |
| truck | 2300 | RWD | 6200 | 301 @ 5600 | 7.43 | 43.17 | 206.2 | 0.577 |
| suv | 2000 | AWD | 6200 | 256 @ 5600 | 7.57 | 43.73 | 206.2 | 0.539 |
| van | 1900 | FWD | 7000 | 264 @ 6600 | 8.93 | 42.50 | 213.0 | 0.558 |

(Archetype rows are the raw `ARCHETYPES` records, `gripMul` unset, so `mu = 1.02`. `specFor` adds the style's `gripMul`.)
All parts at tier 3 on the sedan archetype: 1378 kg, redline 7450, 545 hp, t100 2.77 s, top 294.0 km/h, mu 1.2774, B 22.5.

### 2.4 Parts and tune data (data.ts)

| Thing | Line | Content |
|---|---|---|
| `CarCfg` | 57 | `VisualCfg & { perf: PerfCfg }` |
| `PERF` | 86 | per `keyof PerfCfg`: `[name, prices[4], description]` |
| `TIER`, `TIER_STAGE` | 87 | `['Stock','Street','Pro','Extreme']`, stage needed `[1, 1, 2, 3]` |
| `CATS['perf.<k>']` | 88 | generated from `PERF`: 4 items, `v` = tier 0..3, `p` = price, `stage` = `TIER_STAGE[i]`, `perf: true`, `cam: 'front34'`. Turbo tier 0 is named `'None'`. |
| `TUNES` | 91-100 | the eight sliders with their end labels and descriptions |
| `TUNE_DEF` | 101 | all eight at 0 |
| `STOCK_CFG` | 106 | stock visual cfg, `perf` all 0 |
| `StripRecord` | 159 | `{ rep, cars: Record<carId, { cfg: CarCfg; tune: Tune; owned: string[] }>, wins, best }` |
| `freshStrip` | 160 | `{ rep: 0, cars: {}, wins: {}, best: {} }` |
| `carState(rec, carId)` | 167-169 | **creates** the car's entry (`clone(STOCK_CFG)`, `clone(TUNE_DEF)`, `[]`) when missing, and returns it |
| `getV(cfg, k)` | 171 | `k` starting `'perf.'` reads `cfg.perf[k.slice(5)]`, else `cfg[k]` |
| `withV(cfg, k, v)` | 172-176 | a **clone** of cfg with the key set |
| `okey(k, v)` | 177 | `k + '=' + v`, e.g. `'perf.engine=2'`: the entries of `owned` |
| `isOwned(cfg, owned, k, v)` | 179-182 | free in the catalogue, or fitted now, or `owned` has `okey(k, v)` |
| `stageOf(rep)` | 105 | stage 1..5 from `STAGE_REP = [0, 400, 1100, 2200, 3800]` |

Perf prices: engine 0/1800/4800/9800, ecu 0/900/2400/5200, turbo 0/2600/6200/11500, trans 0/1400/3600/7200, susp 0/1200/3200/6400,
nos 0/1600/3800/7000, tires 0/900/2600/5200, brakes 0/900/2200/4400, weight 0/1200/3400/6800. A higher tier does not need the lower one.

What the catalogue promises the player about each part and slider (the text an adapter's effect has to honour):

| Part | Promise (data.ts:86) | Slider | lo → hi and promise (data.ts:92-99) |
|---|---|---|---|
| engine | More torque across the range | turbo | Low end → High end: low spools fast with less peak boost, high waits then hits harder |
| ecu | Raises the redline | nitrous | Duration → Power |
| turbo | Spools with revs, hits up top | aero | Top speed → Downforce: grip at speed, costs top end |
| trans | Quicker shifts, less drivetrain loss | bias | Rear → Front: rear rotates under braking, front is stable |
| susp | Sharper turn-in, more composure | ride | High → Low: lower CG, less weight transfer |
| nos | Bottle and flow, refills slowly | stiff | Soft → Stiff: stiff turns in sharper, soft is calmer in a slide |
| tires | More grip for cornering, braking and launches | steer | Slow → Quick: wheel angle per input |
| brakes | Shorter stops | gears | Acceleration → Top speed (final drive) |
| weight | Lighter car | | |

---

## 3. `carParams(spec, perf, tune)` — every formula (physics.ts:48-64)

`p` = perf tier 0..3, `t` = tune slider −1..1, `G9 = 9.81`.
Lookup tables (physics.ts:46): `NOS_CAP = [0, 4, 6, 8]` s, `NOS_POW = [0, .3, .42, .55]`, `SHIFT_T = [.42, .32, .24, .17]` s, `DT_EFF = [.86, .89, .92, .94]`.

Helpers: `aero = (t.aero + 1) / 2` (0..1), `s01 = (t.stiff + 1) / 2` (0..1), `L = spec.a + spec.b`.

| `Params` field | Formula | Fed by | Value at tier 0 / 1 / 2 / 3, or slider −1 / 0 / +1 |
|---|---|---|---|
| `mass` kg | `spec.mass × (1 − .035 × p.weight)` | weight | ×1 / .965 / .93 / .895 |
| `a`, `b`, `r`, `gears`, `tq`, `drive` | copied from spec | — | |
| `L` m | `spec.a + spec.b` | — | |
| `h` m | `spec.h × (1 − .14 × (t.ride + 1) / 2)` | ride | ×1.00 / **.93** / .86 |
| `Iz` kg·m² | `.16 × mass × L²` | weight (via mass) | |
| `mu` | `1.02 × (1 + .055 × p.tires) × (1 + .025 × p.susp) × (spec.gripMul ?? 1)` | tires, susp | tires ×1 / 1.055 / 1.11 / 1.165; susp ×1 / 1.025 / 1.05 / 1.075 |
| `B` (tyre curve stiffness) | `16 + 1.5 × p.susp + 4 × s01` | susp, stiff | susp +0 / 1.5 / 3 / 4.5; stiff +0 / **2** / 4 |
| `yawDamp` | `1.3 − .6 × s01` | stiff | 1.3 / **1.0** / 0.7 |
| `brakeMu` | `1 + .06 × p.brakes` | brakes | 1 / 1.06 / 1.12 / 1.18 |
| `bias` (front share) | `.62 + .12 × t.bias` | bias | .50 / .62 / .74 |
| `cdA` N per (m/s)² | `.5 × 1.22 × spec.cd × spec.area × (1 + .35 × aero)` | aero | ×1.00 / **1.175** / 1.35 |
| `downK` N per (m/s)² | `aero × .4 × mass × G9 / 55²` | aero, weight | downforce = `downK × u²`: 0 / **20%** / 40% of weight at 55 m/s |
| `roll` N | `.013 × mass × G9` | weight | |
| `tqMul` | `(1 + .11 × p.engine) × (1 + .045 × p.ecu)` | engine, ecu | engine ×1 / 1.11 / 1.22 / 1.33; ecu ×1 / 1.045 / 1.09 / 1.135 |
| `peakT` N·m | `max(spec.tq[i][1]) × tqMul` | engine, ecu | used only for engine braking (physics.ts:117); no turbo in it |
| `redline` rpm | `spec.redline + 150 × p.ecu` | ecu | +0 / 150 / 300 / 450 |
| `idle` rpm | `900` | — | |
| `rev` | `3.2` (reverse ratio) | — | |
| `fin` | `spec.fin × (1 + .12 × t.gears)` | gears | ×.88 / 1 / 1.12 (hi = "Top speed" label, but +1 **raises** the ratio: see Traps) |
| `eff` | `DT_EFF[p.trans]` | trans | .86 / .89 / .92 / .94 |
| `shiftT` s | `SHIFT_T[p.trans]` | trans | .42 / .32 / .24 / .17 |
| `turbo` | `p.turbo ? { gain, spool } : null` | turbo | tier 0 → `null` |
| `turbo.gain` | `(.11 + .09 × p.turbo) × (1 + .2 × t.turbo)` | turbo, turbo slider | base .20 / .29 / .38; slider ×.8 / 1 / 1.2 |
| `turbo.spool` s | `clamp(.5 + .35 × t.turbo, .18, .9)` | turbo slider | .18 / .5 / .85 (same at every tier) |
| `nos.cap` s | `NOS_CAP[p.nos] × (1 − .3 × t.nitrous)` | nos, nitrous | base 0 / 4 / 6 / 8; slider ×1.3 / 1 / .7 |
| `nos.pow` | `NOS_POW[p.nos] × (1 + .3 × t.nitrous)` | nos, nitrous | base 0 / .30 / .42 / .55; slider ×.7 / 1 / 1.3 |
| `nos.regen` s per s | `NOS_CAP[p.nos] / 55` | nos | refills in 55 s whatever the slider |
| `split` [front, rear] | FWD `[1, 0]`, RWD `[0, 1]`, AWD `[.4, .6]` | spec.drive | |
| `steerMul` | `1 + .2 × t.steer` | steer | .8 / 1 / 1.2 |
| `spec` | the `VehicleSpec` object passed in (same reference) | — | used as a cache identity by the Garage |

How torque is read (physics.ts:65): `torqueAt(P, rpm, boost) = curveAt(P.tq, rpm) × P.tqMul × (turbo ? 1 + gain × boost × (.55 + .45 × min(1, rpm / redline)) : 1)`.
Nitrous multiplies torque by `1 + P.nos.pow` while firing (physics.ts:108).

**The centred slider is not a neutral car.** At `TUNE_DEF`: `h = 0.93 × spec.h`, `cdA` is 17.5% above `cd × area`, there is downforce worth 20% of the
weight at 55 m/s, `B = 18` (not 16), `yawDamp = 1.0`. Every fit and every test baseline is taken at this point.

---

## 4. `simStats` and `dynoCurve` (physics.ts:177-184)

`simStats(P)`:

1. `makeVehicle(P)`: at rest, 1st gear, `rpm = idle`, bottle full.
2. Input `{ ...NO_INPUT, fwd: 1 }`: full throttle, automatic (`manual: false`), no nitrous, no steering, `drift = false`.
3. 2100 steps of `stepVehicle(V, I, 1/30, false)` = 70 s. **dt is 1/30 s**, the game steps at 1/120 s (`driver.ts:11`).
4. `t100`/`t200`: first time `V.u × 3.6 ≥ 100` / `200` (null when never reached: the Prius has no `t200`). `top`: the largest `V.u × 3.6` in the 70 s.
5. `hp`, `hpRpm`: the best of 41 samples from 1000 rpm to `P.redline` of `torqueAt(P, r, boost) × r / 7121`, with `boost = clamp((r − 2200) / 3000, 0, 1)` when there is a turbo, else 0. `hp` rounded, `hpRpm` rounded to 100.
6. `grip = P.mu`, `brake = P.brakeMu` (returned, read by nobody outside tests).

`dynoCurve(P)`: 49 rows `[rpm, torqueAt, torqueAt × rpm / 7121]`, rpm `1000 + i × (redline − 1000) / 48`, the same boost rule. Nitrous is in neither.

Who calls them:

| Caller | Line | Uses |
|---|---|---|
| `stockStats` → `fitSpec` | data.ts:198, 206, 209, 213, 215, 222 | `hp`, `t100` (`?? 1e9`), `top` |
| `statsOf` (Garage bars) | garage.ts:104 | `top`, `t100`, `hp`, `hpRpm` |
| `playerTopMs(P)` | strip/events.ts:76 | `top / 3.6` m/s |
| `playerAccel(P)` | strip/events.ts:77 | `t100 ? 100 / 3.6 / t100 : 3` m/s² |
| `drawDyno` | garage.ts:314 | both curves; x axis to `max(Pn.redline, Pp.redline) + 300`, redline mark at `Pp.redline` |

---

## 5. `src/world/garage.ts` — the Garage as a pure model

### 5.1 What it needs from outside (`GarageCtx`, garage.ts:17-36)

```ts
car: () => { id: string; spec: VehicleSpec; state: CarStateLite };   // state = { cfg, tune, owned }
buy: (key, v, price) => void;  equip: (key, v) => void;  tune: (t: Tune) => void;
getOpt?: (k: string) => unknown;  setOpt?: (k: string, v: unknown) => void;
```

### 5.2 Params and their caches (garage.ts:280-287)

```ts
private params(cfg: CarCfg, tune: Tune): Params {
  const spec = this.ctx.car().spec, key = spec.id + '|' + spec.name + '|' + JSON.stringify(cfg.perf) + JSON.stringify(tune);
  let e = this.pCache.find(p => p.key === key && p.P.spec === spec);
  if (!e) { e = { key, P: carParams(spec, cfg.perf as PerfCfg, tune) }; this.pCache.unshift(e); this.pCache.length = Math.min(this.pCache.length, 8); }
  return e.P;
}
```

- `currentParams()` = params of the saved `cfg`/`tune`; `previewParams()` = params of `shown()` (the previewed part or the dyno's working tune).
- The cache holds 8 entries, matched by key **and** by `P.spec === spec` (object identity).
- `statCache` (garage.ts:100) is a `WeakMap<Params, …>`: one `simStats` run per `Params` object.
- `stats().changed` is `Pn !== Pp` (garage.ts:298): object identity decides whether the panel says "Preview" or "Current".

### 5.3 The stat bars (garage.ts:101-115, 289-305)

| Bar | Value 0..1 (clamped) | Text |
|---|---|---|
| Top speed | `(s.top − 180) / (340 − 180)`, km/h | `speedStr(top)`: `Math.round(kmh × .6214) + ' mph'` when option `units === 'mph'`, else `Math.round(kmh) + ' km/h'` |
| Acceleration | `(9.5 − (s.t100 \|\| 12)) / (9.5 − 2.5)`, seconds | `t100.toFixed(1) + ' s 0-100'`, or `'-- s 0-100'` |
| Handling | `(P.mu × P.B / 16 − 1.0) / (1.5 − 1.0)` | empty |
| Braking | `(P.brakeMu − 1) / .2 + .2` | empty |
| Nitrous | `P.nos.cap × P.nos.pow / 5` | `cap.toFixed(1) + ' s'`, or `'none'` |

Each bar is 12 segments: `a = round(now × 12)`, `c = round(preview × 12)`; a segment is `'on'` below both, `'up'` below `c` only, `'down'` below `a` only.
Header line (GarageMenu.tsx:193): `{hp} hp @ {hpRpm} rpm · {Math.round(Pp.mass)} kg · {Pp.drive}` (from the **preview** params).
Fields of `Params` the Garage reads directly: `mu`, `B`, `brakeMu`, `nos.cap`, `nos.pow`, `mass`, `drive`, `redline`, `spec`.

### 5.4 Buying, equipping, tuning (garage.ts:206-277)

| Action | Line | Behaviour |
|---|---|---|
| `select(i)` in a part category | 209 | `preview = { cfg: withV(cfg, cat, item.v), tune }`: the stat panel and turntable show the part before it is bought |
| `activate()` in a part category | 250-258 | order of checks: already fitted → toast; `it.stage > ctx.stage()` → refuse; `isOwned` → `ctx.equip(key, v)`; `cash < it.p` → refuse; else `ctx.buy(key, v, it.p)` |
| enter the dyno | 218 | `preview = { cfg, tune: clone(tune) }` |
| `adjust(dir)` | 241-246 | `tune[k] = clamp(round((tune[k] + dir × .1) × 10) / 10, −1, 1)` on the preview only |
| `back()` out of the dyno | 230-233 | `ctx.tune(clone(t))` once, only when the JSON differs from the saved tune |
| `exit()` | 239 | backs out to the root (so a dyno tune is saved on closing) |

### 5.5 Options menu (garage.ts:77-85, 127, 179-181, 265-268)

```ts
export const OPTS: { k: string; n: string; vals: unknown[]; lab: string[]; d?: string }[] = [
  { k: 'manual', n: 'Transmission', vals: [false, true], lab: ['Automatic', 'Manual'], d: '…' },
  { k: 'units', … }, { k: 'cam', … }, { k: 'mute', … }, { k: 'controls', … },
  { k: 'models', n: 'Car models', vals: [true, false], lab: ['Detailed', 'Simple'], d: '…' },
];
const OPT_DEF: Record<string, unknown> = { ...OPTION_DEFAULTS };
```

- Read: `opt(k)` = `ctx.getOpt?.(k)`, falling back to the model's own copy when that is `undefined` (line 127).
- Row status: `o.lab[Math.max(0, o.vals.indexOf(this.opt(o.k)))]` (line 180): an unknown stored value shows the first label.
- Activate: the next value in `vals`, written to the model's copy and `ctx.setOpt?.(k, v)` (lines 266-267).
- The root menu's description of the Options row lists them by name (line 66): `'Transmission, units, camera, sound, touch controls, car models.'`

---

## 6. `src/world/GarageScene.ts` — the turntable

No physics. Two inputs from the build reach it:

| Input | Line | Effect |
|---|---|---|
| `tune.ride` | 31, 116, 129 | `rideYOf = −.07 × (ride + 1) / 2 × WORLD_PER_M`: the body sits up to 7 cm lower (3.5 cm at the centred slider) |
| `cfg.perf.brakes` | 125 | `attachParts(car, cfg, style, cfg.perf.brakes)` → caliper colour |

Imports `clamp` and the `Tune` type from physics.ts (lines 10, 12). `setCar` rebuilds on `JSON.stringify([cfg, style, meshId])`.

## 7. `src/world/parts.ts` — how perf tiers reach it

Only the brake tier, as a plain number, and only for looks:

- `attachParts(car, cfg: VisualCfg, style, perfBrakes: number)` (parts.ts:256) passes it to `replaceWheels(car, cfg, anchors, perfBrakes)` (467, 504).
- `CALIPER = ['#4a4d55', '#c41a1a', '#e0b21b', '#ff6a13']` (22); `color: CALIPER[perfBrakes] ?? CALIPER[0]` (529).
- Callers: `GarageScene.ts:125`, `VanillaThreeScene.tsx:698` (`fitKit`), both with `cfg.perf.brakes`.
- parts.ts imports nothing from physics.ts (types from data.ts only, line 11).

## 8. `src/world/GarageMenu.tsx` — wiring to the store

| What | Line | Detail |
|---|---|---|
| spec | 31 | `specFor({ make, model, bodyStyle: car.bodyStyle, rental, testCar })` in `useMemo` keyed on those fields and `car.id`. **Raw `car.bodyStyle`** (no `deriveStyle`). |
| visual style | 32 | `car.bodyStyle ?? deriveStyle(car.model)`, checked against `STYLES` |
| fallback build | 33 | `{ cfg: clone(STOCK_CFG), tune: clone(TUNE_DEF), owned: [] }` when the record has no entry |
| "Your cars" drive tag | 36 | `getCarSpec(c, style).drive`, `'4WD' → 'AWD'`: from carSpecs.ts, not from the driving spec |
| ctx.car | 49 | `{ id, spec, state: strip.cars[carId] ?? fallback }` (reads the record, never adds to it) |
| ctx.buy / equip / tune | 51-53 | `buyStripPart(id, key, v, price)`, `equipStripPart(id, key, v)`, `setStripTune(id, t)` |
| ctx.getOpt / setOpt | 59-60 | `getOption(k)`; `setOption(k, v)` then side effects: `'mute'` → `audio.setMute`, `'models'` → `setCarModels` |
| turntable | 125 | `sc.setCar(style, shown.cfg, shown.tune, carMeshId(make, model))` every render |
| stats | 130-132 | `g.stats()` **on every render**; `drawDyno(canvas, stats.Pn, stats.Pp)` when the dyno panel is up |
| header | 158 | `{spec.name} · {spec.drive}` |
| leaving | 93-94 | `g.exit()` (saves the tune), `useDriveUi.setState({ driveCar })`, `closeGarage()` |

Mounted lazily from `src/App.tsx:22, 2164-2167, 2193-2196` while `garageCarId` is set. It is a separate chunk from the 3D scene.

---

## 9. `src/carSpecs.ts`, `src/carCatalog.ts`, `src/carModels.ts`

### carSpecs.ts

- `CarSpec` (5-12): `{ engine: string; hp; weightLb; zeroToSixty; topSpeedMph; drive: 'FWD'|'RWD'|'AWD'|'4WD' }`. Constructor `S(engine, hp, weightLb, zeroToSixty, topSpeedMph, drive)`.
- `MODEL_SPECS` (17-65): 36 real models (Toyota 8, Ford 7, Honda 7, Chevy 7, BMW 7) + the 5 fleet cars (keys `'Civet R'` …). Not exported.
- `STYLE_SPECS` (68-76): one "old, tired" record per body style.
- `getCarSpec(car, fallbackStyle = 'sedan')` (80-83): `MODEL_SPECS['Make Model'] || STYLE_SPECS[car.bodyStyle || fallbackStyle] || STYLE_SPECS.sedan`. `MAKE_ALIASES = { Chevrolet: 'Chevy' }`.
- `hasModelSpec(car)` (85-88): whether `'Make Model'` is in `MODEL_SPECS` (after the alias).
- `STYLE_SPECS` never reaches the driving model: `specFor` calls `fitSpec` only when `hasModelSpec` is true, so `getCarSpec`'s style fallback is unused there.
- Other readers: car cards (`App.tsx:779, 1865, 1880, 2482`), `cardStats.ts:29-30`, `CardStatsPanel.tsx:23`, the engine-sound facts (`VanillaThreeScene.tsx:688`, the `engine` string), the Garage's drive tag.
- The fleet rows are derived from the old model ("figures from the driving model", line 59) and pinned to it by `carSpecs.test.ts`.

### carCatalog.ts

- `ORIGINAL` (6-37): 5 makes × models, each `{ model, style }`: the `style` is the `bodyStyle` a generated car carries, and so the archetype it drives on.
  Note: `Ford Mustang → 'sports'`, `BMW M4 → 'coupe'`, `Toyota Prius → 'hatchback'`.
- `CAR_CATALOG` (40-41): the originals plus every `CAR_MODELS` row not already there, under its **game** make and model.

### carModels.ts

- Row shape (7): `CarModelRow = { id, make, model, style, gameMake, gameModel }`; `id = modelIdOf(make, model)` (`'chevrolet-tahoe'`).
- Source: `carModels.json`, 48 makes, 362 rows, each `'real model|body style|game model'` under `'real make|game make'`.
- `rowByGameName(make?, model?)` (24): the row whose `gameMake|gameModel` matches, or `null`.
- In `specFor` it only renames an unfitted archetype (data.ts:246). Cars named by a game name are not in `MODEL_SPECS`, so they are never fitted.
- `realNameOf(gameMake, gameModel)` (26-29) gives the real make and model behind a game name: the way from a world car to real published figures.

---

## 10. `src/types.ts` and `src/store.ts` — how a car and its build are stored and synced

### The car (types.ts:13-42)

Fields the driving pipeline reads: `id`, `make`, `model`, `bodyStyle?`, `rental?`, `testCar?`, `loan?`, `fuel?` (0-100; an empty tank cuts the throttle in `Driver.stepFrame`, driver.ts:60-61).
`condition`, `bodyCondition`, `mechanicCondition`, `mileage`, `year` do **not** reach `carParams`.
`Player.strip?: StripRecord` (types.ts:125), `Player.tester?` (108), `Player.money`.

### The build record

`StripRecord.cars[carId] = { cfg: CarCfg, tune: Tune, owned: string[] }`, keyed by the inventory car's `id`. No version field. Plain JSON.

| Store member | store.ts line | Behaviour |
|---|---|---|
| `strip: StripRecord \| null` | 170, 433 | mirror of `gameState.players[me].strip` |
| `mirrorStrip(state, id)` | 216-222 | copies `strip` and `octane` out of a server state when present |
| mirrored on | 524 (`init`), 556 (`update`), 566 (`patch`, only when the patch carries this player) | the server's record replaces the local one wholesale |
| `editStripCar(rec, carId, f)` | 206-210 | clones the whole record (`JSON`), runs `f(carState(next, carId))`, returns the clone: a **new object** every edit |
| `openGarage(carId, tab)` | 450-455 | refuses a rental (`isRental`); sets `strip: s.strip ?? freshStrip()` |
| `buyStripPart(carId, key, v, price)` | 457-465 | no-op when `money < price`; emits `strip_buy_part { carId, key, v, price }`; then optimistically adds `okey(key, v)` to `owned`, `cfg = withV(cfg, key, v)`, `money −= price` |
| `equipStripPart(carId, key, v)` | 466-469 | emits `strip_equip { carId, key, v }`; `cfg = withV(cfg, key, v)` |
| `setStripTune(carId, tune)` | 470-473 | emits `strip_tune { carId, tune }`; `c.tune = clone(tune)` |
| `strip_denied` | 577 | shows `driveNotice`; the server's next state corrects the optimistic copy |
| `disconnect` | 482 | `strip: null` |

### The server side of the same three messages (`server.ts`)

| Message | Line | Checks, in order | Writes |
|---|---|---|---|
| `strip_buy_part` | 1487-1507 | owns the car; `key` string, `v` string or number; not a rental (`dealerCar`); `partPrice(key, v, stageOf(rep))` (key in `CATS`, value in its items, stage); when not `isOwned`: `price === q.price`, enough money, then charges | `owned` gets `okey`, `cfg = withV(...)`, `persistAccount`, `broadcastState` |
| `strip_equip` | 1509-1523 | owns; types; not a rental; `partPrice` ok (stage applies to free parts too); `isOwned`; not already fitted | `cfg = withV(...)` |
| `strip_tune` | 1525-1534 | owns; not a rental | `tune = clampTune(tune)`; `persistAccount(player, false)` (the 15 s autosave writes it) |
| `bay_order` | 1536-1563 | the bay's work orders; `applyOrder` writes `cfg`/`owned` the same way (`src/bay/order.ts:190-191`) | |

`partPrice` is `src/world/payout.ts:130-137`; `clampTune` is `payout.ts:140-148`:

```ts
for (const { k } of TUNES) { const n = src[k]; out[k] = typeof n === 'number' && Number.isFinite(n) ? (Math.round(Math.max(-1, Math.min(1, n)) * 10) / 10 || 0) : 0; }
```

Only the eight `TUNES` keys survive; anything else in a tune is dropped. The server never runs the driving model: it checks ownership, stage and price only.
`ensureStrip` (payout.ts:76-92) repairs `rep`, `cars`, `wins`, `best` at the top level but does not look inside a car's `cfg`/`tune`.
Accounts save the record as is (`src/world/accounts.ts:92-104` `saveRecord`, `:115-123` `applyRecord` with `pruneStrip`).
`src/bay/catalog.ts:32-63` maps every `perf.<k>` key to a bay slot, a mod category and renewed parts.

### How a changed build reaches the running car (`src/VanillaThreeScene.tsx`)

| Step | Line | Detail |
|---|---|---|
| read the build | 673-675 | `buildOf(carId) = store.strip?.cars[carId] ?? { cfg: STOCK_CFG, tune: TUNE_DEF }` (no `carState`: reading must not add an entry) |
| spec | 684-691 | `specOf(car)` → `specFor({ make, model, bodyStyle: styleOf(car), rental, testCar })`, with `styleOf = car.bodyStyle \|\| deriveStyle(car.model)` |
| start driving | 930-932 | `paramsKey = perfKey(b)`; `driver = new Driver(specOf(car), b, pose)` |
| each frame | 1092 | `if (st.strip !== lastStripRec) { lastStripRec = st.strip; syncBuild(); }` (identity of the record object) |
| `syncBuild` | 703-709 | `pk = JSON.stringify(cfg.perf) + JSON.stringify(tune)`; when it differs from `paramsKey` → `driver.rebuild(specOf(car), b)`; when `JSON.stringify(cfg)` differs from `kitKey` → `fitKit` |
| `Driver.rebuild` | driver.ts:44-47 | `V.P = carParams(...)`; `V.nos = min(V.nos, P.nos.cap)`; `rpm` raised to idle. Position, speed and gear are kept. |

---

## 11. `src/world/options.ts` — options

| Thing | Line | Detail |
|---|---|---|
| `DriveOptions` | 9 | `{ manual: boolean; units: 'mph'\|'kmh'; cam: 0\|1\|2; mute: boolean; controls: 'sticks'\|'buttons'; models: boolean }` |
| `OPTIONS_KEY` | 11 | `'micar.driveOptions'`: one `localStorage` key holding all of them as JSON |
| `OPTION_DEFAULTS` | 12 | `{ manual: false, units: 'mph', cam: 0, mute: false, controls: 'sticks', models: true }` |
| `parseOptions(raw)` | 19-33 | starts from the defaults and copies each field **only when its value is one of the allowed ones**; unknown keys are dropped |
| `getOptions()` | 37-40 | parsed once, then a module-level cached object (`cur`) |
| `getOption(k)` | 42 | `getOptions()[k]`: `undefined` for a key that is not an option |
| `setOption(k, v)` | 45-50 | re-parses `{ ...current, [k]: v }`; **returns without saving** when `k` is not in the result or the parsed value is not `=== v`; else caches and writes |
| `resetOptionsCache()` | 53 | tests |

Stored per device, never sent to the server, not part of `StripRecord`.

Readers:

| Reader | Line | Option |
|---|---|---|
| `VanillaThreeScene.tsx` | 185 | `models` (once, at scene build) |
| | 659 | `mute` (once), beside the URL switch `soundMode(window.location.search)` |
| | 678 | `manual` (every call of `manualNow()`; a drag is always manual) |
| | 941 | `cam` (on getting in) |
| | 1083-1085 | `getOptions()` **every frame**: `cam` and `mute` are compared with the last applied value and applied on change |
| | 1202 | `units`, `controls` for the HUD |
| `DriveLayer.tsx` | 162 | `controls` |
| `RaceMenuScreen.tsx` | 48 | `units` |
| `GarageMenu.tsx` | 59-60, 70 | everything, through `getOption` / `setOption` |
| `garage.ts` | 85, 288 | defaults; `units` for the top-speed text |

### Where a new option "New driving (beta)" goes

1. `options.ts:9` add the field to `DriveOptions` (for example `physics: 'classic' | 'core'`, or a boolean).
2. `options.ts:12` add its default (the old model) to `OPTION_DEFAULTS`.
3. `options.ts:26-31` add its line to `parseOptions` (without it `setOption` silently refuses the key).
4. `garage.ts:77-84` add a row to `OPTS`; its `vals` must be exactly the values `parseOptions` accepts, default first.
5. `garage.ts:66` the root menu's description lists the options by name.
6. `GarageMenu.tsx:60` any side effect of changing it (as `'mute'` and `'models'` have).
7. `VanillaThreeScene.tsx:1083-1085` is where a change made while a car is being driven is noticed (the pattern used for `cam` and `mute`); `syncBuild`'s `paramsKey` (703-709) does not include options.
8. `garage.ts:281` the Garage's params cache key does not include options either.
9. Tests: `options.test.ts:19` and `:21` compare the whole stored object with `toEqual` and must gain the key; the other option tests use `OPTION_DEFAULTS` or spreads.

### Where a URL switch `?physics=core` goes

The precedent is the sound switch:

```ts
// src/world/audio.ts:12
export function soundMode(search: string): SoundMode { return /[?&]sound=classic(&|$)/.test(search) ? 'classic' : 'model'; }
// src/VanillaThreeScene.tsx:659
const audio = new NtAudio(getOptions().mute, soundMode(window.location.search));
```

A pure function of `window.location.search`, tested on its own, read where the thing is built. `?audiodebug` (VanillaThreeScene.tsx:666) is a second one.
`src/route.ts:23-25` (`raceCode`) is the `URLSearchParams` form of the same idea.

The address is rewritten in three places, and all three keep other parameters, so `?physics=core` survives:
`store.ts:245-251` (`withRace` sets or deletes only `race`, route.ts:28-32), `src/strip/StripEntry.tsx:76` (`pathname + search`), `src/main.tsx:104-107` (sets `tab`, deletes `app`).

The switch has more than one reader: the 3D scene (Driver), the Garage (a lazy chunk: stat bars, dyno), and the Strip's events (AI pace, drag opponents).
`getOptions()` is the one place all of them already read, so a single function that combines the stored option and the URL belongs beside it.

---

## 12. `src/world/persistence.ts`, `rental.ts`, `tester.ts`

### persistence.ts

Generic save-file plumbing for the server (`writeAtomic` 13-18, `loadOrQuarantine` 27-40, `coalescingSaver` 50-71). It knows nothing of cars, builds or options.
The `StripRecord` rides inside the players and accounts of the saved game state as plain JSON. Nothing validates the shape of `cars[id].cfg` / `.tune` on load.

### rental.ts

- `RENTAL_FLEET` (8-14): `{ key, make, model, color, bodyStyle, price }` for civet, kanjo, ronin, tsubasa, brute. `make + ' ' + model` is the `FLEET_NAMES` key. `bodyStyle` is for the 3D body only (Brute is `'sports'`, Kanjo `'hatchback'`); the driving spec is the fleet record whatever it says.
- `fleetCar` (44-55): the car is made with `rental: true`, `fuel: 100`, `district: 'strip'`, id `rental-<now>-<key>`.
- `lend` (70-74): the same car with `loan: true` and a grid colour. `returnLoan` (81-87) deletes `strip.cars[car.id]`.
- A rental is always stock: the store will not open the Garage on it (store.ts:453) and the server refuses all three part messages (`dealerCar`, server.ts:1153-1157). With no record entry, `buildOf` gives `STOCK_CFG` / `TUNE_DEF`.
- So a rental drives `carParams(FLEET_SPECS[key], all tier 0, all sliders 0)`: `mu = 1.02` exactly (no `gripMul`).

### tester.ts

- `TEST_CARS` (47-50): the fleet (`fleet: true`) then every `CAR_CATALOG` entry with its `style` as `bodyStyle`.
- `makeTestCar` (60-68): `testCar: true`, an owned car (not a rental), id `tester-<8 chars of owner id>-<make>-<model>`: stable, so the build under that id is found again.
- `grantTester` (37-42): `rep ≥ 3800` (stage 5: every tier unlocked), money topped up to 1 000 000.
- A tester's fleet car takes the fleet path of `specFor` (`car.testCar`, data.ts:234) and, unlike a rental, **can carry parts and a tune**. A tester's real model is fitted like anyone's.

---

## 13. Tests that pin these behaviours

| Test file | Lines | Pins |
|---|---|---|
| `src/world/data.test.ts` | 7 | every archetype, stock: `3 < t100 < 14` s, `150 < top < 330` km/h (old `simStats`) |
| | 9 | Mustang as `coupe`: `4.3 ≤ t100 ≤ 6.5`, `drive 'RWD'`, `mass ≈ 3800 × 0.4536` |
| | 10-15 | Corvette `t100 < 6.0`, `top > 280`; Camry `7.4 ≤ t100 ≤ 8.4`, `205 ≤ top ≤ 230`; F-150 `6.0 ≤ t100 ≤ 7.2`; Prius `t100 > 9.5` |
| | 16 | unknown truck: `gripMul === .9`, `h === .62` |
| | 17 | `fitSpec` with absurd figures (900 hp, 0-60 1.5 s, 400 mph) stays finite |
| | 18 | unknown car → `id === 'van'`; `specFor({})` does not throw |
| | 35 | rented Brute: `mass 1720`, `drive 'RWD'`, `redline 6200` |
| | 36-39 | tester's fleet car `toEqual` the rental's; tester's Mustang `toEqual` anyone's |
| | 40 | fleet name without `rental` → `id === 'sports'` |
| | 41-45 | the five fleet specs differ in character; stock `t100` spread ≥ 2 s |
| `src/world/rental.test.ts` | 62 | a lent Ronin: `specFor(car)` `toEqual(FLEET_SPECS.ronin)` |
| | 83-88 | every rental: `specFor(...)` `toEqual(FLEET_SPECS[key])` and `gripMul` is `undefined` |
| | 89-94 | cache: second call `toEqual` but `not.toBe` the first, cache size unchanged, under 50 ms |
| `src/carSpecs.test.ts` | 9-13 | each fleet panel row within 10% of old-model `simStats`: `hp`, and `zeroToSixty` against `t100 − 0.3` |
| `src/carModels.test.ts` | 67-73 | an added model: `name` is its game name, everything else `toEqual` its style's spec; an unknown car keeps the style's name |
| `src/world/garage.test.ts` | 38-40 | cannot afford → nothing changes; buy calls `buy('spoiler', 1, 900)`; tier 3 turbo at stage 1 refused with "stage 3" |
| | 41 | dyno: 30 × `adjust(1)` → `aero === 1`; `back()` saves it through `ctx.tune` |
| | 42 | `statRows(currentParams())`: five rows, each `0 ≤ v ≤ 1` |
| | 73-86 | Options: a row with id `'models'`, `'Detailed'` first, one press calls `setOpt('models', false)` and shows `'Simple'` |
| `src/world/options.test.ts` | 10-14 | junk → `OPTION_DEFAULTS` |
| | 15-22 | **exact** stored object `{ manual, units, cam, mute, controls, models }` |
| | 23-33 | defaults for options saved before a setting existed |
| | 34-39 | a bad value is ignored; blocked storage still works for the page |
| `src/world/physics.test.ts` | 36-38 | stock Ronin `5 < t100 < 9`, `200 < top < 260`, `hp > 200`; `gripMul` scales `mu`; tier-3 engine+ecu+turbo ≥ 1.35× torque at 5500 rpm |
| `src/world/audio.test.ts` | 212-232 | ECU tier 3 → `redline === stock + 450` reaches the engine sound |
| `src/world/driver.test.ts` | 42-46 | `specFor({ make: 'Zz', model: 'Qq', bodyStyle: 'weird' })` drives |
| `src/world/payout.test.ts` | 138-145 | `partPrice`: `spoiler 1 → 900`, `perf.engine 2` refused at stage 1, `4800` at stage 2, prototype keys refused |
| | 147-150 | `clampTune({ turbo: 3, nitrous: −0.26, aero: 'x', bias: 0.44 })` → `{ turbo: 1, nitrous: −0.3, aero: 0, bias: 0.4, ride: 0, stiff: 0, steer: 0, gears: 0 }` |
| `src/world/tester.test.ts` | 55-72 | the test-car list and the stable id |
| `e2e/data.ts` | 305 | `strip_tune` on a rental is refused |

Many other tests build a car with `makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF))` as a fixture
(`audio`, `cameras`, `carFeel`, `hud`, `raceHud`, `strip/ai`, `strip/events`, `strip/routes`, `strip/scene`, `scene/carFeelAdapter`): the three exports and their signatures have to keep working.

---

## What an adapter must provide

- [ ] **A way from a world car to the new core's input that does not go through `fitSpec`.** The key the game has is `{ make, model, bodyStyle?, rental?, testCar? }` (plus `realNameOf` for game names). The fitted `tq` and `fin` are old-model artefacts.
- [ ] **The same decision order as `specFor`**: fleet first (only when `rental || testCar`), then style with `'sedan'` for anything unknown, then known model, then listed game name, then the bare style. One function used by both the scene and the Garage.
- [ ] **Something for every name and for unknown cars**: the 36 original models, the 5 fleet cars, the 362 rows of `carModels.json` under their game names, and anything else. A car with no figures must still drive (`driver.test.ts:42`), and `specFor({})` must not throw.
- [ ] **A mapping from `PerfCfg` (nine keys, tiers 0-3) and `Tune` (eight sliders, −1..1) to the core's `Build`** (`packages/physics/src/types.ts:406-426`), with the sign of each slider as section 3 gives it, and tier 0 / slider 0 meaning the car as delivered.
- [ ] **A stock rental**: fleet cars at tier 0 and centred sliders, from the authored torque curves (`PhysicsSheet.torqueCurve` exists for this).
- [ ] **`spec.name`, `spec.drive`, `spec.id`** for the Garage header and cache key (GarageMenu.tsx:158, garage.ts:281), and a stock `redline` for the engine sound (VanillaThreeScene.tsx:688).
- [ ] **Garage figures from the model that is driving**: top speed km/h, 0-100 km/h s (or null), hp, hp rpm, mass kg, drive; and a 0..1 value for each of the five bars (handling, braking and nitrous are read straight off `Params` today: `mu`, `B`, `brakeMu`, `nos.cap`, `nos.pow`).
- [ ] **A dyno curve** as `[rpm, N·m, hp][]` and a redline, for `drawDyno(canvas, now, preview)`.
- [ ] **Stable identity for params objects**: the same build must give the same object, or "Preview" shows always and the straight-line run repeats every render (garage.ts:100, 282, 298).
- [ ] **Stats cheap enough to run on a part hover**: the old run is 2100 steps; `stats()` is called on every Garage render and the result is cached per params object.
- [ ] **AI pace figures**: top speed m/s and a 0-100 average acceleration m/s² (`strip/events.ts:76-77`), from the same model the player drives.
- [ ] **The option**: a `DriveOptions` field, its default (old model), its `parseOptions` line, its `OPTS` row; and one function that combines it with `?physics=core`, read by the scene, the Garage and the Strip.
- [ ] **A rebuild when the switch changes mid-drive**, keeping place and speed as `Driver.rebuild` does, and a Garage params cache that knows the mode.
- [ ] **Nothing new in the stored build**: `cfg.perf` and `tune` keep their shapes, so old saves, the server's checks and a switch back to the old model all keep working.
- [ ] **With the switch off: `specFor`, `fitSpec`, `carParams`, `simStats`, `dynoCurve` byte-for-byte as they are**, same return shapes (several tests use `toEqual` on whole specs).

## Traps

1. **`fitSpec` is calibrated through the old model.** Fitted torque and final drive make the old `simStats` hit the published numbers; they are not the car's real torque or gearing (Camry 248 sim hp for 203 real; Corvette 603 for 490). Feeding a fitted `VehicleSpec` to another model gives wrong cars.
2. **Centred sliders are not neutral.** At `TUNE_DEF` the old model already lowers the CG 7%, adds 17.5% drag and 20%-of-weight downforce at 55 m/s, and sets `B = 18`. A mapping that treats slider 0 as "no change" and slider −1 as "less than stock" is right for the new core, but the old model's numbers at 0 are not a "no aero" baseline to compare against.
3. **The final-drive slider's label and sign.** `fin = spec.fin × (1 + .12 × t.gears)`: +1 makes the ratio numerically **higher** (shorter gearing), while the slider's high end is labelled "Top speed" and its low end "Acceleration" (data.ts:99). Measured on the fitted Camry: slider −1 / 0 / +1 gives top 233.8 / 217.2 / 194.0 km/h and t100 8.33 / 8.20 / 8.60 s, so the "Top speed" end is the slower one. Copying the formula keeps the old behaviour; following the label reverses it. Decide which, and say so.
4. **`simStats` steps at 1/30 s, the game at 1/120 s.** Garage figures and the fit are the 30 Hz model's; they are not what the driven car does.
5. **Two style rules.** The Garage calls `specFor` with the raw `car.bodyStyle` (GarageMenu.tsx:31), the scene with `car.bodyStyle || deriveStyle(car.model)` (VanillaThreeScene.tsx:681, 687). A car saved without a `bodyStyle` is a sedan in the Garage's stats and, for example, a truck on the road.
6. **Two spec objects.** The Garage and the scene each call `specFor`; the results are equal, not identical. The Garage's cache needs identity (`p.P.spec === spec`) only against its own memoised spec.
7. **`specFor` results are compared whole.** `rental.test.ts:62, 85-86`, `data.test.ts:37-38`, `carModels.test.ts:71` use `toEqual`, and `gripMul` must be `undefined` on fleet specs. An extra field on the returned spec fails them.
8. **The fleet path needs `rental` or `testCar`.** Without the flag `'Brute 440'` is an unfitted `sports` archetype (data.test.ts:40). A tester's fleet car, unlike a rental, can have parts.
9. **The `specFor` cache key leaves out `testCar` and is never cleared.** Anything mode-dependent stored in it would leak between modes.
10. **`setOption` refuses silently.** A key missing from `parseOptions`, or a value it does not accept, is dropped without an error. In the Garage the row still appears to change, because `GarageModel.opt` falls back to its own copy when `getOption` returns `undefined` (garage.ts:127): it looks saved, is not, and never reaches the driving.
11. **`options.test.ts:19, 21` are exact.** Adding any option changes the stored object and these two expectations.
12. **Options do not trigger a rebuild.** `syncBuild` runs only when the store's `strip` object changes and compares `perf + tune` only (VanillaThreeScene.tsx:703-709, 1092). The Options menu is inside the Garage, opened over the car being driven: flipping the switch there changes nothing on the road unless the mode is checked each frame like `cam` and `mute` (1084-1085).
13. **The Garage's params cache key has no mode in it** (garage.ts:281): after a flip it would hand back the other model's params for the same build.
14. **Stats run on every render.** `g.stats()` is called in the component body (GarageMenu.tsx:130). It is fast only because of the two caches; a params object made fresh each call means two full straight-line runs per render and a panel stuck on "Preview".
15. **Options are per device and the server never sees them.** Two players in a challenge room can be on different models. The server refuses any finish quicker than `raceFloor(ev) = distance / VMAX[type]` (`payout.ts:14, 42, 53`; challenge rooms `race.ts:239-242`), with `VMAX` 50 m/s for a drag and 65 m/s for everything else: a model that averages more than that has its times refused.
16. **`clampTune` keeps only the eight `TUNES` keys** (payout.ts:140-148), and `partPrice` only keys in `CATS` with values in their items. A new slider or part that is not added to `TUNES` / `PERF` is stripped or refused by the server while the optimistic client copy shows it, until the next state arrives.
17. **Nothing validates a stored build.** `buildOf` returns `strip.cars[id]` as saved; `carParams` does no defaulting. A new `Tune` key read from an old save is `undefined` and turns into `NaN` in a formula. (`rental.test.ts:66` even stores `{ cfg: {}, tune: {} }`.)
18. **`carState` creates entries.** Use it only where a write is meant (store edits, server handlers). Reading with it would add a stock entry for every car looked at; the scene and the Garage read `strip.cars[id] ?? fallback` on purpose (VanillaThreeScene.tsx:674-675, GarageMenu.tsx:49).
19. **The optimistic store copy is replaced by the server's.** Every edit makes a new `strip` object, and so does every server state that carries the record: each one runs `syncBuild`. It rebuilds only when `perf + tune` changed, so a rebuild must stay cheap and must not reset the car.
20. **`Driver.rebuild` can happen at speed.** The Garage opens over a moving car, and a part can add or remove the turbo or shrink the bottle (`V.nos = min(V.nos, P.nos.cap)`, physics.ts:104 zeroes boost with no turbo). The new core's state has to survive a build swap the same way.
21. **`STYLE_SPECS` is not a driving input.** `getCarSpec` falls back to it, but `specFor` never fits to it. An adapter that calls `getCarSpec` for every car would start driving unknown cars on the "old, tired" figures (150 hp sedan) instead of the archetype (264 hp): a behaviour change even with the switch on.
22. **The fleet rows of `MODEL_SPECS` are the old model's output** (carSpecs.ts:59-64, pinned by `carSpecs.test.ts`). They describe the old physics, they are not independent figures to validate against.
23. **Engine strings drive two things.** `fitSpec`'s redline regex and the engine sound's facts both parse `CarSpec.engine` (`'EcoBoost'` is not `/Turbo/`). The sound is sized on the stock redline of the driving spec (VanillaThreeScene.tsx:688) and follows `V.P.redline` after an ECU part (audio.test.ts:212-232).
24. **Ride height shows twice.** `tune.ride` lowers the CG in `carParams` and the body on the turntable (`GarageScene.ts:31`, 7 cm full travel). The drop the new core is given should match what is drawn.
25. **The brake tier colours the calipers** (`parts.ts:529`) through a separate argument, in both the Garage and the driven car. It is read from `cfg.perf.brakes` directly, not from the model.
26. **Car condition does not affect driving today.** `condition`, `mechanicCondition` and `mileage` never reach `carParams`. A core that wears the car from them changes how every used car in the town drives.
