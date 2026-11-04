# Nexus Valuation explainer (Remotion)

A ~2-minute film that explains the site: the calculator, the ledger, the three prices, the local market and forecast, the dealer window sheet, the QR car page, EN/ESP, and where the numbers come from. Rendered at 1920x1080, 30 fps, with voiceover, sound cues and a music bed.

## How it is made

- `narration.json` — the script, one entry per scene.
- `/home/claude/tts/say.py` — synthesizes each scene's voiceover with Kokoro (open-weights TTS, Apache-2.0) through sherpa-onnx, voice `af_heart`; trims silence, normalizes to -16 LUFS, writes `public/audio/vo-*.wav` and `durations.json`. Words the model's lexicon lacks get entries in `/home/claude/tts/custom-lexicon.txt`.
- `/home/claude/tts/asr-check.py` — transcribes the clips with Whisper and diffs them against the script, to catch dropped or garbled words.
- `sfx.py` — synthesizes every sound cue (paint, whoosh, tick, pop, rise, chime, scan, flip, print) and the music bed from scratch, so nothing needs a license.
- `public/shots/` — screenshots of the real site, captured with the local build served under the real address so the QR codes in the film are real and scannable.
- `src/data.json` — the engine's actual numbers for the 2019 Civic EX used throughout (steps, prices, range, forecast).
- `src/timing.ts` — each scene's length is its voiceover plus a little air.
- `src/scenes.tsx`, `src/kit.tsx` — the ten scenes and the shared look (the site's palette and fonts).

## Render

```
node stills.mjs intro=120 ledger=1440   # look at frames first
node render.mjs                          # out/explainer.mp4
```
Remotion uses the Chromium that Playwright installed (`remotion.config.ts`). Scene edits only need a re-render; a new line of narration needs `say.py` first so the timing follows the voice.
