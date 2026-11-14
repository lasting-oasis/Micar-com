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

An AudioParam carries any float, so the model takes an input past either end of its range as that end, and NaN as the low end. rpm stops at ten times the redline (`RPM_CEILING`). That is a guard, not physics: the game reaches about 4.7 times on a downshift at speed, and a few million rpm once hung the audio thread in the crank clock. Before 2026-11-14 a boost below zero on a turbo engine made the whistle's phase NaN for good, and every sample with it.

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
| pipe bore | worked out from displacement, redline, induction and the number of pipes |
| pipe length | the car's wheelbase plus 0.4 m when a real wheelbase is given; the catalog has none, so a default for the body style |
| exhaust layout, crossover, runner and branch lengths, muffler, overrun pops | a default for the class of car |

Each car's facts carry a `basis` saying which parts are derived from the catalog and which are class defaults. No car has sourced exhaust data yet. A flat-plane V8 or an equal-length flat-four cannot be told from the catalog string, so those cars need a per-model entry before they sound right; the model already supports them.

A Garage turbo on a naturally aspirated engine switches its induction to turbo.

## In the game

- `engine.worklet.ts` runs the model in the audio thread as the `micar-engine` processor.
- `Audio` in `world/audio.ts` takes a mode. In `model` mode it loads the processor, sends it the car's facts and feeds it the frame inputs. Until the processor is running, and for cars with no facts, the old oscillators play.
- `VanillaThreeScene.tsx` sends new facts whenever the driven car changes.
- Every `Audio` on the page (the game's and the Garage menu's) shares one AudioContext, which closes with its last user. A health watch rebuilds it on a tap when a phone has left it dead: see "The health watch" below.
- The processor checks every block it renders. A sample that is not a number stays in the model's filters for good, and in the page's one shared output it can silence every sound on the page (WebKit passes it on to the speakers unchanged; Chromium and Firefox turn it into silence). A throw out of `process()` ends the processor for good. Either way that block goes out silent and the model is built afresh from the same facts, at most once a second, because a new model allocates on the audio thread. The processor tells the page each time. Facts the model cannot be built from leave the engine silent rather than ending the processor.
- `?audiodebug` shows, bottom left: the context's state, clock, rate and health; whether the model is on; how often the page rebuilt the sound (`rebuilt`); `froze`, the longest time the output's clock stood still while the context said 'running': from the last look that saw it move to the last that saw it still. The clock never runs backwards, so one that reads the same across a pause in frames stood still through it; a change of state (a suspend, an interruption) ends a freeze, and starting up is not one. Then `engine`, the model's own level before its gain and that gain, with `resets`, the processor's fresh starts counted across rebuilds; and `out`, the level of everything on its way to the speakers and the master gain. A level reads `NaN` if any sample is not a number, `silent` if all are below -100 dB. The two analysers behind the levels are made only when `?audiodebug` asks for them.
- Only the player's car is voiced.

## Tests

- `firing.test.ts`: spacing per layout and crank, the firing order check.
- `engineSound.test.ts`: what the physics should give, measured from the rendered sound by engine order. Inline-four: second order leads. Cross-plane V8 on one bank's pipe: half orders stand within 10 dB of fourth order. Merged into equal pipes: they drop more than 20 dB. Unequal branches: they come back. Flat-plane: none. Flat-four with unequal runners: half orders rise more than 10 dB. Also load, cut, the two mufflers, intake, supercharger, turbo, pops, staying in range under random driving, silence when stopped, and speed.
- `carSound.test.ts`: reading the catalog string and the class defaults.
- `engineSound.test.ts` also checks that each input past its range sounds the same as the end of the range, and stays finite, on a turbo engine.
- `engine.worklet.test.ts`: the real processor, with the audio thread's globals stood in. A block with a sample that is not a number goes out silent and the engine comes back; the page is told; a fault that stays is silent throughout and rebuilt at most once a second; a model that throws, or cannot be built, leaves the processor alive.
- `world/audio.test.ts`: the switch, the frame inputs, the shared output, the health watch and the `?audiodebug` line.
- `e2e/sound.smoke.mjs`: renders one second through the built processor in Chromium and fails if it is silent or out of range: a V8, and a turbo V8 told a boost of -0.5 (all 48,000 samples were NaN before the fix). It runs in CI beside the Strip smoke test.

## Measured from the clips

Nobody has listened yet, so the ten clips were measured instead (2026-11-11). No clipping, no clicks, no dropouts, no offset. The order lines and pipe resonances show as expected on spectrograms. Levels, RMS:

| Part of the clip | Level |
|---|---|
| idle | -35 to -46 dB |
| full-throttle pull | -12 to -15 dB |
| lift-off | -46 to -58 dB (-23 dB for the car with overrun pops) |

The first measurement found the engine falling almost silent (-62 dB) with the pedal off, including at idle in the game. That is fixed and covered by three tests.

Still open from the measurements: idle sits 23 to 31 dB under full throttle. The old synth keeps idle about 7 dB under full throttle, so against the tyre and wind sounds the new idle may be faint and the new full throttle loud. This needs ears to settle.

## Low revs: why every car sounded alike off the line (2026-11-11)

The owner heard every car make the same hum at the start of an acceleration and only sound like itself higher up. Measured causes and what was done:

1. **The driving model pinned every car at 3,300 rpm** for the first 0.7 to 1.3 s of a full-throttle launch, then dropped the revs by 1,000 to 1,700 in one frame. This was the main cause. `world/physics.ts` now slips the clutch in first gear and reverse: the engine sits at the lowest speed where it makes 90% of its peak torque (`launchRpm`, 500 rpm more with a turbo) and the slip closes as the wheels catch up, so the revs only rise. Launch revs now run from about 1,950 rpm (truck) to 3,300 (sports). 0-100 km/h times moved by at most 0.1 s.
2. **The pipe bore was a guess from displacement alone.** It is now sized for the gas the engine moves at its redline (displacement x redline, 1.4 times for boost, shared between the pipes of a dual system, at 90 m/s).
3. **Every pulse had the same length.** It now grows with the cube root of cylinder volume, as the time to empty a cylinder through its valve does. Most road cylinders are near half a litre, so this effect is small.

Still alike after this: cars of the same body type with the same cylinder count. The driving model gives them one shape of torque curve, so they pull away at nearly the same revs, and the catalog has no exhaust data to tell them apart. That needs per-car data, which the physics core is planned to carry.

A car that is not in the catalog (`carSpecs.ts` has 48 models; no Subaru or Porsche among them) gets its body style's stand-in engine, for example "2.4L I4" for any sedan and "3.8L V6" for any sports car, and sounds like that engine. No flat engine is in the catalog today.

## Silence on an iPhone with turbo cars (2026-11-14)

The owner's iPhone lost every game sound with maxed (turbo) cars, after Garage upgrades or on entering a race. Desktop Chromium never did. PR #24's rebuild-on-tap did not help, because the context stayed 'running' with its clock moving.

The most likely cause, from WebKit's source and an emulation of it; **not yet confirmed on the phone**:

1. The game calls `setTargetAtTime(boost, currentTime, 0.01)` each frame, and `boost` is exactly 0 while the car is at rest.
2. WebKit works out a k-rate param's first value of a SetTarget as `target + (value - target) * exp(-(currentFrame * (1 / sampleRate) - startTime) / timeConstant)` (`AudioParamTimeline.cpp`, `processSetTarget`). `startTime` is the `currentTime` the page read, `currentFrame / sampleRate`. At 48 kHz the two times round differently on about one 128-frame block in five. The exponent is then a hair above 0, and from a value of exactly 0 the result is a hair below 0 (about -1e-17).
3. That happens on the first block of every spool-up from rest: a launch, the start of a race, driving off after the Garage. An emulation of WebKit's k-rate path with the real driving model gave a negative boost on about 15% of launches at 48 kHz (about 60% if the build fuses the multiply and subtract).
4. The model smoothed boost toward it. After about 0.7 s at rest the smoothed value is small enough to go below 0, and `Math.sqrt` of it made the turbo whistle's phase NaN for good. Only turbo engines have the whistle; a Garage turbo makes any engine one.
5. WebKit passes NaN from a worklet to the speakers unchanged (Chromium and Firefox turn it into silence), and a NaN in the page's one shared mix takes every other sound with it. The context stays 'running' and its clock moves, so the health watch sees nothing wrong.

What was done: the model takes a boost below 0 as 0 (and every other input past its range as that end); the processor sends silence for any block with a sample that is not a number and starts the model afresh; `?audiodebug` shows the engine's level, the level going to the speakers, the processor's fresh starts and the longest freeze of the clock. A test renders a turbo engine told a boost of -1.4e-17: it gave NaN before the change.

Still open:
- The owner to confirm on the iPhone that the silence is gone. If it is not, an `?audiodebug` screenshot taken while it is silent shows where the sound stops.
- A second WebKit-only way to lose every sound with the context 'running': if the page's audio thread stalls for about 2 s, WebKit's hand-over to its GPU process falls behind for good and plays nothing, even after the clock moves again (`RemoteAudioDestinationProxy`, `CARingBuffer`, a 2 s ring). Nothing in the game is known to stall it that long. `froze` in `?audiodebug` would show it. If it shows, the health watch should also rebuild on the next tap after such a freeze.
- An iPhone in silent mode mutes Web Audio while the context runs, because the page never sets `navigator.audioSession.type`.

## The health watch (PR #24; three faults fixed 2026-11-14)

An iPhone can leave the output 'interrupted', or 'running' with its clock stopped, and not give it back. `Audio` watches for that and, on the next tap, closes the output and builds the sound again on a new one, inside the tap. A tap is the only place a new output can start on an iPhone.

How it judges, as it stands:

- It looks at the output each frame in the car (from `engine()`) and at each tap (`resume()` looks first, then judges). Nothing else looks: not on foot, in the lobby, at the rental counter or in a hidden tab.
- Only what the looks saw counts. The output is 'stalled' when looks over at least a second saw its clock not move while 'running'; 'interrupted' or 'suspended' when looks over at least a second saw it in that state. The second runs from the last look that saw it fine to the last look, never to "now".
- `currentTime` never runs backwards. A clock that reads the same at a tap as at the last frame in the car, still 'running', stood still all the time between, however long nothing looked, so a tap on foot still catches a frozen output. One that has moved was fine.
- A change of state between two looks starts afresh, and so does a fresh output.
- Showing a hidden tab (`wake()`) resumes the output but never rebuilds it: that is no tap, so on an iPhone a new output made there would not start. The time hidden tells the watch nothing, so it starts afresh.
- A rebuild moves every `Audio` on the old output (the Garage menu's too) to the new one at once, each with its car, turbo and mute. Then the old one is closed.
- If the browser refuses to make a context (the constructor throws), the next tap tries again.

The three faults (found 2026-11-14 on branch `claude/engine-sound-nan-silence-83dgpw`):

1. **A stale reading rebuilt a working output.** The watch kept the time of the first look that saw the clock not move, and judged it against the time of the tap. The clock moves in steps, so the last frame in the car often sees it not move. One second later any tap called the output 'stalled' and rebuilt it: after getting out of the car, after a rental race ended, after a hidden tab came back (inside `visibilitychange`, where an iPhone would not start the new output), or after a task of a second or more on the page. Now only what the looks saw counts, and a tap looks for itself.
   That branch first used a gap rule for its own `froze` readout: a pause of over 500 ms between two looks ended the freeze under way. Its review then found that the rule cuts a real freeze short when the frames pause in the middle of it. The branch replaced it with the clock rule above, and the watch uses the clock rule too. A gap rule would also never catch a frozen output on foot, where every tap comes more than half a second after the last look.
2. **A rebuild left the Garage on a closed output.** The Garage menu's `Audio` shares the output. A rebuild closed it and made a new one for the game alone, so the Garage's sounds went into the closed one until its next tap. Now everything on the old output moves to the new one in the same tap.
   The other way, making the new output only once the old one's `close()` settles, was not taken. That would make it outside the tap, where an iPhone does not let it start.
3. **One refusal turned the sound off for good.** A throwing `new AudioContext()` set a flag that nothing cleared, not even `dispose()`. The flag is gone.

Checked in Chromium with the real AudioContext, whose suspend, resume and close all take effect later: a 2 s pause with nothing looking and a 2 s hidden tab leave the output alone. An output that a cause outside the page held 'suspended' for 1.2 s is rebuilt on the next tap, with the Garage's `Audio` on the new output. Before the fix, Chromium showed fault 2 (the Garage's sounds were built on the closed output). It did not show fault 1: its clock moves between every two frames, so only the stand-in in the tests shows it.

Still open, and **not confirmed on an iPhone**:
- PR #22 found that on the owner's iPhone closing one context interrupts the others. A rebuild makes the new output and closes the old one in the same tap, so the close may interrupt the new output. The next tap wakes it (a change of state starts the watch afresh). But if the looks see it interrupted for over a second before that tap, the tap rebuilds again, and the next close may interrupt that output too.
- A context made in a `pointerdown` may not start on an iPhone, which counts only `touchend` and `click`. The `touchend` of the same touch wakes it. A fresh output starts the watch afresh, so it is not rebuilt again.

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
