# Track look (race UI stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 10 circuits read as real race circuits in the clone's style. The out-of-place objects go. Layouts, events and physics stay.

**Architecture:** A bpy-free planner (`tools/blender/trackside.py`, pytest) decides where everything goes along each centreline. `build_strip.py` turns the plan into UV-mapped meshes, one per `trk_*` material, in Blender 5.3 on the owner's PC. The exporter writes Draco-compressed scenery glb files only, not the json. The game swaps `trk_*` materials by name for shared CC0 or drawn textures, adds a sky and grass, hides the lap-race markers and lights the gantry.

**Tech Stack:** Python 3 (pytest; Pillow for drawn textures), Blender 5.3 Python via the Blender MCP on the owner's PC, three 0.160 / three-stdlib GLTFLoader and DRACOLoader, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-track-look-design.md`

## Global Constraints

- Routes, markers and walls in `public/strip/tracks/<id>.json` do not change. Only `<id>.glb` is re-exported.
- Barriers sit on the physics wall line: an offset of `±(width/2 + 4.0)` m, the same runs as `wall_runs`.
- Circuit materials are named `trk_*`; the hub glb is untouched.
- No Slipstream code or files. Textures come from Poly Haven and ambientCG originals (CC0, credited in `apps/sim/public/strip/tex/CREDITS.md`) or are drawn by our own script. Boards carry MiCar names only.
- Textures are 1024 px or less, about 4 MB in total. Each circuit glb is 900 KB or less after Draco.
- Every new string a player sees comes in English and Spanish. The scenery has no text except brand names and numbers.

## Review Focus

1. **Circuits that fold back or cross** (Suzuka's figure eight, Monaco's harbour loop): scenery must not land on another part of the track.
2. **Short straights**: braking boards and the start-area buildings must not overlap a bend or the track.
3. **The physics line**: a barrier drawn off the wall line shows a car hitting thin air.
4. **Phones**: draw calls and triangles per frame stay in budget (renderer.info), and texture memory stays at 1024 px.
5. **A failed texture or glb load** leaves the circuit drivable, with the old flat materials or the road ribbons.

---

### Task 1: The trackside planner

**Files:**
- Create: `tools/blender/trackside.py`, `tools/blender/test_trackside.py`
- Modify: `tools/blender/build_strip.py`: the geometry helpers move to trackside and are imported back; the names stay the same.

**Interfaces (produces):**
- Geometry helpers, moved as they are: `dist, lerp, tangents, offset_polyline, cumulative, point_at, resample, curvature, signed_area, wall_runs, longest_straight`.
- `wall_run_idx(pts, closed, d, width) -> list[tuple[list[int], bool]]`: the same runs as `wall_runs`, as point indices.
- `racing_line(pts, width, closed=True) -> list[tuple[float, float]]`
- `bend_spans(pts, closed, kmin) -> list[tuple[int, int, int]]`: (i0, i1 exclusive, sign); sign +1 is a left bend.
- `barrier_kind(pts, width, closed, i, side) -> str`: 'wall', 'tyres' or 'armco'.
- `runoff_kind(pts, closed, i, side) -> str`: 'grass' or 'gravel'.
- `start_area(pts, width, closed) -> dict`: gantry, grandstand, pit building and pit lane frames, each an (s0, s1, d0, d1) band along the line, or None where blocked.
- `marshal_posts(...)`, `braking_boards(...)`, `fence_spans(...)` -> lists of (s, side) or (s0, s1, side)
- `trees(pts, width, closed, seed) -> list[tuple[float, float, str, float]]`: x, y, species, height.

- [ ] **Step 1:** Write the failing tests in `test_trackside.py`, against all 10 centrelines in `tools/tracks/data`:
  - `test_wall_runs_unchanged`: `wall_runs` equals a frozen copy of today's implementation on every circuit, both sides.
  - `test_racing_line_on_tarmac`: every point lies within `width/2 - 1` of its centreline point.
  - `test_racing_line_takes_the_apex`: at the sharpest bend's peak, the line is on the inside half.
  - `test_kerbs_only_on_bends`: every span has `|curvature| > 1/150` at its middle point.
  - `test_barriers_on_wall_line`: each `wall_run_idx` point equals the offset point of its index.
  - `test_tyres_outside_tight_bends`: 'tyres' only where the side is the outside of a bend with `|k| > 1/60`; 'wall' only on the start straight.
  - `test_scenery_clear_of_track`: trees are at least 25 m from every centreline point; marshal posts and start-area frames at least width/2 + 4 m.
  - `test_boards_before_bends`: each board's s is 50, 100 or 150 m before a bend span start, and that bend follows at least 150 m of straight.
- [ ] **Step 2:** Run `pytest tools/blender/test_trackside.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `trackside.py`; move the helpers; make `build_strip.py` import them.
- [ ] **Step 4:** Run the tests. Expected: all pass.

### Task 2: The Blender build

**Files:**
- Modify: `tools/blender/build_strip.py`: build_track's scenery, Builder UVs, `trk_*` materials, removal of poles, slabs, the box building, the plain walls and the cone trees.
- Modify: `tools/blender/export_strip.py`: `export_track_glb(tid)` exports texcoords and Draco and skips the json; the budget becomes 900 KB.

**Interfaces:**
- Consumes: Task 1's planner.
- Produces material names: `trk_asphalt, trk_rubber, trk_line, trk_kerb_red, trk_kerb_white, trk_grass, trk_grass_mow, trk_gravel, trk_armco, trk_steel, trk_wall, trk_boards, trk_tyres, trk_fence, trk_stand, trk_crowd, trk_roof, trk_pit, trk_glass, trk_marshal, trk_brake, trk_tree_a, trk_tree_b, trk_lamp_box, trk_lamp1 .. trk_lamp5`. UVs: ground strips in metres / tile, along s and across; atlas materials (boards, brake, crowd, pit, tyres) at 0..1 per tile.

- [ ] **Step 1:** In the cloud, run the build logic without bpy: a stub `Builder` collects faces per material. Assert:
  - every circuit has the materials above and no `barrier`, `concrete` or `foliage`
  - triangles stay at 120k or fewer per circuit
  - every UV is finite
- [ ] **Step 2:** In Blender on the PC (via the MCP), exec trackside + build_strip, `build_track('monaco')`, then `report()`. Expected: triangles under budget. Take a viewport screenshot.
- [ ] **Step 3:** Export monaco's glb to `tools/blender/out/`. Check its size (900 KB or less), stage it here, and look in the game (Task 6 tooling).
- [ ] **Step 4:** Repeat for all 10 circuits.

### Task 3: Textures

**Files:**
- Create: `tools/blender/fetch_textures.py`, run on the PC in Blender's Python. It downloads the 1k CC0 maps into `tools/blender/tex_src/`:
  - Poly Haven: `asphalt_track`, `gravel_floor_02` (or the nearest gravel), `concrete_wall_008`, `kloofendal_48d_partly_cloudy_puresky` (tonemapped)
  - ambientCG: `Grass001`, `Fence003`
  - two tree models, `island_tree_01` and `fir_sapling_medium`, rendered to 512 px RGBA sprites by `tools/blender/render_trees.py`
- Create: `tools/blender/draw_textures.py`, run here with Pillow. It draws `boards.png` (8 MiCar boards), `tyres.jpg`, `crowd.jpg`, `pit.jpg` (garage doors, windows) and `brake.png` (150/100/50).
- Create: `apps/sim/public/strip/tex/` with the prepared files and `CREDITS.md` (source, author, licence, URL).

- [ ] **Step 1:** Write `draw_textures.py`, run it and look at each image.
- [ ] **Step 2:** On the PC: fetch, render the trees, stage the files here, then resize and re-encode (1024 or 512, JPEG q80; PNG where alpha is needed). Expected: about 4 MB in total.

### Task 4: Game materials, sky and grass

**Files:**
- Create: `apps/sim/src/world/strip/trackMaterials.ts`, `trackMaterials.test.ts`
- Modify: `apps/sim/src/world/strip/park.ts`: the loader gets DRACOLoader (decoder at `<assetBase>draco/`); circuit models get `applyTrackMaterials`; the background, fog and ground get the sky and grass.
- Create: `apps/sim/public/draco/` (draco_decoder.wasm and draco_wasm_wrapper.js, copied from three's examples).

**Interfaces:**
- `TRACK_TEX: Record<string, { map?: string; normal?: string; repeat?: number; color?: number; alphaTest?: number; transparent?: boolean; opacity?: number; side?: 'double'; metal?: number; rough?: number; emissive?: number }>`
- `makeTrackLib(load: (url: string) => THREE.Texture, base: string): { material(name: string): THREE.Material | null; dispose(): void }`
- `applyTrackMaterials(root: THREE.Object3D, lib): number`: swaps every mesh whose material name is a `trk_*` key and returns the count. Unknown names are left alone.

- [ ] **Step 1:** Failing tests:
  - `swaps trk materials by name and leaves others`
  - `one material per name, shared across circuits`
  - `rubber is transparent with polygon offset; fence and trees use alphaTest`
  - `lamps are separate materials`
  - `a texture that fails to load leaves the material's colour`
- [ ] **Step 2:** Implement; run vitest; wire into park.ts.

### Task 5: Lap-race markers and gantry lamps

**Files:**
- Modify: `apps/sim/src/world/strip/scene.ts`: in lap races, no route ribbon, gate or cp beam; the gantry lamps follow `active.lit`.
- Create: `gantryLamps(lit: number | null, counting: boolean): boolean[]` in `trackMaterials.ts`.
- Test: `scene.test.ts` or `trackMaterials.test.ts`:
  - `a lap race adds no route ribbon and hides the checkpoint mark; drift and drag keep them`
  - `the gantry lamps light one by one and go out at the green`

### Task 6: Build all, verify, ship

- [ ] Export all 10 glb files on the PC and stage them here. Check the sizes against the budget.
- [ ] `pytest tools/blender -q`; `pnpm exec vitest run`; `tsc --noEmit`; `pnpm build`.
- [ ] Extend `e2e/race.smoke.mjs` (or a new `e2e/tracks.smoke.mjs`) to screenshot Harbour, Figure Eight, Ardennes and Royal Park at the start and mid-lap, at 1440×900 and 844×390. Log `renderer.info` calls and triangles. Budget: 80 calls and 500k triangles on a circuit.
- [ ] Look at the screenshots beside the clone's, then fix and re-export (Task 7 is that fix).
- [ ] Commit, push, and open a PR stacked on #16. Report with screenshots.

### Task 7: Closer to the clone, inside the budget (added after the first screenshots)

The first screenshots showed: the hub's 60 km ground hiding the asphalt from some cameras (fixed in park.ts: a ground
that follows the camera); Monaco drawing 108 calls at 0.65 of the lap (the old scenery 90); and, beside the clone, a
near-black asphalt, one rubber line, a summer sky, bright grass and a bare horizon.

**Files:** `tools/blender/build_strip.py`, `tools/blender/trackside.py`, `tools/blender/test_build_scenery.py`,
`tools/blender/prep_textures.py`, `tools/blender/draw_textures.py`, `apps/sim/src/world/strip/trackMaterials.ts` (+ test),
`apps/sim/src/world/strip/scene.ts` (+ test), `apps/sim/src/world/strip/park.ts`, `apps/sim/public/strip/tex/*`.

**Interfaces:**
- `build_strip.PALETTES: dict[str, list[str]]`: `trk_marks` = line, paint, kerb_red, kerb_white (on the ground, lifted);
  `trk_solid` = steel, roof, marshal, orange, lamp_box, armco; `trk_lamps` = lamp1..5. `Builder.merge(palettes)` moves
  each member's faces into its group with every UV at its cell's centre, `((j + .5) / n, .5)`; `emit` merges first.
- `trackside.TREE_ASPECT = {'a': 0.946, 'b': 0.363}`; trees use one material `trk_trees` on the atlas `trees.webp`
  (1024×512: species a centred in the left half, b in the right, full height).
- `trk_treeline`: a closed ring of a 1024×256 tree-line strip (`treeline.webp`, two rows of trees, 104 m a tile)
  260 m outside the centreline's bounds (110 m past the perimeter fence), 26 m tall. (A second ring further out would
  hide behind the first unless 42 m tall: the strip's two rows give the depth instead.)
- `trackside.racing_line(pts, width, closed=True, margin=1.2)`: the line stays `margin` inside the edge; the rubber,
  now 4 m wide, uses `margin=2.1`.
- `trackside.start_area`: stand `(total - 120, total + 50)`, pit lane `(total - 200, total + 60)`, pits
  `(total - 150, total + 40)` (s past `total` is past the line); `_fit_band` trims the part past the line first; a band
  is not clear on the inside of a bend where its depth exceeds 0.6 of the radius; `trees` keep 9 m out of the bands.
- `trackMaterials.PALETTES` (same names, same order, with colours) and `setLamps(lib, on: boolean[])`.

- [ ] Python tests first: merged names only, palette UVs on cell centres, the trees' UVs inside their species' cell, the
  tree line outside the perimeter fence, the rubber 4 m wide, `PALETTES` the same names and order as trackMaterials.ts.
- [ ] Builder.merge, trees atlas, tree line, rubber; `pytest tools/blender -q` green.
- [ ] TS tests first (palette textures, lamps by cell), then trackMaterials/scene; vitest and tsc green.
- [ ] Textures: overcast sky (Poly Haven `overcast_soil_puresky`, CC0), asphalt to a mid grey, rubber streaks, trees
  atlas, tree line. Lights: a dimmer sun and a stronger, greyer sky light.
- [ ] Export on the PC, then the tracks smoke on desktop and phone; Monaco at 0.65 under 100 calls.
