# Trial Lane B — Challenge a Friend to a Card Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/superpowers/plans/2026-11-13-trial-rules.md` first: its rules apply to every task here.

**Goal:** A visitor with a card in the Garage sends a friend a link; the friend opens it on a phone, sees the challenger's card, parks or picks a car of their own, races it, sees who won, and sends a challenge back. No account and no server.

**Architecture:** The Garage already races cards: `race(mode, entrants, seed)` in `@micar/engine` decides a race from the entrants and a seed and nothing else, so both phones compute the same result. A new pure module packs one entrant, a mode and a seed into the address (`#/garage/vs/<code>`) and unpacks it with strict checks, because anyone can edit a link. A new page under the Garage's existing router shows the challenge. Nothing is sent anywhere.

**Tech Stack:** apps/value (React 19, Vite, vitest), `@micar/engine` (`race`, `RaceEntrant`, `RACE_MODES`, `ATTRIBUTE_KEYS`, `BODY_CLASSES`), Playwright for the smoke script. No new dependencies.

**Spec:** this plan is its own short design. The loop it serves is "type your car, get its card, race a friend" from the owner's direction of 2026-11-13; the 3D Strip's race-by-link stays as it is and is joined to this once accounts exist (Lane A).

## Global Constraints

- No dependency additions. No change to `@micar/engine`: the race rules, the attributes and the grade are untouched.
- A challenge link is never trusted. The rival it carries always races with `trusted: false`, `basis: 'vehicle'` and the fixed id `rival`, whatever the link claims. The engine bars both an untrusted entrant and a `'vehicle'` one from a ranked race, so the rival is locked out of ranked play twice. A challenge race is never `ranked`; it pays nothing, changes no grade, and writes nothing to a passport.
- Attributes and the Power Rating are on the engine's 0–1000 scale. A number outside it is clamped into it; anything that is not a finite number becomes `null`.
- The other fields of a rival read from a link: body class must be one of `BODY_CLASSES` or the whole code is refused; drivetrain is one of `FWD`, `RWD`, `AWD`, `4WD` or `null`; ground clearance is a finite number clamped to 0–40 inches or `null`; the name is trimmed, stripped of control characters, cut to 60 characters, and refused if nothing is left.
- The mode must be one of `RACE_MODES` and the seed a whole number from 0 to 4,294,967,295, or the whole code is refused.
- A code longer than 1,200 characters is refused before it is decoded.
- Every string a visitor sees is a literal passed to `t()` with a Spanish entry ("usted") in `garage/es-panels.ts`; `src/i18n.test.ts` scans the code and fails on one with no entry. A label that reaches `t()` through a table instead (the race modes' names do) must have its table in `TABLES` in `garage/es.test.ts`; the race modes' table is already there.
- Touch targets at least 44 px; no horizontal scroll at 375 px; CSS under `.dp` with the `gar-` prefix, as the rest of the Garage.
- Files this lane owns: `apps/value/src/garage/challenge.ts`, `challenge.test.ts`, `Challenge.tsx`, `Challenge.test.tsx`, `apps/value/e2e/challenge.smoke.mjs`, and edits to `garage/Garage.tsx`, `garage/RacePanel.tsx`, `garage/panels.css`, `garage/es-panels.ts`, `garage/es.test.ts`. Nothing outside `apps/value/src/garage/` and `apps/value/e2e/`.
- Checks before every boss submission: `pnpm --filter @micar/value test`, `pnpm --filter @micar/value build`, `pnpm site`.

## Review Focus

1. **A link someone edited by hand.** Attributes of 99999, a name of 200 characters, a mode that does not exist, text that is not base64 or not JSON, a code longer than the limit → Task 1 tests: each is clamped or the whole code is refused, and nothing throws.
2. **The visitor's own car has the same id as the rival.** → Task 1 test: the rival's id is always `rival`, and a car whose MiCar ID is literally `rival` cannot occur (ids start `MC-`); the duel still names two rows.
3. **Both phones must agree.** → Task 1 test: the same challenge and the same car give the same winner and margin on two calls, and the friend's reply carries a new seed.
4. **A friend with an empty Garage.** They must not hit a dead end → Task 3: the page offers "Park a car" and the challenge is still there when they come back.
5. **A link opened in a chat app's built-in browser, where sharing is not offered.** → Task 4: without `navigator.share`, the button copies the link and says so.

---

## One pull request, branch `lane-b/card-challenge`

### Task 1: Pack and unpack a challenge

**Files:**
- Create: `apps/value/src/garage/challenge.ts`
- Test: `apps/value/src/garage/challenge.test.ts`

**Interfaces:**
- Produces:

```ts
export const CHALLENGE_WORD = 'vs';
export const CHALLENGE_MAX = 1200;
export const RIVAL_ID = 'rival';
export const NAME_MAX = 60;
export type Challenge = { mode: RaceMode; seed: number; rival: RaceEntrant };
export function encodeChallenge(c: Challenge): string;             // base64url (no padding) of the JSON described below
export function decodeChallenge(code: string): Challenge | null;   // null unless it is exactly a challenge
export function challengeHash(c: Challenge): string;               // '#/garage/vs/<code>'
export function challengeFromHash(hash: string): Challenge | null; // reads what challengeHash writes
export function asRival(entrant: RaceEntrant): RaceEntrant;        // id RIVAL_ID, basis 'vehicle', trusted false, name cut to NAME_MAX
export function duel(c: Challenge, mine: RaceEntrant): RaceResult; // race(c.mode, [mine, c.rival], c.seed), never ranked
export function replySeed(seed: number): number;                   // a different uint32, the same on every device
```

- The code is base64url, without padding, of this JSON and nothing else: `{ "mode", "seed", "rival": { "name", "attributes", "powerRating", "bodyClass", "drivetrain", "groundClearanceIn" } }`, with the engine's own key names. `id`, `basis` and `trusted` are never written to a link and never read from one.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_KEYS, race, type RaceEntrant } from '@micar/engine';
import { CHALLENGE_MAX, NAME_MAX, RIVAL_ID, asRival, challengeFromHash, challengeHash, decodeChallenge, duel, encodeChallenge, replySeed } from './challenge';

const attrs = (n: number) => Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, n])) as RaceEntrant['attributes'];
const car = (id: string, n: number): RaceEntrant => ({ id, name: `Car ${id}`, attributes: attrs(n), powerRating: n, bodyClass: 'sedan', drivetrain: 'FWD', groundClearanceIn: 5.5, basis: 'vehicle', trusted: true });
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('challenge', () => {
  it('round-trips, and the rival arrives untrusted with the fixed id', () => {
    const c = { mode: 'drag' as const, seed: 12345, rival: asRival(car('MC-00017', 640)) };
    const back = decodeChallenge(encodeChallenge(c));
    expect(back).toEqual(c);
    expect(back!.rival).toMatchObject({ id: RIVAL_ID, basis: 'vehicle', trusted: false });
    expect(challengeFromHash(challengeHash(c))).toEqual(c);
  });
  it('clamps what a hand-edited link claims', () => {
    const raw = { mode: 'drag', seed: 1, rival: { ...car('x', 0), name: 'Z'.repeat(200), attributes: { ...attrs(500), power: 99999, speed: -3, handling: 'fast' }, powerRating: 1e9, trusted: true, basis: 'competition' } };
    const c = decodeChallenge(b64(raw))!;
    expect(c.rival.attributes.power).toBe(1000);
    expect(c.rival.attributes.speed).toBe(0);
    expect(c.rival.attributes.handling).toBeNull();
    expect(c.rival.powerRating).toBe(1000);
    expect(c.rival.name).toHaveLength(NAME_MAX);
    expect(c.rival).toMatchObject({ id: RIVAL_ID, trusted: false, basis: 'vehicle' });
  });
  it('refuses what is not a challenge, without throwing', () => {
    const good = { mode: 'drag', seed: 1, rival: car('x', 500) };
    for (const code of ['', '!!!', b64('text'), b64({}), b64({ ...good, mode: 'moon' }), b64({ ...good, seed: -1 }), b64({ ...good, seed: 1.5 }), b64({ ...good, rival: { ...good.rival, bodyClass: 'boat' } }), b64({ ...good, rival: { ...good.rival, name: '   ' } }), 'A'.repeat(CHALLENGE_MAX + 1)]) {
      expect(decodeChallenge(code), code.slice(0, 20)).toBeNull();
    }
    expect(challengeFromHash('#/garage/MC-00017')).toBeNull();
  });
  it('gives both phones the same race, and the reply a new one', () => {
    const c = { mode: 'circuit' as const, seed: 777, rival: asRival(car('MC-1', 600)) };
    const mine = car('MC-2', 610);
    expect(duel(c, mine)).toEqual(duel(c, mine));
    expect(duel(c, mine).rows.map((r) => r.id).sort()).toEqual(['MC-2', RIVAL_ID]);
    expect(race(c.mode, [mine, c.rival], c.seed, { ranked: true }).excluded.map((x) => x.id)).toContain(RIVAL_ID);
    expect(replySeed(777)).not.toBe(777);
    expect(replySeed(777)).toBe(replySeed(777));
    expect(Number.isInteger(replySeed(4294967295)) && replySeed(4294967295) >= 0 && replySeed(4294967295) <= 4294967295).toBe(true);
  });
  it('fits in a link', () => {
    expect(challengeHash({ mode: 'endurance', seed: 4294967295, rival: asRival({ ...car('MC-99999', 1000), name: 'W'.repeat(NAME_MAX) }) }).length).toBeLessThan(600);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @micar/value exec vitest run src/garage/challenge.test.ts`
Expected: FAIL, cannot find `./challenge`.

These five tests, and the one in Task 4, were run on 2026-11-13 against a throwaway `challenge.ts` and all passed, so they can be satisfied together. The throwaway was deleted: write your own.

- [ ] **Step 3: Implement `challenge.ts`.** `decodeChallenge` builds the rival field by field (never spreads the parsed object), so an unknown key cannot ride along, and it catches every error so nothing a link contains can throw. `replySeed` may use `hashString` from `@micar/engine`.

- [ ] **Step 4: Run the tests** — Expected: 5 passed.

- [ ] **Step 5: Commit** — `git add apps/value/src/garage/challenge.ts apps/value/src/garage/challenge.test.ts && git commit -m "Garage: pack a card race challenge into a link"`

### Task 2: The Garage opens a challenge link

**Files:**
- Modify: `apps/value/src/garage/Garage.tsx` (the default export, where `code === CARD_BACKS` is checked)
- Modify: `apps/value/src/garage/RacePanel.tsx` (export the existing `Result` component, unchanged, as `RaceResultTable`)
- Create: `apps/value/src/garage/Challenge.tsx`
- Test: `apps/value/src/garage/Challenge.test.tsx`

**Interfaces:**
- Consumes: `CHALLENGE_WORD`, `challengeFromHash`, `duel`, `asRival`, `challengeHash`, `replySeed` from Task 1; `RaceResultTable({ result, me })` from `RacePanel.tsx`; `GarageHandle` from `useGarage.ts`; `assembleCar` from `store.ts`; `entrantFromLayer` from `@micar/engine`, called exactly as `RacePanel` calls it for an unranked race with no setup cards.
- Produces: `Challenge({ g, today, hash }: { g: GarageHandle; today: string; hash: string })`, rendered by `Garage` when `code === CHALLENGE_WORD`. The word is checked before any car is looked up, like `CARD_BACKS`.

- [ ] **Step 1: Write the failing tests** in the style of `CardBack.test.tsx` (render to markup, assert on text):

  - a hash that does not decode → the page says "This challenge link can't be read." and links to the Garage;
  - a good hash and an empty Garage → the rival's name, the race mode's name, the line "Park a car to race back." and a "Park a car" control;
  - a good hash and one parked car → that car's name, a "Race" button, and no result yet.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Build `Challenge.tsx`**

  - Header: "{rival name} challenged you: {mode name}." and, under it, "Their card is as they sent it. It has not been checked."
  - With no car parked: the two lines above and the Garage's existing way into parking. Before leaving, keep the hash in `sessionStorage` under `micar.challenge`; when the Garage home renders and that key holds a challenge that still decodes, show one line with a link back to it.
  - With cars: a picker (one button per car, the first chosen), a "Race" button, then `RaceResultTable` with `me` = the chosen car's MiCar ID.
  - After a race: "Send it back", which is Task 4's share control, with a challenge made from the visitor's car, the same mode and `replySeed(seed)`.

- [ ] **Step 4: Wire `Garage.tsx`**: `const versus = code === CHALLENGE_WORD;` beside `backs`, excluded from the car lookup the same way, rendering `<Challenge g={g} today={today} hash={window.location.hash} />`.

- [ ] **Step 5: Run the Garage's tests** — `pnpm --filter @micar/value exec vitest run src/garage` — Expected: all pass, the three new ones included.

- [ ] **Step 6: Commit** — `git commit -am "Garage: a challenge link opens a race against the sender's card"`

### Task 3: Words, in two languages

**Files:**
- Modify: `apps/value/src/garage/es-panels.ts`, `apps/value/src/garage/es.test.ts`, `apps/value/src/garage/panels.css`

- [ ] **Step 1: Give every string its Spanish in `es-panels.ts`.** The strings, exactly: "Challenge a friend", "{name} challenged you: {mode}.", "Their card is as they sent it. It has not been checked.", "Park a car to race back.", "Park a car", "Race", "Send it back", "This challenge link can't be read.", "Link copied", "Pick your car", "You have a challenge waiting.". Some already have an entry ("Race" and "Park a car" in the Garage's tables, "Link copied" in the site's): reuse it and add only the ones that have none, because a key written twice does not compile.

- [ ] **Step 2: Run** `pnpm --filter @micar/value exec vitest run src/i18n.test.ts src/garage/es.test.ts` — Expected: PASS. A failure names the string that has no entry, or a phrase translated two ways.

- [ ] **Step 3: Style it** in `panels.css` with existing Garage classes where they fit; new rules use the `gar-vs-` prefix. Check at 375 px that nothing scrolls sideways and every button is at least 44 px tall.

- [ ] **Step 4: Commit** — `git commit -am "Garage: challenge page in English and Spanish"`

### Task 4: Send a challenge

**Files:**
- Modify: `apps/value/src/garage/RacePanel.tsx` (one button under the mode chooser)
- Modify: `apps/value/src/garage/Challenge.tsx` ("Send it back" uses the same control)
- Test: add to `apps/value/src/garage/challenge.test.ts`

**Interfaces:**
- Produces, in `challenge.ts`: `challengeUrl(c: Challenge, here: { origin: string; pathname: string }): string` — `origin + pathname + challengeHash(c)`, with any query string left out.
- Produces, in `Challenge.tsx`: `ShareChallenge({ challenge }: { challenge: Challenge })` — one button. With `navigator.share` it shares `{ title: 'MiCar', text: t('{name} challenged you: {mode}.', …), url }`; without it, or if sharing throws anything but a cancel, it copies the link and shows "Link copied" in a `role="status"` line.

- [ ] **Step 1: Write the failing test**

```ts
it('builds the link from where the page is, without the calculator query', () => {
  const c = { mode: 'drag' as const, seed: 5, rival: asRival(car('MC-1', 500)) };
  expect(challengeUrl(c, { origin: 'https://example.test', pathname: '/Micar-com/' })).toBe('https://example.test/Micar-com/' + challengeHash(c));
});
```

- [ ] **Step 2: Run it and see it fail; implement `challengeUrl`; run it and see it pass.**

- [ ] **Step 3: Add "Challenge a friend" to `RacePanel`**, shown when there is a `player` entrant and the race is not `ranked` and no setup cards are chosen. The challenge is `{ mode, seed, rival: asRival(player) }` with the panel's current `mode` and `seed`.

- [ ] **Step 4: Run** `pnpm --filter @micar/value test` — Expected: every test passes.

- [ ] **Step 5: Commit** — `git commit -am "Garage: challenge a friend from the race panel, and send one back"`

### Task 5: Prove it on a phone-sized screen

**Files:**
- Create: `apps/value/e2e/challenge.smoke.mjs`, modelled on `card-back.smoke.mjs` (it serves the built app itself, or uses `BASE=http://…`)

- [ ] **Step 1: Write the script.** At 375 × 812 with touch on:

  1. Open `#/garage`, park a car the way a visitor would (read `Park.tsx` and `every-card.smoke.mjs` for the shortest path), open its Race tab, press "Challenge a friend" with `navigator.share` stubbed to record its argument. The recorded `url` contains `#/garage/vs/`.
  2. In a **new browser context** (an empty Garage, as a friend would have), open that `url`. The page shows the first car's name and "Park a car to race back."
  3. Park a car there, follow the "challenge waiting" line back, press "Race". A result table with two rows appears and one row is marked as the winner.
  4. Open the same `url` in a third fresh context, park the same car as in step 3 and race. It names the same winner as step 3: two phones agree.
  5. `document.documentElement.scrollWidth <= 375` on the challenge page, and every `button` on it is at least 44 px tall.

- [ ] **Step 2: Run it** — `pnpm --filter @micar/value build && node apps/value/e2e/challenge.smoke.mjs` — Expected: it prints each numbered check as passed and exits 0.

- [ ] **Step 3: Take two screenshots** from the script at 375 px, the challenge with an empty Garage and the result, into `.boss/shots/`.

- [ ] **Step 4: Commit, boss, pull request.** Submit with `Visual: yes` and the two screenshots. Pull request title: "Garage: challenge a friend to a card race by link". Do not merge.
