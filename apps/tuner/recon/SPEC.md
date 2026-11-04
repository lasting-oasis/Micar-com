# REA recon: https://www.3dtuning.com/en-US/tuning/jeep/wrangler.unlimited.jk.rubicon.recon/4.door.suv.2017

Captured 2026-11-03 through the desktop app's built-in browser (the cloud workspace could not reach 3dtuning.com).
Evidence: `shots/` (desktop 1440×900 per panel, tablet 768×1024, mobile redirect), `tokens.json`, `structure.json`, `api.json`.

## What the page is
A single-page car configurator ("tuning") for one vehicle. Fixed full-viewport app, no scrolling. The vehicle is NOT
rendered with WebGL: it is a **sprite turntable** — 48 pre-rendered rotation frames; each frame is composited from
~35–45 per-part PNG layers (one `<canvas>` each, 1034 canvases in the DOM) positioned on a fixed **1440×900** stage.
The layer file name encodes frame and offset: `…/{part}/{variant}/{material}/a0004_284_148.png` = frame 4 at (284,148).
Materials per part: `glossy` (colour layer), `metal` (non-paint), `mask` (paintable zone mask), `nesteds/logo/metal`.
Colour is applied at runtime by recolouring through the mask; suspension shifts the body-group layers by pixels
(`minSuspension -35 … maxSuspension 25`); zoom is a CSS `transform: scale()` on `#container`; the background is a
separate full-viewport photo (`work_shop_v3_1_1_web.jpg`) that does not zoom. Frames load coarse-first (0, 4, 8 …).
Per-frame z-order comes from the car record (`layersPositions[frame]`, ~70 part slugs farthest→nearest).

Stack: jQuery 2.0.3 + AngularJS (scope: `carData`, `selectedComponentTypes`, `factoryColors`, `materialsCarousel` …),
Swiper 11 (carousels), jQuery-UI sliders, GSAP, socket.io (presence/challenges), AdSense/GPT/Applixir ads.

## Design tokens (most used first)
- **font-family**: `PT Sans`×1150 (body 13px / 18.57 line-height, #808285), `Montserrat` (panel headers 15px #656565),
  `PT Sans Caption` (part cards 17px #454545), `Font Awesome` + a custom `Tuning` icon font for dock icons.
- **background**: `rgba(0,0,0,.8)`×11 (docks), `#00ff30` (LED on), `#077cbf` (Parts Used), `#df4914` (Top Ranked),
  `#e21a1a` (NEW badge), `#ff0000` (help dot), `#ffffff` (bottom panel, selected dock item).
- **radius**: 8px (dock pills), 2px (LED), 3px (badge), 100% (help dot); 7px panel pills; 50px colour icons.
- **shadow**: `0 1px 4px rgba(0,0,0,.45)` (badge). **transition**: `all .5s ease-in-out`, `max-width .5s ease-in-out`.
- No CSS custom properties; no media queries in the served CSS (mobile is a UA redirect to mobile.3dtuning.com).

## Layout at 1440×900 (x, y, w, h)
- Home button 0,45 65×40 · ad banner 728×90 at top centre (y=10) · stage container 0,20 1440×900 (`margin-top:120px`).
- Right dock (x=1373, 67×40, radius 8 left corners): Parts Used y=40 (blue), Top Ranked y=90 (orange); toggles with an
  18×5 LED, 10px label + 12px bold value: Filters 440 (NEW badge), Before/After 490, Sounds 540, ENGINE START/STOP 590,
  Fast Mode 640 (red "?" help), Transform 690; save/tools button 740.
- Left dock (x=0, 67×40): Settings 640, Colors 690, Parts 740 — selected item is white with #454545 text.
- Bottom panel 0,780 1440×120 white; `header-key` labels at y=800, controls at y≈835–875.

## Panels
**Colors** ("finishes"): Paintable Zone [Exterior|Interior] pills 110×30 · Selected Part dropdown 150×30 ·
Colors `#bc1d17`: manipulate-colour (black dial), custom picker (rainbow), 6 factory swatches (17 total) + arrow ·
Colors `Glossy`: materials carousel 49×36 (glossy, white, mate, redblack, gold, silver, chameleon, chrome, camo…).
**Parts**: category carousel, tiles 151px (pitch 162) with icon + uppercase 13px label — 44 categories (see
structure.json). Level 2: `component-types-tiny` 231px (prev/next arrows 33×45) + cards 470×110 (190×46 image, name,
"STARTING AT: N/A"); selected card #eee with 1px rgba(0,0,0,.2) border. Picking a category auto-rotates the car to the
frame that shows that part. Ads are injected as slides.
**Settings**: sliders Window Tint / Suspension / Zoom Level (145×4 track, 24px handle, −/+ buttons, 288px pitch) and
round checks Wheel Neon / Car Neon / Lights On / Rock Lights / Auto Rotate (15px, 115px pitch).

## Behaviours observed
Drag on stage rotates (discrete frames) · auto-rotate on by default · zoom slider/scale · Before/After toggles the
stock build · Engine START plays engine audio (start/gas/down.mp3) · Lights On adds glow layers · Save/Share/Snapshot
tools (tooltips: Save, Templates, Share, Make snapshot, Disk neon, Rear lights, Front lights, Underglow) ·
Parts Used lists selected parts · Top Ranked = community gallery/challenges (socket.io, accounts API).

## Data / API surface
See `api.json`. Key call: `GET assets2.3dtuning.com/api/v1/carsApi/getCarByName?…` → car record with
`frameCount: 48`, `size: 1440×900`, `layersPositions` (per-frame z-order), `settings` (68 component slots with
position/ordering/menu flags), `components` + `componentsData` (default build + part catalog with file lists),
`factoryColors`, suspension limits, backgrounds. Others: manufacturers, templates, backgrounds, translations, accounts.

## Responsive
Tablet 768×1024: same HUD, stage cropped (overflow hidden), bottom strip scrolls. Mobile UA → redirected to an
app-store landing page (no configurator).
