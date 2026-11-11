# One bay: the tuner, the mechanic and the body shop on one car

Design and roadmap. Date: 2026-11-11. Status: Stage 1 is built on the branch `one-bay-1` and waits for the owner's check. Stages 2 to 4 are not started. What Stage 1 changed in this document is marked "as built".

Implementation plan: `docs/superpowers/plans/2026-11-11-one-bay.md` (in the Micar App project: `claude/micar-one-bay-plan.md`; this document is `claude/micar-one-bay-design.md` there).
Builds on `2026-11-05-night-tuner-into-micar-world-design.md` (the Garage) and the central page plan's "One bay system, three doors". Must not fight `2026-11-11-physics-core-design.md`.

## 1. What this is

One screen where a car is fixed and built. The car stands on the turntable. Three tabs: Mechanical, Body, Custom. One work order that can hold a repair, a respray and a lift kit, with one price and one record.

It replaces the mechanic and body shop panels in the world and the parts menus of the Garage. It also brings in the parts of the MiCar Tuner configurator, which the world never received.

**The rule: a fault and a part meet at a slot.** Every fault the sim can give a car and every part it can sell belongs to one slot of the car: brakes, paint, glass and so on. The tabs, the order and its rules all follow from that.

## 2. Where things stand

Read from `main` at `c600d5b` on 2026-11-11. On that commit 362 tests pass and `tsc --noEmit` is clean (run for this design).

| | Tuning | Repairs | The configurator |
| --- | --- | --- | --- |
| Screen | `world/GarageMenu.tsx`: a list menu over a turntable | `InspectionModal` in `App.tsx`, opened at the Mechanic and Body Shop bays on the lot | `apps/tuner`: sprites of one 4x4, kept in the repo, not shipped |
| Record | `player.strip.cars[id]`: `cfg`, `tune`, `owned` | `car.bodyCondition`, `car.mechanicCondition`, `car.activeRepairs` | none |
| Catalogue | `CATS` in `world/data.ts`: 17 looks and 9 performance parts | `MECHANIC_LIB` and `BODY_LIB` in `constants.ts`: 6 faults each | 20 categories |
| Server | `strip_buy_part`, `strip_equip`, `strip_tune` | `perform_specific_repair`, `buy_part` | none |

What that leaves:

- **The two halves of a car never meet.** A car with a slipping transmission takes a Pro transmission for $3,600 and still has the fault. A car with worn pads takes race brakes and still needs a $250 pad job.
- **None of the configurator's parts is in the world.** The Garage sells Night Tuner's street-racing catalogue. No steel bumpers, flares, steps, lift, all-terrain tires, roof basket, light bar, snorkel or spare.
- **The configurator's screen is not in the world either.** Its strip of categories, cards with prices and bill of parts became a text list.
- **The car in the Garage is always drawn as new.** `GarageScene` builds the model without the car's condition.
- **A car can lose condition with nothing to fix.** A trade-in arrives at 30 to 79 with no faults. Hail and lot accidents take points off and add none. The repair screen then reads "No faults" at 40%.
- **MiCar Shop's three screens each keep their own list of stages.**

No branch holds an earlier attempt at this merge. What the team ran into beyond the list above is not in the repository, so it is not answered here.

## 3. Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Where the merge happens | At the catalogue and the order. Each fault and each part names a slot. Storage stays where it is: faults and condition on the car, the build in the Strip record | Condition is read in some fifty lines of the server and the dealership's screens, and the driving code reads the build as it runs. The physics core migrates saved builds once, at its stage 3; this design must not add a second migration before it |
| 2 | What condition is | The faults. A tab's score is 100 less the impact of its open faults, and every lost point has a fault that can be ordered | Already true of cars from the auction. Trade-ins and storm damage are brought into line |
| 3 | A fault and a part on one slot | A part is not fitted over an open fault on its slot. A part that is the failed component, bought for at least the repair's price, closes the fault itself | No shop bolts a turbo to a blown head gasket, and a brake kit comes with pads. The price floor stops a cheap part standing in for a dear repair |
| 4 | Paying | One order, priced by the server, paid once. The client sends lines and the total it showed, never a price to charge | One total is what a customer signs. See section 9 on `buy_part` |
| 5 | Repairs that fail | Unchanged: 15% without a Master Mechanic, none with one, and 20% off repairs with one. A part waiting on a failed repair is held and not charged | The staff system belongs to the dealership and is not this design's to rebalance |
| 6 | Time | An order is done when it is paid. Its stages are shown for a few seconds | A job that takes game days changes the dealership's pace. That is the owner's call (section 10) |
| 7 | The configurator's parts | Rebuilt as geometry on the seven lofted bodies, placed from each body's own measurements. Bolt-on parts now. Parts that change the body shell later | The sprites draw one fixed 4x4 and cannot follow a car's colour, condition or body style. The lofted body is one mesh, so a different hood or doors means changing the body builder itself |
| 8 | The screen | The configurator's layout over the Garage's turntable: slots along the bottom, cards with prices, the order on the right. Drive, quick race, dyno, your cars and options stay as they are | It is the screen the owner built, and it reads like a parts counter. The Garage's other functions are tested and are not the problem |
| 9 | Driving | No new part changes how a car drives. Performance tiers work as today | Physics core decision 11 and its stage 3 own what a part does to a car |
| 10 | The card | Nothing here writes a passport event, a grade or a card's condition. Each slot names the card engine's wear system and each performance part its modification | "In the world, condition is earned, not declared." The names are lined up so the DIY door and real shops can write entries later without a translation table |
| 11 | Where the code lives | `apps/sim/src/bay/`. The rules (slots, catalogue, faults, the order) are plain TypeScript with no three and no React, used by the server and the client. The screen sits beside them | The server already imports the sim's pure modules. The rules become a package when a second app needs them |
| 12 | Rollout | Four stages, each merged and deployed on its own. Old socket messages keep working until the last stage removes them | The live game is never broken, and each stage is checked before the next is built on it |

## 4. The model

### 4.1 Slots

| Slot | Tab | Trade | Faults that land on it | Parts that land on it |
| --- | --- | --- | --- | --- |
| Engine | Mechanical | mechanic | Blown Head Gasket, Misfiring Engine | Engine, ECU |
| Turbo and nitrous | Mechanical | mechanic | | Turbo, Nitrous |
| Cooling | Mechanical | mechanic | Leaking Radiator | |
| Transmission | Mechanical | mechanic | Slipping Transmission | Transmission |
| Electrical | Mechanical | mechanic | Bad Alternator | |
| Brakes | Mechanical | mechanic | Worn Brake Pads | Brakes |
| Suspension | Mechanical | mechanic | | Suspension, Hydraulics, Lift kit |
| Frame | Body | body | Bent Frame | |
| Panels and bumpers | Body | body | Dented Fender, Rusted Quarter Panel | Front bumper, Rear bumper, Side skirts and steps, Hood, Fender flares, Weight reduction |
| Paint and graphics | Body | body | Faded Paint | Paint color, Paint finish, Vinyl, Vinyl color |
| Glass | Body | body | Cracked Windshield | Window tint |
| Lights | Body | body | Shattered Headlight | Headlights |
| Wheels | Custom | mechanic | | Rims, Rim size, Rim color |
| Tires | Custom | mechanic | | Tires, Tire type |
| Aero | Custom | body | | Spoiler, Roof scoop |
| Accessories | Custom | body | | Underglow, Roof rack, Light bar, Snorkel, Spare carrier, Antenna |

Sixteen slots. The trade is which of MiCar Shop's two pipelines does the work. The wear system (engine, transmission, suspension, brakes, tires, body, battery) and the modification name (engine, ecu, turbo, nitrous, transmission, suspension, tires, brakes, weight, aero, offroad) come from `@micar/engine` and are checked against it by a test.

### 4.2 Faults

The twelve faults keep their names, parts, prices and impacts. A fault is found in the catalogue by its part name, which is unique, so no saved car needs changing.

A car whose score is lower than its faults explain gets faults for the difference: when a trade-in is taken, after hail and lot accidents, and once for each saved car when its owner joins. The faults are drawn from the same two libraries. A difference smaller than the smallest fault becomes that fault at the smaller size. Body faults other than the frame cost $40 to $53 a point in the library, which is also what the insurance events bill for hail ($40 a point).

As built (Stage 1). No fault comes out larger than the catalogue's. A fault not yet on the car that fits the points left is taken first, at random. When none fits, the largest one that fits repeats at its own size and price. A remainder smaller than the smallest fault becomes that fault at the smaller size, billed at its own price per point: a 2-point cracked windshield is $100, not $250. Billing the remainder as a whole small repair instead is one line; see open decision 6.

Measured on the built code, 20,000 simulated cars of each kind: a trade-in gets a median of 9 faults and $3,820 to clear; hail on a clean car a median of 4 and $1,250; a lot accident a median of 7 and $2,040. About nine trade-ins in ten show one fault name twice (a whole one and a small leftover, or a repeat), as auction cars already can.

### 4.3 The new parts

Seventeen new choices in twelve part categories. Prices are the configurator's, except the three marked new.

| Part | New choices | Slot | Fits |
| --- | --- | --- | --- |
| Front bumper | Steel bumper $1,890, Stubby bumper $1,240 | Panels | every body |
| Rear bumper | Steel bumper $1,450 | Panels | every body |
| Side skirts and steps | Tube steps $420, Rock sliders $760 | Panels | every body |
| Fender flares | Wide flares $520 | Panels | every body |
| Lift kit | Leveling kit, 2 in, $900 (new); Lift kit, 4 in, $1,900 (new) | Suspension | every body |
| Tire type | All-terrain $980 (new), Mud-terrain $1,480 | Tires | every body |
| Rims | Beadlock $1,960, Steel wheel $640 | Wheels | every body |
| Roof rack | Roof basket $890 | Accessories | not coupe or sports |
| Light bar | LED light bar $540 | Accessories | every body |
| Snorkel | Raised intake $460 | Accessories | every body |
| Spare carrier | Rear-mounted spare $380 (new) | Accessories | hatchback, SUV, van |
| Antenna | Whip antenna $45 | Accessories | every body |

Fit is decided by geometry alone, as it is for today's parts (a GT wing goes on a van). The basket needs 0.80 m of flat roof; the coupe has 0.68 m and the sports car 0.53 m. A spare needs a tailgate to hang on.

Two kits add several lines to an order in one tap, leaving out what does not fit: **Trail** (steel bumpers, wide flares, mud-terrain tires, beadlocks, 4 in lift, rock sliders, light bar) and **Overland** (all-terrain tires, 2 in lift, roof basket, snorkel, spare, tube steps, antenna). A kit has no price of its own.

No existing part's price or star rating moves. New choices are added after the rating table is worked out and carry their own rating.

### 4.4 The order

1. An order is a list of lines for one car: repair lines (an open fault) and part lines (a catalogue choice). At most 24 lines. As built: an order with no lines is refused.
2. A repair costs what it costs today: the library price, 20% less with a Master Mechanic, nothing when the matching part is in stock, and then the part is used up. As built: the part is used up even when the repair fails, as on today's repair screen, and when two repairs need the same stocked part the dearer one gets it.
3. A part costs its catalogue price, or nothing when the car already owns it.
4. A part is **held** while its slot has an open fault. The repair can be on the same order. A part that renews the failed component, bought on this order for at least the repair's price, closes the fault itself:

   | Part | Renews |
   | --- | --- |
   | Engine | Blown Head Gasket ($1,500), Misfiring Engine ($150) |
   | Transmission | Slipping Transmission ($2,500) |
   | Brakes | Worn Brake Pads ($250) |
   | Paint color, Paint finish | Faded Paint ($800) |
   | Headlights | Shattered Headlight ($200) |

   So a Street transmission at $1,400 waits for the $2,500 rebuild and a Pro at $3,600 replaces it. A $400 colour change waits for the faded paint; a $900 pearl finish covers it. An ECU tune renews nothing.

   As built: a slot is judged as a whole. Its parts go on when its faults are covered by repairs on the order or by one part on the order that renews them all within its price. A colour and a pearl finish chosen together both go on, in whichever order they were tapped: the answer never depends on the order of the lines.
5. The server refuses an order with a held or refused line, a total different from the one the client showed, or more than the player's cash. A refused order charges nothing.
6. Repairs are done first. Without a Master Mechanic each fails 15% of the time: it is charged and the fault stays, as today. A part whose slot is still faulty after that is held and not charged. As built: the one exception is a part that itself renews the fault at or above the repair's price. It goes on and closes the fault even though the repair on the same order failed, and both are charged.
7. What was charged is added to the car's recon total, and the order joins the player's last 30.

### 4.5 Stages

The two pipelines are MiCar Shop's own, word for word. Mechanic: Diagnostic Scan, Disassembly, Part Replacement, Reassembly, ECU Coding & Tune, Road Testing, Ready. Body: Intake, Inspection, Body Work, Paint, Reassembly, Quality Control, Ready. An order with both trades runs the twelve distinct stages in one line. In the world the stages play for a few seconds after payment; the parts appear at Part Replacement and the fault pins clear at Ready.

## 5. The bay screen

```
┌ MiCar · 2019 Toyota Tacoma ───────── $12,400 · 310 Octane · Stage 2 ── [Drive] ┐
│ Mechanical │                                             │ WORK ORDER          │
│ Body       │                                             │  Worn Brake Pads    │
│ Custom     │          the car on the turntable,          │    replaced by      │
│ ────────── │          in its real condition,             │  Street brakes $900 │
│ Tune       │          a pin on each faulty slot          │  Light tint    $300 │
│ Race       │                                             │  Total       $1,200 │
│ Your cars  │                                             │  [Confirm order]    │
│ Options    │                                             │  stat bars, before  │
│            │                                             │  and after          │
├────────────┴─────────────────────────────────────────────┴─────────────────────┤
│ Engine 100 │ Turbo │ Cooling 85 ⚠1 │ Transmission │ Electrical │ Brakes 90 ⚠1 │ … │
│ [Fix Worn Brake Pads $250] [Stock ✓] [Street $900] [Pro $2,200 · stage 2] ...   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Left**: the three tabs, then the Garage's other functions, which open the screens they open today.
- **Bottom**: the slots of the tab with each slot's condition and open faults. Under them, the chosen slot's cards: its faults first, then its parts by category, each with its price or its state (fitted, owned, needs stage 2, fix first).
- **Right**: the order, its total, Confirm, and the stat bars comparing the car now with the car after the order. After Confirm the stages play, then a ticket lists each line as done, failed or held.
- **The car** wears the order before it is paid, shows rust and smoke as it does on the lot, and carries a pin on each slot with an open fault.
- **A held part's card says what is in the way** and adds that repair to the order in one tap.
- **Phones**: the tabs become a bar under the header, the cards a sheet at the bottom, the order a pill that reads "Order (2) $1,200" and opens. Confirm and Drive are never covered.

**Three doors, one bay.** [Enter] GARAGE on the lot opens it on Custom. The Mechanic bay opens it on Mechanical, the Body Shop bay on Body. The two buttons on each inventory card do the same from the menu. Every tab is reachable from every door. A rental stays stock and never opens the bay.

## 6. What does not change

- How any car drives. `PerfCfg`, `Tune`, `carParams` and the Strip's rules are untouched.
- `packages/engine`, every grade and every card.
- Every existing price, repair cost and star rating; the 15% and the Master Mechanic's 20%.
- The Parts tab and the parts stock, except that the server sets the price and stock is kept under the part's own name, so that a repair can find it (section 9).
- The dyno, quick race, your cars, options, Drive.
- MiCar Shop at `/shop`, until Stage 4 gives it the shared stage lists.

## 7. Stages

| Stage | Built | Noticed by players | Gate |
| --- | --- | --- | --- |
| **1. One catalogue, one order** | `bay/`: slots, catalogue, faults, the order. `bay_order` on the server. Every lost point gets a fault. The three fixes section 9 gives to Stage 1 | Trade-ins and storm-damaged cars show faults that can be fixed. Stock bought on the Parts tab starts to count. Nothing else | Unit tests and the socket test pass. A mixed order is charged once and recorded. Every existing test stays green |
| **2. The parts on the cars** | The seventeen new choices as geometry on all seven bodies. Lift and tire types. Fit by body. Old builds load | Trail parts for sale in today's Garage | Geometry tests on seven bodies. A contact sheet of every body with each kit, looked at by the owner. The Garage's triangle count with a full kit reported |
| **3. The bay** | The bay screen and its model. The car drawn in its real condition with pins. Three doors open it. The inspection modal and the Garage's parts lists retire | One place to fix and build a car | The browser smoke test orders a part that replaces a fault, on a desktop and at phone size. The owner uses it on a phone and a desktop and signs off |
| **4. One record** | MiCar Shop reads the catalogue's stages and sends orders. Recon and all-in cost on each inventory card. Order history. Retired messages removed. Docs | "All-in cost" on every car; the same job names in MiCar Shop and the world | No retired message has a sender or a handler left. README and project docs follow |

Stage 1 changes almost nothing a player can see, so it can ship while Stage 2's geometry is being looked at.

## 8. Not in this design

- Parts that change the body shell: doors, soft top, vented hood shell, grille, mirrors; interior colour.
- Wheel neon and rock lights (underglow exists).
- **Parked cars wearing their build.** Today only the driven car, Strip racers and the car in the Garage are drawn with their parts; a car parked on the lot is drawn stock. A lifted truck will look stock on the lot. It is the next most visible gap and needs its own look at draw cost.
- Jobs that take game time. Real shops' buildings and customer links (phase 2c).
- Entries on a card's trail from work done in the world (the DIY door).
- What the new parts do to driving (physics-core stage 3).
- Wagon and convertible bodies. Placement is computed from a body's measurements, so a new body needs one row in the fit table.
- The configurator's saved builds and share links.
- Spanish names for parts. The Garage's catalogue is English only today; the bay's own labels are in both languages.

## 9. Found along the way

| What | Where | What this design does |
| --- | --- | --- |
| Stock bought on the Parts tab is never used. The tab buys and counts a part under the fault's name ("Worn Brake Pads"); a repair looks for the part's name ("Brake Pad Set"). Only parts from scrapping a car match. Read in the code, not run | `App.tsx` 2969 to 2999, `server.ts` 1896 | Stage 1, done: one name, the part's, on the tab and on the server. Seen in a browser on a local build: the tab lists "Brake Pad Set, Fixes: Worn Brake Pads, $187", and Buy Stock takes $187 and shows Owned 1 |
| `buy_part` charges the price the client sends, and a negative price adds money. Run on 2026-11-11 on a local copy of the code as it was before Stage 1 changed it: a dealer who sent a price of −50,000 went from $25,000 to $75,000 | `server.ts` 1934 | Stage 1, done: the server prices the part from the catalogue, ignores a price in the message and ignores an unknown part |
| `repair_engine` restores the whole mechanical score for $500 and leaves the faults listed. Nothing in the client sends it | `server.ts` 1542 | Stage 1, done: removed |
| `repair_car` is sent by `store.repairCar`; nothing on the server hears it | `store.ts` 508 | Stage 3: removed with the old store actions |
| `add_standalone_revenue` is sent by the shop tracker; nothing on the server hears it | `StandaloneShopPlatform.tsx` 401 | Left alone. Noted for the owner |
| Trade-ins carry no body style. The client guesses it from the model name; the server falls back to sedan | `server.ts` 1693 | Stage 2: one function for both |
| A trade-in's headline condition was rolled on its own, apart from its body and mechanical scores. Every other car's is the average of the two. It never showed while a trade-in had nothing to repair; with faults on it, the first repair replaced the number (in the final review's runs, 59 became 77 and 75 became 42), and that number prices the sale | `server.ts` 1730 | Stage 1, done: the average of the two scores, like every other car. Seen on a real sale run locally: 55 for scores of 35 and 75, then 62 after a 15-point repair |
| Two faults on one car can share an id: the id was the clock plus a random number under 1,000. A repair then closed both and gave back the points of one (3% of junkyard cars, by the final review's simulation) | `server.ts` 414, `order.ts` | Stage 1, done: ids come from a counter, and a repair closes the one fault it was for |
| `finalize_deal` trusts the trade-in the client describes: its value becomes the car's buy price, which insurance claims and title loans pay on, and its make, model and year are stored unchecked. Read in the code by the final review, not run. Dealer cash is not saved or carried into an account | `server.ts`, `finalize_deal` | Left alone. Noted for the owner: worth its own small fix |
| The first state a client is sent (`init`) shows other players' money; later updates hide it | `server.ts` `publicState` | Left alone, except that orders and recon are hidden in both. Noted for the owner |
| A part key that is a built-in JavaScript name (`constructor`, `__proto__`) stops the server process. The catalogue lookup finds the built-in, and `partPrice` then reads a field it does not have. Found while Stage 1 was being checked. Run on a local copy of `main` at `e573007`: one `strip_buy_part` or `strip_equip` from a signed-in account with a car of its own, and the process exited with code 1. A dealer with a bought car passes the same checks (read in the code, not run) | `payout.ts` 131, `server.ts` 1326 and 1349 | Stage 1, done: `partPrice` looks only at the catalogue's own keys. The same messages now get "Unknown part." (run on a local copy of the branch) |
| A message with empty or missing contents stops the server process, from anyone. The handlers unpack their message before checking it: 35 do, 27 of them with no default. Found while Stage 1 was being checked. Run on a local copy of `main` at `e573007`: a guest's `rent_car` sent with `null`, and a dealer's `buy_part` sent with nothing; each time the process exited with code 1 | `server.ts`, every `socket.on` | Stage 1, done: one guard per connection. A handler that fails is logged as `--- HANDLER ERROR ---` with the event's name and the error's text, never the message's contents, and the server keeps running (run on a local copy of the branch) |

## 10. Open decisions for the owner

1. **Three new prices**: lift $900 and $1,900, all-terrain tires $980, spare carrier $380. Each is one line to change. The owner, 2026-11-11: decide later; the placeholders stand.
2. **Should a job take game time?** Recommended: not yet. It is a change to the dealership's pace, not to the bay.
3. **Is every tab open at every door?** Recommended: yes. A door chooses only the tab the bay opens on.
4. **Do repairs from the menu stay?** Today the inventory card's Body and Mech buttons work from anywhere. Recommended: keep, so nothing a player does now is taken away.
5. **What went wrong the first time**, beyond section 2. Answered 2026-11-11: the first attempt never became the mechanic and body shop integration, which is the gap this design closes. No change to the plan.
6. **A small leftover fault's price** (new, from Stage 1). A car's lost points rarely divide by 5, so about four trade-ins in five get a 1 to 4 point leftover in each trade. As built it is billed per point ($30 a point mechanical, $50 body). The alternative is a whole small repair ($150 or $250). One line either way.
7. **The two server faults found in Stage 1** (section 9: a part key named after a built-in, and a message with empty contents; either stops the live server). They are fixed on `one-bay-1`. Should they also go to `main` on their own, ahead of the rest of Stage 1? Recommended: yes.
8. **`finalize_deal` and the `init` view** (section 9). Not part of this design. Should they be fixed in a small change of their own?

## 11. Risks

| Risk | Answer |
| --- | --- |
| A part looks wrong on some body | Placement comes from each body's measurements. The contact sheet is Stage 2's gate. A part that cannot sit on a body is not sold for it |
| Bigger tires cut the wheel arch | The body rises by as much as the tire grows. Fore and aft clearance is checked on the contact sheet for all seven bodies |
| "Why can't I buy brakes?" | The card names the fault in the way and adds its repair in one tap |
| This design and the physics core both touch the build | This one adds keys to `VisualCfg` and nothing to `PerfCfg`, `Tune` or `carParams`. Physics-core stage 3 migrates the build once |
| The big files make edits risky (`App.tsx` 3,373 lines, `VanillaThreeScene.tsx` 1,927) | New code lives in `bay/`. Edits to the big files are a handful of call sites, named by line in the plan |
| Old cars become dearer to fix | Only what was already lost becomes fixable, at the libraries' own cost per point |
| The order panel covers a button on a phone | It has happened before with Drive. The smoke test taps Confirm and Drive at 390 × 844 |
| The first attempt failed for a reason not seen here | Stages 2 and 3 each end at a look-and-use gate, so a wrong turn costs one stage |

## 12. Measured for this design

The seven lofted bodies, from `BODY_SPECS` (metres):

| Body | Length | Half width | Wheel radius | Sill | Hood | Roof | Flat roof | Tailgate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sedan | 4.80 | 0.93 | 0.34 | 0.17 | 0.83 | 1.45 | 0.82 | no |
| Coupe | 4.70 | 0.95 | 0.34 | 0.15 | 0.79 | 1.37 | 0.68 | no |
| Sports | 4.65 | 0.99 | 0.35 | 0.14 | 0.76 | 1.29 | 0.53 | no |
| Hatchback | 4.30 | 0.89 | 0.31 | 0.17 | 0.84 | 1.47 | 1.50 | yes |
| SUV | 4.90 | 1.00 | 0.39 | 0.27 | 1.12 | 1.74 | 2.59 | yes |
| Van | 5.15 | 0.99 | 0.36 | 0.20 | 0.96 | 1.75 | 2.99 | yes |
| Truck | 5.40 | 1.02 | 0.43 | 0.35 | 1.32 | 1.93 | 1.39 (cab) | bed |

"Flat roof" is the length over which the roof's centre line stays within 0.04 m of its highest point. It is not the span between the roof marks, which counts a fastback's falling roof and would put the coupe ahead of the sedan.

Each `BodySpec` also carries its wheel arches (radius, height, roundness), sill, shoulder, roof, greenhouse marks and bed. That is enough to place every part in section 4.3 without a number per body.

**Tried.** The order rules, the fault rule, the new prices and ratings, the fit table, the screen's state and the server's order message were each written once as throwaway code and run against the tests in the plan: 57 passed, with the 362 existing tests still passing beside them. That trial is not the implementation and is not in the repository.

**Not tried.** No part has been drawn, the screen has not been rendered, and the browser smoke test has not been run. Stage 2 is where the parts are first seen, and its contact sheet is the gate for that reason.
