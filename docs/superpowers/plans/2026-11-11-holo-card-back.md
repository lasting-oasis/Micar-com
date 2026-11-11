# The holographic card back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the MiCar card-back artwork as a 3D card in the Garage whose foil answers the card's real angle, with the foil chosen by the engine's rarity tier.

**Architecture:** Blender builds the card's shape by script and exports a small `.glb` plus one still per foil. A new dependency-free package, `@micar/holo`, reads that `.glb` and draws it with one WebGL shader, a tilt spring and a draw-on-demand loop. The value app wraps it in a React component, opens it in a modal inspect view from each car's page, and shows all four foils on `#/garage/card-backs`.

**Tech Stack:** TypeScript (both of the repo's compilers), WebGL 1/2 with GLSL ES 1.00, React 19 and Vite 8 in `apps/value`, vitest, Playwright with system Chrome for the smoke, Blender 5.3 Python, Python 3 with Pillow.

**Spec:** `docs/superpowers/specs/2026-11-11-holo-card-back-design.md`

**Execution:** the owner asked for no long review: build every task in this session, one review of the whole branch at the end, then push.

## Global Constraints

- The artwork is never edited. The master is `assets/cards/micar-card-back.png`, SHA-256 `5bd441b57e7becbb812469ae4f61eebbea991c59ad955293dee80ce1852c3c95`, 1062 × 1481.
- `packages/engine` is not modified. Nothing under `apps/sim` is modified.
- No new runtime dependency anywhere. `@micar/holo` has none.
- `@micar/holo` source keeps the engine's rules: `import type` for types, no enums, no namespaces, no parameter properties, nothing newer than ES2020 (no `Array#at`, `Object.hasOwn`, `replaceAll`, `structuredClone`). It must pass `packages/holo/scripts/check.sh` (TypeScript 7 with value's flags, TypeScript 5.9 with the sim's).
- Garage styling: rules in `apps/value/src/garage/garage.css` under `.dp`, class names prefixed `gar-`, no Tailwind utilities, 44 px targets, no horizontal scroll at 375 px.
- Every visitor-facing string goes through `t()` with a Spanish entry in `apps/value/src/garage/es-card.ts` ("tarjeta", "usted", the site's own word "foil").
- No file under `.github/workflows` changes.
- Budgets: `card.glb` ≤ 100 KB, `back.webp` ≤ 900 KB, each `back-<foil>.webp` ≤ 150 KB.
- Foil by tier: common, uncommon → `gloss`; rare → `holo`; epic → `rainbow`; legendary, mythic, one-of-one → `prismatic`; anything else → `gloss`.
- Tilt 16° each way; spring `k = 170`, `c = 20`, step 1/120 s, frame time clamped to 1/30 s; settled within 0.02° and 0.05°/s; pixel ratio capped at 2; canvas 3:4; card 72% of canvas height; key light `normalize(-0.30, 0.45, 0.84)`.
- Commits end with the session's attribution lines.

## Review Focus

1. **The art drawn upside down or mirrored.** glTF puts v = 0 at the top of an image and WebGL uploads rows bottom-up by default; a reasonable person expects the card to match the artwork. Pinned in Task 5 (the face's top vertices have v near 0) and Task 8 (the smoke compares the gloss card at rest with the artwork and with the artwork flipped).
2. **A gesture the browser takes away.** On a phone a touch can end in `pointercancel`, or the finger can leave the canvas while down; the card must go back to flat and the frames must stop. Pinned in Task 3 (the loop stops after the target returns to zero) and Task 8 (the smoke sends `pointercancel` and counts frames).
3. **A canvas with no size yet, or a phone turned on its side.** The dialog may not be laid out when the card is created; nothing may divide by zero or draw NaN. Pinned in Task 3 (`viewport()` never returns a size under 1 and caps the pixel ratio) and Task 8 (the smoke resizes the window and the card still draws).
4. **Opening and closing quickly.** Destroying before the files arrive must not draw or throw, and twenty opens must not run the browser out of WebGL contexts. Pinned in Task 6 (`destroy()` before `ready`) and Task 8 (the smoke opens and closes twenty times, then checks a draw).
5. **A rarity the table does not know.** A new or misspelt tier must show gloss, never foil. Pinned in Task 2.

---

### Task 1: The artwork, master and web copy

**Files:**
- Create: `assets/cards/micar-card-back.png` (the upload, copied byte for byte)
- Create: `tools/cards/encode_art.py`
- Create: `apps/value/public/cards/back.webp` (written by the script)

**Interfaces:**
- Produces: `apps/value/public/cards/back.webp`, 1062 × 1481, quality 95. Later tasks load it as the face texture.

- [ ] **Step 1: Copy the master and check its hash**

Run: `sha256sum assets/cards/micar-card-back.png`
Expected: `5bd441b57e7becbb812469ae4f61eebbea991c59ad955293dee80ce1852c3c95`

- [ ] **Step 2: Write `tools/cards/encode_art.py`**

`python3 tools/cards/encode_art.py` reads the master, refuses to run if its SHA-256 is not the one above, writes the WebP (`quality=95, method=6`), decodes it again and prints `size`, `bytes` and `PSNR` (per-channel MSE over RGB against the master). Exit code 1 if the decoded size differs, the file is over 900 KB or the PSNR is under 38 dB.

- [ ] **Step 3: Run it**

Run: `python3 tools/cards/encode_art.py`
Expected: `1062x1481`, under 900 KB, PSNR printed and at least 38 dB, exit 0.

- [ ] **Step 4: Commit** (`Card back: the master artwork and its web copy`)

### Task 2: The package and the foil table

**Files:**
- Create: `packages/holo/package.json`, `packages/holo/tsconfig.json`, `packages/holo/scripts/check.sh`, `packages/holo/README.md`
- Create: `packages/holo/src/foils.json`, `packages/holo/src/foils.ts`, `packages/holo/src/index.ts`
- Test: `packages/holo/src/foils.test.ts`, `apps/value/src/garage/holo.test.ts`
- Modify: `apps/value/package.json` (add `"@micar/holo": "workspace:*"`), `apps/value/vite.config.ts` (test `include` gains `'../../packages/holo/src/**/*.test.ts'`), `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Produces, from `@micar/holo`:

```ts
export const FOIL_IDS = ['gloss', 'holo', 'rainbow', 'prismatic'] as const;
export type FoilId = (typeof FOIL_IDS)[number];
export type FoilParams = {
  kind: number;                                   // 0 gloss, 1 holo, 2 rainbow, 3 prismatic
  K: number; S: number; K2: number; S2: number; sat: number; m0: number; m1: number; cover: number;
  strength: number; add: number; mul: number; metal: number; sparkle: number;
  cell: number; refr: number; amp: number; lobe: number; edge: number;
};
export const FOILS: Record<FoilId, FoilParams>;    // read from foils.json, every key present for every foil
export const FOIL_LABELS: Record<FoilId, string>;  // Gloss, Standard holo, Full-spectrum rainbow, Refractive prismatic
export function foilForRarity(tier: string): FoilId;
```

- `foils.json` holds the spec's first-pass table (zeros where a foil does not use a number). `check.sh` is the engine's script with `--lib es2020,dom --resolveJsonModule` added and the package path changed.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/holo/src/foils.test.ts
it('maps the tiers the brief names', () => {
  expect(foilForRarity('rare')).toBe('holo');
  expect(foilForRarity('epic')).toBe('rainbow');
  for (const t of ['legendary', 'mythic', 'one-of-one']) expect(foilForRarity(t)).toBe('prismatic');
  for (const t of ['common', 'uncommon']) expect(foilForRarity(t)).toBe('gloss');
});
it('shows gloss, never foil, for a tier it does not know', () => {
  for (const t of ['', 'Rare', 'ultra', 'one of one', 'prismatic']) expect(foilForRarity(t)).toBe('gloss');
});
it('gives every foil every number, all finite', () => { /* each FOILS[id] has exactly the FoilParams keys */ });
it('keeps gloss free of foil', () => { expect(FOILS.gloss.strength).toBe(0); expect(FOILS.gloss.sparkle).toBe(0); });
// apps/value/src/garage/holo.test.ts
it('gives every rarity the engine knows a foil', () => {
  for (const tier of RARITY_TIERS) expect(FOIL_IDS).toContain(foilForRarity(tier));
});
```

- [ ] **Step 2: Run them and see them fail** — `pnpm --filter @micar/value test -- foils holo` → cannot resolve `@micar/holo`.
- [ ] **Step 3: Write the package files, `foils.json`, `foils.ts`, `index.ts`; add the dependency and the `include`; `pnpm install`**
- [ ] **Step 4: Run** `pnpm --filter @micar/value test -- foils holo` → pass; `bash packages/holo/scripts/check.sh` → `ok`.
- [ ] **Step 5: Commit** (`@micar/holo: the package and the foil table`)

### Task 3: Spring, tilt, matrices, viewport and the draw-on-demand loop

**Files:**
- Create: `packages/holo/src/spring.ts`, `tilt.ts`, `mat.ts`, `loop.ts`
- Test: `packages/holo/src/spring.test.ts`, `tilt.test.ts`, `mat.test.ts`, `loop.test.ts`

**Interfaces:**
- Produces:

```ts
// spring.ts — angles in radians; x is pitch, y is yaw
export type Angles = { x: number; y: number };
export type Spring = { x: number; y: number; vx: number; vy: number };
export const SPRING: { k: 170; c: 20; step: number; maxFrame: number; restAngle: number; restSpeed: number };
export function step(s: Spring, target: Angles, dt: number): Spring;      // pure; substeps of SPRING.step; dt clamped to maxFrame
export function settled(s: Spring, target: Angles): boolean;
// tilt.ts
export const MAX_TILT: number;                                              // 16 degrees in radians
export type Rect = { left: number; top: number; width: number; height: number };
export function tiltTarget(clientX: number, clientY: number, rect: Rect): Angles;   // pitch = -y * MAX, yaw = +x * MAX, y up, both clamped to ±1
export function viewport(cssWidth: number, cssHeight: number, devicePixelRatio: number, maxPixelRatio: number): { width: number; height: number; ratio: number };
// mat.ts — column-major, as WebGL takes them
export type Mat4 = Float32Array;
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4;
export function translation(x: number, y: number, z: number): Mat4;
export function rotationYX(yaw: number, pitch: number): Mat4;               // Ry(yaw) · Rx(pitch)
export function multiply(a: Mat4, b: Mat4): Mat4;
export function transformPoint(m: Mat4, p: readonly [number, number, number]): [number, number, number];   // with the divide by w
// loop.ts
export type Loop = { wake(): void; stop(): void; readonly running: boolean };
export function createLoop(o: { requestFrame: (cb: (ms: number) => void) => number; cancelFrame: (id: number) => void; frame: (dt: number) => boolean }): Loop;
```

- `frame(dt)` returns true while more frames are needed. `wake()` requests a frame only if none is pending. The first frame after a wake gets `dt = 1/60`.

- [ ] **Step 1: Write the failing tests** — the assertions that carry the spec's numbers:

```ts
// spring
it('reaches the target and reports settled', () => { /* from rest toward {x: 0.2, y: -0.2}, 3 s of 1/60 frames: settled, |x - 0.2| < SPRING.restAngle */ });
it('overshoots a little and never rings', () => { /* max x between 0.2 and 0.2 * 1.06; after the first return below target it stays within 1% */ });
it('comes back to flat when the target returns to zero', () => {});
it('stays finite on a long frame', () => { /* one step with dt = 5: finite, and equal to a step with dt = SPRING.maxFrame */ });
// tilt
it('is flat at the centre and 16 degrees at the edges', () => {
  const r = { left: 100, top: 50, width: 300, height: 400 };
  expect(tiltTarget(250, 250, r)).toEqual({ x: 0, y: 0 });
  expect(tiltTarget(400, 250, r).y).toBeCloseTo(MAX_TILT);       // right edge: yaw positive, that side moves away
  expect(tiltTarget(250, 50, r).x).toBeCloseTo(-MAX_TILT);       // top edge: pitch negative, the top moves away
  expect(tiltTarget(9999, -9999, r)).toEqual({ x: -MAX_TILT, y: MAX_TILT });
});
it('is flat for a rect with no size', () => { expect(tiltTarget(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 }); });
it('caps the pixel ratio and never returns less than one pixel', () => {
  expect(viewport(300, 400, 3, 2)).toEqual({ width: 600, height: 800, ratio: 2 });
  expect(viewport(0, 0, 2, 2)).toEqual({ width: 1, height: 1, ratio: 2 });
  expect(viewport(300, 400, NaN, 2).ratio).toBe(1);
});
// mat
it('moves the right edge away for a positive yaw and the top away for a negative pitch', () => {
  expect(transformPoint(rotationYX(0.2, 0), [1, 0, 0])[2]).toBeLessThan(0);
  expect(transformPoint(rotationYX(0, -0.2), [0, 1, 0])[2]).toBeLessThan(0);
});
it('projects a point on the axis to the centre', () => {});
// loop
it('asks for no frame until woken, and none after the frame says it is done', () => {});
it('does not stack requests when woken twice', () => {});
it('stops when told to, and cancels the pending frame', () => {});
it('runs again after a later wake', () => {});
```

- [ ] **Step 2: Run** `pnpm --filter @micar/value test -- spring tilt mat loop` → fail (modules missing).
- [ ] **Step 3: Implement the four modules**
- [ ] **Step 4: Run the same command** → pass; `bash packages/holo/scripts/check.sh` → `ok`.
- [ ] **Step 5: Commit** (`@micar/holo: spring, tilt, matrices and the draw-on-demand loop`)

### Task 4: The card in Blender

**Files:**
- Create: `tools/blender/build_card.py`, `tools/blender/export_card.py`
- Create (written by the export): `apps/value/public/cards/card.glb`, `apps/value/public/cards/back-gloss.webp`, `back-holo.webp`, `back-rainbow.webp`, `back-prismatic.webp`

**Interfaces:**
- Consumes: `assets/cards/micar-card-back.png`, `packages/holo/src/foils.json`.
- Produces: `card.glb` holding one mesh whose three primitives use materials named `MiCar Card Face`, `MiCar Card Rim`, `MiCar Card Back`; Y up, the face toward +Z, metres (0.063 wide); positions, normals, UVs, indices; no images, animation or Draco.

- `build_card.py`: `REPO = os.environ.get('MICAR_REPO', r'C:\Users\Owner\Micar-com')`; `measure_corner_radius(image)` (from the four corners of the master, as a fraction of the width); `build_card()` (the export object `MiCar Card` in the collection `MiCar Card`, cleared first); `build_preview()` (the four foil materials from `foils.json`, the four-up row, the studio, the camera, the 96-frame tilt); `report()`.
- `export_card.py`: `export_all()` writes the `.glb` (selection only, modifiers applied) and the four stills (720 × 960, film transparent, one card at pitch −6°, yaw 10°), and raises `RuntimeError` on a file over budget or a `.glb` without the three material names.

- [ ] **Step 1: Write both scripts**
- [ ] **Step 2: Run them in the owner's Blender through the MCP connection** (`build_card()`, `build_preview()`, `report()`, then `export_all()`), with the repo files they read copied to the connected folder.
Expected: `report()` gives 63.0 × 87.86 × 1.0 mm and the measured corner radius between 5% and 7% of the width; `export_all()` returns five paths with sizes inside the budgets.
- [ ] **Step 3: Bring the five files into the repo and look at each still**
- [ ] **Step 4: Commit** (`Card back: the Blender build, the model and the four stills`)

### Task 5: Reading the model

**Files:**
- Create: `packages/holo/src/glb.ts`
- Test: `packages/holo/src/glb.test.ts`

**Interfaces:**
- Produces:

```ts
export type CardPart = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array | Uint32Array };
export type CardMesh = { face: CardPart; rim: CardPart; back: CardPart; min: [number, number, number]; max: [number, number, number] };
export function readCardGlb(buffer: ArrayBuffer): CardMesh;      // throws an Error that says what is wrong
```

- A part is recognised by its material's name containing `face`, `rim` or `back`, whatever the case.

- [ ] **Step 1: Write the failing tests**

```ts
const file = readFileSync(new URL('../../../apps/value/public/cards/card.glb', import.meta.url));
it('reads the three parts of the committed model', () => { /* each part: positions.length % 3 === 0, normals same length, uvs = 2/3 of it, indices.length % 3 === 0 and every index < vertex count */ });
it('is a card: 63 by 87.86 by 1 mm, face toward +Z', () => { /* max-min within 0.5% of [0.063, 0.08786, 0.001]; every face normal has z > 0.99 */ });
it('maps the artwork the right way up', () => { /* the face vertex with the greatest y has v < 0.1 and the one with the least y has v > 0.9; least x has u < 0.1 */ });
it('has unit normals', () => {});
it('refuses what it cannot read, and says why', () => {
  expect(() => readCardGlb(new ArrayBuffer(4))).toThrow(/too short/);
  /* bad magic -> /not a glb/; version 1 -> /version/; a JSON chunk naming KHR_draco_mesh_compression -> /Draco/; a model with no "rim" material -> /rim/; an accessor that runs past the buffer -> /out of range/ */
});
```

- [ ] **Step 2: Run** `pnpm --filter @micar/value test -- glb` → fail.
- [ ] **Step 3: Implement `readCardGlb`** (header, JSON chunk, BIN chunk, accessors through bufferViews with their byte offsets and strides; component types 5123, 5125 and 5126 only).
- [ ] **Step 4: Run it again** → pass; `check.sh` → `ok`.
- [ ] **Step 5: Commit** (`@micar/holo: read the card model`)

### Task 6: The shader and the renderer

**Files:**
- Create: `packages/holo/src/shaders.ts`, `packages/holo/src/card.ts`
- Modify: `packages/holo/src/index.ts`
- Create: `packages/holo/demo/index.html`, `packages/holo/demo/demo.ts` (a bare page: the canvas and four foil buttons; also the page published for the owner's phone)
- Test: `packages/holo/src/card.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- Produces:

```ts
export type HoloCardOptions = {
  canvas: HTMLCanvasElement; meshUrl: string; artUrl: string; foil: FoilId;
  touch?: 'capture' | 'scroll'; reducedMotion?: boolean; maxPixelRatio?: number; onError?: (error: Error) => void;
};
export type HoloCard = { ready: Promise<void>; setFoil(foil: FoilId): void; resize(): void; destroy(): void };
export function webglAvailable(): boolean;
export function createHoloCard(options: HoloCardOptions): HoloCard;
```

- One program with a `uPart` uniform (0 face, 1 rim, 2 back) and a second small program for the shadow quad. The face follows the spec's recipe with `FOILS[foil]` as uniforms. `ready` resolves after the first frame is drawn and rejects (after calling `onError`) when the context, a shader or a file fails. `destroy()` is safe at any time, twice, and before `ready`.
- `touch: 'capture'` sets `touch-action: none` on the canvas and captures the pointer on `pointerdown`; `'scroll'` sets `pan-y`.

- [ ] **Step 1: Write the failing test** (no GL in vitest, so it pins only what needs none)

```ts
it('says WebGL is unavailable where there is no document', () => { expect(webglAvailable()).toBe(false); });
it('reports a failure through onError and rejects ready when the canvas gives no context', async () => {
  const canvas = { getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) } as unknown as HTMLCanvasElement;
  const seen: Error[] = [];
  const card = createHoloCard({ canvas, meshUrl: 'x', artUrl: 'y', foil: 'holo', onError: (e) => seen.push(e) });
  await expect(card.ready).rejects.toThrow(/WebGL/);
  expect(seen).toHaveLength(1);
  card.destroy(); card.destroy();
});
```

- [ ] **Step 2: Run** `pnpm --filter @micar/value test -- card` → fail.
- [ ] **Step 3: Write `shaders.ts` and `card.ts`**
- [ ] **Step 4: Run the test** → pass; `check.sh` → `ok`.
- [ ] **Step 5: Look at it.** Serve `packages/holo/demo` with Vite, open it in Chrome with software GL through Playwright, and save a screenshot of each foil at rest and at two tilts. Compare with the Blender stills; tune `foils.json` until the four read as four materials. Keep the screenshots for the pull request.
- [ ] **Step 6: Commit** (`@micar/holo: the foil shader and the card renderer`)

### Task 7: The Garage

**Files:**
- Create: `apps/value/src/garage/cardBack.ts` (no JSX: `CARD_BACKS`, `tiersOf`, the asset URLs), `HoloCard.tsx`, `CardBack.tsx`, `CardBacks.tsx`
- Modify: `apps/value/src/garage/Garage.tsx` (the button on `CarPage`; the `card-backs` word in `Garage`), `garage.css`, `es-card.ts`, `es.test.ts`
- Test: `apps/value/src/garage/holo.test.ts` (extended)

**Interfaces:**
- Consumes: `createHoloCard`, `webglAvailable`, `foilForRarity`, `FOIL_IDS`, `FOIL_LABELS` from `@micar/holo`; `RARITY_LABELS`, `RARITY_TIERS` from `@micar/engine`.
- Produces:

```tsx
export function HoloCard(props: { foil: FoilId; label: string; touch?: 'capture' | 'scroll' }): JSX.Element;      // the canvas, or the still
export function CardBack(props: { foil: FoilId; rarity: string; title: string; onClose: () => void }): JSX.Element; // the modal dialog; rarity is already translated
export const CARD_BACKS = 'card-backs';                                                                             // the route word
export function tiersOf(foil: FoilId): RarityTier[];                                                                // the engine's tiers that carry this foil
export default function CardBacks(): JSX.Element;                                                                   // the four-backs page
```

- Strings (English keys, each with a Spanish entry): `Card back`, `Drag to tilt the card`, `The back of the card: {rarity}, {foil}`, `Card backs`, `Every card carries the same back. Its foil follows the card's rarity: earned, never sold.`, `Show the {foil} back`, and the four `FOIL_LABELS`. `Close` already exists.
- Asset URLs: `${import.meta.env.BASE_URL}cards/card.glb`, `cards/back.webp`, `cards/back-<foil>.webp`.

- [ ] **Step 1: Write the failing tests**

```ts
it('gives each foil at least one tier and every tier exactly one foil', () => {
  expect(tiersOf('gloss')).toEqual(['common', 'uncommon']);
  expect(tiersOf('holo')).toEqual(['rare']);
  expect(tiersOf('rainbow')).toEqual(['epic']);
  expect(tiersOf('prismatic')).toEqual(['legendary', 'mythic', 'one-of-one']);
});
it('keeps the route word clear of a MiCar ID', () => { expect(normalizeMicarId(CARD_BACKS)).toBeNull(); });
```

and add `FOIL_LABELS` to `TABLES` in `es.test.ts`, which then fails until the Spanish is in.

- [ ] **Step 2: Run** `pnpm --filter @micar/value test` → the new ones fail, the i18n scan names the missing phrases.
- [ ] **Step 3: Write the three components, the Garage changes, the CSS and the Spanish**
- [ ] **Step 4: Run** `pnpm --filter @micar/value test` → all pass; `pnpm --filter @micar/value build` → builds; `pnpm --filter @micar/value lint` → no new findings.
- [ ] **Step 5: Commit** (`Garage: the card back, its inspect view and the four-backs page`)

### Task 8: The smoke, the budgets and the docs

**Files:**
- Create: `apps/value/e2e/card-back.smoke.mjs`
- Modify: `apps/value/package.json` (devDependency `playwright` at the sim's version, script `smoke:card`), `pnpm-lock.yaml`
- Modify: `apps/value/src/garage/holo.test.ts` (the budgets), `README.md` (the repo map and the reading list), `packages/holo/README.md`

**Interfaces:**
- Consumes: the built value app.
- Produces: `pnpm --filter @micar/value smoke:card`, exit 0 on success, screenshots in `apps/value/e2e/out/` (ignored by git).

- [ ] **Step 1: Write the budgets test** (`card.glb` ≤ 100 000 bytes, `back.webp` ≤ 900 000, each still ≤ 150 000, all present) and run it → pass.
- [ ] **Step 2: Write the smoke.** Chrome through Playwright (`channel: 'chrome'`, software GL flags), an init script that counts `requestAnimationFrame` calls. On `#/garage/card-backs`, for each foil: open it; the canvas is not blank; the gloss card at rest correlates better with the artwork than with the artwork flipped top to bottom; a pointer at the right edge changes the pixels; a foil other than gloss differs from gloss at the same tilt; after `pointercancel` and 1.5 s the frame count stops rising; resizing the window still draws; Close removes the canvas. Then open and close twenty times and check one more draw. Then lose the context through `WEBGL_lose_context` and check the still is showing within three seconds. Then with `prefers-reduced-motion` the card draws once and a pointer move changes nothing.
- [ ] **Step 3: Run it** — `pnpm --filter @micar/value build && pnpm --filter @micar/value smoke:card` → every check prints `ok`, exit 0.
- [ ] **Step 4: Run everything** — `pnpm --filter @micar/value test`, `pnpm --filter @micar/sim test`, `bash packages/holo/scripts/check.sh`, `bash packages/engine/scripts/check.sh`, `pnpm -r --if-present build` → all pass.
- [ ] **Step 5: Update the READMEs and commit** (`Card back: the browser smoke, the budgets and the docs`)

### Task 9: One review, the phone demo and the pull request

- [ ] **Step 1: One review of the whole branch against the spec**, by a reviewer that has not seen the work; fix what it finds and re-run Task 8 Step 4.
- [ ] **Step 2: Publish the demo page privately** (`packages/holo/demo` built to static files) and give the owner the link to try on an iPhone.
- [ ] **Step 3: Push the branch and open the pull request** with the screenshots, what was verified and what was not (nothing measured on a phone).
