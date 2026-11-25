# @micar/physics: build contract

This is the contract every module is written against. It carries out `docs/superpowers/specs/2026-11-11-physics-core-design.md`
(the plan of record) and adds four things that plan lacks: an engine modelled as airflow, elevation-ready ground, a parts
exam, and card figures from the bench. `src/types.ts` holds every shared type; this file holds the conventions, the
equations and each file's exported functions. If the two disagree, `types.ts` wins and this file is fixed.

## 0. Rules for whoever builds a file

1. **Real figures in, behaviour out.** Nothing is fitted to a test except a car's tyre grip scale (to its skidpad
   figure, inside its tyre category's range) and its drag area (to an ungoverned top speed, only when no drag figure is
   on file). Never power, weight, gearing or a per-car fudge. If a check cannot be met with real inputs, report the
   error table. Do not bend an input.
2. **Class tables are the only place a "typical" value lives** (`classes.ts`). They may be tuned, with a physical
   reason, for every car at once. Never for one car.
3. **The same result on every machine.** Under `src/` (tests and `scripts/` aside) the only `Math` members allowed are
   `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `trunc`, `sign`, `imul`. No `sin`, `cos`, `tan`, `atan`, `atan2`,
   `exp`, `log`, `pow`, `hypot`, `cbrt`, `random`, and no `**` with a non-integer exponent. Use `math.ts` (`dsin`, `dcos`,
   `datan`, `dexp`, `dln`, `dpow`). No `Date`, no iteration order that depends on object key insertion at run time.
   A test scans the sources for the forbidden names.
4. **No allocation inside `step`.** State lives in the `VehicleState` and its typed arrays; scratch objects are module
   level and reused. No closures, array literals, object literals or spreads on the path `step` runs.
5. **SI inside.** Published units stop at `resolve.ts`.
6. Plain TypeScript that passes both compilers (`scripts/check.sh`): `import type` for types, no enums, no
   namespaces, no parameter properties, nothing newer than ES2020, `.ts` extensions are not written in imports
   (bundler resolution, as `@micar/engine` does it). No dependency is added.
7. Every exported function has a short doc comment saying what it does in plain words. Comments explain why.
8. Each source file has a `*.test.ts` beside it (vitest). Tests assert physics, not implementation.

## 1. Conventions

- Body axes: x forward, y left, z up. Yaw rate `r` and steer are positive to the left. Roll is positive right side
  down (so a left turn rolls the car positive). Pitch is positive nose down (so braking pitches positive).
- World: ground plane X, Y. Heading is the unit vector `(hx, hy) = (cos yaw, sin yaw)`. World velocity of the centre
  of gravity is `(u hx - v hy, u hy + v hx)`.
- Wheels: 0 FL, 1 FR, 2 RL, 3 RR. Position in the body: `x = +a` front, `-b` rear; `y = +track/2` left, `-track/2` right.
- A tyre force `fx` pushes the car forward when positive; `fy` pushes it left. Slip ratio is positive when driving.
  `wheelSlipTan` is positive when the force it produces points left.
- `Controls.steer = +1` is full lock left. Throttle, brake, handbrake and clutch run 0 to 1.
- Engine speed and wheel speed are rad/s. A gear ratio is engine turns per output turn.

## 2. The step

`step(state, controls, world)` advances 1/120 s as `SUBSTEPS = 4` substeps of `h = 1/480 s`. Everything advances in
the substep (the plan of record ran the body at 120 Hz; running it with the wheels costs little and removes a
splitting error). Halving `h` must not move a bench figure by more than 1%. `stepWith` cuts the same 1/120 s into
another whole number of substeps (floored, and held between 1 and 1024).

One substep, in order:

1. **Controls to actuators.** `steerAngles` writes `wheelSteer`: the input clamped to [-1, 1] (the rack's end stops),
   both front wheels `steer * maxSteer` (no Ackermann), rear 0. `autoShift` runs every substep and returns the gear
   wanted: unless it is `AUTO_GEAR`, the request itself, rounded and clamped (and, in any box but a manual, no lower
   than keeps the engine within redline; section 5.2). It reads the pedal as the gearbox controller does, through
   `shiftPedalStep`'s filter, whose value is the state's `shiftPedal`.
2. **Air.** `aeroForces(model.aero, u)` gives drag and lift at each axle.
3. **Loads.** `wheelLoads` writes `wheelLoad` from the static split, lift, and the load transfer of section 4, using
   `state.ax`, `state.ay` from the previous substep.
4. **Tyres.** `world.surfaceAt` is asked once at each wheel's contact point. A field the world leaves unset is flat
   dry asphalt; a grip below zero or not a number is 0, a rolling factor below zero is 0 and one not a number is 1.
   For each wheel, `tyreForces` turns its slip states and load into `wheelFx`, `wheelFy`, `wheelMz` (section 3), with
   that wheel's grip and the contact patch's sliding speed `sqrt(Vsx^2 + Vsy^2)`.
5. **Systems.** `brakeTorques` (pedal, handbrake, ABS, brake-force distribution), then `stabilityControl` (adds
   brake), `tractionControl` (its brake half adds brake; it returns the engine half's cut, a share of the engine's
   drive) and `limiterCut` (returns the governor's). Then the tyres' low-speed damping (section 3) joins `wheelFx` and
   `wheelFy`: here and not in step 4, because its stable form depends on whether the brake holds the wheel.
6. **Driveline.** `drivelineStep` gets the throttle `throttleForShare(engine, omega, boost, clamp(controls.throttle, 0, 1)
   * governor, traction control's cut)`: the throttle that makes that share of the drive the pedal and governor ask for,
   works out engine torque and advances `engineOmega`, `wheelOmega`, boost, clutch, shift and ratio (section 5). The
   ground's rolling factor under each wheel reaches it through `driveline.surfaceRolling` (section 10).
7. **Body.** Rotate each tyre's force into the body by its steer angle (`dcos`, `dsin`). Sum forces and yaw moment
   (aligning moments included) in pairs, left and right first and then front and rear, so that a mirrored car adds
   the same numbers; add drag and the coast-down's road load (`roadLoad`, `-(A soft(u, 0.02) + B u)`: friction, all
   of it against a rolling car and none on one at rest). `ax = sum Fx / m`, `ay = sum Fy / m`:
   what an accelerometer reads, every force but gravity, and what the next substep's load transfer uses (so a car
   parked on a hill carries more on its downhill axle: `m g grade h / L`, 302 N on the fixture car on a 10% grade).
   Gravity joins the speeds only: `gx`, `gy` are `-g` times the slope along each body axis, from the gradient
   averaged over the four contact points. It is the gradient, not its sine, because the wheel loads are `m g`
   whatever the slope: that keeps push over load, and so the grade at which a braked car starts to slide, exact (if
   the loads ever take a cosine, switch to the sine). Then `u += (ax + gx + v r) h`, `v += (ay + gy - u r) h`, `r += (Mz / Izz) h` (the old `u`, `v`, `r`
   on the right-hand sides, all three updated together). Turn the heading by the new `r h` with `dcos`/`dsin` and
   renormalise it. Move `x`, `y` with the new `u`, `v` and heading. Add to `distance`.
8. **Suspension.** `suspensionStep` advances heave, pitch and roll (section 4).
9. **Tyre slip states.** With the new body and wheel speeds, advance each wheel's two deflections and apply the
   re-stick rule (section 3).
10. `time += h`.

At rest with no input the car must stay exactly at rest: on its brakes in gear, with nothing pressed in a clutch car,
or in neutral. An automatic in drive with the brake off creeps, as its converter makes it (sections 5.2 and 9).

`createVehicle(model)` sets the car down at the origin facing +X: each wheel at its static load, the tyres
undeflected, the engine at idle, first gear, the ratio of first (a CVT's lowest gearing: the larger of its two ends,
whichever order the model lists them in). It works out the model's shift points (through `createState`), outside the
step. `placeVehicle` (a reset or respawn: moved there, stopped) normalises the heading; zeroes the body, the wheels,
the tyre deflections and the suspension; sets the static loads, the engine back to idle and no boost; clears the ABS,
traction and stability control memory and the gearbox controller's pedal (`shiftPedal` 0); finishes any shift (the gear is kept; a CVT goes back to its lowest gearing);
and keeps `time`, `distance`, `energyUsed` and `nitrousLeft`.

`applyImpulse(state, jx, jy, atX, atY)`: a world-frame impulse (N s) at a world point changes `u`, `v`, `r` at once.
The wheels keep turning; their tyres take it up as slip. Collisions stay in the app.

`telemetry(state, out)` fills a record without allocating: `rpm` in rpm; `wheelSpeed` in rad/s;
`wheelSlipAngle = atan(wheelSlipTan)` in rad, positive when the tyre pushes left; `sideslip = atan2(v, |u|)`, so
reversing straight is no sideslip; `throttleTorque` the engine's brake torque, N m;
`clutchSlip = (engine - G * driven-wheel mean) / engine`, 0 locked, 1 with the wheels still, negative on the
overrun, 0 in neutral; `wheelUse` each tyre's `use` in the last substep. `wheelUse` is an output, not state: it is kept beside the state in a module-level map that
`createVehicle` registers, and is not hashed; a state made only with `createState` falls back to its use on dry
asphalt.

`hashState` folds every scalar, then each typed array's length followed by its elements, in a fixed order written out
by hand (FNV-1a over each number's eight bytes, with +0 and -0 alike and every NaN folded as the quiet NaN). The model
is not hashed. A one-ulp change to any number changes the hash.

## 3. Tyres (`tyre.ts`)

A brush model on the combined slip, with load-dependent friction and stiffness, a fall after the peak, and a lag.

**Slip states.** Each wheel has two deflections, `defX` and `defY` (m). With `Vx` the wheel centre's speed along the
wheel, `Vsx = Vx - omega * radius` (negative when driving) and `Vsy` the wheel centre's speed across the wheel:

```
defX' = -Vsx - (|Vx| / relaxLong) * defX        slipRatio = defX / relaxLong
defY' = -Vsy - (|Vx| / relaxLat)  * defY        slipTan   = defY / relaxLat
```

Integrate implicitly (`relaxStep`): `def = (def - Vs * h) / (1 + |Vx| * h / relax)`. In steady rolling this gives the
usual `slipRatio = -Vsx / |Vx|` and `slipTan = -Vsy / |Vx|`. At a standstill the deflection is a spring that holds the
car. At `h = 1/480` the update lags a little: after one relaxation length the deflection reaches 61.7% at 20 m/s and
61.0% at 30 m/s, against 63.2% exact; it converges as `h` shrinks. Clamp each deflection, on its own, to
`relax * 3 * (slip at the peak)` (`maxDeflectionX`, `maxDeflectionY`) so a spinning or locked wheel does not wind it
up (the cost of clamping each axis on its own is in section 9's open questions).

**Re-stick.** While a patch slides its states run on past the peak, but only the part that carries the sliding force
is rubber bent; the rest is distance slid. At speed the relaxation takes the excess out within a few relaxation
lengths; near a standstill nothing does, and it would push a car that slid to rest back by up to three peak slips. So
near a standstill (blended in by the low-speed fade of rolling speed times that of slide speed), when a patch past
its peak (`use > 1`) has slip that now unloads it (the states head back toward zero), only the elastic share is kept:
both deflections are scaled by `pe / use`, where `g(pe)` on the sticking side equals `g(use)` on the sliding side, so
the force does not jump (`elasticShare`; vehicle.ts applies it in step 9). During a slide nothing changes.

**Low-speed damping.** Below 1.5 m/s of rolling speed the standstill spring gets a damper `-c * Vs`, fading out
linearly by 1.5 m/s (`lowSpeedFade`, `LOW_SPEED_FADE`). `c` (`lowSpeedDamping`) is critical for the corner's share
of the car's mass (its load over g) on the stiffer of the tyre's two springs, the longitudinal one,
`cKappaPerFz * Fz / relaxLong`: 414 kN/m and 25.7 kN s/m for a 400 kg corner. Sideways (`Ca / relaxLat`, 126 kN/m)
that is about 1.8 times critical: no ringing either way, but sideways it takes about 1 s to settle. The damping is
sized for the car's mass, not the wheel's (`J / R^2` is about 12 kg), so it is taken implicitly, after the systems
step: `F = -c Vs / (1 + c h (1/m_corner + R^2/J))` along a wheel that turns freely, the same without the `R^2/J` term
along a wheel its brake holds this substep and across any wheel (there only the body moves). Explicitly
`c R^2 h / J` is about 4.5 (it must stay under 2) and the wheel chatters. The damped force stays inside the friction
the brush leaves: the peak ellipse while the patch sticks, the brush's own sliding force once it slides.

**Force.** With load `Fz > 0` and grip above 0 (otherwise all four outputs are exactly 0):

```
muY  = muY0 * (1 - loadSens * (Fz / fz0 - 1)) * grip        clamped to [0.55, 1.25] * muY0 * grip
muX  = muY * muXRatio
Ca   = cAlphaMax * 2 n / (1 + n^2),  n = Fz / fzStiffPeak,  cAlphaMax chosen so Ca(fz0) = cAlpha0
Ck   = cKappaPerFz * Fz
px   = Ck * slipRatio / (2 muX Fz)      py = Ca * slipTan / (2 muY Fz)      p = sqrt(px^2 + py^2)
g(p) = 2p - p^2 = 1 - (1 - p)^2                           for p <= 1   (peak 1 at p = 1, slope 0 there)
     = s + (1 - s) / (1 + slideFall * (p - 1)^2)          for p > 1    (falls smoothly to the sliding share s)
s    = slideRatio, less 0.004 for each m/s of sliding speed, never below 0.6 * slideRatio
fx   = muX * Fz * g * px / p            fy = muY * Fz * g * py / p            (p = 0 gives 0)
mz   = -trail0 * (1 - p)^2 * fy   for p < 1, else 0
use  = p
```

The first slope is the stiffness, the force never leaves the friction ellipse, and the curve is smooth where
sticking turns to sliding. The belt is compliant: it twists under the tyre's own aligning moment, so a whole tyre
measures softer than its tread and peaks at a smaller slip than a brush on a rigid belt. (The rigid brush,
`g = 3p - 3p^2 + p^3` with 3 in place of 2 in `px` and `py`, put the all-terrain, winter and drag tyres of section
7's table at 13.2 to 14.0 degrees and the drag tyre at 0.233 slip ratio. The shape is one constant, `SHAPE` in
tyre.ts; 3 gives the rigid brush back.) `peakSlipRatio = 2 muX / cKappaPerFz` and `peakSlipTan = 2 muY Fz / Ca` (the
ABS, traction control and the assists aim near them); the starting ranges are about 6 to 10.5 degrees and 0.11 to
0.16 slip ratio across the categories at 0.6 to 1.4 x `fz0`. `Ca / Fz = cAlpha0 (1 + n0^2) / (fz0 (1 + n^2))` stays
finite as the load goes to zero, so a lifting wheel's peak slip and clamp stay finite. The aligning moment peaks at a
quarter of `trail0 * muY * Fz` (30.6 N m for the summer tyre at 4 kN, near 2.1 degrees) and is gone at the peak,
which is what a driver feels go light in the steering.

**Rolling resistance** is a friction of size `rollRes * Fz * rolling` (`rollingResistance`) against the wheel's
rotation, solved on the wheel with its brake (section 5.2): all of it while rolling, as much as stops a slowing wheel,
none at rest. It reaches the car through the tyre's `fx`; no force is added on the body as well, which would count it
twice.

## 4. Chassis (`chassis.ts`)

Static load per wheel: front `m g b / (2 L)`, rear `m g a / (2 L)`, with `L = a + b` everywhere in this section (so
the static loads always sum to `m g`, even if a resolver's wheelbase and `a + b` disagree slightly; `L = 0` splits
evenly). Lift takes `liftFront/2`, `liftRear/2` off each. Drag acting at the centre-of-gravity height moves
`drag * cgHeight / L` from front to rear (from rear to front when reversing), straight onto the axle loads rather than
through the pitch springs: the steady loads are exact, but the body does not pitch from drag.

**Pitch** (sprung mass on its springs; `Ktheta = 2 (kF a^2 + kR b^2)`, `Ctheta = 2 (cF a^2 + cR b^2)`):

```
anti   = antiSquat when ax > 0 and the rear is driven, antiDive when ax < 0, else 0
Iyy * pitch'' = -ms * ax * hs * (1 - anti) - Ktheta * pitch - Ctheta * pitch'
rear axle gains   dLong = [ ms * ax * hs * anti + (muF * huF + muR * huR) * ax ] / L  -  (Ktheta * pitch + Ctheta * pitch') / L
front axle loses the same.
```

The rear is driven for rear and all-wheel drive; a front-drive car gets no anti share under power (front anti-lift is
not modelled). At rest in the steady state this is `m ax h / L`, as statics demands (the resolver keeps
`ms hs + mu hu = m h`).

**Roll** (`hRoll = hs - (rcF + (rcR - rcF) * a / L)`, `Kf = kF tF^2 / 2 + arbF`, `Cf = cF tF^2 / 2`, the same at the rear):

```
Ixx * roll'' = ms * ay * hRoll + ms * g * hRoll * roll - (Kf + Kr) * roll - (Cf + Cr) * roll'
front transfer to the right wheel  dF = [ Kf * roll + Cf * roll' ] / tF + (ms * b / L) * ay * rcF / tF + muF * ay * huF / tF
rear  transfer to the right wheel  dR = [ Kr * roll + Cr * roll' ] / tR + (ms * a / L) * ay * rcR / tR + muR * ay * huR / tR
```

The `ms g hRoll roll` term is the body's weight moving outboard as it rolls. So the steady roll is
`ms hRoll / (Kf + Kr - ms g hRoll)` per m/s^2 (`rollGradient`; 3.08 deg/g on the fixture car), and the steady lateral
transfer moment is `m ay h + ms g hRoll roll`, not `m ay h`: on the fixture at 0.8 g, 6,816 N m against 6,527 N m,
4.4% more. `Ixx` and `Iyy` are the sprung body's inertias about the roll axis and about the ground (section 7).

**Heave:** `ms * heave'' = (liftFront + liftRear) - 2 (kF + kR) * heave - 2 (cF + cR) * heave'` (lift raises the body,
downforce lowers it). It is read by telemetry and the camera.

Wheel loads: `FL = front/2 - dF`, `FR = front/2 + dF`, `RL = rear/2 - dR`, `RR = rear/2 + dR` with the longitudinal and
aerodynamic terms already in `front` and `rear`. A load below zero becomes zero and its axle partner takes the whole
axle (a wheel can lift; the axle's sum is kept; at the cap the wheel reads exactly 0 and its partner exactly the whole
axle). The moment that axle can no longer hold goes to the other axle, as a body stiff in torsion passes it: the
fixture with `arbRear` 120,000 at 1.1 g lifts its inner rear (0 N) and moves 578 N m to the front. Whatever neither
axle can hold is the car tipping over, which is not modelled. If an axle's sum is below zero, the other axle takes the
whole car (front plus rear), so the car's weight is still held in a wheelie or a stoppie; all four are zero only when
lift exceeds weight. A zero track or a zero inertia gives no transfer or no body motion rather than a division by zero.

Integrate pitch, roll and heave semi-implicitly (rate first, with the damping term taken implicitly, then the angle).

## 5. Engine and driveline (`engine.ts`, `driveline.ts`)

### 5.1 Engine as airflow

Tables are uniform in engine speed from 0: `n` points `dOmega` apart. The step is the first round figure of 10, 15,
20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750 and 1000 rpm that keeps
`n = floor(span / dOmega) + 2` at 96 or fewer, which also keeps it at 64 or more. `limiterBand` is 3% of redline. An
engine with an air model gets `span = max(1.2 (redline + limiterBand), redline + limiterBand + 1500 rpm)`, so the parts
that raise the redline (up to 1,400 rpm all together) still find table under them; an electric motor or an authored
curve gets `redline + limiterBand`. `buildEngine(spec)` throws for a spec built from its peaks whose peak torque or
peak power is not a positive, finite number. Then:

1. **Target full-throttle curve** from the published peaks (`targetTorque` reads it). Figures that cannot all be true
   are made consistent here, never elsewhere: the power-peak speed is at least `1.02 Pmax / Tmax`, the end of the
   torque plateau at most `0.97 Pmax / Tmax`, the idle knot at most 0.8 x the torque-peak speed. The curve is a
   piecewise cubic Hermite in log speed and log torque, whose slope is the elasticity `d ln T / d ln omega`, through:
   idle (60% of peak torque for an unboosted or supercharged engine, 45% for a turbocharged one), the torque peak
   (value `Tmax`, elasticity 0; a plateau from `torqueOmegaLow` to `torqueOmegaHigh` when the maker gives a range), a
   knot between the torque and power peaks, the power peak (value `Pmax / omegaP`, elasticity -1, so that power is
   stationary there), and redline, where power is `Pmax / (1 + 0.65 (redline / omegaP - 1))`: 88.7% of the power-peak
   torque for a power peak 7.5% below redline, no cliff in the last 200 rpm when the peak sits just under redline, and
   still a fall when it is far below. From the torque peak on, each piece is quadratic in elasticity, so elasticity
   runs straight between knots and stays in [-1, 0] between the two peaks: torque never rises there and power never
   falls, so neither peak can be beaten anywhere. (A Hermite in torque against rpm through the same knots puts a 2.0
   four 0.51% over its torque peak just after it and a 6.2 pushrod V8 0.12% over its power peak just before it.) A
   turbocharged engine rises like an unboosted one (elasticity 0.15, about 11% more torque for each doubling of
   speed) from idle to its boost threshold, then one monotone cubic climbs to the plateau: without that a 3.5 L truck
   V6 made 515 N m with no boost at 1,350 rpm, about 18.5 bar BMEP. Below idle the table holds the idle figure (there
   is no stall model). Both published peaks must come out within 0.5% in value, and at their published speeds to
   within one table step (a uniform table of 64 to 96 points cannot put any two speeds on points: the sports car's
   6,450 and 5,150 rpm share only a 50 rpm divisor, which would need about 180), and no other point may exceed them.
   An authored `curve` is used as given. An electric motor: flat `Tmax` up to `Pmax / Tmax`, then `Pmax / omega`,
   tapering in a straight line to 0 at redline over the last 10% of its speed range.
2. **Friction** from `fmep` (Pa) `= f0 + f1 x + f2 x^2`, `x` in thousands of rpm: torque `= fmep * displacement / (4 pi)`.
   `buildEngine` starts every engine as petrol, the class table's `FMEP.petrol = [100e3, 0, 1.0e3]` (VALIDATION.md fix
   2: the Shinn-Flynn form at an unboosted engine's full-load peak pressure, held at every load and boost); the resolver
   refits a diesel (section 7). The closed-throttle drag is this plus pumping (`PUMPING_MEP = 75e3 Pa` more: a closed
   throttle's manifold vacuum, applied to every combustion engine, a diesel's included). Below 0.5 rad/s the drag falls in a straight line to
   nothing at rest and turns round for a shaft turned backward: drag opposes the turning, it never drives a stopped
   shaft. An electric motor's friction table holds its regeneration instead (below).
3. **Air model** (a combustion engine built from its peaks; an electric motor and an authored curve have none).
   Pressure ratio at full boost: 1 for an unboosted engine. A turbo's rises from 1 at the boost threshold
   (`max(0.45 torqueOmegaLow, idle)`) to `prMax = 1 + boost / ambient` at `torqueOmegaLow`, in step with the target
   curve's rise (the boost is what makes that rise). A supercharger's is driven by the crank: 60% of its boost at
   idle, growing with the target's rise to `prMax` at `torqueOmegaLow`. Both hold `prMax` to the power peak; past it
   `pr - 1` scales with the target over its value at the power peak, as the compressor runs out of flow. Charge
   density ratio `dr = pr * Tamb / Tman`, `Tman = Tamb + (1 - intercooler) * Tamb * (pr^0.286 - 1) / compressorEff`.
   Then `specific[i] = (target[i] + friction[i]) / (dr[i] * (1 - blowerDrive * (pr[i]-1)/(prMax-1)))`: the engine's
   own breathing, with the boost divided out. That table is what a part multiplies. Stock charge air comes from the
   class tables (section 7): `compressorEff` 0.70; `intercooler` 0.70 behind a turbo, 0.60 behind a supercharger;
   `blowerDrive` 0.12 for a supercharger, 0 for a turbo. `knockLimitPr = max(2.6, prMax)`: a stock engine is
   knock-safe on its own boost. `maxAirflow` is 1.3 x the stock engine's highest airflow when it is boosted (a
   production compressor is matched with flow in hand: data/exam's GTI gained about a third on its stock turbo), and
   Infinity when it is not.
4. `rebuildTables(e)` goes the other way and is the only writer of `wot`, `offBoost`, `friction` for an engine with an
   air model (one without is left as built): `pr` is capped at `knockLimitPr`; `indicated = specific * dr(pr)`, capped
   so that airflow `indicated * omega / AIR_ENERGY` stays under `maxAirflow`;
   `wot = indicated * (1 - blowerDrive * (pr - 1) / (prPeak - 1)) - friction`, with `pr` the knock-capped ratio and
   `prPeak` the highest ratio in the current table (`EngineAir` keeps no `prMax`); for a turbo engine
   `offBoost = specific - friction`, `specific` under the same airflow cap (its own array: one is allocated if a model
   shares it with `wot`); otherwise `offBoost = wot`. `AIR_ENERGY = 1.15e6 J` of indicated work per kg of air. A stock
   engine rebuilt gives back its target curve to within rounding.

`engineTorque(e, omega, throttle, boost)`:
```
full = offBoost + min(1, boost / spool) * (wot - offBoost)    (a turbo with lag; otherwise full = wot. Table lookups at omega)
T    = throttle * (full + friction) - friction - pumping * (1 - throttle)
```
`boost` is the share of full boost that has built (`boostStep`); `spool` is the share a fully spooled turbo can hold
at this speed, read from the pressure-ratio table: 0 below the threshold, rising with the ratio to 1 where it stops
rising. `wot` already holds that ramp, so the state counts against it, not twice. Past `redline` the positive part of
`T` fades to zero over `limiterBand`. Near and below idle an idle governor adds `(idle + offset - omega) * kIdle`,
`kIdle = 0.4 Tpeak / (0.2 idle)` (`Tpeak` the top of `wot` up to redline), capped at `0.4 Tpeak`, and nothing from 1.5
x idle up. Its set point sits above idle by `offset = (closed-throttle drag at idle) / kIdle` (at most half of idle),
so that a free engine settles at idle itself rather than below it. It works the idle air valve, a bypass round the
throttle, so it is scaled by `1 - throttle`: full throttle below idle never beats `wot`. Electric: no governor; the
friction table holds `regen * Tmax * min(1, omega / omegaBase)` with `regen = 0.2` (about 0.2 g of lift-off braking
in a single-speed car) and the pumping term is 0 (no displacement), so a lifted throttle gives exactly
`-regen * Tmax * min(1, omega / omegaBase)`, fading in from standstill so that a stopped car does not creep backward.

**Boost** (a turbo built from its peaks): target `bt = throttle^2 * spool`. It rises with
`tau = clamp(tauRef * omegaRef / omega, tauMin, tauMax)` (start: `tauRef = 0.45 s` at `omegaRef = 3000 rpm`,
`tauMin = 0.12`, `tauMax = 1.6`) and falls with `fallTau = 0.15 s`, integrated implicitly,
`boost += (bt - boost) * h / (tau + h)`: the same lag, stable for any `h`. An engine without lag returns its boost at
once (`throttle^2` for a supercharger, or a turbo with an authored curve, which has no off-boost data; 0 for none).

`enginePeaks` reads the `wot` table up to redline as the car makes it (straight between points): a power peak between
two points is found on their parabola, and a plateau is quoted by its first speed (an electric motor's torque speed
is therefore 0).

### 5.2 Driveline: speeds as constraints

Bodies: the engine (`inertia`) and four wheels. If `h <= 0` nothing changes; an inertia of 0 or less is immovable
rather than divided by. In a substep:

1. The gear and the ratio (**Shifting**, **CVT** below), then engine torque from 5.1 (throttle after traction
   control and the governor; nitrous adds its torque, below), boost and the energy booked. Unless mid-shift,
   `engineOmega += (T - pump) h / inertia` (`pump`: an unlocked converter's pump torque). Each wheel:
   `wheelOmega += (drive - fx * radius) h / J` (`drive`: an unlocked converter's or a shift's torque at that wheel).
2. Then solve these velocity constraints by sequential impulses: at least 8 passes, then on until no accumulated
   impulse moves by more than 1e-12 N m s in a pass, at most 64. Each keeps an accumulated impulse clamped to its
   limit (all deterministic arithmetic). The brakes are solved first in each pass. A wheel its brake holds (limit
   above 0, not saturated) counts as immovable in the other constraints' effective masses, and each of them hands its
   push straight to that brake. Without that, a locked centre, an open differential and the brakes' limits trade a
   residual for ever, which shows as a slow, steady creep; the pickup averages about 20 passes as its locked centre
   and clutch trade it down to 1e-12.
   - **Brake** per wheel: `wheelOmega = 0`, limit `(wheelBrake + rollRes * Fz * rolling * radius) * h`: rolling
     resistance is Coulomb friction solved with the brake (section 3). When the brake can hold, the wheel is set to
     exactly zero, not nearly: a locked wheel stays locked and a car held on its brakes does not creep.
   - **Clutch** (launch `clutch`, or a locked converter, or `direct`): `engineOmega - G * omegaDrive = 0`, where
     `G = ratio * finalDrive` and `omegaDrive` is the weighted mean of the driven wheels (each wheel of a driven
     axle weighs `axleShare / 2`). Limit `clutchCapacity * engagement * h`. The impulse `L` takes `L / inertia` off
     the engine and gives each driven wheel `L * G * weight * eff / J` (`eff = efficiency` when the engine drives,
     `1 / efficiency` on the overrun; where `L` would cross zero the rest of the step is solved on the other side).
     `direct` has no limit behind an electric motor. Behind a combustion engine (a power-split hybrid's eCVT) it is
     limited to `clutchCapacity * engagement`, as an auto-clutch: an unlimited direct drive would hold the engine at
     0 rpm at a standstill, and the idle governor would then creep the car.
   - **Engine stop**: a combustion engine cannot be turned backward. Dragged below zero it stops at zero and holds
     there, and the clutch slips at its limit or holds the wheels. One-sided: it never pulls the engine down.
   - **Differential lock** per driven axle: `omegaLeft - omegaRight = 0`, limit
     `(preload + lockPerTorque * |axle torque|) * h`: 0 for `open`, unlimited for `locked`. The impulse is the torque
     difference it makes between the two wheels (half taken from the faster, half given to the slower), so the limit
     is the locking torque itself: `lockPerTorque` 0.25 is a torque bias ratio of 1.25 / 0.75 = 1.67, and 0.5 is 3.
     The axle torque is the clutch's (or converter's, or shift's) share for that axle plus what the centre coupling
     moves into or out of it.
   - **Centre coupling** (`centre.kind === 'coupling'`): the front axle's mean road speed (`omega * loaded radius`)
     equals the rear axle's: the transfer gearing is matched to the tyres (locking spin speeds instead would wind a
     car with smaller rear tyres up against itself). Its impulse is a force at the road, shared equally between each
     axle's wheels, limit `(lockTorque / loaded radius of the axle it feeds) * h`, so `lockTorque` is still the torque
     delivered to the receiving axle; it counts in that axle's torque as `centre impulse * radius / h`. A `fixed`
     centre is just the two axle weights `frontShare` and `1 - frontShare`.
3. Mid-shift, set the engine's speed (**Shifting**). Record `engineTorque`, `clutchTorque` (the clutch's impulse over
   `h`, an unlocked converter's pump torque, or the torque held through a shift) and `clutchLocked` (1 while the
   clutch or lock-up is closed and not slipping at its limit).

**Reverse.** `ratio` is signed: `-reverse` in reverse (the first-gear ratio when `reverse` is 0), 0 in neutral, so
the engine turns forward while the wheels turn back.

**Engagement.** With `autoClutch` (and for a combustion engine on a `direct` drive): the bite speed is
`biteOmega = max(1.15 * idle, controls.launchOmega)`. Above the road speed at which the largest ratio (first gear, or
a CVT's lowest gearing) turns the engine at `biteOmega` through the driven wheels' radius, engagement is 1 whatever
gear is in, so a launch speed the driver keeps set does not slip the clutch after every shift. Below it, engagement
`= clamp((max(engineOmega, G * omegaDrive) - biteOmega) / (0.25 * biteOmega), 0, 1)` with `G` the gear in hand:
taking the larger of the two speeds keeps the clutch closed through the moment it catches the wheels, rather than
letting it snap open and shut there. With the throttle at 2% or less and the driven wheels' rim speed under walking
pace (1.4 m/s) the clutch opens, as a driver's left foot would; that also opens it when the wheels lock under
braking. An electric motor (no idle) is always engaged. Without `autoClutch`: `1 - controls.clutch`.

**Torque converter** (`launch === 'converter'`, unlocked): no constraint. The turbine turns at `G * omegaDrive`
(counted as stopped when it turns backward); speed ratio `sr = turbine / engineOmega`. Pump torque
`= k * engineOmega * (engineOmega - turbine)`, with `k` the engine's full-throttle torque at `stallOmega` over
`stallOmega^2`, so that a stalled converter holds a floored engine at `stallOmega`; it turns negative on the overrun,
when the wheels drive the engine. Torque ratio falls linearly from `torqueRatio` at `sr = 0` to 1 at `couplingRatio`.
The pump torque comes off the engine; torque ratio times it goes to the wheels through `G` (with `eff`, or `1 / eff`
on the overrun). The lock-up clutch (the clutch constraint, at `clutchCapacity`) closes from `lockGear` up once
`sr > couplingRatio`, never with the turbine below 1.5 x idle, and opens again below 1.25 x idle or below `lockGear`:
a locked converter would otherwise drag the engine under idle as the car slows, and the gap stops it hunting. A CVT's
also closes once the turbine reaches the CVT's target engine speed (the ratio has started to move). `clutchLocked`
remembers whether the lock-up is closed.

**Shifting.** A request sets `gearNext` and `shiftTimer = shiftTime`; a box with no shift time changes at once.
Requests are rounded and clamped to [-1, top gear] (a CVT or single-speed has top gear 1); `AUTO_GEAR` keeps the gear
in hand, or the one being shifted to. A request mid-shift waits until the shift ends, except neutral: a request for
neutral is taken at once, even mid-shift, because the box has only to open its clutch. Throughout the shift the wheels
get `shiftTorqueHold * engine torque * G * eff` as a fixed torque (a manual opens its clutch: 0), and the ratio
changes at half time. The engine's speed is set directly toward the speed of the gear in hand (the old one in the
first half, the new one in the second), reaching it as each half ends, and kept between idle and redline: a
rev-matched shift, by the driver's hand or the box's own. The energy of the engine's speed change is lost, as in a
manual, and a blip is paid for in fuel. A dual-clutch's torque spike while the engine is pulled down (the inertia
phase) is not modelled. Behind a converter, a shift between two gears both at or above `lockGear`, with the turbine at
1.25 x idle or more, keeps the lock-up closed and is the same clutch shift; below them the converter carries the
shift, its turbine torque times `shiftTorqueHold`, and the engine finds its own speed.

`autoShift` gives the gear the car wants, and `gearNext` while a shift is under way. Up at the full-throttle point:
the first engine speed above the power peak (read off `wot` up to redline) where the next gear gives as much wheel
torque, `T(omega) = k T(k omega)` with `k` the next gear's ratio over this one's, refined by bisection; redline when
there is no crossing. At a light throttle it changes up so that the next gear lands the engine at 1.75 x idle, never
later than the full-throttle point; a pedal from 0.1 to 0.9 moves the point between the two. Down when the lower
gear would sit below 85% of its own (pedal-scaled) point. It skips gears both ways, so its answer is a fixed
point: asked again in the gear it returns, it returns the same. The pedal it scales by is the gearbox controller's,
`shiftPedal`, filtered by `shiftPedalStep` (it follows a press in about 0.1 s and a lift in about 1.5 s): read raw, a
pedal dipping for wheelspin changed the box up and its return kicked it down, so the box hunted (VALIDATION.md fix 3). The speed it judges by is the
driven wheels' mean times the final drive, except that a driven wheel whose slip (against the road under it, divided
by at least 1 m/s) is past its tyre's dry peak, capped at `SHIFT_SLIP_CAP = 0.15`, counts at the road's speed: a
spinning wheel neither changes it up early nor back down as the wheels catch the road in the shift, and locked wheels
do not drop it to first. The cap keeps `1 / 1.15 = 0.87` above the 0.85 kick-down share. So with traction control off
on a wet road, a car spinning past the peak holds its gear on the limiter until the road speed catches up. A request
through the controls (rounded and clamped; not a number is neutral) is taken as it is by a manual; any other box goes
into a requested forward gear only as low as keeps the engine within redline at the present speed, and takes the rest
as the car slows. A CVT, eCVT or
single-speed car answers 1, or -1 and 0 when asked for those. The shift points are worked out once per model, outside
the step, by `prepareShiftPoints`, which `createState` calls, and kept per model (a module-level `WeakMap`). A model
met unprepared in the step changes up at redline until it is prepared; a model whose gears or `wot` change in place
needs another `prepareShiftPoints`. `shiftUpOmega` gives redline for the top gear, a gear the box does not have, and a
car without gears to change.

**CVT / eCVT:** `gears` holds the two ends of the range, in either order. `ratio` moves at up to `cvtRatioRate`
(0 or less: at once) toward the ratio that puts the engine at its target speed: the power peak (scanned off `wot` up
to redline) at full throttle, falling in a straight line to 1.3 x idle as the throttle closes. From standstill, and
coming out of neutral or reverse, it starts from its lowest gearing (the larger end). **Single-speed:** one gear of 1,
the whole reduction in `finalDrive`; launch `direct`.

**Nitrous.** Its power scales with the pedal (a progressive controller), `power * pedal / omega`. It works only from
0.4 x redline (a window switch, which also avoids the huge torque power over a small speed would give), fades with the
limiter past redline, and is not used on an electric motor. The last substep's shot is cut to what the bottle still
holds, so `nitrousLeft` ends at exactly 0.

**Energy.** `energyUsed` books fuel, kg: indicated work (brake torque, nitrous included, plus friction plus pumping x
(1 - throttle)) over `AIR_ENERGY` is the air the engine breathed, and a stoichiometric mixture burns 1/14.7 of it in
fuel. An electric motor books shaft energy, J (`T * omega * h`, negative while it regenerates).

**Standstill.** With no throttle and the brake on or off, the car must not creep or jitter: the brake constraint
holds a braked wheel exactly; the tyre's standstill spring and low-speed damping hold the rest; an automatic's
converter creep is allowed only when the brake is off.

## 6. Brakes and the car's own systems (`brakes.ts`, `systems.ts`)

The units judge each wheel as a real one does, from its wheel-speed sensor: the wheel's rim speed against the road
speed under it (`wheelRoadSpeed`: the wheel centre's speed along the wheel, from `u`, `v`, `r` and its steer angle),
not from `wheelSlipRatio`. The tyre's slip state lags that by `relaxLong / |Vx|` (7 ms at 100 km/h, 36 ms at
18 km/h) and stops counting at three peaks. Reading it, ABS dumped late and deep and gave back 9 to 27% of the ideal
stop, and traction control reached only 84% of the tyre's limit on a wet launch (97% reading the wheel speed).

`brakeTorques`: per wheel `pedal * maxTorque * absHold` (front or rear); the rear wheels add
`handbrake * handbrakeTorque` after the hold factor: the handbrake's own circuit bypasses the unit, so a handbrake turn
still locks the rears with ABS on. **ABS** (when the model has it and the control leaves it on): per wheel, braking
slip `1 - omega * radius / road` (the same in reverse). While it is above `1.15 * peakSlipRatio`, dump that wheel's
pressure (toward 0, 0.03 s); below `0.75 * peakSlipRatio`, build it back (0.08 s); between the two, where the tyre
gives 94% of its force or more, build slowly toward full (0.25 s), feeling for the peak, so the wheel works through it
instead of parking at the bottom of the band (a pure hold parked it at 0.75 peak and gave back 9%). With no pedal, or
a wheel moving under 2 m/s over the road (the signal is too coarse there, and a car held on its brakes must stay
held), the factor goes back toward 1 (0.08 s). **Brake-force distribution** is part of the unit (off whenever ABS is
off or not fitted) and acts on the pedal's torque only: a rear wheel whose slip passes `ref`, the front axle's mean
slip or 0.3 peak if that is more, has its factor trimmed toward `hold * ref / slip` (0.08 s), and held within 0.15
peak below `ref`, so the rear settles just under the front instead of cycling. Below 0.3 peak a rear tyre is nowhere
near locking and is left alone, so a light stop never trims the rear and a trimmed rear always recovers. One factor, `absHold`, carries both, and
`absActive` is 1 while it is under 1 with the pedal pressed, whichever of the two caused it. A stop gives back a few
percent of the ideal: 3.5% dry, 2.2% wet and 1.1% on packed snow as built (the tests hold it between 0.5% and 5%).

`tractionControl` has two halves, both off when the car lacks it or the control turns it off (it then returns 1 and
brakes nothing). A wheel's spin is its rim speed less the road speed under it, in the direction its gear drives; its
peak spin is its tyre's peak slip ratio on that surface times the road speed, at least 1 m/s (so about 0.15 m/s of
spin is let through at a standstill). The driven wheels are 2 and 3 for rear drive, 0 and 1 for front drive and all
four for all-wheel drive.
- **The brake half** (the brake-based lock every system since Bosch's ASR has had, and most cars keep with stability
  control off): a driven wheel spinning past 1.15 times its own peak and faster than its partner, on an axle whose
  differential is not locked, is braked toward `min(excess, 1) * muX Fz R` of its partner (the partner's whole grip
  torque one peak spin further on), `excess = (d_own - max(d_partner, 1.15 p_own)) / p_own` with `d` the spin and `p`
  the peak spin, m/s. The pressure builds and releases with a 0.05 s lag and never passes full caliper pressure (the
  wheel's full-pedal torque less what is already applied). The differential then sends the torque that brake holds to
  the gripping wheel. `tcsBrake` (state, per wheel) carries it.
- **The engine half**: while the worst driven wheel spins past 1.3 times its peak, the cut moves (0.05 s) toward
  `tcsCut / worst`, `worst` in peak spins: past the peak the spin grows with the torque beyond what the tyre holds, so
  this aims at the drive that holds the peak; the cut is a share of the engine's drive, which `throttleForShare`
  turns into a throttle (with friction and pumping in the way, a share of the pedal is a larger share of the drive). Once every driven wheel is back under 1.0
  peak the throttle comes back (0.15 s); between the two the cut holds. It watches the worst wheel even while the
  brake half works on it.

`tcsActive` is 1 while either half acts (the cut under 1 with the throttle open, or a brake held).

`stabilityControl` (above 5 m/s): target yaw rate `r* = u * steerAngle / (L + Kus * u^2)`, with `steerAngle` the mean
of the front wheels' and the car's own understeer gradient `Kus = m / L * (b / Cf - a / Cr)` from its axles'
cornering stiffness at the static loads, held at 0 or more (no stability system aims at a spin). It is limited to
`0.9 * sum(muY_i * Fz_i) / (m u)`: what the tyres can hold sideways on this surface at these loads, downforce
included. When `|r - r*|` passes `0.05 rad/s + 0.1 |r*|`, it brakes one wheel with
`Izz * excess / 0.25 s / (track / 2) * radius`: the outer front when the car rotates more than wanted the way it
already turns (oversteer), the inner rear when it rotates less (understeer). Both are judged from the sign of the error
against `r`, so a counter-steered spin is caught too. The torque is capped by the pump (the wheel's full-pedal torque
less what is already applied) and by the grip the tyre has left after cornering,
`muX Fz sqrt(1 - (Fy / (muY Fz))^2) * radius` less what is already applied. It is not multiplied by `absHold`
(brake-force distribution would cancel inner-rear braking for understeer). It adds to `wheelBrake` and sets
`escActive`. The `h` argument is not used.

`limiterCut`: fade the throttle to zero over 1 m/s centred on `limiterSpeed` (1 at half a m/s below it, 0 at half a
m/s above), judged on `u`, so that a governed car settles within a few tenths of a m/s of it: coupe 112.24 mph against
112 and 154.82 against 155, sedan 99.99 against 100. A fade over the last 1 m/s below it settled cars 1.2 to 1.8 mph
short and failed the bench's ±1 mph governed check. `limiterActive` is 1 while it cuts.

## 7. Figures in (`sheet.ts`, `classes.ts`, `resolve.ts`)

**Sheets.** Three builders fill a `PhysicsSheet`, each figure with its source. `sheetFromResearch` (and
`readResearch`, which also reports what it used, what it dropped and why, and what is on file but is not an input)
reads a research record; its sheet id is the record's id (`2024-nissan-gt-r-nismo`). Besides the README's keys it
takes keys named exactly like sheet fields (`awdKind`, `diffFront`, `diffRear`, `roadLoadA/B/C`, `suspensionGrade`,
`brakeGrade`, `abs`, `tractionControl`, `stabilityControl`, `launchControl`); any other unknown key is dropped and
named. A figure outside a sane range for the car is dropped (curb weight by class: a sedan 1,800 to 7,000 lb, a
pickup, SUV or off-roader up to 9,800 lb; an electric car's redline 5,000 to 25,000 rpm), and so are figures that
cannot all be true: a wheelbase not shorter than the length, a track not narrower than the width, litres per cylinder
outside 0.12 to 1.3, a reversed torque plateau, a power peak above redline (both figures dropped each time); a power
peak whose `P / omega` beats peak torque, or a torque peak whose `T * omega` beats peak power, by more than 2% (only
the rpm dropped: makers print peak values more reliably than their speeds); a gear count that differs from the ratios
given (the ratios dropped, except a CVT's two). A key on file twice with different figures drops both; with the same
figure, the first source is kept. A missing or unknown source kind keeps the figure as `reference`, with a note.
Differential words: a selectable locker (`locking`, `locker`, `Tru-Lok`) reads as `open`, since it is open on the
road; GM's G80 as `limited-slip`; an electronic limited-slip as `active`; brake-based systems (XDS, EDL) as `open`.
Words that name no axle count for the driven axle of a two-wheel-drive car only; `optional` or `available` makes a
clause unclear. An AWD system's words: a published split with 0 at one axle gives on-demand of the other; a centre
differential or Torsen gives `fixed`; coupling words with a stated base axle give on-demand of that axle; `part-time`
gives `part-time` unless a full-time or automatic mode is named too; a brand name alone gives nothing (the GT-R reads
as rear-on-demand). `sheetFromTable` reads a row of the game's car table: id `table-<make>-<model>` (slugged), model
year 2013 (the table's earliest; any year from 2012 gives the systems rule below its right answer), every figure kind
`reference`, the 0-60 to tests only; induction `natural` and powertrain `gasoline` when the engine words name no boost
and no hybrid, diesel or electric (the table names every engine that is not a naturally aspirated petrol one).
`sheetFromAuthored` converts a drawn rental car one to one: id as authored, model year 2024, make `MiCar`, trim
`rental (drawn, fictional)`, curb weight its mass less the 75 kg driver, its torque curve (peaks and displacement left
blank, since the curve is the engine), and a tyre size whose loaded radius is the drawn radius to within 0.15%, its
width from the mass (about 115 + 0.075 x kg mm), preferring a profile in steps of five near a 50 series; the tyre
category is left to the class.

`resolveModel(sheet, build?)` returns the model and a `basis` record naming, for every model parameter (104 keys such
as `chassis.cgHeight`, `tyreFront.muY0`, `engine.wot`, `driveline.gears`), one of `sourced`, `derived`, `calibrated`,
`estimated`. A unit conversion is `sourced` (the mass too: curb weight plus a 75 kg driver); a formula over sourced
figures is `derived`; anything that touches a class figure is `estimated`; a setup change turns a sourced figure
`derived`. A differential is `sourced` only when open or locked (a limited-slip's preload is typical). The work is
split into exported steps (`resolveLayout`, `resolveTyres`, `resolveChassis`, `resolveAero`, `resolveEngineSpec`,
`resolveEngine`, `resolveSystems`, `resolveDriveline`, `resolveBrakes`, `applySetup`; section 10), each filling one
piece of the model and its basis. `resolveStock` runs them in that order for the stock car and keeps the layout and
the tyres as built; with a build, `resolveModel` hands that car to parts.ts (section 11). `tyreParams`,
`chassisGyration`, `setInertias` and `resolveBrakes` are there for parts.ts to re-derive what a part changes by the
resolver's own formulas. Rules:

- Layout: petrol unless the sheet says otherwise. Induction on file; else natural for a hybrid's or an electric
  car's engine and for an authored curve, turbo for a diesel, and for a petrol engine with both power and
  displacement on file turbo above 100 hp per litre; with only one of the two, natural; with neither, the class's
  typical engine. A twincharged engine is taken as turbocharged. A front engine unless on file; a mid or rear engine
  with no drive on file drives the rear. The gearbox on file; else an eCVT for a hybrid and the class's for the rest.
  An electric car is always single-speed (a sheet ratio is used if one is on file). 4WD drives all four wheels (the
  model's AWD) and counts as AWD for the weight split, brake share and efficiency; it also decides a part-time centre.
- Weight split, wheelbase, tracks: sourced, else class tables; one track on file stands for the other (`derived`).
  `a = wheelbase * (1 - frontShare)`. Centre-of-gravity height: sourced, else `cgHeightRatio * height` by class. The
  class's unsprung masses ride at their wheel centres (the loaded tyre radius), and the sprung mass's height is set so
  that `ms hs + mu hu = m h` exactly.
- Tyres: size gives radius (loaded radius 0.97 of the unloaded one) and width; one size on file stands for both axles,
  the class's sizes when neither is; category on file, else the class's, gives the rest (`TYRE_CATEGORY`); `muY0` is
  the category's figure times `calibration.tyreGripScale` (1 when not calibrated, and the scale may not leave the
  category's range: past it, it is held at the edge). `fz0 = 4000 N * (width / 0.225) * (diameter / 0.66)`, kept
  between 3000 and 7500; `fzStiffPeak = 2.2 * fz0`; `trail0 = 0.03 m`. `rollRes` is the category's, and 0 only when a
  coast-down's `A` is on file (`A` carries the rolling loss).
- Engine: power on file; else displacement x 72 hp per litre unboosted or 110 boosted; else the class's typical
  engine. Peak speeds on file, else shares of redline by family (below). Redline on file; else the family's, raised
  to at least 1.05 x a published power-peak speed and a published torque-peak speed / 0.8: estimated figures give way
  to published ones and never move them. Peak torque on file; else `bmep * displacement / (4 pi)` (natural 1.22 MPa,
  turbo 2.0, supercharged 1.75, diesel 2.2: each low in its measured range), kept between `1.04 P / omegaP` and
  `0.97 P / torqueOmegaHigh` so that both published peaks stand; a hybrid takes the top of that band (its motor fills
  the low speeds); an electric motor `T = 3 P / top speed` (a base speed a third of its top speed). A hybrid's system
  power and torque are one unboosted engine through an eCVT, launch direct, unless the sheet names its induction or
  gearbox. An authored curve: rpm to rad/s, kind `na`, the peaks read off it up to redline (`derived`), redline on
  file or else the curve's last point. Boost on file, else 100 kPa for a turbo and 70 kPa for a supercharger. Idle by
  cylinder count. `buildEngine` starts every engine as petrol (`EngineSpec` has no friction field), so a diesel is
  refitted to the diesel friction by `refitFriction`, which scales `air.specific` at each speed by
  `(wot + new friction) / (wot + old friction)`: `wot` is unchanged to rounding, and `maxAirflow` moves with it.
- Gears: sourced (a CVT or eCVT keeps the first and last ratio); else the gearbox type's usual count and spread (table
  below), spaced geometrically from first to top, with top gear putting the engine at its power peak at the car's top
  speed: the lower of where its power at the wheels meets the road load (air, the tyres' rolling resistance at their
  static loads, any coast-down) and its governor. Top is held to the type's usual range and never turns the engine
  past 0.95 x redline at that speed: a governed car's ideal is above the range (a pickup's 1.28), so its top is 0.80
  and an eight-speed's first 5.6. A CVT or eCVT with no ratios: highest `min(topMax, that ideal)`, lowest that times
  6.5. A single-speed car: gears `[1]` and final drive `min(9.0, 0.88 * motor top speed * radius / top speed)`, so the
  governor sits below the motor's taper; a single ratio of 3 or more on file with no final drive is the whole
  reduction. Final drive sourced, else class. Reverse is first gear times the type's reverse share.
- Drag: the coast-down's `C` when on file (`dragArea = 2 C / rho`; `A` and `B` as given, 0 when missing, become the
  road load); else `Cd * area`, with the area on file, else `0.84 * width * height` (sourced or class; this outranks a
  calibrated drag area, since calibration fits drag only with no drag figure on file); else
  `calibration.dragAreaM2`; else the class's drag area. Lift: `Cl * area` when on file, else the class's lift areas.
- Springs from the class's ride frequencies on each axle's sprung load (`k = m (2 pi f)^2` a corner), dampers from its
  damping ratio (`c = 2 zeta m omega` a corner). Anti-roll bars from the roll gradient: the total roll stiffness is
  `ms hRoll / gradient + ms g hRoll`, split by a front share of the front weight share plus the class's margin (a
  front-drive car takes its weight share alone: its driven front tyres already make it understeer under power), held
  to 0.2 to 0.8; the springs give `0.5 k t^2` at each axle and the bars the rest. Where one axle's springs alone pass
  its share, that bar is 0 and the other is set to keep the front share exactly (the car then rolls less than the
  class figure: section 9). Anti-dive 0.25, anti-squat 0.30. Inertias: `Izz = yawIndex * m a b`; the radii of
  gyration (`0.36 * width` in roll, `0.26 * length` in pitch) are about the sprung centre of gravity, and chassis.ts
  turns the body about the roll axis and about the ground, so `Ixx = ms (0.36 width)^2 + ms hRoll^2` and
  `Iyy = ms (0.26 length)^2 + ms hs^2` (a blank sedan's roll inertia is 1,025 kg m^2, not 640). All `estimated`.
- Steering: `maxSteer` from the turning circle by the exact geometry: the outer front wheel sweeps radius `R` about a
  point on the rear axle's line, so `maxSteer = atan(L / (sqrt(R^2 - L^2) - trackFront / 2))`, held to 0.35 to
  0.8 rad (a 37.4 ft circle gives about 33.6 degrees; `L / (R - track / 2)` is a tangent, not an angle); else 0.60
  rad. `steerRatio` is the makers' ratio of steering-wheel angle to road-wheel angle (15.0:1 is 15), on file or by
  class.
- Brakes: full pedal is worth the largest of 1.3 g on the car's weight and, per axle, `BRAKE_AXLE_MARGIN = 1.15` x
  (the axle's tyre force at the peak in the ideal stop on the category's top grip, `muY0Max`, at the real axle loads,
  plus `2 J a / R^2`), at either end of the setup's bias range (class share ± `BRAKE_BIAS_RANGE = 0.06`). The ideal
  stop (`idealStop`) is found by repeating it: every tyre at its peak at the loads the deceleration gives, `tyreMuX`
  at the real loads (load sensitivity gives the light rear tyres more friction per newton). ABS has to be able to drive
  the slip past 1.15 peaks to find the peak, and a stop limited by the calipers is not the tyres'. The total is split
  at the class share; the rear is then over-provisioned at the limit and the brake-force distribution trims it. Each
  axle's torque is its force times its tyre's radius, half a wheel. A part that changes the tyre category re-sizes the
  brakes (parts.ts must call `resolveBrakes` again). The sheet's brake grade is not read, and fade is not modelled.
- Systems: ABS, traction and stability control as the sheet says, else on for any car from 2012 on; launch control as
  the sheet says, else none. Governor: the published top speed when the sheet says it is governed; none when it says
  not; when it does not say, a published top speed within the class's usual limit + 2 mph is the governor and one
  above it (or any in a class with no limit) is the air's; with no top speed on file, the class's limit, climbing to
  its performance limit across the power-to-weight band 0.075 to 0.115 hp per lb of curb weight.
- Driveline: the centre's kind on file (its split and torque typical); else an electric car's is fixed with
  `frontShare = b / L` (a motor per axle), a 4WD's part-time (locked), and a car with a mid or rear engine, or of the
  sports, coupe, pickup or off-road class, or of eight cylinders or more, rear-on-demand; any other front-on-demand.
  Differentials on file; else a limited-slip rear for a sports car, and for a coupe of 0.115 hp per lb or more, when
  the rear is driven; open for the rest. A pickup's or off-roader's automatic gets a truck converter (stall
  2,000 rpm, torque ratio 2.0); every stall speed is held between 1.3 x idle and 0.6 x redline. Clutch capacity is
  1.6 x the built engine's peak torque (`enginePeaks`), for a clutch, a lock-up and a direct drive alike.
- Setup (`applySetup`, from `build.setup`): bars, springs and dampers as multiples of the car's own; a ride-height drop
  `d` lowers the sprung centre of gravity by `d` and the whole car's by `(ms / m) d` (keeping `ms hs + mu hu = m h`),
  never below the wheel centres, and the inertias are not re-derived; `brakeBias` shares the same total force at the
  road anew; `finalDrive` as a multiple; `aeroFront`, `aeroRear` add lift area, m^2. parts.ts calls it and does the
  rest of a setup (section 11).

The class tables are frozen, every row and every table: copy a row's figures into a model, never the row itself
(parts change a model in place, and writing to a frozen row throws). Inside them roll gradient is rad per m/s^2,
written as the deg/g the trade quotes; ride frequencies are Hz, engine speeds rad/s, governors m/s. A few typical
figures a blank sheet needs live in resolve.ts until they move to classes.ts (rule 2): `CLASS_BLANK` (below),
`TORQUE_BMEP`, `BOOSTED_ABOVE_HP_PER_LITRE` (100), `HP_PER_LITRE` (72, 110), `EV_SPEED_RANGE` (3),
`TRUCK_CONVERTER` and `FRONTAL_AREA_SHARE` (0.84).

**Class tables: starting values** (all `estimated`; tune for every car at once, never for one):

| Tyre category | muY0 | calibration range | muXRatio | loadSens | slideRatio | slideFall | cAlpha0 / fz0 (per rad) | cKappaPerFz | relaxLat | relaxLong | rollRes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all-season | 0.92 | 0.82 to 1.00 | 1.08 | 0.12 | 0.80 | 1.2 | 13 | 16 | 0.55 | 0.20 | 0.0085 |
| summer | 1.02 | 0.94 to 1.10 | 1.10 | 0.13 | 0.82 | 1.2 | 16 | 19 | 0.50 | 0.18 | 0.0095 |
| max-performance | 1.12 | 1.04 to 1.22 | 1.12 | 0.14 | 0.83 | 1.3 | 19 | 22 | 0.45 | 0.16 | 0.0105 |
| track | 1.28 | 1.18 to 1.40 | 1.12 | 0.15 | 0.85 | 1.5 | 22 | 25 | 0.40 | 0.15 | 0.012 |
| all-terrain | 0.80 | 0.72 to 0.88 | 1.05 | 0.10 | 0.80 | 1.0 | 10 | 13 | 0.65 | 0.25 | 0.011 |
| winter | 0.78 | 0.70 to 0.86 | 1.05 | 0.10 | 0.80 | 1.0 | 10 | 13 | 0.65 | 0.25 | 0.011 |
| drag (prepared strip) | 1.00 | 0.90 to 1.10 | 1.55 | 0.10 | 0.85 | 1.0 | 12 | 20 | 0.60 | 0.22 | 0.014 |

`fzStiffPeak = 2.2 * fz0`; `trail0 = 0.03 m`.

| Body class | cg height / height | ride Hz front, rear | damping ratio | roll gradient deg/g | front roll share over front weight share | roll centre front, rear (m) | unsprung per axle front, rear (kg) | yaw index Izz / (m a b) | drag area m^2 | lift area front, rear m^2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sports | 0.37 | 1.9, 2.1 | 0.45 | 2.6 | +0.04 | 0.03, 0.08 | 80, 85 | 0.92 | 0.58 | 0.03, 0.03 |
| coupe | 0.38 | 1.5, 1.7 | 0.38 | 3.6 | +0.05 | 0.04, 0.10 | 78, 78 | 0.96 | 0.60 | 0.07, 0.08 |
| sedan | 0.385 | 1.2, 1.35 | 0.30 | 5.0 | +0.07 | 0.05, 0.11 | 75, 70 | 1.00 | 0.62 | 0.09, 0.10 |
| hatchback | 0.39 | 1.25, 1.4 | 0.30 | 5.0 | +0.07 | 0.05, 0.11 | 70, 62 | 0.98 | 0.64 | 0.08, 0.10 |
| wagon | 0.39 | 1.2, 1.35 | 0.30 | 5.0 | +0.07 | 0.05, 0.11 | 78, 74 | 1.02 | 0.66 | 0.09, 0.09 |
| suv | 0.405 | 1.2, 1.35 | 0.30 | 5.6 | +0.07 | 0.07, 0.14 | 100, 100 | 1.03 | 0.84 | 0.10, 0.10 |
| van | 0.40 | 1.15, 1.3 | 0.30 | 5.6 | +0.07 | 0.06, 0.13 | 95, 95 | 1.05 | 0.95 | 0.10, 0.10 |
| pickup | 0.41 | 1.3, 1.6 | 0.30 | 5.6 | +0.08 | 0.08, 0.30 | 110, 150 | 1.10 | 1.15 | 0.12, 0.10 |
| offroad | 0.42 | 1.15, 1.35 | 0.30 | 6.2 | +0.08 | 0.20, 0.30 | 130, 140 | 1.08 | 1.05 | 0.12, 0.10 |

The front roll share's margin is not added for a front-drive car. Suspension grade moves ride frequency and damping
(`sport` x1.15 and +0.06, `adaptive` x1.10 and +0.08, `offroad` x0.92 and 0) and roll gradient (`sport` x0.8,
`adaptive` x0.75, `offroad` x1.1). Roll and pitch radii of gyration: `0.36 * width` and `0.26 * length` for the
sprung mass.

| Body class | wheelbase; tracks front, rear (m) | length, width, height (m) | steer ratio | final drive | governor mph (performance) | tyres | blank sheet: curb kg; engine; drive; gearbox |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sports | 2.50; 1.58, 1.58 | 4.40, 1.85, 1.28 | 14.0 | 3.50 | none (none) | max-performance 245/35R19, 285/30R19 | 1500; 330 hp 3.0 L six, turbo; RWD; dual-clutch |
| coupe | 2.75; 1.58, 1.60 | 4.75, 1.87, 1.37 | 14.5 | 3.40 | 155 (155) | summer 245/40R18 | 1650; 300 hp 2.3 L four, turbo; RWD; automatic |
| sedan | 2.82; 1.58, 1.59 | 4.75, 1.84, 1.44 | 15.0 | 3.60 | 130 (155) | all-season 225/50R17 | 1550; 200 hp 2.5 L four; FWD; automatic |
| hatchback | 2.68; 1.54, 1.55 | 4.40, 1.79, 1.45 | 14.5 | 3.80 | 125 (155) | all-season 205/55R16 | 1350; 155 hp 2.0 L four; FWD; automatic |
| wagon | 2.75; 1.57, 1.57 | 4.75, 1.84, 1.50 | 15.0 | 3.60 | 130 (155) | all-season 225/55R17 | 1650; 180 hp 2.5 L four; FWD; automatic |
| suv | 2.80; 1.62, 1.63 | 4.75, 1.90, 1.70 | 15.5 | 3.70 | 125 (155) | all-season 235/60R18 | 1700; 200 hp 2.5 L four; FWD; automatic |
| van | 3.05; 1.73, 1.73 | 5.18, 2.00, 1.75 | 16.0 | 3.80 | 115 (120) | all-season 235/60R18 | 2050; 280 hp 3.5 L six; FWD; automatic |
| pickup | 3.55; 1.70, 1.70 | 5.70, 2.00, 1.90 | 17.5 | 3.73 | 110 (118) | all-terrain 275/65R18 | 2300; 355 hp 5.3 L eight; RWD; automatic |
| offroad | 2.90; 1.62, 1.62 | 4.80, 1.92, 1.85 | 16.5 | 4.10 | 110 (112) | all-terrain 265/70R17 | 2050; 285 hp 3.6 L six; 4WD; automatic |

The governors are the card engine's (packages/engine/src/rules.ts), copied so the two agree; rules.ts writes the
sports class's "none" as 400 mph. The final drives are for a stepped box whose top gear sits in its usual range (the
pickup's 3.73, not 3.55: with 3.55 and 0.40 m tyres it was the tallest-geared class, and a manual ran 60 mph in first).

| Transmission | efficiency (two-wheel drive) | shiftTime s | shiftTorqueHold | launch | gears; first over top; top gear | reverse over first |
| --- | --- | --- | --- | --- | --- | --- |
| manual | 0.92 | 0.30 | 0 | clutch | 6; 4.2; 0.67 to 0.80 | 0.95 |
| dual-clutch | 0.92 | 0.08 | 0.9 | clutch | 7; 6.0; 0.67 to 0.80 | 0.90 |
| automatic | 0.90 | 0.25 | 0.6 | converter (stall 2300 rpm, torque ratio 1.9, coupling 0.88, locks from 2nd) | 8; 7.0; 0.67 to 0.80 | 0.80 |
| cvt | 0.87 | 0 | 1 | converter (stall 2100 rpm, torque ratio 1.9, coupling 0.88, locks from the start of ratio change: `lockGear` 1); ratio rate 1.5 a second | the two ends; 6.5; highest 0.40 to 0.80 | 0.90 |
| ecvt | 0.90 | 0 | 1 | direct; ratio rate 3.0 a second | the two ends; 6.5; highest 0.40 to 0.80 | 1 |
| single-speed | 0.94 | 0 | 1 | direct | one gear of 1; the reduction in the final drive (9.0 when not on file) | 1 |

Spreads from makers' ratios: six-speed manuals run 3.9 (S2000) to 5.6 (Mustang), so 4.2 leans unfavourable;
seven-speed dual-clutches 5.9 to 6.3 (PDK 6.3); eight-speed automatics 6.7 to 7.6 (ZF 8HP 7.07, GM 8L90 7.0). A
real CVT's highest ratio is 0.38 to 0.56 behind a final drive of 4.5 to 5.7; the range reaches 0.80 so a class final
drive can carry it. A power-split hybrid has no real lowest ratio, so the eCVT's is a stand-in. All-wheel (and
four-wheel) drive takes 0.04 off the efficiency. Clutch capacity: 1.6 x peak torque. Engine inertia:
`0.08 + 0.04 * litres` kg m^2 (an electric motor 0.05). Wheel inertia: `0.8 * mWheel * radius^2 + 0.1`, with
`mWheel = 8 + 55 * width * (rim inches / 17)` kg. Idle 750 rpm (650 for eight cylinders or more).
Peak power speed when not on file: 0.92 x redline unboosted, 0.85 boosted; peak torque speed 0.68 x redline unboosted,
a plateau from 0.30 to 0.65 x redline boosted. Redline when not on file: 6500 rpm (6200 for eight cylinders or more,
6000 for a boosted four-cylinder pickup or off-roader, 5500 diesel, 14,000 an electric motor's top speed); a hybrid's
engine takes the petrol figure. Friction: petrol `fmep [100e3, 0, 1.0e3]` Pa (classes.ts FMEP.petrol, VALIDATION.md
fix 2; it replaced Heywood's 1980s fit `[97e3, 15e3, 5e3]`); diesel `[84e3, 48e3, 3.6e3]`, Millington and Hartles' `7 (rc - 4) + 48 x + 0.4 Sp^2` kPa
taken at a compression ratio of 16 and a 90 mm stroke. Stock charge air: compressor efficiency 0.70; intercooler 0.70
behind a turbo, 0.60 behind a supercharger; a supercharger's blower drive 0.12; gauge boost when not on file 100 kPa
turbo, 70 kPa supercharged; pump fuel's knock limit a pressure ratio of 2.6. Brake front share: 0.70 front-drive, 0.66
rear-drive front-engine, 0.68 all-wheel drive front-engine, 0.60 mid or rear engine. Handbrake: 1,500 N m at each
rear wheel. Differentials when only the kind is on file: limited-slip preload 60 N m and `lockPerTorque` 0.25 (lsd-1),
active 150 N m and 0.5 (lsd-2), locked unlimited. Centres: fixed 40:60; front- and rear-on-demand couplings 2,000 N m
at the axles; part-time locked. Layout defaults when the weight split is not on file: front-engine front-drive 60%
front, front-engine rear-drive 53%, front-engine all-wheel drive 57%, mid-engine 41%, rear-engine 39%, pickup 57%.

## 8. The bench (`drivers.ts`, `bench.ts`, `calibrate.ts`)

`runBench(model, test = 'all')` on flat dry asphalt, the car's systems as fitted, the reference drivers of drivers.ts
at the wheel. A test not run gives NaN. `runBenchWith` runs the same bench in another number of substeps.

- **accel.** The launch driver is an expert's right foot: its throttle is the crank torque that puts the driven tyres'
  peak friction at their present loads on the road, through the gear, the efficiency and a slipping converter's
  multiplication (plus what spins the engine up with the clutch locked), and a slow correction from the feel of the
  wheelspin (judged from wheel speed against the road) toward one peak slip. A clutch car pulls away on
  `Controls.launchOmega`, the auto-clutch biting at the launch speed, with no brake. A converter car is held on the
  brake for 1.2 s at the throttle where the stalled converter takes all the engine's torque at the launch speed, staged
  no higher than 0.95 of the speed at which full pedal on the driven wheels still holds the converter's output
  through first gear (full pedal is sized for stopping, not for holding a converter at stall), and the throttle eases
  while a driven wheel turns. It changes up at a share of the car's own full-throttle shift point (`shiftUpOmega`),
  never past redline. The search is by coordinates, not a grid: five launch speeds from 1.3 x idle to 0.75 x redline
  (a converter's capped at its stall speed, none repeated; one, 0, for an electric car) at the car's own shift points,
  then the shift shares 0.96, 0.98, 1.02 and 1.04 at the best launch (shares that give the same speeds skipped): nine
  runs at most, each cut short once it cannot beat the best quarter mile. The best is driven again on to 100 mph, and
  every figure reported comes from that run; `shiftRpm` is its 1-2 shift (0 with no gears to change). The car is
  moving once its speed passes 0.01 m/s for good (a staged four-wheel-drive pickup creeps about 1 mm/s against its
  brakes, which a distance trigger counted as a start); 0-30, 0-60 and 0-100 run from there. The timeslip's marks
  are measured from where the car stood and its clock starts at one foot, as `zeroToSixtyRollout` does; the eighth-mile
  and trap speeds are averages over the last 66 ft.
- **brake.** The car is set rolling at 63 (73) mph, cruises 1 s to settle on its springs, then full pedal with ABS as
  fitted; the distance runs from where it passes 60 (70) mph, interpolated, to the furthest point it reaches.
- **skidpad.** Anticlockwise on a 300 ft and a 200 ft circle, stability control off as testers run it, traction
  control as fitted. The driver steers by pure pursuit from the rear axle (the point 0.5 s ahead on the circle, at
  least 4 m) plus a slow trim, never winding on lock past the outer front tyre's peak slip angle, and holds one gear
  (the one that turns the engine nearest half its redline at the starting speed: an automatic's shift mid-corner sent
  the car wide). The speed aimed at starts at 0.7 of the lateral acceleration the tyres' friction allows at their
  static loads (0.55, then 0.4, if the car cannot lap settled there) and rises by 0.05 m/s each second until the car
  runs 1.5 m wide; that ramp must lap twice settled. A lap at a rising speed averages half a lap's rise below the
  speed it ends at (3 to 4% of the figure), and a tester's figure is a lap at a held speed: so moments on the line are
  set aside as the ramp runs (the state copied exactly), the run is taken up again from them with the speed held, and
  the bench closes on the fastest speed that still holds a full lap within 1.5 m. The figure is the best full lap of
  all, `4 pi^2 R / T^2` on the circle's nominal radius (+0.5 to +1.5% over the ramp's own).
- **topSpeed.** Flat out from rest, the car choosing its own gears, until the gain over a 1 s window clear of any shift
  is under 0.01 m/s^2, or the limiter holds it (governed: the limiter acting and the top within 2 m/s of its speed).
- **dyno.** Peaks read off the model's `wot` table (`enginePeaks`).

`calibrate(sheet)` returns a copy with `calibration` set; the original is not changed. With a skidpad test on file it
fits `tyreGripScale` so the bench's skidpad, on the test's circle (300 ft when the sheet does not say), meets
`tests.skidpadG`, inside the category's range (if the range stops it, it stays at the edge and the miss is reported).
Only when the sheet has no drag coefficient and no coast-down `C`, and a top speed (the sheet's own, else the test's)
that the resolved car is not governed at (and the sheet does not call governed), it fits `dragAreaM2` to that top
speed, between 0.15 and 3 m^2. Each fit is a bracketed secant (regula falsi, Illinois), starting from a guess that the
figure is close to proportional (grip) or goes as the cube root of power over drag area (drag), and stops within
0.001 g or 0.1 mph or after 8 runs, keeping the closest.

`checkSheet(sheet, bench)` compares against `tests` with the plan of record's tolerances: 0-60 7% or 0.3 s, whichever
is larger; quarter mile 4%; trap 4%; braking 7% (60-0 and 70-0); top speed 4%, or 1 mph either side when the bench
says the limiter set it; skidpad 0.04 g, on the nearer of the bench's two circles. `error = model - real` in the
check's unit. It uses `zeroToSixtyRollout` when `tests.rollout` is true. A figure the car was calibrated on (the
skidpad, and a top speed the drag was fitted to) is not a prediction: it is checked only when the fit could not meet
it, and then the miss left is reported.

Over a fleet, `fleetMedians` takes the median of `|error| / real` over the 0-60 checks and over the quarter-mile time
checks (a car without a finite figure counts as an infinite error), to be within `MEDIAN_ZERO_TO_SIXTY = 0.04` and
`MEDIAN_QUARTER = 0.03`; `orderInversions` names every pair of cars more than `ORDER_GAP = 0.10` apart on a published
figure (each check name apart) that the bench puts the other way round or level.

## 9. Proof

Unit tests beside each file; then for the whole car, on four proof cars whose sheets live in `src/golden.ts` (figures
typical of their kind, sources `illustrative`): a 3,300 lb front-drive sedan (2.5 L four, 200 hp, all-season tyres,
eight-speed automatic), a 3,650 lb mid-engine sports car (6.2 L V8, 495 hp, max-performance tyres, dual-clutch), a
3,900 lb V8 coupe (5.0 L, 480 hp, summer tyres, six-speed manual) and a 5,700 lb four-wheel-drive pickup (3.5 L
twin-turbo V6, 450 hp, all-terrain tyres, automatic). Nothing is tuned to land them anywhere. CI runs the core's two
compilers and its tests.

- **Invariants:** with no input, energy (the body's motion, the wheels' spin and the engine's) never rises, coasting in
  gear from 30 m/s down to 3 m/s (below that a converter may creep, which the engine pays for) and in neutral to rest,
  on every drivetrain. Two exemptions: a shift's rev-match (the dual-clutch's, the automatic's and the manual driver's
  blip) draws fuel energy, so shift steps are left out; and a one-step return of the tyres' elastic give at the instant
  a slide stops (up to about 5 J; removing it would need a step in force at the stop instead). A stepped box or a
  direct drive never feeds the car from the flywheel at all, so for them the motion and wheels alone never rise either;
  a CVT or eCVT hands the flywheel's energy to the wheels as its ratio moves. At rest it stays at rest (60 s, position
  within 1 mm): on the brakes in gear, with nothing pressed in a clutch car, set in neutral in an automatic. An
  automatic in drive with the brake off creeps at 0.5 to 2.5 m/s; on brakes that out-pull its converter (2,150 N m in
  all for the pickup, 850 N m for an all-wheel-drive sedan) it does not move. An all-wheel-drive car on its handbrake
  on a 10% grade stays put. Mirrored steering gives a mirrored path; 100,000 random-input steps
  give no NaN and no runaway; the same input log gives the same `hashState`; halving the substep moves no bench figure
  by more than 1%. **Golden hash:** `goldenRun(name)` drives a fixed 2,000-step input log (a seeded throttle, an
  occasional brake and a steer every 40 steps) on each proof car, and `GOLDEN` pins its final hash. Every machine and
  browser must give exactly those; a deliberate change to the physics re-pins them in the same commit, saying why.
- **Behaviour that must emerge:** in a steady corner at the limit, throttle runs a front-drive car wide and rotates a
  rear-drive car with enough torque; lifting tightens the line; the same car launches harder with all-wheel drive
  than rear drive; a higher centre of gravity lowers the skidpad figure; more rear roll stiffness moves the balance
  toward oversteer; more mass never shortens a stop or a 0-60; more power is never slower; with traction control off
  a car choosing its gears changes up and never back down, wheelspin or not; on a split surface traction control's
  brake lets front and four-wheel drive pull away a fifth faster, and slows none.
- **Plausibility**, where a vehicle engineer expects the proof cars: the sedan 0-60 in 6.5 to 9 s, 60-0 in 115 to
  140 ft, 0.78 to 0.90 g; the sports car 0-60 in 2.7 to 3.6 s, 0.98 to 1.10 g, 60-0 in 95 to 115 ft; the coupe 0-60
  in 4.0 to 5.2 s; the pickup 0.66 to 0.80 g, 60-0 in 125 to 155 ft; 1.4 times the brake torque shortens no 60-0 by
  more than 1.5% (a stop is the tyres'); every trap speed within 6% of Hale's `234 * (hp / lb as driven)^(1/3)` mph,
  as driven being curb weight plus the 75 kg driver.
- **The validation table** (`scripts/validate.ts`): every sheet in `src/data/sheets.ts` with test figures, calibrated,
  resolved, benched and checked, each check pass or miss, with each car's basis counts. The gate: at least 10 cars
  with 5 or more checks, 80% of them passing every check, none missing any check by more than 2 x its tolerance, both
  fleet medians within their limits over every car with the figure, and no order inversions.
- **Cost:** one `step` in 20 microseconds or less, the fastest of five batches of 4,000 steps after a warm-up; only
  an explicit `PHYSICS_STEP_BUDGET_US` loosens it. Measured about 9 to 11 µs for the sedan, sports car and coupe and
  15.5 to 16.3 µs for the pickup, whose locked centre and clutch take about 20 solver passes.

**Open questions** (defects still open, with their numbers):

1. **Each deflection is clamped on its own** (`relaxStep`). A locked wheel's slip ratio is held at 3 times its peak
   (0.35 for the summer tyre) while its slip angle is not, so its sliding force tilts sideways: the summer tyre locked
   at 5.7 degrees gives about 2.8 times the lateral force that sliding along its true direction would. A joint clamp
   in deflection space skews the other way by `relaxLat / relaxLong` (2.8 for the summer tyre), so the fix needs a
   design choice in tyre.ts.
2. **The front-drive sedan's skidpad.** The proof sedan reaches 0.790 g on the 300 ft circle, 86% of its 0.916 g
   friction limit at static loads; real front-drive sedans of its size on all-season tyres post about 0.82 to 0.86 g.
   The gap is in the cornering, not in traction control (the figure is the same with it off). It was 0.776 g before
   front-drive cars lost the class's understeering margin in their roll split. A car with a published skidpad is
   calibrated to it, so the gap matters only for cars without one.
3. **A car braked to rest rocks back.** Below 2 m/s ABS lets the full pedal through, the wheels lock for the last
   metres, and at the stop their wound-up deflections spring back: 1.2 to 2.0 cm on the proof cars from 10 or 30 m/s
   (4.2 cm before the re-stick rule), where a real tyre gives back about 1 cm. Suggested: blend the clamp from 3 peaks
   at 1.5 m/s rolling speed to 1 peak at a standstill.
4. **Ride frequencies against roll split.** In three classes the springs alone carry more than the rear's share of
   roll stiffness, so the rear bar is 0 and the car rolls less than its class figure: sports 2.18 against 2.6 deg/g,
   coupe 3.47 against 3.6, pickup 4.6 against 5.6 (blank class sheets). A setup's rear-bar multiplier does nothing on
   them.
5. **The auto-clutch's idle bite** ends above the road speed at which the largest ratio turns the engine at the bite
   speed, so in a tall gear its stall protection ends at about 3 to 4 mph. If protection is wanted lower, section 5.2
   changes first.
6. **Diesel friction** `[84e3, 48e3, 3.6e3]` was quoted from memory as Heywood gives Millington and Hartles: check it
   against the book. `EngineSpec` has no friction field, so the resolver refits a built engine. The fuel booking uses
   petrol's 14.7 for every engine (a diesel's is about 14.5), and an electric car books shaft energy, with no motor or
   inverter efficiency. The closed-throttle pumping (`PUMPING_MEP`) is charged to every combustion engine, a diesel's
   too, though a diesel has no throttle plate; and the friction's load term is held at its full-load figure at every
   load (more than the Shinn-Flynn form gives a motored cylinder, nothing more on boost: classes.ts FMEP).
7. **Fixed shapes that lack a field** (fix centrally in types.ts): the ground's rolling factor reaches `drivelineStep`
   through the module array `driveline.surfaceRolling` (vehicle.ts writes it each substep, drivelineStep puts it back
   to 1), for want of an argument or a state field; `Telemetry.wheelUse` has no field in `VehicleState`;
   `DrivelineModel.gears` says `[lowest, highest]` for a CVT without saying lowest what, and `createState` still sets
   `ratio = gears[0]` (`createVehicle` corrects it to the larger end); types.ts calls `steerRatio` turns of the
   steering wheel per radian, where the figure is the makers' dimensionless ratio; the sheet holds one final drive, so
   an all-wheel-drive car with different front and rear final drives (the GT-R's 2.937 and 3.70) cannot be
   represented.
8. **Sheet ids for the game.** Section 13 looks a world car's researched sheet up at `world-<make>-<model>`, but
   `SHEETS` uses the research records' ids (`2024-nissan-gt-r-nismo`), so that lookup never matches: the adapter needs
   a map from a world car to a research id. The game's car table gives the rentals' weight with the driver in (the
   Ronin GT's 2,950 lb is its 1,340 kg as driven), so a rental sent through `sheetFromTable` would come out 75 kg
   heavier than through `sheetFromAuthored`.
9. **The golden hash in browsers.** CI proves it in Node only. The plan asks the same bits in Chromium, Firefox and
   WebKit: install all three in CI's Playwright step and add `apps/sim/e2e/physics-hash.smoke.mjs`, which bundles
   `src/golden.ts` and runs `goldenRun` for each proof car against `GOLDEN`.

## 10. Signatures

Fixed, so that files written side by side fit together. A file may export more; it may not change these. Every export
another module, a script or the game uses is here.

```ts
// tyre.ts
export type TyreOut = { fx: number; fy: number; mz: number; use: number };
export const LOW_SPEED_FADE: number;                                                     // 1.5 m/s
export function tyreMuY(p: TyreParams, fz: number, grip: number): number;
export function tyreMuX(p: TyreParams, fz: number, grip: number): number;
export function cornerStiffness(p: TyreParams, fz: number): number;                       // N/rad at this load
export function peakSlipRatio(p: TyreParams, fz: number, grip: number): number;
export function peakSlipTan(p: TyreParams, fz: number, grip: number): number;
export function tyreForces(p: TyreParams, fz: number, slipRatio: number, slipTan: number, slideSpeed: number, grip: number, out: TyreOut): void;
export function elasticShare(p: TyreParams, use: number, slideSpeed: number): number;     // pe / use for the re-stick, 1 at or before the peak
export function relaxStep(def: number, slipVel: number, rollSpeed: number, relax: number, maxDef: number, h: number): number; // the new deflection
export function maxDeflectionX(p: TyreParams, fz: number, grip: number): number;          // m: relaxLong * 3 * peakSlipRatio
export function maxDeflectionY(p: TyreParams, fz: number, grip: number): number;          // m: relaxLat * 3 * peakSlipTan
export function lowSpeedDamping(p: TyreParams, fz: number, cornerMass: number): number;   // N per m/s of slip speed at a standstill
export function lowSpeedFade(rollSpeed: number): number;                                   // 1 at rest, 0 from 1.5 m/s
export function rollingResistance(p: TyreParams, fz: number, rolling: number): number;    // N, a size: the friction the driveline solves with the brake

// engine.ts
export type EngineSpec = {
  kind: EngineKind; displacementL: number; cylinders: number;
  peakPower: number; peakPowerOmega: number;                 // W, rad/s
  peakTorque: number; peakTorqueOmegaLow: number; peakTorqueOmegaHigh: number;   // N m, rad/s (equal when there is no plateau)
  redline: number; idle: number;                              // rad/s
  boostPa: number;                                            // gauge pressure at full boost, 0 when not boosted
  inertia: number;                                            // kg m^2
  curve: [number, number][] | null;                           // authored [rad/s, N m], used as given when present
};
export const AIR_ENERGY: number;
export function targetTorque(spec: EngineSpec, omega: number): number;                    // the published curve the tables are aimed at, N m
export function buildEngine(spec: EngineSpec): EngineModel;                               // throws for a peak that is not a positive finite number
export function rebuildTables(e: EngineModel): void;
export function engineTorque(e: EngineModel, omega: number, throttle: number, boost: number): number;   // brake torque, N m
export function boostStep(e: EngineModel, boost: number, omega: number, throttle: number, h: number): number;  // the new boost state
export function enginePeaks(e: EngineModel): { power: number; powerOmega: number; torque: number; torqueOmega: number };
export const PUMPING_MEP: number;   // 75e3 Pa: the closed throttle's pumping, on top of friction
export function throttleForShare(e: EngineModel, omega: number, boost: number, th: number, share: number): number;   // the throttle that makes `share` of the torque `th` makes (traction control's cut)

// aero.ts
export type AeroOut = { drag: number; liftFront: number; liftRear: number };   // drag: N along body x, negative when moving forward. lift: N upward at each axle
export function aeroForces(a: AeroModel, u: number, out: AeroOut): void;
export function roadLoad(a: AeroModel, u: number): number;   // N along body x: -(roadLoadA * soft(u, 0.02) + roadLoadB * u), 0 at rest

// chassis.ts
export function staticLoads(c: ChassisModel, out: Float64Array): void;       // the four wheel loads at rest, N
export function steerAngles(s: VehicleState, steer: number): void;           // writes s.wheelSteer
export function wheelLoads(s: VehicleState, air: AeroOut): void;             // writes s.wheelLoad
export function suspensionStep(s: VehicleState, air: AeroOut, h: number): void;   // advances heave, pitch, roll
export function rollGradient(c: ChassisModel): number;                       // steady roll, rad per m/s^2 (Infinity if the springs cannot hold the body)

// brakes.ts   (grip: the surface grip under each wheel, length 4)
export function wheelRoadSpeed(s: VehicleState, i: number): number;          // m/s: wheel i's centre along the way it points
export function brakeTorques(s: VehicleState, c: Controls, grip: Float64Array, h: number): void;   // writes s.wheelBrake, s.absActive, s.absHold

// systems.ts
export function prepareShiftPoints(model: VehicleModel): void;               // once per model, outside the step (createState calls it)
export function shiftUpOmega(model: VehicleModel, gear: number): number;     // engine speed to shift up from this gear at full throttle
export function autoShift(s: VehicleState, c: Controls): number;             // the gear wanted
export function tractionControl(s: VehicleState, c: Controls, grip: Float64Array, h: number): number;   // the engine half's cut: a share of the drive, 0 to 1; adds its brake to s.wheelBrake
export const SHIFT_PEDAL_RISE: number, SHIFT_PEDAL_FALL: number;          // the gearbox controller's pedal filter, s (0.1 and 1.5)
export function shiftPedalStep(read: number, pedal: number, h: number): number;   // the filtered pedal h seconds on
export function stabilityControl(s: VehicleState, c: Controls, grip: Float64Array, h: number): void;    // adds to s.wheelBrake (h unused)
export function limiterCut(s: VehicleState): number;                         // throttle multiplier, 0 to 1

// driveline.ts   (throttle: after traction control and the limiter)
export const surfaceRolling: Float64Array;   // length 4: the ground's rolling factor under each wheel for the next drivelineStep only (vehicle.ts writes it; drivelineStep resets it to 1)
export function drivelineStep(s: VehicleState, c: Controls, gearWanted: number, throttle: number, h: number): void;

// vehicle.ts
export const STEP: number;       // 1 / 120
export const SUBSTEPS: number;   // 4
export function createVehicle(model: VehicleModel): VehicleState;            // at rest, engine idling, in first gear
export function placeVehicle(s: VehicleState, x: number, y: number, hx: number, hy: number): void;   // moved there, stopped
export function step(s: VehicleState, c: Controls, world: WorldQuery): void;
export function stepWith(s: VehicleState, c: Controls, world: WorldQuery, substeps: number): void;   // the same 1/120 s in another number of substeps
export function telemetry(s: VehicleState, out: Telemetry): void;
export function applyImpulse(s: VehicleState, jx: number, jy: number, atX: number, atY: number): void;
export function hashState(s: VehicleState): number;
export function shiftPedal(s: VehicleState): number;                          // s.shiftPedal: the pedal as the gearbox controller reads it
export function setShiftPedal(s: VehicleState, read: number): void;

// state.ts
export function createState(model: VehicleModel): VehicleState;             // zeroed, at the origin facing +X; prepares the shift points
export function defaultControls(): Controls;                                 // nothing pressed, AUTO_GEAR, systems on
export function createTelemetry(): Telemetry;
export const FLAT: WorldQuery;                                               // flat dry asphalt everywhere
export function createSurfaceSample(): SurfaceSample;

// sheet.ts
export type ResearchField = { key: string; number?: number; numbers?: number[]; text?: string; publisher?: string; url?: string; sourceKind?: string; note?: string; check?: string };
export type ResearchRecord = { id: string; year: number; make: string; model: string; trim: string; bodyClass: string; gathered?: string; fields: ResearchField[] };
export type SheetProblem = { key: string; value: string; reason: string };
export type ResearchReading = { sheet: PhysicsSheet; used: string[]; dropped: SheetProblem[]; unused: string[]; notes: SheetProblem[] };
export function emptySheet(id: string, identity: PhysicsSheet['identity']): PhysicsSheet;
export function readResearch(record: ResearchRecord): ResearchReading;       // throws when the identity cannot be read
export function sheetFromResearch(record: ResearchRecord): PhysicsSheet;
export const SET_APART: string;                                               // the reason's prefix for a test figure that is not a check
export const NOT_SECOND_READ: string;                                         // ...because nobody second-read it
export function isSetApart(p: SheetProblem): boolean;
export function testerPractice(publisher: string): { name: string; rollout: boolean | null; skidpadFt: number | null };   // null: not known
export function sheetProblems(record: ResearchRecord): SheetProblem[];
export type TableRow = { make: string; model: string; bodyClass: BodyClass; engine: string; hp: number; weightLb: number; zeroToSixty: number; topSpeedMph: number; drive: Drivetrain };
export function sheetFromTable(row: TableRow): PhysicsSheet;                 // an estimated sheet from a game table's six figures; 0-60 goes to tests only
export function tableProblems(row: TableRow): SheetProblem[];
export type AuthoredSpec = { id: string; name: string; drive: 'FWD' | 'RWD' | 'AWD'; mass: number; a: number; b: number; h: number; cd: number; area: number; redline: number; r: number; fin: number; gears: number[]; tq: [number, number][] };
export function sheetFromAuthored(spec: AuthoredSpec, bodyClass: BodyClass): PhysicsSheet;   // a drawn (fictional) car, one to one

// data/sheets.ts   (generated by scripts/build-sheets.ts from data/research)
export const SHEETS: readonly PhysicsSheet[];
export function sheetById(id: string): PhysicsSheet | null;

// classes.ts   (every table frozen; the row shapes are exported types of the same names)
export const TYRE_CATEGORY: Readonly<Record<TyreCategory, TyreCategoryRow>>;
export const CHASSIS_CLASS: Readonly<Record<BodyClass, ChassisClassRow>>;
export const CLASS_DIMENSIONS: Readonly<Record<BodyClass, ClassDimensions>>;
export const CLASS_STEER_RATIO: Readonly<Record<BodyClass, number>>;
export const CLASS_FINAL_DRIVE: Readonly<Record<BodyClass, number>>;
export const CLASS_LIMITER: Readonly<Record<BodyClass, number>>;              // m/s
export const CLASS_LIMITER_PERFORMANCE: Readonly<Record<BodyClass, number>>;  // m/s
export const LIMITER_RAISE_BAND: Readonly<{ from: number; to: number }>;      // W per kg of curb weight
export const CLASS_TYRES: Readonly<Record<BodyClass, ClassTyres>>;
export const SUSPENSION_GRADE: Readonly<Record<SuspensionGrade, SuspensionGradeRow>>;
export const TRANSMISSION: Readonly<Record<TransmissionType, TransmissionRow>>;
export const REDLINE: Readonly<{ standard: number; eightPlus: number; boostedFourTruck: number; diesel: number; electric: number }>;   // rad/s
export const FMEP: Readonly<{ petrol: readonly [number, number, number]; diesel: readonly [number, number, number] }>;
export const CHARGE_AIR: Readonly<Record<'turbo' | 'supercharged', ChargeAirRow>>;   // intercooler, blowerDrive, boostPa
export const DIFF_DEFAULT: Readonly<Record<DiffKind, Readonly<DiffModel>>>;
export const AWD_CENTRE: Readonly<Record<AwdKind, Readonly<DrivelineModel['centre']>>>;
export const LOADED_RADIUS_RATIO: number, FZ_STIFF_PEAK_RATIO: number, TRAIL0: number, MAX_STEER_DEFAULT: number, ANTI_DIVE: number,
  ANTI_SQUAT: number, ROLL_GYRATION_PER_WIDTH: number, PITCH_GYRATION_PER_LENGTH: number, DRIVER_MASS: number, BRAKE_SIZING_G: number,
  BRAKE_AXLE_MARGIN: number, BRAKE_BIAS_RANGE: number, HANDBRAKE_TORQUE: number, SYSTEMS_STANDARD_FROM: number, CLUTCH_CAPACITY_RATIO: number,
  SINGLE_SPEED_FINAL_DRIVE: number, COMPRESSOR_EFFICIENCY: number, KNOCK_LIMIT_PR: number;
export function tyreGripScaleRange(category: TyreCategory): { min: number; max: number };
export function tyreReferenceLoad(width: number, diameter: number): number;  // fz0, N
export function weightFrontShare(location: EngineLocation, drive: Drivetrain, bodyClass: BodyClass): number;
export function brakeFrontShare(location: EngineLocation, drive: Drivetrain): number;
export function drivelineEfficiency(type: TransmissionType, drive: Drivetrain): number;
export function gearRatioAt(gear: number, count: number, top: number, spread: number): number;
export function wheelMass(width: number, rimIn: number): number;
export function wheelInertia(mass: number, radius: number): number;
export function defaultIdle(cylinders: number): number;
export function defaultRedline(powertrain: Powertrain, cylinders: number, boosted: boolean, bodyClass: BodyClass): number;
export function peakSpeedShares(boosted: boolean): PeakSpeedShares;
export function engineInertia(litres: number, electric: boolean): number;

// resolve.ts   (the steps parts.ts calls; each writes the basis of what it fills)
export type SheetLayout = { bodyClass: BodyClass; year: number; powertrain: Powertrain; induction: Induction; location: EngineLocation; drive: Drivetrain; layout: DrivelineModel['layout']; transmission: TransmissionType; basisOf: { powertrain: Basis; induction: Basis; location: Basis; drive: Basis; transmission: Basis } };
export type ResolvedTyres = { front: TyreParams; rear: TyreParams; wheelInertiaFront: number; wheelInertiaRear: number; category: TyreCategory; gripScale: number; sizeFront: TyreSize; sizeRear: TyreSize };
export type DrivelineInputs = { engine: EngineModel; chassis: ChassisModel; tyres: ResolvedTyres; aero: AeroModel; systems: SystemsModel };
export type StockCar = { model: VehicleModel; basis: Record<string, Basis>; layout: SheetLayout; tyres: ResolvedTyres };
export function resolveModel(sheet: PhysicsSheet, build?: Build): { model: VehicleModel; basis: Record<string, Basis> };   // the stock car, and parts.ts fits a build
export function resolveStock(sheet: PhysicsSheet): StockCar;
export function resolveLayout(sheet: PhysicsSheet): SheetLayout;
export function resolveTyres(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): ResolvedTyres;
export function tyreParams(size: TyreSize, category: TyreCategory, gripScale: number, rollingOnFile: boolean): TyreParams;   // one axle's tyre
export function resolveChassis(sheet: PhysicsSheet, layout: SheetLayout, tyres: ResolvedTyres, basis: Record<string, Basis>): ChassisModel;
export type Gyration = { yawIndex: number; kRoll: number; kPitch: number };
export function chassisGyration(sheet: PhysicsSheet, bodyClass: BodyClass): Gyration;
export function setInertias(c: ChassisModel, g: Gyration): void;           // Izz, Ixx, Iyy again by resolveChassis's formulas
export function resolveAero(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): AeroModel;
export function resolveEngineSpec(sheet: PhysicsSheet, layout: SheetLayout, basis: Record<string, Basis>): EngineSpec;
export function resolveEngine(spec: EngineSpec, layout: SheetLayout): EngineModel;                  // buildEngine, and the diesel refit
export function refitFriction(e: EngineModel, fmep: readonly [number, number, number]): void;
export function resolveSystems(sheet: PhysicsSheet, layout: SheetLayout, chassis: ChassisModel, spec: EngineSpec, basis: Record<string, Basis>): SystemsModel;
export function resolveDriveline(sheet: PhysicsSheet, layout: SheetLayout, inputs: DrivelineInputs, basis: Record<string, Basis>): DrivelineModel;
export function resolveBrakes(layout: SheetLayout, chassis: ChassisModel, tyres: ResolvedTyres, basis: Record<string, Basis>, frontShare?: number): BrakeModel;
export function idealStop(chassis: ChassisModel, tyres: ResolvedTyres): { front: number; rear: number; decel: number };   // N at each axle, m/s^2
export function applySetup(model: VehicleModel, setup: Setup, basis: Record<string, Basis>): void;
export function classLimiter(bodyClass: BodyClass, powerW: number, curbKg: number): number;        // m/s, Infinity for none
export function powerLimitedSpeed(wheelPower: number, chassis: ChassisModel, tyres: ResolvedTyres, aero: AeroModel): number;   // m/s
export function drivenMass(sheet: PhysicsSheet): number;                                            // kg: curb weight and the driver
export function coastDown(sheet: PhysicsSheet): { a: number; b: number; c: number; hasA: boolean } | null;   // SI
export function weakerBasis(a: Basis, b: Basis): Basis;
export function derivedBasis(...inputs: Basis[]): Basis;
export const CLASS_BLANK: Readonly<Record<BodyClass, ClassBlank>>, TORQUE_BMEP: Readonly<{ natural: number; turbo: number; supercharged: number; diesel: number }>,
  BOOSTED_ABOVE_HP_PER_LITRE: number, HP_PER_LITRE: Readonly<{ unboosted: number; boosted: number }>, EV_SPEED_RANGE: number,
  TRUCK_CONVERTER: Readonly<{ stallOmega: number; torqueRatio: number }>, FRONTAL_AREA_SHARE: number;

// drivers.ts   (made once per run; control() allocates nothing)
export type Driver = { control(s: VehicleState, c: Controls): void };
export type LaunchDriver = Driver & { readonly launchOmega: number; readonly shiftOmega: Float64Array; released: boolean };
export type CircleDriver = Driver & { wide: number; target: number; t0: number; v0: number; rise: number; cap: number; held: number; trim: number };
export function drivenWheels(model: VehicleModel): { first: number; last: number };
export function launchDriver(model: VehicleModel, launchOmega: number, shiftShare: number): LaunchDriver;
export function circleDriver(model: VehicleModel, cx: number, cy: number, radius: number, v0: number, rise: number, cap?: number): CircleDriver;
export function cruiseDriver(speed: number): Driver;
export function brakeDriver(): Driver;
export function flatOutDriver(): Driver;

// bench.ts, calibrate.ts
export function runBench(model: VehicleModel, test?: BenchTest): BenchResult;
export function runBenchWith(model: VehicleModel, test: BenchTest, substeps: number): BenchResult;
export function skidpadAt(model: VehicleModel, diameterFt: number): number;                        // g
export function topSpeedOf(model: VehicleModel): { mph: number; governed: boolean };
export function setRolling(s: VehicleState, u: number, r: number): void;                           // a standing car set rolling, wheels and engine with it
export function copyState(from: VehicleState, to: VehicleState): void;
export function frictionLimit(model: VehicleModel): number;                                         // m/s^2 at static loads
export function asTested(sheet: PhysicsSheet): PhysicsSheet;                 // the curb weight replaced by the tested car's scale weight, when the tests carry one
export function calibrate(sheet: PhysicsSheet): PhysicsSheet;
export function dragTarget(sheet: PhysicsSheet): number | null;                                     // mph, or null when drag may not be fitted
export type Check = { name: string; unit: string; real: number; model: number; error: number; tolerance: number; pass: boolean };
export function checkSheet(sheet: PhysicsSheet, bench: BenchResult): Check[];
export const TOLERANCE: Readonly<{ zeroToSixtyShare: number; zeroToSixtySec: number; quarterShare: number; trapShare: number; brakingShare: number; topSpeedShare: number; governedMph: number; skidpadG: number }>;
export const MEDIAN_ZERO_TO_SIXTY: number;   // 0.04
export const MEDIAN_QUARTER: number;         // 0.03
export const ORDER_GAP: number;              // 0.10
export function fleetMedians(tables: Check[][]): { zeroToSixty: number | null; quarter: number | null };
export function orderInversions(cars: { id: string; checks: Check[] }[]): string[];

// golden.ts
export const PROOF_CARS: readonly ('sedan' | 'sports' | 'coupe' | 'pickup')[];
export function proofSheet(name: string): PhysicsSheet;
export const GOLDEN_STEPS: number;           // 2000
export function goldenLog(): Controls[];
export function goldenRun(name: string): number;                                                   // the final hashState
export const GOLDEN: Readonly<Record<string, number>>;

// math.ts   (rule 3's arithmetic)
export const PI: number, TAU: number, HALF_PI: number, G: number, RHO_AIR: number, P_AMBIENT: number, T_AMBIENT: number;   // 9.80665 m/s^2, 1.225 kg/m^3, 101325 Pa, 288.15 K
export function clamp(x: number, lo: number, hi: number): number;
export function lerp(a: number, b: number, t: number): number;
export function sq(x: number): number;
export function soft(x: number, eps: number): number;                        // x / (|x| + eps)
export function dsin(x: number): number;
export function dcos(x: number): number;
export function datan(x: number): number;
export function datan2(y: number, x: number): number;
export function dexp(x: number): number;
export function dln(x: number): number;
export function dpow(x: number, y: number): number;                          // 0 for x <= 0
export function tableAt(ys: Float64Array, dx: number, x: number): number;    // straight between points, flat past the ends
export function curveAt(pts: readonly (readonly [number, number])[], x: number): number;
export function hermite(x0: number, y0: number, m0: number, x1: number, y1: number, m1: number, x: number): number;
export function rng(seed: number): () => number;                             // mulberry32, 0 to 1
export const HASH_START: number;
export function hashNumber(h: number, x: number): number;                    // FNV-1a over the number's eight bytes

// units.ts   (SI per published unit)
export const LB: number, IN: number, FT: number, MPH: number, HP: number, LBFT: number, PSI: number, LBF: number, SQFT: number, RPM: number, LITRE: number;
export type TyreSize = { width: number; aspect: number; rimIn: number; radius: number };
export function parseTyreSize(size: string): TyreSize | null;                // "245/35ZR19", "LT285/70R17", "33x12.50R17"
```

`index.ts` is the package's public surface: all of `types.ts` (with `AUTO_GEAR`), `state.ts`, `vehicle.ts`,
`sheet.ts`, `classes.ts`, `resolve.ts`, `bench.ts` and `calibrate.ts`; from `engine.ts` `AIR_ENERGY`, `boostStep`,
`buildEngine`, `enginePeaks`, `engineTorque`, `rebuildTables`, `targetTorque` and the `EngineSpec` type; from
`math.ts` `G`, `HALF_PI`, `PI`, `P_AMBIENT`, `RHO_AIR`, `TAU`, `T_AMBIENT`. The rest is reached by its own path.
`fixtures.ts` builds a plain car by hand for tests and is not exported.

## 11. Parts and builds (`parts.ts`)

A part changes physical numbers and its cost follows. There is one catalogue, in physical units, for the world's
Garage and (through section 12) for the card. Nothing in it is a percentage of performance: a part changes a
pressure, a flow, a mass, a stiffness, a friction, and the bench shows what that is worth on the car it is fitted to.

`resolveModel(sheet, build)`: resolve the stock pieces (the exported steps of `resolve.ts`), let each fitted part
change them **in the catalogue's fixed order** (never the order the player bought them in), apply `build.setup` as
given (any positive scale, on whatever the fitted parts left: section 13; the "the setup may move" ranges in the table
below are what a part is sold to adjust, which is for whoever builds the setup to hold to, and the code does not), call
`rebuildTables` on the engine, then re-derive what depends on what changed (mass and its split, inertias,
centre-of-gravity heights, and the brake sizing when a brake part or a tyre part says so: a tyre part re-sizes the
brakes to the new tyres through `resolveBrakes`).
`describeBuild(sheet, build)` returns, for each part, what it changed in words and numbers, and why a part was
refused (`fits` returns a reason: a turbo kit on an electric car, a second induction kit, a part that needs another).

| Slot | Parts (ids) | What changes, physically | Its cost |
| --- | --- | --- | --- |
| intake | `intake-1` | `maxAirflow` x1.10; `specific` x(1 + 0.012 x^2), x = speed / redline | none worth modelling |
| exhaust | `exhaust-1` cat-back, `exhaust-2` headers or downpipe and high-flow cats | `specific` x(1 + 0.015 x^2), then x(1 + 0.035 x^2) and `maxAirflow` x1.12; on a turbo engine `exhaust-2` also `tauRef` x0.88 and `knockLimitPr` +0.1 | -3 kg, -8 kg |
| tune | `tune-1`, `tune-2`, `tune-3` | Unboosted: `specific` x1.025, x1.035, x1.04 and redline +150, +250, +300 rpm (2 and 3 need intake and exhaust). Boosted: target `pressureRatio` raised by 0.22, 0.38, 0.55 of an atmosphere above the stock peak, held to the power peak, always capped by `knockLimitPr` and `maxAirflow` (2 needs `exhaust-2`; 3 needs `intercooler-1` and `fuel-1`) | less margin: the card engine charges reliability |
| fuel | `fuel-1` (E85 or race fuel) | `knockLimitPr` 2.6 to 3.3; `specific` x1.02 | fuel flow x1.3 for the same power |
| intercooler | `intercooler-1` | effectiveness to 0.85 | +4 kg |
| induction | `turbo-kit-1/2/3` on an unboosted engine: 6, 9, 13 psi. `supercharger-kit-1/2/3`: 6, 9, 12 psi. `turbo-upgrade-1/2` on a turbo engine | Kit: the engine becomes boosted: a pressure-ratio table (a turbo's rises from its threshold; a supercharger's is there from idle and grows with speed), `intercooler` 0.7, `compressorEff` 0.72, a supercharger's `blowerDrive` 0.12, `maxAirflow` sized to the kit, turbo lag for a turbo. Upgrade: `maxAirflow` x1.35, x1.8; `tauRef` x1.25, x1.6; the threshold moves up 10%, 22% | +22 to +35 kg on the nose; lag; heat; the card engine charges reliability and durability |
| cams | `cams-1`, `cams-2` | `specific` x(0.95 + 0.11 x), x(0.90 + 0.20 x); redline +400, +800 rpm; idle +100, +250 rpm | low-speed torque lost |
| internals | `internals-1` | redline +300 rpm; raises the torque the card engine treats as safe | none on the road |
| flywheel | `flywheel-1` | engine inertia x0.7 | none worth modelling |
| nitrous | `nitrous-1/2/3`: 50, 100, 150 hp | `nitrous = { power, bottleMass 4.5 kg, flow = 0.36 kg per 100 hp per 10 s }` | +16 kg in the tail; the bottle empties and stays empty until refilled |
| clutch | `clutch-1/2` | `clutchCapacity` x1.5, x2.2 | none worth modelling |
| gearbox | `shifter-1` (manual: `shiftTime` x0.75), `gearbox-1` close-ratio set, `gearbox-2` sequential or dual-clutch conversion (`shiftTime` 0.08, hold 0.5) | ratios respaced between the stock first and top | `gearbox-2`: +10 kg |
| differential | `lsd-1` street, `lsd-2` race (driven axle) | `kind` limited-slip, preload 60, 150 N m, `lockPerTorque` 0.25, 0.5 | understeer on the way in when over-locked |
| tyres | `tyres-all-season`, `tyres-summer`, `tyres-max-performance`, `tyres-track`, `tyres-all-terrain`, `tyres-drag` | the whole tyre category (section 7's table), keeping the car's grip scale in proportion; `tyres-wide-1` +20 mm width | rolling resistance, and wear later |
| wheels | `wheels-light-1` | unsprung mass -3 kg a corner; wheel inertia x0.85 | none |
| springs | `springs-1` sport, `springs-2` coilovers, `springs-3` race coilovers | ride frequency x1.2, x1.45, x1.75; damping ratio +0.06, +0.12, +0.18; ride height -25, -40, -55 mm (centre of gravity with it); from `springs-2` the setup may move springs, dampers and height | ride; ground clearance |
| anti-roll bars | `arb-1`, `arb-2` (adjustable) | both bars x1.3; with `arb-2` the setup may move each from x0.7 to x1.9 | none |
| weight | `weight-1/2/3` | curb weight -3%, -7%, -12% (taken from the sprung mass, the rear a little more than the front: the front share rises by 0.3, 0.7, 1.2 points) | the card engine charges durability |
| brakes | `brakes-1` pads and fluid, `brakes-2` big brake kit, `brakes-3` race kit | brake torque capacity x1.15, x1.4, x1.6 (a first stop is still the tyres'); from `brakes-2` the setup may move the bias; fade resistance when heat is modelled | `brakes-2/3`: +2, +3 kg unsprung a front corner |
| aero | `aero-front-1/2` splitter, `aero-rear-1/2` wing | front lift area -0.10, -0.22 m^2 with drag +0.012, +0.03; rear -0.18, -0.40 with drag +0.03, +0.07; the setup may trim each between zero and the part's full figure, drag in proportion | drag; +3 to +8 kg |

Every number in that table is `estimated` until the parts exam (`data/exam/*.json`) says otherwise: `exam.test.ts`
runs each exam case that has enough physical detail and asserts the predicted change is within the exam's scatter
(peak power and torque within 5% of the measured figure after the change; quarter-mile time and trap speed within
4%; skidpad within 0.04 g; a braking distance within 7%). A part that cannot meet its exam is fixed in its physics
or reported: a reported miss is recorded in the test (`RECORDED_MISSES`, its reason in EXAM.md), so the case still
fails on any other miss or once the recorded band is met. It is never given a per-car factor.

`legacyBuild(perf, tune, sheet)` maps the Garage's nine three-tier parts and eight sliders onto this catalogue, so
that saved builds carry over and the three tiers become presets of real parts:

| Garage part | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Engine | intake-1, exhaust-1 | + exhaust-2, cams-1 | + cams-2, internals-1, flywheel-1 |
| ECU | tune-1 | tune-2 (with what it needs, if fitted; else it acts as tune-1) | tune-3 (the same rule), fuel-1 |
| Turbo | unboosted: turbo-kit-1. boosted: intercooler-1 | turbo-kit-2. turbo-upgrade-1 | turbo-kit-3. turbo-upgrade-2 |
| Transmission | clutch-1, shifter-1 | + gearbox-1, lsd-1 | clutch-2, gearbox-2, lsd-2 |
| Suspension | springs-1 | springs-2, arb-1 | springs-3, arb-2 |
| Nitrous | nitrous-1 | nitrous-2 | nitrous-3 |
| Tires | one category stickier than stock | two | tyres-track |
| Brakes | brakes-1 | brakes-2 | brakes-3 |
| Weight | weight-1 | weight-2 | weight-3 |

Sliders (-1 to 1): turbo moves `tauRef` x(1 + 0.25 t) and the pressure-ratio target by 4% of its boost the same
way (later and harder, or sooner and softer); nitrous trades the shot against how long the bottle lasts at the same
bottle mass (`power` x(1 + 0.3 t)); aero from -1 (no added downforce, drag as stock) through 0 (stock) to +1 (the
fitted aero parts' full downforce, or a modest -0.12 m^2 rear and -0.06 m^2 front with drag +0.02 when none is
fitted); bias moves `brakeBias` by 0.06 t; ride height `rideHeightDrop = 0.02 t` m; stiffness moves springs and
dampers x(1 + 0.2 t); steering is the assist layer's, not the car's; gears moves `finalDrive` x(1 + 0.12 t).

## 12. Rating and the card (`rating.ts` here; `simulated.ts` in `@micar/engine`)

`benchFigures(bench, model)` gives the bench in the card's units: horsepower, torque (lb ft), curb weight (lb),
0-60 with rollout (s), top speed (mph), skidpad on 300 ft (g), 60-0 (ft), quarter mile (s, mph). A nitrous kit's shot
is in the horsepower, and the bench's drag runs arm the kit, so its 0-60 and quarter mile are the car with it too; the
top speed, the stops and the skidpad are run without it, and the torque is the engine's own.

The card engine never imports this package. Its new file takes plain numbers:
`simulatedSpec(spec, stock, built)` returns a copy of a card specification whose horsepower, torque, curb weight,
0-60, top speed and skidpad figure are each the published figure times `built / stock` (a figure not on file stays
missing; a changed figure is marked as worked out, with the note `simulated on the bench`), and the list of fields
it changed, to be scored with the tables every card is scored with. Dividing the built car by the stock car on the
same bench cancels the model's own error: only the change is simulated. Reliability, durability and originality
are still charged by the card engine's modification table, through each part's `card: { category, tier }`.
Nothing in ranked play reads this until the owner approves a new ruleset: it is offered beside ruleset v1, not in
place of it.

The world's class letter for a build is the card engine's `raceClassOf` on the Power Rating of that simulated
specification: one rating for the card and the road. In the game (`apps/sim/src/world/core/garageBench.ts`) the
card is the world's own for the model (`world/cardStats.ts` `engineSpecFor`: the car table's figures), the two runs
are the core's bench of the car stock and as built, the parts are charged through `buildCardMods` as fitted by the
Strip's Garage (a professional install, declared, new), and the Power Rating is the one the world shows: the
provisional rating while the world's card leaves efficiency and reliability unrated (as `CardStatsPanel` shows it).
The world's car table has no word for the powertrain, and the card engine refuses a combustion part's charge on a
blank one, so the Garage's card takes the powertrain from the core's sheet for the car (`garageBench.ts garageCard`;
a blank sheet is driven as petrol).

## 13. The game drives on it (`apps/sim/src/world/core/`)

The old model stays the default. `?physics=core`, or "Driving: New (beta)" in the Garage's Options, picks the core for
the session. With the switch off not one line of the old path changes behaviour.

The old `Vehicle` object stays the one everything reads and writes (walls, the race runner, the HUD, the sound, the
camera all hold it). The adapter is a `Driver` with the same surface whose step is:

1. Read from the `Vehicle` what the outside may have changed: position, heading, velocities, gear, `blown`.
   Sim to core: `X = z`, `Y = x`, `(hx, hy) = (cos h, sin h)`, `u`, `v`, `r = w` unchanged, `steer = -Input.steer`.
2. Turn the `Input` into `Controls` through the assist layer (below).
3. `step` the core once (the game's sub-step is already 1/120 s).
4. Write back every field a reader uses, in its old unit and sense (`rpm`, `gear`, `shift`, `boost` 0 to 1, `nos` in
   seconds, `spinF`/`spinR` as 0 to 1 flags, `beta`, `ax` smoothed, `thr`, `brk`, `hand`, `bov`, `vx`, `vz`, ...), and
   keep a `P` whose `redline`, `idle`, `gears`, `turbo`, `nos`, `drive` describe the core's car.

A car becomes a model by `coreModelFor(car, perf, tune)`: a rental car through `sheetFromAuthored`; a world car
through a researched sheet when one is that car, else `sheetFromTable` (else its body style's drawn archetype); then
`resolveModel(sheet, legacyBuild(perf, tune, sheet))`, cached per car and build. Research files a record as
`<year>-<make>-<model>-<trim>`, so a world car's record is found by what it is (`model.ts` `researchedFor`), from
`SHEETS`: its make and model are the world car's real ones (a car the world names by its game name, Nizzan GT-RR,
has a real one behind it, `carModels.ts` `realNameOf`; Chevy is Chevrolet; a body word after the model, "Civic
Sedan", is dropped); when the car table has a row for it, the record's horsepower is within 12% of the row's
(`POWER_MATCH`: a model-year update moves a rating a few per cent, another configuration of the model a third or
more, so the F-150 Raptor's 450 hp is not the table's 325 hp 2.7 EcoBoost F-150, nor the fifth-generation Prius's
194 hp its 121 hp Prius); of several, the one whose engine is the row's (displacement within 0.15 L, the same
cylinders), then the nearest horsepower, then the newest, then by id. Today twelve world cars drive on a record:
Camry, RAV4, Tacoma, Mustang, Civic, Odyssey, Corvette, and by their game names the Wrangler, GT-R, 911, Model 3
and Golf GTI.

**The Garage** with the switch on shows the core's own bench for the car as built (`garageBench.ts`): the bars are
`benchFigures` (top speed, 0-60 with rollout, the 300 ft skidpad, 60-0, the nitrous shot and bottle), the header the
peak power and the car's mass as driven, the dyno the core engine's own full-throttle table (`wot`, full boost)
from idle to redline, and beside them the build's class letter (section 12). A build is measured once (two bench
runs, stock and built: up to a couple of seconds) and kept; the runs are made in a worker, or on a timer where the
page has none, so the panel draws at once and says it is measuring until they are back. With the switch off the
panel is the old model's. The Garage's sliders reach the same on every car, as they always have: `resolveModel`
applies `build.setup` as given, and holding a setup to what the fitted parts allow is for whoever builds the setup
(the Garage offers its sliders on any car; `legacyBuild` maps them). With race fuel fitted (`fuel-1`, the ECU's
third tier) the adapter draws 1.3 times the fuel from the tank for the same throttle (section 11's cost).

**Class** is shown where the world shows one, the Garage, and the world's computer racers with the switch on drive
the player's own car (section 14), so a field is of the player's class by construction; a challenge room lends
every racer the same rental.

**The server's floors** (rubric F3, `world/floors.ts`): a Strip finish faster than its event's floor is refused as
impossible. Each floor is the fastest legal build's run on that event less 10% (`FLOOR_MARGIN`), worked out by
`apps/sim/scripts/build-floors.ts` into `floors.json` (`core/floorRuns.ts` says what each run is): every car a
player can drive, every part at its top tier, the sliders at the settings that make it quickest; on the core a drag
is the bench's launch with the nitrous armed, a lap the limit lap on the widest line inside the walls with the
nitrous all the way; and because the old model is still the default and the server cannot tell which a run was
driven on, each car is bounded on the old model too, the fastest of all setting the run. The margin is for what no
run holds (a better launch or shift point, a gap in the walls, a slow frame, a physics change since the table was
made; `floors.test.ts` calls the table stale at 3%). The Mountain Half Mile's floor is 12.4 s, under the 13.8 s of
the fastest legal car (a Corvette on the core), where the old fixed 50 m/s gave 16.1 s; a circuit's floor is two
laps of the fastest car, where 65 m/s let through a time half as long.

**Assists** are one layer for every car, in three presets. They shape the driver's inputs; they never touch a car's
physics. Casual: steering lock limited to just under the front tyres' peak slip at the present speed, steering
speed that falls with road speed, counter-steer help, ABS, traction and stability control on, automatic gears,
throttle eased when the driven wheels spin. Standard (the default): the same steering limit a little looser, no
throttle easing, the car's own systems on. Pure: the wheel goes where it is put, systems as the driver sets them,
manual gears if chosen. The steering limit holds the front at its peak only while the car corners: as the rear slides
past its peak slip angle (pilot.ts `rearSlip`, from 1 to 1.5 times it) or the car turns faster than a steady corner
at its speed allows (yaw rate times speed over the tyres' friction times g, from 1 to 1.5), the side of the limit
that would push the car further round closes in to the front axle's path, so the front stops feeding a slide (held
at its peak there, a hands-off family sedan wound itself into a 55 degree slide after a keyboard lane change). In a
drift event stability and traction control are off; Standard's limit lets a slide grow 2.5 times as far before it
closes in (a drift of about half a radian holds), Casual's closes in as ever (it stops the spin); and a car that
cannot drift says so. Every preset's pedal is mapped as a drive-by-wire car maps it (`driver.ts pedalThrottle`): past
its first 5% the pedal asks for its share of the engine's full torque at its speed and boost, the closed throttle's
drag fading out over that 5%, so a light squeeze of an analog trigger drives the car. A manual driver in an
automatic or dual-clutch car follows the box when it changes up by itself at redline (its gear asked for never asks
it back down). With neither pedal down at a walk or slower (2.5 m/s) the adapter holds the car on its brakes (0.3 of
the pedal at rest, nothing at 2.5 m/s), so a stopped car stands still with no key held, as the old model's does: a
converter's creep moved an automatic on at 5 km/h for good, and the brake key held at a standstill selects reverse.
The HUD's SHIFT cue is shown only where a shift press changes gear (`driver.ts shiftCue`: not on a CVT, whose
old-model Params count six ratios, nor in Casual).

Race starts: while the runner holds the car on the line the adapter holds the brakes and the clutch and lets the
pedal set the launch revs; at the green it lets go.

## 14. Opponents on the same physics (`line.ts`, `lap.ts`, `pilot.ts`)

- `line.ts`: from a circuit's centreline and width, a racing line by minimising curvature within the track
  (an iterative relaxation, deterministic), returned with its curvature along distance. On the inside of a bend of
  the centreline the line keeps within half the bend's radius of it (`INSIDE_SHARE`): where the drawn centreline
  turns tighter than the line's room, the normals cross and a line laid further in folds into a cusp. The game lays
  a circuit's line 2 m from each edge (`opponents.ts CIRCUIT_MARGIN`): half a wide car and a metre to spare for the
  pilot's placement.
- `lap.ts`: a car's limit lap on a line: its own envelope (acceleration, braking and cornering against speed,
  measured once on the bench, with lift and downforce in it), a backward and forward pass along the line, the
  resulting speed profile and lap time. No driver in the loop: the fastest the car can go.
- `pilot.ts`: a driver for a real car on that line: steering from the line's curvature ahead plus correction of
  lateral and heading error, and a felt correction of the car's yaw rate against the one it asked for (`YAW_GAIN`);
  its lock held to the outer front tyre's peak slip, the bound toward a slide closing in to the front axle's path as
  the rear slides (`rearSlip`, the assists' rule); pedals that follow the speed profile scaled by skill and respect the
  tyres' slip.
  Skill 0.80 to 0.98 of the envelope, a reaction time and a precision, all seeded. No speed change by the gap to
  anyone: close races come from matching cars by class.
- In the game an opponent is a core car with a pilot when the switch is on. Its lap falls inside its skill band of
  its own car's limit lap and never beats it.
