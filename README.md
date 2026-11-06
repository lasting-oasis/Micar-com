# MiCar

**Said MEE-car.** Your car is the second-biggest thing you own and the only one you never check. MiCar treats it like the asset it is: valued, tracked, graded, and provable.

Type a car at the door and it comes back as a card with today's value on it. Three entries later the card goes in a case with a grade from 1 to 10 that follows the car for life. The grade is free, for everyone, forever: you pay for the work, never for the number. The card lives in a garage, and the garage is a real place: a 3D town you can drive in.

## The doors

| Door | What it is | Where |
| --- | --- | --- |
| **The door** | The home page. Type a car; the garage door opens on its value, on a card. | [lasting-oasis.github.io/Micar-com](https://lasting-oasis.github.io/Micar-com/) |
| **Value a car** | The free calculator behind the door, line by line, with original sticker prices for 578 models. | `…/#/value` |
| **Garage** | Park a car, build its trail, get it graded and slabbed. *Opening with accounts (phase 1).* | `…/garage/` |
| **World** | MiCar World: a 3D town. The Garage (your cards as cars), the Dealership (learn the car business without paying for your mistakes), the Strip (race the car you tuned: six kinds of race, prizes in dollars, Octane and stamps). | [micar-sim.onrender.com](https://micar-sim.onrender.com/) |
| **For dealers** | Window sheets with the value, the forecast and a QR code that opens the car's page. | `…/#/sticker` |
| **For shops** | MiCar Shop: body shop, mechanic bay and a customer tracker for real shops, and the back office of a shop in the world. | [micar-sim.onrender.com/shop](https://micar-sim.onrender.com/shop) |
| **Tuner** | Absorbed into the Garage in the world: tune the car, then race it on the Strip. The old `/tuner/` link forwards to the world. | `…/tuner/` |

The same strip sits on top of every surface, with these doors in this order, and the wordmark always goes home.

## The repo

```
apps/value     the door, the calculator, dealer sheets, car pages   React 19 · Vite · 102 tests
apps/sim       MiCar World and MiCar Shop                            React 18 · three.js · Express (Render)
apps/tuner     the retired standalone configurator (kept, no longer shipped)
apps/explainer the explainer videos (Remotion, EN + ES)
packages/brand the identity: tokens, the five doors, the strip's stylesheet, the favicon
assets/        concept pages, card art, Blender sources, the explainer's voices
docs/          the plan, the product spec, the merge notes
tools/         the Pages site builder and the merge kit
```

One GitHub Pages site serves the door at the root, `/value/` as an alias that forwards with the hash (every printed QR code still lands), `/tuner/` (a redirect to the world) and `/garage/`. Render serves the world from the root `render.yaml`.

## Run it

```
corepack enable && pnpm install
pnpm --filter @micar/value dev      # the door and the calculator
pnpm --filter @micar/sim dev        # the world (and /shop)
pnpm test                           # value's 102 tests gate every deploy
pnpm site                           # builds the Pages tree into site/
```

Node 22, pnpm 10. Each app keeps its own React and Tailwind versions; the workspace keeps them apart and the brand package ties them together.

## Where the thinking is

- `docs/micar-central-page-plan.md`: what the central page is, how every line of the product hangs off one card, the world's three places, the engine, the phases.
- `docs/micar-garage-product-spec.md`: the brand, the card system, the grade, Keyholder, Octane, go-to-market.
- `docs/micar-monorepo-merge.md`: how the three repos became one, with every commit kept.
