# MiCar monorepo merge: verified plan (Nov 4, 2026)

Dry-run executed end to end in a scratch workspace; the kit at `tools/merge-kit/` in this repo (also `micar-merge-kit.zip` at `C:\Users\Owner\NexusGarage\`) reproduces it. Read `tools/merge-kit/README.md` for prerequisites and the post-run steps.

## Facts that shape the plan
- **car-dealer-sim's `main` is from June 28.** The real work is branch `perf/3d-scene-optimizations` (95 commits, Oct 27 – Nov 4, open PR #1, a clean fast-forward): rewritten 3D world (`src/scene/`), lofted curved car bodies for all 7 styles with far-away versions, people, a town, night lighting, Low/High graphics, plus the "Rebrand to MiCar Dealer Simulator" commit. Render deploys `main`, so the live sim is the old version. Land PR #1 before importing (or run the kit with `SIM_REF=perf/3d-scene-optimizations`).
- **The sim branch's cars are better than the Blender GLBs** (see `assets/cars/card-art-comparison.jpg`). Decision: the sim's `src/scene/car/*` + `carModel.ts` become `packages/cars`, and card art is rendered from it headlessly (`assets/cars/render-cards-from-sim.ts` is the seed). The Blender pipeline and the GLB drop-in (`assets/cars/sim-models/`) are shelved.
- queen_city_mycarvalue: React 19 / Vite 8 / TS 7 / Tailwind 4; sim: React 18 / Vite 5 / TS 5 / Tailwind 3 / three 0.160; tuner: static. No upgrades during the merge; pnpm keeps the versions apart.
- Value's deploy reads secrets `GEMINI_API_KEY`, `SEARCH_API_KEY` and the repo **variable** `COMPS_URL`. Nine workflows commit data to main; the Wayback backfill (`wayback.yml`) re-triggers itself every ~20 min and is ~34% done (3,469 of 10,155 pages). Disable it (and the two cron jobs, `epa.yml` monthly and `market.yml` weekly) before importing; move it; re-enable in the monorepo.
- GitHub Pages: one site per repo, no redirect on rename, archived repos keep serving Pages but their Actions stop → redirect stubs must be deployed "from a branch"; never rename the old repos.
- Render: files outside `rootDir` are unavailable at build time → no rootDir; build from the repo root with build filters (repo-relative).
- QR links are built at runtime from `location.origin + pathname`, so new sheets are right automatically; only printed sheets need the redirect.

## What the kit does (`merge.sh`)
Fresh clones → `git filter-repo --to-subdirectory-filter apps/<name>` → merged with history (366 commits) → direct deps pinned from each package-lock → pnpm workspace (`apps/*`, `!apps/explainer`, `packages/*`), Node 22, pnpm 10.17.1 → `tools/build-site.sh` builds one Pages tree (`/micar/`, `/micar/value/`, `/micar/tuner/`, `/micar/garage/`) → `pages.yml` (value tests gate), `ci.yml`, root `render.yaml` (filters `apps/sim/**`, `packages/**`) → value's data workflows at the root with `working-directory: apps/value` and repo-relative paths → `apps/value/assets/explainer` → `apps/explainer`, other assets → `assets/`.

Verified: value 102/102 tests; value builds at `/micar/value/`; sim builds and starts with `NODE_ENV=production` via `pnpm --filter @micar/sim start`; tuner loads 244 sprites under `/micar/tuner/`; a real printed `#/c/…` link through the redirect stub lands on the same car with the hash intact.

## Order
0. Land PR #1 in car-dealer-sim; pause the three scheduled/self-triggering workflows in queen_city_mycarvalue (`gh workflow disable wayback.yml epa.yml market.yml`).
1. Run the kit (`bash tools/merge-kit/merge.sh <workdir>`); create empty `lasting-oasis/micar`; push; re-create the 2 secrets + 1 variable; enable Pages (source: GitHub Actions); create the Render service from the root `render.yaml`; verify the new URLs beside the old ones.
2. Cutover: redirect stubs (`tools/merge-kit/redirect-stub/`, deployed from a branch) in the two old Pages repos; enable the jobs in the monorepo and trigger each once; switch Render traffic; archive the old repos later. Never rename/delete queen_city_mycarvalue.
3. Shared packages, golden tests first: `packages/cars` (from the sim), `packages/record` (QR codec + Car type + body styles), `packages/engine`, `packages/i18n`, `packages/brand`; `docs/schema.md` for one Supabase schema.

## Rules for whoever runs it
- API keys live only in GitHub Actions secrets; never paste keys in chat or commit them.
- Commit as `git -c user.name=lasting-oasis -c user.email=blueoceanlegacies@gmail.com`.
- Verify before scaling; don't do tangential work.

## Saved to queen_city_mycarvalue main (commit 56c62f6, `assets/`)
Explainer video source (Remotion, EN+ES, voices and lexicons), the MiCar Garage concept page and the Carvalue review, the car work (Blender scripts, card WebPs, GLBs + loader, the sim-based card renderer).
