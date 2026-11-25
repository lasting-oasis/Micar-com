# The parts exam

DESIGN.md 11, last paragraph: every part's numbers are estimates until the parts exam says otherwise. The exam is
`src/exam.test.ts`, run on the eight pages in `data/exam` (researched and second-read; figures from search-result
summaries). Reproduce the table below, from `packages/physics`:

```
EXAM_TABLE=1 npx vitest run src/exam.test.ts
```

Run on 2026-11-24. Nothing in `parts.ts` was changed: no miss below has a fix inside a part's existing physics that
the data supports (each is explained under its page, and the changes it needs elsewhere are listed at the end).

## Verdict

**47 cases on 8 pages; 29 examined, 18 cannot be (reasons below). Of 57 figures examined, 39 land within the band,
18 miss. 17 of the 29 cases pass every figure; 12 miss at least one.** Each miss is recorded in `exam.test.ts`
(`RECORDED_MISSES`, with its reason here): a case passes when it misses exactly the figures recorded for it, so the
suite CI runs stays green while a new miss, or a recorded one the model meets again, still fails it. (The 330xi's
weight case, which missed its 60-0, is no longer examined: the record does not give the pounds removed and says the
case cannot be scored precisely, which is why the Tesla beside it was never examined.)

| page | cases examined | figures within the band | what the misses say |
| --- | --- | --- | --- |
| weight-reduction | 4 of 7 | 10 of 10 | mass is right on the strip |
| tyres-skidpad-braking | 2 of 3 | 4 of 4 | all-season to summer: skidpad and 70-0 both within the band |
| suspension-handling | 1 of 2 | 1 of 1 | springs and bars within 0.04 g (the band is wide against a 0.03 g change) |
| gearing-final-drive | 1 of 4 | 1 of 1 | a taller axle changes little, as measured |
| intake-exhaust | 6 of 6 | 8 of 12 | a hood-up V8 intake gain and a cat-back on an aftermarket turbo are larger than the parts give |
| nitrous | 4 of 8 | 5 of 7 | the shot's power is right on all three dynos; torque with the bottle depends on where the shot comes in |
| supercharger-on-v8 | 1 of 7 | 1 of 2 | the one kit with a stated boost is centrifugal: power right, torque gain twice the measured |
| tune-turbo-engine | 10 of 10 | 9 of 20 | stage-1 maps scatter from +4% to +36% power; the part's +10% sits in the lower half |

How a case is examined. The stock car is a sheet of its maker's published figures (only the 2024 Mustang GT has a
researched sheet, and its cases cannot be examined), the record's own stock figures where it has them, and the
resolver's class estimates for the rest. The catalogue part closest to the change is fitted, with the setup carrying a
size the record gives: boost (`boostTarget`), shot (`nitrousPower`), axle ratio (`finalDrive`). Weight has no part
that adds weight or takes a given number of pounds off, so the sheet's curb weight carries it (added over the rear
axle for a load in a bed, taken off at the centre of gravity otherwise). Both cars run on the bench; the measured
figure before the change times the bench's ratio, after over before, is the prediction (the card's own rule,
DESIGN.md 12), so wheel against crank figures cancel. Bands: peak power and torque 5%, quarter and eighth mile and
trap 4%, skidpad 0.04 g, braking 7%, 0-60 the validation's band (7% or 0.3 s, `calibrate.ts TOLERANCE`; DESIGN.md 11
gives none for 0-60). A nitrous car's dyno is a full-throttle pull in third with the button held, and its strip run the
bench's launch driver with the button held (the bench's drag runs now arm a kit too, rating.ts; the exam's own drivers
keep the button held through the pull as they always have).

## tune-turbo-engine: an ECU tune on a factory turbo engine

`tune-1` raises full boost by 0.22 atm (3.2 psi) above the stock peak. Where the record gives the boost after the
tune, the setup's `boostTarget` sets it (on the 2015 EcoBoost the 25 psi asked is held at 23.5 psi by the pump-fuel
knock limit, pressure ratio 2.6).

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2015 Mustang EcoBoost (confirmed) | SCT 93-octane map, 20 to 25 psi: tune-1 set to 25 psi | power | 273.2 to 291.8 hp (+6.8%) | +11.4% | 304.5 | +12.7 / 14.6 | pass |
| | | | torque | 303.8 to 339.9 lb ft (+11.9%) | +9.1% | 331.3 | -8.6 / 17.0 | pass |
| 1 | 2017 Mustang EcoBoost (confirmed) | COBB Stage 1, 21 to 22.93 psi: tune-1 set to 22.93 psi | power | 230.32 to 275.16 (+19.5%) | +4.9% | 241.6 | -33.6 / 13.8 | MISS |
| | | | torque | 275.49 to 345.41 (+25.4%) | +4.8% | 288.8 | -56.6 / 17.3 | MISS |
| 2 | Mustang EcoBoost S550 (confirmed) | COBB Stage 1: tune-1 | power | 221 to 230 (+4.1%) | +10.0% | 243.2 | +13.2 / 11.5 | MISS |
| | | | torque | 261 to 301 (+15.3%) | +9.9% | 286.9 | -14.1 / 15.1 | pass |
| 3 | 2020 GR Supra (confirmed) | EcuTek, 21 psi to redline: tune-1 set to 21 psi (stock boost not given: the class's 14.5 psi) | power | 336.86 to 444.76 (+32.0%) | +20.1% | 404.5 | -40.3 / 22.2 | MISS |
| | | | torque | 412.16 to 542.22 (+31.6%) | +20.0% | 494.5 | -47.7 / 27.1 | MISS |
| 4 | GR Supra (confirmed) | VR Tuned flash: tune-1 | power | 310 to 372 (+20.0%) | +10.1% | 341.2 | -30.8 / 18.6 | MISS |
| | | | torque | 391 to 429 (+9.7%) | +10.0% | 430.2 | +1.2 / 21.5 | pass |
| 5 | 2018 Civic Type R (confirmed) | Hondata FlashPro: tune-1 | power | 293.25 to 314.15 (+7.1%) | +10.1% | 322.9 | +8.8 / 15.7 | pass |
| | | | torque | 282.84 to 332.27 (+17.5%) | +9.9% | 310.9 | -21.3 / 16.6 | MISS |
| 6 | 2019 Civic Si (unconfirmed) | FlashPro, 18.87 to 22.49 psi: tune-1 set to 22.49 psi | power | 189.81 to 203.88 (+7.4%) | +9.8% | 208.4 | +4.5 / 10.2 | pass |
| | | | torque | 190.58 to 214.7 (+12.7%) | +9.7% | 209.1 | -5.6 / 10.7 | pass |
| 7 | 2015 Golf R, DSG (confirmed) | APR Stage I: tune-1 | 0-60 | 4.641 to 3.869 s (-16.6%) | -6.3% | 4.35 | +0.48 / 0.30 | MISS |
| | | | quarter | 12.849 to 11.956 s (-6.9%) | -2.7% | 12.51 | +0.55 / 0.48 | MISS |
| | | | trap | 105.3 to 113.733 mph (+8.0%) | +3.2% | 108.7 | -5.0 / 4.5 | MISS |
| 8 | Golf R Mk8 (unconfirmed) | Racing Line plug-in module: tune-1 | 0-60 | 4.18 to 4.07 s (-2.6%) | -5.8% | 3.94 | -0.13 / 0.30 | pass |
| | | | quarter | 12.46 to 12.28 s (-1.4%) | -2.6% | 12.14 | -0.14 / 0.49 | pass |
| 9 | GTI Mk7 (unconfirmed) | Unitronic Stage 1+, intake on both runs: intake-1, then tune-1 | power | 207 to 282 (+36.2%) | +10.3% | 228.4 | -53.6 / 14.1 | MISS |

Why the misses stand. The part's boost is right: where the record gives both boosts the tune raised them by 0.13,
0.25 and 0.34 atm (mean 0.24 against the part's 0.22), and with the boost set to the measured figure the bench lands
within the band on two of the three (cases 0 and 6). What a stage-1 map does beyond boost varies far more than any
band: the same COBB Stage 1 on the same engine measured +19.5% power on one dyno (case 1, on +1.9 psi) and +4.1% on
another (case 2). Across the eight dyno cases power rose +4% to +36% (median +13.5%) and torque +10% to +32% (median
+15.3%, seven cases); the part gives +10% of each, so it sits in the lower half of real stage-1 results, and it misses on both
sides. A stock-turbo map usually gains more torque than power (five cases of seven; COBB's own Focus ST notes say
the same), which the part, scaling boost the same at every speed, does not reproduce.

Tried and rejected (the timing a map adds, which the unboosted `tune-1` has as x1.025 and the boosted one lacks), on
the 15 dyno figures: as the part stands 7 within the band; adding x1.025 everywhere 6; adding 5% in the mid-range
fading to nothing at the power peak 8; 8% the same way 6. One figure gained for a fitted shape is not evidence of
physics, so nothing was changed. Case 7's trap gain (+8%) needs about +26% power by the cube law (trap speed goes as
the cube root of power over weight): a map that large is more than the catalogue's stage 1.

## intake-exhaust: an intake or a cat-back alone, stock calibration

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2018 Civic Type R (confirmed) | AEM intake: intake-1 | power | 293.25 to 297.01 (+1.3%) | +1.1% | 296.5 | -0.5 / 14.9 | pass |
| | | | torque | 282.84 to 280.38 (-0.9%) | +0.5% | 284.3 | +3.9 / 14.0 | pass |
| 1 | 2018 Civic Type R (confirmed) | REMARK cat-back: exhaust-1 | power | 293.25 to 296.66 (+1.2%) | +1.4% | 297.3 | +0.6 / 14.8 | pass |
| | | | torque | 282.84 to 299.16 (+5.8%) | +0.6% | 284.7 | -14.5 / 15.0 | pass |
| 2 | 2010 Camaro SS L99 (confirmed) | K&N Aircharger intake: intake-1 | power | 312.9 to 337.9 (+8.0%) | +1.2% | 316.8 | -21.1 / 16.9 | MISS |
| | | | torque | 331.5 to 352.26 (+6.3%) | +0.6% | 333.6 | -18.6 / 17.6 | MISS |
| 3 | Subaru BRZ (confirmed) | ARK cat-back: exhaust-1 | power | 148 to 152.8 (+3.2%) | +1.5% | 150.3 | -2.5 / 7.6 | pass |
| | | | torque | 118.3 to 121 (+2.3%) | +1.3% | 119.9 | -1.1 / 6.1 | pass |
| 4 | 2015 Scion FR-S with a turbo kit (confirmed) | JBA cat-back: turbo-kit-1 on both runs (the kit's boost is not given), then exhaust-1 | power | 246 to 263 (+6.9%) | +1.5% | 249.7 | -13.3 / 13.2 | MISS |
| | | | torque | 223 to 240 (+7.6%) | +1.3% | 225.9 | -14.1 / 12.0 | MISS |
| 5 | 2017 Civic Si (unconfirmed) | PRL intake: intake-1 | power | 186 to 191 (+2.7%) | +1.0% | 187.8 | -3.2 / 9.6 | pass |
| | | | torque | 215 to 216 (+0.5%) | +0.8% | 216.6 | +0.6 / 10.8 | pass |

Why the misses stand. Case 2 is the only intake on an unboosted engine, run hood up; the record's own check calls
its +25 hp "at or above the top of the plausible range" (K&N's own figure for the same engine is +18.6 hp). One case
is not evidence to change `intake-1`. Case 4 is a cat-back on an aftermarket turbo kit with no electronic boost
control, where a freer exhaust also raises boost; the part's breathing curve is an unboosted engine's. With the Type
R's torque (+5.8% measured, +0.6% predicted, inside the band by 0.5 lb ft) it suggests a cat-back is worth more on a
turbo engine, but two cases, one at the band's edge and one with an unknown kit, are not enough to set a new curve:
reported, not fixed. Note how small these changes are: the intake and exhaust gains on the Type R are inside the
record's own day-to-day dyno spread, so their passes say little.

## nitrous

The shot is the part's (`nitrous-2` 100 hp, `nitrous-3` 150 hp; case 0's 75 hp jets by `nitrousPower` 0.75). Case 0's
car already had an intake, a full exhaust and a custom tune, fitted on both runs as intake-1, exhaust-1 and -2 and
tune-2.

| case | car (check) | change | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2011 Mustang GT, bolt-ons (confirmed) | ZEX, 75 hp jets | power | 415.5 to 483.8 (+16.4%) | +16.6% | 484.4 | +0.6 / 24.2 | pass |
| | | | torque | 400.8 to 498.6 (+24.4%) | +29.1% | 517.6 | +19.0 / 24.9 | pass |
| 2 | Ford 347 stroker, engine (confirmed) | ZEX, 100 hp | power | 441 to 569 (+29.0%) | +27.5% | 562.3 | -6.7 / 28.5 | pass |
| | | | torque | 405 to 519 (+28.1%) | +42.4% | 576.6 | +57.6 / 26.0 | MISS |
| 3 | Ford 347 stroker, engine (confirmed) | ZEX, 150 hp | power | 441 to 612 (+38.8%) | +36.1% | 600.3 | -11.7 / 30.6 | pass |
| | | | torque | 405 to 574 (+41.7%) | +65.5% | 670.1 | +96.1 / 28.7 | MISS |
| 6 | 2005 Mustang GT (unconfirmed) | 100 shot, strip | quarter | 13.723 to 12.926 s (-5.8%) | -3.3% | 13.27 | +0.34 / 0.52 | pass |

Why the misses stand. The shot's power is right on all three dynos (within 2%). Its torque is P / engine speed, so
the torque with the bottle is set by the speed at which the shot comes in: the core's window opens at 0.4 of redline
(`driveline.ts NITROUS_WINDOW`), 2,735 rpm on the stroker, where 100 hp is another 192 lb ft. The 347 was run on what
the record suggests is an engine dyno, whose pull and window start are not given; its measured torque is what the
shot gives from about 0.65 of redline (about 4,400 rpm) up. The Mustang on a chassis dyno passes at the core's window;
the 2013 Mustang on page 1 had its window switch set "just after 3,000 rpm" (0.43 of redline). So the window is an
installer's setting the 347 record does not give, not a fault of the part's shot; the fix is outside `parts.ts`
(below). The strip case passes, though the bench's gain is a little smaller than measured.

Note for the card: `rating.ts benchFigures` adds the shot to peak horsepower but leaves peak torque the engine's own,
while all three dyno records show torque rising with the shot (+24% to +42%).

## supercharger-on-v8

The catalogue's supercharger kits are positive-displacement blowers (DESIGN.md 11: boost "there from idle", 60% of
it at idle, all of it by the stock torque peak). A kit's size is its boost; six of the seven records do not give it,
so only case 2 is examined.

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 2018 Mustang GT, 10R80 (confirmed) | ProCharger P-1X, 10 psi at 7,800 rpm, cat-delete pipes: supercharger-kit-2 set to 10 psi, exhaust-1 | power | 433 to 620 (+43.2%) | +45.6% | 630.3 | +10.3 / 31.0 | pass |
| | | | torque | 375 to 451 (+20.3%) | +42.8% | 535.3 | +84.3 / 22.6 | MISS |

Why the miss stands. The ProCharger is a centrifugal compressor: its boost grows with the square of engine speed, so
at the 4,600 rpm torque peak it makes about 10 x (4,600 / 7,800)^2 = 3.5 psi, not 10. With the same kit's table made
that shape (boost (speed / 7,800 rpm)^2, 10 psi there) the bench gives +39.6% power and +20.4% torque: 604.5 hp and
451.5 lb ft predicted, both within the band. The records not examined say the same: torque gain over power gain is
0.74, 0.47 and 0.63 on the three centrifugal kits (cases 1, 2, 5) and 1.02 and 0.86 on the positive-displacement ones
(cases 3, 6); the catalogue's kit gives 0.94 to 0.98. The kit's physics is right for what it is; the catalogue has no
centrifugal kit. Adding one is a catalogue change (below), not a fix of an existing part.

Indicative only, the records without a boost (printed by the command above, not asserted):

| case | measured | kit-1 (6 psi) | kit-2 (9 psi) | kit-3 (12 psi) |
| --- | --- | --- | --- | --- |
| 0 Dark Horse, Ford Performance kit (Edmunds) | 0-60 -11.4%, quarter -7.9%, trap +11.2% | 0-60 -0.5%, quarter -2.3%, trap +4.5% | -0.3%, -3.4%, +8.1% | -0.1%, -4.2%, +11.2% |
| 1 2024 Mustang GT, ProCharger Stage 2 and supporting mods | power +73.8%, torque +54.3% | +21.2%, +20.5% | +38.0%, +36.7% | +54.4%, +52.6% |
| 3 2017 Corvette Grand Sport, E-Force (baseline another car) | +37.1%, +37.7% | +21.1%, +20.6% | +37.9%, +36.9% | +54.3%, +52.9% |
| 4 2017 Corvette Grand Sport, E-Force Stage 1 | power +16.3% | +21.1% | +37.9% | +54.3% |
| 5 C7 Stingray, A&A kit at 5,280 ft (SAE corrected) | +47.2%, +29.9% | +21.2%, +20.6% | +37.9%, +37.0% | +54.4%, +53.0% |
| 6 Camaro SS, Whipple 3.0 | +62.8%, +53.8% | +21.2%, +20.6% | +37.9%, +37.0% | +54.4%, +53.0% |

The Dark Horse row is worth a look by whoever owns the launch: with 54% more power (Ford rates the kit 810 hp against
500, +62%) the bench's trap speed rises exactly as Edmunds measured, but its 0-60 does not move (which says the
bench's launch of this car is held at the rear tyres all the way to 60 mph), where Edmunds' car went 0.5 s quicker.

## suspension-handling

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2010 Camaro SS (unconfirmed) | Hotchkis lowering springs, adjustable bars, subframe brace: springs-1, arb-2 (no part for the brace) | skidpad, 200 ft | 0.85 to 0.88 g (+3.5%) | +1.1% | 0.859 | -0.021 / 0.040 | pass |

Within the band, but the band (0.04 g) is wider than the change measured (0.03 g), so this pass says only that the
parts do not do something absurd. The bench's gain is a third of the measured one; the stock and modified figures come
from two different cars on the maker's own day.

## tyres-skidpad-braking

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2017 Fusion Sport (confirmed) | all-season to summer: tyres-summer | skidpad, 300 ft | 0.84 to 0.89 g (+6.0%) | +8.9% | 0.914 | +0.024 / 0.040 | pass |
| | | | 70-0 | 178 to 155 ft (-12.9%) | -10.4% | 159.4 | +4.4 / 10.9 | pass |
| 2 | 2025 Maverick Lobo (unconfirmed) | all-season to Pilot Sport 4: tyres-summer | skidpad, 300 ft | 0.85 to 0.90 g (+5.9%) | +8.6% | 0.923 | +0.023 / 0.040 | pass |
| | | | 70-0 | 188 to 164 ft (-12.8%) | -10.4% | 168.4 | +4.4 / 11.5 | pass |

Both pass, both a little generous on the skidpad (+0.024 g) and a little short on the stop (2.7%): the category step
in `classes.ts TYRE_CATEGORY` (0.92 to 1.02 friction) is about the size two magazine tests measured.

## weight-reduction

| case | car (check) | change, on the sheet | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2025 Ram 1500 Tungsten (confirmed) | +1,000 lb over the rear axle | 0-60 | 4.75 to 5.27 s (+10.9%) | +10.6% | 5.26 | -0.01 / 0.37 | pass |
| | | | quarter | 13.00 to 13.53 s (+4.1%) | +4.1% | 13.54 | +0.01 / 0.54 | pass |
| | | | trap | 104.91 to 101.85 mph (-2.9%) | -4.4% | 100.3 | -1.5 / 4.1 | pass |
| 1 | 2024 F-150 PowerBoost (confirmed) | +1,000 lb over the rear axle | 0-60 | 5.62 to 6.18 s (+10.0%) | +11.1% | 6.24 | +0.06 / 0.43 | pass |
| | | | quarter | 13.82 to 14.40 s (+4.2%) | +4.3% | 14.41 | +0.01 / 0.58 | pass |
| | | | trap | 99.88 to 96.04 mph (-3.8%) | -4.2% | 95.7 | -0.4 / 3.8 | pass |
| 2 | 2024 Sierra Denali Ultimate (confirmed) | +1,000 lb over the rear axle | 0-60 | 6.16 to 6.99 s (+13.5%) | +11.6% | 6.88 | -0.11 / 0.49 | pass |
| | | | quarter | 14.17 to 14.92 s (+5.3%) | +4.4% | 14.80 | -0.12 / 0.60 | pass |
| | | | trap | 99.34 to 94.6 mph (-4.8%) | -4.6% | 94.8 | +0.2 / 3.8 | pass |
| 3 | Crown Victoria P71 (confirmed) | -1,005 lb at the centre of gravity | eighth | 10.79 to 10.32 s (-4.4%) | -5.8% | 10.17 | -0.15 / 0.41 | pass |
Not examined: case 5 (BMW 330xi). The record gives no pounds removed ("about 10%" in one summary, "~200 lbs" in
another), its 0-60 before is an average and after a best run, and its stop 17% shorter from a tenth less weight is not
a mass effect (a first stop is the tyres': a tenth less weight takes a tenth off the load and nearly a tenth off the
grip; the record says so itself, "which suggests conditions differed"). Examined at an assumed 10% (337 lb), it met
the 0-60 band and missed the 60-0 by 26.9 ft against 9.9; the Tesla beside it, with the same gap, was never examined.

## gearing-final-drive

| case | car (check) | change, as fitted | figure | measured | bench | predicted | error / band | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2018 Mustang GT, 10R80 (unconfirmed) | 3.55 to 3.15 axle: the setup's finalDrive x0.887 | quarter | 11.48 to 11.3 s (-1.6%) | -0.3% | 11.45 | +0.15 / 0.45 | pass |

Within the band; the record's own check puts 3.15 and 3.55 cars within 0.1 s of each other, which is what the bench
says (a ten-speed box hides most of an axle change).

## Cases that cannot be examined

| page | case | why |
| --- | --- | --- |
| gearing-final-drive | 0 Corvette, 3.42 to 3.90 | the car is not identified (generation, engine and gearbox, which changes what a 3.42 means); only a 60-ft pair |
| gearing-final-drive | 2 turbo Mustang, 3.73 to 3.31 | car, engine and turbo kit not identified; the run before ran out of revs before the line |
| gearing-final-drive | 3 Land Cruiser, to 4.88 | the ratio before and the tyre size are not given |
| nitrous | 1 2013 Mustang GT, NX plate | shot not given; quarter with nitrous not given; the bottle not settled as the only change |
| nitrous | 4 2016 Camaro SS, 150 shot (news reports) | a custom calibration and drag radials came with the kit |
| nitrous | 5 2016 Camaro SS, 150 shot (owner) | not second-read (no check mark); the exam takes confirmed and unconfirmed cases |
| nitrous | 7 unidentified Mustang, 100 shot | the car is not identified |
| supercharger-on-v8 | 0, 1, 3, 4, 5, 6 | the kit's boost is not given (1 also has unspecified supporting mods, 3 a baseline from another car, 6 unverified after figures); indicative table above |
| suspension-handling | 1 BMW 328i, slalom | the bench runs no slalom; the parts on the car are not named |
| tyres-skidpad-braking | 1 2009 Civic Si | wet-surface stops; the bench brakes on dry asphalt |
| weight-reduction | 5 BMW 330xi, interior out | the pounds removed are not given; an average before against a best after; the stop's change is not a mass effect |
| weight-reduction | 4 Fiesta ST | generation not given; doors off (the aero changed) and new seats; 0-62 mph only |
| weight-reduction | 6 Tesla Model 3 Performance | the weight removed is not given; the body panels came off |

## Stock figures supplied for the exam

The records carry few stock figures. Those below are the makers' published ratings as I know them, marked in each
sheet with the source "maker's published rating, supplied for the parts exam": they were not read from a page for this
exam and should be confirmed by a researcher. Figures marked (record) come from the exam record itself. A figure not
listed is the resolver's class estimate.

- Mustang EcoBoost 2015 and S550 (year not given): 2.3 L turbo four, 310 hp at 5,500 rpm, 320 lb ft at 3,000 rpm,
  rear drive. The 2017's rating (310 hp at 5,500, 320 lb ft at 2,500) is the record's; boost 20 and 21 psi (record).
- GR Supra 2020: 3.0 L turbo six, 335 hp at 5,000 rpm, 365 lb ft from 1,600 to 4,500 rpm, rear drive, automatic.
- Civic Type R 2018: 2.0 L turbo four, 306 hp at 6,500 rpm, 295 lb ft from 2,500 to 4,500 rpm, 7,000 rpm redline,
  front drive, manual.
- Civic Si 2017 and 2019: 1.5 L turbo four, 205 hp at 5,700 rpm, 192 lb ft from 2,100 to 5,000 rpm, 6,500 rpm
  redline, front drive, manual; 18.87 psi (record, case 6 only).
- Golf R 2015 (US, DSG): 292 hp at 5,400 rpm, 280 lb ft from 1,800 to 5,500 rpm, 6,500 rpm redline, all-wheel drive
  (front on demand), dual-clutch, 3,340 lb, 235/35R19 summer.
- Golf R 2022 (Mk8 US, DSG): 315 hp at 5,600 rpm, 295 lb ft from 2,100 to 5,350 rpm, 6,500 rpm, all-wheel drive,
  dual-clutch, 3,435 lb, 235/35R19 summer.
- GTI Mk7: 210 hp (peak taken at 6,200 rpm), 258 lb ft from 1,500 to 4,500 rpm, front drive.
- Camaro SS 2010, L99: 400 hp (record) at 5,900 rpm, 410 lb ft at 4,300 rpm, automatic. LS3 manual (handling page):
  426 hp at 5,900, 420 lb ft at 4,600, 3,860 lb, 52% front, 112.3 in wheelbase, 245/45R20 and 275/40R20 summer.
- BRZ and FR-S (FA20): 200 hp and 151 lb ft (record) at 7,000 and 6,400 to 6,600 rpm, 7,400 rpm redline, manual,
  2,762 lb, 215/45R17.
- Mustang GT 2011: 5.0 L, 412 hp at 6,500 rpm, 390 lb ft at 4,250 rpm, 7,000 rpm redline.
- Ford 347 stroker: 441 hp at 6,500 rpm, 405 lb ft at 5,000 rpm (record); 5.69 L from 347 cubic inches; a coupe's
  class figures for the car around it.
- Mustang GT 2005: 4.6 L three-valve, 300 hp at 5,750 rpm, 320 lb ft at 4,500 rpm, 6,250 rpm redline, 3,483 lb,
  235/55R17 all-season.
- Mustang GT 2018, 10R80: 460 hp at 7,000 rpm, 420 lb ft at 4,600 rpm, 7,500 rpm redline, ratios 4.696, 2.985,
  2.146, 1.769, 1.520, 1.275, 1.000, 0.854, 0.689, 0.636, axle 3.55 (record), 3,705 lb.
- Fusion Sport 2017: 2.7 L twin-turbo V6, 325 hp at 5,500 rpm, 380 lb ft at 3,500 rpm, all-wheel drive, automatic,
  3,989 lb, 235/40R19 all-season.
- Maverick Lobo 2025: 2.0 L turbo four, 250 hp at 5,500 rpm, 277 lb ft at 3,000 rpm, front drive, automatic; weight
  and tyre size the class's (a pickup's 2,300 kg and 275/65R18); the prediction is a ratio over a change of category
  alone, which these hardly move.
- Ram 1500 Tungsten 2025: 3.0 L twin-turbo six, 540 hp (record), 521 lb ft, four-wheel drive, automatic, 5,900 lb
  (approximate). F-150 Platinum PowerBoost 2024: 3.5 L twin-turbo V6 hybrid, 430 hp (record), 570 lb ft, 5,700 lb
  (approximate). Sierra 1500 Denali Ultimate 2024: 6.2 L V8, 420 hp (record) at 5,600 rpm, 460 lb ft at 4,100 rpm,
  5,550 lb (approximate). A curb weight 5% out moves these predicted changes by 0.1 to 0.3 points (the Ram at 5,600,
  5,900 and 6,200 lb: quarter +4.22%, +4.14%, +4.02%; 0-60 +10.9%, +10.6%, +10.3%).
- Crown Victoria P71: 4.6 L, 250 hp at 4,900 rpm, 297 lb ft at 4,000 rpm, four-speed 2.84, 1.55, 1.00, 0.70, axle
  3.27, 4,101 lb (record), 235/55R17.
- BMW 330xi (E46): 3.0 L six, 225 hp at 5,900 rpm, 214 lb ft at 3,500 rpm, all-wheel drive, 3,370 lb (record).
- Indicative only: Mustang Dark Horse 2024 (the researched GT's sheet with 500 hp at 7,250 rpm, 418 lb ft at 4,900
  rpm, 7,500 rpm redline, the 10R80, a 3.73 axle, 255/40R19 and 275/40R19); LT1 6.2 L at 460 hp / 465 lb ft (Grand
  Sport), 455 / 460 (C7 Stingray), 455 / 455 (Camaro SS).

## What would change the misses (outside `parts.ts`, not done)

1. **A centrifugal supercharger kit** (DESIGN.md 11 table, `parts.ts PARTS`, `parts.test.ts`'s every-part table):
   for example `centrifugal-kit-1/2/3` at 6, 9 and 12 psi reached at the stock redline, the pressure ratio's gauge
   part growing as (speed / redline)^2, no boost at idle, a crank-driven compressor's drive taken as the blower's is.
   On case 2 that shape lands power at -2.5% and torque at +0.1%.
2. **The nitrous window as a kit setting** (`types.ts NitrousModel`, `Setup`, `driveline.ts`): the window share
   (now `NITROUS_WINDOW = 0.4` in `driveline.ts`) carried on the model with 0.4 as its default, so a build can say
   where its window switch is set. The default itself is supported by the two Mustangs; the 347's misses are its
   unstated dyno pull.
3. **Pounds removed as a size**: `FittedPart.value` (`types.ts`: "where the part has a size") is not read by
   `parts.ts`; `weight-1/2/3` reading a mass in kg from it would let the exam fit the part instead of the sheet.
4. **DESIGN.md 11's last paragraph** names `parts.test.ts` as the exam's file; it is `exam.test.ts`.
5. **The basis of the parts the exam confirms** (tyres-summer, intake-1 on turbo engines, exhaust-1 on an unboosted
   engine, the nitrous shot's power, mass on the strip): DESIGN.md 11 says estimated "until the parts exam says
   otherwise", and `parts.ts` still marks them estimated (as `parts.test.ts` asserts); `Basis` has no value for
   "examined". A contract decision, not made here.
