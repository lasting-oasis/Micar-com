# Night Tuner becomes MiCar World's engine

Design spec, Nov 5, 2026. Source: the "Night Tuner" artifact (one HTML file, ~1,280 lines, three.js r128). Target: `apps/sim`, MiCar World. Replaces the world, the driving model and the racing that are there today.

## What Night Tuner is

- **Physics** (`04-physics`): a two-axle model with longitudinal load transfer, a friction ellipse per axle, a Pacejka-style lateral tire curve, an engine torque curve through a gearbox and final drive, auto and manual shifting with a perfect-shift window and over-rev engine failure, turbo spool with blow-off, a nitrous bottle, handbrake, counter-steer assist, a drift mode, hydraulics. No DOM, no three.js: pure functions over a vehicle state. `simStats` derives 0–100, top speed and horsepower from the model; `dynoCurve` draws the dyno.
- **Data** (`03-data`): 5 cars (FWD/RWD/AWD; mass, wheelbase split, CG height, drag, area, redline, tire radius, gears, torque table), a visual parts catalog with prices and a star rating, 9 performance categories × 3 tiers unlocked by career stage, 8 dyno sliders, career stages by reputation, a save.
- **World** (`05-world`): an 8×8 grid city (90 m cells, 20 m streets), procedural buildings with lit windows, parks, street lights, neon signs, lane dashes and crosswalks; event markers; routes along the grid with cut corners; AI traffic that wanders, rivals that can be outrun, racers that follow routes with corner speed planning; collisions with blocks and cars.
- **Events** (`06-events`): sprint, circuit with laps, street X, drag (four lanes, manual only, traffic to dodge, perfect shifts, blown engines), drift (scoring with a multiplier and banking), outrun (get 300 m ahead of a rival); countdown, checkpoints, wrong way, standings, results with cash, reputation and a style bonus, best times.
- **Garage** (`07-garage`): a turntable scene; menus for visual parts, performance parts, dyno tuning, a car lot, options, quick race; stat bars with a preview diff; a dyno chart; magazine covers for style.
- **HUD, audio, input, cameras** (`08`, `09`): canvas tach and speed, race readout, GPS arrow, drag tach, minimap, world map with GPS routing; a synthesized engine, turbo, skid, nitrous and wind; keyboard, touch, gamepad; chase, far chase and hood cameras; a 120 Hz fixed physics step.

## What it replaces in `apps/sim`

- The driving model in `VanillaThreeScene.tsx` (kart feel: eased acceleration, `rotateY` steering).
- The Speedway oval, `RACE_TIERS` (beginner/medium/veteran laps), item boxes (bananas, shells), race rentals, and fuel.
- The town: `scene/world/{city,roads,vegetation,landscape,speedway,streetProps,fences,furniture}`. `dealership.ts` (the lot layout) is kept and placed on a block of the new city.
- The sprite Tuner (`apps/tuner`): stays in the repo, leaves the strip and the footer.

## Decisions

1. **Port, don't embed.** Night Tuner's sections become TypeScript modules under `apps/sim/src/world/`: `physics.ts`, `data.ts` (cars, parts, tunes, events), `city.ts`, `routes.ts`, `ai.ts`, `events.ts`, `garage.ts` (menu model), `hud.ts`, `audio.ts`, `input.ts`, `cameras.ts`, adapted to three 0.160 (color management instead of `sRGBEncoding`, physically correct light units, `BufferGeometryUtils` for merging). The React shell (`App.tsx`) keeps the Dealership's panels and gets a `WorldView` that owns the canvas and the loop. One world, one car on screen, one identity.
2. **One car system: the lofted bodies carry Night Tuner's parts.** The player's car is a lofted category body (`scene/car/*`, the set already on the cards) with Night Tuner's parts attached at anchors defined per category in `carStyles.ts`: front and rear bumper lines, hood and roof heights, skirt line, wheel positions and radius. Night Tuner's own `bodyShape` builder is retired. Rims, tires, calipers and the shadow come from Night Tuner's wheel builder, sized to the lofted wheel arches.
3. **Driving specs per real car.** Night Tuner's spec record (mass, a, b, h, cd, area, redline, r, fin, gears, torque table, drive) is produced by `packages/engine` from the card's trim: body style → mass, drag, area, CG, wheelbase split; EPA displacement, cylinders, induction and year → torque curve and redline; EPA drive → FWD/RWD/AWD; transmission → gears. Seven category archetypes (grown from Night Tuner's five) are the fallback when a trim is unknown. Condition states from the plan apply on top: not running (can't leave the garage), drivable but needs repairs (torque and grip multipliers, stall and overheat events), great (full specs). Performance parts and dyno tunes apply exactly as Night Tuner does.
4. **Octane is the money.** Night Tuner's cash is Octane. The Dealership's dollars become Octane at 1:1, so a $25,000 car is 25,000 Ø; the numbers stay, the unit changes everywhere in the world. Reputation (REP) stays as Strip reputation: stages unlock parts, events and cars, as Night Tuner does. The style rating and its magazine bonus stay.
5. **The Strip is real-time racing.** All six Night Tuner event types, placed in the city. This supersedes the plan's card-game drag race (Top Trumps, dice): the real thing is better and it exists. Wins pay Octane and Strip stamps on the card (first win, perfect shift, drift king, outrun); nothing in the Strip ever changes a grade or a card's condition.
6. **The Garage is Night Tuner's garage.** The turntable, the menus (visual, performance, dyno, options, quick race), the stat bars and the dyno chart, in MiCar's identity (windshield yellow on night, Barlow; Night Tuner's cyan and Saira go). The "car lot" menu becomes "your cars": the cards you own and the Dealership's inventory. Nothing here fixes condition (the DIY door: a DIY order is logged with evidence and counts at single weight until verified).
7. **Multiplayer stays as it is.** Physics runs on the client at 120 Hz; the car's pose goes to the server at the current rate (`sync_car_pos`) for other players. Events against AI run on the client and report to the server (`finish_event`, validated the way `finish_race` is today) for the Octane credit. The Night Tuner save (cash, rep, cars{cfg, tune, owned}, wins, best, options) moves into the server's player record; options stay local.
8. **Retired for good:** fuel, race rentals, item boxes, the oval. The plan's condition model covers what fuel was for.

## Phases

- **2a, the engine (first ship):** physics, data, city, routes, AI, events, garage menus, HUD, audio, input, cameras ported; MiCar identity; Octane; the lofted bodies with part anchors for the seven categories; the Dealership's lot placed on a block; results to the server; old world, driving, speedway, fuel removed. Playable end to end: enter the world, drive, tune, race all six event types, earn Octane and REP.
- **2b, real cars:** specs from trim and EPA data in `packages/engine`; condition states; a card from the door drives in the world (paste a `#/c/` code as a guest until accounts exist); card art re-rendered from the world's own car with its parts.
- **2c, the town fills in:** real shops' buildings and bays, DIY orders, the customer page link; the plan's phase 3.

## Tests

- `physics.test.ts`: each archetype's `simStats` lands in plausible bounds (0–100 between 3 and 14 s, top speed between 150 and 330 km/h); torque table interpolation; the perfect-shift window; over-rev blows the engine; nitrous drains and refills; a stock car never exceeds the friction ellipse.
- `routes.test.ts`: `buildRoute` lengths for a square loop; `routeProgress` finds the nearest point; checkpoint order.
- `events.test.ts`: standings order for sprint, drag with a DNF, drift by score; prize and REP math by position and stage.
- `anchors.test.ts`: every category has every anchor; parts sit within the body's bounding box.
- Playwright smoke: the world loads, the car drives for five seconds, a drag race starts and reaches results, the garage installs a part and the stat bars change.

## Open questions (answered by the owner before 2a starts)

- The night city replaces the town built on the sim branch (its blocks, people, daylight). Confirmed?
- Octane as the single unit in the world, Dealership prices included. Confirmed?
- Fuel and item-box racing go away. Confirmed?
