# Strip Spawn, Car Rental and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/strip` lands a visitor in the Strip as a guest with $500, a rental lot beside the gate rents a stock car for one event at $500, and a passwordless account (Google or emailed link) keeps the player's progress and pays a $1,000 daily allowance at the counter.

**Architecture:** Two pure modules carry every rule — `world/rental.ts` (fleet, price, rent/return) and `world/accounts.ts` (magic and session tokens, Google ID-token verification, guest→account linking, allowance, what persists) — and `server.ts` only wires socket messages to them. On the client, `/strip` is a third view in `main.tsx` whose entry card joins as a guest or signs in; inside the Strip, "on foot" is the **rental lobby**: the Strip scene stays loaded, the camera parks at the lot's bay and the counter menu is open. The rental car is an ordinary car in the player's inventory flagged `rental: true`, so sync, visibility and payouts work unchanged.

**Tech Stack:** apps/sim — React 18, Vite 5.4, zustand 4.5, socket.io 4.8, three 0.160.1, Tailwind 3, vitest 2.1.9, Playwright (smoke). Node 22 `crypto` for HMAC and RS256 (no new dependencies); Node `fetch` for Resend and Google's JWKS; Google Identity Services loaded by `<script>` on the client.

**Spec:** `docs/superpowers/specs/2026-11-05-strip-rental-and-accounts-design.md`

## Global Constraints

- No dependency upgrades or additions: three 0.160.1, React 18.3.1, Tailwind 3, Vite 5.4.21, vitest 2.1.9, socket.io 4.8.3, express 4.22.1. Node ≥22 <23.
- Money is dollars (`player.money`); Octane is `player.octane`. `RENTAL_PRICE = 500`, `GUEST_STAKE = 500`, `ALLOWANCE = 1000` — defined once, in `rental.ts` / `accounts.ts`, imported everywhere else.
- Rental fleet = the three driving archetypes `hatchback`, `coupe`, `sports` (`ARCHETYPES` in `world/data.ts`), stock, untunable; the Garage never opens for a car with `rental: true`.
- Rental lot occupies Strip block (7,7) — the block whose corner nodes are [7,7] and [8,8] — beside the exit gate at node [8,8]. In metres: block spans x,z ∈ [640, 710]; `RENTAL_BAY = { x: 675, z: 675, h: Math.PI / 4 }` (heading convention: forward = (sin h, 0, cos h), so the bay faces the gate). `RENTAL_CAM = { x: 652, y: 5, z: 652 }` looking at the bay.
- Secrets only as Render environment variables: `GOOGLE_CLIENT_ID`, `MAGIC_SECRET`, `RESEND_API_KEY`, `MAGIC_FROM`. None in the repo, CI or chat. With none set the server runs with both sign-in methods off and reports it in `caps`.
- Magic token: HMAC-SHA256, 15-minute expiry, single use. Session token: HMAC-SHA256, 30-day expiry. Google ID token: RS256 against Google's JWKS, `aud` = client ID, `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}, not expired.
- Allowance day is the UTC date `YYYY-MM-DD` of the server's clock. Skipped days do not stack.
- All server refusals are `strip_denied { reason }` (existing event → `driveNotice`).
- Brand: #ffd23f on #0e1217, Barlow / Barlow Condensed; the entry card and panels use the same classes as `DriveLayer`/`GarageMenu`.
- `pnpm --filter @micar/sim exec tsc --noEmit && pnpm --filter @micar/sim build` clean; `pnpm --filter @micar/sim test` clean with nothing on stderr; `pnpm --filter @micar/value test` and `pnpm site` clean.
- Commits as `git -c user.name=lasting-oasis -c user.email=blueoceanlegacies@gmail.com commit`, with the session's attribution trailers.

## Review Focus

1. A guest who reloads the page is a new guest and the old session is gone — expected; but a signed-in player who reloads must come back as the same account with the same money → Task 1 `verifySession` round-trip; Task 3 reads `micar.session` before joining.
2. A player who disconnects mid-event holding a rental must never have the rental saved onto the account → Task 1 `saveRecord` strips `rental: true` cars; Task 2 disconnect handler saves through `saveRecord`.
3. The same account joining from two tabs must not duplicate the player → Task 1 `attachAccount` refuses when the account is already live (`reason: 'already signed in'`).
4. An allowance claimed at 23:59 UTC and again at 00:01 UTC is two days and pays twice → Task 1 test with those two timestamps.
5. A guest at $0 asks to rent → `canRent` refuses with `'Not enough money'` and the counter shows the account nudge → Task 0 test; Task 4 menu line.

---

### Task 0: Types and the rental module

**Files:**
- Modify: `apps/sim/src/types.ts` (Car gains `rental?: boolean`; Player gains `guest?: boolean`, `accountId?: string`; GameState gains `accounts: Record<string, Account>` — `Account` imported from `world/accounts.ts` type-only, defined in Task 1; for this task declare `accounts: Record<string, unknown>` and Task 1 narrows it)
- Create: `apps/sim/src/world/rental.ts`
- Test: `apps/sim/src/world/rental.test.ts`
- Modify: `apps/sim/src/carSpecs.ts` (delete the `'Speedway Rental GT'` entry and its comment)

**Interfaces:**
- Produces:
  - `RENTAL_PRICE = 500`, `GUEST_STAKE = 500`
  - `RENTAL_FLEET: ReadonlyArray<{ key: 'hatchback' | 'coupe' | 'sports'; make: string; model: string; color: string }>` — `{hatchback: 'Civet', 'Hatch', '#ffd23f'}`, `{coupe: 'Ronin', 'Coupe', '#2a9df4'}`, `{sports: 'Tsubasa', 'R4', '#e8463c'}` (make/model are the display names; `bodyStyle` is the key)
  - `RENTAL_BAY = { x: 675, z: 675, h: Math.PI / 4 }`, `RENTAL_CAM = { x: 652, y: 5, z: 652 }`, `RENTAL_BLOCK: [number, number] = [7, 7]`
  - `heldRental(player: Player): Car | undefined`
  - `canRent(player: Player): { ok: true } | { ok: false; reason: 'Not enough money' | 'You already have a rental' }`
  - `rent(player: Player, key: RentalKey, now: number): Car` — debits `RENTAL_PRICE`, pushes a Car `{ id: 'rental-<now>-<key>', make, model, year: 2026, bodyStyle: key, color, condition: 100, bodyCondition: 100, mechanicCondition: 100, mileage: 0, buyPrice: 0, ownerId: player.id, daysOnLot: 0, titleStatus: 'Clean', vin: 'RENTAL' + 11 zero-padded digits of now, isRegistered: true, fuel: 100, district: 'strip', rental: true }`
  - `returnRental(player: Player): Car | undefined` — removes the rental car from `inventory`, money untouched
  - `isRental(car: Car | undefined): boolean`

- [ ] **Step 1: Write the failing tests** in `rental.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { RENTAL_PRICE, GUEST_STAKE, RENTAL_FLEET, canRent, rent, returnRental, heldRental } from './rental';
const player = (money: number) => ({ id: 'p1', money, inventory: [] as any[], octane: 0, stamps: [] } as any);
describe('rental', () => {
  it('costs $500 and a guest starts with exactly one rental', () => { expect(RENTAL_PRICE).toBe(500); expect(GUEST_STAKE).toBe(RENTAL_PRICE); expect(RENTAL_FLEET.map(f => f.key)).toEqual(['hatchback', 'coupe', 'sports']); });
  it('refuses at $499 and when a rental is already held', () => {
    expect(canRent(player(499))).toEqual({ ok: false, reason: 'Not enough money' });
    const p = player(1000); rent(p, 'coupe', 1000);
    expect(canRent(p)).toEqual({ ok: false, reason: 'You already have a rental' });
  });
  it('debits exactly $500 and adds a stock rental car in the Strip', () => {
    const p = player(500); const car = rent(p, 'sports', 1700000000000);
    expect(p.money).toBe(0); expect(p.inventory).toHaveLength(1);
    expect(car).toMatchObject({ rental: true, bodyStyle: 'sports', district: 'strip', ownerId: 'p1', buyPrice: 0, fuel: 100 });
    expect(heldRental(p)).toBe(car);
  });
  it('return removes the rental and keeps winnings', () => {
    const p = player(500); rent(p, 'hatchback', 1); p.money += 1800;
    expect(returnRental(p)?.rental).toBe(true); expect(p.inventory).toHaveLength(0); expect(p.money).toBe(1800);
    expect(returnRental(p)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @micar/sim test rental` → FAIL (module not found)
- [ ] **Step 3: Implement `rental.ts` and the type changes** per Interfaces; remove `'Speedway Rental GT'` from `carSpecs.ts`.
- [ ] **Step 4: Run** — `pnpm --filter @micar/sim test rental` → 4 passed; `pnpm --filter @micar/sim exec tsc --noEmit` clean (fix any `carSpecs` reference the deletion breaks).
- [ ] **Step 5: Commit** — `world: the rental module — fleet, price, rent and return`

---

### Task 1: The accounts module

**Files:**
- Create: `apps/sim/src/world/accounts.ts`
- Test: `apps/sim/src/world/accounts.test.ts`
- Modify: `apps/sim/src/types.ts` (`accounts: Record<string, Account>`)

**Interfaces:**
- Consumes: `isRental` from `world/rental.ts`; `Player`, `Car` from `types.ts`.
- Produces:
  - `ALLOWANCE = 1000`, `MAGIC_TTL_MS = 15 * 60_000`, `SESSION_TTL_MS = 30 * 86_400_000`
  - `type Identity = { kind: 'google'; sub: string } | { kind: 'email'; email: string }`
  - `type SavedPlayer = Pick<Player, 'name' | 'money' | 'octane' | 'stamps' | 'strip' | 'inventory'>`
  - `type Account = { id: string; identities: Identity[]; player: SavedPlayer; lastAllowance?: string; createdAt: number }`
  - `signMagic(email: string, now: number, secret: string): string` / `verifyMagic(token: string, now: number, secret: string, used: Set<string>): string | undefined` — token = base64url(`${email}.${expiresAt}`) + `.` + base64url(HMAC); `verifyMagic` adds the token to `used` on success, lowercases the email
  - `signSession(accountId: string, now: number, secret: string): string` / `verifySession(token: string, now: number, secret: string): string | undefined` — same shape, 30 days
  - `type Jwk = { kid: string; n: string; e: string }`; `verifyGoogle(idToken: string, clientId: string, keys: Jwk[], now: number): { sub: string; email?: string } | undefined` — decodes header `kid`, finds the key, `crypto.verify('RSA-SHA256', …)` with `crypto.createPublicKey({ key: jwk, format: 'jwk' })`, checks `aud`, `iss`, `exp > now/1000`
  - `identityKey(id: Identity): string` — `'google:<sub>'` | `'email:<email>'`
  - `findAccount(accounts: Record<string, Account>, id: Identity): Account | undefined`
  - `saveRecord(player: Player): SavedPlayer` — copies the five fields; `inventory` without rentals
  - `linkGuest(accounts: Record<string, Account>, id: Identity, guest: Player, now: number): { account: Account; replaced: boolean }` — existing identity → `{ account, replaced: true }` (accounts untouched); new → creates `Account { id: 'acct-' + now.toString(36) + '-' + 4 random base36 chars, identities: [id], player: saveRecord(guest), createdAt: now }`, stores it, `replaced: false`
  - `applyRecord(player: Player, rec: SavedPlayer): void` — writes the five fields onto the live player (`strip` falls back to `freshStrip()`)
  - `utcDay(now: number): string` — `new Date(now).toISOString().slice(0, 10)`
  - `claimAllowance(account: Account, now: number): { ok: true; amount: number } | { ok: false; reason: 'Allowance already collected today' }` — on success sets `lastAllowance = utcDay(now)` and adds `ALLOWANCE` to `account.player.money`
  - `attachAccount(accountId: string, live: Iterable<Player>): { ok: true } | { ok: false; reason: 'already signed in' }` — refuses if any live player has that `accountId`
  - `bootState<T extends { players: Record<string, unknown>; accounts?: Record<string, Account> }>(state: T): T` — returns the state with `players = {}` and `accounts = state.accounts ?? {}`

- [ ] **Step 1: Write the failing tests** in `accounts.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { ALLOWANCE, signMagic, verifyMagic, signSession, verifySession, verifyGoogle, linkGuest, claimAllowance, saveRecord, attachAccount, bootState, utcDay } from './accounts';
const S = 'test-secret';
const guest = (money = 1350) => ({ id: 's1', name: 'Pool', money, octane: 40, stamps: ['strip:first-win'], strip: { rep: 150, cars: {}, wins: { dr1: 1 }, best: { dr1: 9.8 } }, inventory: [{ id: 'rental-1', rental: true }, { id: 'own-1' }] } as any);
describe('magic links', () => {
  it('round-trips, lowercases, expires at 15 minutes and is single use', () => {
    const used = new Set<string>(); const t = signMagic('Pool@Example.com', 0, S);
    expect(verifyMagic(t, 14 * 60_000, S, used)).toBe('pool@example.com');
    expect(verifyMagic(t, 14 * 60_000, S, used)).toBeUndefined();          // used
    expect(verifyMagic(signMagic('a@b.c', 0, S), 15 * 60_000 + 1, S, new Set())).toBeUndefined(); // expired
    expect(verifyMagic(signMagic('a@b.c', 0, S) + 'x', 1, S, new Set())).toBeUndefined();         // tampered
    expect(verifyMagic(signMagic('a@b.c', 0, S), 1, 'other', new Set())).toBeUndefined();         // wrong secret
  });
});
describe('sessions', () => {
  it('round-trips for 30 days', () => {
    const t = signSession('acct-1', 0, S);
    expect(verifySession(t, 29 * 86_400_000, S)).toBe('acct-1');
    expect(verifySession(t, 30 * 86_400_000 + 1, S)).toBeUndefined();
  });
});
describe('google', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1' };
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (payload: any, kid = 'k1') => { const h = b64({ alg: 'RS256', kid }), p = b64(payload); const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url'); return `${h}.${p}.${sig}`; };
  const good = { iss: 'https://accounts.google.com', aud: 'cid', sub: '123', email: 'p@x.y', exp: 2000 };
  it('accepts a token signed by a known key for our client id', () => expect(verifyGoogle(token(good), 'cid', [jwk], 1_000_000)).toEqual({ sub: '123', email: 'p@x.y' }));
  it('rejects wrong audience, wrong issuer, expiry, unknown key and a bad signature', () => {
    expect(verifyGoogle(token({ ...good, aud: 'other' }), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token({ ...good, iss: 'evil' }), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token(good), 'cid', [jwk], 2_001_000)).toBeUndefined();
    expect(verifyGoogle(token(good, 'k2'), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token(good).slice(0, -3) + 'AAA', 'cid', [jwk], 1_000_000)).toBeUndefined();
  });
});
describe('linking and the allowance', () => {
  it('creates an account from a guest with the rental stripped', () => {
    const accounts: any = {}; const r = linkGuest(accounts, { kind: 'email', email: 'p@x.y' }, guest(), 1000);
    expect(r.replaced).toBe(false); expect(Object.keys(accounts)).toEqual([r.account.id]);
    expect(r.account.player).toEqual({ name: 'Pool', money: 1350, octane: 40, stamps: ['strip:first-win'], strip: guest().strip, inventory: [{ id: 'own-1' }] });
  });
  it('loads an existing account instead and flags the replacement', () => {
    const accounts: any = {}; const a = linkGuest(accounts, { kind: 'google', sub: '9' }, guest(100), 1).account;
    const r = linkGuest(accounts, { kind: 'google', sub: '9' }, guest(5000), 2);
    expect(r).toEqual({ account: a, replaced: true }); expect(a.player.money).toBe(100);
  });
  it('pays $1,000 once per UTC day — 23:59 and 00:01 are two days', () => {
    const a = linkGuest({}, { kind: 'email', email: 'p@x.y' }, guest(0), 1).account;
    const t1 = Date.UTC(2026, 10, 6, 23, 59), t2 = Date.UTC(2026, 10, 7, 0, 1);
    expect(claimAllowance(a, t1)).toEqual({ ok: true, amount: ALLOWANCE }); expect(a.player.money).toBe(1000); expect(a.lastAllowance).toBe('2026-11-06');
    expect(claimAllowance(a, t1 + 60_000)).toEqual({ ok: false, reason: 'Allowance already collected today' });
    expect(claimAllowance(a, t2).ok).toBe(true); expect(a.player.money).toBe(2000); expect(utcDay(t2)).toBe('2026-11-07');
  });
  it('saveRecord drops rentals; a live account cannot attach twice; boot keeps accounts and drops players', () => {
    expect(saveRecord(guest()).inventory).toEqual([{ id: 'own-1' }]);
    expect(attachAccount('acct-1', [{ accountId: 'acct-1' } as any])).toEqual({ ok: false, reason: 'already signed in' });
    expect(attachAccount('acct-1', [])).toEqual({ ok: true });
    const st = bootState({ players: { a: 1 }, accounts: { x: { id: 'x' } as any } });
    expect(st.players).toEqual({}); expect(Object.keys(st.accounts)).toEqual(['x']);
    expect(bootState({ players: {} } as any).accounts).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @micar/sim test accounts` → FAIL
- [ ] **Step 3: Implement `accounts.ts`** per Interfaces (Node `crypto` only; `timingSafeEqual` for HMAC comparison). Narrow `GameState.accounts` to `Record<string, Account>`.
- [ ] **Step 4: Run** — `pnpm --filter @micar/sim test accounts` → all passed, nothing on stderr; `tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `world: the accounts module — magic links, sessions, Google tokens, linking, the allowance`

---

### Task 2: Server wiring

**Files:**
- Modify: `apps/sim/server.ts` — `join`, new handlers, event-close hooks, disconnect, boot/persistence
- Create: `apps/sim/src/world/stripFlow.ts` (pure helper so the event-close rule is testable) + `apps/sim/src/world/stripFlow.test.ts`

**Interfaces:**
- Consumes: Task 0 (`GUEST_STAKE`, `canRent`, `rent`, `returnRental`, `heldRental`, `RENTAL_BAY`), Task 1 (everything), existing `applyPayout`, `validateFinish`, `validateOutrun`, `freshStrip`, `broadcastState`, `saveGameState`, `pushChat`.
- Produces (socket contract, for Tasks 3–5):
  - `join { mode: 'guest', name }` | `join { session }` | existing dealer/shop shape. Reply `init { id, state, caps: { google: boolean, magic: boolean }, account?: { id, identity: Identity, allowanceToday: boolean } }`.
  - `rent_car { key }` → `update`; refusals → `strip_denied`.
  - `request_link { email }` → `link_sent {}` or `strip_denied { reason: "Couldn't send the link — try Google or try again in a minute" }` (also when `RESEND_API_KEY`/`MAGIC_SECRET` missing).
  - `link_account { google?: string; magic?: string; confirmReplace?: boolean }` → `account_linked { account: { id, identity, allowanceToday }, session, replaced }`; when the identity already has an account and `confirmReplace` is not true → `account_replace_prompt { money: <saved money> }` and no change; invalid tokens → `strip_denied { reason: 'Sign-in failed' | 'That link has expired or was already used' }`; a second live tab → `strip_denied { reason: 'already signed in' }`.
  - `claim_allowance {}` → `update` (and `account_linked` with refreshed `allowanceToday`) or `strip_denied`.
  - `sign_out {}` → player becomes a guest again with `GUEST_STAKE`, inventory cleared; reply `init` as for a fresh guest.
  - Guest `sync_player_pos` with `district: 'town'` → ignored + `strip_denied { reason: 'The Dealership is for account holders with a car of their own.' }`.
- `stripFlow.ts` produces: `closeEvent(player: Player, carId: string | undefined): { returned: Car | undefined }` — if `carId` names a rental held by the player, `returnRental`; and `guestPlayer(id: string, name: string, now: number): Player` — the full Player record for a guest: `money: GUEST_STAKE`, `guest: true`, `lotPosition: { x: 0, z: 0 }`, `worldPosition: { x: RENTAL_BAY.x * 2, y: 0, z: RENTAL_BAY.z * 2, rotation: 0, district: 'strip' }`, `strip: freshStrip()`, the other dealer fields at their zero values (copy the shape of the existing join, `lotScale: 'Small'`), name fallback `Guest_<id[0..4]>`.

- [ ] **Step 1: Write the failing tests** in `stripFlow.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { closeEvent, guestPlayer } from './stripFlow';
import { rent } from './rental';
describe('stripFlow', () => {
  it('a guest has $500, no lot, and stands at the rental bay in the Strip', () => {
    const g = guestPlayer('abcd1234', '', 5);
    expect(g).toMatchObject({ money: 500, guest: true, name: 'Guest_abcd', inventory: [], octane: 0, stamps: [] });
    expect(g.worldPosition).toMatchObject({ district: 'strip', x: 1350, z: 1350 });
  });
  it('closing an event in a rental returns it; in an owned car it does not', () => {
    const g = guestPlayer('p', 'P', 1); const car = rent(g, 'coupe', 2); g.money += 1800;
    expect(closeEvent(g, car.id)).toEqual({ returned: car }); expect(g.inventory).toEqual([]); expect(g.money).toBe(1800);
    g.inventory.push({ id: 'own' } as any);
    expect(closeEvent(g, 'own')).toEqual({ returned: undefined }); expect(g.inventory).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @micar/sim test stripFlow` → FAIL
- [ ] **Step 3: Implement `stripFlow.ts`**; then wire `server.ts`:
  - Boot: `gameState = bootState(loaded)` replaces the `players = {}` line; `saveGameState()` after every account mutation and in `disconnect` when the player has `accountId` (`accounts[accountId].player = saveRecord(player)`).
  - Env: `const CAPS = { google: !!process.env.GOOGLE_CLIENT_ID, magic: !!(process.env.RESEND_API_KEY && process.env.MAGIC_SECRET && process.env.MAGIC_FROM) }`; sessions need `MAGIC_SECRET` too — when it is missing, `link_account` still works for Google but no session token is issued (`session: null`), and the client simply doesn't persist one.
  - Google JWKS: fetch `https://www.googleapis.com/oauth2/v3/certs` lazily, cache 6 hours, refetch once on an unknown `kid`.
  - `join`: three shapes as above; `session` → `verifySession` → `attachAccount` → player from `guestPlayer` + `applyRecord` + `accountId`; invalid/expired session → fall back to a guest (no refusal — the client clears its token when `init` carries no `account`).
  - Event-close hooks: after payout in `finish_event`, in `finish_outrun`, in `quit_event`, and where `activeEvents` expire — `closeEvent(player, entry.carId)`; if `returned`, `broadcastState`. `drivenCar` for that socket is cleared.
  - `request_link`: `signMagic(email, Date.now(), MAGIC_SECRET)`; POST `https://api.resend.com/emails` `{ from: MAGIC_FROM, to: email, subject: 'Your MiCar sign-in link', text: 'Sign in: <origin>/strip#link=<token>  (15 minutes, one use)' }` with `Authorization: Bearer <RESEND_API_KEY>`; origin from `socket.handshake.headers.origin` falling back to `https://micar-sim.onrender.com`. Rate: one request per socket per 60 s (`strip_denied 'Try again in a minute'`).
  - `link_account`: verify → identity → `findAccount`; existing and `!confirmReplace` → `account_replace_prompt`; else `linkGuest`/`applyRecord`, set `player.accountId`, `player.guest = false`, strip any rental the account loaded (`saveRecord` already did), broadcast, reply `account_linked`.
  - `claim_allowance`, `sign_out`, guest town refusal per Interfaces.
  - `allowanceToday = account.lastAllowance === utcDay(Date.now())`.
- [ ] **Step 4: Verify** — `pnpm --filter @micar/sim test` all green, nothing on stderr; `tsc --noEmit`; start the server (`PORT=3123 pnpm --filter @micar/sim start`) and with a 10-line `node` socket.io-client script in the scratchpad: join as guest → `init.state.players[id].money === 500` and `caps` both false; `rent_car {key:'coupe'}` → update shows a `rental: true` car and `money 0`; `rent_car` again → `strip_denied 'You already have a rental'`; `claim_allowance` → `strip_denied` (not signed in). Paste the script's output in the report.
- [ ] **Step 5: Commit** — `world: the server rents cars, links accounts and pays the allowance`

---

### Task 3: The `/strip` route and entry card

**Files:**
- Modify: `apps/sim/src/main.tsx` (`View` gains `'strip'`; `routeFromLocation` returns it for `/\/strip$/`; the strip view renders `<App />` the same locked-viewport way as `world`)
- Modify: `apps/sim/src/store.ts` (`connect` accepts `{ mode: 'guest', name } | { session } | legacy args`; state gains `caps`, `account`, `linkPrompt: { money } | null`; handlers for `init` (caps/account, clear `micar.session` when no account came back on a session join), `account_linked` (store account, write `micar.session` when `session` is a string), `account_replace_prompt`, `link_sent`; actions `rentCar(key)`, `requestLink(email)`, `linkAccount(payload)`, `claimAllowance()`, `signOut()`; `micar.session` reads/writes wrapped in try/catch)
- Create: `apps/sim/src/strip/StripEntry.tsx`
- Modify: `apps/sim/src/App.tsx` (when `route.view === 'strip'` and not joined: render `StripEntry` instead of the Dealer setup; on `#link=<token>` in the hash, `StripEntry` joins as guest with the stored name or `''` and then sends `link_account { magic }`, clearing the hash)
- Modify: `apps/sim/src/i18n.tsx` + `apps/value/src/i18n-es.ts` (new copy keys)

**Interfaces:**
- Consumes: Task 2 socket contract.
- Produces: `useGameStore` fields `caps: { google: boolean; magic: boolean }`, `account: { id: string; identity: Identity; allowanceToday: boolean } | null`, `linkPrompt`, and the five actions above; `StripEntry` props none (reads the store).
- Copy (en): title "The Strip"; name field label "What do we call you?"; buttons "Race as guest", "Sign in with Google", "Email me a link"; footnote "A guest's progress lasts until you quit. Make an account to keep it and collect $1,000 a day."; magic sent: "Check your email — the link works for 15 minutes."

- [ ] **Step 1: Write the failing test** `apps/sim/src/strip/route.test.ts`: export `routeFromLocation` from `main.tsx` is awkward — instead extract `apps/sim/src/route.ts` with `routeFromLocation(loc: { pathname: string; search: string })` and test: `/strip` → `{ view: 'strip' }`, `/strip/` → strip, `/shop` → shop, `/` → world, `?app=shop` → shop. `main.tsx` imports it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** route extraction, store changes, `StripEntry`, App wiring, copy. Google button only when `caps.google`; email form only when `caps.magic`; with neither, the card shows only "Race as guest".
- [ ] **Step 4: Verify** — route test passes; `tsc`, `build`; `pnpm --filter @micar/sim dev` + server: open `http://localhost:5173/strip` → the card, "Race as guest" → `init` with money 500 (store devtools or `window.__micar` if exposed). Screenshot in the report.
- [ ] **Step 5: Commit** — `world: /strip — the entry card joins as a guest or signs in`

---

### Task 4: The rental lot, the lobby and the counter

**Files:**
- Create: `apps/sim/src/scene/world/rentalLot.ts` — `buildRentalLot(): { group: THREE.Group; dispose(): void }` at block (7,7): a low slab, a lit canopy over the bay at `RENTAL_BAY`, a counter kiosk at (660, 0, 690) m with a `RENT` sign in Barlow Condensed on a canvas texture, brand yellow on night; everything ×`WORLD_PER_M`.
- Modify: `apps/sim/src/world/strip/city.ts` — `buildCity(seed, reserved: [number, number][] = [])` skips slab, park and towers for a reserved block (the rental lot's block stays empty asphalt).
- Modify: `apps/sim/src/world/strip/scene.ts` — `load()` passes `[RENTAL_BLOCK]`, adds the lot group; new `lobby(): void` (camera to `RENTAL_CAM`, look at the bay, no car) and `leaveLobby()`.
- Modify: `apps/sim/src/VanillaThreeScene.tsx` — guest/`/strip` flow: on mount when `player.guest || player.worldPosition?.district === 'strip'` and no driven car → `enterLobby()` (loads the Strip, `district = 'strip'`, `useDriveUi.setState({ district: 'strip', lobby: true })`); on `update` where the player's inventory gains a `rental: true` car → build its mesh, `driver.place(RENTAL_BAY)`, `S.enter`, `lobby: false`; when the driven rental disappears from inventory → `endDriving()` variant that stays in the Strip and returns to the lobby (results card stays until dismissed, then lobby). Guests get no gate prompt and `exitStrip` is a no-op for them. The Garage never opens for a rental (`openGarage` guard).
- Modify: `apps/sim/src/world/driveUi.ts` (`lobby: boolean`, `counter: boolean`) and `apps/sim/src/world/DriveLayer.tsx` — the counter menu: the three fleet cars with make/model and "$500 · one event", disabled with the reason when `canRent` fails; for account holders a line "Collect today's $1,000" (or "Collected today") ; for a guest at $0 the line "Make an account for a $1,000 daily allowance" → opens the Account panel (Task 5); the results card's extra line "Rental returned — $X on hand" when the reward arrives for a rental; Esc/II in the lobby opens the pause menu whose "Back to town" is replaced by "Sign out" for guests.
- Test: `apps/sim/src/world/strip/city.test.ts` — `buildCity(1, [[7,7]])` produces no slab/tower whose centre lies inside x,z ∈ (640, 710) (inspect the returned `City` groups' children positions), and `buildCity(1)` does.

**Interfaces:**
- Consumes: Task 0 constants, Task 3 store actions (`rentCar`), Task 2 `update` semantics.
- Produces: `useDriveUi.lobby`, `useDriveUi.counter`; `window.__micar.rent(key)` for the smoke.

- [ ] **Step 1: Write the failing city test** — run → FAIL (signature). **Step 2–3: Implement** the reserved block, the lot, the lobby, the counter. **Step 4: Verify** — tests green; `tsc`/`build`; dev run: `/strip` → lobby camera on the lit bay, counter open; rent the coupe → in the car at the bay facing the gate; quick-enter `dr1` via the map, finish → results, dismiss → lobby again with the car gone and money = 0 + prize. Screenshots in the report.
- [ ] **Step 5: Commit** — `world: the rental lot, the lobby and the counter`

---

### Task 5: Account panel, Google sign-in, magic link UI

**Files:**
- Create: `apps/sim/src/strip/AccountPanel.tsx` — identity line ("Signed in with Google as p@x.y" / "Guest — progress lasts until you quit"), allowance status, buttons: Sign in with Google (loads `https://accounts.google.com/gsi/client` once, `google.accounts.id.initialize({ client_id, callback })` → `linkAccount({ google: credential })`), "Email me a link" (email input → `requestLink`), Sign out (account holders).
- Create: `apps/sim/src/strip/ReplacePrompt.tsx` — "Your $X from this session will be replaced by your saved account." Confirm → resend the pending `link_account` with `confirmReplace: true`; Cancel clears `linkPrompt`.
- Modify: `DriveLayer.tsx` (pause menu "Account" button; counter nudge opens the panel), `store.ts` (`pendingLink` to resend on confirm), `index.html` (CSP/meta untouched; the GSI script is injected at runtime only when `caps.google`).
- Modify: `vite.config.ts` only if `window.google` typing needs a `declare global` — put it in `apps/sim/src/strip/gsi.d.ts` instead.

**Interfaces:**
- Consumes: Task 3 store actions and `caps`, Task 2 contract.
- Produces: `window.__micar.linkMagic(token)` for the smoke (sends `link_account { magic }`).

- [ ] **Step 1: Test** `apps/sim/src/strip/replaceCopy.test.ts`: `replaceCopy(1350)` → `"Your $1,350 from this session will be replaced by your saved account."` (pure helper in `ReplacePrompt.tsx`). Run → FAIL.
- [ ] **Step 2–3: Implement.** **Step 4: Verify** — `tsc`, `build`; dev with no env: the panel shows only the guest line and no sign-in buttons; with `MAGIC_SECRET=x RESEND_API_KEY=bad MAGIC_FROM=a@b.c`: "Email me a link" → `strip_denied` notice "Couldn't send the link…" (Resend rejects the key) — confirms the error path end to end. Google cannot be exercised without a client ID; state that in the report.
- [ ] **Step 5: Commit** — `world: the account panel — Google, email link, sign out, the replace warning`

---

### Task 6: Pages redirect, door link, smoke, docs

**Files:**
- Create: `tools/strip-redirect.html` (copy `tuner-redirect.html`, target `https://micar-sim.onrender.com/strip`, title "The Strip", text "Race now — no account needed.")
- Modify: `tools/build-site.sh` (`mkdir site/strip`, copy the redirect), `.github/workflows/pages.yml` only if it filters paths
- Modify: `apps/value/src/door/Door.tsx` + `apps/value/src/i18n-es.ts` — the Strip card gains a button/link "Race now — no account needed." → `https://micar-sim.onrender.com/strip`
- Modify: `apps/sim/e2e/strip.smoke.mjs` — after the existing dealer run, a guest run: `goto(BASE + '/strip')`, type a name, "Race as guest", wait for the counter, `__micar.rent('coupe')`, assert money went 500 → 0, enter `dr1` via `__micar.drive`/map as the existing smoke does, finish (same drag routine), results card contains "Rental returned", money == prize (1800 × position factor as the payout reports) and the inventory has no car. CI needs no new env.
- Modify: `README.md` (one line: `/strip` — race as a guest, rent a car for $500, make an account for a $1,000 daily allowance; the four Render env vars listed under deployment), `docs/micar-central-page-plan.md` (the Strip row gains the guest entry).

- [ ] **Step 1: Run the smoke locally against a production server** (`pnpm --filter @micar/sim build && SMOKE=1 NODE_ENV=production PORT=3123 pnpm --filter @micar/sim start &`) → both runs `SMOKE PASSED`.
- [ ] **Step 2: `pnpm site`** clean; `site/strip/index.html` exists.
- [ ] **Step 3: Commit** — `site: /strip redirect, the door's Race now link, the guest smoke, docs`
