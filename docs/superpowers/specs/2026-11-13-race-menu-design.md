# MiCar race UI 1b, part 1: the race selector and the race map

- **Date:** 2026-11-13
- **Status:** approved by the owner on 2026-11-13 ("make the best selection and you're approved on my end").
- **Parent design:** `2026-11-12-race-ui-design.md`, section 6.4 (the race menu) and section 11 (stage 1b).
- **Reference:** the owner's screenshot of Slipstream GP's Quick Race circuit screen and its in-race map.

## Intent

The owner: "the racing map, and race selector still don't look like this. Can you make ours look like the screenshot?"
The selector should read like the screenshot's circuit screen, and the race map like its circuit outline, in MiCar's own look.

## What exists

- Races start from the Garage's Quick race list (it sets `useDriveUi.quick`, which the frame loop turns into
  `startEventById`) or by driving to an event marker. The approved race menu (1b) is not built.
- The race map is a round radar of the ground around the car (`hud.ts`), in every mode.

## Approaches

1. **A Races screen in the screenshot's layout, plus an outline race map. Chosen.** It is the approved 1b menu, shaped
   like the screenshot, and it starts races through the existing quick path.
2. Restyle the Garage's Quick race list. It would stay a list inside the Garage, nothing like the screenshot.
3. A separate title screen before the Strip. The approved design rules out a second front door.

## The design

**Races** ("Carreras") opens with **T**, or a RACES button beside the Strip's tap buttons, anywhere a player can
drive, and not during a live event or a challenge race. While it is open the car holds still and driving input is
ignored. Esc closes it.

**Circuit step** (the screenshot's layout, in MiCar's look: Barlow Condensed, night panels, the yellow accent, the
MiCar logo; no Slipstream marks):

- The circuit's MiCar name, large and heavy italic; its country and "Circuit n of 10"; a one-line description.
- Stats: length (in the player's units), corners, events, and the player's best time there.
- A large map of the circuit: three sectors by distance in yellow, red and blue, corner numbers, the start line,
  and a sector legend.
- A row of ten circuit cards along the bottom: outline, number, name and country. The selected card is white, with a
  yellow bar. A circuit with every event locked shows a lock.
- Hints: ◀ ▶ Circuit, ENTER Confirm, ESC Close. On touch: tap a card, then Continue.

**Event step:** the same hero, with the chosen event's route highlighted on the map, and the circuit's events as
cards: type colour, name, laps or length, prize, the player's best, and a lock with the stage it needs.
ENTER starts it through the quick path; Esc goes back to the circuits. Without a car out, Start reads "Pick a car
first" and does nothing.

**Race map:** in circuit, sprint and street X races, the whole route as a white outline with a dark edge, north-up,
fitted to the map's box, with the start line and every car as a dot (the player in yellow). Drag, drift and free roam
keep the radar. Its places don't change.

**Data:** `tools/blender/circuit_maps.py` (no Blender) reads each circuit's centre line and event routes from
`public/strip/tracks/<id>.json` and writes `src/world/strip/circuitMaps.json`: each circuit resampled to 180 points
with its length, sector starts and corner apexes, and each event's route resampled. The menu loads it on first open.

**Corners** are counted from the smoothed curvature: runs over 1/300 m⁻¹ of one sign, gaps under 25 m merged, kept
when they turn at least 25°, numbered from the start line at their apex.

## Calls made (for the owner to check)

1. Each circuit shows its real country beside its MiCar name, and a one-line description in English and Spanish.
2. Sector colours on the map: yellow, red, blue, as in the screenshot.
3. Circuits are numbered in the order of `tracks.json`.
4. The Garage's Quick race list stays as it is for now; the real-car rivals (the rest of 1b) come after this.
5. The race map is north-up and plain white, like the screenshot's; the radar stays for free roam, drag and drift.

## Checks

pytest for the map data; vitest for the menu's model (circuits, events, locks, bests, the first selection, keys)
and the map fitting; the tracks smoke drives every race through the menu on desktop and phone, with screenshots;
the full suites, the build and every smoke; a fresh review.
