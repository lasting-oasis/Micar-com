# Mobile stick controls — plan

**Goal:** replace the phone driving buttons with the layout tried on the test page: a steering-wheel stick on the left, an up-and-down gas stick on the right, and hold buttons for Drift and NOS. Keep the old buttons as a setting.

**Builds on:** branch `touch-controls` (reverse steering fix, per-finger touch tracking). Merge that first.

**Test page (the reference for feel):** https://claude.ai/artifact/Pyd6TVLnDSeZJbaj98sZWL, which runs the game's own `physics.ts`.

## Decisions

1. **Default on phones: sticks.** Settings → Controls: *Sticks* (default) or *Buttons* (today's six buttons). Saved with the other drive options in `micar.driveOptions` as `controls: 'sticks' | 'buttons'`. Keyboard and gamepad are unchanged.
2. **Left stick = steering.** Only left/right counts. The knob is a steering wheel that turns up to half a turn at full lock. Output `steer` from −1 to 1.
3. **Right stick = gas and brake.** Locked to up and down; sideways thumb movement is ignored. Up gives `fwd` (0–1); down gives `back` (0–1), which the game already turns into brake and then reverse once stopped.
4. **Stick feel** (copied from the test page): a 14% dead zone, then a curve, power 1.8 for steering and 1.4 for gas. The game's own steering smoothing stays as it is.
5. **DRIFT (hold):** while held, the game's drift mode is on, with a 0.3 s pull of the hand brake when it is pressed. On release the car goes back to whatever the X-key toggle had. This replaces the E-brk button.
6. **NOS (hold):** the same `nos` input as today.
7. **Gears:** the ▲/▼ gear buttons appear only when gears are shown today (manual, or a drag), as two small buttons above the left stick.
8. **Drag lane changes:** a flick of the steering stick past 60% raises the same `laneL` / `laneR` edge a fresh ◀/▶ press raises today. It re-arms when the stick comes back under 30%.
9. **Reset, pause, map and GPS** stay where they are.

## Files

- `apps/sim/src/world/sticks.ts` (new, pure): `shapeAxis(v, dead, power)`, `stickToInput(steerX, gasY)` returning `{ steer, fwd, back }`, and `laneEdge(prevX, x, armed)` returning `{ laneL, laneR, armed }`.
- `apps/sim/src/world/sticks.test.ts` (new): dead zone gives 0; full travel gives ±1; the curve is below linear at half travel; the gas stick ignores x; a lane flick fires once and re-arms only after returning.
- `apps/sim/src/world/input.ts`: `InputMap` gains `setStick('steer' | 'gas', x, y)`, `setDriftHold(on)` and the hand-brake kick timer. `build()` merges the stick values with keys, buttons and the pad, taking the largest of each.
- `apps/sim/src/world/input.test.ts`: the sticks drive `build()`; drift hold sets `hb` for 0.3 s then clears it; releasing everything gives `NO_INPUT`.
- `apps/sim/src/world/TouchSticks.tsx` (new): the two sticks and the two hold buttons, each finger tracked on its own (pointer id), released on `pointerup` / `pointercancel` anywhere.
- `apps/sim/src/world/DriveLayer.tsx`: shows `TouchSticks` or the old buttons depending on `controls`; adds the Controls setting to the options panel.
- `apps/sim/src/world/options.ts` (+ test): the `controls` field, defaulting to `'sticks'`, with old saved options still read.
- `apps/sim/src/VanillaThreeScene.tsx`: while Drift is held, pass drift mode as on to `stepVehicle`, and restore the toggle on release.
- `apps/sim/src/i18n.tsx`: labels for Steer, Gas · Brake, Drift, NOS, Controls, Sticks and Buttons (en and es).
- `apps/sim/e2e/strip.smoke.mjs`: a phone run that rents a car, drives with the sticks through CDP touch events, drifts, and checks every control lets go when the fingers lift.

## Order of work

1. `sticks.ts` and its tests.
2. `InputMap` stick inputs and drift hold, with tests.
3. `TouchSticks.tsx`, plus the `DriveLayer` switch and the setting.
4. The drift-mode hookup in the scene.
5. The smoke run on a phone-sized screen, then the full checks (sim and value tests with nothing on stderr, `tsc`, build, `pnpm site`).
6. Push the branch and wait for the owner's "merge".

## Risks

- **iPhone edge gestures:** the bottom-edge swipe can delay touches. The sticks sit at least 22 px above the safe-area inset.
- **Two thumbs plus Drift or NOS:** reaching a hold button means lifting the right thumb off the gas. The buttons sit right above the gas stick so a thumb can roll between them.
- **Feel on real phones:** test on at least one iPhone and one Android before merging, and tune the dead zone and curves if needed.
