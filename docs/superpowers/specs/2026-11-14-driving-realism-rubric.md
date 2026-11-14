# MiCar driving realism rubric

Date: 2026-11-14. Baseline measured on `main` at 64a8f6a. Companion to `2026-11-11-physics-core-design.md`.

## 1. What this is

A scorecard for how real MiCar's racing is: 27 criteria in six areas, each scored 0 to 3 and weighted to a total out of 100. Run it before and after any change to the driving model, the Garage's parts or the card races, and put both scores in the pull request.

**Today's score: 29 out of 100.**

The physics core's rule is the rule here too: real figures about a car go in, and how it launches, turns and stops comes out. A criterion cannot pass level 1 while an input is bent to hit its result.

## 2. The scale

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | Missing | Not modelled, or the result contradicts the real thing |
| 1 | Arcade | The direction is right and the size is wrong, or the size is right only because an input was fitted to the answer |
| 2 | Close | From honest inputs, within twice the tolerance |
| 3 | Real | From honest inputs, within the tolerance on the validation cars, and it comes out of the model, not out of a special case |

Points for a criterion: weight × level ÷ 3. Level 3 everywhere is 100.

Tolerances are the physics core design's (its section 7): 0–60 mph 7% or 0.3 s; quarter-mile time 4%; trap speed 4%; braking distance 7%; top speed 4%, or the limiter ± 1 mph; skidpad 0.04 g; economy 8%.

## 3. How the baseline was measured

- The game's own driving model (`apps/sim/src/world/physics.ts`) run without the browser, at its 120 Hz step. Stock parts, default tune, flat out.
- The 36 real models of the world's car table (`apps/sim/src/carSpecs.ts`), each on the body style the catalogue gives it, and the five rental cars.
- "Table" figures are that table's own, which the repo marks as unverified. Figures marked ≈ are typical instrumented-test values quoted from memory. Neither is a sourced test figure: stage 0 of the physics core replaces both with figures that carry a source.
- Skidpad: the car holds a 300 ft circle while its speed rises 0.08 m/s each second. The figure is the best two-second average before it runs more than 3 m wide.
- Braking: full brake from 62 mph; the distance from 60 mph to rest.
- Opponents: the AI's own step function on the circuit routes with no player near it, so its catch-up rule is off.
- Card figures: `@micar/engine` on the same car, with the powertrain marked as petrol so that engine parts count.
- The scripts are scratch files and are not in the repo. Each test is described here closely enough to rebuild; the physics core's stage 0 builds the bench that replaces them.

## 4. The rubric

Levels 0 and 1 mean what section 2 says. Each criterion states what levels 2 and 3 take.

### A. Straight line (20 points; today 7.3)

**A1. Launch. Weight 6. Today: level 1.**
- Test: 0–30 mph and the peak launch acceleration for a rear-drive, a front-drive and an all-wheel-drive validation car, against instrumented tests.
- Today: every car carries 49% of its weight on the rear axle (43% for hatchbacks), whatever the real car's split. Rear-drive cars peak at 0.57 to 0.60 g, front-drive at 0.40 g, all-wheel drive at 0.90 g. The Corvette takes 2.3 s to 30 mph (≈ 1.1 s).
- Level 2: each car uses its published weight split; 0–30 mph within 15% for each layout.
- Level 3: 0–30 mph and the 60 ft time within 7%, from the published weight split, centre-of-gravity height, tyre grade and a clutch or converter. Wheelspin is something each wheel does, not a cap on force.

**A2. 0–60 mph. Weight 5. Today: level 1.**
- Test: stock cars against instrumented tests, with the one-foot rollout stated either way.
- Today: 23 of 36 are within 7% or 0.3 s, with power bent to get there (see C1). The 13 misses: every fast rear-drive car is 1.3 to 2.2 s slow (Corvette 3.0 → 5.2 s), both minivans are 1.7 to 1.9 s slow, three all-wheel-drive SUVs are 0.4 to 0.7 s quick.
- Level 2: within 14% or 0.6 s from published inputs.
- Level 3: within 7% or 0.3 s on at least 80% of the validation cars, none out by more than twice that, median error 4% or less.

**A3. Quarter mile. Weight 5. Today: level 1.**
- Test: time and trap speed against tests. Also the response to power: time should follow (weight ÷ power) to the one-third, the drag racer's rule of thumb.
- Today: the table holds no quarter-mile figures, so nothing is compared. A third more power (Engine, top tier) moved the Mustang's time by 3.4% and its trap speed by 7.8%, where the rule of thumb says about 9% and 10%.
- Level 2: time and trap speed within 8%.
- Level 3: each within 4%, on a full timeslip: reaction, 60 ft, 330 ft, eighth mile, 1000 ft, quarter mile.

**A4. Top speed and the limiter. Weight 2. Today: level 1.**
- Today: 21 of 36 within 4%, reached by bending the final drive (2.40 on the Corvette, 5.92 on the pickups). No car has a limiter: pickups and big SUVs run 8% to 23% past their governed speed (F-150: 129 mph for 107).
- Level 2: within 8% from real gear ratios and drag.
- Level 3: within 4%; a governed car at its limiter ± 1 mph; from real ratios and a measured road load.

**A5. Braking. Weight 2. Today: level 2.**
- Today: 60–0 mph in 115 to 133 ft by body style (≈ 100 to 145 ft across real cars). Adding 300 kg changes nothing. The Brakes upgrade shortens a stop by 1% and Tyres by 4%, which is the right way round.
- Level 3: within 7% for each car. Tyres set the distance; brakes set how many times it can be repeated before they fade.

### B. Cornering and tyres (20 points; today 5.7)

**B1. Skidpad, car by car. Weight 7. Today: level 1.**
- Today: sedans 0.97 g, sports cars 1.04 to 1.05 g, the minivan 0.89 g, the pickup 0.88 g, the big SUV 0.92 g (≈ family sedans 0.80 to 0.87, sports cars 0.95 to 1.07, pickups and big SUVs 0.70 to 0.80). There is one grip number per body style, so a Prius corners with a 3 Series.
- Level 2: within 0.08 g for each car, with the tyre grade on its sheet.
- Level 3: within 0.04 g for each car. The only thing fitted is the tyre's grip scale, inside its grade's range.

**B2. What moves grip. Weight 5. Today: level 0.**
- Test: raise the centre of gravity 30%; add 300 kg; narrow the track; move roll stiffness to the rear.
- Today: 30% higher costs 0.002 g and 300 kg costs 0.003 g, which is nothing. The model has a front and a rear and no left and right, so weight never moves across the car.
- Level 2: height and mass both lower grip by plausible amounts.
- Level 3: all four act as they do on a real car: higher and heavier grip less, a narrower track grips less, more rear roll stiffness moves the balance toward oversteer, and an inside wheel can lift.

**B3. How a tyre lets go. Weight 4. Today: level 1.**
- Today: grip peaks at 9° of slip, which is realistic, and still holds 96% of the peak at 20° (≈ 75% to 90% for a street tyre). Grip does not depend on load. Force arrives instantly. A spinning wheel is a fixed 8% loss.
- Level 2: the fall after the peak is inside the real range, and throttle, brake and steering share one budget at each wheel.
- Level 3: by tyre grade: where the peak is, how far grip falls after it, how grip grows more slowly than load, and the short lag before force builds, each inside that grade's range.

**B4. Lift and downforce. Weight 2. Today: level 1.**
- Today: at the default setting every car carries downforce worth 20% of its weight at 123 mph, and 40% at the slider's end (≈ nothing or slight lift for a road car; a Porsche 911 GT3 RS claims about 28%).
- Level 3: a stock car has its own drag and lift. A wing adds downforce and the drag that comes with it.

**B5. Balance. Weight 2. Today: level 2, provisional.**
- Test: in a steady corner at the limit, add throttle (a front-drive car runs wide, a powerful rear-drive car rotates), then lift off (the line tightens).
- Today: not measured in this pass. The parts that produce it exist: one grip budget per axle and weight moving front to back. Counter-steer help and a steering fade are inside the car model, and drifting is a switch that cuts rear grip to 68%.
- Level 3: all three behaviours appear with no special case, and driver help is a separate layer that can be turned off.

### C. Honest inputs (12 points; today 2.3)

**C1. Power is the car's own. Weight 5. Today: level 0.**
- Today: the power a car drives with differs from its table figure by a median of 12.6%. 19 of 36 are out by more than 10%: BMW Z4 +64%, 4 Series +51%, Malibu +49%, 3 Series +45%, Corvette +23%. Torque is scaled until 0–60 matches.
- Level 2: published peak power and torque reproduced within 2%.
- Level 3: both peaks within 0.5% at their published engine speeds, and nothing fitted to an acceleration test.

**C2. Each car is itself. Weight 4. Today: level 1.**
- Today: 36 models share seven body-style chassis. All have six gears. Supra and Z4 are the same car to the hundredth of a second, and so are Sienna and Odyssey.
- Level 2: its own mass, weight split, number of gears and ratios, tyre size and grade.
- Level 3: also its wheelbase and track, centre-of-gravity height, drag and transmission type. No two different cars are identical, and any two more than 10% apart on a published figure are ordered the same way.

**C3. Every number says where it came from. Weight 3. Today: level 1.**
- Today: the card engine marks each figure with one of six kinds of source. The driving model marks nothing, and its table is unverified.
- Level 3: each physical figure is sourced, derived, calibrated or a class estimate, and says which. Estimates lean unfavourable. A car that has not passed its checks is labelled and kept out of ranked play.

### D. Modifications, one to one (20 points; today 5.7)

Real results scatter: two dynos disagree by a few percent and a strip time moves with the weather. "One to one" here means inside that scatter: power within 5%, quarter-mile time and trap speed within 4%.

The proof is a **parts exam**: documented builds, each with a dyno sheet or a timeslip before and after one change, sourced like any other figure. The model must predict the change. It is to parts what the validation sixteen are to stock cars.

**D1. Power parts match the dyno, by engine. Weight 6. Today: level 1.**
- Today: the same percentage on any engine. Top tier: Engine +33% power, ECU +20%, Turbo +38%, including on an engine that already has a turbo (≈ a tune is worth 2% to 5% on an engine without a turbo and 15% to 30% on one with).
- Level 2: the gain depends on the kind of engine and stays inside the published range for that part.
- Level 3: on the parts exam, the predicted change in peak power and torque is within 5% of the measured one. Gains come from airflow, pressure and limits, not from a table of percentages.

**D2. Parts carry their real costs. Weight 4. Today: level 1.**
- Today: on the road a part costs nothing: no heat, no added weight, no lag beyond the turbo's spool, no limit but traction. On the card it does cost: a top-tier turbo, professionally fitted, takes 113 points of reliability and 38 of durability.
- Level 3: every part states its cost, and the cost is physical wherever it can be: weight, drag, lag, heat, fuel, traction, and what the clutch and gearbox can hold. What cannot be driven (how long it lasts) is charged by the card engine from the same build.

**D3. Chassis parts do what they really do. Weight 5. Today: level 1.**
- Today, top tier: Tyres add 0.18 g and cut 0–60 by 13%, the right direction. Suspension adds 0.10 g by raising tyre grip (≈ 0.02 to 0.05 g from a lower, flatter car). Weight takes 10% off the car and 1% off its 0–60, because the launch is traction-limited. Nothing has a downside.
- Level 3: a tyre grade moves skidpad, braking and launch together by that grade's amounts. Springs, bars and ride height change height, roll and balance. Brakes change fade, not the first stop. Less weight moves the balance. A wing adds drag. Each inside the range the parts exam shows.

**D4. A fully built car stays inside reality. Weight 3. Today: level 0.**
- Today: a Mustang with all nine top-tier parts makes 1,102 hp and runs 10.8 s at 157 mph on the road. On the card the same build makes 1,414 hp and reaches 60 mph in 1.73 s, which no rear-drive car on street tyres can do. A built Corvette makes 1,334 hp and 277 mph.
- Level 2: no build beats documented builds of its kind.
- Level 3: built validation cars land within tolerance of documented examples. Power stops where airflow, fuel and the parts' ratings stop it, and the launch stops at the tyres.

**D5. Nitrous. Weight 2. Today: level 1.**
- Today: 30% to 55% more torque for 4 to 8 s, and the bottle refills itself in under a minute. On the card: 28% more power, always (≈ a fixed shot of 50 to 150 hp set by the jets, about 0.8 lb of nitrous per 100 hp every ten seconds, and a bottle that empties).
- Level 3: a fixed amount of power added, a bottle that loses weight and pressure, a refill that costs money, and the card engine's charge to reliability.

### E. Opponents and race rules (16 points; today 4.0)

**E1. Opponents obey their car. Weight 6. Today: level 0.**
- Today: an AI racer is a point following a line. Its corner rule works out to 1.5 g on bends tighter than 83 m radius and sets no limit on gentler ones. Measured on five circuits it sustains 2.1 to 5.2 g for a second at a time, beside a car whose tyres hold about 1.0 g. Its acceleration is the same at any speed.
- Level 2: every opponent's speed is bounded by its own car's measured limits.
- Level 3: an opponent runs the same physics step as the player with a driver on top. Its lap falls inside its skill band, 80% to 98% of its own car's limit lap, and never beats that limit.

**E2. Close racing without cheating. Weight 3. Today: level 1.**
- Today: a racer 25 m behind the player gets 8% more speed, 70 m behind 22% more, and 60 m ahead 14% less. Its top speed is about 80% of the player's at career stage 1 and 104% at stage 5. Drag opponents are the player's own car with 91% to 117% of its torque. Card play already matches rivals by Power Rating class.
- Level 3: no speed changes with the gap. Fields are matched by class. Handicaps are rules the player can read: a bracket dial-in, ballast, a reversed grid.

**E3. Drag strip procedure. Weight 3. Today: level 1.**
- Today: a 3-2-1 count, time taken from the green so it includes the driver's reaction, no penalty for leaving early, no split times. The quarter and half mile are the right lengths. An engine held over its redline for 1.5 s is destroyed.
- Level 2: reaction time kept apart from the run, a red light for leaving early, a 60 ft time and a trap speed.
- Level 3: staging beams, the tree in both its forms, the red light, the rollout, a full timeslip, heads-up and bracket racing, and a rev limiter with wear in place of the instant failure.

**E4. Circuit procedure and terrain. Weight 2. Today: level 2.**
- Today: five lights a second apart with a random hold, sectors and gaps, and ten layouts within about 1% of the real circuits' lengths (≈). The world is flat, walls stand in for track limits, and nothing stops a jumped start.
- Level 3: gradient and the load a crest takes away or a dip adds; a jumped start and a cut corner are penalised.

**E5. Drift. Weight 2. Today: level 1.**
- Today: a mode. Rear grip drops to 68%, any car is driven 30/70 front to rear, and the score is speed × angle × time.
- Level 3: no switch. A rear-drive car drifts because of its power, its weight transfer and its handbrake, and is judged on line, angle and speed through marked zones.

### F. One truth (12 points; today 4.0)

**F1. A part does the same thing on the card and on the road. Weight 5. Today: level 0.**
- Today: two catalogues with different numbers. A top-tier turbo is worth 38% more power on the road and 70% on the card; an engine build 33% and 25%. All nine top-tier parts on the Mustang: 0–60 in 3.87 s on the road and 1.73 s on the card.
- Level 2: one catalogue with one set of numbers.
- Level 3: a modified or worn car's card figures come from a bench run of that same build. The trust rules do not change: ranked play still counts verified parts only.

**F2. The card's result is the driven result. Weight 3. Today: level 2.**
- Today: for stock cars the card's drag order agrees with the driven quarter-mile order in 562 of 618 pairs, 90.9%. A Sienna beats a Camry on the card and loses to it by 0.8 s on the strip.
- Level 3: 97% of pairs or better in every mode that can be driven. A card race is a seeded run of the same physics and can be replayed in 3D.

**F3. The server's limits come from the physics. Weight 2. Today: level 1.**
- Today: a fixed floor of 50 m/s for a drag and 65 m/s elsewhere. A legal, fully built Tsubasa R4 or Corvette covers the Mountain Half Mile in 14.8 s, under its 16.1 s floor, so the run would be refused as impossible (a scripted driver; not reproduced in the live game).
- Level 3: every floor is the fastest legal build's bench run with a stated margin. Later the server re-runs the input log instead.

**F4. Same inputs, same result, everywhere. Weight 2. Today: level 2.**
- Today: a card race is seeded and can be replayed. A driven race has a fixed 120 Hz step but uses the browser's own trigonometry and unseeded random numbers, so it has no replays, ghosts or re-runs.
- Level 3: one state hash for the same input log in Chromium, Firefox, WebKit and Node.

## 5. Scorecard today

| Area | Points | Today | Lowest criteria |
| --- | --- | --- | --- |
| A. Straight line | 20 | 7.3 | Launch, 0–60 and quarter mile at level 1 |
| B. Cornering and tyres | 20 | 5.7 | What moves grip at level 0 |
| C. Honest inputs | 12 | 2.3 | Power at level 0 |
| D. Modifications, one to one | 20 | 5.7 | Fully built cars at level 0 |
| E. Opponents and race rules | 16 | 4.0 | Opponents obey their car at level 0 |
| F. One truth | 12 | 4.0 | Card and road agree at level 0 |
| **Total** | **100** | **29.0** | |

## 6. What takes each criterion to level 3

Stages are the physics core design's.

| Criteria | Reaches level 3 in | Not in that design yet |
| --- | --- | --- |
| A1 to A4, B1 to B5, C1 to C3 | Stage 1, the core, for the validated cars | |
| A5 | Stage 1; fade in stage 5 | |
| D1 to D5 | Stage 3, real tuning | An engine modelled as airflow, so a part's gain depends on the engine it is fitted to; the parts exam |
| E1, E2 | Stage 4, racing | Handicap formats as written rules |
| E3 | Stage 2 brings the timeslip | Staging, the tree, the red light, bracket racing |
| E4 | Not scheduled | Elevation |
| E5 | Stages 2 and 3 | Judged zones |
| F1 | Stage 6 | One catalogue for both Garages; card figures from the bench. Neither needs to wait for stage 6: they can follow stage 3 |
| F2, F4 | Stage 6 | |
| F3 | Stage 3 | The half-mile floor can be fixed today |

Estimates, not measurements: patching today's model without replacing it tops out near 60, because a model with no left and right cannot reach level 2 on B2 and its parts stay percentages. The core as designed reaches about 90. The additions in the right-hand column are what the last ten points need.

## 7. Corrections to the first report (2026-11-14)

- The Mustang and the M4 are not the same car in the game. The catalogue makes the Mustang a sports body and the M4 a coupe: 5.6 s and 5.8 s to 60 mph. The identical pairs are Supra and Z4, and Sienna and Odyssey.
- "Sedans hold about 1.02 g and sports cars about 1.08 g" were the tyre coefficients, not a skidpad test. On a 300 ft circle the figures are 0.97 g and 1.04 to 1.05 g.
- The built-in downforce is 20% of weight at 123 mph (55 m/s), not 124 mph.
- Drag opponents run 91% to 117% of the player's torque across the career, not 86% to 117%.

## 8. Baseline tables

### The 36 models

4WD cars drive as all-wheel drive in the game.

| Model | Body, drive | Power, table → game | 0–60 mph, table → game | Top speed, table → game | Quarter mile, game |
| --- | --- | --- | --- | --- | --- |
| Toyota Camry | sedan, FWD | 203 → 248 hp (+22%) | 7.6 → 7.9 s | 135 → 135 mph | 16.1 s @ 96 mph |
| Toyota Corolla | sedan, FWD | 139 → 141 (+1%) | 9.8 → 9.6 | 115 → 115 | 17.4 @ 84 |
| Toyota RAV4 | SUV, AWD | 203 → 177 (−13%) | 8.1 → 7.9 | 120 → 116 | 16.0 @ 85 |
| Toyota Tacoma | truck, AWD | 278 → 244 (−12%) | 7.5 → 7.4 | 112 → 122 | 15.6 @ 88 |
| Toyota Tundra | truck, AWD | 381 → 372 (−2%) | 6.3 → 6.3 | 112 → 129 | 14.6 @ 96 |
| Toyota Prius | hatchback, FWD | 121 → 148 (+22%) | 10.0 → 9.8 | 112 → 112 | 17.5 @ 82 |
| Toyota Sienna | van, FWD | 296 → 295 (0%) | 7.4 → 9.1 | 115 → 115 | 16.9 @ 91 |
| Toyota Supra | sports, RWD | 382 → 430 (+13%) | 3.9 → 5.6 | 155 → 155 | 13.7 @ 111 |
| Ford F-150 | truck, AWD | 325 → 327 (+1%) | 6.2 → 6.2 | 107 → 129 | 14.5 @ 96 |
| Ford Ranger | truck, AWD | 270 → 255 (−6%) | 6.9 → 6.8 | 112 → 124 | 15.1 @ 91 |
| Ford Mustang | sports, RWD | 460 → 498 (+8%) | 4.3 → 5.6 | 155 → 155 | 13.6 @ 113 |
| Ford Explorer | SUV, AWD | 300 → 257 (−14%) | 7.0 → 6.9 | 120 → 129 | 15.2 @ 91 |
| Ford Escape | SUV, FWD | 181 → 222 (+23%) | 8.7 → 8.9 | 115 → 125 | 16.7 @ 92 |
| Ford Focus | hatchback, FWD | 160 → 174 (+9%) | 8.4 → 8.3 | 125 → 125 | 16.3 @ 90 |
| Ford Fusion | sedan, FWD | 175 → 228 (+30%) | 8.6 → 8.1 | 125 → 125 | 16.4 @ 93 |
| Honda Civic | sedan, FWD | 158 → 207 (+31%) | 8.2 → 7.9 | 125 → 125 | 16.3 @ 95 |
| Honda Accord | sedan, FWD | 192 → 240 (+25%) | 7.3 → 7.9 | 125 → 125 | 16.2 @ 96 |
| Honda CR-V | SUV, AWD | 190 → 177 (−7%) | 8.0 → 7.3 | 120 → 116 | 15.9 @ 85 |
| Honda Pilot | SUV, AWD | 280 → 255 (−9%) | 7.0 → 6.9 | 112 → 129 | 15.2 @ 91 |
| Honda Odyssey | van, FWD | 280 → 295 (+5%) | 7.2 → 9.1 | 115 → 115 | 16.9 @ 91 |
| Honda Fit | hatchback, FWD | 130 → 134 (+3%) | 9.0 → 8.8 | 115 → 115 | 16.8 @ 86 |
| Honda Ridgeline | truck, AWD | 280 → 272 (−3%) | 6.9 → 6.8 | 112 → 126 | 15.1 @ 91 |
| Chevy Silverado | truck, AWD | 355 → 327 (−8%) | 6.4 → 6.4 | 105 → 129 | 14.7 @ 95 |
| Chevy Colorado | truck, AWD | 308 → 278 (−10%) | 6.6 → 6.5 | 112 → 127 | 14.9 @ 93 |
| Chevy Camaro | sports, RWD | 455 → 437 (−4%) | 4.0 → 5.6 | 165 → 165 | 13.7 @ 109 |
| Chevy Corvette | sports, RWD | 490 → 603 (+23%) | 3.0 → 5.2 | 184 → 198 | 12.9 @ 124 |
| Chevy Equinox | SUV, FWD | 170 → 199 (+17%) | 9.2 → 8.6 | 115 → 121 | 16.9 @ 88 |
| Chevy Tahoe | SUV, AWD | 355 → 328 (−8%) | 7.0 → 6.9 | 112 → 129 | 15.1 @ 92 |
| Chevy Malibu | sedan, FWD | 160 → 239 (+49%) | 8.3 → 8.4 | 120 → 120 | 16.3 @ 94 |
| BMW 3 Series | sedan, RWD | 255 → 370 (+45%) | 5.4 → 5.9 | 130 → 130 | 14.3 @ 105 |
| BMW 5 Series | sedan, RWD | 248 → 357 (+44%) | 6.0 → 6.1 | 130 → 130 | 14.5 @ 102 |
| BMW X5 | SUV, AWD | 335 → 419 (+25%) | 5.3 → 4.9 | 130 → 136 | 13.6 @ 104 |
| BMW X3 | SUV, AWD | 248 → 290 (+17%) | 6.0 → 5.5 | 130 → 136 | 14.3 @ 97 |
| BMW M4 | coupe, RWD | 473 → 448 (−5%) | 3.8 → 5.8 | 155 → 155 | 13.9 @ 111 |
| BMW 4 Series | coupe, RWD | 255 → 385 (+51%) | 5.5 → 5.8 | 130 → 130 | 14.3 @ 106 |
| BMW Z4 | sports, RWD | 255 → 419 (+64%) | 5.2 → 5.6 | 155 → 155 | 13.7 @ 111 |

### Skidpad and braking

| Car | Tyre grip in the model | Skidpad, 300 ft | 60–0 mph |
| --- | --- | --- | --- |
| Toyota Camry | 1.02 | 0.97 g | 119 ft |
| Honda Civic | 1.02 | 0.97 g | 116 ft |
| Toyota Prius | 1.02 | 0.98 g | 122 ft |
| BMW 3 Series | 1.02 | 0.98 g | 117 ft |
| Ford Mustang | 1.08 | 1.04 g | 115 ft |
| Toyota Supra | 1.08 | 1.04 g | 115 ft |
| Chevy Corvette | 1.08 | 1.05 g | 115 ft |
| Honda Odyssey | 0.94 | 0.89 g | 131 ft |
| Ford F-150 | 0.92 | 0.88 g | 133 ft |
| Chevy Tahoe | 0.96 | 0.92 g | 128 ft |

Toyota Camry, changed: centre of gravity 30% higher, 0.969 g and 118.6 ft; 300 kg heavier, 0.968 g and 119.6 ft; stock, 0.971 g and 119.4 ft.

### Launch

| Car | Drive | 0–30 mph | Peak |
| --- | --- | --- | --- |
| Chevy Corvette | RWD | 2.32 s | 0.60 g |
| BMW M4 | RWD | 2.42 s | 0.57 g |
| Ford Mustang | RWD | 2.76 s | 0.60 g |
| Honda Civic | FWD | 3.87 s | 0.40 g |
| BMW X5 | AWD | 1.99 s | 0.90 g |

### One top-tier part at a time, Ford Mustang

Stock: 498 hp, 0–60 in 5.61 s, 13.62 s at 113 mph on the road; 460 hp and 4.3 s on the card.

| Part | Road: what changes | Card: what changes |
| --- | --- | --- |
| Engine | Power +33%, 0–60 −2%, quarter mile −3.4% | Power +25%, 0–60 −15% |
| ECU | Power +20%, 0–60 −2%, quarter mile −3.1% | Power +13%, 0–60 −9% |
| Turbo | Power +38%, 0–60 −2%, quarter mile −3.2% | Power +70%, 0–60 −32% |
| Nitrous | Up to 55% more torque for 8 s when fired | Power +28%, 0–60 −16% |
| Transmission | 0–60 −11%, quarter mile −5.1% | 0–60 −6% |
| Weight | Mass −10%, 0–60 −1%, quarter mile −1.5% | Mass −10%, 0–60 −8% |
| Tyres | Grip +0.18 g, 0–60 −13%, 60–0 −4% | Grip +0.09 g, 0–60 −3% |
| Suspension | Grip +0.10 g, 0–60 −6% | Grip +0.06 g |
| Brakes | 60–0 −1% | Grip +0.02 g |
| All nine | 1,102 hp, 0–60 in 3.87 s, 10.83 s at 157 mph, 1.33 g, 97 ft | 1,414 hp, 0–60 in 1.73 s, grip +0.17 g, reliability −293, durability −144 |

The card's costs are for a professional install with recent upkeep.

### Opponents

AI racers paced from a stock Ronin GT (221 hp), flying lap, catch-up rule off.

| Circuit | Stage 1 lap | Stage 5 lap | Sustained cornering, stage 1 → 5 |
| --- | --- | --- | --- |
| Harbour (3.29 km) | 1:54.0 | 1:53.8 | 2.5 → 2.6 g |
| Royal Park (5.77 km) | 2:15.0 | 1:58.5 | 2.2 → 3.3 g |
| Figure Eight (5.80 km) | 2:30.8 | 2:24.7 | 2.4 → 2.6 g |
| The Mountain (6.17 km) | 2:30.2 | 2:19.5 | 2.1 → 2.3 g |
| Ardennes (6.97 km) | 2:50.9 | 2:37.6 | 2.8 → 5.2 g |

Sustained cornering is the best one-second average of turn rate × speed. A lap-against-limit figure cannot be given cleanly yet: no circuit has a racing line and an opponent is not a car. The stage 4 driver model produces it.
