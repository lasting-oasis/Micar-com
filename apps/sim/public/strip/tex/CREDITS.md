# Circuit textures

Everything here is CC0 (public domain) or drawn by our own scripts. Sizes, crops and grading are done by
`tools/blender/prep_textures.py`; the drawn ones by `tools/blender/draw_textures.py`.

| File | Source | Licence |
| --- | --- | --- |
| `asphalt.jpg`, `asphalt_n.jpg` | Poly Haven, [*Asphalt Track*](https://polyhaven.com/a/asphalt_track): diffuse lifted to a mid grey, normal map resized | CC0 |
| `gravel.jpg`, `gravel_n.jpg` | Poly Haven, [*Gravel Floor 02*](https://polyhaven.com/a/gravel_floor_02) | CC0 |
| `concrete.jpg`, `concrete_n.jpg` | Poly Haven, [*Concrete Wall 008*](https://polyhaven.com/a/concrete_wall_008): walls and grandstands | CC0 |
| `sky.jpg` | Poly Haven, [*Overcast Soil (Pure Sky)*](https://polyhaven.com/a/overcast_soil_puresky), tonemapped JPG, darkened a little | CC0 |
| `trees.webp`, `treeline.webp` | Renders of two Poly Haven models, [*Island Tree 01*](https://polyhaven.com/a/island_tree_01) and [*Fir Tree 01*](https://polyhaven.com/a/fir_tree_01), made in Blender: an atlas of the two, and a tiling strip of two rows of them | CC0 |
| `grass.jpg`, `grass_n.jpg` | ambientCG, [*Grass 001*](https://ambientcg.com/a/Grass001) | CC0 |
| `fence.webp` | ambientCG, [*Fence 003*](https://ambientcg.com/a/Fence003): colour with the opacity map as alpha (never below 31%) | CC0 |
| `boards.png`, `brake.png`, `tyres.jpg`, `crowd.jpg`, `pit.jpg`, `rubber.png` | Drawn by `draw_textures.py`. The boards carry MiCar names only, set in Barlow Condensed ([SIL Open Font License](https://openfontlicense.org), from `apps/explainer/public/fonts`) | ours |

The flat colours (lines, kerbs, steel, roofs, marshal posts) and the gantry's lamps are small palette textures made in
code (`apps/sim/src/world/strip/trackMaterials.ts`).
