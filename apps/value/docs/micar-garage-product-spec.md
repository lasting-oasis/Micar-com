# MiCar Garage: product decisions (Nov 2026)

Working spec captured from the design sessions on Nov 3–4, 2026. The interactive concept page (`assets/concept/micar-garage/index.html`) is the visual reference; this doc holds the decisions behind it.

## Brand
- **MiCar**, pronounced **MEE-car** (the Spanish pronunciation passes the "hear it, spell it" test; "my-car" sends people to mycar.com).
- Branded house, one brand with lines: **MiCar Value** (free, anonymous calculator; today's Nexus Valuation site), **MiCar Garage** (park a car, build the trail, get graded), **MiCar Lot** (verified listings, open to trades), **MiCar Sheet** (dealer window sheets), **MiCar Grade** (the number; badge reads "MiCar 8.7"), **MiCar Shop** (shop software, below), **MiCar Dealer Simulator** (the 3D sim, repo `lasting-oasis/car-dealer-sim`).
- The app is named "MiCar Garage," never bare "MiCar" (bare name taken on the App Store by a Vietnamese ride app; MiCar Sharing exists in India; old 1970s–80s US MICAR marks likely dead). Needs a trademark search before anything is printed.
- Identity: windshield-paint yellow (#ffd23f) on dark glass, Barlow / Barlow Condensed, marker handwriting for annotations. Serials are MC-00017 style.

## What it is
The first product that treats a car as the asset it is: tracked, graded, provable. Positioning: "the only valuation that isn't trying to buy your car." The grade is the company: if "MiCar 8.7" ends up typed into listings the way "PSA 10" is, everything downstream follows.

## The card system (two layers)
1. **Certificate, minted once, never revoked:** set (the city; "Charlotte Series 1"), collector number (open numbering by arrival; low = early), stamps (First Edition: first 1,000 per city; Slab Day: in person with a photo; First Owner; Limited trim).
2. **Living grade:** changes with the car; issued quarterly with a certificate PDF. Value itself ticks whenever the weekly index moves.
- Front of card: owner's photo (category render until then), grade, value, one body-type color. Nothing else.
- Card back: the closed garage door, universal. Slab rear label: the chart (car vs expected curve vs model avg sold, with trail events) and the four components.
- Raw until slabbed: three trail entries put the card in the case and issue the first grade.
- Finishes: Standard (good-looking for everyone), Earned (blue foil 7+, holo 9+, rainbow at Showroom 9.75+), Themes (paid, never foil). Watch cards are ghost-framed. **Foil is never for sale.**
- Rarity tiers: Common (raw), Uncommon (slabbed), Rare (8+), Holo Rare (9+), Showroom (9.75+), plus stamps.
- Milestones: verified entries only, capped cadence (one mileage check/month; service needs a receipt); "full year documented" = 12 consecutive monthly checks. Stamps on the rear label.
- Pop report per model unlocks at 25 slabs; before that, model pages run on curve data (578 models, 26k+ trim prices, ~1,900 listings, weekly index).
- UV mark: every slab carries a hidden "MiCar · authentic · serial" mark visible under the inspector's UV light.

## MiCar Grade (1–10, one decimal)
Condition 30% · Curve 30% (value vs the model's expected curve: 6 + 0.4 × %) · Trail 30% (entries/12 × 5 + months/24 × 3 + receipts + photo) · Miles 10% (5 − %vs average / 8). Tiers: 1 Parts, 2 Project, 3 Rough, 4 Worn, 5 Daily, 6 Driver, 7 Clean, 8 Garage-kept, 9 Concours, 10 Showroom (≥ 9.75). Verified entries count at double weight.

## Business model: Keyholder membership
**Rule: you pay for the work, never for the number.** A fake receipt loses the entry and drops the grade, member or not.
- Free: park, self-reported trail, grade, card, basic listing, one Watch card, standard share image, national average sold price.
- **Keyholder: $39/yr or $4/mo, one car; +$9/yr per extra car; family garage.**
  1. The work: receipts checked, odometer photos read, VIN title/history check at signup and yearly, quarterly grade + certificate, Verified holographic seal.
  2. Custody: recall alerts by VIN (free federal data), registration/inspection and mileage-based maintenance reminders, recent sales low/high/average for the trim in the metro (90 days, always with the count, national fallback labeled), price-drop/curve alerts, unlimited Watch cards, trail export (PDF/CSV).
  3. Club: *The Garage* monthly magazine (digital first, EN+ES in one issue; dealer spotlights are paid), two printed windshield labels/yr, holographic seal vinyl stickers, animated holographic social sticker, member number + First Edition, Slab Day priority, meetups.
  4. Pays for itself: local partner discounts (oil change, tires, detailing, pre-sale inspection), 100 Octane/month.
- Dealer Pro: branded sheets with the grade printed, inventory page, bulk verification. First revenue.
- **MiCar Shop** (proposed): the sim's body shop / mechanic shop tools (StandaloneShopPlatform, ShopManagement "Precision Repair Logistics", MechanicManagement "MechFlow Pro") as software for independent shops. Every finished job writes a verified trail entry with the invoice to the customer's card. Shop Free (tracker, 20 ROs/mo), Shop Pro ~$79/mo (unlimited, bays, inventory, texts, branding, Verified Shop badge), Fleet priced per vehicle. Shops only write entries for work they did; partner shops double as Keyholder discount partners.
- Later: themes, print-on-demand acrylic slab. Not now: roadside, insurance.

## Octane
Points, not a coin. Earned by trail actions, spent on regrades, features, themes. Half of a car's Octane rides with the card on a trade. Rungs: points now → anchored provenance (hash entries to a public chain, no token) → a token only with counsel and a product people already love.

## The lot and the simulator
- Lot = verified listings with an "open to trades" flag; "compare any two cards" replaces the duel; the number is labeled a value, never a price. Opens city by city once a city has a few hundred slabs.
- The car dealer simulator consumes cards: first the lot lives inside the sim (real slabs as inventory, Octane as currency, dealer training on real cards); then racing as a stat-driven card game on a drag strip (Top Trumps lineage, dice element, wins pay Octane and stamps, never grade). Generic category bodies in the owner's color, real names as text; no replicas of real designs.
- Tuner (`lasting-oasis/micar-tuner`) in the sim's shops: reuse the procedural vehicle and parts data, not the sprite turntable; one shared parts catalog; bay → tuner overlay → repair order → pipeline stages shown on the car → parts applied → trail entry with a conservative value effect.

## Go-to-market
- Single-player first; the lot waits. North star metric: slabbed cars, not sign-ups.
- Distribution loop: every dealer sheet is a billboard; every scan lands on a car page that says "Park yours."
- Launch to communities that already worship resale value (Tacoma, 4Runner, Wrangler, Miata, Civic Si), in Charlotte only. Slab Day at a Cars & Coffee: 100 cars graded on the spot.
- 90 days: weeks 1–3 Garage v1 (magic-link accounts, park from any valuation, raw→slabbed, trail entries with photos/receipts, quarterly grade, share image; Supabase + the existing engine); weeks 4–6 the sheet loop and Dealer Pro; weeks 7–12 Slab Day and the Charlotte lot.

## Assets on hand (all under `assets/` in this repo)
- Concept prototype: `assets/concept/micar-garage/` (3D garage door hero with authorization sequence, inspector with flip/tilt/UV, grade simulator, ledger, lot, Keyholder offer, Octane); `assets/concept/carvalue-review.html`.
- Car art: the sim branch's lofted cars are the chosen source (`assets/cars/card-art-comparison.jpg`, renderer seed `assets/cars/render-cards-from-sim.ts`). Blender builder + GLB export (`assets/cars/blender/`, `assets/cars/sim-models/`) are shelved, kept for reference.
- Explainer videos (English and Spanish, `assets/explainer/`) still say Nexus Valuation; the live site is not yet rebranded.
