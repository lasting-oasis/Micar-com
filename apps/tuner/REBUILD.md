# REBUILD.md — Micar Tuner (REA rebuild of a 3DTuning vehicle page)

Target: `https://www.3dtuning.com/en-US/tuning/jeep/wrangler.unlimited.jk.rubicon.recon/4.door.suv.2017`
Recon evidence lives in `recon/` (read `recon/SPEC.md` first).

## Decision: same mechanism, original vehicle
The original's value is thousands of proprietary renders of a trademarked vehicle. Those cannot be reused, so this
rebuild reproduces the **mechanism** — the sprite-turntable engine, its data model, and the HUD — and feeds it with an
**original procedural 4-door off-road SUV** rendered by our own offline pipeline into the same kind of per-part,
per-frame layers. Brand names, logos, the garage photo and the icon font are replaced with original work.
Swapping the vehicle later = editing `tools/vehicle.js` (or loading a model you own) and re-running the pipeline.

## Feature inventory
| P | Feature | Status |
|---|---------|--------|
| P0 | Turntable: 48 frames, drag to rotate, auto-rotate, arrow keys | ✅ |
| P0 | Per-part layer compositing with per-frame z-order; suspension = pixel shift of the body group | ✅ |
| P0 | Paint: zones (Exterior / Interior / Wheels), selected-part override, 17 factory colours, custom picker, brightness/saturation/hue manipulate | ✅ |
| P0 | Finishes (7): glossy, matte, satin, metallic, pearl, candy, chrome — diffuse×colour + specular layer gains | ✅ |
| P0 | Parts panel: category carousel → variant cards with icons & "starting at" prices; picking a category rotates to the best angle | ✅ (20 categories, 2–4 variants each) |
| P0 | Dependent parts (door glass only with full doors, top glass only with hard top, spare tire follows tyre choice) | ✅ via `requires` |
| P0 | Settings: Window Tint, Suspension, Zoom sliders; Wheel Neon, Car Neon, Lights On, Rock Lights, Auto Rotate | ✅ |
| P0 | Right dock: Parts Used (modal with total), Filters, Before/After, Sounds, ENGINE START/STOP, Fast Mode, Transform, Save | ✅ |
| P1 | Trims & Kits (build packs) | ✅ 4 packs |
| P1 | Save to "My Builds" (localStorage + thumbnail), share link (state in URL hash), snapshot PNG download | ✅ |
| P1 | Photo filters (CSS filters on stage + backdrop) | ✅ |
| P1 | Engine sound (synthesised with WebAudio — no copied audio), UI clicks | ✅ |
| P1 | Loading screen + coarse-first frame caching (0,4,8… then 2s, then all) like the original | ✅ |
| P2 | Second (elevated) camera, templates/backgrounds chooser | ❌ not built (single camera, single backdrop) |
| P2 | Accounts, Top Ranked community gallery, challenges, chat/socket | ❌ replaced by local "My Builds" |
| P2 | Mobile app redirect, ads, i18n | ❌ intentionally omitted (narrow viewports scale the stage instead) |
| P2 | Decals/vinyls, aerography, more categories (44 in the original) | ❌ vehicle has 20 categories |

## Screens & components → files
- Stage (`.stage-wrap/.stage/#car`), docks, bottom panel modes (`finishes`, `parts`, `variants`, `settings`, `filters`),
  modals, popovers: `index.html`, `src/styles.css` (HUD measured from recon/structure.json), `src/app.js`.
- Compositor: `src/engine.js` — `Engine.render()` is the whole rendering model (see below).
- Catalog presentation (categories, packs, colours, finishes, filters): `src/catalog.js`; part names/variants/prices
  come from `assets/sprites/manifest.json` (written by the pipeline from `tools/vehicle.js`).

## Data model (mirrors the original's car record)
```
manifest.json
  stage {w:1440,h:900}, frameCount 48, startFrame 0, format webp
  partsMeta[id] { category, configKey, variant, name, group: core|peripheral|wheels|ground, layers[], paintable, zone,
                  hidden, price, requires{configKey: variant}, softGlow, glowColor, zBias }
  parts[id].frames[f][layer] = [x, y, w, h]           # file: assets/sprites/<id>/<layer>/f<ff>_<x>_<y>.webp
  frames[f] { order[], depth{id: cameraZ}, coreDepth, hubs{fl,fr,rl,rr:[x,y]} }
  defaultConfig { configKey: variant }
state (engine.state)
  frame, config{configKey: variant}, paint{exterior|interior|wheels: {color, finish}}, partPaint{configKey: {...}},
  tint 0..1, suspension px, zoom, lights, underglow{on,color}, wheelNeon{on,color}, rockLights, before
```
Layer kinds: `diffuse` (white-albedo lit render → multiplied by paint colour), `spec` (black-albedo clearcoat render →
added with the finish's gain), `lit` (non-paint materials), `glass` + `glassMask` (tint = black mask at alpha),
`glow` (emissive, tinted + blurred, added when lights/neon are on).

### Compositing order per frame (engine.orderFor)
ground (shadow, underglow) → wheels farther than the body centre → **core parts** (body, chassis, interior, dash,
windshield, sport bar, taillights — rendered mutually occluded so any order is exact) → peripheral parts and near
wheels sorted by camera depth (+ `zBias`, e.g. fender flares). Peripheral parts are rendered occluded only by the core,
which keeps every variant combination consistent (the original solves this with hand-authored `layersPositions`).

## External services → local replacements
| Original | Here |
|---|---|
| cdnN.3dtuning.com part sprites (PNG) | `assets/sprites/**.webp` generated by `tools/render-sprites.mjs` (three.js in headless Chromium) |
| getCarByName / componentsInfo / templates APIs | `assets/sprites/manifest.json` + `src/catalog.js` (static) |
| data.3dtuning.com background photo | `assets/bg/garage.jpg` rendered by the same pipeline/camera |
| accounts, Top Ranked, challenges, socket.io | localStorage "My Builds", share links in the URL hash |
| start/gas/down.mp3 | WebAudio synthesis in `src/app.js` |
| Google Fonts PT Sans / Montserrat | same open fonts via Google Fonts (`<link>`), system fallback offline |
| ads | none |

## Stack
Vanilla ES modules + CSS, zero runtime dependencies; `node server.js` serves it. Pipeline (dev only): `three`,
`playwright` (Chromium, SwiftShader works headless).

## Sprite pipeline (`tools/`)
`vehicle.js` builds the SUV from primitives and registers parts (category/variant/group/layers/occlusion policy);
`render-page.html` renders each part layer with a fixed camera (fov 24°, 11° elevation, car on a turntable) using a
two-pass trick: occluders are drawn depth-only first, then the part, so each layer holds exactly its visible pixels;
bounding boxes are projected, tightened by alpha, cropped and encoded to WebP; `render-sprites.mjs` drives Playwright,
writes files + manifest, and `--preview` renders QA composites. 48 frames × ~86 parts ≈ 5,455 files / 19.5 MB in ~14 min.

## Parity check (see `diff/`, `docs/screenshots/`)
Full-frame `rea_diff.py` mismatch is ~57 % — expected and deliberate: the vehicle art and backdrop are original. The
HUD-only metric (`tools/hud_diff.py`, docks + bottom panel + home button) gives pixel mismatch 10–26 % / layout
mismatch 6–32 % across Colors / Parts / Settings, dominated by category icons (our sprites vs. theirs), fonts
unavailable in the capture sandbox, and the backdrop showing through the dock column. Control geometry matches.

### P0 walk-through against the original
- [x] drag rotates in discrete frames; auto-rotate idles; coarse frames appear first while caching
- [x] Colors: zone pills, selected-part dropdown, swatch carousel, custom colour, manipulate popover, finishes row
- [x] Parts: category strip with arrows, level-2 tiny category + cards, auto-rotate to the part's angle, prices
- [x] Settings: tint darkens glass, suspension lifts body over wheels, zoom scales stage, neon/lights/rock lights
- [x] Right dock toggles with LEDs incl. ENGINE START (sound + flash), Before/After, Filters NEW badge, "?" help
- [x] Parts Used modal, save/share/snapshot tools, home menu
- [ ] second camera, templates, community — out of scope (P2)
