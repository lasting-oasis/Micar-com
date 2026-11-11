# @micar/engine

The engine that turns a real vehicle into a MiCar card. Pure TypeScript: no React, no DOM, no Node, no clock and no randomness. You pass in the day, the timestamp, the ids and the seed, so every result can be reproduced. Two apps import it as source (the value app and MiCar World), and anything else can.

A vehicle is described by three layers that never mix:

| Layer | What it is | Where |
| --- | --- | --- |
| A. Base stats | The factory specification of the exact configuration, scored | `normalize.ts` |
| B. Vehicle stats | That base after this vehicle's modifications, wear and documented repairs | `modifications.ts`, `condition.ts`, `performance.ts` |
| C. The grade | Identity, paperwork, condition, originality and verification. Never performance | `grading.ts`, `certification.ts` |

Nothing in the package knows a price. Market value lives in the value app and no type here carries one. A test scans every import in the package to keep it that way.

```ts
import { assemble, EMPTY_REGISTRY } from '@micar/engine';

const { card, stats, report, certification } = assemble(passport, EMPTY_REGISTRY, '2026-11-10');
card.powerRating;          // 783
stats.vehicle.scores.power // { value: 950, basis: 'measured', metric: 564.3, ... }
report.grade10;            // 5.2
certification.level;       // 'documented'
```

## Modules

| Module | What it does |
| --- | --- |
| `types.ts` | Every shared type |
| `rules.ts` | Ruleset v1: every scoring table and constant |
| `specs.ts` | Builds and checks specifications from loose input. A value out of range is refused, never clipped |
| `database.ts`, `data/` | The reference catalogue and the two example vehicles |
| `normalize.ts` | Specification in, seven scores and the Power Rating out |
| `condition.ts` | Wear by system from miles, years, documented replacements and inspections |
| `modifications.ts` | The modification catalogue and what each one does |
| `performance.ts` | The three stat layers with every adjustment itemised |
| `vin.ts`, `identity.ts` | VIN check digit and model year; the MiCar ID |
| `passport.ts` | The vehicle's identity and append-only history |
| `verification.ts` | Verifiers, attestations, evidence levels and the mileage log |
| `public.ts` | The public view: what anyone may be shown of a passport |
| `grading.ts` | The five-part grade |
| `certification.ts` | Registered, Documented, Verified, Certified |
| `cards.ts` | Rarity, finish, editions, snapshots and `assemble()` |
| `game.ts` | Card races, classes and setup cards |

## Where a figure comes from

Every specification field is a value with its source, or it is `null`. A source says what kind it is:

| Kind | Meaning |
| --- | --- |
| `manufacturer` | The maker's own site, brochure, press kit or manual |
| `agency` | A government body, such as the EPA's fuel-economy data |
| `test` | An independent instrumented test |
| `reference` | A secondary listing nobody has checked against a primary document |
| `owner` | Typed in by the vehicle's owner |
| `illustrative` | A placeholder for demonstration, not data about a real vehicle |

A score reports the weakest source among its inputs (`illustrative` < `owner` < `reference` < `sourced`). `verified` is granted only by an independent verifier's attestation, never by the data.

The reference catalogue (`CATALOGUE`) was gathered from public sources through web search on 2026-11-10. Pages could not be opened, so no figure in it was checked against a primary document: every figure is `kind: 'reference'` with the publisher and URL the search gave. `scripts/build-catalogue.ts` builds it from the researchers' records in `data/research/` and writes down every edit it makes. The example vehicles (`EXAMPLES`) are placeholders and are labelled `illustrative` everywhere.

## The seven attributes (ruleset `micar-rules-v1`)

Each attribute reads one quantity from the specification and looks it up in a table of anchors: straight lines between the points, flat beyond the ends, rounded to a whole score from 0 to 1000. The same tables score every vehicle. All of them are in `rules.ts`.

| Attribute | Reads | When the figure is missing |
| --- | --- | --- |
| POWER | An output index: 0.7 × horsepower + 0.3 × torque (lb-ft) | With no torque on file, torque is taken as 60% of the horsepower figure, marked `estimated`. No score without horsepower |
| SPEED | Top speed, mph | Estimated from power, marked `estimated`. No score without horsepower |
| ACCELERATION | 0 to 60 mph, seconds | Estimated from weight and power, marked `estimated`. No score without both |
| HANDLING | A grip index in g: skidpad grip plus a control term | Grip modelled from class, weight and suspension grade, marked `modelled`. No score without weight |
| DURABILITY | A modelled index in points | Always `modelled`. No score without weight and, for a petrol or diesel engine, horsepower and displacement |
| RELIABILITY | A modelled index in points | Always `modelled`. No score until everything it reads is on file: powertrain, transmission type, drivetrain; unless electric, induction and cylinders; for a petrol or diesel engine, horsepower and displacement |
| EFFICIENCY | EPA combined MPG, or MPGe for an electric powertrain | The EPA's own blend of city and highway (55% / 45%, harmonic, to the whole number). Otherwise no score |

A score is never invented. `basis` says how it was reached: `measured`, `modelled`, `estimated`, `illustrative` or `unavailable` (value `null`). Pass `{ estimates: false }` to `scoreSpec` and every `estimated` score becomes `unavailable`. Every score also lists the fields it read (`inputs`) and the ones that would enable it or firm it up (`missing`).

**Clearing a field never raises a score.** Three rules keep it so, and a test clears every configuration field of some eight thousand complete specifications, one at a time, to check it.

- A term that can only take points away (engine stress, a complicated drivetrain, more than eight cylinders) is never skipped because its figure is missing: the score is withheld and names the field.
- Where a choice is blank and one of its options would cost the car something, the blank is read as the option that costs most, and the score names the field as missing: a blank drivetrain takes the slowest drivetrain's factor in the 0 to 60 estimate and the lowest factor off-road, a blank transmission takes the CVT's, a blank suspension grade takes the grade with the least grip, and a blank ground clearance takes the lowest clearance factor.
- A figure an estimate cannot do without is required, not stood in for: there is no top speed estimate without the curb weight (the class's usual weight used to stand in, and flattered every car heavier than it).

The estimates of a figure that is itself missing (a top speed, a 0 to 60 time, torque) lean low on purpose, so entering the real figure nearly always helps. They are estimates, and a car that is in fact slower than its estimate scores lower once its real figure is entered.

**POWER is not horsepower.** It blends horsepower with torque and reads a curve that flattens as output grows: 152 → 404, 300 → 650, 564.3 → 950, 1000 → 990.

**The estimates.** Top speed starts from the speed at which power at the wheels (85% of rated) equals aerodynamic drag plus rolling resistance, using a drag area typical of the class; a car reaches about 87% of that (gearing, cooling and downforce take the rest); and the result is capped at the limiter usual for the class. The limiter climbs in a straight line from the class's own figure to its performance limit (155 mph; 118 for a pickup, 112 for an off-roader, 120 for a van) as horsepower per pound goes from 0.075 to 0.115, so one more horsepower never moves an estimate by more than a fraction of a mile an hour. It needs horsepower and curb weight: with either missing, SPEED is not rated and says which. 0 to 60 is `1.0 × (lb / hp)^0.75 × drivetrain factor` (AWD 0.9, 4WD 0.97, RWD 1, FWD 1.03, and 1.03 when blank; × 0.9 for an electric powertrain; × 1.08 for a CVT or a blank transmission), never below 1.9 s. With no torque on file, POWER takes torque as 60% of the horsepower figure, which is under nearly every production engine (the highest-revving road engines make about 0.64 lb-ft for each horsepower).

**HANDLING.** The grip index is the measured skidpad figure when one is on file. Otherwise it is modelled: the class's typical grip, a small term for weight against the class's typical weight (−0.02 g per 1,000 lb heavier, within ±0.03 g), and the suspension grade (sport +0.03, adaptive +0.04, off-road −0.03). In both cases a control term is added: all-wheel drive +0.01, rear-wheel drive +0.005, performance brakes +0.01, carbon-ceramic brakes +0.02.

**DURABILITY** is resistance to wear and physical damage as the build implies it. It is not a survey of failures.

```
points = class base + frame + mass + drivetrain + clearance − engine stress
class base  sports 634, coupe 630, hatchback 620, sedan 640, wagon 650, van 660, SUV 690, pickup 720, off-road 740
frame       body-on-frame +60
mass        0.04 per lb of curb weight above 3,000, from −40 to +100
drivetrain  4WD +30, AWD +15
clearance   8 per inch of ground clearance above 6, up to +40
stress      0.5 per hp/litre above 90, up to −80. Petrol and diesel engines only: a hybrid's horsepower is its
            system output, not its engine's, and an electric motor has no displacement
```

**RELIABILITY** is mechanical dependability as the design implies it: how complicated and how highly stressed the powertrain is, and how long the maker warrants it. It is not a survey of failures and it knows nothing of a brand's reputation. `VehicleSpec` has room for nothing of that kind on purpose: a future source of measured dependability would be a new, separately sourced input.

```
points = 835 + induction + transmission + drivetrain + warranty − stress − many cylinders
induction     natural +40, turbo −30, twin-turbo −60, quad-turbo −100, supercharged −40, both −80; electric powertrain +60; plug-in hybrid −20
transmission  manual +20, automatic 0, dual-clutch −30, CVT −20, hybrid e-CVT +20, single-speed +30
drivetrain    AWD −10, 4WD −10
warranty      0.75 per 1,000 warranted powertrain miles above 60,000, up to +30 (a shorter warranty, or none on file, earns nothing)
stress        0.6 per hp/litre above 100, up to −90. Petrol and diesel engines only, as for DURABILITY
cylinders     more than 8: −30
```

**The Power Rating** is the weighted mean of the seven, rounded. Ruleset v1 weighs them equally (1/7 each). It is `null` until all seven have a value; `provisionalRating` is the same mean over the attributes that do, and should always be shown as provisional.

### The calibration vehicle

The tables are pinned so the reference specification of the 2024 Nissan GT-R NISMO scores exactly the example the product brief gave. Those seven numbers were given as illustrative placeholders; the tables make them the fixed point everything else is measured against. `normalize.test.ts` and `database.test.ts` hold it there.

| Vehicle (reference data) | POWER | SPEED | ACCEL | HANDLING | DURABILITY | RELIABILITY | EFFICIENCY | Rating |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2024 Nissan GT-R NISMO | 950 | 920 | 880 | 880 | 650 | 700 | 500 | 783 |
| 2024 Honda Civic Sedan LX | 404 | ~506 | 370 | 565 | 635 | 855 | 720 | 579 |
| 2024 Toyota Prius LE | ~441 | ~540 | 541 | 507 | 624 | not rated | 880 | provisional 589 (6 of 7) |

`~` marks an estimate. The Civic has no top speed on file and the Prius no system torque and no top speed, so those are estimated and marked. The Prius has no source for its induction, so RELIABILITY is left unrated rather than assumed.

## Evidence: declared, documented, verified

| Level | Meaning |
| --- | --- |
| `declared` | The owner says so |
| `documented` | The owner attached a receipt, a photo or a report |
| `verified` | An independent verifier attested it |

Uploading something moves a claim to `documented` and never further. Uploading the same thing again adds nothing: files are told apart by fingerprint, so one receipt attached to twelve entries is one documented record and one photograph uploaded four times is one photograph. An attestation counts only when its verifier is in the registry the host supplies, is active, is allowed that scope, has never owned the vehicle, and the attestation is inside its window (identity never lapses; mileage 12 months; records, originality and modifications 24; a condition inspection 24, at full weight for the first 12). `EMPTY_REGISTRY` has no verifiers, so with it nothing can be verified.

An attestation also has to still be about the thing it attested, and to be the verifier's own:

- **It is bound to its subject.** An identity attestation speaks for the VIN and the year, make and model; a specification attestation for the whole specification. The engine keeps a fingerprint of the subject (its SHA-256) when the attestation is recorded, and the attestation stops counting when the passport no longer matches it. An owner who raises a figure after verification is no longer verified.
- **It can be signed.** Give the registry a `checkSignature` and an attestation counts only with a signature it accepts over `attestationPayload(passport, attestation)`: the vehicle's MiCar ID, everything the attestation says, its subject, and each record it names exactly as the passport holds it. A signature cannot be moved to another vehicle and stops checking when the attestation or a record it confirmed is altered. The checker answers at once; a host with asynchronous cryptography checks ahead of time.
- **It can be taken back.** `voidEvent` lets a verifier take back its own attestation, and lets a verifier with a records attestation withdraw an owner's record that proved false. The entry stays on the passport and no longer counts.
- **Its age is judged last.** An attestation past its window is called out of date, and stays on the record as what a third party once saw (an inspector's odometer reading stays in the log), only when it is good in every other way. A forgery gains nothing by being dated long ago: with a signature checker it is refused for its signature, and leaves nothing behind.

A passport file on its owner's device is the owner's to edit. With a signature checker, every attestation that counts is one its verifier really made about this vehicle as it stands. Without one, the host is vouching for where the passport is kept. Either way a holder can leave things out; only a store the owner cannot write to can prove nothing is missing.

`standingOf(passport, registry, asOf)` works all of this out once: what stands on that day, which attestations count and why the others do not. Every query (`eventEvidence`, `documentedRecords`, `activeModifications`, `competitionModifications`, `conditionInputs`, `competitionConditionInputs`, `standingReadings`, `mileageLog`, `publicPassport`) accepts that standing as an optional last argument, and `assemble` already shares one.

## Layer B: this vehicle

`vehicleStats({ spec, modifications, condition })` returns three layers:

- `base`: the specification, scored.
- `vehicle`: base, plus every recorded modification, plus modelled and inspected wear. Each adjustment is itemised with its evidence, and the deltas add up exactly to the layer minus base.
- `competition`: base, plus only the modifications and wear an independent verifier attested. This is what ranked play uses, so nobody gains by overstating their car. Its wear comes from a second condition, assessed from verified inputs alone (`competitionConditionInputs`: the highest reading a verifier took or that stands on a record a verifier confirmed, replacements a verifier confirmed, inspections). Its modifications come from a second list worked out the same way (`competitionModifications`): an install a verifier confirmed stays fitted until a verifier confirms its removal, and its upkeep is documented only by a maintenance record a verifier confirmed. Nothing an owner types or uploads is in either list, so a later reading, a receipt, a declared removal or a declaration cannot move a ranked score in either direction.

A figure a modification moved is no longer its source's own: nobody measured 229 hp on a tuned Civic. Its score says `modelled` instead of `measured`, and its quality is no better than an owner's figure. A modification can shorten a 0 to 60 time but never past the 1.9 s the estimate itself allows: that holds for a time on file moved by power and weight, for the parts' own 0 to 60 multipliers, and for an estimated time alike. A car that was already quicker than 1.9 s keeps its own time.

The inputs are a specification, modification records and a condition state. Documents are not an input: nothing can turn an upload into horsepower.

### Wear

A system's wear is `max(miles since new / life miles, years since new / life years)`, from 0 to 1. "Since new" restarts at a replacement or rebuild that is `documented` or better; a merely declared one changes nothing. Consumables (brakes, tires) carry no penalty unless a documented replacement or an inspection gives them a state: an unknown state is not assumed. The battery wears only on hybrid, plug-in and electric powertrains. A declared accident or branded title sets a floor under body wear. An inspector's reading overrides the model.

Each attribute is multiplied by `1 − loss × wear^1.5` for each system. Wear only ever lowers a score, and a repair restores toward the base and never past it.

| System | Life | Lost at full wear |
| --- | --- | --- |
| Engine | 200,000 mi or 25 years | POWER 12%, ACCELERATION 10%, SPEED 5%, RELIABILITY 25%, EFFICIENCY 10% |
| Transmission | 150,000 mi or 20 years | ACCELERATION 5%, RELIABILITY 15%, EFFICIENCY 4% |
| Suspension | 90,000 mi or 12 years | HANDLING 18%, DURABILITY 6% |
| Brakes | 45,000 mi or 6 years (consumable) | HANDLING 8% |
| Tires | 45,000 mi or 6 years (consumable) | HANDLING 12%, ACCELERATION 3%, EFFICIENCY 2% |
| Body | 250,000 mi or 20 years | DURABILITY 30% |
| Battery | 150,000 mi or 12 years | EFFICIENCY 8%, RELIABILITY 10%, POWER 5% |

### Modifications

Fourteen categories, three tiers each (Street, Pro, Extreme: the tiers MiCar World's Garage sells). A modification changes specification figures (horsepower, torque, weight, economy, clearance) that are then scored by the same tables, plus stated points on the two modelled indexes and grip. `MODS` in `modifications.ts` holds every number.

- More power raises POWER and ACCELERATION and, through horsepower per litre, costs DURABILITY and RELIABILITY in the same stress terms the base uses.
- A 0-60 time on file scales with `(lb per hp)^0.75`; a top speed on file scales with the cube root of the power gain unless it is governed.
- Losses in durability and reliability are multiplied by who installed it (professional 0.75, owner 1, unknown 1.25) and how it has been kept (documented upkeep 0.85, recently fitted 1, lapsed 1.15). Gains are not scaled.
- One modification per category counts (the latest). Turbo and supercharger exclude each other, as do performance tires, the off-road kit and the economy setup. A combustion-only modification on an electric powertrain is refused with the reason.

## Layer C: the grade (`micar-grade-v2`)

Five categories, each 0 to 100, each scored on its own. The report reads no attribute and no rating.

| Category | Weight | What earns points |
| --- | --- | --- |
| Identity and authenticity | 20% | Year, make and model 10; a well-formed VIN 15 (10 for a pre-1981 VIN); VIN agrees with the model year 5; VIN plate photo 5; title or registration on file 10; title status declared 5 (Rebuilt 2); four exterior photos 5; identity verified by an independent party 45 |
| Documentation and history | 25% | Documented records, up to 12, 40; months covered, up to 24, 25; a receipt or invoice 10; a photograph 10; a consistent mileage log 10 (one reading 4, a rollback 0); ownership chain documented 5; each record a verifier withdrew −10, up to −30 |
| Physical condition | 25% | An independent inspection's score (capped at 85 once it is over 12 months old). Otherwise the declared condition (Excellent 100, Good 75, Fair 50, Poor 25) less the declared accident (Minor 20, Major 40), capped at 60, or at 75 with the full photo set |
| Originality and modifications | 15% | 100 less each fitted modification's originality cost (× 0.75 when documented, × 0.6 when verified) and 10 per restoration with non-original parts. Capped at 85 until verified. 50 until the owner says whether the vehicle is stock or modified |
| Verification | 15% | Only from valid attestations: identity 30, mileage 10, records 20, condition 25, originality 15 |

`overall` is the weighted sum. The number on the label is `overall / 10` to one decimal, never below 1.0, with the ten tier names the home page has always used (Parts, Project, Rough, Worn, Daily, Driver, Clean, Garage-kept, Concours, Showroom; Showroom needs 9.75). Without independent verification the grade tops out at 6.8.

Discrepancies are reported with the grade: a VIN that fails its own check digit, a VIN coded for another model year, an odometer rollback, a record a verifier withdrew.

**The odometer log** (`mileageLog`). Every reading that stands is on the log, with one exception: a reading gives way to a later one for the same day when both were written down on the same day. That is a slipped digit put right while it is fresh, and it leaves no mark. Nothing else is ever replaced. An entry written on a later day cannot rewrite an old reading, whatever day it is dated: both stand. A verifier's own reading is never displaced, whether its attestation still counts or has lapsed, and a reading on a record a verifier confirmed gives way only to another verified one. A rollback is a reading lower than one of an earlier day (two readings of one day that differ are not one). Wear is counted from the highest reading that stands, so winding the odometer back gains nothing, and no entry an owner adds can clear a rollback once the day it was written on is over. An inspector's reading stays on the log after its twelve months are up: it stops verifying, and a rollback it proved does not clear itself with time.

### Certification

| Level | Needs |
| --- | --- |
| Registered | Year, make and model; an owner |
| Documented | A well-formed VIN with no discrepancy; three documented records; four exterior photographs; a mileage reading; no rollback or withdrawn record; Identity at least 40 and Documentation at least 30 |
| Verified | Identity verified by an independent party; mileage or records verified; Verification at least 40 |
| Certified | An in-person condition inspection in the last 12 months; originality verified; records verified; every category at least 60 and Verification at least 85 |

A card is in its case (and shows a number instead of RAW) from Documented up: the same three entries that have always put a card in the case. `certify()` lists every requirement of every level with where things stand, so a page can show what unlocks the next one.

## The passport

A passport is the vehicle's persistent identity and history: a MiCar ID, the factory specification, the VIN (private), the owners, and append-only lists of events, grade snapshots and card editions.

- **The MiCar ID** is `MC-XXXX-XXXX-XXXC`: Crockford base 32 from bytes the host supplies, with a check character. It is random, never derived from the VIN, and does not change when the owner does.
- **Events** are only ever added. An owner writes photographs, maintenance, repairs, mileage updates, inspection reports, modifications, restorations, documents and declarations. Attestations and withdrawals come only from verifiers, through `recordAttestation` and `voidEvent`. A passport holds at most 5,000 entries, and an owner's own stop 500 short of that: the room is kept for hand-overs, attestations and withdrawals, so filling a passport cannot block a verifier and no writer can leave a passport too long to be read back.
- **Ownership transfer** closes one period and opens the next. The MiCar ID, the events, the snapshots and the editions stay with the vehicle.
- **Grade snapshots** are appended, each with its formula name. History is never rewritten.
- **Stored history is checked before it is shown** (`supportedHistory(passport, registry, asOf)`). A snapshot or a card edition is a stored copy of a past result, and a passport file is its holder's to edit. Each is held against the most the passport could have earned on its day going only by what verifiers had attested by then (`gradeCeiling`): with none, Documented and what an owner can reach alone. Each must also agree with itself and with the calendar: a snapshot's overall is the weighted sum of its own categories, its label and tier are its overall's, its formula is the one in use, and it is the grade of the day it was written; an edition is raw exactly when its level is Registered, wears the finish its grade earns, and prints a Power Rating that is the mean of its own attributes; and nothing dated after the day asked about is shown. A file that claims a Certified 9.9, a One-of-One or a 10.0 label it never earned shows none of it, on the card, in the history or in the public view. The attributes printed on an earlier edition are the specification sheet's account on the day of printing, which nothing on the record can check: the Garage says so beside them, and the public view leaves them out.
- **The public view** (`publicPassport`) is the only projection meant to leave the owner's device: no VIN (only "VIN on file"), no owner ids, no file names or fingerprints, no notes, no costs, no shop names, no Power Rating or attributes from an earlier edition, days blurred to months, mileage rounded down to the thousand.

The engine holds a file's name, type, size and fingerprint. The file itself stays with the host.

## The card

`assemble(passport, registry, asOf)` runs every engine and builds the card: the vehicle layer's seven attributes with each one's change from base, the Power Rating, the certification level, the grade, the rarity, the edition and a chip for each modification.

**Rarity** is how collectible the vehicle is, from facts that are not performance. `rarityOf` takes no attribute and no rating.

| Factor | Points |
| --- | --- |
| Scarcity (a build number on file) | Up to 99 units 40; up to 999, 34; up to 4,999, 27; up to 19,999, 20; up to 99,999, 12; up to 499,999, 5 |
| Age | 40 years or more 15; 25 or more 11; 15 or more 6; 10 or more 3 |
| Provenance | Registered 0, Documented 10, Verified 20, Certified 30 |
| Preservation | Originality at least 90: 8 (at least 80: 4). Condition at least 85: 7 (at least 70: 3) |

Under 10 Common, 10 Uncommon, 25 Rare, 40 Epic, 55 Legendary, 70 Mythic. One-of-One is never reached by score: it needs a build number of exactly one, or a verifier's attestation.

A passport's build number counts only when its specification is the catalogue's own, figure for figure, or a verifier attested it (`buildNumberCounts`). One the owner typed in is shown on the sheet and scores nothing, or anyone could type a 1. The source named beside a figure decides nothing: on a passport an owner holds, that label is part of the file like everything else. For the same reason a card's data quality is never better than `owner` on the labels' say-so.

**Finish** is the slab's own, and follows the grade: raw until Documented, then standard, blue at tier 7, holo at 9, rainbow at 10. Foil is never for sale.

**Editions.** One edition per level reached: Registration, Documented, Verified, Certified. `issueEdition` prints the edition for the level the card holds the first time it holds it. Earlier editions stay in the passport, a level lost and regained does not print again, and a card that drops a level shows the edition it was given for the level it is back at.

## Card races

Five modes, each weighing the attributes that decide that kind of race. Nothing is equalised: every car has somewhere to win because the modes ask different things.

| Mode | Weights |
| --- | --- |
| Drag Race | ACCELERATION 0.45, POWER 0.35, SPEED 0.20 |
| Circuit Race | HANDLING 0.45, ACCELERATION 0.30, SPEED 0.25 |
| Endurance | RELIABILITY 0.40, DURABILITY 0.35, EFFICIENCY 0.25 |
| Economy Challenge | EFFICIENCY 0.65, RELIABILITY 0.35 |
| Off-Road | DURABILITY 0.40, HANDLING 0.30, RELIABILITY 0.30 |

`score = weighted attributes × terrain × luck`. Terrain is 1 except off-road, where it is the drivetrain (4WD 1, AWD 0.9, RWD 0.72, FWD 0.68) times ground clearance (`0.8 + 0.04 per inch above 5`, from 0.8 to 1.05). With no drivetrain on file the lowest drivetrain factor is used, and with no ground clearance the lowest clearance factor: a blank is never worth more than the figure. Luck is within ±4%, from a seeded generator keyed on the seed, the mode and the entrant, so a race is the same in any entrant order and can be replayed. An entrant with no rating for an attribute the mode needs is left out, with the reason.

Ranked races take only `base` and `competition` stats, and only from an entrant whose specification is `trusted`: the catalogue's own, figure for figure (`catalogueMatch`), or one a verifier attested (`assemble(...).specificationAttested`). `entrantFromLayer` marks an entry untrusted unless the host says otherwise, so figures an owner typed in cannot win a ranked race. Free play takes anything, including a setup: up to six points of modification cards (a card costs its tier), applied to the factory specification through the modification engine. Classes by Power Rating: D under 450, C, B from 550, A from 650, S from 750, X from 850.

A layer races on the specification it was scored from (`stats.vehicleSpec`, `stats.competitionSpec`), so a lift kit on the passport counts off-road exactly when its layer counts it. An id entered twice starts nobody, and a race only one car could start awards no series points.

The game reads attributes, drivetrain, clearance and class. It never reads a grade, a rarity or a value, and nothing that happens in a race changes them.

## Working on it

```
pnpm --filter @micar/engine test         # the package's own tests
pnpm --filter @micar/engine typecheck    # both compilers: TypeScript 7 with the value app's flags, 5.9 with the sim's
pnpm --filter @micar/value test          # runs these tests too, so they gate every deploy
pnpm --filter @micar/value exec tsx ../../packages/engine/scripts/build-catalogue.ts   # rebuild the catalogue from data/research
```

Shared source has to pass both compilers: `import type` for types, no enums, no namespaces, no parameter properties, nothing newer than ES2020 in the library. Every function is pure and never mutates its arguments.
