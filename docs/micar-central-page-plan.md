# MiCar: the central page, and how it brings everything together

Plan written Nov 4, 2026. Supersedes every "portal", "hub" and "link list" idea. Companion to `micar-garage-product-spec.md` (the decisions) and `micar-monorepo-merge.md` (the repo).

## The thesis: one object, one place, one number

MiCar is not four apps behind a landing page. It is **one object, the car card**, and every product line is a **verb performed on that card**:

Value it → Park it → Grade it → Show it → Drive it → Fix it → Trade it → Sell it.

The central page is where a car becomes a card, and every section of the page shows **the visitor's own car** going through each verb. Nobody reads a feature list; they watch their car. The place the card lives is the garage, and the garage is the same place on the web and in the 3D world. The number on the card is the grade, and the grade is free forever.

## The page: the door

URL: the root of the Pages site. Title: MiCar. Said MEE-car. Positioning line: the only valuation that isn't trying to buy your car.

**Act 1. The door is the input.** The hero is the closed garage door from the concept: dark glass, windshield-paint yellow, marker handwriting on the door reading "What's in your garage?" The fields are on the door itself: year, make, model, miles, ZIP (the Value engine's inputs, with its prefill). Submit runs the authorization sequence (the exclusive animation already built; it doubles as the loading state), the door rolls up, and the car sits in the bay: rendered from the sim's lofted car model in a default color, on a **raw card** with the value on it. One line under it: "That's what it's worth. Nobody here wants to buy it." No account. No email.

**Act 2. Flip it.** The card turns. The back is the slab's rear label: the chart (this car vs the model's expected curve vs average sold), the four grade components, the trail at 0 of 3. "Three entries put it in the case": a photo, the odometer, the last receipt. "Save this card" packs the car into the URL with the existing `#/c/` codec, so a raw card is shareable today with no account. "Park it" opens an account (phase 1).

**Act 3. Grade it.** The grade simulator from the concept, run on their car: condition, trail, miles → the 1–10 and its tier (Daily, Driver, Clean, Garage-kept, Concours, Showroom). Foil appears at 7+, holo at 9+, rainbow at Showroom. For most people this is the first time their car has been a number other than a price.

**Act 4. Your garage is a place.** Their car in the 3D garage, in three dimensions, the slab on the wall. "Walk in" opens the MiCar Dealer Simulator at their garage door. The copy says what the world is: the lot is outside, the shop is across the street, the strip comes later.

**Act 5. What a card does.** Four verbs, each drawn on their card:
- Show: the share image and the printed windshield label.
- Fix: a MiCar Shop repair order writing a verified entry to the trail, invoice attached.
- Sell: a dealer window sheet for this car with the grade printed and the QR that lands on the card.
- Trade: the lot, compare any two cards, open to trades.

**Act 6. Keyholder.** "You pay for the work, never for the number." $39 a year, one car. Their card shown with the Verified seal. The four groups: the work, custody, the club, pays for itself.

**Act 7. For shops and dealers.** One strip, not a section: MiCar Shop (the body shop and mechanic tools from the sim) and Dealer Pro (sheets with the grade). Every sheet is a billboard; every repair order is a trail entry.

**Act 8. Charlotte Series 1.** Slab Day, First Edition for the first 1,000 Charlotte cards, collector numbers by arrival. A live counter of cards parked once there are real ones.

Footer: Value · Garage · Lot · Sheet · Shop · Dealer Simulator · EN / ESP (the Tuner link is gone: the Tuner is absorbed into the Garage).

## The 3D world: the garage is the hub in three dimensions

- **The sim opens in your garage.** The concept's garage built in three.js: door, bay, walls, your car in the bay, your slab on the wall. The door rolls up to the town. The dealer lot is your business outside the door. The "Automotive Hub" portal page goes away; the simulator's URL opens on the door.
- **One car system.** `packages/cars` from the sim's lofted bodies. Card art is rendered headlessly from the same geometry (seed: `assets/cars/render-cards-from-sim.ts`), so the car on the card and the car in the world are the same car in the same color.
- **The garage in the world is the Tuner, retrofitted.** The old sim garage is replaced by the MiCar Tuner experience (lasting-oasis.github.io/micar-tuner: the bay, the turntable, the HUD, the parts) rebuilt in the sim's live three.js on the **category car models**, all nine body styles instead of the one 4x4. The Tuner's `Vehicle` and its 86 parts across ~50 slots (bumpers, flares, grille, lights, light bar, roof rack, snorkel, steps, spare, sportbar, rims and tires per wheel, underglow, wheel neon) become part slots on every category car, applied live on the 3D car instead of composited sprites. Drag to rotate, parts snap on, the car you tune is the car on your card.
- **Real shops have a shop in the world.** A real business makes an account and gets a building in the town with its name, its sign, the Verified Shop badge, and its real bays. The tabs at `/shop` are that shop's back office; the same page stays standalone for shops and customers who never enter the world. Every repair order logged there shows in the world as a car in a bay, in its color, at its stage (on the lift, in the booth, in QC, ready). The customer gets a link, walks into the shop, and sees their own car at its stage: the "Domino's tracker" as a place you can stand in. Anyone driving by sees the building and that its bays are busy; the cars in them carry no name and no plate, and only the owner's link attaches a name. A finished job writes the entry to the customer's card, marked verified. Today's game already spawns every dealership with a mechanic and body shop; that is the Dealership's recon bay. Real shops are the second door into the same bay.
- **Every shop gets a customer page.** A commercial account comes with a page for its customers, one link per repair order, sent by text or printed as a QR on the intake sheet: where the car is in the pipeline, what's been done and what's next, the estimate and what's been approved, the invoice and what's paid or due, ETA, photos and notes from the tech, who to call. The same order is the car in the shop's bay in the world, for customers who want to walk in. The page ends with "Park this car": one tap and the job is the first entry on the customer's card, which makes every repair order a lead for MiCar Garage. The tracker tab at `/shop` is the seed. Showing amounts is v1; taking payment through the page is a separate decision (processor, fees, liability).
- **Later: grading rides on the same system.** A grading order is the same record type as a repair order, with its own stages (submitted, received, inspected, verified, graded, sealed, certificate). The customer page shows the four components lighting up as each is verified, the fee or the Keyholder plan, the ETA, then the slab and certificate; the quarterly regrade is the same order on a schedule. Slab Day is a grading station with a sign in the town, cars queued in its bays. A Verified Shop can run the physical inspection as a submission point, the way PSA's authorized dealers take submissions. Guardrail: shops submit evidence, only MiCar's engine turns it into the number.
- **One bay system, three doors.** One catalog of jobs and parts (the Tuner's parts and the shop pipeline's stages merged: what a job is, which part slots it touches, stages, typical cost and time), one bay component that draws a car with its job state, one job record whoever does the work. A real shop: they log it, their bay shows it, the customer watches it, the entry is verified. The Dealership's own recon bay (every dealership already spawns with a mechanic and body shop): the player's business fixes its inventory. Your garage: the DIY door above. **The DIY door** (Nov 4, revised): your garage can open an order on your own car from the same catalog, run with the same stages and the same customer page (the customer is you). A DIY entry needs evidence (a parts receipt and a photo of the work) or it stays a note; on the card it reads "owner-serviced" at single weight. Verification (a Keyholder evidence check, or a partner shop inspecting the finished work) promotes it to double weight, and only then does the car's condition in the world move. Tracked by default, trusted when verified: nobody declares their own car better, they prove it.
- **Dollars and Octane.** Dollars are the world's currency (prizes, parts, cars, the Dealership). Octane is points, earned by trail actions and Strip wins, spent at the Octane store: regrades, card themes and features, world cosmetics never sold for dollars.
- **Later:** the lot inside the sim with real slabs as inventory, and racing as the drag-strip card game.
- **Real businesses get the same code at their own routes:** `/shop/` (MiCar Shop) and `/dealers/` (sheets), identical to what runs inside the sim.

## The world: one map, three places, one economy

The 3D world is not "the dealer simulator" anymore, and it is not a menu of games either. It is one town with three places; the card is what travels between them; Octane is the one economy; nothing that happens in the world ever touches the grade. Container name: **MiCar World**. "MiCar Dealer Simulator" is the Dealership mode inside it (the repo keeps its name; the title screen changes).

- **The Garage (home).** Where the world opens. Your cards as cars, your slab on the wall, the Tuner in the bay, DIY orders on your own cars (tracked at single weight until verified). Parts cost dollars; the Octane store is here too. Two doors out, to the Dealership and the Strip. The geography is the menu; there is no portal page.
- **The Dealership (work): MiCar Dealer Simulator.** The original sim kept whole as the career mode: auction, appraisal, reconditioning (through the in-world MiCar Shop), CRM, DMV, staff. Its inventory becomes real slabbed cards from the MiCar Lot, so appraisal practice happens on real cars with real market data. Dealer profit is dollars. It is also the B2B training product: Dealer Pro customers buy seats to train staff on it. That is how the dealer-training emphasis survives the shift and gets a revenue reason.
- **The Strip (play): racing.** Real-time street racing in a night-city district (Night Tuner's six event types: sprint, circuit, street X, drag, drift, outrun), wins paid in dollars, Octane and stamps. Stats come from the trim data already in the engine and from the parts fitted in the Garage (bought with dollars), never from self-reported condition or the grade, so racing never creates a reason to lie on the trail. Garage → tune → Strip → prizes → parts is the loop that gives the Tuner retrofit its purpose.

Entry and emphasis: the world opens in the Garage. Deep links (`#dealership`, `#strip`) drop people at a place when they arrive with intent from the home page or a share. On the home page, Act 4 stays one picture of the garage with its two doors and one line each for dealer training and racing; the home page is about the card. If dealer training needs its own pitch for dealer groups, it gets a page under `/dealers/`, not more weight on the home.

## The engine: condition, repair, driving

Decisions of Nov 4: the category cars are the sim's lofted set, with wagon and convertible added to its profiles (the Blender set is retired); the container is MiCar World; the Dealership's line is "learn the car business without paying for your mistakes."

One engine serves the real site and the world. `packages/engine` = the valuation that already runs MiCar Value (it already prices Clean / Rebuilt / Salvage titles at 1.0 / 0.75 / 0.55, four condition bands with reconditioning costs, and accident history) + a condition model + a driving model.

- **Condition has three states that change how a car drives, not just what it's worth.** Not running (can't leave the garage; towed or trailered), drivable but needs repairs (slower, stalls, overheats, pulls, brakes fade; events fire while driving), great (full specs). The sim's existing body and mechanical scores (0–100, with rust, cracked glass, smoke already drawn below 50) are the inputs; the three states are bands on them.
- **Driving specs per car:** acceleration, top speed, handling, braking, reliability. Base values come from the trim data the engine already holds plus the EPA data already fetched (displacement, cylinders, drivetrain, weight class by body style); modifiers come from condition state, from Tuner parts, and from load. The same numbers drive the car in the world, the race on the Strip, and the appraisal in the Dealership.
- **Salvage is the center of the career.** Buy a salvage title at auction, not running, cheap. Repair it in the Dealership's own shop (every repair is a job from the one catalog: engine, transmission, brakes, suspension, tires, panels, glass, paint), each job costing Octane and time. Drive it when it's drivable; sell it when it's great, with the Rebuilt multiplier. Mistakes cost game dollars, not real ones. That is the training.
- **The bay replaces the old mechanic and body shop panels in the world.** Repairing a car is the one bay system on the category cars, in the Dealership's shop and in real shops; modifying one is the Tuner in your garage. The two old panels retire from the world. The standalone **MiCar Shop** for real shops stays at `/shop/`, on the same job and parts catalog, so a real repair order and an in-world one are the same record.
- **Rule: in the world, condition is earned, not declared.** Cars bought in the world come with a game-set condition. A real card's car enters the world at the trim's baseline, or at its **verified** condition when a Keyholder's receipts and inspection back it, which gives verification a visible in-world payoff. Self-reported trail entries never change how a car drives, and wins never change the grade, so nothing in the world ever gives anyone a reason to lie on the trail. The number stays the company.

## Retail and commercial are different doors

The Automotive Hub portal goes away. Someone who wants the world never sees shop software; a shop owner never sees a game.
- Retail: the world's URL opens straight into the Garage (until the 3D garage exists: the lot, behind a MiCar title screen).
- Commercial: MiCar Shop at `/shop/`, Body Shop and Mechanic as two tabs of one product (today's three portal cards become one); Dealer Pro at `/dealers/`. Linked from the home's "For shops and dealers" strip and from inside the in-world shop ("run this for your real shop").
- Phase 0 implication: the Render app routes `/` to the world and `/shop` to MiCar Shop; the portal component is removed.

## One identity

Screens are dark glass with windshield yellow (#ffd23f), Barlow and Barlow Condensed, marker handwriting for annotations. Print is paper: the window sheet, the certificate, the label. Value's existing paper-and-sticker look survives as the print layer, which is where it belongs. The sim's cyan neon and "logistics portal" language go. The Tuner keeps its HUD character but takes the type and the yellow.

## URL map

| Path | What | When |
| --- | --- | --- |
| `/` | the door: value → raw card → every verb on it | phase 0 |
| `/value/` | the calculator, kept as an alias so every printed QR and the redirect stub still land | now |
| `/garage/` | your cards | phase 1 |
| `/lot/` | verified listings, compare two cards | phase 3 |
| `/shop/`, `/dealers/` | MiCar Shop (standalone, and the back office of a shop in the world) and Dealer Pro | routes now; real shops in the world in phase 2 |
| `/tuner/` | redirects to the world: the Tuner is absorbed into the Garage | now |
| MiCar World on Render | opens in the Garage; `#dealership`, `#strip` deep links; `/shop` serves MiCar Shop | phase 0 routes, phase 2 garage |

## What exists today, and what the plan adds

| Piece | Today | The plan |
| --- | --- | --- |
| Value engine, EN/ES, 102 tests | live, branded Nexus Valuation | powers the door; brand becomes MiCar |
| `#/c/` codec, car pages, sticker builder | live | raw cards shareable with no account; dealer path |
| Garage concept (door, inspector, grade sim, Keyholder, Octane) | static page in `assets/concept` | its components become the home page, driven by real engine output |
| Sim 3D world, lofted cars, town, night | live on Render behind a portal | MiCar World: Garage, Dealership, Strip; opens in your garage; cars shared with the cards. The Strip takes guests at `/strip` (no account: $500, a $500 rental per event) and Google or emailed-link accounts ($1,000 daily allowance); the door links it, `/Micar-com/strip/` redirects |
| Sim shop tools (body, mechanic) | inside the sim | MiCar Shop, in the world and standalone |
| Tuner | standalone sprite site, one 4x4 | the sim's garage: live 3D tuning on all nine category cars, same parts, same HUD |
| Accounts, trail, slabs, grades issued | none | phase 1 |

## Status (Nov 4, 2026, evening)

Phase 0 is built and deployed from `main`:
- The door is the site root (`apps/value/src/door/`): `Door.tsx` (page and sequence), `Bay.tsx` (the 3D bay and door physics), `Slab.tsx` (the card, front and back), `Inspector.tsx`, `GradeSim.tsx`, `card.ts` (grade math, record → card). Styles in `apps/value/src/door.css`, the concept's stylesheet scoped to `.dp`. Category car art in `apps/value/public/cars/*.webp`, rendered from the sim's lofted geometry (`/home/claude/cars/preview/card-value.ts` was the harness; re-render when `packages/cars` exists).
- `/value/` is an alias that forwards to the root with the hash, so printed QR codes and the old repo's redirect still land (verified with a real `#/c/` code).
- The sim's portal is gone: `/` opens the world (setup screen titled MiCar World), `/shop` or the old `?app=` links open MiCar Shop with Body shop / Mechanic / Customer tracker tabs. Old product names retired.
- Inner Value pages say MiCar Value; the old landing page is deleted; yellow key favicon.
- Not done in phase 0: the Value calculator and sheet pages keep their blue accent (the print layer); accounts, parking, trail entries, slabs (phase 1); everything in the world beyond routing (phase 2).

The Strip is live (Nov 5, 2026): the Night Tuner racing game is ported into MiCar World as a night-city district behind the gate where the Speedway was, six race types (sprint, circuit, street X, drag, drift, outrun), prizes in dollars, Octane and stamps. The Tuner is absorbed into the Garage (live parts and tunes on the car); `apps/tuner` is retired, no longer shipped, and `/tuner/` forwards to the world.

Unification (Nov 4, later): `packages/brand` (tokens, the five doors, the strip's stylesheet, the favicon; no React, each app renders the strip with its own). The strip sits on every surface in the same order: Value a car · Garage (soon) · World · For dealers · For shops, wordmark goes home, EN/ESP. The sim's Tailwind palette is remapped to the brand (`market` → windshield yellow, `blue` → steel, `cyan` → tube, Barlow), which restyled the whole HUD and the shop tabs without touching the JSX. The world opens on a front door: what the place is (three places, one line each), a name, your business (Dealership default), "More options" for size and the guide, Enter. The tuner carries the type, the yellow and the strip. Root `README.md` reads as the product; `og.jpg` is the share image. Open question for the owner: a custom domain (micar.com?) would put the door and the world under one roof.

## Phases

0. **The door** (1 week). The home page built as above on the Value engine and the concept's components; the four surfaces on one identity; the sim's portal removed: `/` opens the world, `/shop` opens MiCar Shop. Deploys to Pages and Render.
1. **The card is real** (weeks 2–4). Accounts (magic link, Supabase), park a car, trail entries with photo and receipt, the first grade, the slab, the share image, the certificate PDF. `/garage/` shows your cards.
2. **The garage is a place** (weeks 5–8). The world opens in your 3D garage with your cars in it; the one bay system with its job and parts catalog; the Tuner retrofitted onto the category cars; real shops with accounts, buildings and live bays in the town, and the customer's link into them; the Strip's racing on each car's trim stats and Tuner parts (real-time events, live since Nov 5); `packages/cars`; card art rendered from the sim; one Octane balance.
3. **The loop** (weeks 9–12). Dealer Pro sheets with the grade; MiCar Shop standalone writing entries; the Charlotte lot; the Dealership stocked with real cards; Slab Day.

## The loop and the numbers

North star: slabbed cars. Funnel: door → raw card → saved or shared → parked → slabbed → Keyholder. Offline: sheets printed → scans → "Park yours." Launch in Charlotte only, to the communities that already worship resale value (Tacoma, 4Runner, Wrangler, Miata, Civic Si). Slab Day at a Cars & Coffee: 100 cars graded on the spot.

## Not doing

Link-list hubs. Nav strips as "integration." A separate portal for the sim. Rebranding by find-and-replace. Integration is the visitor's card carrying through every section; a menu is not integration.
