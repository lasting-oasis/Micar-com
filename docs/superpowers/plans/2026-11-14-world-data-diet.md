# World Data Diet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, yourself, in your own session (trial rules, rule 3: the boss is the reviewer, so no reviewer subagent per task). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MiCar World sends each player far less data: positions by interest and in short messages, and patches instead of full copies of the state, with nothing changing on screen except that far-away players update less often.

**Architecture:** Two pure modules carry the rules and are unit-tested on their own: `netPositions.ts` (the position format, districts and the per-player timing) and `stateSync.ts` (what each player may see, what changed since it was last sent, and how the page applies a patch). `server.ts` wires them in for connections that join with `proto: 2`, and keeps today's messages for any other connection. `store.ts` sends `proto: 2` and applies `pos` and `patch`.

**Tech Stack:** TypeScript, Node 22, Express + socket.io 4.8 (server), socket.io-client 4.8 + zustand (page), vitest 2.

**Spec:** `docs/superpowers/specs/2026-11-14-world-data-diet-design.md`

**Order:** the two pure modules first (Tasks 2 and 3), then one task that brings the World and the page onto both (Task 4), then the measurement and the pull request (Task 5). (An earlier draft wired positions and patches in two separate tasks; they touch the same lines of `server.ts` and `store.ts`, so they are one task, checked in two browsers once.) Each task's checks run on a separate checkout of exactly that task's commit.

**Two pull requests** (worker D's call at Task 4): the boss reviews a branch's whole diff against `origin/main` and takes at most 200 KB, and the documents and code together came to 205 KB. So, as this repo's plan pull requests already are, the design, this plan and the measurements go in a documents-only pull request from `lane-d/data-diet-plan`, and the code (with `e2e/data.ts` and the smoke) in one from `lane-d/data-diet`, rebuilt from `origin/main` as one commit per task. The commits before the split stay on the local branch `lane-d/data-diet-combined`, never pushed.

## Global Constraints

- Node 22 through fnm: `fnm exec --using=22 -- corepack.cmd pnpm ...` (plain `corepack` is not found inside `fnm exec`).
- No new dependencies, no version changes, no lockfile changes (`pnpm-lock.yaml` unchanged).
- Nothing new on screen and no new visitor strings. The only visible change allowed: far-away players update less often.
- Leave alone: race messages and race code (`race.ts`, `raceNet.ts`, `race_*` handlers, `syncRoom`, `leaveRace`); `render.yaml`, `/healthz`, persistence, the load test; `apps/value/src/api`, `seo/api.ts`, `seo/pages.ts`, `valueRoute.ts`. In `server.ts` do not touch the imports under `persistence.js`, `/api/caps`, `ROOM_GAP_MS` or `createRoom` lines (lane A's).
- Anything worker D starts (a World, a test World, a preview) listens on a port from 3300 to 3399.
- Constants from the spec, verbatim: tick 100 ms; the 20 nearest within 200 m every tick; within 400 m every 500 ms; the rest of the district every second; other districts every 5 seconds; district changes, stops (300 ms after the last move) and first contact sent at once and reliably; districts are the town and the 8 km grid squares of the Strip (the hub is the centre square); x and z in tenths of a world unit, y in hundredths, heading in hundredths of a radian wrapped to (−π, π]; 2 world units per metre (`WORLD_PER_M`). What a page reports about itself (its position, its cars' fuel and town spot) does not count as a change to a record.
- Checks for every task, from `apps/sim`: `fnm exec --using=22 -- corepack.cmd pnpm exec vitest run` and `fnm exec --using=22 -- corepack.cmd pnpm exec tsc --noEmit`, plus `vite build` for tasks that touch the page. Their full output goes in `.boss/tests.txt`.
- The boss after every task (`bash ~/.micar-boss/ask.sh`, default effort). `.boss/` is never committed.

## Review Focus

1. **A refused purchase the page already showed** (`strip_buy_part` refused): the page must end with the server's money and parts, as today. Test in Task 4.
2. **A player who leaves, or re-joins on the same socket** (guest to account): no ghost in anyone's state or positions, and the re-joined player's page starts from a full copy. Tests in Task 4.
3. **A moving update that was dropped** (a phone's backed-up connection): the stopped player's last position still arrives, reliably. Test in Task 2.
4. **A tab opened before the deploy** (joins without `proto: 2`): it still gets `update` and `player_positions`, as today. Tests in Task 4.
5. **Everyone else driving while someone acts** (fuel and positions drifting in every record): a patch carries only what the page uses that changed. Tests in Tasks 3 and 4.

---

### Task 1: Measure first

**Files:**
- Create: `apps/sim/e2e/data.ts`
- Create: `docs/superpowers/specs/2026-11-14-world-data-diet-design.md`, `docs/superpowers/plans/2026-11-14-world-data-diet.md`, `docs/superpowers/specs/2026-11-14-world-data-diet-data/` (the measurements)

**Interfaces:**
- Produces: `node node_modules/tsx/dist/cli.mjs e2e/data.ts [--online 10,25,50,100] [--layout one,spread] [--mode drive,play] [--seconds 20] [--out file.json]` from `apps/sim`; a markdown table on stdout; a `decoders` table (event name → decoder of `(id, x, z)` fixes) that Task 4 extends. The smoothness bucket is the ten nearest **within 200 m**; `spread` gathers each district's players within 150 m of its meeting point; `play` adds a rental, fuel every 1.5 s and one refused tune every 30 s per player.
- Produces: `C:\Users\Owner\Micar-com-data-before`, a detached worktree at `origin/main` where the "before" rows run with the branch's `data.ts` copied in (Task 5 runs it again there).

- [ ] **Step 1:** Run it with `--online 5 --mode drive,play --layout one,spread --seconds 5`. Expected: four rows; about 9.5 KB/s each driving and more in play (full copies after each refused action); a near update gap of about 105 ms; the World stopped and its temp folder gone.
- [ ] **Step 2:** Run the full baseline in the `origin/main` worktree: `--mode drive --online 10,25,50,100 --layout one,spread` and `--mode play --online 10,25,50,100 --layout one`, 20 s each, `--out` into `docs/superpowers/specs/2026-11-14-world-data-diet-data/`. Expected: driving within about 15% of the platform design's 20 / 49 / 98 / 196 KB/s and 320 MB for 100 joins. Put the tables in the spec.
- [ ] **Step 3:** Commit the program, the spec, this plan and the measurements; boss review.

### Task 2: Position format, districts and timing

**Files:**
- Create: `apps/sim/src/world/netPositions.ts`
- Test: `apps/sim/src/world/netPositions.test.ts`

**Interfaces:**
- Produces, from `netPositions.ts`:
  - `type NetPos = { x: number; y?: number; z: number; rotation?: number; district?: 'town' | 'strip'; stripPosition?: { x: number; y?: number; z: number; rotation?: number } }`: the object the page keeps per player today.
  - `relayed(world: NetPos | undefined, strip: NetPos | undefined): NetPos | undefined`: today's `positions[pid]` (the stored position, plus `stripPosition` when the player is in the Strip and has a pose).
  - `encodeEntry(n: number, p: NetPos): number[]`: `[n * 4 + kind, ...fields]`, kinds 0 (town: x, y, z, heading), 1 (Strip pose: x, z, heading), 2 (Strip, no pose: x, y, z, heading).
  - `decodePositions(flat: unknown, idOf: (n: number) => string | undefined): Record<string, NetPos>`: kind 1 decodes to the Strip gate (`GATE_RETURN`, district `'strip'`) with the pose in `stripPosition`; malformed input is skipped, never thrown.
  - `mergePositions(kept: Record<string, NetPos>, flat: unknown, players: Record<string, { n?: number }> | undefined): Record<string, NetPos>` and `keepOnly(kept, players)`: the page's side; each returns the same object when nothing changed.
  - `districtOf(p: NetPos): string`: `'town'`, or `'strip:<i>,<j>'` for the 8 km grid square (`'strip:0,0'` is the hub).
  - `periodMs(sameDistrict: boolean, rank: number, distM: number): number`: 100 / 500 / 1000 / 5000 by the spec's table.
  - `class PositionRelay { tick(now: number, players: ReadonlyMap<string, { n: number; pos: NetPos }>, recipients: Iterable<string>): Map<string, { moving: number[]; sure: number[] }>; forget(id: string): void; forgetRecipient(id: string): void }`: per recipient, the flat entries to send volatile (`moving`) and reliably (`sure`).

- [ ] **Step 1: Write the failing tests** in `netPositions.test.ts`:
  - `round-trips the three kinds`: a town pose, a Strip pose and a Strip position with no pose decode to the objects `relayed` builds, within 0.05 units and 0.005 rad; kind 1 decodes `x`, `z` and `rotation` to `GATE_RETURN.x`, `GATE_RETURN.z`, `GATE_RETURN.rotY`.
  - `wraps headings`: `rotation: 7` decodes to `7 - 2π` (within 0.005).
  - `skips what it cannot read`: `decodePositions('x', ...)`, a truncated array and an unknown `n` give `{}` or drop only the bad entry.
  - `the page's side`: `mergePositions` updates only the players in the message, by `n`, without changing the kept object in place, and returns the kept object for a message about nobody it knows; `keepOnly` drops players who have gone and returns the same object when none has.
  - `places districts on the 8 km grid`: the hub spawn (0, 30 m) → `'strip:0,0'`; Spa's lobby (offset 8000, 0 plus its lobby) → `'strip:1,0'`; a town position → `'town'`; a Strip player without a pose → `'strip:0,0'` for the rental-bay spot.
  - `periodMs follows the table`: `(true, 0, 10)` 100; `(true, 19, 199)` 100; `(true, 20, 50)` 500; `(true, 0, 250)` 500; `(true, 0, 600)` 1000; `(false, 0, 0)` 5000.
  - `relay: first contact and stops are sure; moves are moving`: two players, a fake clock; the first tick puts each in the other's `sure`; a player moving every tick appears in the near recipient's `moving` every tick; 300 ms after it stops, its final entry is in `sure` once, and then nothing.
  - `relay: rates by distance`: a recipient with one player 100 m away, one 300 m away, one 700 m away and one in another district, all moving for 10 s of ticks: about 100, 20, 10 and 2 sends.
  - `relay: the 20 nearest at full rate`: 22 players within 100 m, all moving for ten ticks: the 20 nearest are sent every tick, the 21st and 22nd twice a second.
  - `relay: a change of district is sure at once`, to every recipient, even one whose period for that player has not run out.
  - `relay: a dropped moving update is repaired`: a player moves then stops; the recipient's `moving` copy is treated as lost; the final position still comes in `sure`.
  - `relay: no self, and forget`: a recipient never gets its own entry; after `forget(id)` nobody gets `id` and `id` gets nothing; `forgetRecipient(id)` makes the next tick send `id` everyone again, in `sure`.
  - `relay: no position yet`: `relayed(undefined, undefined)` is `undefined`; a recipient with no position of its own gets everyone's current position once, in `sure`, and then other players at the 5-second rate until it has one.
- [ ] **Step 2:** Run `pnpm exec vitest run src/world/netPositions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `netPositions.ts`.** The relay keeps, per (recipient, player), the version, time, district and reliability of the last send; each tick it encodes every player once, bumps a player's version when its entry changes, ranks the recipient's district by distance, and sends by the rules above. Positions are in world units; distances compare in metres (`WORLD_PER_M`).
- [ ] **Step 4:** Run the test file. Expected: PASS. Then the lane checks.
- [ ] **Step 5:** Commit (`git add apps/sim/src/world/netPositions*.ts`); boss review.

### Task 3: State patches

**Files:**
- Create: `apps/sim/src/world/stateSync.ts`
- Test: `apps/sim/src/world/stateSync.test.ts`

**Interfaces:**
- Produces, from `stateSync.ts`:
  - `type StatePatch = { players?: Record<string, Player>; gone?: string[]; shared?: Record<string, unknown>; unset?: string[] }`.
  - `type ViewState = Omit<GameState, 'accounts' | 'chatLog'>`.
  - `ownView(p: Player, n?: number): Player` and `othersView(p: Player, n?: number): Player`: the second is exactly today's `broadcastState` redaction (money 0; contracts, customers, orders and share holdings emptied; balance sheet zeroed; floor-plan debt 0; gate code, account id and tester flag removed; each car's `buyPrice` and `recon` 0), plus `n`.
  - `steadyPart(view: Player): unknown`: a record without what its page reports about itself (its `worldPosition`, its cars' `fuel` and `lotPosition`): what the change test compares, for other pages and its own alike (the spec, section 4, with the page's reads cited). The record itself always goes whole and current.
  - `viewFor(state: GameState, viewerId: string, nOf): ViewState`: the whole view for one page, without remembering anything (the tests' reference).
  - `class StateSync { constructor(nOf: (id: string) => number | undefined); refresh(state: GameState): void; full(viewerId: string): ViewState; patch(viewerId: string, acted: boolean): StatePatch | null; knows(viewerId: string): boolean; forget(viewerId: string): void }`. `acted`: the page's own action brings its record back, changed or not.
  - `applyPatch(state: ViewState, patch: StatePatch): ViewState`.

- [ ] **Step 1: Write the failing tests** in `stateSync.test.ts`:
  - `is today's update`: for a state with a dealer (gate code, money, orders, a car with `buyPrice` and `recon`) and a guest, `viewFor` equals the object today's `broadcastState` sends each of them (that code copied into the test as the reference), plus `n`.
  - `a page that applies every patch ends where a fresh copy starts`: a seeded random run of 400 steps (players join and leave; money, inventory, strip record, market, economy, day, clock and walk-ins change; positions, fuel and car spots drift); after each step and `refresh`, `applyPatch(replica, patch(viewer))` (a JSON copy of the patch, as a page receives it) equals `viewFor(state, viewer)` for three viewers, other players' drifting fields aside.
  - `what a page reports itself makes no patch, and is current when the record goes`: a player's position, fuel and car spot change: no patch for the others, none for the player itself; its own action brings its record back with them current; then its name changes: the others' patch carries its record with the current position, fuel and car spot.
  - `nothing changed, nothing sent`: a second `patch` with no change is `null`.
  - `only the changer is sent`: one player's money changes: others get no patch (money is hidden from them); the player gets its own record only.
  - `a join sends the others only the newcomer`.
  - `the one who acted gets its record back`: `patch(id, true)` with no change holds `players[id]`.
  - `gone and unset`: a deleted player appears in `gone` once; a deleted shared key appears in `unset`.
  - `private fields never leave`: no patch to another viewer contains a gate code, an order, an account id or a `recon` above 0.
  - `walk-ins are the viewer's own`: a viewer's patch carries only its own walk-ins.
  - `a junk inventory entry` (an old save's `null` or string) is compared as it is, without failing.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement `stateSync.ts`.** `refresh` serialises each player's two views and each shared key (every key of the state except `players`, `accounts`, `chatLog`, `activeWalkIns`) once, bumping a version where the JSON changed (for a player's views, the JSON of `steadyPart`); each viewer remembers the versions it was sent and the JSON of its own walk-ins. The value kept is always the latest, so what is sent is current.
- [ ] **Step 4:** Run the test file. Expected: PASS. Then the lane checks.
- [ ] **Step 5:** Commit; boss review.

### Task 4: The World and the page use both

**Files:**
- Modify: `apps/sim/server.ts`: imports (after `valueRoute`'s), the data-diet declarations above `broadcastState`, `broadcastState`, `initState` (replacing `othersView` and `publicState`), the two `init` lines, the handler wrapper at `io.on('connection'`, the `join` handler's protocol check, the position relay at `// Live player positions`, `disconnect`.
- Modify: `apps/sim/src/store.ts` (`PROTO` in every join; the `init`, `update`, `pos` and `patch` handlers)
- Modify: `apps/sim/src/types.ts` (`n?: number` on `Player`)
- Modify: `apps/sim/e2e/data.ts` (joins with `proto: 2`; a `pos` decoder; the near bucket is the twenty nearest within 200 m)
- Create: `apps/sim/src/world/dataDiet.wiring.test.ts`
- Create: `apps/sim/e2e/diet.smoke.mjs` (the two-browser look, runnable like the other smoke tests)
- Also, from the reviews of Tasks 2 and 3: `netPositions.ts` `mergePositions` returns the kept object when a message only repeats what it has; `stateSync.ts` numbers versions from one counter that only goes up; its test compares with the three reported fields set aside by hand.

**Interfaces:**
- Consumes: Task 2's `relayed`, `PositionRelay`, `mergePositions`, `keepOnly`, `decodePositions`; Task 3's `StateSync`, `ownView`, `othersView`, `viewFor`, `applyPatch`.
- Produces: the server gives each connection a short number (`netIds: Map<string, number>`, from 1, never reused) and puts it on every player record it sends as `n`; `proto2: Set<string>` holds the connections that joined with `proto: 2`; `acting: AsyncLocalStorage<string>` holds the socket whose handler is running; the events `pos` (a flat number array) and `patch` (a `StatePatch`).

- [ ] **Step 1: Write the failing wiring tests** in `dataDiet.wiring.test.ts` (a World as in `serverWiring.test.ts`, on a free port from 3300 to 3399, with one saved account; a page's state is kept as the page keeps it: its `init`, then `applyPatch` for each `patch`):
  - Positions: `n is on every player record`, different for each connection; `a new page gets pos, never player_positions`; `an old page (no proto) still gets player_positions`; `a near player every tick, one on another circuit rarely` (B 50 m away at least 20 times in 3 s, C on Spa at most twice); `a page that joins again on the same socket is sent everyone again; a player who leaves is never sent`.
  - Patches: `a new page gets patches, never update, and ends where a fresh copy starts`; `a join sends the others the newcomer's record, not the state` (under 2 KB); `a refused action sends the player who tried its own record back, unchanged` (`strip_buy_part` on a rental); `never sends another player's money, account or what a car cost` (the saved account rents; another page's patches for it hold money 0, no account id, `recon` and `buyPrice` 0); `a driver's fuel and position reach nobody else when someone else acts`; `a player who leaves is in gone, once`; `a page that joins again on the same socket gets a full copy, and patches from there`; `an old page (no proto) still gets update with every player, and no patch`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Server.** Every 100 ms, `relayed(worldPosition, stripPositions.get(id))` for every player, `relay.tick(...)` for the `proto2` pages that have a player, then `socket.volatile.emit('pos', moving)` and `socket.emit('pos', sure)` for each non-empty list; the old `player_positions` loop runs on, unchanged, for the other connections only (`io.except([...proto2])`), and only while there are any. `broadcastState` refreshes `StateSync`, then sends each `proto2` page `sync.patch(id, id === acting.getStore())` when not null, and every other connection today's `update`, built from `ownView` and `othersView`. Both `init` lines send `initState(id)`: `sync.full(id)` for a `proto2` page, `viewFor` otherwise, plus `chatLog`. The `socket.on` wrapper runs each handler inside `acting.run(socket.id, ...)`. `join` (after the tester-key refusal) records `proto: 2` or drops the page from `proto2` and `sync`, and calls `relay.forgetRecipient(id)`. `disconnect` forgets the id in the relay, `sync`, `proto2` and `netIds`.
- [ ] **Step 4: Page.** `proto: 2` in every `join` the page sends (`emitJoin`'s four and `continueHere`'s). `pos`: `mergePositions(playerPositions, flat, gameState.players)`, set only when it returns a new object. `patch`: `gameState` becomes `applyPatch(gameState, patch)`; `timeOfDay` from it when the patch has one; `strip` and `octane` mirrored only when the patch holds the player's own record; players in `gone` dropped from `playerPositions`. `init`: `playerPositions` back to `{}`. `update`: `keepOnly(playerPositions, state.players)`. The `update` and `player_positions` handlers stay.
- [ ] **Step 5: `data.ts`.** Join with `proto: 2`; add a `pos` decoder (each fake player's `n` from its own `init`).
- [ ] **Step 6:** Run the wiring tests (both files), the lane checks and `vite build`. Expected: PASS, and `serverWiring.test.ts` unchanged and passing (it joins without `proto`, so it covers the old path).
- [ ] **Step 7: Look at it.** A production build and World on a port from 3300 to 3399; two browsers, both guests in the Strip, both renting a car: one is moved in steps beside the other (`window.__micar.place`); the other's view lists it (`stripPlayers()`) and draws its name tag following, in screenshots at 1280 px and 375 px. Then the CI smoke tests against that World: `strip.smoke.mjs`, `sound.smoke.mjs` and `challenge.smoke.mjs` (the two-browser race).
- [ ] **Step 8:** Commit; boss review (`Visual: yes`).

### Task 5: Measure again, and the pull request

**Files:**
- Modify: `docs/superpowers/specs/2026-11-14-world-data-diet-design.md` (the measured result); `docs/superpowers/specs/2026-11-14-world-data-diet-data/` (the "after" measurements)

- [ ] **Step 1:** Run `data.ts` with the same rows, both modes, on the branch; copy the final `data.ts` (and `netPositions.ts`, which it imports) into the `origin/main` worktree and run the "before" rows again there, so both sides use the same program. Expected (estimates): driving, about 7 to 8 KB/s each at 100 in the hub, about 2 KB/s spread, joins about 10 MB at 100; the ten nearest within 200 m still updating every ~105 ms (median); in play, the state column near zero beside today's full copies.
- [ ] **Step 2:** Put the before-and-after table in the spec, with what was not measured, on `lane-d/data-diet-plan`.
- [ ] **Step 3:** Commit; boss review of the documents branch.
- [ ] **Step 4:** Push both branches and open two pull requests, with the trial's headings: "Plan: World data diet — design, plan and measurements (documents only)" from `lane-d/data-diet-plan`, and "World data diet: each player hears what is near it, and gets patches instead of full copies" from `lane-d/data-diet`, with the before-and-after table. Do not merge.
