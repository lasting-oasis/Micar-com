# MiCar race UI: a Slipstream-style race HUD and race menu in the Strip

- **Date:** 2026-11-12
- **Status:** approved to build on 2026-11-12, revised after the owner's review (section 11). Stage 1 is built in two parts, 1a and 1b.
- **Stage:** 1 of 3. Stages 2 and 3 (the track look and new circuits) are outlined in section 10 and get their own designs.
- **Source of the idea:** the Slipstream Grand Prix recon (`claude/slipstream-gp-rea-spec.md`)

## 1. Intent

The owner likes Slipstream GP's racing UI and menus and wants that experience in MiCar, built on MiCar's own cars, driving physics and engine sound. Racing is MiCar's current emphasis, and phone and desktop count equally.

Success looks like this:

- A race in the Strip reads like a proper race: lights out, a timing tower, lap and sector times, a clean dash and a results table.
- A race menu gets a player from anywhere in the Strip onto a grid in a few taps.
- The town stays the way in for anyone who drives to an event.

## 2. What exists today

- **Events.** The Strip (`apps/sim/src/world/strip/`) has 10 circuits and 20 events of five types: circuit, sprint, street X, drag and drift (`world/data.ts`, `EVENTS`). Circuit and street X events run 2 or 3 laps. Dry Lagoon has only a street X event.
- **Getting into an event.** There are two ways. You can drive to the event's marker at its circuit and press Enter (`StripScene.startEvent`). Or you can pick it from the Garage's Quick race list (`world/garage.ts`, then `GarageMenu.tsx` calls `onQuickRace`), which loads the circuit and starts the event.
- **How a race runs.** `EventRunner` (`world/strip/events.ts`) runs a 3-2-1-GO banner countdown on a four-place grid, with checkpoints and a wrong-way warning. Standings sort by finish time, then by distance. Results go to `useDriveUi.results` (`DriveLayer.tsx`) and prizes come from `prizeFor`.
- **Challenges.** A room holds up to four people (`world/race.ts`). The server names the green light 5 s ahead (`GO_LEAD_MS`), and the clients count down to it.
- **Computer racers** (`world/strip/ai.ts`). There are three, each a randomly kitted body (`randomCfg` plus a random racer body style). They follow the route at a lane offset by a formula, not by the physics:
  - top speed is a share of the player's: 0.74 + 0.06 × stage, ±4%
  - acceleration is 1.1 × the player's
  - they speed up 8–22% when behind the player and slow 14% when far ahead
- **The race HUD** is a canvas (`world/hud.ts`, ported from Night Tuner). It draws:
  - a gauge cluster: tach, speed, gear, nitrous arc, boost bar, SHIFT light
  - cash
  - position, lap, time, and the gap as a distance
  - the drift score
  - a corner minimap

  No lap or sector times are recorded. The player's record keeps one best result per event.
- **Overlays and controls.** Pause and results are React overlays in `DriveLayer.tsx`. The touch controls are `TouchSticks` plus buttons wired by `InputMap`.
- **Brand** (`packages/brand/src/tokens.ts`):

  | Token | Value |
  |---|---|
  | night | `#0e1217` |
  | night2 | `#161b22` |
  | line | `#262d37` |
  | ink | `#e7eaee` |
  | haze | `#9aa3ad` |
  | paint (the accent) | `#ffd23f` |
  | paint2 | `#e0b22a` |
  | tube | `#3d7bff` |
  | tube2 | `#79a6ff` |

  Barlow Condensed is used for numbers and headings, Barlow for text. Every string comes in English and Spanish through `i18n.tsx`.

## 3. Approaches considered

1. **A new race HUD only,** with matching results and pause screens. It's the smallest change, but it has no menu, and the menu is half of what the owner asked for.
2. **A new HUD plus a race menu inside the Strip. Picked by the owner.** It gives the menu without a second front door. The town stays the way in, as the central-page plan asks ("the geography is the menu").
3. **A separate race game** with its own title, hub and race flow, skipping the town. It's the closest to Slipstream, but it adds a second way into racing beside the Strip, which the central-page plan rules out, and it's more to maintain.

## 4. Goals, non-goals, anti-goals

**Goals**

- A Slipstream-style race HUD for circuit, sprint and street X events, solo and in challenges.
- Five start lights in place of 3-2-1.
- Lap times, best lap, three sectors and gaps in seconds for every car in a race.
- A race menu that opens anywhere in the Strip and puts the player on the grid of any unlocked event.
- Slipstream-style results and pause screens.
- Computer racers in real MiCar catalogue cars close to the player's class.

**Non-goals for this stage**

- Racer AI on the physics, a bigger grid, and removing the rubber band. These belong to stage 4 of the physics-core plan.
- New circuits, or a new look for the existing ones. These are stages 2 and 3 below.
- Changes to the drag and drift HUDs, the free-roam HUD, or the touch controls.
- Flashback, a racing-line guide, brake or steering help, damage, weather, replays, a championship, a career or a daily race.
- Changes to payouts, prizes, unlock rules or the server's rules.

**Anti-goals: a failure even if it works**

- Anything that looks like Slipstream's brand: its red slash logo, its typeface (Titillium Web) or its names.
- A challenge in which the lights go out at different times on different screens.
- A race that runs slower on a phone than it does today.
- A menu that replaces driving to events, or that hides the town.

## 5. Constraints

- **Phone and desktop equal.** Every screen works by touch and by keyboard, and with a gamepad wherever the Strip already supports one.
- **Frame budget.** The new HUD costs no more per frame than today's canvas on a mid-range phone. Nothing re-renders through React every frame.
- **Language.** Every new string comes in English and Spanish.
- **Dependencies.** None are added. The work builds on React 18, Tailwind, zustand and the existing canvas code.
- **Existing behaviour.** Today's tests stay green. The challenge-room protocol is unchanged, and the server's green-light time stays authoritative.

## 6. Design

### 6.1 Race HUD (circuit, sprint, street X)

Desktop, in Slipstream's arrangement:

```
+------------------------------------------------------------------+
| +-TOWER---------------+        o o o o o         +-LAP TIMER---+ |
| | LAP 2/3             |      (start lights)      |   1:12.408  | |
| | 1 | Rico   M4   LEADER|                        | ===|===|=== | |
| | 2 | YOU    Civic  +0.8|                        | LAST 1:14.2 | |
| | 3 | Nadia  Accord +2.1|                        | BEST 1:13.9 | |
| | 4 | Bram   Focus  +4.6|                        +-------------+ |
| +---------------------+                                          |
|                  [ banner: LAP 2/3 / WRONG WAY ]                 |
|                                                                  |
| +-MAP-+          +---------- DASH ----------+      +-YOUR CAR---+ |
| |     |          |  * * * * * . . .  revs   |      | Civic      | |
| +-----+          |  NOS (    4    71 MPH    |      | NOS ####.. | |
|                  +--------------------------+      | FUEL ##### | |
|                                                    +------------+ |
+------------------------------------------------------------------+
```

On a phone in landscape it uses Slipstream's compact arrangement:

- position and lap chips at the top left, with the tower under them (four rows at most)
- the lap timer at the top centre, below the car panel when it shows
- the minimap at the right, under the pause and reset buttons that already sit at the top right
- a small dash where today's gauge cluster sits, which already clears the touch sticks

The touch controls stay where they are. Portrait follows the Strip's current behaviour. The HUD is drawn on the existing HUD canvas, not in React, to protect the phone frame rate.

- **Tower.** Each row shows the position, a stripe in the car's paint colour, the driver's name, the car model and the gap to the leader in seconds (or "+1 LAP"). The player's row is in accent yellow. People in a challenge show under their own names.
- **Lap timer.** It shows the current lap time and three sector bars that fill as each sector ends: green for a personal best sector, purple for the race's fastest, yellow otherwise. Under them are LAST and BEST. A sprint shows the elapsed time and sector splits only.
- **Dash.** A big gear figure, the speed in the player's units, rev lights across the top (the shift point lights as today's SHIFT light does), nitrous as an arc where Slipstream shows the battery, and boost as a thin bar.
- **Your-car card** (bottom right, where Slipstream shows tyres): the model name, the nitrous bottle and boost. Fuel isn't repeated: the game's fuel tank already shows in the car panel at the top centre (the physics itself has no fuel).
- **Labels** come in English and Spanish. Today's canvas HUD is English only, so it gets the player's language.
- **Banners.** The lap, final-lap, wrong-way and finish messages, restyled from today's.
- **Minimap.** Today's map, moved to the bottom left.
- **Cash** is hidden during a race. It shows on the results.

### 6.2 Start lights

Five red lights at the top centre, for circuit, sprint and street X events. Drag and drift keep today's 3-2-1, because their HUDs are unchanged in this stage.

- **Solo.** The first light comes on after 0.4 s and one more each second. After the fifth, a random hold of 0.5–2 s, then all go out: that is the green.
- **Challenge.** Light *n* comes on at green − (6 − *n*) s, so the fifth lights 1 s before the server's green, and all go out exactly at the server's green. There is no random hold, so every screen matches. The server already names the green 5 s ahead, which is exactly the time five lights need. A client that learns the time late shows the lights it missed straight away.
- **Sounds.** The countdown beeps move to each light and to lights-out.
- **Moving before green.** Who may move before the green follows today's rule.

### 6.3 Timing data

These figures are kept in the race state for every car (the player, computer racers and people), all measured from race distance along the route:

- **Laps.** A lap ends at each multiple of the lap length. Lap time is now minus the lap's start. Each car keeps its best lap, and the race keeps its fastest.
- **Sectors.** Each lap splits into three equal thirds by distance.
- **Gaps.** Every car records the race time at which it passed each 10 m of race distance. The gap from car B to car A is now minus the time A passed B's current distance. The leader's row reads LEADER.
- **People in a challenge.** Their figures are computed from the positions the network already sends. A figure that is only an estimate is marked as one, the way standings already mark estimates (`Standing.estimated`).
- **Results.** The results screen uses the same data: total time, gap and best lap.

### 6.4 Race menu ("Races", Spanish "Carreras")

**Opening and closing**

- It opens with **T**, with an on-screen button next to the existing tap buttons, or from the pause menu. (E is taken: it gets you in and out of cars.)
- Inside it, **Q** and **E** switch tabs, the arrows move, **Enter** chooses and **Esc** closes.
- Opened during a solo race, it pauses the race. A challenge race never pauses: it keeps running behind the menu. Opened while driving free in the Strip, it brings the car to a stop and ignores driving input until it closes.

**Tabs.** These are MiCar's names, laid out on Slipstream's structure.

- **Home.** Four cards:
  - *Race again:* the last event raced; hidden if there is none.
  - *Quick race:* one tap to the first unlocked lapped event (circuit or street X) the player hasn't won yet, taking events by stage and then in `EVENTS` order, or a random unlocked one if all are won.
  - *Challenge a friend.*
  - *Your record:* wins, best times, and the current stage with the rep needed for the next.
- **Events.** One card per circuit. Each card shows:
  - the circuit's outline, drawn from its centre line
  - its name in the player's language (`TRACK_NAMES`) and its length
  - its events, each with its type colour (`EV_COL`), name, laps, prize and the player's best

  A locked event shows the stage it needs.
- **Challenge.** Today's challenge flow (`ChallengeSetup`, `WaitingRoom`), shown inside the menu.
- **Options.** Today's drive options: transmission, units, camera, sound and touch controls.

**Starting a race**

- A race starts by the Garage's Quick race path: load the circuit if needed, then start the event, with a loading state on the card.
- **Needs a car.** With no car out (the rental lobby), the start buttons read "Pick a car first" and lead to the rental bay or the garage. Visitors race in their rental as today, and the rental's return rules are unchanged.
- **In a challenge room,** the menu and the pause screen offer only Resume, Options and Leave race. Restart and starting other events stay off until the player leaves the room.

Home tab, desktop:

```
 MICAR  RACES       [Q]  HOME   EVENTS   CHALLENGE   OPTIONS  [E]
 +-------------------------+ +----------------+ +----------------+
 | RACE AGAIN              | | QUICK RACE     | | CHALLENGE      |
 | Harbour GP - 2 laps     | | next unwon race| | race a friend  |
 | best 2:41.3          -> | +----------------+ +----------------+
 |                         | +---------------------------------+
 |                         | | YOUR RECORD  4 wins - stage 2   |
 +-------------------------+ +---------------------------------+
 arrows select   ENTER start   ESC close
```

### 6.5 Results

- A classification table with the position, name, car, total time or gap, and best lap. The race's fastest lap is highlighted.
- Beside it, the prize from today's payout: cash, rep, Octane and any style bonus.
- Actions: Race again, Race menu, Back to the Strip.
- Today's result content is kept; only the layout changes.

### 6.6 Pause during a race

- On the left, a list: Resume, Restart, Race menu, Options, Leave race. In a challenge, only Resume, Options and Leave race.
- On the right, a session card: the event, lap, position, last and best lap, and the car.
- Today's phone tap buttons (reset, map) stay.

### 6.7 Computer racers in real cars

Each of the three computer racers drives a real model from the catalogue. That is 37 models across five makes in `carCatalog.ts`, with figures in `carSpecs.ts`. Each is shown in its body style, with a paint colour and the existing kit options.

- **Choosing them.** The pick is the nearest by power-to-weight to the player's car (the rental fleet has figures too). The same body-style group is preferred:
  - sports with coupe
  - sedan with hatchback
  - SUV, truck and van together

  The choice is random among the nearest few, so races vary, and no model repeats in a race.
- **Naming.** The tower shows the driver's name and the model, for example "Nadia · Accord".
- **Pace.** Each rival's top speed and acceleration come from its own car, run through the same car model the player's car uses (`simStats` on that model's figures). Real-world figures are not used. Today's model runs real cars slower than they are (a Corvette does 0–60 in 5.1 s in the game against 3.0 s in reality), so real-world figures would make rivals unbeatable. An Accord rival and the player's Accord are equal. The stage share (0.74 + 0.06 × stage) stays. The rubber band is halved, and it goes in physics-core stage 4, when the AI runs on the physics.

### 6.8 Look

MiCar's brand, laid out with Slipstream's information design:

- **Panels.** Night at about 90% opacity with a 1 px line border. An accent-yellow bar marks the focused card or row and the player's row in the tower.
- **Type.** Headings and big numbers in Barlow Condensed, heavy italic, uppercase. Small labels in Barlow, uppercase, widely letter-spaced. All numbers tabular.
- **Status colours.**
  - green for a personal best
  - purple for the race's fastest (green and purple are added to the brand tokens as status colours)
  - tube blue for information banners
  - red for warnings
- **Motion.** Menus fade and slide in. The world blurs behind the menu and the pause screen. The lights pop on.
- **No Slipstream marks.** No red slash logo, no Titillium Web, no Slipstream names.

### 6.9 Language

- Every new string comes in English and Spanish through `i18n.tsx`.
- Circuit names come from `TRACK_NAMES`.
- Speeds and distances follow the player's units option.

## 7. Checks before it ships

- **Unit tests** (vitest):
  - lap, sector and gap timing, including a lapped car and a person in a challenge
  - the light sequence, solo and against a named green, including a late join
  - opponent picking: nearest class, no repeats, the same result for the same seed
  - the menu's model: locked events, the car needed, Race again, Quick race
- **Existing tests** stay green, including the events, HUD, race and race-network tests.
- **Browser run** (Playwright, `apps/sim/e2e`), at 1440×900, 844×390 and 390×844: guest, open the race menu, start Harbour GP, lights, one lap, pause, restart, finish or leave, results.
- **Two-browser challenge:** both screens' lights go out at the same server time.
- **Frame time** in a race, before and after, on a CPU-throttled mid-range phone profile: no worse.
- **Screenshots** of the HUD, menu, results and pause, on desktop and phone, for the owner's sign-off on the look.

## 8. Calls made in this design (for the owner to check)

1. The menu opens with **T**; **Q** and **E** switch tabs only while it is open.
2. The new HUD covers circuit, sprint and street X. Drag, drift, outrun and free roam keep today's HUD, with panels restyled to match.
3. Computer racers get their pace from their own car through MiCar's car model, with the rubber band halved, until physics-core stage 4.
4. Opponents are chosen by power-to-weight near the player's car, preferring the same body-style group.
5. Sectors are equal thirds of the lap by distance.
6. The solo lights hold randomly for up to 2 s; challenge lights have no hold.
7. Purple marks the race's fastest lap and sectors, green a personal best. Both are new status colours in the brand tokens.
8. The menu is called "Races" ("Carreras").
9. Cash is hidden during a race and shown on the results.
10. The bottom-right card shows the player's car, nitrous and boost.
11. Quick race goes to the first unlocked lapped event the player hasn't won.
12. In a challenge room, Restart and starting other events are off, and the race never pauses.
13. The Garage's own Quick race list points at the new menu in 1b.
14. The new HUD is drawn on the existing HUD canvas.
15. The five lights cover circuit, sprint and street X; drag and drift keep 3-2-1.

## 9. Left to the builder

- File layout, for example `world/race/` for timing and the menu's model.
- Exact animation, sizes and spacing.
- How the menu reuses the Garage's quick-race path.
- Gamepad behaviour, following the Strip's existing pad support.

## 10. After this stage

**Stage 2: the track look.** All 10 circuits keep their layouts, names and events. Their trackside is rebuilt in Slipstream's style from each circuit's centre line:

- asphalt with a darker racing line and painted edges
- raised kerbs on corners
- run-off (grass, gravel or tarmac) by corner speed
- concrete walls with MiCar boards, armco, tyre walls and catch fences
- a start gantry carrying the five lights, and grid slots
- pit wall and garages
- grandstands and braking boards
- trees, grass and a sky

Textures come from CC0 sources (Poly Haven, ambientCG), sized for phones. To decide then: how much of each circuit's current Blender scenery stays, and the phone budget.

**Stage 3: new circuits in the menu.** Slipstream's own circuits cannot be copied: its repository has no licence, so its circuit data is all rights reserved. New circuits are built fresh with the stage-2 builder, either from open outlines of real circuits or designed by hand, and given MiCar names. A source for those outlines is the MIT-licensed bacinger/f1-circuits dataset, which Slipstream also credits. A first set could cover the venue types Slipstream has and MiCar lacks:

- a desert venue
- a river-island street circuit
- a mountain road course
- a hillside harbour town

Each gets its events and appears in the menu's Events tab. To decide then: which circuits, and how many.

## 11. Revision after the owner's review (2026-11-12)

The owner asked for a thesis, antithesis and synthesis, then to improve the synthesis and build. These changes came out of that review.

**Stage 1 is built in two parts.** Each part ships and is tested on its own.

- **1a: the race itself.** Built in this order:
  1. lap, sector and gap timing
  2. the five start lights
  3. the race HUD
  4. results
  5. pause
  6. one look: today's drag, drift and free-roam panels restyled to match
- **1b: getting to the race.** It covers:
  - the race menu, with "Drive there" (the existing GPS) beside "Start" on every event
  - the Garage's Quick race pointed at the menu
  - real-car rivals, with pace from their own car through MiCar's model and the rubber band halved
  - a phone measurement of 8 cars. The solo grid grows only if the frame rate holds, and growing it also needs more grid places per circuit (there are four today). Challenges stay at four.

**Corrections from reading the code:**

- E is taken (enter and exit a car), so the menu key is T.
- Fuel already shows in the car panel at the top centre, so the car card shows nitrous and boost. (An earlier draft said cars have no fuel model. That was wrong: the physics has none, but the game keeps a fuel tank.)
- The canvas HUD is English only, so it gains the player's language.
- The phone's top right holds the pause and reset buttons, so the phone minimap sits under them.
- The camera's start sweep and the challenge "staging" check read the old countdown, so both move to the lights' timing.

**Tests** drive races through the existing `window.__micar` hook (startEvent, place, drive), which `e2e/strip.smoke.mjs` already uses.

**As built on phones (1a), after the screenshots at 844×390 and 390×844:**

- The tower keeps the top left in landscape. Its header carries the lap (LAP 1/2) and the player's highlighted row the position, so there are no separate chips.
- The lap timer sits at the top centre, just under the car panel. The checkpoint arrow rides in its first row with the distance: under the timer it covered the car.
- The minimap sits at the top right under the pause and reset buttons, sized to clear the NOS and DRIFT buttons (a 39 px radius at 844×390, showing the same ground). It is left out where less than a 28 px radius fits.
- In portrait the car panel holds the top centre, so the tower and the timer share the row under it. The lights take the timer's place during the count, and the map sits under the timer.
- The car panel is measured in page pixels while the HUD canvas starts 64 px down the page; the race HUD converts between the two. Free roam keeps its old arrow placement.
- The tower's rows have no car model yet: the computer racers get real cars in 1b.

**Frame cost as measured (1a).** Main's HUD against 1a's, same race state, same machine, real Skia raster at 2×: the race HUD's raster went from 0.357 to 0.422 ms per frame at 844×390 and from 0.380 to 0.462 ms at 1440×900 (its larger translucent panels); JS time is unchanged. That is about 0.07–0.08 ms a frame, roughly 0.5% of a 60 fps frame, so the "no more than today" budget is missed by that much. A phone GPU was not measured.

**Alongside, not before.** The race UI doesn't depend on the physics. The physics core is what fixes how the cars drive, so it is worth running in its own sessions while this is built.
