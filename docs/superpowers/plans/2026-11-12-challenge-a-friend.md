# Challenge a Friend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor at the Strip's rental counter makes a challenge, sends its link, and up to four people race the same circuit at once in the same lent car and see each other drive.

**Architecture:** Each browser keeps simulating its own car; the server referees. A pure rules module (`world/race.ts`) holds the room, the start, the clock and the result, and `server.ts` wires it to `race_*` socket messages and one lookup address. On the page, `EventRunner` learns to run a race whose other cars are people, a pure `RemoteCar` smooths their motion, and the store keeps the room.

**Tech Stack:** TypeScript, Node 22, pnpm 10, Express 4, socket.io 4.8, React 18, zustand 4, three.js 0.160, vitest 2, Playwright 1.63. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-challenge-a-friend-design.md`

## Global Constraints

- All paths below are under `apps/sim/` unless they start with `docs/` or `README.md`.
- No new dependency; `pnpm-lock.yaml` does not change.
- A challenge pays nothing and records nothing: no cash, REP, Octane, stamp, win or best time changes anywhere in this work.
- Constants, copied from the spec: `RACE_MAX = 4`, `RACE_MIN = 2`, `ROOMS_MAX = 100`, `LOAD_TIMEOUT_MS = 30000`, `GO_LEAD_MS = 5000`, `FINISH_WINDOW_MS = 60000`, `EMPTY_TTL_MS = 120000`, `CLAIM_TOLERANCE_S = 0.5`, `CLAIM_LATE_S = 0.1`, `SLOT_COLORS = ['#ffd23f', '#2a9df4', '#e8463c', '#f3f6fb']`.
- A room code is 6 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, matched without case.
- Pure modules (`race.ts`, `remote.ts`, `rental.ts`, `events.ts`) take the clock and the random source as arguments; no `Date.now()` or `Math.random()` inside the rules.
- A socket handler never throws on a malformed payload: the wiring suite's last test pins the server's handler errors to exactly three.
- Every new line the player reads lives in `src/i18n.tsx`, in English and Spanish.
- With no `net` option, `EventRunner` and `StripScene` behave exactly as before; the existing 503 tests stay green.
- Tests: `pnpm --filter @micar/sim exec vitest run <file>`; types: `pnpm --filter @micar/sim typecheck`. Commit after each task, in the repo's style (`area: what changed`).

## Review Focus

1. **A reload or a dropped connection while in a room.** The page comes back to the same room: the address keeps `?race=`, the store joins again after every `init`, and an empty room lasts two minutes. Tests: Task 2 (`a join before the two minutes revives an empty room; after, it is swept`), Task 5 (`the host leaving hands the room on, and an empty room can be joined again by its code`), Task 6 (`joins the room again on every init`).
2. **Malformed race messages.** `null` payloads, strings where numbers go, `NaN` or huge poses: nothing is thrown, nothing is relayed. Test: Task 5 (`junk on every race message stops nobody`).
3. **A code typed by hand.** Lower case, spaces, a dash, the wrong length. Tests: Task 2 (`normalizeCode`), Task 6 (`raceCode`).
4. **A wrong clock or a slow device.** A browser clock minutes off, or a phone at 5 frames a second: the countdown still ends at the server's instant and the claim falls back to the server's clock. Tests: Task 2 (the claim bounds), Task 4 (`goes at the named instant whatever the frame rate`), Task 6 (`offsetFrom`).
5. **The host leaving in each phase.** Waiting room: the next member hosts. Loading: called off when one racer is left. Racing: the others race on and the result keeps the leaver as a DNF. Tests: Task 2, Task 5.

---

### Task 1: The lent car

**Files:**
- Modify: `src/types.ts` (the `Car` type)
- Modify: `src/world/rental.ts`
- Test: `src/world/rental.test.ts`, `src/world/accounts.test.ts`

**Interfaces:**
- Produces: `Car.loan?: string` (the room's code); `lend(player: Player, key: RentalKey, code: string, color: string, now: number): Car`; `heldLoan(player: Pick<Player, 'inventory'>): Car | undefined`; `returnLoan(player: Player): Car | undefined`.

- [ ] **Step 1: Write the failing tests** in `rental.test.ts`

```ts
describe('a lent car', () => {
  it('costs nothing, is a rental, and carries the room code and the colour of its grid place', () => {
    const p = player(0); const car = lend(p, 'ronin', 'K7M2QX', '#e8463c', 1700000000000);
    expect(p.money).toBe(0);
    expect(car).toMatchObject({ make: 'Ronin', model: 'GT', bodyStyle: 'coupe', rental: true, loan: 'K7M2QX', color: '#e8463c', district: 'strip', fuel: 100, buyPrice: 0, ownerId: 'p1' });
    expect(car.vin).toHaveLength(17);
    expect(heldLoan(p)).toBe(car); expect(heldRental(p)).toBe(car);
    expect(canRent({ ...p, money: 5000 } as any)).toEqual({ ok: false, reason: 'You already have a rental' });
    expect(specFor(car)).toEqual(FLEET_SPECS.ronin);
  });
  it('goes back with its part record; a paid rental is not a loan', () => {
    const p = player(500); const car = lend(p, 'civet', 'ABCDEF', '#ffd23f', 5);
    p.strip = { rep: 0, cars: { [car.id]: { cfg: {}, tune: {}, owned: [] } }, wins: {}, best: {} };
    expect(returnLoan(p)).toBe(car); expect(p.inventory).toEqual([]); expect(p.strip.cars).toEqual({});
    expect(returnLoan(p)).toBeUndefined();
    const q = player(500); rent(q, 'civet', 6);
    expect(heldLoan(q)).toBeUndefined(); expect(returnLoan(q)).toBeUndefined(); expect(q.inventory).toHaveLength(1);
  });
});
```

In `accounts.test.ts`, beside the existing rental case: `saveRecord` of a player holding `lend(...)` has an empty `inventory` and no entry for the car in `strip.cars`.

- [ ] **Step 2: Run** `vitest run src/world/rental.test.ts src/world/accounts.test.ts` — FAIL: `lend` is not exported.
- [ ] **Step 3: Implement.** Add `loan?: string` to `Car` with the comment `// lent for a challenge race (the room's code): a rental that costs nothing and goes back when the race closes`. In `rental.ts`, `rent` and `lend` share one private builder for the fleet car; `lend` does not debit, sets `color` and `loan`, and its `vin` is `'LOAN' + String(now % 1e13).padStart(13, '0')`. `returnLoan` removes the car that has `loan` and deletes `player.strip.cars[car.id]`.
- [ ] **Step 4: Run** the two files — PASS. Run `pnpm --filter @micar/sim typecheck` — no errors.
- [ ] **Step 5: Commit** `rental: a fleet car can be lent for a challenge race`

---

### Task 2: The rules of a room

**Files:**
- Create: `src/world/race.ts`
- Test: `src/world/race.test.ts`

**Interfaces:**
- Consumes: `EVENTS`, `EventDef` (`./data`); `raceFloor`, `eventDistance` (`./payout`); `raceCapS` (`./strip/events`); `RENTAL_FLEET`, `RentalKey` (`./rental`).
- Produces:

```ts
export const RACE_MAX = 4, RACE_MIN = 2, ROOMS_MAX = 100, CODE_LEN = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LOAD_TIMEOUT_MS = 30_000, GO_LEAD_MS = 5_000, FINISH_WINDOW_MS = 60_000, EMPTY_TTL_MS = 120_000, CAP_SLACK_MS = 30_000;
export const CLAIM_TOLERANCE_S = 0.5, CLAIM_LATE_S = 0.1;
export const SLOT_COLORS: readonly string[];
export type Phase = 'open' | 'loading' | 'racing';
export type MemberState = 'waiting' | 'loading' | 'ready' | 'racing' | 'finished' | 'dnf';
export type Why = 'quit' | 'failed' | 'left' | 'timeout';
export type DenyWhy = 'gone' | 'full' | 'busy' | 'slow' | 'holding' | 'host' | 'few' | 'state' | 'pick';
export type Member = { id: string; name: string; slot: number; state: MemberState; time: number | null; score: number; why: Why | null };
export type ResultRow = { id: string; name: string; pos: number; time: number | null; score: number; why: Why | null };
export type LastRace = { raceNo: number; eventId: string; rows: ResultRow[] };
export type Room = { code: string; eventId: string; car: RentalKey; hostId: string; phase: Phase; raceNo: number; members: Member[];
  startedAt: number | null; goAt: number | null; closesAt: number | null; gone: ResultRow[]; last: LastRace | null; note: 'called-off' | null; emptySince: number | null };
export type RoomView = Pick<Room, 'code' | 'eventId' | 'car' | 'hostId' | 'phase' | 'raceNo' | 'members' | 'goAt' | 'closesAt' | 'last' | 'note'>;
export type Invitation = { host: string; eventId: string; car: RentalKey; count: number; max: number; phase: Phase };
type Ok = { ok: true }; type Denied = { ok: false; why: DenyWhy }; type Pick2 = { eventId: unknown; car: unknown };
export function makeCode(rand: () => number): string;
export function normalizeCode(raw: unknown): string | null;
export function createRoom(rooms: Map<string, Room>, host: { id: string; name: string }, pick: Pick2, stage: number, rand: () => number): { ok: true; room: Room } | Denied;
export function joinRoom(room: Room, who: { id: string; name: string }): Ok | Denied;
export function leaveRoom(room: Room, id: string, now: number): void;
export function setRace(room: Room, id: string, pick: Pick2, stage: number): Ok | Denied;
export function startRace(room: Room, id: string, now: number): Ok | Denied;
export function markReady(room: Room, id: string, now: number): Ok | Denied;
export function claimFinish(room: Room, id: string, claim: { time: unknown; score: unknown; failed: unknown }, now: number): Ok | Denied;
export function quitRace(room: Room, id: string, now: number): void;
export function tick(room: Room, now: number): boolean;            // true when the room changed
export function sweep(rooms: Map<string, Room>, now: number): string[]; // the codes deleted
export function holdsLoan(room: Room, id: string): boolean;
export function roomView(room: Room): RoomView;
export function invitation(room: Room): Invitation;
```

Rules the signatures do not settle (all from the spec's "The race, exactly"):
- `normalizeCode` upper-cases and drops spaces and dashes; anything not then exactly 6 alphabet characters is `null`.
- `createRoom`: `'busy'` at `ROOMS_MAX`; `'pick'` for an unknown event, an event with `stage` above the host's, or a car not in `RENTAL_FLEET`. The host is the first member, `waiting`.
- `joinRoom`: a member joining again is `ok` and changes nothing; the fifth is `'full'`; a join into an empty room makes the joiner host and clears `emptySince`. Joining is allowed in every phase (the joiner is `waiting`).
- `startRace`: `'host'`, then `'state'` unless `open`, then `'few'` under `RACE_MIN`. `raceNo` goes up first, then member `i` of `n` takes `slot = (i + raceNo) % n` and becomes `loading`; `note`, `gone`, `goAt`, `closesAt` are cleared; `startedAt = now`.
- After every change in `loading`: nobody `loading` and at least 2 `ready` → `racing`, `goAt = now + GO_LEAD_MS`, the ready become `racing`. Fewer than 2 racers left in all, or nobody `loading` and fewer than 2 `ready` → called off: `open`, everyone `waiting`, `note = 'called-off'`.
- `claimFinish` (phase `racing`, member `racing`, else `'state'`): `failed` truthy → `dnf`, why `'failed'`. Otherwise with `elapsed = (now - goAt) / 1000` and `floor = raceFloor(ev)`: `elapsed < floor` → `'state'` and nothing changes. The claim stands when `time` is a finite number, `time >= floor`, `time <= elapsed + CLAIM_LATE_S` and `elapsed - time <= CLAIM_TOLERANCE_S`; the member's `time` is the claim when it stands, else `elapsed`, rounded to the millisecond. `score` is kept only for a drift: a finite number clamped to 0..9,999,999 and rounded. The first finish sets `closesAt = now + FINISH_WINDOW_MS`.
- After every change in `racing`: nobody `racing` → the race closes.
- Closing: rows are the members who are `finished` or `dnf` plus `gone`; finishers first (drift: score down, then time up; otherwise time up), then the rest; `pos` counts from 1 through all rows. `last = { raceNo, eventId, rows }`; `open`; every member `waiting` with `time: null, score: 0, why: null`.
- `leaveRoom`: a member who was in the race (`loading`, `ready`, `racing`, `finished`, `dnf`) while a race is on is pushed to `gone`: with their time when `finished`, else `time: null, why: 'left'`. The host role passes to `members[0]`; an empty room gets `hostId = ''` and `emptySince = now`. Then the phase is settled as above.
- `quitRace`: in `loading` the member goes back to `waiting`; in `racing` a `racing` member becomes `dnf`, why `'quit'`; anything else is ignored. Then settle.
- `tick`: in `loading`, at `startedAt + LOAD_TIMEOUT_MS`, members still `loading` become `waiting`, then settle. In `racing`, at `closesAt`, or at `goAt + raceCapS(eventDistance(ev)) * 1000 + CAP_SLACK_MS`, members still `racing` become `dnf`, why `'timeout'`, and the race closes.
- `holdsLoan`: the room is not `open` and the member is `loading`, `ready`, `racing` or `finished`.
- `sweep` deletes rooms with no member whose `emptySince` is `EMPTY_TTL_MS` or more ago.

- [ ] **Step 1: Write the failing tests** in `race.test.ts`. Harness: `beforeAll` reads every track (`setTrackDir`, `readTrackSync`, as `events.test.ts` does, because `raceFloor` needs route lengths); `const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; }`; `const room3 = () => { ... }` builds a room on `royal_drag` / `ronin` with members `a` (host), `b`, `c`; `const DRAG = EVENTS.find(e => e.id === 'royal_drag')!`, `const FLOOR = raceFloor(DRAG)`. One `it` per line:

| Test | The assertions that decide it |
|---|---|
| `a code is six characters of the alphabet` | `makeCode(seq(0, .5, .999))` matches `/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/`; `makeCode(() => 0) === 'AAAAAA'`; `makeCode(() => .9999) === '999999'` |
| `normalizeCode` | `' k7m-2qx '` → `'K7M2QX'`; `'K7M2Q'`, `'K7M2QXX'`, `'K7M2Q0'`, `'K7M2QI'`, `42`, `null` → `null` |
| `create refuses what is not open, and the 101st room` | unknown event, `ardennes_gp` at stage 1 (it opens at 5), car `'coupe'` → `{ ok: false, why: 'pick' }`; `ardennes_gp` at stage 5 → ok; with 100 rooms in the map → `'busy'`; a made room is in the map under its code, `phase 'open'`, `raceNo 0`, one member `waiting`, `hostId` the host |
| `two rooms never share a code` | `rand` that repeats a first code then differs → the second room's code differs |
| `join: the fifth is refused, twice is harmless, any phase is open` | 4 members then `{ ok: false, why: 'full' }`; joining `b` again leaves 3 members; a join during `racing` is `waiting` |
| `start needs the host and two members` | by `b` → `'host'`; alone → `'few'`; during `loading` → `'state'` |
| `grid places rotate from race to race` | 3 members: race 1 slots `[1, 2, 0]`, race 2 slots `[2, 0, 1]`; all `loading`; `raceNo` 1 then 2 |
| `ready from everyone names the green light five seconds on` | after the third `markReady` at `now = 1000`: `phase 'racing'`, `goAt === 6000`, all `racing`; `markReady` by a `waiting` member → `'state'` |
| `the slow are dropped at thirty seconds` | `a`, `b` ready, `c` not: `tick(room, 29_999)` is `false`; `tick(room, 30_000)` is `true`, `c` is `waiting`, `phase 'racing'`, `goAt === 35_000` |
| `a start with one ready racer is called off` | only `a` ready at 30 s → `phase 'open'`, all `waiting`, `note 'called-off'`, `last` still `null`; the next `startRace` clears `note` |
| `the claim stands inside its bounds` | `goAt = 0`; at `now = 20_300` a claim of `20.1` → `time 20.1`; of `19.9` (0.4 under) → `19.9`; of `19.7` (0.6 under) → `20.3`; of `20.5` (0.2 over) → `20.3`; of `FLOOR - 1` → `20.3`; of `'20'`, `NaN`, `Infinity` → `20.3` |
| `a finish before the floor has passed is refused` | at `now = (FLOOR - 1) * 1000` → `{ ok: false, why: 'state' }` and the member is still `racing` |
| `the first finish opens a sixty second window, and the window makes DNFs` | `a` finishes at `20_000`: `closesAt === 80_000`; `tick(79_999)` false; `tick(80_000)` true: `b`, `c` are rows with `time null, why 'timeout'`, `phase 'open'`, `last.rows.map(r => r.id)` starts with `'a'`, `last.rows[0].pos === 1` |
| `a race nobody finishes ends at the cap` | no finish: `tick` at `goAt + raceCapS(eventDistance(DRAG)) * 1000 + 30_000 - 1` false, one ms later true with three `timeout` rows |
| `the last finisher closes the race at once, ranked by time` | times `22.5`, `21.0`, `23.25` → `last.rows.map(r => [r.id, r.pos, r.time])` is `[['b', 1, 21], ['a', 2, 22.5], ['c', 3, 23.25]]`; everyone `waiting`; `goAt`, `closesAt` null |
| `a drift ranks by score, time breaking a tie` | room on `harbour_drift`: scores `1200`, `3400`, `3400` with the third faster → order third, second, first; a score of `-5`, `NaN`, `1e12` is `0`, `0`, `9_999_999`; a drag keeps `score 0` whatever is claimed |
| `a blown engine is a DNF` | `claimFinish(..., { failed: true })` → `dnf`, `why 'failed'`, `time null` |
| `a quit is a DNF and the others race on` | `quitRace(room, 'b', t)` → `b` `dnf` `'quit'`, phase still `racing`; quitting during `loading` puts the member back to `waiting` and the other two go when ready |
| `the host leaving the waiting room hands over` | `leaveRoom(room, 'a', 0)` → `hostId 'b'`, 2 members |
| `a racer who leaves stays on the result as a DNF; a finisher who leaves keeps the time` | `a` finishes then leaves, `b` leaves racing, `c` finishes → rows: `a` with a time, `c` with a time, `b` `time null, why 'left'` |
| `leaving during loading calls the race off when one is left` | 2 members loading, one leaves → `open`, `note 'called-off'` |
| `everyone leaving mid-race leaves an open, empty room` | `phase 'open'`, `members []`, `hostId ''`, `emptySince` set |
| `a join before the two minutes revives an empty room; after, it is swept` | `sweep(rooms, emptySince + 119_999)` → `[]`; a join then makes the joiner host and `emptySince null`; an empty room at `+120_000` → `[code]` and the map no longer has it |
| `who holds a lent car` | `open`: nobody; `loading`: all three; after `b` quits in `racing`: `a`, `c`; a `finished` member: yes until the race closes, then nobody |
| `the view hides the bookkeeping; the invitation names the host` | `roomView` has exactly the 11 keys of `RoomView`; `invitation(room)` equals `{ host: 'A', eventId: 'royal_drag', car: 'ronin', count: 3, max: 4, phase: 'open' }` |

- [ ] **Step 2: Run** `vitest run src/world/race.test.ts` — FAIL: cannot find `./race`.
- [ ] **Step 3: Implement `src/world/race.ts`** to the interfaces and rules above. One private `settle(room, now)` applies the phase rules after every mutation; `close(room)` and `callOff(room)` are private.
- [ ] **Step 4: Run** the file — PASS (25 tests). Typecheck — no errors.
- [ ] **Step 5: Commit** `race: the rules of a challenge room`

---

### Task 3: Another racer's car on this screen

**Files:**
- Create: `src/world/strip/remote.ts`
- Test: `src/world/strip/remote.test.ts`

**Interfaces:**
- Consumes: `Route`, `routePoint`, `buildRoute` (`./routes`).
- Produces:

```ts
export type Sample = { t: number; x: number; z: number; h: number; v: number; s: number; sc: number }; // t: ms; x, z: m; h: rad; v: m/s; s: m along the route; sc: drift score
export const SEND_MS = 66, DELAY_MIN = 80, DELAY_MAX = 600, DELAY_START = 150, KEEP = 32, STALE_MS = 250, FADE_MS = 500, RATE_MAX = 90;
export class RemoteCar {
  delay: number;                                   // ms behind `now` the recorded path is read
  push(sample: Sample, now: number): void;
  pose(now: number, route: Route | null): Sample | null;
}
```

The algorithm (the tests pin it):

```
push(s, now):   ignore s unless s.t > newest.t; keep the last KEEP samples
                target = clamp(clamp(now - s.t, 0, 2000) + SEND_MS, DELAY_MIN, DELAY_MAX)
                delay += (target - delay) * (target > delay ? 0.5 : 0.05)
pose(now, r):   no samples -> null
                at = clamp(now - delay, first.t, newest.t)
                p  = the two samples around `at`, interpolated (h the short way round); one sample: itself
                rate = clamp((c.s - a.s) / ((c.t - a.t) / 1000), 0, RATE_MAX) of that pair; one sample: 0
                span = now - at;  limit = delay + STALE_MS
                carryMs = span <= limit ? span : limit + FADE_MS * (1 - exp(-(span - limit) / FADE_MS))
                ahead = rate * carryMs / 1000
                with a route: move p by routePoint(r, p.s + ahead) - routePoint(r, p.s), turn h by the change of tangent, s += ahead
                without:      move p along its heading by `ahead`
```

- [ ] **Step 1: Write the failing tests.** Routes: `const straight = buildRoute([[0, 0], [0, 2000]], false)` (along +z) and `const square = buildRoute([[0, 0], [100, 0], [100, 100], [0, 100]], true)` (a 400 m lap).

| Test | The assertions that decide it |
|---|---|
| `nothing before the first sample` | `new RemoteCar().pose(0, straight)` is `null` |
| `one sample is drawn where it is` | after one `push`, `pose` returns its x, z, h, s |
| `between two samples it is interpolated` | with `delay` forced to 100 and samples at `t = 0` (z 0) and `t = 100` (z 10, s 10), rate 100 m/s is clamped to 90: `pose(150)` reads `at = 50` → recorded z 5, carried `90 * 0.1 = 9` → z 14, s 14 |
| `a car at constant speed is drawn where it is now, whatever the delay` | samples every 66 ms at 50 m/s along `straight`; for `delay` 80, 150, 400: `pose(now).z` is within 0.05 m of `50 * now / 1000` |
| `heading turns the short way` | samples with `h = 3.1` and `h = -3.1`: the midpoint heading is within 0.05 of `±π`, never near 0 |
| `an older or repeated sample is ignored` | pushing `t = 100` then `t = 50` then `t = 100` keeps one sample at 100 |
| `the delay follows the lag: up fast, down slowly` | samples arriving 400 ms late lift `delay` above 300 within 4 pushes; samples arriving on time afterwards bring it down by less than 15% in 4 pushes; it never leaves `[80, 600]` |
| `the carry follows a bend` | on `square`, a sample at `s = 90` (x 90, z 0, heading +x) moving at 40 m/s with enough delay to carry 20 m ends near `(100, 10)` (within 0.5 m) with `h` turned a quarter turn, to +z |
| `the carry wraps a lap` | on `square`, a sample at `s = 395` (x 0, z 5) carried 10 m ends at `routePoint(square, 405)`: `(5, 0)`, with `s = 405` |
| `past the end of a sprint it stops` | on `straight`, `s = 1995` carried 20 m → z no more than 2000 |
| `when poses stop the car eases to a stand` | after the last push, `pose` at `+1 s`, `+2 s`, `+5 s`: z rises by less than `rate * (limit + FADE_MS) / 1000` in total, and the last two differ by under 0.1 m |
| `it keeps at most 32 samples` | 100 pushes; a pose long before the 69th sample's time reads the oldest kept one |

- [ ] **Step 2: Run** `vitest run src/world/strip/remote.test.ts` — FAIL: cannot find `./remote`.
- [ ] **Step 3: Implement `remote.ts`** to the block above.
- [ ] **Step 4: Run** — PASS. Typecheck — no errors.
- [ ] **Step 5: Commit** `strip: another racer's car, smoothed and carried to where it is now`

---

### Task 4: A race whose other cars are people

**Files:**
- Modify: `src/world/strip/events.ts`
- Test: `src/world/strip/events.test.ts`

**Interfaces:**
- Produces:

```ts
export type NetField = {
  slot: number;                                                                   // my grid place 0..3 (a drag: my lane)
  others: { id: string; name: string; slot: number; color: string; style: string }[];
  goAt(): number | null;                                                          // the green light in ms on now()'s clock; null until named
  now(): number;
};
export type Racer = AI & { estimated?: boolean; remote?: boolean; pid?: string };
// EventFx.spawnRacerMesh(cfg: VisualCfg, who?: { style: string; name: string }): unknown
// ActiveEvent gains: net: NetField | null
// EventRunner.start(ev, opts: { quick?: boolean; net?: NetField })
// EventRunner.remoteDone(pid: string, ft: number | null): void   // finished at ft seconds; null: out of the race (its car is parked)
// EventRunner.onFinish?: (a: ActiveEvent) => void                // once, when the player's run ends at the line or fails; with and without net
```

With `net`:
- No computer racer and no drag car is spawned. Each of `others` is a `Racer` with `remote: true`, `pid`, its `name`, `kind: 'racer'`, `hold: true`, standing on its grid place (a drag: lane `DRAG_LANES[slot]`), its mesh from `fx.spawnRacerMesh({ ...STOCK_CFG, color }, { style, name })`, pushed to `a.racers` and `this.ais`.
- The player stands on `slots[net.slot]` (a drag: lane `net.slot`); no random place.
- Countdown: `a.t = 0.6 + (goAt - now) / 1000` each update; while `goAt()` is null, or `a.t > 3.6`, no banner and no beep. From 3.6 down the banner and beeps are the existing ones. The race starts when `a.t <= 0.6`.
- The race clock is `a.time = (now() - goAt) / 1000`; the time cap does not finish the race.
- `updateRace` steps no remote racer and separates none; `playerFinish` estimates no time for one.
- `standings()` includes `a.racers` in a drag as well.
- `start` shows no `'3'` banner and plays no beep.

- [ ] **Step 1: Write the failing tests** in `events.test.ts` (reuse `runner`, `tick`, `teleportToEnd`, `stubFx`; a settable clock `let clock = 0`; `const field = (over = {}) => ({ slot: 2, others: [{ id: 'p2', name: 'Ana', slot: 0, color: '#ffd23f', style: 'coupe' }, { id: 'p3', name: 'Bo', slot: 1, color: '#2a9df4', style: 'coupe' }], goAt: () => go, now: () => clock, ...over })`; `tickClock(r, seconds)` advances `clock` by 1000/60 per update).

| Test | The assertions that decide it |
|---|---|
| `a challenge spawns only the people` | `fx.spawned.length === 2`; `a.racers.map(r => [r.name, r.remote, r.pid])` is `[['Ana', true, 'p2'], ['Bo', true, 'p3']]`; `a.drag.ai` is empty for the drag |
| `everyone stands on the place the room gave` | circuit, my slot 2: the player is 8 m behind the line and 3 m left of it (`slots[2] = [-3, -8]`, measured along the route's tangent and normal at `s = 0`), Ana at `[-3, 0]`, Bo at `[3, 0]`; drag, slot 3: the player's lateral offset is `DRAG_LANES[3]` |
| `it waits for the green light` | `go = null`; `tickClock(r, 10)`: state `'count'`, `fx.banners` has no `'3'`, the car has not moved |
| `goes at the named instant whatever the frame rate` | `go = 5000`; at 60 updates a second the banners end `['3', '2', '1', 'GO']` and the state turns `'race'` at the first update with `clock >= 5000`; again with one update every 200 ms: same banners in order, `'race'` at the first update at or after 5000 |
| `the race clock is the wall clock` | after GO, set `clock = go + 12_500` and update once: `a.time` is `12.5` |
| `the cap does not end a challenge` | `clock = go + (raceCapS(a.target) + 5) * 1000`; update: still `'race'` |
| `the others are ranked by their progress, and nobody is stepped` | set `Ana.s = a.pS + 50`, `Bo.s = a.pS - 20`; `standings().map(p => p.name)` is `['Ana', 'You', 'Bo']`; after 2 s of updates Ana's `x`, `z` are unchanged |
| `onFinish fires once at the line, with the wall time` | `let n = 0; r.onFinish = () => n++`; `teleportToEnd`; `n === 1`; `a.pFt` equals `(clock - go) / 1000`; no racer has `estimated` |
| `a blown engine in a challenge drag ends it once, failed` | `PV.overRev = 2`; update: `n === 1`, `a.fail === 'Engine blown'`, `a.pFt === null` |
| `remoteDone records a finish, or parks a racer who is out` | `remoteDone('p2', 31.2)`: `Ana.ft === 31.2`, `Ana.done`; `remoteDone('p3', null)`: `Bo.parked`, `Bo.done`, `Bo.ft === null`; an unknown id changes nothing |
| `a drag's standings list the people` | drag with `net`: `standings().length === 3` |
| `cleanup disposes every racer's mesh` | `fx.disposed.length === fx.spawned.length` after `cleanup()` |
| `without net nothing changed` | `onFinish` also fires once for an ordinary sprint; `fx.spawned.length === 3` for an ordinary circuit |

- [ ] **Step 2: Run** `vitest run src/world/strip/events.test.ts` — FAIL on the new tests (the first: `spawned.length` is 3).
- [ ] **Step 3: Implement** in `events.ts`. `stubFx` in the test gains the second parameter. Keep each existing line's behaviour when `a.net` is null.
- [ ] **Step 4: Run** the file — PASS, old and new. Typecheck — no errors (`scene.ts` still compiles: the new `spawnRacerMesh` parameter is optional).
- [ ] **Step 5: Commit** `strip: a race whose other cars are people`

---

### Task 5: The server's side

**Files:**
- Modify: `src/world/stripFlow.ts` (`VISITOR_EVENTS`)
- Modify: `server.ts`
- Test: `src/world/stripFlow.test.ts`, `src/world/serverWiring.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `lend`, `heldLoan`, `returnLoan` (Task 1); `heldRental`, `heldTestCar`, `stageOf`.
- Produces (the wire):

| Message | Direction | Payload |
|---|---|---|
| `GET /api/race/:code` | http | 200 `{ ok: true, ...Invitation }`; 404 `{ ok: false }`; `Cache-Control: no-store` |
| `race_time` | page → server, acknowledged | the acknowledgement is `Date.now()` |
| `race_create` | page → server | `{ eventId, car }` |
| `race_join` | page → server | `{ code }` |
| `race_set` | page → server | `{ eventId, car }` |
| `race_start`, `race_ready`, `race_quit`, `race_leave` | page → server | none |
| `race_pose` | page → server | `[t, x, z, h, v, s, sc]` |
| `race_finish` | page → server | `{ time, score, failed }` |
| `race_room` | server → every member | `RoomView` |
| `race_denied` | server → the asker | `{ why: DenyWhy }` |
| `race_pose` | server → the other members, volatile | `[id, t, x, z, h, v, s, sc]` |

Wiring rules:
- One `Map<string, Room>` and one `Map<socketId, code>`; a socket.io room `'race:' + code` per room.
- `syncRoom(room)` after every change: for each member with a live player, `holdsLoan` decides: lend `room.car` in `SLOT_COLORS[member.slot]` when it should hold one and does not; `returnLoan` (and `drivenCar.delete`) when it holds one and should not. Then `io.to(channel).emit('race_room', roomView(room))`, and `broadcastState` when any inventory changed.
- `leaveRace(socketId)`: `returnLoan` on the player, `leaveRoom`, leave the socket.io room, `syncRoom`. Called by `race_leave`, by `disconnect`, by every `resetSocketState` call site (re-join, sign-out, a superseded session), and by `link_account` when the sign-in replaced the run.
- `race_create` and `race_join` first refuse `'holding'` when the player holds a rental or a tester's car or has a live event entry; then leave any room the socket is in. `race_create` refuses `'slow'` within 3 s of the socket's last creation. `race_join` with a code that does not normalise, or names no room, is `'gone'`. The player's name is the member's name; the stage is `stageOf(strip.rep)`.
- `race_pose`: only from a `racing` or `finished` member of a `racing` room, at most one per 40 ms per socket, exactly seven finite numbers; `x`, `z`, `s` are clamped to ±60,000, `v` to ±200, `sc` to 0..9,999,999.
- Every handler reads its payload defensively (`msg && typeof msg === 'object' ? msg : {}`); `race_time` answers only when its last argument is a function.
- A one-second `setInterval` runs `tick` on every room (then `syncRoom` when it returns true) and `sweep`.
- `enter_event`: refused with `strip_denied` "Finish the challenge first." while `heldLoan(player)`. `finish_outrun`: pays nothing while `heldLoan(player)`. `rent_car`, `test_car`: refused with "Leave the challenge first." while the socket is in a room.

- [ ] **Step 1: Write the failing tests.**

`stripFlow.test.ts`: the sorted list gains `'race_create', 'race_finish', 'race_join', 'race_leave', 'race_pose', 'race_quit', 'race_ready', 'race_set', 'race_start', 'race_time'`.

`serverWiring.test.ts`, a new `describe('challenge races')` placed before the tester-key lockout test, with helpers `room = (s) => next<RoomView>(s, 'race_room')`, `denied = (s) => next<{ why: string }>(s, 'race_denied')`, `guest = async (name) => { const s = client(); const i = await join(s, { mode: 'guest', name }); return { s, id: i.id }; }`, `lookup = (code) => fetch(`${url}/api/race/${code}`)`:

| Test | The assertions that decide it |
|---|---|
| `three guests race a challenge from a link: lent cars, one green light, a result, and no money moved` (timeout 60 s) | host creates `royal_drag` / `ronin` → `race_room` with a 6-character code, `phase 'open'`, 1 member; `lookup(code)` is 200 `{ ok: true, host: 'Ana', eventId: 'royal_drag', car: 'ronin', count: 1, max: 4, phase: 'open' }`; `lookup('zzzzzz')` and `lookup('nope')` are 404; b and c join with the code in lower case; `race_start` from b → `'host'`; from the host → every member `loading`, and each of the three sees one inventory car with `rental: true`, `loan: code`, and three different colours out of `SLOT_COLORS`; all `race_ready` → `phase 'racing'`, `goAt` between `Date.now() + 4000` and `+ 5200`; b's `race_pose [goAt, 1, 2, 0.5, 30, 100, 0]` reaches a and c as `[b.id, goAt, 1, 2, 0.5, 30, 100, 0]` and an outsider guest gets none in 300 ms; a `race_finish { time: 1 }` before the floor leaves the member `racing`; `enter_event` from a racer → `strip_denied` "Finish the challenge first."; after `goAt + raceFloor * 1000`: a finishes with a claim equal to the server's elapsed to within 0.2 s and its `time` is the claim; b claims `1` and gets a time within 0.5 s of the wall clock; c sends `race_quit` and its lent car is gone at once while a and b still hold theirs; the race closes: `phase 'open'`, `last.rows` is a, b, then c with `why 'quit'`, nobody holds a car, all three still have `$500` |
| `the host leaving hands the room on, and an empty room can be joined again by its code` | host disconnects in the waiting room → the other member sees `hostId` become its own id; it leaves; `lookup(code)` is still 200 with `count 0`; a new guest joins by the code and is host |
| `a member who drops mid-race is a DNF, and the last racer still gets a result` | two racers past the green light; one socket closes; the other sees it gone from `members`; after the floor it finishes; `last.rows` has both, the leaver `why 'left'` |
| `full, gone, busy hands: the refusals` | a fifth joiner → `'full'`; `race_join { code: 'ZZZZZZ' }` → `'gone'`; a guest holding a rental → `'holding'`; `race_start` alone → `'few'`; `race_create { eventId: 'ardennes_gp', car: 'ronin' }` from a new guest → `'pick'`; a second `race_create` at once → `'slow'`; `rent_car` while in a room → `strip_denied` "Leave the challenge first." |
| `junk on every race message stops nobody` | for each of the ten events emit with `null`, `'x'`, `42`, `{}`, `[]`; `race_pose` with `[NaN, 1, 2, 3, 4, 5, 6]`, six numbers, eight numbers, and `['a', 1, 2, 3, 4, 5, 6]`; then the same socket creates a room normally. The suite's last test (handler errors are exactly the three) still passes |
| `a visitor may send the race messages` | a guest's `race_create` is answered with `race_room`, never with `strip_denied` "Not available in the Strip" |

- [ ] **Step 2: Run** `vitest run src/world/stripFlow.test.ts src/world/serverWiring.test.ts` — FAIL (the list; no `race_room` in 10 s).
- [ ] **Step 3: Implement.** `VISITOR_EVENTS` first; then `server.ts`: the maps and `syncRoom` / `leaveRace` near the other per-socket maps, the HTTP route beside `/api/caps`, the handlers after the rental handlers, the guards in `enter_event`, `finish_outrun`, `rent_car`, `test_car`, the timer beside the entry-TTL timer.
- [ ] **Step 4: Run** the two files — PASS. Run the whole suite (`pnpm --filter @micar/sim test`) — PASS. Typecheck — no errors.
- [ ] **Step 5: Commit** `server: challenge rooms, the lent cars and the result`

---

### Task 6: The page's side of a room

**Files:**
- Modify: `src/route.ts`; Test: `src/strip/route.test.ts`
- Create: `src/world/raceNet.ts`; Test: `src/world/raceNet.test.ts`
- Modify: `src/store.ts`; Test: `src/store.test.ts`

**Interfaces:**
- Consumes: `normalizeCode`, `RoomView`, `DenyWhy` (Task 2); `RemoteCar`, `Sample` (Task 3).
- Produces:

```ts
// route.ts
export function raceCode(search: string): string | null;            // the ?race= code, normalised; null when absent or malformed
export function withRace(href: string, code: string | null): string; // the same address with ?race=code set, or removed
// raceNet.ts
export function offsetFrom(sentAt: number, serverAt: number, receivedAt: number): number; // serverAt - (sentAt + receivedAt) / 2
export function serverNow(): number;                                 // Date.now() + the kept offset
export function syncClock(socket: { emit(ev: string, ...args: unknown[]): unknown }, probes?: number, gapMs?: number): void; // 5 probes 300 ms apart; keeps the offset of the fastest round trip
export const remotes: Map<string, RemoteCar>;
export function takePose(msg: unknown, now?: number): void;          // [id, t, x, z, h, v, s, sc]; anything else is ignored
export function dropRemotes(): void;
// store.ts (StoreState)
race: RoomView | null;  raceCode: string | null;  raceDenied: DenyWhy | null;  raceNote: 'missed' | null;
createRace(eventId: string, car: string): void;  joinRace(code: string): void;  setRace(eventId: string, car: string): void;
startRace(): void;  leaveRace(): void;
export const apiBase: () => string;                                   // '' in production, http://<host>:3000 under the Vite dev ports (what loadCaps already does)
/** What the store does with the room's messages; `connect` registers these on the socket and calls onInit from its 'init' handler. */
export function raceHandlers(socket: { emit(ev: string, ...args: unknown[]): unknown }): {
  race_room(view: RoomView): void; race_denied(d: { why?: DenyWhy } | null | undefined): void; race_pose(msg: unknown): void; onInit(): void };
```

Store rules:
- `race_room` sets `race`, `raceCode = view.code`, clears `raceDenied`; rewrites the address with `withRace` when the page is on `/strip`; calls `syncClock` when the page was in no room before or the view's `phase` just became `loading`; calls `dropRemotes()` when `raceNo` changed. `raceNote` becomes `'missed'` when this player was `loading` in the previous view and is `waiting` in a view whose `phase` is `racing` with the same `raceNo`; it clears when `phase` becomes `loading`.
- `race_denied` sets `raceDenied`; `'gone'` and `'full'` also clear `race` and `raceCode` and remove `?race=` from the address.
- `race_pose` goes to `takePose`.
- Every `init` clears `race`, and when `raceCode` is set emits `race_join { code }`.
- `leaveRace` emits `race_leave` and clears the four fields and the address; `disconnect` clears them too.
- `joinRace(code)` sets `raceCode` and emits `race_join` when a player has joined.

- [ ] **Step 1: Write the failing tests.**

`route.test.ts`: `raceCode('?race=k7m-2qx')` is `'K7M2QX'`; `raceCode('?race=K7M2Q0')`, `raceCode('')`, `raceCode('?race=')` are `null`; `withRace('https://x.test/strip?tab=1#h', 'K7M2QX')` is `'https://x.test/strip?tab=1&race=K7M2QX#h'`; `withRace('https://x.test/strip?race=K7M2QX&a=1', null)` is `'https://x.test/strip?a=1'`; the route of `/strip` with `?race=K7M2QX` is still `'strip'`.

`raceNet.test.ts`: `offsetFrom(1000, 5000, 1200)` is `3900`; a browser clock ten minutes behind: `offsetFrom(0, 600_050, 100)` is `600_000`; `syncClock` with a stub socket that answers three probes with round trips of 300, 40 and 120 ms keeps the offset of the 40 ms one (fake timers); `takePose(['p2', 10, 1, 2, .5, 30, 100, 7], 20)` makes `remotes.get('p2')` and its pose is the sample; `takePose` of `null`, `'x'`, a 7-element array, an array with `NaN` adds nothing; `dropRemotes()` empties the map.

`store.test.ts`, `describe('a challenge room')` with a stub socket that records emits (the store's `connect` cannot be used without a server, so the test drives `raceHandlers(socket)`, the object `connect` registers):
- `joins the room again on every init`: with `raceCode: 'K7M2QX'`, `onInit()` emits `['race_join', { code: 'K7M2QX' }]` and sets `race: null`; with `raceCode: null` it emits nothing.
- `a gone or full room is forgotten; other refusals keep the room`: `race_denied({ why: 'gone' })` → `race null`, `raceCode null`, `raceDenied 'gone'`; `race_denied({ why: 'host' })` keeps `race`.
- `missing a start is said once`: views `loading` (me `loading`) → `racing` (me `waiting`, same `raceNo`) → `raceNote 'missed'`; the next `loading` view clears it.
- `leaveRace emits and forgets`.

- [ ] **Step 2: Run** the three files — FAIL (`raceCode` is not exported; cannot find `./raceNet`; `raceHandlers` is not exported).
- [ ] **Step 3: Implement.** `loadCaps` uses the new `apiBase()`.
- [ ] **Step 4: Run** the three files — PASS. Typecheck — no errors.
- [ ] **Step 5: Commit** `strip: the page keeps its challenge room, its clock and the other racers`

---

### Task 7: The screens

**Files:**
- Create: `src/strip/challengeCopy.ts`; Test: `src/strip/challengeCopy.test.ts`
- Create: `src/strip/Challenge.tsx`
- Modify: `src/i18n.tsx`, `src/world/driveUi.ts`, `src/world/DriveLayer.tsx`, `src/strip/StripEntry.tsx`

**Interfaces:**
- Consumes: the store fields and actions of Task 6; `RoomView`, `ResultRow`, `Member`, `DenyWhy`; `EVENTS`, `EV_NAME`, `stageOf`; `RENTAL_FLEET`; `fmtT` (`world/hud`).
- Produces:

```ts
// challengeCopy.ts (pure)
export const CH_KEYS: readonly string[];                                     // every strip.ch.* key the screens use
export function denyKey(why: DenyWhy): string;                               // gone → strip.ch.gone, full → .full, host → .onlyHost, busy and slow → .busy, holding → .holding, pick → .pick, few → .needTwo, state → .notNow
export function shareUrl(origin: string, code: string): string;              // `${origin}/strip?race=${code}`
export function raceLabel(eventId: string): string;                          // 'Drag: Royal Park Quarter'; '' for an unknown id
export function carLabel(key: string): string;                               // 'Ronin GT'; '' for an unknown key
export type CardRow = { name: string; me: boolean; txt: string };
export function rowsOf(rows: readonly { id: string; name: string; time: number | null; score: number; why: string | null; state?: string }[], meId: string, drift: boolean, words: { dnf: string; racing: string }): CardRow[];
// driveUi.ts: DriveUi gains  challenge: boolean  (the setup card is open),  staging: boolean  (on the grid, the countdown not begun),  netRace: boolean  (the live event is a challenge)
// ShownResults gains  pending?: boolean  (a challenge still running: no Continue yet)
// Challenge.tsx
export function ChallengeButton(): JSX.Element;      // the counter's button; under it the refusal, the missed-start and the called-off lines when there is one
export function ChallengeSetup(): JSX.Element;       // role="dialog" aria-label = strip.ch.title
export function WaitingRoom(): JSX.Element;          // role="dialog" aria-label = strip.ch.room
export function StagingLine(): JSX.Element | null;   // on the grid: "Loading the circuit: 2 of 3 ready", then "Get ready"
```

`rowsOf`: a row with a time shows `fmtT(time)` (a drift: the score with thousands separators); a row with `why` shows `words.dnf`; a row with neither (still racing) shows `words.racing`; `me` is `id === meId`.

The copy (exact; `{…}` are filled in by the screen):

| Key | English | Spanish |
|---|---|---|
| `strip.ch.button` | Challenge a friend | Reta a un amigo |
| `strip.ch.title` | Challenge | Reto |
| `strip.ch.pickRace` | The race | La carrera |
| `strip.ch.pickCar` | The car, lent free to everyone | El auto, prestado gratis a todos |
| `strip.ch.getLink` | Get the link | Obtener el enlace |
| `strip.ch.back` | Back | Volver |
| `strip.ch.room` | Waiting room | Sala de espera |
| `strip.ch.link` | Send this link | Envía este enlace |
| `strip.ch.share` | Share | Compartir |
| `strip.ch.copy` | Copy link | Copiar enlace |
| `strip.ch.copied` | Link copied | Enlace copiado |
| `strip.ch.shareText` | Race me on the Strip: {race} | Corre contra mí en La Pista: {race} |
| `strip.ch.host` | host | anfitrión |
| `strip.ch.you` | you | tú |
| `strip.ch.start` | Start race | Iniciar carrera |
| `strip.ch.needTwo` | A race needs two people | Una carrera necesita dos personas |
| `strip.ch.waitingHost` | Waiting for {host} to start | Esperando a que {host} inicie |
| `strip.ch.change` | Change the race | Cambiar la carrera |
| `strip.ch.save` | Save | Guardar |
| `strip.ch.leave` | Leave | Salir |
| `strip.ch.loading` | Loading the circuit: {n} of {of} ready | Cargando el circuito: {n} de {of} listos |
| `strip.ch.getReady` | Get ready | Prepárate |
| `strip.ch.inProgress` | Race in progress. You are in the next one. | Carrera en curso. Estás en la siguiente. |
| `strip.ch.missed` | You missed the start. You are in the next one. | Te perdiste la salida. Estás en la siguiente. |
| `strip.ch.calledOff` | Not enough racers were ready. Try again. | No había suficientes corredores listos. Inténtalo de nuevo. |
| `strip.ch.last` | Last race | Última carrera |
| `strip.ch.dnf` | DNF | No terminó |
| `strip.ch.racing` | Racing | En carrera |
| `strip.ch.waitOthers` | Waiting for the others | Esperando a los demás |
| `strip.ch.won` | You won | Ganaste |
| `strip.ch.place` | Place {n} of {of} | Puesto {n} de {of} |
| `strip.ch.out` | Did not finish | No terminaste |
| `strip.ch.invited` | {host} challenged you | {host} te retó |
| `strip.ch.invitedPlain` | You were challenged to a race | Te retaron a una carrera |
| `strip.ch.join` | Join the race | Entrar a la carrera |
| `strip.ch.gone` | That challenge has ended. | Ese reto ya terminó. |
| `strip.ch.full` | That race is full. | Esa carrera está llena. |
| `strip.ch.onlyHost` | Only the host can do that. | Solo el anfitrión puede hacer eso. |
| `strip.ch.busy` | The Strip is busy. Try again in a minute. | La Pista está ocupada. Inténtalo en un minuto. |
| `strip.ch.holding` | Finish what you are driving first. | Termina primero lo que estás manejando. |
| `strip.ch.pick` | That race or car is not open to you. | Esa carrera o ese auto no está disponible para ti. |
| `strip.ch.notNow` | Not right now. | Ahora no. |

Screens:
- **Counter** (`DriveLayer.tsx`, both the guest's and the tester's): `<ChallengeButton />` above the fleet list.
- **Lobby slot** (`DriveLayer.tsx`): `lobby && counter && !results && !paused` shows `race ? <WaitingRoom /> : challenge ? <ChallengeSetup /> : <Counter />`.
- **`ChallengeSetup`**: races are `EVENTS.filter(e => e.stage <= stageOf(strip.rep))`, each a button with `aria-pressed`, labelled `raceLabel`; cars are `RENTAL_FLEET`, each a button with `aria-pressed` and its colour dot; **Get the link** calls `createRace` and stays disabled until the room or a refusal arrives; **Back** closes the card. With a room and the host changing the race, the same card saves through `setRace`.
- **`WaitingRoom`**: the race and the car; a read-only `<input aria-label={strip.ch.link}>` holding `shareUrl(location.origin, code)` that selects itself on focus; **Share** when `navigator.share` exists (falling back to copy when it rejects for anything but a cancel), else **Copy link**, which turns to "Link copied" for 2 s; the members with `host` and `you` marks; for the host **Start race** (disabled under two members, with `strip.ch.needTwo`) and **Change the race**; for the others `strip.ch.waitingHost`; during `loading` the loading line; during `racing` for a `waiting` member `strip.ch.inProgress` and the live rows; `strip.ch.missed`, `strip.ch.calledOff` and a refusal when there is one; the last race's rows under `strip.ch.last`; **Leave**.
- **Results card** (`DriveLayer.tsx`): with `results.pending` the Continue button is replaced by `strip.ch.waitOthers`.
- **Pause menu** (`DriveLayer.tsx`): with `netRace`, no "Restart event".
- **`StagingLine`**: mounted in `DriveLayer`'s banner layer while `staging`.
- **`StripEntry.tsx`**: `const code = raceCode(location.search)`. With a code: put it in the store (`raceCode`) before any connect; fetch `apiBase() + '/api/race/' + code`; 200 shows `strip.ch.invited` with `raceLabel` and `carLabel` under it and turns the submit label into `strip.ch.join`; 404 shows `strip.ch.gone`, clears the store's `raceCode` and the address, and leaves the ordinary card; a failed fetch shows `strip.ch.invitedPlain` and keeps the code. The `#link=` path keeps the query when it rewrites the address (it already keeps `location.search`).

- [ ] **Step 1: Write the failing test** `challengeCopy.test.ts`: every key in `CH_KEYS` has an English and a Spanish text that differ from the key; the `{…}` placeholders of each pair are the same set; `CH_KEYS` has no duplicate; `denyKey` maps each of the nine `DenyWhy` values to a key in `CH_KEYS`; `shareUrl('https://micar-sim.onrender.com', 'K7M2QX')` is `'https://micar-sim.onrender.com/strip?race=K7M2QX'`; `raceLabel('royal_drag')` is `'Drag: Royal Park Quarter'` and `raceLabel('nope')` is `''`; `carLabel('ronin')` is `'Ronin GT'`; `rowsOf` on a finisher, a DNF and a racer still out gives `'21.00'`, the DNF word and the racing word, and marks `me`; in a drift a score of `3400` shows as `'3,400'`.
- [ ] **Step 2: Run** `vitest run src/strip/challengeCopy.test.ts` — FAIL: cannot find `./challengeCopy`.
- [ ] **Step 3: Implement** the copy module and the `i18n.tsx` entries; run the test — PASS.
- [ ] **Step 4: Implement** `driveUi.ts`, `Challenge.tsx`, the `DriveLayer.tsx` and `StripEntry.tsx` changes. Cards reuse the counter's container classes so they fit a phone.
- [ ] **Step 5: Run** the whole suite and the typecheck — PASS, no errors. Run `pnpm --filter @micar/sim build` — builds.
- [ ] **Step 6: Commit** `strip: the challenge card, the waiting room and the invitation`

---

### Task 8: The Strip's scene draws people

**Files:**
- Modify: `src/world/strip/scene.ts`
- Test: `src/world/strip/scene.test.ts`

**Interfaces:**
- Consumes: `NetField`, `Racer`, `EventRunner.onFinish` (Task 4); `Sample` (Task 3); `nameSprite` (`./park`).
- Produces: `StripSceneOpts.remotePose?: (pid: string, route: Route) => Sample | null`; `StripSceneOpts.onPlayerFinish?: (a: ActiveEvent) => void`; `StripScene.startEvent(ev, o: { quick?: boolean; net?: NetField })`.

Rules:
- `fx.spawnRacerMesh(cfg, who)`: with `who`, a car of `who.style` in `cfg.color`, no kit, with a name tag: `nameSprite(who.name)` scaled to 5 × 1.25 m, 2.8 m up, kept in `userData.tag` and disposed with the car (its map and material). Without `who`, as before.
- Each live frame, before the runner's update: every racer with `remote` and not `done` takes `x, z, h, v, s, score` from `remotePose(pid, a.route)` when it returns one, and is not `parked`. A `done` racer keeps taking `x, z, h, v` (it rolls on past the line) but not `s` or `score`.
- `collide` skips racers with `remote`.
- `runner.onFinish` calls `opts.onPlayerFinish`.

- [ ] **Step 1: Write the failing tests** in `scene.test.ts` (the `setup` helper takes `remotePose`):

| Test | The assertions that decide it |
|---|---|
| `a challenge puts only the people on the grid` | a net drag with 2 others: `cars(S.scene).length === 17 + 2`; after `S.exit()` it is 17 |
| `the other racers are drawn from their poses` | `remotePose` returns `{ x: PV.x + 10, z: PV.z + 30, h: 1, v: 20, s: 77, sc: 5 }` for `'p2'`: after one `S.update(1/60, true)` its mesh is at `(x * 2, z * 2)` with `rotation.y === 1 + Math.PI`, visible, and `standings()` has its `s` as 77 |
| `a racer with no pose yet stays on its grid place` | `remotePose` returns `null`: the mesh is still where `start` put it |
| `people do not collide` | a remote placed exactly on the player: `S.collide(PV)` adds no impact beyond the walls' (0 on the open strip) and does not move `PV` |
| `the player's finish is passed on once` | `onPlayerFinish` counted; drive the runner to the end (`PV` placed past the drag's line, one update): 1 |

- [ ] **Step 2: Run** `vitest run src/world/strip/scene.test.ts` — FAIL (`cars` is 20: three computer racers).
- [ ] **Step 3: Implement** in `scene.ts`.
- [ ] **Step 4: Run** the file — PASS. Typecheck — no errors.
- [ ] **Step 5: Commit** `strip: the scene draws the other racers from the network`

---

### Task 9: The 3D view runs the race; two browsers prove it

**Files:**
- Modify: `src/VanillaThreeScene.tsx`
- Modify: `e2e/strip.smoke.mjs`

**Interfaces:**
- Consumes: the store's `race`; `serverNow`, `remotes` (Task 6); `StripScene.startEvent(ev, { net })`, `remotePose`, `onPlayerFinish` (Task 8); `runner.remoteDone` (Task 4); `rowsOf`, `raceLabel` (Task 7); `heldLoan` (Task 1); `SLOT_COLORS` (Task 2).
- Produces: `window.__micar.race(): { code: string; phase: string; members: number; me: string | null } | null`.

Behaviour:
- **Onto the grid.** Where the lobby drives a held rental at once: when that car has `loan`, and the store's room is not `open` and lists this player as `loading`, `ready` or `racing`, the view gets into it (`driveRental`) and starts the room's event with `net`: `slot` this member's, `others` the other members who are `loading`, `ready` or `racing` (colour `SLOT_COLORS[slot]`, style the fleet car's `bodyStyle`), `goAt: () => useGameStore.getState().race?.goAt ?? null`, `now: serverNow`. The view remembers `{ code, raceNo }` as its live challenge.
- **Ready.** `onEventStart` for a challenge emits `race_ready` and never `enter_event`.
- **Poses.** While the challenge's event is in `race` state the view emits `race_pose [serverNow(), V.x, V.z, V.h, V.u, a.pS, driftScore]` every 66 ms as a volatile emit, and once more at the finish.
- **The line.** `onPlayerFinish` emits `race_finish { time: a.pFt, score, failed: !!a.fail }`.
- **The card.** `onResults` for a challenge sends nothing; it shows the results card from the room: title `strip.ch.won`, `strip.ch.place` or `strip.ch.out`, the subtitle `raceLabel`, the rows `rowsOf(...)` of the members in the race, `pending: true`. While the card is up the view rebuilds it whenever the store's room object changes; when `room.last.raceNo` reaches the live challenge's it shows `last.rows` with `pending: false`. Enter and Continue are ignored while `pending`.
- **Others finishing.** When a member's state becomes `finished` or `dnf`, or the member is gone from the room, the view calls `runner.remoteDone(id, time)` once.
- **Quit.** `onEventQuit` for a challenge emits `race_quit`, never `quit_event`.
- **The car going back.** `rentalGone` for a lent car says nothing about a rental; when the race closed while this player was still driving (the window), it shows the final card.
- **Flags.** `useDriveUi` gets `netRace` while a challenge's event is active and `staging` while it is in `count` with no number shown yet.
- **Restart.** The pause menu's restart does nothing in a challenge.
- The lobby frame's Enter closes a results card only when it is not `pending`.

- [ ] **Step 1: Write the failing smoke run** in `e2e/strip.smoke.mjs`, after the guest run and before the tester run: two browsers (a second `chromium.launch` with the same arguments, so neither page is throttled by the other), both at 480 × 270.
  1. Host: `/strip`, name `HostBot`, "Race as guest", wait for the counter, click "Challenge a friend", click the button named `Drag: Royal Park Quarter`, click `Get the link`, read the value of `[aria-label="Send this link"]`; assert it matches `/\/strip\?race=[A-Z2-9]{6}$/`.
  2. Friend: open that link; assert the page shows `HostBot challenged you` and `Drag: Royal Park Quarter`; name `FriendBot`; click `Join the race`; wait for `[aria-label="Waiting room"]`.
  3. Host: wait until the waiting room lists `FriendBot`; click `Start race`.
  4. Both: wait for `window.__micar.pose().driving === true` and `window.__micar.event()?.state === 'race'` (timeout 120 s); then run the existing drag loop on both pages together (`KeyW` down; `ShiftLeft` near the redline) until each body shows `HostBot` and `FriendBot` on a results card.
  5. Both: wait for "Continue [Enter]" (the race closed), press Enter, wait for the waiting room; assert it shows `Last race`, `window.__micar.money() === 500` and `window.__micar.cars().length === 0`.
  6. Assert no page error on either page.
- [ ] **Step 2: Build and run it against a server** — FAIL at step 4 (nobody drives: the lent car arrives, no race starts).

```bash
pnpm --filter @micar/sim build
cd apps/sim && SMOKE=1 NODE_ENV=production PORT=3123 pnpm start > /tmp/claude-smoke-server.log 2>&1 &
BASE=http://localhost:3123/ node e2e/strip.smoke.mjs
```

- [ ] **Step 3: Implement** the behaviours above in `VanillaThreeScene.tsx`.
- [ ] **Step 4: Rebuild, restart the server, run the smoke** — `SMOKE PASSED`, with the new `ok` lines. Run the whole unit suite and the typecheck — PASS, no errors.
- [ ] **Step 5: Commit** `drive: a challenge race in the 3D view, and a two-browser smoke for it`

---

### Task 10: The words about it

**Files:**
- Modify: `README.md` (the World row of "The doors", and a paragraph under the `/strip` paragraph)
- Modify: `apps/sim/README.md` (a "Challenge a friend" section: the link, the room's life, that rooms are in memory)
- Modify: `docs/superpowers/specs/2026-11-12-challenge-a-friend-design.md` (the status line; an "As built" section only where the build differs from the spec)

- [ ] **Step 1: Write** the three edits. The README says what a player does (make a challenge at the rental counter, send the link, up to four race the same car at once, nothing won or lost) and that a deploy or a spin-down ends open challenges.
- [ ] **Step 2: Run** `pnpm --filter @micar/sim test` and `pnpm --filter @micar/value test` — PASS (the value suite reads the root README's links in its footer test).
- [ ] **Step 3: Commit** `docs: challenge a friend, in the READMEs and as built`
