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

Footer: Value · Garage · Lot · Sheet · Shop · Dealer Simulator · Tuner · EN / ESP.

## The 3D world: the garage is the hub in three dimensions

- **The sim opens in your garage.** The concept's garage built in three.js: door, bay, walls, your car in the bay, your slab on the wall. The door rolls up to the town. The dealer lot is your business outside the door. The "Automotive Hub" portal page goes away; the simulator's URL opens on the door.
- **One car system.** `packages/cars` from the sim's lofted bodies. Card art is rendered headlessly from the same geometry (seed: `assets/cars/render-cards-from-sim.ts`), so the car on the card and the car in the world are the same car in the same color.
- **The garage in the world is the Tuner, retrofitted.** The old sim garage is replaced by the MiCar Tuner experience (lasting-oasis.github.io/micar-tuner: the bay, the turntable, the HUD, the parts) rebuilt in the sim's live three.js on the **category car models**, all nine body styles instead of the one 4x4. The Tuner's `Vehicle` and its 86 parts across ~50 slots (bumpers, flares, grille, lights, light bar, roof rack, snorkel, steps, spare, sportbar, rims and tires per wheel, underglow, wheel neon) become part slots on every category car, applied live on the 3D car instead of composited sprites. Drag to rotate, parts snap on, the car you tune is the car on your card.
- **The shop in the world is MiCar Shop.** The body shop and mechanic tools already in the sim. A tuning session in the garage writes a repair order; a finished order writes a trail entry to the card with a conservative value effect. One parts catalog serves the garage, the shop and the lot.
- **One balance.** Octane is the sim's currency and the card's points.
- **Later:** the lot inside the sim with real slabs as inventory, and racing as the drag-strip card game.
- **Real businesses get the same code at their own routes:** `/shop/` (MiCar Shop) and `/dealers/` (sheets), identical to what runs inside the sim.

## One identity

Screens are dark glass with windshield yellow (#ffd23f), Barlow and Barlow Condensed, marker handwriting for annotations. Print is paper: the window sheet, the certificate, the label. Value's existing paper-and-sticker look survives as the print layer, which is where it belongs. The sim's cyan neon and "logistics portal" language go. The Tuner keeps its HUD character but takes the type and the yellow.

## URL map

| Path | What | When |
| --- | --- | --- |
| `/` | the door: value → raw card → every verb on it | phase 0 |
| `/value/` | the calculator, kept as an alias so every printed QR and the redirect stub still land | now |
| `/garage/` | your cards | phase 1 |
| `/lot/` | verified listings, compare two cards | phase 3 |
| `/shop/`, `/dealers/` | MiCar Shop and Dealer Pro for real businesses | phase 3 |
| `/tuner/` | the standalone tool until the shop absorbs it | now |
| sim on Render | opens in your 3D garage | phase 2 |

## What exists today, and what the plan adds

| Piece | Today | The plan |
| --- | --- | --- |
| Value engine, EN/ES, 102 tests | live, branded Nexus Valuation | powers the door; brand becomes MiCar |
| `#/c/` codec, car pages, sticker builder | live | raw cards shareable with no account; dealer path |
| Garage concept (door, inspector, grade sim, Keyholder, Octane) | static page in `assets/concept` | its components become the home page, driven by real engine output |
| Sim 3D world, lofted cars, town, night | live on Render behind a portal | opens in your garage; cars shared with the cards |
| Sim shop tools (body, mechanic) | inside the sim | MiCar Shop, in the world and standalone |
| Tuner | standalone sprite site, one 4x4 | the sim's garage: live 3D tuning on all nine category cars, same parts, same HUD |
| Accounts, trail, slabs, grades issued | none | phase 1 |

## Phases

0. **The door** (1 week). The home page built as above on the Value engine and the concept's components; the four surfaces on one identity; the sim's portal replaced by a plain MiCar entry until the 3D garage exists. Deploys to Pages.
1. **The card is real** (weeks 2–4). Accounts (magic link, Supabase), park a car, trail entries with photo and receipt, the first grade, the slab, the share image, the certificate PDF. `/garage/` shows your cards.
2. **The garage is a place** (weeks 5–8). The sim opens in your 3D garage with your cars in it; `packages/cars`; card art rendered from the sim; one Octane balance.
3. **The loop** (weeks 9–12). Dealer Pro sheets with the grade; MiCar Shop standalone writing entries; the Charlotte lot; Slab Day.

## The loop and the numbers

North star: slabbed cars. Funnel: door → raw card → saved or shared → parked → slabbed → Keyholder. Offline: sheets printed → scans → "Park yours." Launch in Charlotte only, to the communities that already worship resale value (Tacoma, 4Runner, Wrangler, Miata, Civic Si). Slab Day at a Cars & Coffee: 100 cars graded on the spot.

## Not doing

Link-list hubs. Nav strips as "integration." A separate portal for the sim. Rebranding by find-and-replace. Integration is the visitor's card carrying through every section; a menu is not integration.
