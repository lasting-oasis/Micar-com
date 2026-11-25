# Validation against real cars

The plan of record's validation (DESIGN.md sections 8 and 9): every researched sheet in `src/data/sheets.ts` with
test figures that are a check of its own configuration is calibrated (tyre grip scale to its skidpad; drag area to an
ungoverned top speed when it has no drag figure), resolved, run on the bench and checked at section 8's tolerances.

Reproduce, from the repository root:

```
pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/build-sheets.ts
pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/validate.ts
```

Run on 2026-11-25 against the sixteen records in `data/research`. Only second-read test figures are checks: a test
figure with no check mark (16 of them, added after the second reads) is set apart, as the parts exam treats such a
figure. Each car's tests are run on the car as tested: where the tests carry the tested car's scale weight, that is its
curb weight for the run (`calibrate.ts asTested`). Every figure below is what those two commands print; nothing was
calibrated but the two figures above and no tolerance was moved.

## Verdict

**The gate is not passed**, and with the research on file it cannot be: only 7 of the 16 cars carry a second-read test
that is a check of their own configuration, and only 1 of them (the Corvette) has 5 or more checks (the gate needs
10). Of the 7, one (the Golf GTI 380 S) passes every check. Fleet medians: 0-60 17.2% (limit 4%), quarter mile 3.5%
(limit 3%), both pulled up by cars with a missing key input (below). Eight ordering inversions, every one of them the
Tesla, whose sheet has no power figure.

```
Gate: 1 car(s) with 5+ checks (need 10); 0 pass every check (need 8); 0 miss(es) by more than 2x tolerance;
medians not within their limits; 8 ordering inversion(s). NOT PASSED.
```

The F-150 Raptor has left the table: none of its test figures was second-read (they came in a later pass, "Instrumented
tests added", after the second reads), and nor were the Tacoma's 70-0 and skidpad. Before those were set apart and the
test weights used, the same script printed 8 cars, 3 with 5+ checks, medians 15.2% and 5.3%, and 9 inversions; the
Raptor's four acceleration and top-speed misses (the gate's one miss past 2x) were a truck run at the pickup class's
blank 5,071 lb against a 5,947 lb test truck, on figures nobody second-read.

Before this work the same script printed 13 cars, 49 checks (21 pass, 28 miss), 0 cars passing every check, medians
13.8% and 4.5%, 18 inversions, 5 cars with 5+ checks. Most of the difference is like with like (31 test figures are
not checks of their sheet's configuration and are now listed apart); the core fixes below moved the table little,
because the validated cars' best launches did not hunt and the full-throttle curves are pinned to the published peaks.

## The table

```
car                                  check                                       real     model     error      tol  x tol  result
---------------------------------------------------------------------------------------------------------------------------------
2024-chevrolet-corvette-stingray-z51 0-60 mph (rollout) (s)                      2.80      3.31     +0.51     0.30   1.70  MISS
2024-chevrolet-corvette-stingray-z51 quarter mile (s)                           11.20     11.45     +0.25     0.45   0.57  pass
2024-chevrolet-corvette-stingray-z51 trap speed (mph)                           122.0     122.6      +0.6      4.9   0.12  pass
2024-chevrolet-corvette-stingray-z51 70-0 mph (ft)                              149.0     135.8     -13.2     10.4   1.26  MISS
2024-chevrolet-corvette-stingray-z51 skidpad 300 ft (grip fitted to it) (g)     1.030     0.955    -0.075    0.040   1.89  MISS
2024-honda-civic-sedan-lx            0-60 mph (s)                                9.70      8.03     -1.67     0.68   2.46  MISS
2024-porsche-911-carrera             0-60 mph (rollout) (s)                      3.20      4.25     +1.05     0.30   3.49  MISS
2024-porsche-911-carrera             quarter mile (s)                           11.50     12.52     +1.02     0.46   2.21  MISS
2024-tesla-model-3-long-range-awd    0-60 mph (s)                                4.20      8.07     +3.87     0.30  12.90  MISS
2024-tesla-model-3-long-range-awd    quarter mile (s)                           12.30     15.96     +3.66     0.49   7.44  MISS
2024-tesla-model-3-long-range-awd    trap speed (mph)                           114.0      90.5     -23.5      4.6   5.15  MISS
2024-tesla-model-3-long-range-awd    skidpad 200 ft (grip fitted to it) (g)     0.920     0.853    -0.067    0.040   1.66  MISS
2024-toyota-camry-le                 0-60 mph (rollout) (s)                      7.90      7.03     -0.87     0.55   1.57  MISS
2024-toyota-camry-le                 quarter mile (s)                           16.20     15.44     -0.76     0.65   1.17  MISS
2024-toyota-camry-le                 trap speed (mph)                            90.0      92.0      +2.0      3.6   0.56  pass
2024-toyota-camry-le                 top speed (mph)                            133.0     129.6      -3.4      1.0   3.40  MISS
2024-toyota-tacoma-trd-off-road      0-60 mph (rollout) (s)                      7.00      6.47     -0.53     0.49   1.09  MISS
2024-toyota-tacoma-trd-off-road      quarter mile (s)                           15.30     14.93     -0.37     0.61   0.60  pass
2024-toyota-tacoma-trd-off-road      trap speed (mph)                            91.0      90.6      -0.4      3.6   0.10  pass
2024-volkswagen-golf-gti-s           0-60 mph (s)                                6.10      5.96     -0.14     0.43   0.33  pass
2024-volkswagen-golf-gti-s           quarter mile (s)                           14.40     14.19     -0.21     0.58   0.36  pass
2024-volkswagen-golf-gti-s           trap speed (mph)                            99.0      99.7      +0.7      4.0   0.19  pass
2024-volkswagen-golf-gti-s           60-0 mph (ft)                              108.0     105.2      -2.8      7.6   0.37  pass
```

A skidpad row appears only where calibration could not meet the figure (the grip scale is held at its tyre category's
edge); a skidpad met within 0.04 g is not a prediction and is not listed (GTI).

| car | grip scale | basis: sourced / derived / calibrated / estimated |
| --- | --- | --- |
| Corvette Stingray Z51 | 1.0784 (summer's top) | 17 / 18 / 2 / 67 (run at its 3,647 lb test weight) |
| Civic LX | not calibrated | 17 / 15 / 0 / 72 |
| 911 Carrera | not calibrated | 15 / 14 / 0 / 75 |
| Model 3 Long Range AWD | 1.0870 (all-season's top) | 15 / 12 / 2 / 75 |
| Camry LE | not calibrated (its skidpad is set apart) | 16 / 14 / 0 / 74 (run at the tested SE's 3,409 lb) |
| Tacoma TRD Off-Road | not calibrated (its skidpad was not second-read) | 15 / 9 / 0 / 80 (run at its 4,794 lb test weight) |
| Golf GTI 380 S | 1.0784 (summer's top, met on 200 ft) | 13 / 13 / 2 / 76 |

No car had its drag fitted: every one with an ungoverned top speed on file also has a drag coefficient.

## How each test was taken

`sheet.ts` now fills a record's missing `testRollout` and `testSkidpadDiameterFt` from the tester's known practice
(`testerPractice`): Car and Driver and MotorTrend subtract a one-foot rollout from 0-60; MotorWeek, Edmunds and
Consumer Reports time from rest; a tester not on that list has no known practice and gets no flag (the check then
times from rest, as the record leaves it). Car and Driver's skidpad is 300 ft; MotorTrend's and Edmunds' 200 ft. The source
of each such flag says "Not on file: taken from the tester's known practice", and `validate.ts` prints which.
`checkSheet` then compares the bench's 0-60 with or without the rollout, and its skidpad on the nearer circle.

| car | 0-60 | skidpad circle |
| --- | --- | --- |
| Corvette | Car and Driver, rollout (on file) | 300 ft (on file) |
| Raptor | (set apart: not second-read) | (set apart) |
| Civic | Consumer Reports, from rest (**tester's practice**: the record has no `testRollout`) | (no skidpad) |
| 911 | Car and Driver, rollout (on file) | (no skidpad) |
| Model 3 | Edmunds, from rest (on file) | 200 ft (on file) |
| Camry | Car and Driver, rollout (on file) | (set apart) |
| Tacoma | Car and Driver, rollout (on file) | (set apart: not second-read) |
| GTI | Edmunds, from rest (**tester's practice**) | 200 ft (**tester's practice**; it had defaulted to 300 ft) |
| GT-R (set apart) | MotorWeek, from rest (**tester's practice**) | - |

Every flag on file agrees with its tester's practice.

## Set apart: not checks of this configuration, or not second-read

A test figure whose notes say the test car was another configuration is not a check (data/research/README.md: "A test
figure must come from a named instrumented test of the same configuration"). `readResearch` sets apart a figure whose
note or checkNote carries the researchers' flags (CONFIGURATION MISMATCH, TRIM MISMATCH, OTHER TRIM, "NOT a 2024 car")
or the second reader's "does not meet the README's same-configuration rule"; a flag about the test car takes every
figure with the same url (the same test) with it, while the second reader's rule is about one figure and takes only
it. A refuted figure was already dropped. The figures are in `SET_APART` in `src/data/sheets.ts` and printed by
`validate.ts`:

| car | figures | why |
| --- | --- | --- |
| Mustang GT | 0-60 4.8, quarter 12.7 @ 111.6, 60-0 103, skidpad 0.97, test weight 3,866 | Edmunds' car had the Performance Package (3.73 axle, wider rear tyres, Brembos); the record is a base GT |
| Odyssey EX-L | 0-60 6.6, quarter 15.2 @ 95, 70-0 184, skidpad 0.75 | Car and Driver's 2018 Elite on 19-inch tyres |
| Wrangler Rubicon | 0-60 7.5, quarter 15.9 @ 87, 70-0 212, test weight 4,629 | a 2018 JL, before the 2024 full-float rear axle ("not a 2024 car") |
| GT-R NISMO | 0-60 3.3, quarter 11.4 @ 125 (MotorWeek); skidpad 1.02, 60-0 104 (a forum's quote of MotorTrend) | a 2020 car without the 2024 front limited-slip and aero; a 2017 car with steel brakes |
| Outback Premium | 0-60 8.8 | Edmunds' Limited ("OTHER TRIM") |
| Camry LE | 70-0 175, skidpad 0.88 | the SE's tyres and suspension: the second reader found these two fail the same-configuration rule (the SE's 0-60, quarter mile and trap stay: same powertrain, its checkNote says so) |
| Prius LE | 0-60 7.1, quarter 15.5 @ 92, 0-100 18.8, 70-0 171, skidpad 0.87, test weight 3,199 | the Limited on 19-inch tyres ("TRIM MISMATCH") |
| F-150 Raptor | 0-60 5.2, quarter 13.9 @ 98, 70-0 214, skidpad 0.69, top speed 120, test weight 5,947 | nobody second-read them (no check mark) |
| Tacoma TRD Off-Road | 70-0 171, skidpad 0.77 | nobody second-read them (no check mark); the skidpad is a forum's retelling of a comparison test whose truck's transmission was not stated |

A test figure with no check mark is set apart as well (`readResearch`, `NOT_SECOND_READ`): the research README has a
second reader try to refute every figure, and a figure nobody tried is not evidence (the parts exam's own rule). The
Raptor's and the Tacoma's are the only such figures that were still checks; the Prius', the Wrangler's and the Model 3's
were already set apart for other reasons, or are a test condition (the Model 3's skidpad circle, which matches Edmunds'
practice). Kept as checks although their notes discuss them: the Corvette's 70-0 and skidpad (second-hand, "same
configuration either way"); the Camry SE's powertrain figures; the Civic's Consumer Reports figure (a Sport on 18-inch
wheels, 58 lb heavier, no flag). The Wrangler now loads: its body class
"off-road-suv" was refused; `readResearch` now reads an off-road SUV as the off-road class.

## Fixes, each with a failing test first

1. **Like with like** (`sheet.ts`, `scripts/build-sheets.ts`, `scripts/validate.ts`; tests in `sheet.test.ts`). The
   rule above, the tester's practice, the off-road SUV class. Effect: 31 figures set apart; 5 cars (Mustang, Odyssey,
   GT-R, Outback, Prius) and the Wrangler leave the table, 49 checks become 30. The GTI's skidpad moved to Edmunds'
   200 ft circle: before, 0.931 against 0.99 at 300 ft (a 1.49x miss); now met. The existing test that read the real
   GT-R record with "nothing dropped" now asserts exactly which five tests are set apart and that nothing else is.

2. **Engine friction** (`classes.ts` FMEP.petrol, `engine.ts` now takes it from the class table instead of its own
   copy; tests in `classes.test.ts` and `engine.test.ts`). From search results (none from memory): the Shinn-Flynn form
   FMEP = a + b pmax + c cm^2 with Basshuysen and Schaefer's constants (a 0.3 to 0.5 bar, b 0.004 to 0.006, c 0.0006 to
   0.0012 bar s^2/m^2, as cited in a US patent's search summary), a naturally aspirated engine's full-load peak
   pressure of 53 to 83 bar (a cited Harvard paper's 53 bar at full load and 4,000 rpm; about 83 bar as production's
   top), and MDPI Lubricants 7 (2019) 105, which measured two modern petrol engines at no more than 1.18 and 1.40 bar
   with the oil at 70 C. That puts a modern petrol engine at 0.73 to 1.39 bar at 6,000 rpm; Heywood's 1980s fit, the
   start, gave 3.67 bar there and 4.47 at 7,000. New fit `[100e3, 0, 1.0e3]` Pa (x in thousands of rpm): 1.04 bar at
   2,000 rpm, 1.36 at 6,000, 1.49 at 7,000, the upper half of the published spread as every estimate here leans
   unfavourable (and above the existing test's 1 bar at 2,000 rpm, which still passes). Effect: the 9 psi turbo kit
   now adds **+58.3 to +58.8%** peak power on the three proof cars (was +70.9 to +71.8%; the 35 to 60% band now
   passes); the 6 psi kit +39.3 to +39.7%, the 13 psi kit +83.0 to +83.9%. Stock bench figures barely move (the
   full-throttle curve is pinned to the published peaks): fixes 2 to 5 together moved no validated 0-60 by more than
   0.02 s where the grip scale stayed the same (the Camry went from 6.76 to 6.91 s because its grip scale fell from
   1.087 to 1 when its skidpad was set apart, not because of these fixes, which moved it 0.03 s).
   - With friction at a third of what it was, a 2.0 litre's engine braking at 3,000 rpm fell to 22.9 N m and failed
     its existing band (25 to 50). The closed-throttle pumping figure was 35 kPa; on the overrun a closed throttle
     holds the manifold 20 to 24 inHg (68 to 81 kPa) below the air outside (Motor magazine: 18 to 22 inHg at idle,
     and it jumps when the throttle snaps shut), so it is now 75 kPa, one constant shared by `engine.ts` and
     `driveline.ts` (which had its own copy). Engine braking is back to 29 N m.
   - That exposed a defect in traction control: its cut was a share of the pedal, and with friction and pumping in
     the way a share of the pedal is a bigger share of the drive (half throttle on a 2.0 litre at 3,000 rpm makes 0.42
     of its full torque). On a split surface the proof coupe pulled away 5% slower with traction control on than off
     (an existing test failed: 0.948 against more than 0.99). The cut is now a share of the engine's drive
     (`engine.ts` `throttleForShare`, applied in `vehicle.ts`), as its own comment always said it aimed: the coupe now
     pulls away 14% faster with it on.
   - `engine.test.ts`'s airflow-limit test set its limit at 0.35 kg/s, 80% of the old engine's indicated need; with
     less friction that was no longer below the need. It is now 0.28 kg/s, again four fifths of the new 408 kW
     indicated, with the same assertions.

3. **The automatic's shift hunting** (`systems.ts` `shiftPedalStep`, `vehicle.ts`; tests in `vehicle.test.ts`). The
   shift points move with the pedal between the light-throttle and the full-throttle ones, so a pedal that dipped for
   wheelspin changed the box up and its return kicked it down: the proof sedan launched 1-4-1-4-1-5-1-5-1-6 with the
   pedal dipping to 0 for 0.25 s every 0.75 s, and the pickup 1-2-1-4-1-5; with a pilot on the club circuit the sedan
   changed gear 29 times in 30 s from a standing start, hunting 3-4-3-4 out of corners. The gearbox controller now
   reads the pedal through a filter that follows a press in about 0.1 s and a lift in about 1.5 s. Four launch
   patterns on both cars now only ever change up; a lift held for good still changes up early within six seconds; the
   pilot's 30 s is 17 changes (one 3-4-3 left on a corner exit at a rising part throttle). The filtered pedal is a
   `VehicleState` field, `shiftPedal` (it was first kept beside the state, where a copy of every field lost it and
   hashed differently), which `hashState` folds and `placeVehicle` and `bench.ts` `copyState` handle.

4. **The launch driver asked the box back down** (`drivers.ts`; test in `drivers.test.ts`). On a car whose shift
   points sit at redline, the box's over-rev guard changed up a moment before the engine itself reached the driver's
   shift speed, and the driver, still asking for the lower gear, got it back each time the revs fell: the proof sedan
   went 1-2-3-4-3-4-5-4-5-6-5-6 and lost 0.17 s of its quarter mile at the car's own shift points. The driver now
   follows a box that changed up. Proof sedan at its own shift points: quarter mile 15.51 to 15.32 s (1-2-3-4-5-6),
   now its best; before, the search had found 15.34 s only by shifting 2% early, below the guard. It also cured an
   envelope test (`lap.test.ts`, the envelope's 0-60 within 4% of the bench's) and the weight-3 part's quarter-mile
   gain on the sedan (0.45 of the hp-per-weight rule against a floor of 0.5; now 0.70), which the hunting made
   depend on which launch speed the search happened to settle on.

5. **The skidpad's held lap** (`bench.ts`). A held run that ran wide on the step that completed its lap counted the lap
   without timing it, and `skidpadRun` then took its NaN as the best figure: under the old friction table the
   Corvette's 300 ft figure was NaN at a grip scale of 1 (held run 4 of 5: one lap, no time), so its grip was fitted
   to nothing. Laps are now counted on the samples timed, and a held run counts only with a timed figure. After fixes
   2 to 4 I could no longer make any car produce the NaN (a scan of 16 cars, 5 grip scales and both circles, and of
   240 held runs, found none), so the regression test (`bench.test.ts`) checks the symptom: three researched cars,
   including the Corvette, each give a finite skidpad under their friction limit on both circles.

The golden hashes (`golden.ts`) were re-pinned on purpose for fixes 2 and 3 (the friction and pumping tables, the
traction control cut, and the filtered pedal, which the hash now folds in); its comment says so.

6. **Not second-read, not a check** (`sheet.ts`; test in `sheet.test.ts`): above. The Raptor leaves the table and the
   Tacoma loses its two unread figures (and with its skidpad, its grip calibration).

7. **The car as tested** (`calibrate.ts asTested`, `scripts/validate.ts`; test in `calibrate.test.ts`). A sheet's tests
   carry the scale weight of the car that ran them; nothing read it, so the Tacoma ran at the pickup blank's 5,071 lb
   against its 4,794 lb test truck (and the Raptor at it against 5,947 lb). Each car's validation run now takes the
   test weight as its curb weight (the driver is added as ever); the Corvette's moves 4 kg (its resolved 1,650 kg curb
   against the 3,647 lb test car). The Tacoma's 0-60 goes from a pass (6.75 s) to a miss (6.47 s against 7.0): the "would likely run quick"
   below came true. The Camry runs at the tested SE's 3,409 lb (curb 3,310 on file): 0-60 6.91 to 7.03 s, quarter
   15.34 to 15.44 s.

## Each remaining miss and its likely cause

- **Model 3 Long Range (12.9x on 0-60, 7.4x quarter, 5.2x trap; all eight inversions).** No power figure is on file
  (Tesla publishes none; the record lists 390 to 498 hp from listing sites and left them out), so the resolver takes the
  sedan class's blank engine, 200 hp. Not a defect of the core; the record needs a sourced system power. Its skidpad,
  0.92 g on Edmunds' 200 ft circle on all-season tyres, needs more than the all-season range allows (0.853 g at the
  top, 1.087).
- **F-150 Raptor: no checks.** Its test figures are set apart (not second-read). Run at the test truck's own 5,947 lb
  (as the check now does), they would pass 0-60 (5.04 s), the quarter (13.65 s) and the trap (99.9 mph), which says the
  earlier misses were the class blank's 5,071 lb; its top speed would still miss (no top speed on file: the class's
  governor, 112.6 mph, against the 2021 truck's 120). Second-read figures would bring it back.
- **911 Carrera (0-60 +1.05 s, quarter +1.02 s).** The engine location is not on file (notFound), so the 911 resolves
  as a front-engine car with 53% of its weight on the front, where a 911 carries about 61% on its rear wheels over its
  engine: its first-gear launch is held to 0.67 g by its rear tyres. Car and Driver's 3.2 s also beats Porsche's own
  3.8 s (with Sport Chrono), and its 11.5 s quarter mile asks more than Hale's 12.2 s for 379 hp at 3,519 lb: the
  engine is likely underrated as well. A missing input first.
- **Corvette Stingray Z51 (0-60 +0.51 s, 70-0 -13.2 ft, skidpad -0.075 g; run at its 3,647 lb test weight).** The record names the Michelin Pilot
  Sport 4S as a summer tyre (its sources' word); the class table's summer range stops at 1.10 (grip scale 1.0784),
  which corners at 0.954 g on 300 ft against 1.03 and launches at 0.88 g in first, traction-limited, against a car
  that runs 2.8 s with rollout. The quarter mile and trap pass. `readResearch` itself reads "Max Performance Summer"
  as the max-performance category; the record's own words do not give it. The 70-0 is the other way: the model stops
  at 1.20 g against the real 1.10, on a tyre whose lateral grip is at its category's top; its braking over its
  skidpad is 1.26 against the real car's 1.07. Not explained: see "the brakes against the skidpad" below.
- **Camry LE (0-60 -0.87 s, quarter -0.76 s, top speed 3.4x).** Run at the 3,409 lb of the SE Car and Driver weighed
  (the LE's curb weight on file is 99 lb less); the trap passes (+2.0 mph). Hale's formula for 203 hp at the tested 3,409 lb plus a driver gives
  15.15 s at 89.9 mph; the real car traps exactly that and runs 16.2 s, 7% slower than its own power says: its launch
  is poor (Toyota's brake override cuts power with both pedals pressed, so it cannot be brake-torqued, and economy
  automatics launch gently), where the bench launches as an expert, at 15.34 s. No defect of the core found; the
  check compares an economy car's launch with an expert's. The top speed is the sedan class's governor (130 mph,
  129.6 on the bench) against Car and Driver's 133 mph governor: no top speed is on file.
- **Civic LX (0-60 -1.67 s).** Consumer Reports' 9.7 s, from rest, for a Sport on 18-inch wheels and 58 lb heavier.
  Consumer Reports does not launch as a drag racer; the bench's car traps 89.7 mph against Hale's 87.3 for 158 hp at
  3,042 lb, a sane car. Like the Camry: a gentle tester's launch against the bench's expert one. Kept as a check because
  its notes raise no flag.
- **Tacoma TRD Off-Road (0-60 -0.53 s, 1.09x).** Run at its 4,794 lb test weight (second reader: unconfirmed; every
  listed weight, 4,485 to 4,794 lb, is far under the pickup blank's 5,071 lb it ran at before) it runs quick: 6.47 s
  against 7.0, while its quarter mile and trap pass. No curb weight is on file; its grip is the all-terrain class's
  (the skidpad it was fitted to is set apart, not second-read).

## Found and listed, not fixed

- **Cornering under its tyres' friction.** Four of the five calibrated cars end at their category's top grip scale
  (Corvette, Model 3, Tacoma, GTI), none at the bottom. At a grip scale of 1 the bench corners at 86 to 88% of the
  friction its tyres have at their static loads (Camry 0.861, GTI 0.879, Model 3 0.877). Measured on the Camry: load
  sensitivity costs 5.5 points (0.861 with the class's 0.12, 0.916 with none), the cornering stiffness's fall at high
  load 2 points (0.880 with it flat), and the inner front, steered as far as the outer (no Ackermann), runs past its
  peak (use 1.6) while the rears sit at 0.55 to 0.68. Changing load sensitivity alone would not cure the braking misses:
  it moves braking and cornering together (Camry: 70-0 x skidpad 135.6 at 0.12, 135.4 at 0.06). No published figure
  for load sensitivity or for ABS adhesion utilisation came to hand that would justify moving the class table, so it
  is left.
- **The brakes against the skidpad.** Braking deceleration over skidpad, model against real, from the run before the
  unread figures were set apart: Corvette 1.26 / 1.07, Raptor 1.17 / 1.11, Tacoma 1.24 / 1.24, GTI 1.16 / 1.13 (and the
  Camry SE, set apart, 1.21 at a grip of 1 against 1.06); the Raptor's and the Tacoma's real figures were never
  second-read. The model brakes a little better than its cornering says on three of four; the Corvette's -8.7% 70-0 is the
  one miss. Likely the categories' `muXRatio` or the ABS's efficiency (the bench stops within a few percent of the
  ideal); a search found no number to set either by (an SAE paper cites 65% as a forensic convention; the NHTSA
  report found constant-pedal methods unreliable).
- **The circle driver above about 25 m/s.** The proof sedan: 0.796 g on 200 ft, 0.790 on 300 ft, 0.789 on 500 ft
  (24.3 m/s), 0.489 on 1,000 ft. No check needs a circle above 300 ft, so it is listed, not fixed.
- **Diesel friction** (DESIGN.md open question 6) is still the figure quoted from memory, and is now three times the
  petrol one at 4,000 rpm; no diesel is on file to check it.
- **Missing inputs in the research**, for the researchers: second reads of the Raptor's tests and the Tacoma's 70-0
  and skidpad; curb weight (Corvette, Raptor, Tacoma, MX-5), engine
  location (911, which is rear), system power (Model 3), top speed and its governor (Raptor, Camry). The Golf's six
  ratios are dropped (fifth 1.10 above fourth 1.09: the MQ350 box's two final drives, which a sheet cannot hold).
