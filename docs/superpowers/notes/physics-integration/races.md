# Integration map: the race logic and the old driving model

Scope: `apps/sim/src/world/strip/{events,ai,lights,timing,remote,routes,roadGraph,district,zone,park}.ts` and
`apps/sim/src/world/{netPositions,racePoses,raceNet,stateSync,results,stripFlow,raceMenu}.ts`, read against
`apps/sim/src/world/physics.ts` (the old model). Paths below are relative to `apps/sim/src/world/` unless they start
with `src/` or `server.ts` (then relative to `apps/sim/`). Callers outside the scope (`driver.ts`, `strip/scene.ts`,
`VanillaThreeScene.tsx`, `payout.ts`, `race.ts`, `server.ts`) are cited only where they fix call order or a format.

Baseline: `npx vitest run src/world/strip/{events,ai,remote,timing}.test.ts` passes (72 tests) on the tree as read.

---

## 0. Conventions every file in this area assumes

| Quantity | Unit / sign | Where fixed |
|---|---|---|
| `x`, `z` | metres on a flat plane (there is no `y`, no elevation, no banking anywhere in the route or track data) | `strip/routes.ts:4-6`, `driver.ts:1-4` |
| scene units | metres x `WORLD_PER_M` (= 2) | `units.ts:2`, `strip/scene.ts:244` |
| `h` (heading) | radians, 0 faces +Z, forward = `(sin h, cos h)`; never wrapped; mesh `rotation.y = h + PI` | `physics.ts:169-170`, `driver.ts:77`, `strip/scene.ts:244` |
| heading of a route tangent `(tx, tz)` | `Math.atan2(tx, tz)` | `strip/events.ts:98`, `strip/ai.ts:21,35` |
| "right" of a tangent | `(-tz, tx)`; lane offsets are multiples of it (`lane > 0` is to that side) | `strip/events.ts:98-99`, `strip/ai.ts:34` |
| `V.u` | m/s along the body's forward axis, negative in reverse | `physics.ts:165,174` |
| `V.v` | m/s along `(cos h, -sin h)`, i.e. toward minus "right" | `physics.ts:170,174` |
| `V.w` | rad/s, positive increases `h` | `physics.ts:168` |
| `V.vx`, `V.vz` | world velocity, m/s; `syncBody` recomputes `u`, `v` from them | `physics.ts:170,174` |
| `V.beta` | `atan2(V.v, max(|V.u|, 1.2))`, rad, taken at the START of a step | `physics.ts:131,134` |
| `Input.steer` | -1..1, positive = turn toward "right" (`V.steer` chases `-I.steer`) | `physics.ts:133` |
| `V.delta` / `AI.steer` | road-wheel angle, rad, positive increases `h`; both are written straight into the front wheel pivots | `physics.ts:138`, `strip/ai.ts:36`, `strip/scene.ts:236`, `src/VanillaThreeScene.tsx:1186` |
| race distance `s` | metres along the route; on a loop it is NOT wrapped (cumulative over laps, can start below 0 on the back row) | `strip/routes.ts:22-27`, `strip/timing.ts:1-4` |
| race time | seconds from the green | `strip/events.ts:189,194,210` |

Time steps in use (an engine has to be correct at all of them, or sub-step inside):

| Who | dt | Where |
|---|---|---|
| the player's car | fixed `STEP = 1/120` s, at most 6 a frame (frame clamped to 0.05 s) | `driver.ts:11-14,57-67` |
| `EventRunner.update`, `stepAI`, the drag AI's `stepVehicle` | once a frame with `simDt = steps x STEP` (0 .. 0.05 s). It IS called with `dt = 0`: a frame that ran no sub-step (a display faster than 120 Hz) still calls `strip.update(0, true)` | `src/VanillaThreeScene.tsx:1171,1189`, `strip/scene.ts:458,477` |
| `simStats` | 1/30 s, 2100 steps (70 s) | `physics.ts:178-180` |
| the tests | 1/60 s | `strip/events.test.ts:36-38` |

---

## 1. Per-frame call order (who touches the Vehicle, in order)

```
frame (src/VanillaThreeScene.tsx:1163-1192)
  opts.drift = driftMode || driftHeld || runner.active?.type === 'drift'         :1170
  Driver.stepFrame(delta, I, stripOpts)                                           :1171
    per sub-step of 1/120 (driver.ts:57-67):
      J = runner.input(I, STEP)             events.ts:161  (a NEW object while an event is live; else I itself)
      tank empty -> J.fwd = 0 (J.back = 0 in reverse)        driver.ts:60-61  (mutates J)
      stepVehicle(V, J, STEP, drift)                         driver.ts:62
      burn fuel from V.thr, |V.u|                            driver.ts:63
      collide(V) = strip.collide(V)  -> collideWalls, then collideCar per AI   scene.ts:449-453
                 then runner.postStep(STEP)                  src/VanillaThreeScene.tsx:1061
      I.shiftUp = I.shiftDn = I.hop = false                  driver.ts:65
    V.hit = largest impact of the frame (m/s)                driver.ts:69
  strip.update(simDt, live)                                                       :1189
    traffic/rivals: stepAI(A, dt, null, stage); separateAIs(non-racers)   scene.ts:464-475
    placePeople(a)  (network cars -> Racer x, z, h, v, s, score)          scene.ts:476,504-514
    runner.update(dt)  -> count | updateRace | updateDrag | results       events.ts:177-198
    updateOutrun(...)                                                     scene.ts:481-485
    drawAI for every AI; drag AI meshes from o.V.x, o.V.z, o.V.u          scene.ts:490-496
  challengeFrame(delta): a pose every 0.066 s of real frame time while state === 'race'   :808-825, :644
```

`live = !paused && !resultsShown && !mapOpen && !garageOpen`; when halted (pause, map, race menu) the player is not
stepped and `simDt = 0`. With the Garage open the player IS stepped (no input) but `live` is false, so no AI or event runs.

Object identity: `EventRunner.PV` IS the `Driver`'s `Vehicle` object (`strip/scene.ts:350` `this.PV = PV; this.runner.PV = PV;`).
Until `enter()` it is a placeholder sedan (`strip/scene.ts:141`). The runner, the scene, the HUD, the camera and the audio
all hold this one mutable object and several of them write to it.

---

## 2. `strip/events.ts`: the race state machine

### 2.1 Imports from the old model (`events.ts:5`)
`clamp, makeVehicle, NO_INPUT, resetVehicle, simStats, stepVehicle, type Input, type Params, type Vehicle`.

### 2.2 Every place a Vehicle or Params is created, stepped, reset or mutated

| Line | What | Fields / functions |
|---|---|---|
| `:76` | `playerTopMs(P) = simStats(P).top / 3.6` | runs a full 70 s straight-line sim; `top` is km/h, result m/s |
| `:77` | `playerAccel(P) = st.t100 ? 100/3.6/st.t100 : 3` | a second full sim; mean 0-100 km/h acceleration in m/s^2, 3 when the car never reaches 100 |
| `:87` | `constructor(public PV: Vehicle, public ais: AI[], fx, public playerParams: () => Params, roads)` | the scene passes `() => this.PV.P` (`strip/scene.ts:155`) |
| `:106` | drag start: `resetVehicle(PV, pp.x, pp.z, dir); PV.nos = PV.P.nos.cap;` | player onto its lane at s = 0, a full bottle |
| `:110` | drag AI: `const P = { ...this.playerParams() }; P.tqMul *= (.86 + .05 * st + Math.random() * .06); P.peakT *= P.tqMul; const AV = makeVehicle(P); ... resetVehicle(AV, pp2.x, pp2.z, dir);` | a SHALLOW copy of the player's Params (shares `spec`, `tq`, `gears`, `turbo`, `nos`); a new real `Vehicle` per AI lane (3 of them) |
| `:119` | lap race / drift start: `resetVehicle(PV, pp.x, pp.z, dir); PV.nos = PV.P.nos.cap;` | grid place |
| `:120` | `const top = playerTopMs(PV.P), acc = playerAccel(PV.P);` | two `simStats` runs (4200 `stepVehicle` calls) at every solo and net lap/drift start |
| `:163` | `input()` in the count: `Object.assign({}, I, { steer: 0, hb: false, nos: false }); J.fwd = I.fwd` | throttle and brake pass through: the engine revs on the line |
| `:164` | `input()` in a drag, in EVERY state: `Object.assign({}, I, { steer: 0, hb: false, manual: true })` | forces the manual gearbox; no steering, no handbrake, also after the finish until cleanup |
| `:169` | `postStep` in the count: `PV.u = PV.v = PV.w = PV.vx = PV.vz = 0; PV.x = a.startX ...; PV.z = a.startZ ...` | pins position to where the first count sub-step found it; `h`, `rpm`, `gear`, `ax`, `boost` are left alone |
| `:171-172` | `postStep` in a drag race: `PV.h = d.dir; PV.v = 0; PV.w = 0; PV.vx = d.fwd[0] * PV.u; PV.vz = d.fwd[1] * PV.u;` then the car is moved sideways toward `DRAG_LANES[d.lane]` at no more than 7 m/s | only `u` survives from the step; lane change is kinematic |
| `:214` | `routeProgress(r, PV.x, PV.z, a.pS + PV.u * dt, 45)` | reads `x`, `z`, `u` |
| `:251-252` | drift: `spd = Math.abs(PV.u) * 3.6, ang = Math.abs(PV.beta)`; `if (PV.hit > 4) { ... PV.hit = 0; }` | reads `u`, `beta`, `hit`; writes `hit` |
| `:264` | drag: `if (PV.overRev > 1.5 && !PV.blown) { PV.blown = true; a.fail = 'Engine blown'; ...}` | reads `overRev` (seconds, 0..3), writes `blown` (the old engine then gives no drive torque, `physics.ts:115`) |
| `:268` | drag traffic crash: `PV.u *= .2; PV.vx = d.fwd[0] * PV.u; PV.vz = d.fwd[1] * PV.u;` | never reached today: every drag event is `noTraffic` (`data.ts:115,121`) |
| `:271-273` | drag AI step, once a frame with the frame's dt: see 2.4 | `stepVehicle(AV, I, dt, false)` then pins |
| `:276` | `if ((PV.perfectN || 0) !== (d.perfSeen || 0))` -> banner "Perfect shift" | reads `perfectN` (a counter that only grows) |
| `:281` | unfinished drag AI: `o.ft = a.time + rem / Math.max(10, Math.abs(o.V.u))` | reads `o.V.u` |
| `:316` | `quit(): this.cleanup(); snapToRoad(this.PV, this.roads());` | see `routes.ts:46-51` |
| `:329-336`, `:345` | `nearEvent`, `nearRival`, `updateOutrun` | read `PV.x`, `PV.z` only |

Nothing else in `events.ts` touches the car. `cleanup()` (`:306-315`) does not: a blown engine is mended by the page
(`src/VanillaThreeScene.tsx:742` `driver.V.blown = false; driver.V.overRev = 0`).

### 2.3 Start grid

| | Lap race / drift (`:118-127`) | Drag (`:104-116`) |
|---|---|---|
| places | `[[-3,0],[3,0],[-3,-8],[3,-8]]` = (lateral m, along m) from `routePoint(route, 0)`; 4 only | `DRAG_LANES = [-6,-2,2,6]` m lateral, all at s = 0 (`:60`) |
| player's place | solo: `Math.floor(Math.random()*4)`; net: `gridOf(net.slot)` = `clamp(floor(slot) || 0, 0, 3)` (`:95`) | solo: random lane; net: `NET_LANES[gridOf(slot)]`, `NET_LANES = [1,2,0,3]` (`:62`) |
| opponents | solo: 3 `makeAI` racers; net: one `addPerson` Racer per other member, no AI | solo: 3 real `Vehicle`s; net: `addPerson` Racers, no AI |
| heading | `dir = Math.atan2(fwd[0], fwd[1])` of the tangent at s = 0 (`:98`) | same |

The drag's line is `p0 + fwd * s`, a straight line `route.len` long from the tangent at s = 0; the route's polyline is not
followed (`:157-158`). Both drag routes are straight to within 0.6 m (402 m `royal_drag`, 805 m `mountain_drag`).

### 2.4 The drag AI (real Vehicles on the old model)

`events.ts:270-275`, run once per frame inside `updateDrag(dt)`:

```ts
if (o.ft != null) continue; const AV = o.V; o.react -= dt;
const I: Input = Object.assign({}, NO_INPUT, { fwd: o.react <= 0 ? 1 : 0, manual: true,
  shiftUp: AV.rpm > AV.P.redline * .95 && AV.shift <= 0, nos: o.s > 60 && AV.gear >= 3 });
stepVehicle(AV, I, dt, false); AV.h = d.dir; AV.v = 0; AV.w = 0; AV.vx = d.fwd[0] * AV.u; AV.vz = d.fwd[1] * AV.u; o.s = this.dragS(AV.x, AV.z);
AV.x = p0.x + d.fwd[0] * o.s + d.right[0] * DRAG_LANES[o.lane]; AV.z = p0.z + ...;
if (o.s >= a.route.len) o.ft = a.time;
```

| Fact | Value |
|---|---|
| power | the player's Params with `tqMul x (.86 + .05*stage + U(0,.06))`; stage 1..5 (`data.ts:104-105`) gives x0.91 .. x1.17 |
| `peakT` | `P.peakT *= P.tqMul` multiplies by the WHOLE new `tqMul`, not the factor: wrong, but `peakT` only sets engine braking with a closed throttle (`physics.ts:117`), which the drag AI never has while moving |
| reaction | `react = .15 + U(0,.4)` s after the green, throttle 0 until then (`:112`) |
| shifting | manual; `shiftUp` held true whenever `rpm > .95 redline && shift <= 0`; that is inside the old model's perfect-shift window (`physics.ts:89`), so the AI gets the 10% bonus on most shifts |
| nitrous | on from 60 m and third gear (`:271`); bottle = `P.nos.cap` from `makeVehicle` |
| dt | the frame's `simDt` (variable, up to 0.05 s), NOT 1/120 |
| reads | `AV.rpm`, `AV.P.redline`, `AV.shift`, `AV.gear`, `AV.u`, `AV.x`, `AV.z` |
| writes | `AV.h`, `AV.v`, `AV.w`, `AV.vx`, `AV.vz`, `AV.x`, `AV.z` |
| drawn / mapped from | `o.V.x`, `o.V.z`, `o.V.u` (`strip/scene.ts:492-496`, `hud.ts:230`) |
| not stepped | during the count (`update` returns before `updateDrag`, `:179-191`), or once `o.ft` is set |

### 2.5 Circuit / sprint / street X / drift AI racers

Creation (`events.ts:122-127`, solo only):

```ts
const A: Racer = makeAI({ m, kind: 'racer', route, lane: sl[0] * .9,
  vmax: top * (.74 + .06 * st) * (.96 + Math.random() * .08), acc: acc * 1.1, brk: 10, name: ..., hold: true });
A.key = 'r' + i; A.color = cfg.color;
A.x = q.x; A.z = q.z; A.h = dir; A.s = routeProgress(route, A.x, A.z, 0, 30).s; A.ft = null; A.laps = 0; A.done = false;
a.racers.push(A); this.ais.push(A);
```

| Param | Value | Meaning |
|---|---|---|
| `vmax` | `playerTopMs x (.74 + .06*stage) x U(.96,1.04)` | m/s; x0.77 .. x1.08 of the player's own top speed |
| `acc` | `playerAccel x 1.1` | m/s^2, constant at every speed |
| `brk` | 10 | m/s^2 |
| `lane` | `+-2.7` | m to the side of the route's polyline, held for the whole race |
| `hold` | true until the green (`:189`, `:210` `for (const r of a.racers) r.hold = false`) | |

Stepping (`events.ts:228-235`), once a frame:

```ts
for (const R of a.racers) {
  if (R.done) continue;
  if (R.remote) { if (R.key) a.timing?.step(R.key, R.s, a.time); continue; }
  stepAI(R, dt, a.pS, fx.stage()); const tot = R.s; if (R.key) a.timing?.step(R.key, tot, a.time);
  if (tot >= a.target - 1) { R.done = true; R.ft = a.time; R.v *= .5; ... }
  if (drift) { R.score += dt * (90 + 55 * fx.stage()) * (.6 + .8 * Math.random()) * (R.v > 8 ? 1 : 0); }
}
if (!a.net) separateAIs(a.racers);
```

Racers are stepped ONLY here: `strip/scene.ts:467` skips `kind === 'racer'`. A racer that is `done` is never stepped
again (it stands where it finished, still collidable); at the player's finish every remaining racer gets `hold = true`
(`:245`).

### 2.6 What `playerTopMs` / `playerAccel` / `simStats` are used for

| Use | Where | Effect |
|---|---|---|
| lap/drift AI pace | `events.ts:120,124` | `vmax`, `acc` of the 3 racers |
| outrun rival | `strip/scene.ts:409` -> `events.ts:337-338` | `A.vmax = top * (.72 + .05*stage); A.acc = accel * 1.05; A.brk = 10` |
| (outside the scope) garage stat bars, stock stats | `garage.ts:100-104`, `data.ts:198` | cached per Params object in `garage.ts`; `events.ts` does not use that cache |

`simStats(P)` (`physics.ts:178-183`): a fresh `makeVehicle(P)`, input `{fwd: 1}` (automatic gearbox, no nitrous, no drift),
2100 steps of 1/30 s; `top` = max `V.u * 3.6` (km/h), `t100`/`t200` = first time at or above 100/200 km/h or null.
So the AI is paced from the car's Params only: fuel, damage and the driver do not enter.

### 2.7 How the finish, the time and the results are decided

| Thing | Rule | Where |
|---|---|---|
| target | `route.loop ? route.len * laps : route.len` | `:96` |
| race clock, solo | `a.time += dt` with `dt = simDt`: simulated time (stops in a pause, runs slow under 20 fps) | `:194` |
| race clock, challenge | `(a.net.now() - a.go) / 1000`: the server's clock from the shared green | `:194` |
| player's progress | `a.pS = routeProgress(r, PV.x, PV.z, a.pS + PV.u * dt, 45).s`; searched +-45 m round the guess in 2.5 m then 0.5 m steps | `:214`, `routes.ts:22-27` |
| wrong way | `a.pMax - a.pS > 14` m for more than 0.6 s | `:217-218` |
| checkpoint | reached when `a.pS >= cpS - 1` (1 m short counts); `pCp` starts at 1 | `:93,220-226` |
| lap race finish | sprint/drift sector: the last checkpoint; loop: `pLap >= laps` | `:222-223` |
| player's time | `a.pFt = a.time` at the frame it is seen (frame resolution, not interpolated); laps and sectors are interpolated in `RaceTiming` | `:241,244`, `timing.ts:45-48` |
| AI finish | `R.s >= a.target - 1` -> `R.ft = a.time` | `:232` |
| AI not home when the player is | `R.ft = a.time + max(0, target - R.s) / max(6, R.vmax * .8); R.estimated = true` | `:245` |
| cap (solo, not drift) | `a.time > raceCapS(target)` = `max(600, 60 + target/8)` -> `playerFinish()` with a time | `:64,237` |
| drag finish | `s = dragS(PV.x, PV.z) >= route.len` -> `pFt = a.time`; failure -> `pFt = null` | `:263,277,280` |
| drag AI not home | `o.ft = a.time + rem / max(10, |o.V.u|); o.estimated = true` | `:281` |
| drift score | `D.cur += spd * ang * dt * 3.4` while `spd > 25` km/h and `ang > .17` rad; multiplier `1 + min(5, floor(dT/2.5))`; banked after 0.7 s idle; lost when `PV.hit > 4` | `:250-260` |
| order | drift: score desc; else `ft` asc with null last, ties by `s` desc | `:79-83` |
| results | 1.4 s after `state = 'done'`, `standings()` is frozen once; `pos` = index of `me` + 1; `time = a.pFt` | `:197,294-299` |
| solo payout check (server) | `pos` an integer 1..4; `time >= raceFloor(ev)`; wall time since `enter_event` `>= 3.0 + floor` | `payout.ts:53-68` |
| floor | `eventDistance / VMAX[type]`, `VMAX = { drag: 50, sprint: 65, circuit: 65, streetx: 65, drift: 65 }` m/s | `payout.ts:14,42` |
| challenge finish (server) | claim stands when `t >= floor && t <= elapsed + 0.1 && elapsed - t <= 0.5`, else the server's own elapsed time | `race.ts:235-250` |
| best time kept | `rec.best[ev.id]` = lowest valid `time`, per event, whatever car or model set it | `payout.ts:116-119` |

### 2.8 Unseeded `Math.random` (all of them in the scope)

| Where | Decides | Affects the race? |
|---|---|---|
| `events.ts:69-73` (`randomCfg`, ~14 draws per car) | the AI car's colour, finish, rims, kit | no (looks) |
| `events.ts:105` | the player's drag lane, solo | which lane |
| `events.ts:110` | the drag AI's torque factor `U(0,.06)` | yes |
| `events.ts:112` | drag AI reaction time and name | yes (reaction) |
| `events.ts:116` | drag lane traffic lane, speed, spacing | dead today (`noTraffic`) |
| `events.ts:118` | the player's grid place, solo | yes (front or back row) |
| `events.ts:124` | racer `vmax` factor `U(.96,1.04)` and name | yes |
| `events.ts:133` | `soloHold(Math.random)`: hold of the fifth light, 0.5..2 s | start timing only |
| `events.ts:233` | AI drift score per frame (also frame-rate dependent: one draw per frame) | yes (drift results) |
| `roadGraph.ts:91-92` | hub traffic's turn choice | hub only |
| `roadGraph.ts:123` (`hubPoint`) | where traffic and rivals respawn | hub only |

`lights.ts:20` (`soloHold(rand)`) and `race.ts` (`createRoom(..., rand)`) take the source as an argument. `ai.ts`,
`timing.ts`, `remote.ts`, `routes.ts`, `netPositions.ts`, `racePoses.ts`, `raceNet.ts`, `stateSync.ts`, `results.ts`,
`stripFlow.ts`, `raceMenu.ts`, `district.ts`, `zone.ts`, `park.ts` have none. Order of draws at a solo start is fixed by
the code path, so one injected generator would make a start reproducible; nothing injects one today.

---

## 3. `strip/ai.ts`: the kinematic AI and the collisions

Imports `clamp, syncBody, type Vehicle` from the old model (`ai.ts:3`).

### 3.1 `AI` (`ai.ts:7-13`) and `makeAI` (`:15-17`)

`x, z` m; `h` rad; `v` m/s (speed along `h`, never negative); `s` m along its route; `lane` m; `vmax, acc, brk`;
`stun` s; `nm` s (near-miss cooldown); `laps` (set to 0, never used); `done`; `ft`; `kind: 'traffic'|'rival'|'racer'`;
`wander`; `score`; `hold`; `parked`; `steer` rad; `cool` s; opaque `m`, `tag`.
Defaults: `lane 3.2, vmax 13, acc 5, brk 8`.

### 3.2 `stepAI(A, dt, playerS, _stage)` (`ai.ts:26-49`): exact model

| Step | Code |
|---|---|
| skip | `if (A.hold || A.done || A.parked || !A.route) return;` |
| look-ahead | `la = 7 + A.v * .5` m; target = `routePoint(rt, A.s + la)` offset by `lane` |
| steering | `steer = clamp(dh * 1.8, -.6, .6)`; `A.steer += (steer - A.steer) * min(1, dt * 8)`; `A.h += clamp(A.v * tan(A.steer) / 2.6, -2.5, 2.5) * dt` (a 2.6 m bicycle, no slip) |
| corner speed | for `d = 10..150` step 10: `turn` = heading change over that 10 m; `if (turn > .12) { vc = sqrt(150 / turn) + 1.5; vT = min(vT, sqrt(vc*vc + 2 * A.brk * .85 * max(0, d - 8))); }` -> about 15 m/s^2 (1.5 g) of lateral acceleration for every car |
| off line | `if (|dh| > .6) vT = min(vT, 7)` |
| catch-up (racers, `playerS != null`) | `gap = A.s - playerS; if (gap < -70) vT *= 1.22; else if (gap < -25) vT *= 1.08; else if (gap > 60) vT *= .86;` applied AFTER the corner limit, so it raises corner speed and lets `v` pass `vmax` by 22% |
| stun | `if (A.stun > 0) { A.stun -= dt; vT = min(vT, A.v * .9); }` |
| speed | `if (A.v < vT) A.v = min(vT, A.v + A.acc * dt); else A.v = max(vT, A.v - A.brk * dt);` |
| move | `A.x += sin(A.h) * A.v * dt; A.z += cos(A.h) * A.v * dt;` |
| progress | `A.s = routeProgress(rt, A.x, A.z, A.s + A.v * dt, 40).s` |

The AI has no walls, no tyres, no gears, no mass. It never calls `collideWalls`.
`playerS` is `a.pS` for racers (`events.ts:231`) and `null` for traffic and rivals (`strip/scene.ts:469`).

### 3.3 `separateAIs(list)` (`ai.ts:51-64`)
Pairs closer than 3.8 m are pushed apart by half the overlap each (positions only); between two racers the one with the
smaller `s` gets `v *= .97`. Called on `a.racers` when `!a.net` (`events.ts:235`) and on the non-racers
(`strip/scene.ts:475`).

### 3.4 Collisions on the player's old `Vehicle`

| Function | Reads | Writes | Notes |
|---|---|---|---|
| `collideWalls(V, walls?)` `ai.ts:86-111` | `V.x, V.z, V.h, V.vx, V.vz` | `V.x, V.z` (pushed out), `V.vx, V.vz` (`-= 1.3 * vn * n`, then `*= .92`), `V.w` (yaw kick), then `syncBody(V)` | two circles of r = 0.98 m at +-1.25 m along `h`; the walls are one module-level hash set by `setWallZone` (`:84`); returns the impact, m/s |
| `collideCar(V, A)` `ai.ts:113-129` | `V.x, V.z, V.h, V.vx, V.vz`, `A.x, A.z, A.h, A.v, A.parked` | `V.x, V.z` (60% of the overlap), `A.x, A.z` (40%), `V.vx, V.vz` (`-= 1.4 * rvn * n`), `V.w`, `A.v *= .85`, `A.stun = max(A.stun, 1.2)`, then `syncBody(V)` | 2 x 2 circles at +-1.2 m, contact at 2.1 m; skipped for every AI in a drag and for `remote` racers (`strip/scene.ts:452`) |

Both edit world velocity and position directly and rely on `syncBody` to carry it into `u`, `v`. They run every
sub-step, BEFORE `postStep`.

---

## 4. `strip/lights.ts`, `strip/timing.ts`

No Vehicle. `lights.ts`: lap races (`circuit`, `sprint`, `streetx`) use five lights, solo count length
`0.4 + 4 + hold` = 4.9..6.4 s (`lights.ts:9-10,22`); drag and drift use the 3.0 s count (`events.ts:93,187`).
While `state === 'count'` the car is pinned (2.2). A challenge names its green 5 s ahead on the server's clock.

`timing.ts`: `RaceTiming.step(key, s, t)` takes cumulative metres and race seconds; ignores a step that does not move
forward (`:44`); interpolates sector and lap crossings linearly between two steps (`:45-48`); keeps a time mark every
10 m for gaps (`:10,46`). Keys: `'me'`, `'r0'..'r3'`, `'p:<pid>'`. Fed from `a.pS`, `R.s` (`events.ts:216,230-232,241`).
Needs only a monotone `s` and a clock; indifferent to the driving model.

---

## 5. Other people's cars: `strip/remote.ts`, `raceNet.ts`, `racePoses.ts`, `netPositions.ts`

### 5.1 The race pose (15 a second)

Sent (`src/VanillaThreeScene.tsx:757`):
`roundPose([serverNow(), V.x, V.z, V.h, V.u, a.pS, a.drift.score + a.drift.cur * a.drift.mult])`

| # | Field | Unit | Rounding (`race.ts:73-77`) | Server clamp (`server.ts:1718`) |
|---|---|---|---|---|
| 0 | `t` | ms on the server's clock (`raceNet.ts:21`) | whole ms | replaced by the server's now when off by more than `POSE_SKEW_MS` |
| 1,2 | `x`, `z` | metres (physics frame, not scene units) | 0.01 | +-60000 |
| 3 | `h` | rad, unwrapped | 0.001 | +-1000 |
| 4 | `v` | m/s, the signed `V.u` | 0.01 | +-200 |
| 5 | `s` | m, the sender's own `a.pS` (in a drag: `dragS`) | 0.01 | +-60000 |
| 6 | score | drift points | whole | 0..9,999,999 |

Relayed as `race_pose` `[id, t, x, z, h, v, s, score]` (`raceNet.ts:43-53`) or batched `race_poses`
`[slot, t - goAt, x, z, h, v, s, score]` (`racePoses.ts:9-26`). Sent only while `state === 'race'`, plus one reliable
pose at the finish (`src/VanillaThreeScene.tsx:727,822`).

### 5.2 Placement

`RemoteCar` (`strip/remote.ts`): keeps 32 samples; reads the path `delay` ms back (80..600, starts 150), interpolates
`x, z, h (short way), v, s, sc` linearly, then carries the car forward along the ROUTE by `rate = ds/dt` clamped to
`0..RATE_MAX` (90 m/s) for the delay; after 250 ms without poses the carry eases out over 500 ms (`:13-18,41-70`).
`strip/scene.ts:504-514` then writes `R.x = p.x; R.z = p.z; R.h = p.h; R.v = p.v; if (!R.done) { R.s = p.s; R.score = p.sc; }`
and `drawAI` places the mesh at `(x*W, 0, z*W)`, `rotation.y = h + PI`, wheels rolled by `v`, steer 0.
A remote racer is never stepped, never collided with, never given an estimated time (`events.ts:230,245`), and its
finish comes from the room (`remoteDone`, `events.ts:145-149`).

At most `RACE_MAX - 1 = 3` remote cars are kept (`raceNet.ts:49`).

### 5.3 Free roam (`netPositions.ts`)
Not the Vehicle: the page sends the car MESH's position (`sync_player_pos`, scene units, `src/VanillaThreeScene.tsx:885-889`).
Strip pose on the wire: `[n*4+1, x*10, z*10, heading*100]`, heading wrapped to (-PI, PI] (`netPositions.ts:25,34-49`):
0.1 scene unit = 5 cm, 0.01 rad. Follows whatever `Driver.pose()` puts on the mesh.

---

## 6. Files in the scope with no tie to the driving model

| File | What it is | Only link |
|---|---|---|
| `strip/routes.ts` | polyline geometry: `buildRoute`, `routePoint`, `routeProgress`, `nearestRoadPoint`, `roadRoute` | `snapToRoad(V, roads)` `:46-51`: `V.x, V.z` to the nearest road point, `V.h` to the road's direction nearest the old heading, `V.u = V.v = V.w = V.vx = V.vz = 0; V.gear = 1` |
| `strip/roadGraph.ts` | hub road graph, wander paths, GPS | none (two `Math.random`) |
| `strip/district.ts` | hub and track data, `routeFor(eventId)` (throws if the track is not loaded) | none |
| `strip/zone.ts` | roads, walls, bounds of the current zone | walls feed `setWallZone` |
| `strip/park.ts` | THREE scenery; `laneRibbon` draws lane edges at lane +-2 m | none |
| `stateSync.ts` | state patches | none |
| `results.ts` | results card rows: `ft`, `estimated` (`'*'`), `gap`, `best` | reads `Standing` only |
| `stripFlow.ts` | visitor rules, `sanitizePosition` (+-60000 Strip, +-2000 town, scene units), `VISITOR_EVENTS` | a new socket event would have to be listed in `VISITOR_EVENTS` (`:51-59`) to work for guests |
| `raceMenu.ts` | menu model, `fmtTime`, bests from `rec.best` | none |

Route data: points every 3.00 m, `Route = { pts, cum, len, loop, cps }`, track width 11-12 m (`centre.width`), walls as
polylines. No surface type, no kerbs, no elevation. `routeProgress` returns the lateral distance `d`, which every caller
in the scope discards.

---

## 7. What the tests pin (must keep passing with the switch off)

| Test | Pins |
|---|---|
| `strip/events.test.ts:33-38` | `new EventRunner(makeVehicle(sedan()), ais, stubFx(), sedan)`; a tick is `r.input(NO_INPUT, dt); r.postStep(dt); r.update(dt)` at 1/60 |
| `:89`, `:282-286` | `r.PV.overRev = 2` then one `update` -> `fail === 'Engine blown'`, `pFt === null` |
| `:99-118` | the player is moved with `resetVehicle(r.PV, ...)` in 20 m hops and progress still counts; AI racers finish every lap with the player idle within 400 s of 1/60 steps |
| `:120-127` | a sprint is home 0.6 m short of its end |
| `:129-132` | a drag is home at `p0 + fwd * route.len` |
| `:263-270` | remote racers are not moved by `update` |
| `:307-312` | solo: 3 racers spawned, every one has a time (estimated) after the player's finish |
| `strip/ai.test.ts:31-55` | `collideWalls` / `collideCar` on a `makeVehicle` + `resetVehicle` car: pushed out, bounced, AI stunned |

---

## What an adapter must provide

### A. One mutable player-car object with the old `Vehicle` surface
The runner, the collisions and the scene share one object and write to it. Under the switch that object must still have:

- [ ] Read by the race logic: `x, z, h, u, beta, hit, overRev, blown, perfectN, P` (and `P.nos.cap`); by the collisions:
      `x, z, h, vx, vz`; by the pose sender: `x, z, h, u`.
- [ ] Written by the race logic, and the write must take effect on the next step: `x, z` (count pin, lane ease,
      collisions, `snapToRoad`, `resetVehicle`); `h` (drag pin, `snapToRoad`); `u, v, w, vx, vz` (count pin, drag pin,
      collisions via `syncBody`, drag crash); `gear = 1` (`snapToRoad`); `nos` (refill at the start); `hit = 0`;
      `blown = true` (must cut drive until the page clears it together with `overRev`).
- [ ] The engine's hidden state (wheel speeds, tyre relaxation, suspension, clutch, driveline wind-up) made consistent
      with those writes: either the facade is authoritative and read back before each step, or the adapter exposes
      explicit operations and the three writers call them: hold on the start line, constrain to a line and heading,
      teleport and stop, apply a velocity change from a collision.
- [ ] `P` or an equivalent the runner can pass to "how fast is this car" (B) and clone-and-detune for the drag AI (C).

### B. Function equivalents with the same contracts
- [ ] `makeVehicle(P)`: at rest at the origin, a full bottle.
- [ ] `stepVehicle(V, I, dt, drift)`: valid for `dt = 1/120` (player), for a variable `0 < dt <= 0.05` (drag AI) and for
      `1/30` (`simStats`), or the adapter sub-steps to its own fixed step inside. `dt = 0` must be a harmless no-op
      (the drag AI is stepped with it on a frame that ran no sub-step).
- [ ] `resetVehicle(V, x, z, h)`: position and heading set, all speeds 0, gear 1, idle, no boost, `overRev = 0`,
      `blown = false`, `hit = 0`; it does NOT refill `nos` and does not clear `perfectN`, `odo`, `top`.
- [ ] `syncBody(V)`: body speeds from world velocity after a collision edited `vx, vz`.
- [ ] `simStats(P)` or direct `playerTopMs(P)` (m/s) and `playerAccel(P)` (m/s^2, mean 0-100 km/h, 3 if never reached),
      cheap enough to call twice at every race start (cache per params object, or a closed form).
- [ ] The `drift` flag: true for the whole of a drift event (`src/VanillaThreeScene.tsx:1170`), meaning "a set-up that
      slides"; and a `beta` comparable to `atan2(v, max(|u|, 1.2))` in rad, since the score is `|u|*3.6 * |beta| * 3.4`
      per second above 25 km/h and 0.17 rad.
- [ ] Drag signals: `overRev` in seconds over the limiter with the throttle down (the runner blows the engine at 1.5),
      and `perfectN`, a counter that goes up once per well-timed upshift.

### C. Input as the runner rewrites it
- [ ] `Input`: `fwd`, `back` 0..1; `steer` -1..1, positive toward "right"; `nos`, `hb`, `manual`; `shiftUp`, `shiftDn`
      as one-sub-step edges; reverse is chosen inside the model from `back` held near a standstill.
- [ ] Count: `steer = 0, hb = false, nos = false`, throttle and brake live (the engine may rev; the car may not move).
- [ ] Drag (every state): `steer = 0, hb = false, manual = true`.
- [ ] A drag opponent built from the player's car with a torque scale `k = .86 + .05*stage + U(0,.06)`, driven by
      `{ fwd: 0 until react, then 1; manual; shiftUp near the limiter; nos after 60 m in third or higher }`, exposing
      `x, z, u` and (if the same driver logic is kept) `rpm, shift, gear, P.redline`.

### D. An AI racer that drives on real physics, to replace `makeAI` / `stepAI` for `kind === 'racer'`
It has to present the `AI` / `Racer` fields the rest of the game reads, and behave under the same switches:

- [ ] Fields kept current every frame: `x, z` (m), `h` (rad), `v` (m/s, for wheel roll, the drift score gate `v > 8`
      and `collideCar`), `s` (cumulative route metres, by `routeProgress` from its own position, never wrapped),
      `steer` (road-wheel angle, rad, sign of `V.delta`), `vmax` (m/s: used for the estimated finish time,
      `events.ts:245`), plus `done, ft, hold, parked, score, name, key, color, m, kind`.
- [ ] `hold === true`: stand still on the grid place (set at creation, released at the green, set again at the
      player's finish). `done === true`: no longer stepped.
- [ ] A step entry `step(R, dt, playerS, stage)` called ONCE a frame with `dt = 0..0.05` s: sub-step inside at the
      engine's fixed step and carry the remainder.
- [ ] A driver: steering toward a point `7 + 0.5 v` m ahead on the route offset by `lane`; a speed plan from the
      route's curvature (points every 3 m) limited by the car's own grip and brakes instead of the fixed 15 m/s^2.
- [ ] Walls: the AI must be kept on the road by its own collisions or by the driver; today nothing stops an AI at a wall.
- [ ] Being hit: `collideCar` moves `A.x, A.z`, scales `A.v` by 0.85 and sets `A.stun`; a physics AI has to accept that
      as a position change and a speed loss on its real car, or take over the contact.
- [ ] `separateAIs` moves racers apart and slows the one behind by 3% per frame in contact: same.
- [ ] The catch-up rule as an explicit handicap: +22% / +8% / -14% of target speed at gaps of -70 / -25 / +60 m. On real
      physics this needs a hook (power or grip scale, or a throttle cap) or a decision to drop it.
- [ ] A pace setting replacing `vmax = top * (.74 + .06*stage) * U(.96,1.04)` and `acc = accel * 1.1`: for example the
      player's own car with a power and grip scale per stage.
- [ ] Cost: 3 racers x up to 6 sub-steps a frame beside the player's 6.
- [ ] The outrun rival (`events.ts:337-350`) and hub traffic stay on the kinematic `stepAI` unless they are moved too;
      they read `vmax, acc, brk, cool` and are reset to `vmax 16, acc 6`.

### E. Network
- [ ] The pose stays `[t ms, x m, z m, h rad, v m/s, s m, score]` from the facade: `V.x, V.z, V.h, V.u` and `a.pS`.
- [ ] Remote cars keep being placed by `RemoteCar` + `placePeople`; no engine is involved on the receiving side.

### F. Timing and results
- [ ] `a.pS` keeps coming from `routeProgress(route, PV.x, PV.z, a.pS + PV.u * dt, 45)`: `u` must be the true forward
      speed in m/s, and the car must not move more than 45 m between two frames.
- [ ] `a.time`, `pFt`, `standings()`, `results()` unchanged; the messages `finish_event { eventId, pos, time, score, failed }`
      and `race_finish { time, score, failed }` unchanged.

---

## Traps

1. **Pins are written into the Vehicle after the step.** `postStep` zeroes `u, v, w, vx, vz` and restores `x, z` in the
   count (`events.ts:169`) and forces `h`, `v = w = 0`, `vx, vz` in a drag (`:171`). An engine with its own wheel,
   tyre or suspension state will fight this every sub-step (spinning wheels on a held car, heat and wear during the
   count, a yaw moment the pin throws away) unless it is told about the hold.
2. **Throttle is live in the count.** The player can sit on the limiter for 3 to 6.4 s; in the old model that costs
   nothing. With `overRev`, heat or clutch wear modelled, a drag can be lost before the green. `back` is live too
   (the old model selects reverse after 0.25 s).
3. **`postStep` runs after the collisions**, in the same sub-step (`src/VanillaThreeScene.tsx:1061`). In a drag a wall
   hit is computed and then overwritten by the pin; the impact still reaches `V.hit`.
4. **Collisions edit `vx, vz, w, x, z` and call `syncBody`.** If the new state object does not round-trip world
   velocity into body velocity the same way, walls stop working silently (the car is pushed out but keeps its speed).
5. **The drag AI and the lap AI are stepped once a frame with a variable dt up to 0.05 s**, the player at 1/120. A
   stiff model stepped at 0.05 s blows up or gives frame-rate-dependent times; `simStats` steps at 1/30.
6. **The drag AI is a shallow copy of the player's Params** (`{ ...P }`) with `tqMul` scaled. With nested or
   precomputed params (torque tables, cached curves) a shallow copy changes nothing, or changes the player's car too.
   `P.peakT *= P.tqMul` is also not a clean scale.
7. **The drag AI's `shiftUp` at 0.95 redline lands in the old perfect-shift window**: it gets +10% torque for 1.2 s on
   most shifts. Any change to that window changes drag difficulty.
8. **AI pace is derived from `simStats` of the OLD model.** If the player drives the new engine and `playerTopMs` /
   `playerAccel` still simulate the old one (or the reverse), the field is calibrated to a car the player is not
   driving. `events.ts:120` computes both before the switch could be consulted unless it is passed in.
9. **The kinematic AI corners at about 1.5 g, accelerates at a constant `acc` to `vmax`, ignores walls, and can exceed
   `vmax` by 22% when behind.** A physics AI in the same car will be far slower in corners and at speed; keeping the
   `.74 + .06*stage` factors will not keep the difficulty.
10. **Server floors assume the old model's speeds.** A solo finish under `distance / 65 m/s` (drag: `/ 50`, so 8.04 s
    for the 402 m and 16.1 s for the 805 m strip) is refused as "impossible time" and pays nothing
    (`payout.ts:14,63`); a challenge claim under the floor is not a finish (`race.ts:240`). A faster engine or car
    needs these raised on the server, which is not behind a client switch.
11. **`pos` must be 1..4** (`payout.ts:60`) and there are only 4 grid places (`events.ts:95,118`): a solo race with more
    than 3 AI opponents has finishes the server refuses to pay (5th and lower), and in a challenge any `slot >= 4`
    is clamped onto place 3 (`gridOf`), so those cars start on top of each other.
12. **Best times are per event, not per model** (`payout.ts:116-119`, shown by `raceMenu.ts:58,74`): a best set on one
    model stands against the other.
13. **Remote extrapolation caps at 90 m/s** (`strip/remote.ts:18`) and the server clamps pose speed to +-200 m/s: a car
    over 324 km/h trails its true place on other screens.
14. **A challenge has no model identity.** Poses and finish claims look the same from either model; two people in one
    room can be on different physics and the room cannot tell.
15. **Solo race time is simulated time** (`a.time += simDt`), finish detection is per frame, not per sub-step, and
    progress is resolved to 0.5 m. Times are quantised to the frame; an engine that changes how many sub-steps run per
    frame changes the times.
16. **`routeProgress` searches +-45 m round a guess made from `PV.u`.** A wrong sign or unit on `u`, or a teleport,
    loses the car's place on the route (wrong-way banner, missed checkpoints).
17. **`input()` returns a fresh object only while an event is live**; otherwise it returns the Driver's own reused
    `I`, which `driver.ts:61` then mutates when the tank is empty. An adapter that keeps a reference to the input sees
    different aliasing in and out of events.
18. **In a drag, steering and the handbrake stay off after the finish** (`events.ts:164` tests the type, not the state)
    while the heading pin is released (`:170` tests `state === 'race'`): the car coasts unpinned and unsteerable until
    the results are closed.
19. **`resetVehicle` does not refill nitrous**; the runner does (`events.ts:106,119`). `snapToRoad` sets `gear = 1` and
    zeroes speeds but leaves `rpm`, `boost`, `blown`. An adapter that maps both to one "reset" changes behaviour.
20. **`blown` is set by the runner and cleared by the page** (`src/VanillaThreeScene.tsx:742`), not by `cleanup()`:
    a new engine that tracks damage itself must honour the external flag in both directions.
21. **`collideWalls` uses one module-level wall set** (`ai.ts:68-70,84`): a physics AI calling it shares the player's
    zone, and it expects the old `Vehicle` fields.
22. **Finished AI racers stop dead on the track and stay collidable; held racers after the player's finish too.** A
    physics AI that coasts on instead changes what the player meets after the line.
23. **The AI's drift score is random per frame** (`events.ts:233`), so it depends on frame rate, and all race
    randomness is unseeded `Math.random`: no run is reproducible, and a bench comparing the two models through the
    runner needs a seeded source first.
24. **`events.test.ts` and `ai.test.ts` build old `Vehicle`s directly** and poke `r.PV.overRev`, `resetVehicle(r.PV, ...)`:
    changing `EventRunner`'s constructor or the type of `PV` breaks them even with the switch off.
