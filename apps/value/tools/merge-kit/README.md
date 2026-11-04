# MiCar monorepo merge kit

`merge.sh <workdir>` builds `<workdir>/micar` from the three source repos: every commit kept, moved under
`apps/value`, `apps/sim`, `apps/tuner`; direct dependencies pinned to what each lockfile resolves today;
pnpm workspace; one GitHub Pages site (`tools/build-site.sh`); CI; Render blueprint at the root; value's
data workflows moved to the root running inside `apps/value`.

Verified on Nov 4, 2026 (dry run): value's 102 tests pass, value builds at `/micar/value/`, the sim builds and
starts with `NODE_ENV=production` from the root command, the one-site build serves `/micar/`, `/micar/value/`
and `/micar/tuner/` (244 sprites load), and a real printed QR link forwarded through `redirect-stub/`
lands on the same car at the new URL with its hash intact.

Needs: git ≥ 2.40, `pip install git-filter-repo`, Node 22, corepack.
Set `SIM_REF=perf/3d-scene-optimizations` until PR #1 lands in car-dealer-sim.

After it runs: `cd micar && corepack enable && pnpm install && pnpm test && pnpm site`, then create the empty
GitHub repo `lasting-oasis/micar`, `git remote add origin … && git push -u origin main`, re-create the secrets
(`GEMINI_API_KEY`, `SEARCH_API_KEY`) and the variable `COMPS_URL`, enable Pages (source: GitHub Actions),
and create the Render service from `render.yaml`. `redirect-stub/` goes into the OLD repos' Pages (deploy from
a branch) at cutover; edit the NEW URL inside it for the tuner.
