# MiCar physics core: design and roadmap

Date: 2026-11-11. Status: proposed, waiting for the owner's go.

## 1. What this is

One driving and racing physics engine for all of MiCar, built by us.

**The rule: real figures about a car go in; how it launches, turns, stops and wears comes out.** No car is tuned by hand, and no figure is bent to hit a result. Published test results are the exam, not the answer key.

The same engine drives the car the player steers, the AI they race, and later the card races.

Target feel: Gran Turismo's honesty about cars and tuning, Forza Horizon's approachability, GTA's sense of weight. Phone and desktop count equally.

## 2. Where today's model stands

Measured on 2026-11-11 with the game's own model: stock cars, flat out from rest, at the game's 120 Hz step. "Real" is MiCar World's own car table (`apps/sim/src/carSpecs.ts`), which is unverified reference data.

| Car | 0–60 mph, real | 0–60 mph, game | Quarter mile, game |
| --- | --- | --- | --- |
| Chevrolet Corvette | 3.0 s | 5.1 s | 12.9 s at 122 mph |
| BMW M4 | 3.8 s | 5.8 s | 13.9 s at 111 mph |
| Ford Mustang | 4.3 s | 5.8 s | 13.9 s at 111 mph |
| Honda Odyssey | 7.2 s | 9.1 s | 16.9 s at 91 mph |
| Honda Civic | 8.2 s | 7.9 s | 16.3 s at 95 mph |

- Fast rear-drive cars are 1.5 to 2 seconds slow to 60. The Mustang and the M4 come out as the same car.
- To reach a real 0–60 the model bends the car's power: a BMW 3 Series is given 370 hp for its real 255, a Civic 207 for 158, a Tacoma 242 for 278.
- Every sedan corners at 1.02 g (a family sedan manages about 0.85). Every car has six gears. A pickup tops out about 20 mph above its limiter.
- Upgrades are flat percentages with no downside.
- AI cars are not on the physics: fixed acceleration, sped up or slowed down by their gap to the player.
- The card engine's seven attributes and the driving model are not connected.

What the current model already does, and we keep: a fixed 120 Hz step, weight moving front to back, a tyre curve, one grip budget shared by throttle and steering, turbo lag, air drag.

Stage 0 re-creates this table in a harness, so every later stage is measured against it.

## 3. Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Buy or build | Build `@micar/physics`: plain TypeScript, no dependencies | It must run in a browser, on a phone and on the server. BeamNG, iRacing and Assetto Corsa cannot be licensed into a web game, and a general physics library still leaves the tyres and driveline to us |
| 2 | Body | A rigid body on a flat road. It slides and yaws in the plane, and heaves, pitches and rolls on its springs. Four wheels, each with its own spin and its own load | Dive, squat, roll and a lifted inside wheel become real. That is where the sense of weight comes from. The world is flat today; hills are a later stage that reuses everything else |
| 3 | Tyres | The brush model at each wheel: one grip budget shared by accelerating, braking and cornering; grip that grows more slowly than load; a peak and then a slide; a short lag at low speed | It is derived from two things we can estimate for any tyre (stiffness and friction), not from dozens of fitted coefficients nobody publishes |
| 4 | Driveline | An engine with inertia and engine braking, boost that builds, a clutch, gearboxes by type, three differentials by type, a brake at each wheel | Wheelspin, lock-up, lift-off oversteer and power oversteer then need no special cases |
| 5 | Rates | 120 Hz for the body, as now. 480 Hz for wheels, tyres and driveline | Stable at a standstill and at 200 mph, and cheap enough for a phone |
| 6 | Same result everywhere | The core uses only arithmetic that every browser and the server compute identically, a fixed step, and a seeded random source | Replays, ghosts, server re-runs, and tests that mean the same on every machine |
| 7 | Car data | Every number is sourced, derived, calibrated or a class estimate, and says which. Estimates lean unfavourable | A real figure always helps and a blank never beats a figure, which is the card engine's own rule |
| 8 | What may be fitted to tests | Only tyre grip (from the skidpad figure), and drag when no figure exists. Never power, weight or gearing | 0–60, the quarter mile, braking and top speed are predictions we check |
| 9 | Driver aids | ABS, traction control and stability control are the car's own systems: on as in the real car, and switchable. Help for keys and thumbs is one layer, the same for every car | Approachable without changing any car's character |
| 10 | AI | The same physics with a driver model. Its speed comes from its car's limits; its skill is how near the limit it drives. No rubber band | Opponents are exactly as fast as their cars |
| 11 | Tuning | A part changes physical numbers and its trade-offs follow | Replaces flat percentages |
| 12 | Rollout | The new core sits beside the old one behind a switch. The default flips one area at a time, after the gates pass and the owner signs off the feel | The live game is never broken |
| 13 | Damage | Mechanical wear and failure, not bending metal | Soft-body deformation is too heavy for a phone |

## 4. Architecture

```
published figures ─► physics sheet ─► resolve ─► vehicle model ─► core step (120 / 480 Hz)
(maker, EPA, NHTSA,   (every value     (sourced, derived,              │
 measured tests)       has a source)    calibrated, estimated)         ├─► live driving  (player input + assists)
                                                                       ├─► AI drivers    (same step + driver model)
                                                                       ├─► bench         (0–60, quarter mile, braking,
                                                                       │                  skidpad, top speed, economy)
                                                                       └─► card races    (headless, seeded; stage 6)
```

`packages/physics/src`, one responsibility per file:

| Files | Job |
| --- | --- |
| `math` | Deterministic helpers and the seeded random source |
| `sheet`, `classes`, `resolve` | Figures in: the sheet's fields, the class tables (the only place a "typical" value lives), and the resolver that turns a sheet into a model and records the basis of every parameter |
| `tyre`, `chassis`, `powertrain`, `brakes`, `aero`, `surface` | The model |
| `systems` | The car's own electronics: ABS, traction control, stability control, shift logic, limiter |
| `vehicle` | State, the step, telemetry, the state hash |
| `drivers`, `bench` | Reference drivers (launch, braking, path following) and the standard tests |

In `apps/sim`: a facade so the HUD, audio, cameras, events and the Garage read the same fields from either model; the input assists; the feedback layer.

Dependencies run one way. `@micar/physics` depends on nothing. `@micar/engine` may read it from stage 6. The apps read both.

Interface (names fixed here; bodies belong to each stage's plan):

```ts
resolveModel(sheet: PhysicsSheet, build?: Build): { model: VehicleModel; basis: Record<string, Basis> }
createVehicle(model: VehicleModel): VehicleState                 // allocates once
step(state: VehicleState, controls: Controls, world: WorldQuery): void   // one 120 Hz step
telemetry(state: VehicleState, out: Telemetry): void
applyImpulse(state: VehicleState, jx: number, jz: number, atX: number, atZ: number): void
hashState(state: VehicleState): number
runBench(model: VehicleModel, test: BenchTest): BenchResult
type Basis = 'sourced' | 'derived' | 'calibrated' | 'estimated'
```

- `Controls`: steer −1..1 of full lock; throttle, brake, clutch, handbrake 0..1; a gear request; each system on or off; nitrous.
- `Telemetry`: speed, accelerations in g, yaw rate, body roll, pitch and heave; for each wheel its load, slip, spin and temperature; rpm, gear, boost, clutch slip; brake temperatures; which systems are acting; fuel used.
- SI units inside the core. Sheets keep published units and convert once, in the resolver.

## 5. The model

### 5.1 Chassis

- State: position, heading (kept as a unit vector), forward and sideways speed, yaw rate; heave, pitch and roll with their rates.
- Mass is curb weight plus a 75 kg driver plus fuel. Sprung share and the three inertias come from mass and dimensions through class tables.
- Each corner has a spring and a damper (from a ride frequency and damping ratio per class and suspension grade). Front and rear anti-roll bars: their split sets the handling balance. Roll-centre heights and anti-dive and anti-squat set how much load moves at once and how much through the springs.
- A wheel's load is its suspension force plus the geometric part, never below zero: a wheel can lift.
- Ground comes from `WorldQuery.surfaceAt(x, z)`: height and surface. Stage 1 answers flat asphalt everywhere.
- Collisions stay in the app as today. The core accepts an impulse.

### 5.2 Tyres

Evaluated for each wheel in every 480 Hz substep.

- In: load, the contact patch's velocity in the wheel's frame, wheel spin, surface.
- Slip is two states per wheel, each with a relaxation length: force builds over distance rolled, and at a standstill the tyre behaves as a spring that holds the car. Low-speed damping stops it ringing.
- Force comes from the brush model on the combined slip vector, with a peak friction and a lower sliding friction that falls with sliding speed. Stiffness and friction both depend on load.
- Out: longitudinal force, lateral force, self-aligning moment (it fades to nothing at the limit, which is what a driver feels through the steering), and slip power (for heat, smoke and sound).
- Parameters: the tyre's size gives its radius and stiffness class; its category (all-season, summer, max-performance, track, all-terrain, winter, drag) gives peak and sliding friction, load sensitivity and relaxation lengths. One grip scale per car may be calibrated (section 7).
- It sits behind a `TyreModel` interface, so a tyre with real test data can bring its own model.
- Shape tests: the first slope equals the stiffness; the peak slip angle and peak slip ratio fall inside the category's range; past the peak, force settles at sliding friction; combined force never leaves the friction ellipse; the curve is smooth where sticking turns to sliding.

### 5.3 Powertrain

- **Engine.** The torque curve is built from the published peaks (power and its rpm, torque and its rpm, redline) with a shape per kind: naturally aspirated, turbocharged, supercharged, diesel, electric. It must reproduce both peaks within 0.5%. Rotating inertia by cylinders and displacement, so low gears accelerate the engine as well as the car. Closed-throttle torque from displacement: a bigger engine brakes harder. Rev limiter and idle.
- **Boost** is a state. It builds with exhaust flow, slowly at low rpm and light throttle, toward a target that starts at the published torque-peak rpm. Off boost the engine is its unboosted self.
- **Hybrid and electric.** One-speed drive with a system torque and power curve; regeneration on lift and under braking.
- **Clutch or launch device.** A coupling with a torque limit; stall behaviour for automatics. Auto-clutch by default.
- **Gearbox.** Ratios sourced, or derived from the EPA's axle ratio, engine speed per mph and gear count. Shift time and torque hand-over by type: manual, dual-clutch, automatic, CVT.
- **Differentials.** Front, centre and rear; each open, limited-slip (preload and ramp), locked or active. All-wheel-drive systems are centre couplings: fixed split, on-demand front-biased, rear-biased active.
- **Losses.** An efficiency per stage by type. The published figure is at the crank.
- Engine, clutch, gearbox, differentials and wheels are solved together in each substep as speed constraints with torque limits, so a locked clutch is exact and a slipping one is limited.

### 5.4 Brakes

Torque at each wheel from the pedal, the brake grade's capacity and the bias. Lock-up is what the wheel does next. The handbrake acts on the rear wheels. Heat and fade arrive in stage 5.

### 5.5 Resistance and aerodynamics

- Where the EPA's dynamometer coefficients are on file (`F = A + B·v + C·v²`, measured by coast-down), `A` and `B` are the rolling and driveline part and `C` is the air.
- Otherwise drag coefficient and frontal area, sourced or by class, with rolling resistance by tyre category.
- Lift or downforce, front and rear, by class; parts change them in stage 3. Air density is fixed at sea level.

### 5.6 The car's own systems

ABS (slip control at each wheel), brake-force distribution, traction control, stability control (a yaw target from steering and speed, corrected by braking one wheel), launch control where fitted, the speed limiter at the governed speed, and automatic shift logic by throttle and speed. Fitted by model year and trim, on by default, each switchable.

### 5.7 Numerical method

- Fixed 120 Hz. Inside each step, four substeps for tyres, wheels and driveline.
- Semi-implicit updates; implicit for the stiff parts (slip states and couplings).
- No allocation inside the step.
- No `Math.sin`, `cos`, `tan`, `atan`, `exp`, `pow`, `hypot` or `random` inside the core. Heading is a unit vector, steering uses a polynomial sine and cosine, everything else uses rational functions. Add, multiply, divide and square root give the same bits everywhere.
- Halving the substep must not move any benchmark by more than 1%.

## 6. Car data

| Parameter | First choice | Then |
| --- | --- | --- |
| Curb weight, wheelbase, track widths, front and rear weight split, overall size | Maker's specification | NHTSA vPIC "Canadian Vehicle Specifications" (free API: all of these), then class |
| Power and torque with their rpm, redline | Maker | Class shape from displacement and induction |
| Displacement, cylinders, induction, transmission type and gear count, drive | EPA fuel-economy file (already in the repo's pipeline) | Maker |
| Gear ratios and final drive | Maker | Derived from the EPA test-car list (axle ratio, engine speed per mph, gear count), then class spacing |
| Road load | EPA test-car list (target coefficients A, B, C; test weight) | Maker's drag coefficient and frontal area, then class |
| Tyre sizes and category | Maker, by trim | Class |
| Steering ratio; turning circle (gives the maximum steering angle with the wheelbase) | Maker | Class |
| Centre-of-gravity height | Derived from published rollover-resistance data where a model has it (to be confirmed in stage 0) | Class, from overall height |
| Spring and damper rates, roll-stiffness split, roll centres, inertias | Class and suspension grade: nobody publishes them | |
| 0–60, quarter mile, braking, skidpad, top speed | Independent instrumented tests (source kind `test`) | Used only as checks and for tyre-grip calibration, never as inputs |

- A sheet extends the card engine's specification with the fields above. Every value keeps its source, in the same six kinds the card engine uses.
- A 0–60 figure records whether it uses the one-foot rollout. The bench reports both.
- Agency files are fetched by a scheduled GitHub Action, as the EPA list already is (`epa.yml`), not from the coding sandbox.
- **The validation sixteen.** The three catalogue cars (GT-R NISMO, Civic LX, Prius LE) and the thirteen already researched and waiting in `packages/engine/data/research/pending/`: Tacoma TRD Off-Road, Wrangler Rubicon, F-150 Raptor, Tesla Model 3 Long Range, Corvette Stingray Z51, Mustang GT, MX-5 Miata Club, Camry LE, Outback Premium, RAV4 XLE, 911 Carrera, Odyssey EX-L, Golf GTI S. Between them: front, rear, all-wheel and four-wheel drive; unboosted, turbo, hybrid and electric; front, mid and rear engine; from a light roadster to a heavy pickup.
- The world's 48-car table drives on estimated sheets built from the six figures each row has, marked unvalidated. A world car uses its model's validated sheet when one exists. The five rental cars convert one to one from their authored specs (illustrative).
- A car is **validated** when it passes section 7. Ranked play (stage 6) takes validated cars only, as the card engine already requires a trusted specification.

## 7. Proof

**Calibrate little, predict the rest.** A car's tyre grip scale is set from its skidpad figure, inside its tyre category's range. Drag area may be set from an ungoverned top speed when no road-load or drag figure exists. Nothing else may be fitted to a test.

Then, for each car, stock, against independent test figures:

| Check | Must be within |
| --- | --- |
| 0–60 mph | 7%, or 0.3 s if larger |
| Quarter-mile time | 4% |
| Quarter-mile trap speed | 4% |
| Braking distance, 60–0 or 70–0 mph | 7% |
| Top speed | 4%; a governed car, its limiter ± 1 mph |
| Skidpad, for a car not calibrated on it | 0.04 g |
| EPA combined economy (stage 5) | 8% |

Across validated cars: median error at most 4% on 0–60 and 3% on quarter-mile time. Any two cars more than 10% apart on a published figure are ordered the same way by the core.

The bench driver searches launch rpm and shift points for its best run, as a test driver does, and reports what it used. Drag runs produce a real timeslip: reaction, 60 ft, 330 ft, eighth mile and speed, 1000 ft, quarter mile and trap speed.

**Invariants, for every car.**
- With no input, energy never rises. At rest on flat ground the car stays at rest.
- Mirrored steering gives a mirrored path.
- The same inputs give the same state hash in Chromium, Firefox, WebKit and Node.
- 100,000 steps of random inputs produce no NaN and no runaway speed.

**Behaviour that must emerge, not be coded.**
- In a steady corner at the limit, adding throttle runs a front-drive car wide and rotates a rear-drive car with enough torque.
- Lifting off mid-corner tightens the line.
- The same car launches harder with all-wheel drive than with rear drive.
- A higher centre of gravity lowers skidpad grip. More rear roll stiffness moves the balance toward oversteer.
- More mass never shortens a stop or a 0–60. More power is never slower.

**Cost.** One car's step takes at most 20 µs on the CI machine. Eight cars fit the frame budget on a mid-range phone (measured on a device in stage 2).

## 8. Feel and assists

Outside the core, fed by telemetry, the same for every car:

- **Input.** Keys, pad and touch pass through one assist layer: steering speed and lock that follow road speed and stop short of the front tyres' peak, return to centre from the tyres' own aligning moment, smoothed pedals, optional counter-steer help, automatic or manual shifting. Presets: Casual, Standard (default), Pure.
- **Feedback.** Camera (field of view with speed, lag with g, look into the corner); engine sound from rpm and load; tyre noise from slip past the peak; wheels that visibly spin and lock; smoke and skid marks from slip power; body roll, dive and squat straight from the suspension; pad rumble where the browser offers it.
- **Dev overlay.** A toggle showing the grip circle, each wheel's load and slip, and the benchmark table for the car being driven. It is how feel gets tuned with evidence.

## 9. AI and racing (stage 4)

- An AI car runs the same `step` with a driver: a speed profile along its line from its own car's measured limits (cornering, accelerating, braking against speed), a steering controller, and pedals that respect slip.
- Skill is the share of the limit it uses (about 80% to 98%), its reaction time and its precision, all seeded.
- No rubber band. Close races come from matching cars by class.
- Slipstream is a wake behind each car that lowers drag for the car in it. Contact between cars uses their masses.
- Traffic stays simple. It is scenery.

## 10. Rollout

- A switch (`?physics=core`, and "New driving (beta)" in the Garage's Options) picks the model for the session. The old model stays selectable until stage 3 is signed off, then it is removed.
- A facade keeps every file that reads the old `Vehicle` (HUD, audio, cameras, events, AI, the Garage, the server's payout rules) working unchanged.
- The server's time limits are re-checked against the fastest allowed car before each default flips, and derived from the core in stage 3.

**What players will notice when the default flips.**
- Fast cars get faster. Ordinary cars corner at realistic limits, which is less grip than today.
- Cars differ by layout. A Mustang and an M4 stop being the same car.
- "Perfect shift" stays as a call-out and a score. Its hidden 10% torque bonus goes: a well-timed shift is its own reward.
- In drift events rear-drive cars drift and front-drive cars do not. The event says so and offers a rear-drive rental.
- Today's parts carry over with the same percentages in stage 2. Stage 3 makes them real.
- Lowrider hydraulics and nitrous work as they do now until stage 3.

## 11. Stages

Each stage ships on its own and has its own implementation plan.

| Stage | Built | Noticed by players | Gate |
| --- | --- | --- | --- |
| **0. Measure and scaffold** | Package skeleton; deterministic maths; sheets and resolver for the three catalogue cars and the five rental cars; a bench that also runs today's model; the scheduled fetch of the two agency files; the facade and the switch, with the old model still the only one that drives | Nothing | Baseline table committed; one state hash across four runtimes; every existing test green |
| **1. The core** | Chassis, tyres, powertrain, brakes with ABS, drag and limiter; sheets for the sixteen | "New driving (beta)": free roam and the drag strip on the new core | Section 7 on at least ten of the sixteen: 80% pass every check and none misses by more than twice its tolerance. Invariants, behaviour tests and step cost pass |
| **2. Feel** | Traction and stability control; the assist layer; camera, sound, smoke, skids, wheel spin, body motion, rumble; drag timeslip; today's parts carried over | The Strip drives on the new core by default | The owner drives it on a phone and a desktop and signs off. Server limits re-checked. Frame budget on a mid-range phone |
| **3. Real tuning** | Parts and setup as physical changes with trade-offs: alignment, springs, bars, ride height, differential, gearing, aero, boost, nitrous, tyres, weight, brakes. The Garage shows a simulated dyno and test results before and after. Saved builds migrated. Town driving switches over. Old model removed | Tuning that behaves like tuning | Every part states its cost. Saved builds migrate in a test. Server limits derived from the core |
| **4. Racing** | AI on the same physics with skill levels; slipstream; contact by mass | Opponents that drive like their cars | An AI lap lands inside its skill band of the car's limit lap. Eight cars inside the frame budget |
| **5. Depth** | Tyre temperature, wear and pressure; brake heat and fade; fuel and energy use; mechanical stress and failure; wet, dirt and gravel; full automatic, CVT and hybrid behaviour | Endurance, economy and off-road events; a burnout that warms the tyres | Economy within 8% of the EPA figure. Fade, wear and off-road tests |
| **6. One truth** | Card races run on the core, seeded and replayable in 3D. The server re-runs a human run from its input log, drag first. The card engine's modification effects read simulated changes (ruleset v2) | Cards and driving cannot disagree; ghosts | Card-race order agrees with today's formula on the catalogue before the switch. The owner approves the ruleset change |

Data runs alongside: the sixteen (stages 0 and 1), then the 48 in the world table (stages 2 and 3), then EPA-wide by script (stage 4 onward).

Not scheduled: hills and banking (elevation on the road plane), track rubber and weather, and a full 3D body if jumps or rollovers are ever wanted.

## 12. Detail ledger

Every detail has a home and a proof. Nothing is added outside this list without adding a row.

| Detail | Modelled by | Stage |
| --- | --- | --- |
| Grip shared between pedals and steering | Brush model on combined slip | 1 |
| Grip grows more slowly than load | Load-sensitive friction and stiffness | 1 |
| Breakaway, then a slide with less grip | Peak and sliding friction | 1 |
| Tyre lag at low speed; holding still | Relaxation lengths | 1 |
| Dive, squat, roll, a lifted wheel | Sprung body, bars, roll centres | 1 |
| Wheelspin, lock-up, burnouts | Wheel spin as a state | 1 |
| Slower in low gears than power alone says | Engine and wheel inertia | 1 |
| Engine braking | Closed-throttle torque from displacement | 1 |
| Turbo lag and boost threshold | Boost state | 1 |
| Launch, clutch slip, stall | Torque-limited coupling | 1 |
| Open, limited-slip and locked differentials; AWD kinds | Typed couplings | 1 |
| ABS, the speed limiter | The car's own systems | 1 |
| Air drag from a measured coast-down | EPA coefficients | 1 |
| Traction and stability control | The car's own systems | 2 |
| Steering weight and self-centring | Self-aligning moment | 2 |
| Timeslip: reaction, rollout, 60 ft, eighth, quarter, trap | Bench timing | 2 |
| Camera, sound, smoke, skids, rumble | Telemetry-driven feedback | 2 |
| Camber and toe; springs, dampers, bars, ride height | Setup parameters | 3 |
| Downforce and its drag | Aero parts | 3 |
| Nitrous as a bottle that fades; supercharger; boost control | Powertrain parts | 3 |
| Hydraulics as real ride-height actuators | Suspension targets | 3 |
| AI on the same physics; slipstream; contact by mass | Driver model; wake; impulses | 4 |
| Tyre temperature, wear and pressure | Thermal and wear states | 5 |
| Brake heat and fade | Thermal state | 5 |
| Fuel and energy use; the car getting lighter | Efficiency map checked against the EPA figure | 5 |
| Over-rev, overheating, clutch abuse | Stress that accumulates | 5 |
| Wet, dirt, gravel, grass, kerbs | Surface table | 5 |
| Torque converter, CVT ratio control, power-split hybrid | Full transmission models | 5 |
| Replays, ghosts, server re-runs | Input log and state hash | 6 |

**Not modelled, and said so:** bending metal; chassis flex; tyre carcass flex and flat spots; suspension geometry beyond roll centres and anti-dive; torque steer; aero that changes with ride height or yaw; hills, banking, jumps and rollovers; weather; altitude and air temperature.

## 13. Risks

| Risk | Answer |
| --- | --- |
| Real inputs do not reproduce real results | Stage 1's gate. If it fails, stop and report the error table. Inputs are not bent to pass |
| Jitter or instability at low speed | The transient tyre model, the standstill invariant, the step-halving test |
| Too heavy for a phone | Step-cost gate in CI and a device measurement in stage 2 |
| Data is thin for hundreds of cars | Four bases shown for every parameter; unvalidated cars are labelled and kept out of ranked play |
| Players prefer the old feel | The switch, three assist presets, and the owner's sign-off before any default flips |
| Scope grows | The detail ledger and the not-modelled list. One stage per session |
| Cars get faster than the server's limits allow | Limits re-checked before each flip, derived from the core in stage 3 |
| The card engine's numbers drift from the driving | Attributes keep reading published figures, which the core must reproduce. Simulated modification effects wait for stage 6 and the owner's approval |

## 14. Working rules for whoever builds a stage

1. One stage per session. Start by writing that stage's implementation plan from this document. Build nothing outside the stage.
2. The benchmark table is the judge. Every pull request pastes it, before and after.
3. One review round and one fix wave per stage. Another round only for a failed gate.
4. No dependency is added or upgraded. The card engine's rules and grades are untouched until stage 6.
5. The old model stays selectable until stage 3 is signed off.
6. If a gate cannot be met with real inputs, stop and report. Do not bend an input.

## 15. Sources checked for this plan

- EPA test-car list field definitions (rated horsepower, test weight, axle ratio, engine speed per mph at 50 mph, dynamometer target coefficients): https://19january2021snapshot.epa.gov/sites/static/files/2016-07/documents/test-car-list-definitions.pdf
- NHTSA vPIC API, "Get Canadian vehicle specifications" (wheelbase, track widths, curb weight, weight distribution, overall size; 1971 onward): https://vpic.nhtsa.dot.gov/api/
- Transport Canada, Canadian Vehicle Specifications dataset (Open Government Licence – Canada): https://open.canada.ca/data/en/dataset/913f8940-036a-45f2-a5f2-19bde76c1252
