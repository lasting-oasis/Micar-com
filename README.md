# MiCar

**Said MEE-car.** Your car is the second-biggest thing you own and the only one you never check. MiCar treats it like the asset it is: valued, tracked, graded, and provable.

Type a car at the door and it comes back as a card with today's value on it. Three entries later the card goes in a case with a grade from 1 to 10 that follows the car for life. The grade is free, for everyone, forever: you pay for the work, never for the number. The card lives in a garage, and the garage is a real place: a 3D town you can drive in.

## The doors

| Door | What it is | Where |
| --- | --- | --- |
| **The door** | The home page. Type a car; the garage door opens on its value, on a card. | [lasting-oasis.github.io/Micar-com](https://lasting-oasis.github.io/Micar-com/) |
| **Value a car** | The free calculator behind the door, line by line, with original sticker prices for 578 models. | `…/#/value` |
| **Garage** | Park a car and it becomes a card: a MiCar ID, seven attributes scored from its specification, a Power Rating, a five-part grade, and a passport that stays with the car. Add photographs and records, fit modifications, race the card. *Kept on your device until accounts open (phase 1).* | `…/#/garage` |
| **World** | MiCar World: a 3D town. The Garage (your cards as cars), the Dealership (learn the car business without paying for your mistakes), the Strip (race the car you tuned: six kinds of race, prizes in dollars, Octane and stamps). | [micar-sim.onrender.com](https://micar-sim.onrender.com/) |
| **For dealers** | Window sheets with the value, the forecast and a QR code that opens the car's page. | `…/#/sticker` |
| **For shops** | MiCar Shop: body shop, mechanic bay and a customer tracker for real shops, and the back office of a shop in the world. | [micar-sim.onrender.com/shop](https://micar-sim.onrender.com/shop) |
| **Tuner** | Absorbed into the Garage in the world: tune the car, then race it on the Strip. The old `/tuner/` link forwards to the world. | `…/tuner/` |

The same strip sits on top of every surface, with these doors in this order, and the wordmark always goes home.

## The repo

```
apps/value     the door, the calculator, dealer sheets, car pages, the Garage   React 19 · Vite
apps/sim       MiCar World and MiCar Shop                            React 18 · three.js · Express (Render)
apps/tuner     the retired standalone configurator (kept, no longer shipped)
apps/explainer the explainer videos (Remotion, EN + ES)
packages/brand the identity: tokens, the five doors, the strip's stylesheet, the favicon
packages/engine the card platform's rules, in pure TypeScript for both apps: specifications and their sources,
               the seven scores, wear, modifications, the passport, verification, the grade, cards and races
assets/        concept pages, card art, Blender sources, the explainer's voices
docs/          the plan, the product spec, the merge notes
tools/         the Pages site builder and the merge kit
```

One GitHub Pages site serves the door at the root, `/value/` as an alias that forwards with the hash (every printed QR code still lands), `/tuner/` (a redirect to the world), `/strip/` (a redirect to the Strip) and `/garage/` (which forwards to the Garage at `#/garage`). Render serves the world from the root `render.yaml`.

`/strip` on the sim server: race as a guest with $500, rent a stock car at the counter for $500 an event, or make an account (Google or an emailed link) to keep progress and collect a $1,000 daily allowance. Accounts need four Render env vars (names only, set in the Render dashboard, never committed): `GOOGLE_CLIENT_ID`, `MAGIC_SECRET`, `RESEND_API_KEY`, `MAGIC_FROM`. Without them the guest path still works.

Tester mode, the owner's way to try any car without earning it first: set one more Render env var, `TESTER_KEY` (8 to 128 characters, set in the dashboard, never committed), then type `Name#key` on the `/strip` card. That guest gets every car on the list, $1,000,000 that refills, every stage and part, and **Garage** and **Swap car** in the pause menu. The key is sent beside the name, never shown as part of it, and the device remembers it for that name ("Forget it" on the card drops it). A tester's cars and builds last until the page is closed or reloaded, and a tester cannot be linked to an account. Without the variable tester mode is off.

## Run it

```
corepack enable && pnpm install
pnpm --filter @micar/value dev      # the door and the calculator
pnpm --filter @micar/sim dev        # the world (and /shop)
pnpm test                           # value's tests, which include the engine's, gate every deploy
pnpm site                           # builds the Pages tree into site/
```

Node 22, pnpm 10. Each app keeps its own React and Tailwind versions; the workspace keeps them apart and the brand package ties them together.

## Where the thinking is

- `docs/micar-central-page-plan.md`: what the central page is, how every line of the product hangs off one card, the world's three places, the engine, the phases.
- `docs/micar-garage-product-spec.md`: the brand, the card system, the grade, Keyholder, Octane, go-to-market.
- `docs/micar-monorepo-merge.md`: how the three repos became one, with every commit kept.
- `docs/superpowers/specs/2026-11-10-collectible-card-platform-design.md`: the card platform: the three layers (factory stats, this vehicle's stats, the grade), what counts as verified, the passport, rarity, the races.
- `packages/engine/README.md`: every formula the cards use, in words and tables, and how to call the engine.
