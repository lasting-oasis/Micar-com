# @micar/holo

The back of a MiCar card, drawn as a physical card: the owner's artwork on a 3D card that tilts under a finger or the mouse, with a foil whose colour answers the card's real angle. Pure TypeScript and WebGL, no dependencies and no React. Apps import it as source, the way they import `@micar/engine`.

Three rules hold everywhere in here:

- **The artwork is never edited.** `assets/cards/micar-card-back.png` is the owner's file, byte for byte; a test pins its SHA-256. The foil is light added on top of it by a shader. With the card flat and no foil, the face is the artwork itself.
- **Nothing is driven by a clock.** Every colour comes from the half vector between the eye and one fixed key light, taken into the card's own frame. A card that is not moving does not change, and the page stops asking for frames.
- **Which foil a card wears is not decided here.** `foilForRarity(tier)` maps the engine's rarity tier to a foil; the engine works the tier out.

```ts
import { createHoloCard, foilForRarity, webglAvailable } from '@micar/holo';

if (webglAvailable()) {
  const card = createHoloCard({
    canvas,                                   // a canvas of its own for this card, 3:4 or taller
    meshUrl: '/cards/card.glb',               // or a data: address, read with no request
    artUrls: ['/cards/back.avif', '/cards/back.webp'],   // the first the browser can decode is used
    foil: foilForRarity('epic'),              // 'rainbow'
    touch: 'capture',                         // or 'scroll' (the default) inside a page that scrolls
    onError: () => showTheStill(),            // called once if the card cannot be drawn
  });
  card.setFoil('prismatic');
  card.destroy();                             // hands the WebGL context back; use a new canvas for a new card
}
```

| Rarity (the engine's tier) | Foil | What it is |
| --- | --- | --- |
| common, uncommon | `gloss` | The artwork under a clear coat |
| rare | `holo` | One set of spectral bands on the bright, metallic parts of the art |
| epic | `rainbow` | Two crossing sets of bands over the whole face |
| legendary, mythic, one-of-one | `prismatic` | A lattice of triangular facets, each flashing its own colour, the art seen through them slightly displaced |
| anything else | `gloss` | A tier this table has never heard of shows no foil |

## Files

| File | What it does | Tested by |
| --- | --- | --- |
| `src/foils.json`, `foils.ts` | The recipe: one row of numbers per foil. The shader reads it as uniforms and `tools/blender/build_card.py` reads the same file for its preview materials | `foils.test.ts` |
| `src/glb.ts` | Reads the one kind of `.glb` the Blender export writes; refuses anything else with a reason | `glb.test.ts`, against the committed model and made-up files |
| `src/spring.ts`, `tilt.ts`, `mat.ts`, `loop.ts` | The tilt spring, pointer to angles, the few matrices, the draw-on-demand loop | their own tests |
| `src/scene.ts` | The numbers sent to the GPU: the camera for a canvas shape, the pose, the shadow, a foil as shader vectors | `scene.test.ts` |
| `src/shaders.ts` | The GLSL, ES 1.00 so one source runs on WebGL 1 and 2 | `shaders.test.ts` for the names it shares with the renderer; the browser smoke for the rest |
| `src/card.ts` | `createHoloCard`: the context, the pointer, resize, context loss, `destroy()` | `card.test.ts`, against a stand-in canvas, context, frame clock, `fetch` and `Image` |
| `src/assets.test.ts` | The shipped files exist, are the sizes they claim and are inside their budgets; the master artwork has not changed | |
| `demo/` | A bare page: the four foils and a count of the frames the page asks for. It builds to one self-contained HTML file (`pnpm --filter @micar/holo demo:build`): the model, the artwork and the stills are inside it | by eye |

`pnpm --filter @micar/value test` runs all of these with the value app's own tests, so they gate every deploy. `bash packages/holo/scripts/check.sh` type-checks the package with both apps' compilers.

## How it behaves

- **Framing.** The model is scaled to one unit tall. A 24° camera sits where the card fills 72% of the canvas's height, or 84% of its width where the canvas is too narrow for that (a phone held upright). The canvas is transparent; a soft shadow is drawn in it behind the card.
- **Tilt.** Up to 16° each way; the side under the pointer moves away. A mouse tilts on hover, a finger or pen while it is down. Leaving, lifting, a gesture the browser cancels or the window losing focus sends the card back to flat on a spring (k 170, c 20).
- **Drawing.** One frame when ready, frames while the spring is moving, one last frame at rest, then none. A hidden tab stops the loop. Pixel ratio is the device's, capped at 2.
- **Touch.** `'capture'` sets `touch-action: none` and captures the pointer: for a view where nothing scrolls behind the card. `'scroll'` sets `pan-y`, so a vertical swipe scrolls the page and the card returns to flat when the browser takes the gesture.
- **Reduced motion.** With `reducedMotion: true` the card is drawn once, flat, and never tilts.
- **Going wrong.** No WebGL, a shader that will not compile, a file that will not load, a model that is not the card, a context lost for more than two seconds: `onError` is called once and `ready` rejects. The host shows a still (`back-<foil>.webp`) instead. `destroy()` before `ready` rejects `ready` without calling `onError`.

## The files the card needs

They live in `apps/value/public/cards/` and are made by two scripts; neither runs in CI.

| File | Made by | Budget |
| --- | --- | --- |
| `card.glb` (31.6 KB): the card, 63 × 87.86 × 1 mm, corners measured from the artwork, a bevelled edge; three parts named by material | `tools/blender/build_card.py` then `export_card.py`, inside Blender 5.x | 100 KB |
| `back-gloss.webp`, `back-holo.webp`, `back-rainbow.webp`, `back-prismatic.webp`: one still per foil, 720 × 960, rendered by Blender | the same export | 150 KB each |
| `back.avif` (747 KB, 4:4:4, PSNR 39.3 dB against the master) and `back.webp` (767 KB, for browsers without AVIF) | `python3 tools/cards/encode_art.py` | 900 KB each |

To change the look, edit `src/foils.json`, look at `pnpm --filter @micar/holo demo`, then run the two Blender scripts again so the stills follow. The Blender preview and the browser are close, not identical: Blender ray-traces a studio and the shader evaluates a small one.

## What has and has not been checked

- Unit tests, in vitest, with no browser: everything in the table above.
- A browser smoke test, `pnpm --filter @micar/value build && pnpm --filter @micar/value smoke:card`: Chrome with software GL opens the Garage's four-backs page and checks that each foil draws, that the gloss card at rest is the artwork (the right way up, its mean colour within 3% of the master's), that tilting changes the picture, that the page asks for no frames at rest, that closing hands the context back twenty times over, and that the still takes over when the context is lost. It is run by hand; it is not in `ci.yml`.
- **Not measured: speed on a phone, and iOS Safari.** Software GL says nothing about either. The demo page is the thing to open on a real iPhone.
