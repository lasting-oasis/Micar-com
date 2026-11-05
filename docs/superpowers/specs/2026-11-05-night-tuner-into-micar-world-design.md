# Night Tuner becomes MiCar World's engine

Design spec, Nov 5, 2026. Source: the "Night Tuner" artifact (one HTML file, ~1,280 lines, three.js r128). Target: `apps/sim`, MiCar World. Replaces the world, the driving model and the racing that are there today.

## What Night Tuner is

- **Physics** (`04-physics`): a two-axle model with longitudinal load transfer, a friction ellipse per axle, a Pacejka-style lateral tire curve, an engine torque curve through a gearbox and final drive, auto and manual shifting with a perfect-shift window and over-rev engine failure, turbo spool with blow-off, a nitrous bottle, handbrake, counter-steer assist, a drift mode, hydraulics. No DOM, no three.js: pure functions over a vehicle state. `simStats` derives 0–100, top speed and horsepower from the model; `dynoCurve` draws the dyno.
- **Data** (`03-data`): 5 cars (FWD/RWD/AWD; mass, wheelbase split, CG height, drag, area, redline, tire radius, gears, torque table), a visual parts catalog with prices and a star rating, 9 performance categories × 3 tiers unlocked by career stage, 8 dyno sliders, career stages by reputation, a save.
- **World** (`05-world`): an 8×8 grid city (90 m cells, 20 m streets), procedural buildings with lit windows, parks, street lights, neon signs, lane dashes and crosswalks; event markers; routes along the grid with cut corners; AI traffic that wanders, rivals that can be outrun, racers that follow routes with corner speed planning; collisions with blocks and cars.
- **Events** (`06-events`): sprint, circuit with laps, street X, drag (four lanes, manual only, traffic to dodge, perfect shifts, blown engines), drift (scoring with a multiplier and banking), outrun (get 300 m ahead of a rival); countdown, checkpoints, wrong way, standings, results with cash, reputation and a style bonus, best times.
- **Garage** (`07-garage`): a turntable scene; menus for visual parts, performance parts, dyno tuning, a car lot, options, quick race; stat bars with a preview diff; a dyno chart; magazine covers for style.
- **HUD, audio, input, cameras** (`08`, `09`): canvas tach and speed, race readout, GPS arrow, drag tach, minimap, world map with GPS routing; a synthesized engine, turbo, skid, nitrous and wind; keyboard, touch, gamepad; chase, far chase and hood cameras; a 120 Hz fixed physics step.

## What changes in `apps/sim`, by layer (decided with the owner, Nov 5)

1. **Business and server: kept, untouched.** Auctions, inventory, CRM, DMV, staff, bank, contracts, the shop tools, multiplayer sync. Night Tuner has none of this.
2. **Cars: kept.** The lofted category bodies, the paint and condition rules, the card art. Night Tuner's parts bolt onto these bodies at anchors defined per category (bumper lines, hood and roof heights, skirt line, wheel positions and radius). Night Tuner's own coupe body is retired; its wheel builder (rims, tires, calipers) is kept and sized to the lofted arches.
3. **Ground: the town stays as the home district.** Its blocks, roads, people, props and lighting are untouched. The Speedway becomes **the gate**: drive onto it and you load into **the Strip district**, Night Tuner's 8×8 grid city, where the six event types, the routes, the AI traffic, racers and rivals, the markers and the world map live. More districts later are more grids behind the same gate. The oval, its lap tiers, item boxes and race rentals are retired; the Strip is the racing.
4. **Motion: one driving model everywhere.** Night Tuner's physics replaces the kart feel in the town as well as in the Strip, so a car handles the same way at home and at the race, and every part and tune counts everywhere. The town's existing colliders are hooked to the new model. Fuel stays as a burn rate from throttle on top of the model.
5. **The sprite Tuner** (`apps/tuner`) stays in the repo and leaves the strip and the footer; the Garage is the tuner now.

## Decisions

1. **Port, don't embed.** Night Tuner's sections become TypeScript modules under `apps/sim/src/world/`: `physics.ts`, `data.ts` (cars, parts, tunes, events), `strip/city.ts`, `strip/routes.ts`, `strip/ai.ts`, `strip/events.ts`, `garage.ts` (menu model), `hud.ts`, `audio.ts`, `input.ts`, `cameras.ts`, adapted to three 0.160 (color management instead of `sRGBEncoding`, physically correct light units, `BufferGeometryUtils` for merging). The React shell keeps the Dealership's panels; the scene gets a district switch (town | strip) and one vehicle loop.
2. **Driving specs per real car.** Night Tuner's spec record (mass, a, b, h, cd, area, redline, r, fin, gears, torque table, drive) is produced by `packages/engine` from the card's trim: body style → mass, drag, area, CG, wheelbase split; EPA displacement, cylinders, induction and year → torque curve and redline; EPA drive → FWD/RWD/AWD; transmission → gears. Seven category archetypes (grown from Night Tuner's five) are the fallback when a trim is unknown. Condition states from the plan apply on top: not running (can't leave the garage), drivable but needs repairs (torque and grip multipliers, stall and overheat events), great (full specs). Performance parts and dyno tunes apply exactly as Night Tuner does.
3. **Dollars are the money; Octane is points, spent at the Octane store.** Night Tuner's cash is dollars, the same dollars the Dealership already uses, so prizes, parts and cars in the world are priced in $. Octane is earned by trail actions on the card and by Strip wins, and spent at the **Octane store**: regrades, card themes and features, and world cosmetics that are never for sale for dollars (the earned foil stays earned). Reputation (REP) stays as Strip reputation: stages unlock parts, events and cars. The style rating and its magazine bonus stay, paid in dollars.

4. **The Strip is real-time racing.** All six Night Tuner event types, in the Strip district. This supersedes the plan's card-game drag race (Top Trumps, dice). Wins pay dollars, plus Octane and Strip stamps on the card (first win, perfect shift, drift king, outrun); nothing in the Strip ever changes a grade or a card's condition.
5. **The Garage is Night Tuner's garage.** The turntable, the menus (visual, performance, dyno, options, quick race), the stat bars and the dyno chart, in MiCar's identity (windshield yellow on night, Barlow; Night Tuner's cyan and Saira go). "Car lot" becomes "your cars": the cards you own and the Dealership's inventory. Nothing here fixes condition (the DIY door: a DIY order is logged with evidence and counts at single weight until verified).
6. **Multiplayer stays as it is.** Physics runs on the client at 120 Hz; the car's pose goes to the server at the current rate (`sync_car_pos`) for other players, with the district in the message so players only see each other in the same district. Events against AI run on the client and report to the server (`finish_event`, validated the way `finish_race` is today) for the dollar prize and the Octane. The Night Tuner save (rep, cars{cfg, tune, owned}, wins, best) moves into the server's player record; options stay local.

## Phases

- **2a, the engine (first ship):** physics, data, the Strip district (city, routes, AI, events, markers, map), garage menus, HUD, audio, input, cameras ported; the town hooked to the new physics; the Speedway turned into the gate; MiCar identity; dollars for prizes and parts, Octane and stamps on wins; the lofted bodies with part anchors for the seven categories; results to the server; the oval, lap tiers, item boxes and rentals removed. Playable end to end: drive the town, take the gate, tune, race all six event types, earn dollars, Octane and REP, come home.
- **2b, real cars:** specs from trim and EPA data in `packages/engine`; condition states; a card from the door drives in the world (paste a `#/c/` code as a guest until accounts exist); card art re-rendered from the world's own car with its parts.
- **2c, the town fills in:** real shops' buildings and bays, DIY orders, the customer page link; the plan's phase 3.

## Tests

- `physics.test.ts`: each archetype's `simStats` lands in plausible bounds (0–100 between 3 and 14 s, top speed between 150 and 330 km/h); torque table interpolation; the perfect-shift window; over-rev blows the engine; nitrous drains and refills; a stock car never exceeds the friction ellipse.
- `routes.test.ts`: `buildRoute` lengths for a square loop; `routeProgress` finds the nearest point; checkpoint order.
- `events.test.ts`: standings order for sprint, drag with a DNF, drift by score; prize and REP math by position and stage.
- `anchors.test.ts`: every category has every anchor; parts sit within the body's bounding box.
- Playwright smoke: the world loads, the car drives for five seconds, a drag race starts and reaches results, the garage installs a part and the stat bars change.

## Settled with the owner

- The town stays; the Strip district is Night Tuner's city behind the Speedway gate.
- One driving model everywhere; fuel stays; item boxes, the oval and rentals go.
- Dollars are the currency in the world; Octane is points, with an Octane store to spend them in.
