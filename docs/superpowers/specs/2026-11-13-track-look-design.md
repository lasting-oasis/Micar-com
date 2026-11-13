# MiCar race UI, stage 2: the track look

- **Date:** 2026-11-13
- **Status:** direction approved by the owner on 2026-11-13: "Can you not improve it in blender?" Build it in Blender on the owner's PC, with CC0 textures fetched through it.
- **Parent design:** `2026-11-12-race-ui-design.md`, section 10 (stage 2).

## 1. Intent

The owner: "the race track has things that are very out of place, random obstacles and what not. Increase design accuracy to match the race track aesthetic from the clone." The 10 circuits should read as real race circuits in the clone's style. Their layouts, names and events stay ("don't throw away our tracks").

## 2. What is there today

`tools/blender/build_strip.py` builds each circuit in Blender out of flat-coloured boxes and strips, and `export_strip.py` writes `public/strip/tracks/<id>.glb` (scenery) and `<id>.json` (routes, walls, markers). The out-of-place parts:

- 30 bare 10 m grey "light poles" per circuit, with no lamps
- a grandstand made of five grey slabs, and a pit building that is a plain box
- plain 1 m grey walls with gaps, and a 1.2 m grey wall around each circuit's square
- cone trees dropped at random 30–200 m out
- in a race: the lime route strip down the road, a yellow checkpoint gate and a tall beam
- tarmac that renders light grey, and flat-coloured grass and sky

## 3. Approaches

1. **Improve the Blender build, on the owner's PC. Chosen by the owner.** It keeps the current pipeline, and Blender on the PC can reach Poly Haven and ambientCG.
2. Generate the trackside in the game at load. It needs no Blender, but it means a second scenery pipeline. The owner preferred Blender.
3. A cloud-side build script writing glb files. It replaces Blender without a reason to.

## 4. Constraints

- **Layouts, names, events, routes and markers do not change.** Only the scenery glb is re-exported. The circuit json is not.
- **The physics walls stay where they are** (each side at half the track width plus 4 m). The physics has no grass slowdown, so moving the walls out would let cars cut corners. The new barriers sit exactly on the physics wall line.
- **No Slipstream code or assets.** Textures come from Poly Haven and ambientCG originals (CC0), fetched on the owner's PC. Boards carry MiCar's own names.
- **Phones.** Each circuit glb is Draco-compressed and stays within its budget. There is one mesh per material, with about 25 materials. Textures are shared by all circuits, at 1024 px or less, around 4 MB in total, and loaded once per session.
- **Testable here.** Placement logic lives in a bpy-free module (`tools/blender/trackside.py`) with pytest tests. Blender only turns the plan into meshes.

## 5. What each circuit gets

All of it is built from the centreline. "Outside" means the outside of a bend, and offsets are from the track edge.

1. **Asphalt** with UVs (5 m tiles) and a photo asphalt texture. A darker rubbered racing line runs from edge to apex to edge through the bends. There are white edge lines, a start line and painted grid boxes.
2. **Kerbs** on bends, red and white blocks 1.5 m long, slightly raised: the inside of every bend, the outside of tighter ones.
3. **Run-off.** Across the 4 m from the kerb to the barrier, mown grass (two-tone stripes) on straights and on the inside of bends. Gravel goes on the outside of tight bends.
4. **Barriers** on the physics wall line:
   - concrete walls carrying MiCar boards along the start straight
   - tyre walls on the outside of the tightest bends
   - armco (two rails on posts) everywhere else
5. **Catch fences** (chain-link, 4 m) behind the barrier along the start straight and outside fast bends.
6. **The start area.** A gantry over the line with five lamps the game can light. Grandstands with a crowd and a roof on one side of the main straight. A pit building with garages, a pit lane and a pit wall with boards on the other.
7. **Marshal posts** every 350 m or so, behind the barrier on the outside.
8. **Braking boards** (150, 100, 50) before the sharpest bends that end a straight.
9. **Trees** in clusters 25–150 m from the track, never over another part of the circuit. They are crossed-quad billboards with sprites rendered from CC0 Poly Haven tree models.
10. **The perimeter.** The cell's physics fence is drawn as a chain-link fence, not a grey wall.
11. **Removed:** the bare poles, the slab grandstand, the box pit building, the plain walls and the cone trees.

**In the game:**

12. Circuit materials named `trk_*` are swapped by name for shared textured materials. The glb carries geometry, UVs and names only, so the hub's materials are untouched.
13. The circuits get an overcast day, as at the clone's circuits: a CC0 overcast sky panorama, the fog matched to its horizon, most of the light from the grey sky with a weak soft sun, grey reflections, and the grass texture on the ground. The hub keeps its sunny flat look (it is out of scope); the scene switches looks when a circuit mounts and when the player goes back to the hub.
14. In lap races (circuit, sprint, street X), the route strip, checkpoint gate and beam are not drawn. The HUD arrow and the minimap still show the way. Drag and drift keep theirs.
15. The gantry's lamps light with the start lights.

## 5a. As built, after the first screenshots

The first screenshots beside the clone's led to these changes (plan Task 7):

- **The ground follows the camera.** The hub's ground was two triangles 60 km across. Far from the origin, float precision let it draw over the asphalt and run-off, which sit 1–2 cm above it, from some camera poses. It is now a 13 km square of 416-unit cells under the camera, snapped to whole 4 m grass tiles.
- **Mid-grey asphalt** (the clone's is about 100/255 on screen; ours was near black) and a **4 m rubber band** with the left and right wheels' streaks.
- **A tree line** all round, 260 m outside the centreline's bounds (110 m past the perimeter fence) and 26 m tall: a tiling strip of two rows of the CC0 trees over a dark understorey. The fog softens it with distance.
- **The overcast day** (point 13) and **olive grass**.
- **The chain-link is a blended veil** (its alpha never below 14%). Cut out, it vanished beyond a few metres and left its posts standing alone.
- **The start buildings run on past the line**, as at the clone's start, so the grid sees the grandstand on its left and the pits on its right: grandstand from 120 m before the line to 50 m after, pit lane −200 to +60 m, pits −150 to +40 m. A band never sits on the inside of a bend tighter than its depth allows (its far edge within 0.6 of the radius), and trees keep 9 m clear of it. Nürburgring's start is a 37 m bend, so its pits are 60 m long.
- **Draw calls.** The new scenery had 30 materials (the old 12), and Monaco drew 108 calls at 0.65 of the lap (the old scenery 90). Flat colours now share three palette textures made in code (marks, solid parts, lamps), and the two tree species one atlas. Each circuit has 17 or 18 materials, and the chain-link veil is drawn in one pass. The four smoke circuits draw 80–81 calls at 0.3 of the lap and 95–96 at 0.65, with 39k–65k triangles. The budget is 100 calls and 500k triangles.

## 5b. As built, after three reviews

Three independent reviews on the most capable model led to these changes:

- **Textures stand the right way up.** The glb's UVs are glTF's (v runs down the picture), so the game no longer flips the maps. The normal maps' green is turned to match, as three's GLTFLoader does when there are no tangents. The tree line's UVs count whole tiles.
- **Compression.** 18-bit positions and 16-bit UVs. At 14/12 bits, thin posts and kerb sides collapsed and the start lamps sank into their box. The lamps and their box now share one primitive.
- **Nothing low inside the barrier line.**
  - The start gantry is one frame at the line, with its legs behind the barriers.
  - Braking boards stand 0.7 m behind the barrier line.
  - The grandstand has a red canopy, held by posts behind the back row.
  - Painted and steel parts take less sky reflection, so the canopy reads red, not pink.
- **Kerbs, tyre walls and gravel come in runs** on real bends, using smoothed curvature, so there are no stubs.
  - At the tightest corners, a kerb block or edge-line piece that would reach more than 0.3 m inside its own edge is left out. Otherwise it would fold across the road or cut a chord across the asphalt.
  - Palette vertices that share a position keep their own UVs, so no encoder can weld a box's faces and shade it round.
- **The physics walls changed on five circuits.** This departs from section 4, and was done on purpose. On the inside of bends tighter than the barrier line, the old walls folded back over the road: Silverstone's GP route crossed a wall four times, and Monaco's wall came 3.4 m from its centreline. Those points are dropped, and each fold is bridged by a straight wall that stays more than 1 m off the road.
  - Points near another part of the track still open the barrier, as before.
  - Only `walls` changed in the json, on Silverstone, Suzuka, Nürburgring, Monaco and COTA, by 2–16 points each.
  - No route crosses a wall. A flood fill of the space a car can occupy reaches nothing beyond the barrier line on any circuit.
- **Trees and tree line.** A denser tree belt, about 950 trees in clusters of 8–16, 30–150 m out. The tree line moved 170 m out, 20 m past the perimeter fence.
- **The cars' lamps are off on circuits**, the Garage kits' lamp glows included. The hub keeps them lit.
- **Loading.**
  - Cut-out trees stay hidden until their picture lands.
  - The sky has no mipmaps, so there is no seam line.
  - The Draco decoder runs on two workers and starts afresh after a failed load.
  - The tracks smoke checks that each circuit's model is drawn with its textures.
- **Export without the PC.** On 2026-11-13 the PC was offline. The circuits were exported by Blender 5.3.0 run as a Python module, which carries no Draco bridge. glTF Transform with Google's draco3d 1.5.7 (Blender 5.3's Draco) then compressed them at the same settings, without welding. Against the PC's own export of the previous revision, the json files were byte-identical and the triangles identical. A PC re-export remains the reference.
- **Sizes and costs.** glb files are 141–187 KB each. A frame draws 78–91 calls and 41k–67k triangles.

## 5c. Polish, after a look at all ten circuits beside the clone's (2026-11-13, branch tracks-polish)

All 33 screenshots of main (fc0d66b) were read beside Slipstream's. What still looked out of place, worst first, and
what changed:

- **The rubbered line read as burnout marks.** Two black streaks (up to 45% dark) ran down every lap shot. It is now a
  faint, soft band where the wheels run, at most 20% dark, with no hard line (`draw_textures.rubber`).
- **The red canopy dominated every start.** It is steel grey (`0x4f545b`), as stand roofs are.
- **The crowd was coloured sweets.** Spectators are muted shoulders and heads on dark seats, ten to a 4 m row, so the
  stand reads as a crowd's speckle (`draw_textures.crowd`).
- **Tyre walls were red and white blocks.** The belt covers the middle third of three stacked tyres; the rest is tyres.
- **Kerbs beside the grid.** COTA's and Nürburgring's grids sit on 56–75 m bends, so kerbs ran past the grid boxes. No
  kerb is laid from 60 m behind the line to 20 m past it (`trackside.GRID_CLEAR`, `on_grid`); the other eight circuits
  had none there. Only those two glb files were re-exported (Blender 5.3 on the PC, through its Draco bridge): their
  `trk_marks` lost the kerb blocks and nothing else changed. A fresh export of Monaco matched the committed file mesh
  for mesh.
  - Decoded and compared triangle by triangle, the other 17 meshes of each file match within 0.1 mm. `trk_marks` lost
    80 blocks at COTA and 66 at Nürburgring.
  - Blender's own Draco encoder writes files about 11% bigger than glTF Transform did, at the same settings. The
    unchanged Monaco grew the same way, 151 to 169 KB.
  - So `cota.glb` is now 195 KB and `nurburgring.glb` 189 KB. The other eight keep the 141–187 KB of section 5b, and
    the budget stays at 900 KB.
- **Colours.** Asphalt darker (tint `0xa4a4a4`, from `0xd6d6d6`), towards the clone's; gravel grey stone, not beige
  sand; the kerbs' red a shade deeper.

No material was added, so the draw calls are as before. Left as they were: the 4 m run-off and barrier line (the
physics walls, section 4), the pit building and the flat ground (section 6).

## 6. Out of scope

Elevation and terrain, city blocks for street circuits, night lighting, a grass shader, real-time shadows, KTX2 texture compression, and the hub's look.

## 7. Checks

- pytest for `trackside.py`:
  - the racing line stays on the tarmac
  - kerbs appear only on bends
  - every barrier piece lies on the physics wall line
  - trees and marshal posts keep clear of every part of the track
  - braking boards come before a bend
- vitest for the material swap, lap-race markers and gantry lamps.
- The Blender report (triangles per circuit) and the exporter's glb budget.
- Browser screenshots of several circuits at 1440×900 and 844×390, at the start and mid-lap, next to the clone's. The renderer's draw calls and triangles stay inside a budget.
- The full test suite, the type check, the build, and the race smoke tests.

## 8. Calls made (for the owner to check)

1. The physics walls stay, so run-off is 4 m and barriers sit close, like a tight circuit.
2. Draco compression for the circuit glb files. The decoder ships from the existing three.js package; nothing is added.
3. Textures are swapped in the game by material name, not embedded in each glb. They are shared and cached once instead of downloaded ten times.
4. Two tree species as billboards. Real 3D trees would be too heavy for phones.
5. The lap-race markers go; the HUD arrow is the guide.
6. The circuits are overcast like the clone's; the hub stays sunny.
7. The sky panorama is 2048×1024, the one texture over 1024 px: it spans 360°, so 1024×512 would be blurred four times over on a desktop screen. It is 72 KB as a JPEG.
