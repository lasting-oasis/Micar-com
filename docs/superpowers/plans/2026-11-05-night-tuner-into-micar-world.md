# Night Tuner into MiCar World (phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Night Tuner's physics, parts, tuning and racing become MiCar World's engine: one driving model everywhere, the Garage as the tuner, and the Strip district (Night Tuner's night city with its six event types) behind the Speedway gate, with dollars for prizes and Octane and stamps on wins.

**Architecture:** Night Tuner's sections are ported as TypeScript modules under `apps/sim/src/world/` (pure physics, data and event logic with no three.js in them; three-dependent city, parts, HUD, audio and cameras beside them). `VanillaThreeScene.tsx` keeps the town, swaps its kart physics for `stepVehicle` at 120 Hz through a units bridge (the sim renders at 2 world units per metre), and gains a district switch: the Speedway becomes the gate to a second scene, the Strip. The server keeps the economy: events report results it validates, pays in dollars, and credits Octane and stamps; the player's Strip record (rep, car configs, tunes, owned parts, wins, bests) lives in the player object.

**Tech Stack:** React 18, three 0.160.1, zustand 4.5, socket.io 4.8, Express, TypeScript 5, Tailwind 3, vitest 5.0.5 (added to the sim). Source material: the Night Tuner artifact, saved at `/root/.claude/projects/-home-claude/ae3254c0-9e8b-52ed-aa9c-689bdd4ef637/tool-results/artifact-67124339-1793891927-af39.html` in the authoring session; the implementer copies its sections from there (each is marked `/* ===== NN-name.js ... */`).

**Spec:** `docs/superpowers/specs/2026-11-05-night-tuner-into-micar-world-design.md`

## Global Constraints

- No dependency upgrades: three stays `0.160.1`, React `18`, Tailwind `3`. Add only `vitest@5.0.5` (the version `apps/value` pins).
- Units: physics is SI (metres, m/s, kg, N). The sim's world is **2 world units per metre** (`carStyles.ts`: "proportions at ~2 world units per metre"); every position or length that crosses from physics to a scene is multiplied by `WORLD_PER_M = 2`, every one that crosses back is divided. Lofted bodies face **−Z** (`noseZ` is negative); Night Tuner's parts are defined for a body facing **+Z** and are mirrored in `parts.ts`.
- Money is dollars (`player.money`, the existing field). Octane is `player.octane` (new, integer). Nothing in the world ever writes a grade or a card's condition.
- Copy and colours follow `packages/brand`: windshield yellow `#ffd23f` is the accent, night `#0e1217` the ground, Barlow / Barlow Condensed the type. Night Tuner's cyan `#38d6ff`, magenta and Saira do not ship.
- Night Tuner's keys stay as its help text lists them (arrows/WASD drive, Alt nitrous, Space handbrake, Shift/Ctrl gears, C camera, B look back, G lights, N horn, X drift mode, M map, Enter start event, R reset, Esc menu), except that **R** in the town keeps its current meaning (park / open a bay) and reset is **Backspace** there.
- Fuel stays: burn `0.0009 × throttle × dt` of a 100-unit tank per second at full throttle plus `0.00004 × |u|` (m/s) per second, so a full tank lasts about 20 minutes of hard driving; at 0 fuel the car coasts (`thr = 0`).
- Keep `apps/sim` building with `tsc --noEmit && vite build`; `noUnusedLocals` is on.

## Review Focus

1. A card whose make/model is unknown to `carSpecs.ts` must still drive: `specFor` falls back to the body-style archetype, never throws (test in Task 2).
2. Leaving the Strip mid-event (gate, disconnect, tab hidden) must not strand the player or pay a prize: `exitStrip` calls `cleanupEvent`, the server ignores `finish_event` without a live entry (tests in Tasks 5 and 11).
3. A player with less money than a part's price must be refused without a state change (test in Task 9).
4. Physics must stay stable at a 120 Hz step on a slow frame: `dt` is clamped to 0.05 s per frame and the accumulator never runs more than 6 sub-steps (test in Task 10's unit test of `stepFrame`).
5. The town's existing colliders (lot fences, buildings) must stop the new physics car without launching it: a head-on hit at 20 m/s ends with `|u| < 6` and the car outside the box (test in Task 10).

---

### Task 0: Test tooling for the sim

**Files:**
- Modify: `apps/sim/package.json` (devDependencies: `"vitest": "5.0.5"`; scripts: `"test": "vitest run"`)
- Create: `apps/sim/vitest.config.ts`
- Modify: `.github/workflows/ci.yml:18` (add `- run: pnpm --filter @micar/sim test` after the value test line)
- Modify: `.github/workflows/pages.yml:41` (same line after the value test, so the sim's tests gate every deploy too)
- Modify: `render.yaml` buildCommand: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @micar/sim test && pnpm --filter @micar/sim build`

**Interfaces:**
- Produces: `pnpm --filter @micar/sim test` runs `src/**/*.test.ts` in node environment.

- [ ] **Step 1: Write a smoke test** `apps/sim/src/world/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('vitest', () => { it('runs in the sim', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 2: Run it to see it fail** — `pnpm --filter @micar/sim test` → "vitest: not found" (or script missing).

- [ ] **Step 3: Add vitest** — `pnpm --filter @micar/sim add -D vitest@5.0.5`; add the script; `vitest.config.ts` exports `{ test: { environment: 'node', include: ['src/**/*.test.ts'] } }`; add the CI, Pages and Render lines.

- [ ] **Step 4: Run it to see it pass** — `pnpm --filter @micar/sim test` → 1 passed. `pnpm install --frozen-lockfile --offline` → "Already up to date" (lockfile committed).

- [ ] **Step 5: Commit** — `git add apps/sim/package.json apps/sim/vitest.config.ts apps/sim/src/world/smoke.test.ts pnpm-lock.yaml .github/workflows/ci.yml .github/workflows/pages.yml render.yaml && git commit -m "sim: vitest, gating CI, Pages and Render"`

---

### Task 1: Physics (pure)

**Files:**
- Create: `apps/sim/src/world/physics.ts`
- Test: `apps/sim/src/world/physics.test.ts`

**Interfaces:**
- Produces:
  - `type Drive = 'FWD' | 'RWD' | 'AWD'`
  - `type VehicleSpec = { id: string; name: string; drive: Drive; mass: number; a: number; b: number; h: number; cd: number; area: number; redline: number; r: number; fin: number; gears: number[]; tq: [number, number][] }` (Night Tuner's car record minus price/stage/desc)
  - `type PerfCfg = { engine: 0|1|2|3; ecu: 0|1|2|3; turbo: 0|1|2|3; trans: 0|1|2|3; susp: 0|1|2|3; nos: 0|1|2|3; tires: 0|1|2|3; brakes: 0|1|2|3; weight: 0|1|2|3 }`
  - `type Tune = { turbo: number; nitrous: number; aero: number; bias: number; ride: number; stiff: number; steer: number; gears: number }` (each −1..1)
  - `type Params` (the return of `carParams`), `type Vehicle` (the return of `makeVehicle`), `type Input` (Night Tuner's `NO_INPUT` shape), `const NO_INPUT: Input`
  - `carParams(spec: VehicleSpec, perf: PerfCfg, tune: Tune): Params`
  - `makeVehicle(P: Params): Vehicle`, `resetVehicle(V: Vehicle, x: number, z: number, h: number): void`, `syncBody(V: Vehicle): void`
  - `stepVehicle(V: Vehicle, I: Input, dt: number, drift: boolean): void`
  - `torqueAt(P: Params, rpm: number, boost: number): number`
  - `simStats(P: Params): { t100: number | null; t200: number | null; top: number; hp: number; hpRpm: number; grip: number; brake: number }` (speeds in km/h, times in s)
  - `dynoCurve(P: Params): [rpm: number, nm: number, hp: number][]`
  - `tireCurve(a: number, B: number): number`, `curveAt(tbl: [number, number][], x: number): number`, `clamp`, `lerp`

- [ ] **Step 1: Write the failing tests** `physics.test.ts` (use Night Tuner's `ronin` record as the fixture, copied verbatim: `{id:'ronin',drive:'RWD',mass:1340,a:1.28,b:1.32,h:.48,cd:.33,area:2.05,redline:7300,r:.32,fin:4.0,gears:[3.55,2.12,1.5,1.13,.9,.76],tq:[[1000,175],[2500,222],[4000,252],[5500,258],[6500,242],[7400,210]]}`, `STOCK_PERF` all zeros, `TUNE_DEF` all zeros):

```ts
it('interpolates the torque table', () => { expect(curveAt(ronin.tq, 1000)).toBe(175); expect(curveAt(ronin.tq, 3250)).toBeCloseTo(237, 0); expect(curveAt(ronin.tq, 9000)).toBe(210); });
it('a stock Ronin does 0-100 between 5 and 9 s and tops out between 200 and 260 km/h', () => { const s = simStats(carParams(ronin, STOCK_PERF, TUNE_DEF)); expect(s.t100).toBeGreaterThan(5); expect(s.t100).toBeLessThan(9); expect(s.top).toBeGreaterThan(200); expect(s.top).toBeLessThan(260); expect(s.hp).toBeGreaterThan(200); });
it('tier-3 engine, ecu and turbo add at least 35% peak torque', () => { const P0 = carParams(ronin, STOCK_PERF, TUNE_DEF), P3 = carParams(ronin, { ...STOCK_PERF, engine: 3, ecu: 3, turbo: 3 }, TUNE_DEF); expect(torqueAt(P3, 5500, 1) / torqueAt(P0, 5500, 0)).toBeGreaterThan(1.35); });
it('holding the throttle past the redline in manual blows the engine within 3 s', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); const I = { ...NO_INPUT, fwd: 1, manual: true }; for (let i = 0; i < 120 * 12; i++) stepVehicle(V, I, 1 / 120, false); expect(V.overRev).toBeGreaterThan(1.5); });
it('a perfect shift is counted in the window', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); const I = { ...NO_INPUT, fwd: 1, manual: true }; let n = 0; for (let i = 0; i < 120 * 8; i++) { const up = V.rpm > V.P.redline * 0.92 && V.shift <= 0 && V.gear < 6; stepVehicle(V, { ...I, shiftUp: up }, 1 / 120, false); n = V.perfectN || 0; } expect(n).toBeGreaterThanOrEqual(2); });
it('nitrous drains while firing and refills after', () => { const V = makeVehicle(carParams(ronin, { ...STOCK_PERF, nos: 2 }, TUNE_DEF)); const cap = V.P.nos.cap; for (let i = 0; i < 120; i++) stepVehicle(V, { ...NO_INPUT, fwd: 1, nos: true }, 1 / 120, false); expect(V.nos).toBeLessThan(cap); const low = V.nos; for (let i = 0; i < 120 * 30; i++) stepVehicle(V, { ...NO_INPUT, fwd: 0.2 }, 1 / 120, false); expect(V.nos).toBeGreaterThan(low); });
it('resetVehicle zeroes motion and puts the car where asked', () => { const V = makeVehicle(carParams(ronin, STOCK_PERF, TUNE_DEF)); for (let i = 0; i < 240; i++) stepVehicle(V, { ...NO_INPUT, fwd: 1 }, 1 / 120, false); resetVehicle(V, 10, 20, 1); expect([V.x, V.z, V.h, V.u, V.gear]).toEqual([10, 20, 1, 0, 1]); });
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @micar/sim test physics` → cannot resolve `./physics`.

- [ ] **Step 3: Implement** by copying Night Tuner's `04-physics.js` section into `physics.ts` with the types above: `carParams(spec, perf, tune)` takes `perf` directly (Night Tuner read `cfg.perf`); everything else is a mechanical port (add types, `export`). Keep every constant (`NOS_CAP`, `NOS_POW`, `SHIFT_T`, `DT_EFF`, the 0.035 weight factor, the 0.11/0.045 torque multipliers, the 150 rpm per ECU tier).

- [ ] **Step 4: Run to verify they pass** — all 7 pass.

- [ ] **Step 5: Commit** — `git add apps/sim/src/world/physics.ts apps/sim/src/world/physics.test.ts && git commit -m "world: Night Tuner's vehicle physics as a pure module"`

---

### Task 2: Data: archetypes, parts, tunes, events, specs from real cars

**Files:**
- Create: `apps/sim/src/world/data.ts`
- Test: `apps/sim/src/world/data.test.ts`
- Read: `apps/sim/src/carSpecs.ts` (`CarSpec`, `getCarSpec`)

**Interfaces:**
- Consumes: `VehicleSpec`, `PerfCfg`, `Tune` from Task 1; `CarSpec`, `getCarSpec` from `carSpecs.ts`.
- Produces:
  - `type BodyStyle = 'sedan' | 'coupe' | 'sports' | 'hatchback' | 'suv' | 'van' | 'truck'`
  - `ARCHETYPES: Record<BodyStyle, VehicleSpec>`: `hatchback` = Night Tuner's civet, `coupe` = ronin, `sedan` = tsubasa, `sports` = kanjo's torque shape on ronin's chassis with redline 8100, `truck` = brute with mass 2300, h .62, cd .42, area 2.9, `suv` = brute's curve ×0.85 with mass 2000, h .58, cd .38, area 2.7, AWD, `van` = tsubasa's curve with mass 1900, h .6, cd .36, area 2.8, FWD.
  - `specFor(car: { make?: string; model?: string; bodyStyle?: string }): VehicleSpec`: the body-style archetype with its torque table scaled so `simStats(...).hp` lands within 10% of `getCarSpec(car).hp`, mass = `weightLb × 0.4536`, drive from the spec (`'4WD'` → `'AWD'`). Unknown make/model → the archetype's own numbers.
  - `type VisualCfg = { color: string; finish: 'gloss'|'metallic'|'pearl'|'candy'|'matte'; rim: 'stock'|'spoke5'|'mesh'|'dish'|'fan'|'split'; rimSize: 17|18|19|20; rimColor: string; front: 0|1|2|3; rear: 0|1|2; skirts: 0|1|2; spoiler: 0|1|2|3|4; hood: 0|1|2|3; roof: 0|1; vinyl: 0|1|2|3|4; vinylColor: string; tint: 0|1|2|3; neon: string; lights: string; hydraulics: 0|1 }`
  - `type CarCfg = VisualCfg & { perf: PerfCfg }`, `STOCK_CFG: CarCfg`, `TUNE_DEF: Tune`
  - `CATS`, `PERF`, `TIER`, `TIER_STAGE`, `TUNES`, `PALETTE` copied from Night Tuner, with prices in dollars unchanged.
  - `STAGE_REP = [0, 400, 1100, 2200, 3800]`, `stageOf(rep: number): number`
  - `visualRating(cfg: VisualCfg): number`, `getV(cfg, key)`, `withV(cfg, key, v)`, `okey(key, v)`, `isOwned(cfg, owned: string[], key, v)`
  - `EVENTS` (Night Tuner's 11 events, same nodes, prizes in dollars), `EV_NAME`, `EV_COL` (colours from the brand: sprint `#ffd23f`, circuit `#5fbf86`, streetx `#f3f6fb`, drag `#e0b22a`, drift `#79a6ff`, outrun `#ffffff`)
  - `type StripRecord = { rep: number; cars: Record<string, { cfg: CarCfg; tune: Tune; owned: string[] }>; wins: Record<string, number>; best: Record<string, number> }`, `freshStrip(): StripRecord`, `carState(rec: StripRecord, carId: string)` (creates the entry on first use)
  - `prizeFor(ev, pos: number, stage: number, style: number, failed: boolean): { cash: number; rep: number; styleBonus: number; octane: number }`: Night Tuner's table (1st: prize × (1 + .25 (stage−1)), full rep; 2nd ×.4 / half rep; 3rd ×.2 / quarter rep; else 0; style bonus 5% × style on a win; `octane` = 25 × rep / 100 rounded, 0 when not placed).

- [ ] **Step 1: Write the failing tests** `data.test.ts`:

```ts
it('every archetype drives plausibly', () => { for (const s of Object.values(ARCHETYPES)) { const st = simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)); expect(st.t100).toBeGreaterThan(3); expect(st.t100).toBeLessThan(14); expect(st.top).toBeGreaterThan(150); expect(st.top).toBeLessThan(330); } });
it('specFor scales a known car to its horsepower', () => { const s = specFor({ make: 'Ford', model: 'Mustang', bodyStyle: 'coupe' }); const st = simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF)); expect(Math.abs(st.hp - 460) / 460).toBeLessThan(0.1); expect(s.drive).toBe('RWD'); expect(s.mass).toBeCloseTo(3800 * 0.4536, 0); });
it('specFor falls back to the archetype for an unknown car', () => { expect(specFor({ make: 'Zork', model: 'Blat', bodyStyle: 'van' }).id).toBe('van'); expect(() => specFor({})).not.toThrow(); });
it('stages', () => { expect(stageOf(0)).toBe(1); expect(stageOf(400)).toBe(2); expect(stageOf(3800)).toBe(5); });
it('prizes', () => { const ev = EVENTS[0]; expect(prizeFor(ev, 1, 1, 0, false)).toEqual({ cash: 1500, rep: 150, styleBonus: 0, octane: 38 }); expect(prizeFor(ev, 2, 3, 0, false).cash).toBe(Math.round(1500 * 1.5 * 0.4)); expect(prizeFor(ev, 1, 1, 10, false).styleBonus).toBe(750); expect(prizeFor(ev, 1, 1, 10, true).cash).toBe(0); expect(prizeFor(ev, 4, 1, 0, false).octane).toBe(0); });
it('visual rating caps at 10 and is 0 for stock', () => { expect(visualRating(STOCK_CFG)).toBe(0); expect(visualRating({ ...STOCK_CFG, spoiler: 4, rim: 'split', front: 3, vinyl: 4, hydraulics: 1, neon: '#22e5ff', finish: 'candy', hood: 3, rear: 2, skirts: 2, rimSize: 20, tint: 3, roof: 1 })).toBeLessThanOrEqual(10); });
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** by porting `03-data.js` (minus the save, which becomes `StripRecord`) and adding `ARCHETYPES`, `specFor` and `prizeFor` with the values above. For `specFor`, scale the table by a factor found with a 12-step bisection on `simStats(...).hp`.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit** — `git commit -m "world: archetypes, parts catalog, tunes, events, specs from real cars"`

---

### Task 3: The Strip's grid and routes (pure)

**Files:**
- Create: `apps/sim/src/world/strip/routes.ts`
- Test: `apps/sim/src/world/strip/routes.test.ts`

**Interfaces:**
- Produces: `N = 8`, `CELL = 90`, `RW = 20`, `BL = CELL - RW`, `SPAN = N * CELL` (metres); `type Node = [number, number]`; `type Route = { pts: [number, number][]; cum: number[]; len: number; loop: boolean; nodes: Node[]; nodeS: number[] }`; `buildRoute(nodes: Node[], loop: boolean): Route`; `routePoint(route: Route, s: number): { x: number; z: number; tx: number; tz: number }`; `routeProgress(route: Route, x: number, z: number, sGuess: number, span?: number): { s: number; d: number }`; `blockRect(i: number, j: number): [number, number, number, number] | null`; `nearestNode(x: number, z: number): Node`; `nodeNeighbors(i: number, j: number): Node[]`; `gridPath(a: Node, b: Node): Node[]`; `snapToRoad(V: Vehicle): void`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('a 3x3-cell square loop is about 4 sides long with cut corners', () => { const r = buildRoute([[2,2],[2,5],[5,5],[5,2]], true); expect(r.len).toBeGreaterThan(4 * 270 - 60); expect(r.len).toBeLessThan(4 * 270); expect(r.nodeS[0]).toBe(0); expect(r.nodeS[1]).toBeGreaterThan(250); });
it('routePoint wraps on a loop and clamps on a sprint', () => { const loop = buildRoute([[2,2],[2,5],[5,5],[5,2]], true), sp = buildRoute([[0,4],[5,4]], false); const p = routePoint(loop, loop.len + 5), q = routePoint(loop, 5); expect(p.x).toBeCloseTo(q.x, 3); expect(routePoint(sp, 1e6).x).toBeCloseTo(sp.pts[sp.pts.length - 1][0], 3); });
it('routeProgress finds the nearest point near the guess', () => { const r = buildRoute([[0,4],[5,4]], false); const p = routePoint(r, 123); expect(routeProgress(r, p.x + 1, p.z - 1, 100).s).toBeCloseTo(123, 0); });
it('gridPath walks the grid', () => { const p = gridPath([0,0],[2,1]); expect(p[0]).toEqual([0,0]); expect(p[p.length-1]).toEqual([2,1]); expect(p.length).toBe(4); });
it('blockRect is null outside the border ring', () => { expect(blockRect(-2, 0)).toBeNull(); expect(blockRect(0, 0)).toEqual([10, 10, 80, 80]); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Port** the route and grid functions from `05-world.js` (lines `const N=8…` through `routeProgress`, plus `snapToRoad` from the collisions block). — [ ] **Step 4: Run to verify they pass.** — [ ] **Step 5: Commit** `"world/strip: grid, routes and GPS paths"`.

---

### Task 4: AI drivers and collisions (pure, mesh-free)

**Files:**
- Create: `apps/sim/src/world/strip/ai.ts`
- Test: `apps/sim/src/world/strip/ai.test.ts`

**Interfaces:**
- Consumes: Task 3's routes; Task 1's `Vehicle`, `syncBody`.
- Produces: `type AI = { x, z, h, v, s, lane, route: Route | null, path: Node[] | null, vmax, acc, brk, stun, nm, laps, done, ft: number | null, kind: 'traffic'|'rival'|'racer', name, wander, score, hold, parked, steer, cool: number, m?: unknown, tag?: unknown }`; `makeAI(opts: Partial<AI>): AI`; `wanderPath(path: Node[], len: number): Node[]`; `setWander(A: AI, start: Node): void`; `parkAI(A: AI): void`; `stepAI(A: AI, dt: number, playerS: number | null, stage: number): void`; `separateAIs(list: AI[]): void`; `collideBlocks(V: Vehicle): number`; `collideCar(V: Vehicle, A: AI): number`.
- The mesh (`m`) and tag are opaque handles; `drawAI` (which touches three.js) lives in Task 7, not here.

- [ ] **Step 1: Write the failing tests:**

```ts
it('a wandering AI advances along its route', () => { const A = makeAI({ vmax: 12, acc: 5, brk: 8, kind: 'traffic', lane: 3.2 }); setWander(A, [2,2]); const s0 = A.s; for (let i = 0; i < 60 * 5; i++) stepAI(A, 1/60, null, 1); expect(A.s).toBeGreaterThan(s0 + 20); expect(Math.abs(A.v)).toBeGreaterThan(5); });
it('separateAIs pushes two overlapping cars apart', () => { const a = makeAI({ x: 0, z: 0 }), b = makeAI({ x: 1, z: 0 }); separateAIs([a, b]); expect(b.x - a.x).toBeGreaterThan(3.7); });
it('collideBlocks pushes a car out of a building and slows it', () => { const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(V, 45, 45, 0); V.vx = 0; V.vz = 10; V.u = 10; const hit = collideBlocks(V); expect(hit).toBeGreaterThan(0); expect(blockRect(0,0)).not.toBeNull(); const R = blockRect(0,0)!; expect(V.x < R[0] || V.x > R[2] || V.z < R[1] || V.z > R[3]).toBe(true); });
it('collideCar stuns the AI and bounces the player', () => { const V = makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(V, 0, 0, 0); V.vz = 15; V.u = 15; const A = makeAI({ x: 0, z: 2.5, h: 0, v: 0 }); const imp = collideCar(V, A); expect(imp).toBeGreaterThan(0); expect(A.stun).toBeGreaterThan(0); expect(V.vz).toBeLessThan(15); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Port** `makeAI`…`separateAIs` and `collideBlocks`/`collideCar` from `05-world.js`; `stepAI` takes `stage` as a parameter instead of reading a global. — [ ] **Step 4: Run to verify they pass.** — [ ] **Step 5: Commit** `"world/strip: AI drivers and collisions"`.

---

### Task 5: Events (pure state machine with injected effects)

**Files:**
- Create: `apps/sim/src/world/strip/events.ts`
- Test: `apps/sim/src/world/strip/events.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `type EventFx = { banner(txt: string, bad?: boolean, hold?: boolean): void; sfx(name: string): void; spawnRacerMesh(cfg: VisualCfg): unknown; disposeMesh(m: unknown): void; placeCp(node: Node | null): void; stage(): number; styleRating(): number }`
  - `class EventRunner { constructor(PV: Vehicle, ais: AI[], fx: EventFx, playerParams: () => Params); active: ActiveEvent | null; start(ev: EventDef, opts?: { quick?: boolean }): void; input(I: Input, dt: number): Input; postStep(dt: number): void; update(dt: number): void; dragLane(dir: -1|1): void; standings(): Standing[]; cleanup(): void; quit(): void; results(): { pos: number; list: Standing[]; failed: string | null; type: EventType; ev: EventDef; time: number | null; score: number } | null }`
  - `type Standing = { name: string; me?: boolean; ft?: number | null; s?: number; score?: number; estimated?: boolean }`
  - `nearEvent(PV, markers: { ev: EventDef; x: number; z: number }[], stage: number): EventDef | null`, `nearRival(PV, ais: AI[]): AI | null`
  - Outrun: `startOutrun(A: AI, playerTopMs: number, playerAccel: number, stage: number): Outrun`, `updateOutrun(o: Outrun, PV, dt): 'run' | 'won' | 'lost' | 'done'`

- [ ] **Step 1: Write the failing tests** (a `fx` stub records banners; a no-op mesh):

```ts
it('a sprint counts down, then races, then finishes when the player passes the last node', () => { const r = runner(sprint); r.start(sprint); expect(r.active!.state).toBe('count'); tick(r, 4); expect(r.active!.state).toBe('race'); teleportToEnd(r); tick(r, 0.5); expect(r.active!.state).toBe('done'); const res = r.results()!; expect(res.pos).toBeGreaterThanOrEqual(1); expect(res.failed).toBeNull(); });
it('standings put a DNF last and sort finishers by time', () => { const list = [{ name: 'a', ft: 30 }, { name: 'You', me: true, ft: 25 }, { name: 'b', ft: null, s: 100 }]; expect(sortStandings(list, 'sprint').map(p => p.name)).toEqual(['You', 'a', 'b']); });
it('drift sorts by score', () => { expect(sortStandings([{ name: 'a', score: 10 }, { name: 'You', me: true, score: 40 }], 'drift')[0].name).toBe('You'); });
it('a blown engine fails a drag race', () => { const r = runner(drag); r.start(drag); tick(r, 4); r.PV.overRev = 2; r.update(1/60); expect(r.active!.fail).toBe('Engine blown'); expect(r.results()!.failed).toBe('Engine blown'); });
it('cleanup removes racers from the AI list and restores traffic', () => { const r = runner(circuit); r.start(circuit); const n = r.ais.length; r.cleanup(); expect(r.active).toBeNull(); expect(r.ais.length).toBeLessThan(n); expect(r.ais.every(a => !a.parked)).toBe(true); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Port** `06-events.js` into the class: every `$('#…')`, `sfx`, `banner`, `city.add`, `buildCar`, `stage()` and `visualRating` call goes through `fx`; `showResults` becomes `results()` (no DOM, no payout: the payout is Task 11's); export `sortStandings(list, type)`. — [ ] **Step 4: Run to verify they pass.** — [ ] **Step 5: Commit** `"world/strip: events as a pure runner"`.

---

### Task 6: Parts on the lofted bodies

**Files:**
- Create: `apps/sim/src/world/parts.ts`
- Test: `apps/sim/src/world/parts.test.ts`
- Read: `apps/sim/src/scene/car/carStyles.ts` (`BodySpec` per style: `noseZ`, `tailZ`, `hw`, `wheelR`, `wheelX`, `axles`, `shoulder`, `gh.roof`), `apps/sim/src/scene/carModel.ts` (`buildCarModel` returns `{ group, body, wheels, frontPivots, ... }`).

**Interfaces:**
- Produces:
  - `type Anchors = { noseZ: number; tailZ: number; hw: number; hoodY: number; roofY: number; roofZ: number; sillY: number; wheelR: number; wheelX: number; axles: [number, number]; scale: number }` in world units, facing −Z.
  - `anchorsFor(style: BodyStyle): Anchors` (from the style's `BodySpec`: `hoodY` = shoulder height at `noseZ + 1.5`, `roofY` = max of `gh.roof`, `roofZ` = z of that max, `sillY` = bottom curve at 0, `scale` = `(tailZ − noseZ) / 4.4`).
  - `attachParts(car: THREE.Group, cfg: VisualCfg, style: BodyStyle, perfBrakes: number): { neonLight: THREE.PointLight | null; glows: THREE.Sprite[]; mats: THREE.Material[] }`: adds Night Tuner's bumpers, canards, splitters, diffusers, skirts, spoilers (4), hoods (3), roof scoop, vinyls (4), underglow, hydraulic rams and the headlight/taillight glow sprites, positioned from the anchors (Night Tuner's `z` becomes `−z × scale` from the body centre, its `y` and `x` scale by `scale`; a front part sits at `noseZ`, a rear part at `tailZ`, a hood part at `hoodY`, a wing at `roofY`).
  - `replaceWheels(car: THREE.Group, cfg: VisualCfg, anchors: Anchors, perfBrakes: number): THREE.Object3D[]`: Night Tuner's rim styles (6), rim sizes and colours, tires, discs and calipers at the lofted wheel positions; returns the spin objects. The lofted model's own wheels are hidden.
  - `disposeParts(r: ReturnType<typeof attachParts>): void`

- [ ] **Step 1: Write the failing tests** (no WebGL needed: three.js geometry and groups work in node):

```ts
it('every body style has anchors inside its body', () => { for (const s of STYLES) { const a = anchorsFor(s); expect(a.noseZ).toBeLessThan(0); expect(a.tailZ).toBeGreaterThan(0); expect(a.roofY).toBeGreaterThan(a.hoodY); expect(a.hoodY).toBeGreaterThan(a.sillY); expect(a.scale).toBeGreaterThan(1.5); } });
it('a full kit stays within 0.6 world units of the body box', () => { const car = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.9, 9.6)); car.add(body); const r = attachParts(car, { ...STOCK_CFG, front: 3, rear: 2, skirts: 2, spoiler: 4, hood: 3, roof: 1, vinyl: 2, neon: '#22e5ff', hydraulics: 1 }, 'sedan', 3); const bb = new THREE.Box3().setFromObject(car); expect(bb.min.z).toBeGreaterThan(-4.8 - 0.6); expect(bb.max.z).toBeLessThan(4.8 + 0.6); expect(bb.max.y).toBeLessThan(2.9 + 1.2); expect(r.neonLight).not.toBeNull(); });
it('replaceWheels puts four wheels at the axles', () => { const car = new THREE.Group(); const a = anchorsFor('truck'); const w = replaceWheels(car, STOCK_CFG, a, 0); expect(w.length).toBe(4); const zs = w.map(o => Math.round(o.parent!.position.z * 10) / 10); expect(zs.filter(z => z === Math.round(a.axles[0] * 10) / 10).length).toBe(2); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement**: port the part and wheel sections of Night Tuner's `buildCar` (the `if(!lod){…}` block and the wheel loop) with every literal coordinate replaced by an anchor expression; materials via a small `mats()` helper (paint, carbon texture, chrome, dark, head, tail) with three 0.160 colour management (`texture.colorSpace = THREE.SRGBColorSpace`). — [ ] **Step 4: Run to verify they pass.** — [ ] **Step 5: Commit** `"world: Night Tuner's parts and wheels on the lofted bodies"`.

---

### Task 7: The Strip district scene

**Files:**
- Create: `apps/sim/src/world/strip/city.ts`
- Create: `apps/sim/src/world/strip/scene.ts`
- Test: `apps/sim/src/world/strip/city.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 6; `buildCarModel` from `scene/carModel.ts` for traffic/racer bodies.
- Produces:
  - `buildCity(seed: number): { scene: THREE.Scene; markers: { ev: EventDef; x: number; z: number; ring: THREE.Mesh; beam: THREE.Mesh }[]; cpMark: THREE.Group; dispose(): void }` — Night Tuner's `buildCity` ported (buildings, parks, poles, heads, pools, dashes, markers) at `WORLD_PER_M` scale, colours from the brand (signs in paint yellow, tube blue, chrome), `BufferGeometryUtils.mergeGeometries` for the merges.
  - `class StripScene { constructor(opts: { onBanner, onSfx }); ready: boolean; load(): void; enter(PV: Vehicle, carGroup: THREE.Group): void; exit(): void; update(dt: number, live: boolean): void; runner: EventRunner; ais: AI[]; markers; gpsTarget; toggleMap(force?: boolean): void; drawMapInto(ctx: CanvasRenderingContext2D, w: number, h: number): void }` — owns the city scene, traffic (14) and rivals (3) with lofted bodies in random colours, the event runner, the checkpoint mark, `drawAI` (position ×2, wheel spin), the markers' pulse, the GPS path.
  - `spawnTraffic`, `spawnRivals` use `buildCarModel(style, color)` with a random style from `STYLES`.

- [ ] **Step 1: Write the failing test** (geometry only, no renderer): `it('buildCity places one marker per event, at the first node, in world units', () => { const c = buildCity(7); expect(c.markers.length).toBe(EVENTS.length); expect(c.markers[0].x).toBe(EVENTS[0].nodes[0][0] * CELL * WORLD_PER_M); expect(c.scene.children.length).toBeGreaterThan(10); c.dispose(); });`
- [ ] **Step 2: Run to verify it fails.** — [ ] **Step 3: Implement** the port (`05-world.js` `buildCity`, `spawnTraffic`, `spawnRivals`, `drawAI`; `09-main.js` `updateMarkers`) and the `StripScene` wrapper. — [ ] **Step 4: Run to verify it passes.** — [ ] **Step 5: Commit** `"world/strip: the night city and its scene"`.

---

### Task 8: HUD, audio, input, cameras

**Files:**
- Create: `apps/sim/src/world/hud.ts`, `apps/sim/src/world/audio.ts`, `apps/sim/src/world/input.ts`, `apps/sim/src/world/cameras.ts`
- Test: `apps/sim/src/world/input.test.ts`

**Interfaces:**
- Produces:
  - `class Hud { constructor(canvas: HTMLCanvasElement); resize(): void; draw(state: HudState): void }` with `type HudState = { PV: Vehicle; event: ActiveEvent | null; standings: Standing[]; outrun: Outrun | null; gps: { label: string; node: Node; path: Node[] } | null; markers; ais: AI[]; money: number; units: 'kmh'|'mph'; manual: boolean; small: boolean; touch: boolean; district: 'town'|'strip' }` — Night Tuner's `drawHud` with the brand colours (`#ffd23f` where it used `#38d6ff`, `#79a6ff` for the tube blue, fonts Barlow Condensed / Barlow). The minimap and GPS arrow draw only in the Strip.
  - `class Audio { resume(): void; setMute(m: boolean): void; sfx(name: string): void; engine(V: Vehicle, speed: number, on: boolean): void }` — `08-hud.js` audio section as is.
  - `class InputMap { constructor(opts: { manual: () => boolean; hydraulics: () => boolean }); attach(el: HTMLElement): void; detach(): void; build(): Input; edge: { shiftUp, shiftDn, hop }; keys: Record<string, boolean>; touch: Record<string, boolean>; setTouch(k: string, on: boolean): void; clearEdges(): void }` — keyboard (Night Tuner's `KM` map), touch buttons, gamepad.
  - `class ChaseCamera { constructor(cam: THREE.PerspectiveCamera); mode: 0|1|2; lookBack: boolean; shake: number; update(PV: Vehicle, dt: number, nosOn: boolean): void }` — `updateCamera` at `WORLD_PER_M` scale.

- [ ] **Step 1: Write the failing test** for the one pure piece: `it('builds an input from held keys and edges', () => { const im = new InputMap({ manual: () => true, hydraulics: () => false }); im.keys.fwd = true; im.keys.left = true; im.edge.shiftUp = true; const I = im.build(); expect(I.fwd).toBe(1); expect(I.steer).toBe(-1); expect(I.manual).toBe(true); expect(I.shiftUp).toBe(true); im.clearEdges(); expect(im.build().shiftUp).toBe(false); });`
- [ ] **Step 2: Run to verify it fails.** — [ ] **Step 3: Implement** the four classes by porting `08-hud.js` and the input/camera parts of `09-main.js`. — [ ] **Step 4: Run to verify it passes; `tsc --noEmit` clean.** — [ ] **Step 5: Commit** `"world: HUD, audio, input and cameras"`.

---

### Task 9: The Garage: menu model and React UI

**Files:**
- Create: `apps/sim/src/world/garage.ts` (pure menu model)
- Create: `apps/sim/src/world/GarageMenu.tsx` (React, Tailwind, brand tokens)
- Create: `apps/sim/src/world/GarageScene.ts` (turntable scene: lofted car + parts on Night Tuner's floor, ring, tubes in paint yellow, spotlights, orbit camera with drag and wheel)
- Test: `apps/sim/src/world/garage.test.ts`
- Modify: `apps/sim/src/store.ts` (add `strip: StripRecord | null`, `octane: number`, actions `setStrip`, `buyPart(carId, key, v)`, `equipPart(carId, key, v)`, `setTune(carId, tune)` that emit `strip_buy_part`, `strip_equip`, `strip_tune` and apply optimistically)

**Interfaces:**
- Consumes: Tasks 1, 2, 6.
- Produces:
  - `type MenuState = { stack: { id?: string; cat?: string; sel: number }[]; preview: { cfg: CarCfg; tune: Tune } | null }`
  - `class GarageModel { constructor(ctx: { money: () => number; stage: () => number; car: () => { id: string; spec: VehicleSpec; state: { cfg: CarCfg; tune: Tune; owned: string[] } }; cars: () => { id: string; name: string }[]; buy: (key: string, v: unknown, price: number) => void; equip: (key: string, v: unknown) => void; tune: (t: Tune) => void; toast: (t: string, bad?: boolean) => void; sfx: (n: string) => void }); rows(): Row[]; kind(): 'menu'|'cat'|'dyno'|'cars'|'options'|'quick'; title(): string; crumb(): string; desc(): string; select(i: number): void; enter(): void; back(): void; adjust(dir: -1|1): void; activate(): 'drive' | 'quick:' + string | void; previewParams(): Params; currentParams(): Params; statRows(P: Params): StatRow[] }` — Night Tuner's `MENU`, `rows`, `renderMenu` (as data), `onSel`, `enter`, `back`, `adjust`, `activate`, `statRows`, `renderStats` (as data), `drawDyno(canvas, Pn, Pp)` exported separately. "Car lot" becomes `cars` listing the player's inventory (no buying here; the Dealership sells cars). "Reset progress" is removed.
  - `GarageMenu` React component: left column menu list (skewed items, selected in paint yellow on night), right stat panel with 12-segment bars (up/down diff), dyno canvas, header with money, REP, stage and style stars; keyboard and pointer handling as Night Tuner; renders in the sim's `App.tsx` when `activeApp === 'garage'`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('buying a part you cannot afford refuses and changes nothing', () => { const g = model({ money: 100 }); g.enterPath(['visual', 'g_body', 'spoiler']); g.select(4); const before = JSON.stringify(g.car()); g.activate(); expect(g.toasts.at(-1)!.bad).toBe(true); expect(JSON.stringify(g.car())).toBe(before); expect(g.bought).toEqual([]); });
it('buying a part you can afford calls buy with its price and equips it', () => { const g = model({ money: 10000 }); g.enterPath(['visual', 'g_body', 'spoiler']); g.select(1); g.activate(); expect(g.bought).toEqual([['spoiler', 1, 900]]); });
it('a stage-locked performance tier refuses', () => { const g = model({ money: 1e6, stage: 1 }); g.enterPath(['perf', 'perf.turbo']); g.select(3); g.activate(); expect(g.bought).toEqual([]); expect(g.toasts.at(-1)!.text).toMatch(/stage 3/i); });
it('dyno adjust moves a slider by 0.1 within -1..1 and saves on back', () => { const g = model({}); g.enterPath(['perf', 'dyno']); g.select(2); for (let i = 0; i < 30; i++) g.adjust(1); expect(g.previewTune().aero).toBe(1); g.back(); expect(g.tuned.at(-1)!.aero).toBe(1); });
it('stat rows have five bars between 0 and 1', () => { const g = model({}); const rows = g.statRows(g.currentParams()); expect(rows.length).toBe(5); for (const r of rows) { expect(r.v).toBeGreaterThanOrEqual(0); expect(r.v).toBeLessThanOrEqual(1); } });
```

(`model()` is a test helper that builds a `GarageModel` over an in-memory car state and records `bought`, `tuned`, `toasts`; `enterPath` walks menu ids.)

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement** `garage.ts` by porting `07-garage.js`'s menu logic into the class; then `GarageScene.ts` (the turntable, cameras `CAMS` at ×2) and `GarageMenu.tsx`; wire `store.ts`. — [ ] **Step 4: Run to verify they pass; `tsc --noEmit` clean.** — [ ] **Step 5: Commit** `"world: the Garage, Night Tuner's menus on the lofted car"`.

---

### Task 10: One driving model in the town, and the gate

**Files:**
- Modify: `apps/sim/src/VanillaThreeScene.tsx` (the block from `// Custom Realistic Driving Physics Engine` at ~1136 to the end of the player update; the `sync_car_pos` emit at ~1253; the speedway import at line 17 and its use at ~114; the item/race code at ~1290–1340; the exit handler at ~795)
- Create: `apps/sim/src/world/driver.ts`
- Delete: `apps/sim/src/scene/world/speedway.ts` (replace with `gate.ts`)
- Create: `apps/sim/src/scene/world/gate.ts`
- Test: `apps/sim/src/world/driver.test.ts`
- Read: `apps/sim/src/carSpecs.ts` (`driveTuning` is retired after this task; keep `getCarSpec`)

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 6, 7, 8.
- Produces:
  - `class Driver { constructor(spec: VehicleSpec, state: { cfg: CarCfg; tune: Tune }, start: { x: number; z: number; h: number }); V: Vehicle; stepFrame(dtFrame: number, input: Input, opts: { drift: boolean; fuel: () => number; burn: (f: number) => void; collide: (V: Vehicle) => number }): { impact: number; steps: number }; pose(): { x: number; y: number; z: number; rotY: number } (world units, −Z heading convention); rebuild(spec, state): void }` — the 120 Hz accumulator (`dt` clamped to 0.05, at most 6 sub-steps), the fuel burn from the Global Constraints, the `thr = 0` at empty.
  - `townCollider(colliders: THREE.Box3[]): (V: Vehicle) => number` — axis-aligned boxes from the town's existing lot fences and building boxes (world units ÷ 2), same response as `collideBlocks`.
  - `gate.ts`: `buildGate(ctx: WorldContext): { isOnGate(x: number, z: number): boolean; sign: THREE.Object3D }` — the Speedway's footprint becomes a lit gate: a ring on the ground and a sign reading "THE STRIP" in paint yellow where the SPEEDWAY sign was; driving onto the ring prompts "[Enter] THE STRIP"; `Enter` calls `enterStrip()`.
  - In `VanillaThreeScene.tsx`: `district: 'town' | 'strip'`; `enterStrip()` builds/loads the `StripScene` (Task 7), moves the player's car group into it at the Strip's spawn (`2 CELL, 2.5 CELL`, heading 0), renders the Strip scene; `exitStrip()` (Enter on the Strip's gate ring at node `[0,0]`, or the pause menu's "Back to town") calls `runner.cleanup()`, moves the car back onto the gate; the `sync_car_pos` message gains `district`; other players' cars are shown only in the same district.
  - Removed: `vehiclePhysics` records, `driveTuning`, `RACE_TIERS` use, item boxes, bananas/shells, `rent_race_car`, `enter_race`/`finish_race` client calls, the `RacingHud` race-entry panel (its fuel readout stays).

- [ ] **Step 1: Write the failing tests** `driver.test.ts`:

```ts
it('clamps a slow frame to 6 sub-steps', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); const r = d.stepFrame(0.5, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => 50, burn: () => {}, collide: () => 0 }); expect(r.steps).toBeLessThanOrEqual(6); });
it('burns fuel at full throttle and coasts when empty', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); let f = 100; for (let i = 0; i < 60 * 60; i++) d.stepFrame(1/60, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => f, burn: (b) => { f -= b; }, collide: () => 0 }); expect(f).toBeLessThan(100); expect(f).toBeGreaterThan(90); f = 0; const u0 = d.V.u; for (let i = 0; i < 60 * 5; i++) d.stepFrame(1/60, { ...NO_INPUT, fwd: 1 }, { drift: false, fuel: () => f, burn: () => {}, collide: () => 0 }); expect(d.V.u).toBeLessThan(u0); });
it('a town box collider stops a 20 m/s car without launching it', () => { const col = townCollider([new THREE.Box3(new THREE.Vector3(-10, 0, 20), new THREE.Vector3(10, 10, 40))]); const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 0, z: 0, h: 0 }); d.V.u = 20; d.V.vz = 20; for (let i = 0; i < 120; i++) d.stepFrame(1/60, NO_INPUT, { drift: false, fuel: () => 50, burn: () => {}, collide: col }); expect(Math.abs(d.V.u)).toBeLessThan(6); expect(d.V.z * 2).toBeLessThan(20.5); });
it('pose converts to world units facing -Z', () => { const d = new Driver(ARCHETYPES.sedan, { cfg: STOCK_CFG, tune: TUNE_DEF }, { x: 3, z: 4, h: 0 }); expect(d.pose()).toEqual({ x: 6, y: 0, z: 8, rotY: Math.PI }); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement** `driver.ts`, `gate.ts`, and the `VanillaThreeScene.tsx` surgery: the driven car's mesh follows `driver.pose()`; `syncCarWheels`/`frontPivots` take `V.delta` and `V.u`; brake lights from `V.brk`; the Strip entry/exit; the HUD canvas (Task 8) overlaid while driving. — [ ] **Step 4: Run tests; `tsc --noEmit`; `vite build`; start with `NODE_ENV=production` and drive in the town and into the Strip by hand (or Playwright with swiftshader) to confirm no console errors.** — [ ] **Step 5: Commit** `"world: one driving model in the town; the Speedway is the gate to the Strip"`.

---

### Task 11: Server: events, parts, the Strip record, Octane

**Files:**
- Modify: `apps/sim/server.ts` (remove `enter_race`, `finish_race`, `rent_race_car`, item-box handlers and `activeRaces`; add the handlers below; add `strip` and `octane` to the player record and to `sanitize`/persistence paths)
- Modify: `apps/sim/src/types.ts` (remove `RACE_TIERS`, `RaceDifficulty`, `isRental`; add `strip?: StripRecord; octane: number; stamps: string[]` to `Player`)
- Create: `apps/sim/src/world/payout.ts` (pure; imported by the server and the client)
- Test: `apps/sim/src/world/payout.test.ts`

**Interfaces:**
- Produces:
  - `validateFinish(entry: { eventId: string; startedAt: number } | undefined, msg: { eventId: string; pos: number; time: number | null; score: number; failed: boolean }, now: number): { ok: true; pos: number } | { ok: false; reason: string }` — refuses without a live entry, a mismatched event, a `pos` outside 1–4, a finish faster than `route.len / 90` seconds (nobody averages 90 m/s), or an entry older than 20 minutes.
  - `applyPayout(player: Player, ev: EventDef, pos: number, failed: boolean): { cash: number; octane: number; rep: number; stamps: string[] }` — `prizeFor` from Task 2 plus stamps: `strip:first-win` on the first win ever, `strip:drag` on a drag win, `strip:drift` on a drift win, `strip:outrun`; adds to `money`, `octane`, `strip.rep`, `strip.wins`, `strip.best`.
  - Socket messages: `enter_event { eventId }` → records `activeEvents.set(socket.id, { eventId, startedAt })`; `finish_event { eventId, pos, time, score, failed }` → `validateFinish` then `applyPayout`, emits `event_result { cash, octane, rep, stamps }`; `finish_outrun { won }` → `applyPayout` with a synthetic outrun event (prize `800 + 250 × (stage − 1)`, rep 60); `strip_buy_part { carId, key, v, price }` → checks `money >= price` and that `price` matches the catalog, deducts, pushes `okey` to `owned`, equips; `strip_equip { carId, key, v }` → only if owned or free; `strip_tune { carId, tune }` → clamps each slider to −1..1 in 0.1 steps; `sync_car_pos` → stores `district`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('refuses a finish without a live entry or with the wrong event', () => { expect(validateFinish(undefined, finish('sp1', 1, 60), 0).ok).toBe(false); expect(validateFinish({ eventId: 'ci1', startedAt: 0 }, finish('sp1', 1, 60), 1000).ok).toBe(false); });
it('refuses an impossible time and a stale entry', () => { expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 1, 2), 5000).ok).toBe(false); expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 1, 60), 21 * 60 * 1000).ok).toBe(false); });
it('accepts a plausible finish', () => { expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 2, 70), 80000)).toEqual({ ok: true, pos: 2 }); });
it('pays a first win with cash, octane, rep and the first-win stamp', () => { const p = player(); const r = applyPayout(p, EVENTS[0], 1, false); expect(r.cash).toBe(1500); expect(p.money).toBe(1500); expect(p.octane).toBe(38); expect(p.strip!.rep).toBe(150); expect(p.stamps).toContain('strip:first-win'); expect(applyPayout(p, EVENTS[0], 1, false).stamps).not.toContain('strip:first-win'); });
it('a failed run pays nothing', () => { const p = player(); applyPayout(p, EVENTS[3], 1, true); expect(p.money).toBe(0); expect(p.octane).toBe(0); });
```

- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement** `payout.ts`, the server handlers, the type changes; remove the old race code; the client's `EventRunner.results()` → `socket.emit('finish_event', …)` in `VanillaThreeScene.tsx`, results screen shows `event_result`. — [ ] **Step 4: Run tests; `tsc --noEmit`; build; start in production; run a drag race end to end and confirm `event_result` arrives and `money` changes.** — [ ] **Step 5: Commit** `"world: the server pays events in dollars and credits Octane and stamps; parts and tunes are server-side"`.

---

### Task 12: Identity, the strip's doors, docs, smoke test, deploy

**Files:**
- Modify: `packages/brand/src/doors.ts` (remove nothing; `Garage` stays "soon" until phase 1), `apps/value/src/door/Door.tsx` (footer: drop the Tuner link; "The Strip" copy: "Race the car you tuned: sprint, circuit, street X, drag, drift, outrun. Prizes in dollars, Octane and stamps on the card, never the grade."), `apps/value/src/i18n-es.ts` (the Spanish for that line), `apps/sim/src/i18n.tsx` (`setup.placeStripDesc`: "Six kinds of race in the night city behind the Speedway gate. Playable today."), `apps/sim/src/App.tsx` (the Dealership guide's "race at the Speedway" lines → "take the gate to the Strip"), `README.md` (the doors table: World row mentions the Strip; Tuner row: "absorbed into the Garage"), `docs/micar-central-page-plan.md` (status), `tools/build-site.sh` (stop copying the tuner; `site/tuner/index.html` becomes a redirect to the world, hash dropped)
- Create: `apps/sim/e2e/strip.smoke.mjs` (Playwright, swiftshader flags, run by hand and in CI as `pnpm --filter @micar/sim exec node e2e/strip.smoke.mjs` after `pnpm --filter @micar/sim start` in the background)

**Interfaces:** none new.

- [ ] **Step 1: Write the smoke script**: start at `/`, enter a name, Enter; wait for the world; press W for 3 s and assert the car's pose changed (via `window.__micar.pose()` exposed by Task 10); teleport to the gate (`window.__micar.enterStrip()`); assert the Strip scene is active; start `dr1` (`window.__micar.startEvent('dr1')`); hold W with Shift at the redline for 25 s; assert a results overlay appears with "You" in it; open the garage (`activeApp = 'garage'`) and assert the stat panel has 5 bars.
- [ ] **Step 2: Run it against the production build locally** — passes with no page errors.
- [ ] **Step 3: Apply the copy, README, plan and site-builder changes; run `pnpm --filter @micar/value test` (102 + the Spanish line) and `pnpm site`.**
- [ ] **Step 4: Commit and push** — `git commit -m "world: the Strip is live; copy, docs and site"`; Pages and Render deploy from `main`.
- [ ] **Step 5: Verify live**: open the world on a phone and a desktop, drive into the Strip, run a drag race; open the door's world section and confirm the copy.
