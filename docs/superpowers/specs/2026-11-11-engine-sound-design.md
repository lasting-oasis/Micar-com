# Engine sound from engine facts

Date: 2026-11-11
Status: on main and the default since 2026-11-11, at the owner's decision. Not yet judged by ear or timed on a phone.

## What this is

Every car in the sim used to share one engine sound: three oscillators whose pitch follows rpm (`apps/sim/src/world/audio.ts`). This adds a second sound engine that works out each car's sound from facts about its engine and exhaust. There are no recordings and no hand-tuned sound per car.

"Sounds like the real car" here means recognisable character: a cross-plane V8 burbles, a flat-plane V8 does not, a flat-four with unequal headers rumbles, a turbo is softer than the same engine without one. It does not mean a listener cannot tell it from a recording.

The research behind the choice of method is in the project doc `micar-engine-sound-research.md`.

## How to hear it

It plays by default. Add `?sound=classic` to the game address to get the old synth back. The old synth also stays as the fallback when the browser cannot start the new one, and for electric cars.

To hear the model without the game:

    cd apps/sim
    npx tsx scripts/render-engine-sound.ts clips

This writes ten nine-second clips (idle, pull to the redline, lift off, idle) as WAV files.

## The model

All of it is in `apps/sim/src/sound/`. It has no dependencies and does not touch the DOM, so the same code runs in tests, in Node and in the audio thread.

1. **Firing table** (`firing.ts`). From cylinder count, layout and crank type: the crank angle at which each cylinder fires and which bank it is on. Firing is evenly spaced over 720°. A cross-plane V8 gives each bank the uneven pattern 90-180-180-270; a flat-plane V8 gives each bank an even 180°. A flat-four fires two on one side, then two on the other. A firing order can be given; `checkFiring` rejects one that does not match the crank type.
2. **Crank clock** (`engineSound.ts`). The crank angle advances each sample by the rpm. When it passes a firing angle, that cylinder writes one exhaust pulse.
3. **Pulse.** A sharp blow-down followed by a slower push as the piston clears the cylinder. Its size follows engine load, displacement per cylinder and boost. With the pedal off at speed the fuel is cut and a smaller air-only pulse remains; as the revs fall towards idle the fuel comes back, so the engine fires at idle with the pedal off. Each pulse varies a little at random, more at idle than under load.
4. **Runners.** Each bank's pulses travel down that bank's runner, a delay set by its length.
5. **Layout.** `single`: everything joins into one pipe. `merge`: two bank pipes of given lengths join into one. `dual`: two pipes run to the back, with a crossover that mixes a given share between them.
6. **Pipe.** Each pipe is a chain of sections: front pipe, catalyst, middle pipe, muffler, tailpipe. Each section carries a wave travelling back and a wave travelling forward. Where the pipe area changes, part of the wave reflects. The open end reflects most of the low sound back inverted and lets the rest out. This is what gives each pipe length its own resonances.
7. **Muffler.** `chambered`: a wide chamber that reflects. `straight`: a packed straight-through section that absorbs high sound. `none`: plain pipe.
8. **Turbo.** Softens the pulses, adds a whistle that follows boost and a blow-off on lift.
9. **Supercharger.** A whine at a fixed multiple of engine speed.
10. **Intake.** The same firing events drive a quieter intake sound through a resonator, opened by the throttle.
11. **Overrun.** Cars flagged for it pop on lift-off after hard running.
12. **Cut.** On a shift, the limiter or a blown engine the pulses drop to motored size.
13. **Output.** Two channels. Dual pipes sit left and right; everything else is centred. A soft limiter keeps the output in range.

### Inputs each frame

`rpm`, `throttle` (0 to 1), `load` (−1 to 1, negative is engine braking), `boost` (0 to 1), `cut` (0 or 1). `engineDrive()` in `world/audio.ts` reads these from today's driving model. The planned physics core should supply them directly; its Telemetry list does not yet include throttle, engine load or the cut flag.

### Constants

These are the same for every car and are not tuned per car.

| Constant | Value | Meaning |
|---|---|---|
| `SOUND_SPEED` | 500 m/s | speed of sound in hot exhaust gas |
| `ENGINE_END` | 0.6 | share reflected at the engine end |
| `TAIL_REFLECT` | 0.97 | share reflected at the open end |
| `PIPE_LOSS_PER_M` | 0.02 | loss per metre of pipe |
| `RISE_SOFT`, `RISE_HARD` | 1.6 ms, 0.6 ms | pulse rise time at light and full load |
| `PUSH_SHARE` | 0.3 | size of the push against the blow-down |
| `MOTORED` | 0.18 | pulse size with the fuel cut, against full load; an estimate, not measured from a car |
| `FUEL_BACK_RPM`, `FUEL_BACK_BAND` | 1800, 500 rpm | with the pedal off, fuel returns over this band as the revs fall, so the engine fires at idle |
| `JITTER_LOAD`, `JITTER_IDLE` | 0.05, 0.14 | random variation between pulses |
| `TURBINE_GAIN` | 0.55 | how much a turbo lets through |
| `CHAMBER_AREA` | 9 | chamber area against pipe area |

## Car facts

`facts.ts` holds the types. `carSound.ts` builds the facts for a car from what the catalog already has: the engine string ("5.0L V8", "2.5L H4 Turbo"), the body style and the redline.

| Fact | Where it comes from today |
|---|---|
| cylinders, layout, displacement, induction | read from the catalog engine string |
| crank type | V8 is taken as cross-plane; everything else as flat |
| firing order | none given; even firing for the layout |
| exhaust layout, crossover, runner and branch lengths, pipe length and bore, muffler, overrun pops | a default for the class of car |

Each car's facts carry a `basis` saying which parts are derived from the catalog and which are class defaults. No car has sourced exhaust data yet. A flat-plane V8 or an equal-length flat-four cannot be told from the catalog string, so those cars need a per-model entry before they sound right; the model already supports them.

A Garage turbo on a naturally aspirated engine switches its induction to turbo.

## In the game

- `engine.worklet.ts` runs the model in the audio thread as the `micar-engine` processor.
- `Audio` in `world/audio.ts` takes a mode. In `model` mode it loads the processor, sends it the car's facts and feeds it the frame inputs. Until the processor is running, and for cars with no facts, the old oscillators play.
- `VanillaThreeScene.tsx` sends new facts whenever the driven car changes.
- Only the player's car is voiced.

## Tests

- `firing.test.ts`: spacing per layout and crank, the firing order check.
- `engineSound.test.ts`: what the physics should give, measured from the rendered sound by engine order. Inline-four: second order leads. Cross-plane V8 on one bank's pipe: half orders stand within 10 dB of fourth order. Merged into equal pipes: they drop more than 20 dB. Unequal branches: they come back. Flat-plane: none. Flat-four with unequal runners: half orders rise more than 10 dB. Also load, cut, the two mufflers, intake, supercharger, turbo, pops, staying in range under random driving, silence when stopped, and speed.
- `carSound.test.ts`: reading the catalog string and the class defaults.
- `world/audio.test.ts`: the switch and the frame inputs.
- `e2e/sound.smoke.mjs`: renders one second through the built processor in Chromium and fails if it is silent or out of range. It runs in CI beside the Strip smoke test.

## Measured from the clips

Nobody has listened yet, so the ten clips were measured instead (2026-11-11). No clipping, no clicks, no dropouts, no offset. The order lines and pipe resonances show as expected on spectrograms. Levels, RMS:

| Part of the clip | Level |
|---|---|
| idle | -35 to -46 dB |
| full-throttle pull | -12 to -15 dB |
| lift-off | -46 to -58 dB (-23 dB for the car with overrun pops) |

The first measurement found the engine falling almost silent (-62 dB) with the pedal off, including at idle in the game. That is fixed and covered by three tests.

Still open from the measurements: idle sits 23 to 31 dB under full throttle. The old synth keeps idle about 7 dB under full throttle, so against the tyre and wind sounds the new idle may be faint and the new full throttle loud. This needs ears to settle.

## Cost

Measured in Node on a desktop Xeon: ten seconds of a dual-pipe V8 renders in about 0.15 to 0.2 seconds, so about 2% of one core. Chromium rendered one second offline in about 0.12 seconds. **Not measured on a phone.** It still needs timing on a mid-range phone; if it crackles there, `?sound=classic` is the way back.

## Not modelled

- Gas temperature: the speed of sound is one fixed value, so pitch does not drift as the exhaust heats.
- Side-branch resonators and exhaust valves.
- The turbine as a pipe element: it is a fixed loss.
- V angle beyond its effect on firing spacing.
- Mechanical noise, tyres, wind and the cabin.
- Other cars.

## Still to do (it became the default before these were done)

1. Listen to the ten clips and the game. Nobody has yet judged it by ear.
2. Time it on a phone.
3. Give the cars that the catalog string gets wrong a per-model entry.
4. Compare order plots against recordings of a few reference cars, as set out in the research doc.
