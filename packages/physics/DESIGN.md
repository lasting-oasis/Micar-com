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
splitting error). Halving `h` must not move a bench figure by more than 1%.

One substep, in order:

1. **Controls to actuators.** `steerAngles` writes `wheelSteer` (both front wheels `steer * maxSteer`; rear 0).
   `autoShift` picks the gear when `controls.gear === AUTO_GEAR`.
2. **Air.** `aeroForces(model.aero, u)` gives drag and lift at each axle.
3. **Loads.** `wheelLoads` writes `wheelLoad` from the static split, lift, and the load transfer of section 4, using
   `state.ax`, `state.ay` from the previous substep.
4. **Tyres.** For each wheel, `tyreForces` turns its slip states and load into `wheelFx`, `wheelFy`, `wheelMz`
   (section 3), with the surface's grip from `world.surfaceAt`.
5. **Systems.** `brakeTorques` (pedal, handbrake, ABS, brake-force distribution), then `stabilityControl`,
   `tractionControl` and `limiter` (each returns or applies its cut).
6. **Driveline.** `drivelineStep` works out engine torque and advances `engineOmega`, `wheelOmega`, boost, clutch,
   shift and ratio (section 5).
7. **Body.** Rotate each tyre's force into the body by its steer angle (`dcos`, `dsin`). Sum forces and yaw moment
   (aligning moments included), add drag, the coast-down road load and gravity along the slope.
   `ax = sum Fx / m`, `ay = sum Fy / m`. Then `u += (ax + v r) h`, `v += (ay - u r) h`, `r += (Mz / Izz) h`
   (use the old `u`, `v`, `r` on the right-hand sides, update all three together). Turn the heading by `r h` with
   `dcos`/`dsin` and renormalise it. Move `x`, `y`. Add to `distance`.
8. **Suspension.** `suspensionStep` advances heave, pitch and roll (section 4).
9. **Tyre slip states.** With the new body and wheel speeds, advance each wheel's two deflections (section 3).
10. `time += h`.

At rest with no input the car must stay exactly at rest: see the standstill rules in sections 3 and 5.

`applyImpulse(state, jx, jy, atX, atY)`: a world-frame impulse (N s) at a world point changes `u`, `v`, `r` at once.
Collisions stay in the app.

## 3. Tyres (`tyre.ts`)

A brush model on the combined slip, with load-dependent friction and stiffness, a fall after the peak, and a lag.

**Slip states.** Each wheel has two deflections, `defX` and `defY` (m). With `Vx` the wheel centre's speed along the
wheel, `Vsx = Vx - omega * radius` (negative when driving) and `Vsy` the wheel centre's speed across the wheel:

```
defX' = -Vsx - (|Vx| / relaxLong) * defX        slipRatio = defX / relaxLong
defY' = -Vsy - (|Vx| / relaxLat)  * defY        slipTan   = defY / relaxLat
```

Integrate implicitly: `def = (def - Vs * h) / (1 + |Vx| * h / relax)`. In steady rolling this gives the usual
`slipRatio = -Vsx / |Vx|` and `slipTan = -Vsy / |Vx|`. At a standstill the deflection is a spring that holds the car.
Clamp each deflection to `relax * 3 * (slip at the peak)` so a spinning or locked wheel does not wind it up. Below
about 1.5 m/s add a damping force `-cLow * Vs` (fading out linearly by 1.5 m/s), sized to critically damp the
standstill spring against the wheel's share of the car's mass.

**Force.** With load `Fz > 0` (zero load gives zero force):

```
muY  = muY0 * (1 - loadSens * (Fz / fz0 - 1)) * grip        clamped to [0.55, 1.25] * muY0 * grip
muX  = muY * muXRatio
Ca   = cAlphaMax * 2 n / (1 + n^2),  n = Fz / fzStiffPeak,  cAlphaMax chosen so Ca(fz0) = cAlpha0
Ck   = cKappaPerFz * Fz
px   = Ck * slipRatio / (3 muX Fz)      py = Ca * slipTan / (3 muY Fz)      p = sqrt(px^2 + py^2)
g(p) = 3p - 3p^2 + p^3                                   for p <= 1   (the brush: peak 1 at p = 1, slope 0 there)
     = s + (1 - s) / (1 + slideFall * (p - 1)^2)          for p > 1    (falls smoothly to the sliding share s)
s    = slideRatio, less 0.004 for each m/s of sliding speed, never below 0.6 * slideRatio
fx   = muX * Fz * g * px / p            fy = muY * Fz * g * py / p            (p = 0 gives 0)
mz   = -trail0 * (1 - p)^3 * fy   for p < 1, else 0
use  = p
```

The first slope is the stiffness, the force never leaves the friction ellipse, and the curve is smooth where
sticking turns to sliding. `peakSlipRatio = 3 muX / cKappaPerFz` and `peakSlipTan = 3 muY Fz / Ca` (the ABS and
traction control aim near them).

**Rolling resistance** is a force `-rollRes * Fz * rolling * soft(Vx, 0.5)` along the wheel on the body, and the
matching torque on the wheel.

## 4. Chassis (`chassis.ts`)

Static load per wheel: front `m g b / (2 L)`, rear `m g a / (2 L)`. Lift takes `liftFront/2`, `liftRear/2` off each.
Drag acting at the centre-of-gravity height moves `drag * cgHeight / L` from front to rear.

**Pitch** (sprung mass on its springs; `Ktheta = 2 (kF a^2 + kR b^2)`, `Ctheta = 2 (cF a^2 + cR b^2)`):

```
anti   = antiSquat when ax > 0 and the rear is driven, antiDive when ax < 0, else 0
Iyy * pitch'' = -ms * ax * hs * (1 - anti) - Ktheta * pitch - Ctheta * pitch'
rear axle gains   dLong = [ ms * ax * hs * anti + (muF * huF + muR * huR) * ax ] / L  -  (Ktheta * pitch + Ctheta * pitch') / L
front axle loses the same.
```

At rest in the steady state this is `m ax h / L`, as statics demands (the resolver keeps `ms hs + mu hu = m h`).

**Roll** (`hRoll = hs - (rcF + (rcR - rcF) * a / L)`, `Kf = kF tF^2 / 2 + arbF`, `Cf = cF tF^2 / 2`, the same at the rear):

```
Ixx * roll'' = ms * ay * hRoll + ms * g * hRoll * roll - (Kf + Kr) * roll - (Cf + Cr) * roll'
front transfer to the right wheel  dF = [ Kf * roll + Cf * roll' ] / tF + (ms * b / L) * ay * rcF / tF + muF * ay * huF / tF
rear  transfer to the right wheel  dR = [ Kr * roll + Cr * roll' ] / tR + (ms * a / L) * ay * rcR / tR + muR * ay * huR / tR
```

**Heave:** `ms * heave'' = (liftFront + liftRear) - 2 (kF + kR) * heave - 2 (cF + cR) * heave'` (lift raises the body,
downforce lowers it). It is read by telemetry and the camera.

Wheel loads: `FL = front/2 - dF`, `FR = front/2 + dF`, `RL = rear/2 - dR`, `RR = rear/2 + dR` with the longitudinal and
aerodynamic terms already in `front` and `rear`. A load below zero becomes zero and its axle partner takes the
whole axle (a wheel can lift; the axle's sum is kept). If an axle's sum is below zero both are zero.

Integrate pitch, roll and heave semi-implicitly (rate first, with the damping term taken implicitly, then the angle).

## 5. Engine and driveline (`engine.ts`, `driveline.ts`)

### 5.1 Engine as airflow

Tables are uniform in engine speed from 0: `n` points `dOmega` apart. `buildEngine(spec)`:

1. **Target full-throttle curve** from the published peaks. Piecewise cubic Hermite through: idle (about 60% of peak
   torque for an unboosted engine, 45% for a turbocharged one), the torque peak (value `Tmax`, slope 0; a plateau
   from `torqueOmegaLow` to `torqueOmegaHigh` when the maker gives a range), the power peak (value
   `Pmax / omegaP`, slope `-T / omegaP` so that power is stationary there), and redline (torque continuing to fall:
   about 88% of the torque at the power peak, less if the power peak is far below redline). Both published peaks
   must come out within 0.5%, at their published speeds, and no other point may exceed them. An authored
   `curve` is used as given. An electric motor: flat `Tmax` up to `Pmax / Tmax`, then `Pmax / omega`, tapering
   over the last 10% of its speed range.
2. **Friction** from `fmep` (Pa) `= f0 + f1 x + f2 x^2`, `x` in thousands of rpm: torque `= fmep * displacement / (4 pi)`.
   Start with petrol `[97e3, 15e3, 5e3]`. The closed-throttle drag is this plus pumping (`35e3 Pa` more).
3. **Air model.** Pressure ratio at full boost: 1 for an unboosted engine. For a boosted one it rises from 1 at
   the boost threshold (about 45% of `torqueOmegaLow`) to `1 + boost / ambient` at `torqueOmegaLow`, holds, and tapers
   past the power peak in step with the target curve. Charge density ratio
   `dr = pr * Tamb / Tman`, `Tman = Tamb + (1 - intercooler) * Tamb * (pr^0.286 - 1) / compressorEff`.
   Then `specific[i] = (target[i] + friction[i]) / (dr[i] * (1 - blowerDrive * (pr[i]-1)/(prMax-1)))`: the engine's
   own breathing, with the boost divided out. That table is what a part multiplies.
4. `rebuildTables(e)` goes the other way and is the only writer of `wot`, `offBoost`, `friction`:
   `indicated = specific * dr(pr)`, capped so that airflow `indicated * omega / AIR_ENERGY` stays under
   `maxAirflow`, and with `pr` capped at `knockLimitPr`; `wot = indicated * (1 - blower share) - friction`;
   `offBoost = specific * 1 - friction` for a turbo engine (`wot` otherwise). `AIR_ENERGY = 1.15e6 J` of indicated
   work per kg of air. A stock engine rebuilt gives back its target curve to within rounding.

`engineTorque(e, omega, throttle, boost)`:
```
full = offBoost + boost * (wot - offBoost)                    (table lookups at omega)
T    = throttle * (full + friction) - friction - pumping * (1 - throttle)
```
Past `redline` the positive part of `T` fades to zero over `limiterBand`. Below `idle` an idle governor adds torque
`(idle - omega) * kIdle` (capped at 40% of peak) so a free engine settles at idle. Electric: no friction table to
speak of; a lifted throttle gives `-regen * Tmax * min(1, omega / omegaBase)`.

**Boost** (turbo only): target `bt = throttle^2` scaled by how far `omega` is above the threshold (0 below it, 1
by `torqueOmegaLow`). It rises as `boost += (bt - boost) * h / tau`, `tau = clamp(tauRef * omegaRef / omega, tauMin, tauMax)`
(start: `tauRef = 0.45 s` at `omegaRef = 3000 rpm`, `tauMin = 0.12`, `tauMax = 1.6`) and falls with `fallTau = 0.15 s`.

### 5.2 Driveline: speeds as constraints

Bodies: the engine (`inertia`) and four wheels. In a substep:

1. Engine torque from 5.1 (throttle after traction control and limiter; nitrous adds `power / omega`).
   `engineOmega += T h / inertia`. Each wheel: `wheelOmega += (-fx * radius - rolling resistance torque) h / J`.
2. Then solve these velocity constraints by sequential impulses, 8 passes, each with an accumulated impulse
   clamped to its limit (all deterministic arithmetic):
   - **Clutch** (launch `clutch`, or a locked converter, or `direct`): `engineOmega - G * omegaDrive = 0`, where
     `G = ratio * finalDrive` and `omegaDrive` is the weighted mean of the driven wheels (each wheel of a driven
     axle weighs `axleShare / 2`). Limit `clutchCapacity * engagement * h`. The impulse `L` takes `L / inertia` off
     the engine and gives each driven wheel `L * G * weight * eff / J` (`eff = efficiency` when the engine drives,
     `1 / efficiency` on the overrun). `direct` has no limit.
   - **Differential lock** per driven axle: `omegaLeft - omegaRight = 0`, limit
     `(preload + lockPerTorque * |axle torque|) * h`: 0 for `open`, unlimited for `locked`.
   - **Centre coupling** (`centre.kind === 'coupling'`): front axle mean speed equals rear axle mean speed, limit
     `lockTorque * h`. A `fixed` centre is just the two axle weights `frontShare` and `1 - frontShare`.
   - **Brake** per wheel: `wheelOmega = 0`, limit `wheelBrake * h`. This is what holds a locked wheel exactly locked.
3. Record `clutchTorque`, `clutchLocked`, `engineTorque`.

**Engagement.** With `autoClutch`: engagement `= clamp((engineOmega - biteOmega) / (0.25 * biteOmega), 0, 1)` where
`biteOmega = max(1.15 * idle, controls.launchOmega)` while the car is below the speed at which first gear at `biteOmega`
would be matched, and 1 above it. With the throttle closed and the car below walking pace the clutch opens.
Without `autoClutch`: `1 - controls.clutch`.

**Torque converter** (`launch === 'converter'`, unlocked): no constraint. Speed ratio `sr = turbine / engineOmega`
(turbine is `G * omegaDrive`). Pump torque `= clutchCapacityFactor * engineOmega^2 * (1 - sr)` shaped so the engine
stalls at `stallOmega` at full throttle; torque ratio falls linearly from `torqueRatio` at `sr = 0` to 1 at
`couplingRatio`. The pump torque comes off the engine, torque ratio times it goes to the wheels through `G`. It locks
(becomes the clutch constraint) from `lockGear` up once `sr > couplingRatio`.

**Shifting.** A request sets `gearNext` and `shiftTimer = shiftTime`. During the shift drive torque is multiplied by
`shiftTorqueHold` (a manual opens its clutch: 0), the ratio changes at half time, and the engine is rev-matched
toward the new gear's speed. `autoShift` shifts up at the speed where the next gear gives more wheel torque (found
from the `wot` table once at build time; never past redline) and down when the lower gear would sit below 85% of
that point; with a light throttle it shifts earlier. **CVT / eCVT:** `gears = [lowest, highest]`; `ratio` moves at up
to `cvtRatioRate` toward the ratio that puts the engine at its target speed: the power peak at full throttle, falling
toward 1.3 x idle as the throttle closes. **Single-speed:** `ratio = gears[0]`, launch `direct`.

**Standstill.** With no throttle and the brake on or off, the car must not creep or jitter: the brake constraint
holds a braked wheel; the tyre's standstill spring and low-speed damping hold the rest; an automatic's converter
creep is allowed only when the brake is off.

## 6. Brakes and the car's own systems (`brakes.ts`, `systems.ts`)

`brakeTorques`: per wheel `pedal * maxTorque` (front or rear), rear wheels add `handbrake * handbrakeTorque`.
**ABS** (when the model has it and the control leaves it on): per wheel, while `slipRatio < -1.15 * peakSlipRatio`
cut that wheel's torque quickly (toward 0 with a 0.03 s time constant); once `slipRatio > -0.75 * peakSlipRatio`
restore it (0.08 s). `absHold` carries the factor. Brake-force distribution: a rear wheel never gets more torque
than keeps its slip within the front's. A real system gives back a few percent of the ideal stop; so should this.

`tractionControl`: when a driven wheel's `slipRatio > 1.3 * peakSlipRatio`, cut the throttle (`tcsCut` toward the
value that holds slip at the peak; 0.05 s down, 0.15 s back). `stabilityControl`: target yaw rate
`r* = u * steerAngle / (L + Kus * u^2)` limited to `0.9 * muY * g / u`; when `r` strays from it by more than a
threshold, brake the outer front wheel (oversteer) or the inner rear (understeer) in proportion.
`limiter`: fade the throttle to zero over the last 1 m/s below `limiterSpeed`.

## 7. Figures in (`sheet.ts`, `classes.ts`, `resolve.ts`)

`resolveModel(sheet, build?)` returns the model and a `basis` record naming, for every model parameter (keys such as
`chassis.cgHeight`, `tyreFront.muY0`, `engine.wot`, `driveline.gears`), one of `sourced`, `derived`, `calibrated`,
`estimated`. Mass is curb weight plus a 75 kg driver. Rules:

- Weight split, wheelbase, tracks: sourced, else class tables. Centre-of-gravity height: sourced, else
  `cgHeightRatio * height` by class. `a = wheelbase * (1 - frontShare)`.
- Tyres: size gives radius (loaded radius 0.97 of the unloaded one) and width; category gives the rest
  (`TYRE_CATEGORY`); `muY0` is the category's figure times `calibration.tyreGripScale` (1 when not calibrated,
  and the scale may not leave the category's range). `fz0 = 4000 N * (width / 0.225) * (diameter / 0.66)`, kept
  between 3000 and 7500.
- Engine: peaks sourced; their speeds sourced, else by engine family. Redline sourced, else family.
- Gears: sourced; else the class's usual count and spacing with a top gear chosen for the governed speed. Final
  drive sourced, else class.
- Drag: the coast-down's `C` when on file (`dragArea = 2 C / rho`, `A` and `B` become the road load and the tyres'
  rolling resistance is set to 0); else `Cd * area`; else `calibration.dragAreaM2`; else the class's drag area.
- Springs from the class's ride frequencies, dampers from its damping ratio, anti-roll bars from its roll gradient
  and front share, inertias from its radii. All `estimated`.
- Brakes sized so that full pedal is worth 1.3 g on the car's own tyres at the class's front share.
- Systems: ABS, traction and stability control are on for any car from 2012 on unless the sheet says otherwise.

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

Suspension grade moves ride frequency and damping (`sport` x1.15 and +0.06, `adaptive` x1.10 and +0.08, `offroad`
x0.92 and 0) and roll gradient (`sport` x0.8, `adaptive` x0.75, `offroad` x1.1). Roll and pitch radii of gyration:
`0.36 * width` and `0.26 * length` for the sprung mass.

| Transmission | efficiency (two-wheel drive) | shiftTime s | shiftTorqueHold | launch |
| --- | --- | --- | --- | --- |
| manual | 0.92 | 0.30 | 0 | clutch |
| dual-clutch | 0.92 | 0.08 | 0.9 | clutch |
| automatic | 0.90 | 0.25 | 0.6 | converter (stall 2300 rpm, torque ratio 1.9, coupling 0.88, locks from 2nd) |
| cvt | 0.87 | 0 | 1 | converter (stall 2100 rpm, locks from the start of ratio change) |
| ecvt | 0.90 | 0 | 1 | direct |
| single-speed | 0.94 | 0 | 1 | direct |

All-wheel drive takes 0.04 off the efficiency. Clutch capacity: 1.6 x peak torque. Engine inertia:
`0.08 + 0.04 * litres` kg m^2 (an electric motor 0.05). Wheel inertia: `0.8 * mWheel * radius^2 + 0.1`, with
`mWheel = 8 + 55 * width * (rim inches / 17)` kg. Idle 750 rpm (650 for eight cylinders or more).
Peak power speed when not on file: 0.92 x redline unboosted, 0.85 boosted; peak torque speed 0.68 x redline unboosted,
a plateau from 0.30 to 0.65 x redline boosted. Redline when not on file: 6500 rpm (6200 for a V8, 6000 boosted
four-cylinder trucks, 5500 diesel). Brake front share: 0.70 front-drive, 0.66 rear-drive front-engine, 0.60 mid or
rear engine. `maxSteer` from the turning circle (`wheelbase / (turning radius - track / 2)`), else 0.60 rad.
Layout defaults when the weight split is not on file: front-engine front-drive 60% front, front-engine rear-drive 53%,
front-engine all-wheel drive 57%, mid-engine 41%, rear-engine 39%, pickup 57%.

## 8. The bench (`drivers.ts`, `bench.ts`, `calibrate.ts`)

`runBench(model, test = 'all')` on flat dry asphalt, the car's systems as fitted:

- **accel.** The launch driver holds the engine at a launch speed and feeds the throttle to keep the driven wheels
  near their peak slip (a traction-control-like hand on the pedal: an expert driver), shifting at a shift speed.
  It searches the launch speed (5 values from 1.3 x idle to 0.75 x redline) and the shift speed (the `autoShift`
  point and 2% and 4% either side) for the best quarter mile, as a test driver does, and reports both. Times run
  from the first movement; the timeslip and `zeroToSixtyRollout` start once the car has moved one foot. Trap speed
  is the average over the last 66 ft.
- **brake.** From 3 mph above the start speed, full pedal with ABS as fitted; distance from 60 and from 70 mph to rest.
- **skidpad.** Hold the circle with a steering controller while speed rises by 0.05 m/s each second; the figure is
  the best full-lap average of `speed^2 / radius` before the car runs 1.5 m wide. Stability control off, as testers run it.
- **topSpeed.** Flat out until acceleration falls below 0.01 m/s^2 or the limiter holds it.
- **dyno.** Peaks read off the model's `wot` table.

`calibrate(sheet)` returns a copy with `calibration` set: bisect `tyreGripScale` so the bench's skidpad (same
diameter as the test) meets `tests.skidpadG`, inside the category's range (if the range stops it, it stays at the
edge and the miss is reported); and, only when the sheet has no drag figure, no coast-down and an ungoverned top
speed, bisect `dragAreaM2` to that top speed.

`checkSheet(sheet, bench)` compares against `tests` with the plan of record's tolerances: 0-60 7% or 0.3 s; quarter
mile 4%; trap 4%; braking 7%; top speed 4% or the limiter +- 1 mph; skidpad 0.04 g (only for a car not calibrated
on it). It uses `zeroToSixtyRollout` when `tests.rollout` is true.

## 9. Proof

Unit tests beside each file; then for the whole car:

- **Invariants:** no input, energy never rises; at rest it stays at rest (60 s, position within 1 mm); mirrored
  steering gives a mirrored path; 100,000 random-input steps give no NaN and no runaway; the same input log gives
  the same `hashState`; halving the substep moves no bench figure by more than 1%.
- **Behaviour that must emerge:** in a steady corner at the limit, throttle runs a front-drive car wide and rotates a
  rear-drive car with enough torque; lifting tightens the line; the same car launches harder with all-wheel drive
  than rear drive; a higher centre of gravity lowers the skidpad figure; more rear roll stiffness moves the balance
  toward oversteer; more mass never shortens a stop or a 0-60; more power is never slower.
- **The validation table** (`scripts/validate.ts`): every sheet in `src/data/sheets.ts` with test figures, each check, pass or miss.
- **Cost:** one `step` in 20 microseconds or less.

## 10. Signatures

Fixed, so that files written side by side fit together. A file may export more; it may not change these.

```ts
// tyre.ts
export type TyreOut = { fx: number; fy: number; mz: number; use: number };
export function tyreMuY(p: TyreParams, fz: number, grip: number): number;
export function tyreMuX(p: TyreParams, fz: number, grip: number): number;
export function cornerStiffness(p: TyreParams, fz: number): number;                       // N/rad at this load
export function peakSlipRatio(p: TyreParams, fz: number, grip: number): number;
export function peakSlipTan(p: TyreParams, fz: number, grip: number): number;
export function tyreForces(p: TyreParams, fz: number, slipRatio: number, slipTan: number, slideSpeed: number, grip: number, out: TyreOut): void;
export function relaxStep(def: number, slipVel: number, rollSpeed: number, relax: number, maxDef: number, h: number): number; // the new deflection
export function lowSpeedDamping(p: TyreParams, fz: number, cornerMass: number): number;   // N per m/s of slip speed at a standstill

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
export function buildEngine(spec: EngineSpec): EngineModel;
export function rebuildTables(e: EngineModel): void;
export function engineTorque(e: EngineModel, omega: number, throttle: number, boost: number): number;   // brake torque, N m
export function boostStep(e: EngineModel, boost: number, omega: number, throttle: number, h: number): number;  // the new boost state
export function enginePeaks(e: EngineModel): { power: number; powerOmega: number; torque: number; torqueOmega: number };

// aero.ts
export type AeroOut = { drag: number; liftFront: number; liftRear: number };   // drag: N along body x, negative when moving forward. lift: N upward at each axle
export function aeroForces(a: AeroModel, u: number, out: AeroOut): void;

// chassis.ts
export function staticLoads(c: ChassisModel, out: Float64Array): void;       // the four wheel loads at rest, N
export function steerAngles(s: VehicleState, steer: number): void;           // writes s.wheelSteer
export function wheelLoads(s: VehicleState, air: AeroOut): void;             // writes s.wheelLoad
export function suspensionStep(s: VehicleState, air: AeroOut, h: number): void;   // advances heave, pitch, roll

// brakes.ts   (grip: the surface grip under each wheel, length 4)
export function brakeTorques(s: VehicleState, c: Controls, grip: Float64Array, h: number): void;   // writes s.wheelBrake, s.absActive, s.absHold

// systems.ts
export function prepareShiftPoints(model: VehicleModel): void;               // once per model, outside the step
export function shiftUpOmega(model: VehicleModel, gear: number): number;     // engine speed to shift up from this gear at full throttle
export function autoShift(s: VehicleState, c: Controls): number;             // the gear wanted
export function tractionControl(s: VehicleState, c: Controls, grip: Float64Array, h: number): number;   // throttle multiplier, 0 to 1
export function stabilityControl(s: VehicleState, c: Controls, grip: Float64Array, h: number): void;    // adds to s.wheelBrake
export function limiterCut(s: VehicleState): number;                         // throttle multiplier, 0 to 1

// driveline.ts   (throttle: after traction control and the limiter)
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

// sheet.ts
export type ResearchField = { key: string; number?: number; numbers?: number[]; text?: string; publisher?: string; url?: string; sourceKind?: string; note?: string; check?: string };
export type ResearchRecord = { id: string; year: number; make: string; model: string; trim: string; bodyClass: string; gathered?: string; fields: ResearchField[] };
export function emptySheet(id: string, identity: PhysicsSheet['identity']): PhysicsSheet;
export function sheetFromResearch(record: ResearchRecord): PhysicsSheet;
export type TableRow = { make: string; model: string; bodyClass: BodyClass; engine: string; hp: number; weightLb: number; zeroToSixty: number; topSpeedMph: number; drive: Drivetrain };
export function sheetFromTable(row: TableRow): PhysicsSheet;                 // an estimated sheet from a game table's six figures; 0-60 goes to tests only
export type AuthoredSpec = { id: string; name: string; drive: 'FWD' | 'RWD' | 'AWD'; mass: number; a: number; b: number; h: number; cd: number; area: number; redline: number; r: number; fin: number; gears: number[]; tq: [number, number][] };
export function sheetFromAuthored(spec: AuthoredSpec, bodyClass: BodyClass): PhysicsSheet;   // a drawn (fictional) car, one to one

// resolve.ts
export function resolveModel(sheet: PhysicsSheet, build?: Build): { model: VehicleModel; basis: Record<string, Basis> };

// bench.ts, calibrate.ts
export function runBench(model: VehicleModel, test?: BenchTest): BenchResult;
export function calibrate(sheet: PhysicsSheet): PhysicsSheet;
export type Check = { name: string; unit: string; real: number; model: number; error: number; tolerance: number; pass: boolean };
export function checkSheet(sheet: PhysicsSheet, bench: BenchResult): Check[];
```

`createState`, `defaultControls`, `createTelemetry`, `FLAT` and `createSurfaceSample` are in `state.ts`. `fixtures.ts`
builds a plain car by hand for tests.

## 11. Parts and builds (`parts.ts`)

A part changes physical numbers and its cost follows. There is one catalogue, in physical units, for the world's
Garage and (through section 12) for the card. Nothing in it is a percentage of performance: a part changes a
pressure, a flow, a mass, a stiffness, a friction, and the bench shows what that is worth on the car it is fitted to.

`resolveModel(sheet, build)`: resolve the stock pieces (the exported steps of `resolve.ts`), let each fitted part
change them **in the catalogue's fixed order** (never the order the player bought them in), apply `build.setup`
within what the fitted parts allow, call `rebuildTables` on the engine, then re-derive what depends on what changed
(mass and its split, inertias, centre-of-gravity heights, the brake sizing only when a brake part says so).
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

Every number in that table is `estimated` until the parts exam (`data/exam/*.json`) says otherwise: `parts.test.ts`
runs each exam page that has enough physical detail and asserts the predicted change is within the exam's scatter
(peak power and torque within 5% of the measured figure after the change; quarter-mile time and trap speed within
4%; skidpad within 0.04 g; a braking distance within 7%). A part that cannot meet its exam is fixed in its physics
or reported. It is never given a per-car factor.

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
0-60 with rollout (s), top speed (mph), skidpad on 300 ft (g), 60-0 (ft), quarter mile (s, mph).

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
specification: one rating for the card and the road.

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
through its researched sheet (`world-<make>-<model>`) when there is one, else `sheetFromTable`; then
`resolveModel(sheet, legacyBuild(perf, tune, sheet))`, cached per car and build.

**Assists** are one layer for every car, in three presets. They shape the driver's inputs; they never touch a car's
physics. Casual: steering lock limited to just under the front tyres' peak slip at the present speed, steering
speed that falls with road speed, counter-steer help, ABS, traction and stability control on, automatic gears,
throttle eased when the driven wheels spin. Standard (the default): the same steering limit a little looser, no
throttle easing, the car's own systems on. Pure: the wheel goes where it is put, systems as the driver sets them,
manual gears if chosen. In a drift event stability and traction control are off, and a car that cannot drift says so.

Race starts: while the runner holds the car on the line the adapter holds the brakes and the clutch and lets the
pedal set the launch revs; at the green it lets go.

## 14. Opponents on the same physics (`line.ts`, `lap.ts`, `pilot.ts`)

- `line.ts`: from a circuit's centreline and width, a racing line by minimising curvature within the track
  (an iterative relaxation, deterministic), returned with its curvature along distance.
- `lap.ts`: a car's limit lap on a line: its own envelope (acceleration, braking and cornering against speed,
  measured once on the bench, with lift and downforce in it), a backward and forward pass along the line, the
  resulting speed profile and lap time. No driver in the loop: the fastest the car can go.
- `pilot.ts`: a driver for a real car on that line: steering from the line's curvature ahead plus correction of
  lateral and heading error; pedals that follow the speed profile scaled by skill and respect the tyres' slip.
  Skill 0.80 to 0.98 of the envelope, a reaction time and a precision, all seeded. No speed change by the gap to
  anyone: close races come from matching cars by class.
- In the game an opponent is a core car with a pilot when the switch is on. Its lap falls inside its skill band of
  its own car's limit lap and never beats it.
