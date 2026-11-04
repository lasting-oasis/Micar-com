# Assets from the MiCar design sessions (Nov 3–4, 2026)

Saved here so the monorepo import carries them. None of this is used by the site build.

- `explainer/`: the Remotion explainer video (English and Spanish compositions). `npm install` then `node render.mjs`
  (env `COMP=explainer|explainer-es`). Voices: English via Kokoro, Spanish via Piper es_MX (`../tts/`). The finished
  MP4s were delivered in chat and are not committed; they rebuild from this source.
- `tts/`: the voice scripts and lexicons used for the narration, plus the Whisper round-trip checks.
- `concept/micar-garage/`: the MiCar Garage concept page (3D garage hero, slab inspector, grade simulator, ledger,
  lot, Keyholder offer). `concept/carvalue-review.html`: the review of the old Carvalue dashboard.
- `cars/`: the car work. `blender/` builds the nine category cars in Blender (`builder.py`) and bakes game GLBs
  (`export_glb.py`); `webp/` are the card renders; `sim-models/` the GLBs plus a three.js loader. Superseded for the
  simulator by the sim's own lofted car system (branch perf/3d-scene-optimizations); `render-cards-from-sim.ts`
  renders card art from that system instead. `card-art-comparison.jpg` shows why.
