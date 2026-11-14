# Trial Lane C — Trust Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/superpowers/plans/2026-11-13-trial-rules.md` first: its rules apply to every task here.

**Goal:** MiCar stops claiming more than it knows about a car's title: the valuation API gives no number for a rebuilt or salvage title and says nothing was checked, the title and accident choices say what they mean, a branded car's figure carries a plain warning, and nothing promises a grade "for life".

**Architecture:** Four small changes, none of which alters a number the calculator shows. Pull request #21 was merged on 2026-11-13 before this fix, so the live valuation API can return a figure for a rebuilt or salvage title until Part 1 is merged: Part 1 goes first. Each part is one pull request from `main`. Option values (`Clean`, `Rebuilt`, `Salvage`, `None`, `Minor`, `Major`) stay exactly as they are in links, saved records and the engine; only what a visitor reads changes.

**Tech Stack:** apps/value (React 19, Vite, vitest); the valuation API module (merged in pull request #21); the README. No new dependencies.

**Spec:** `claude/micar-title-debate-result.md` in the project (the judge's eight changes). This plan does the parts that need no new data and no new cost: the API rule in changes 2 and 8, the honest half of change 3, the relabel in change 6, and the wording in change 8. What it leaves out, and why, is listed under "Left for the owner".

## Global Constraints

- No number the calculator, the car page or the dealer sheet shows may change. `TITLES` and `ACCIDENTS` keep their names and multipliers (Clean 1, Rebuilt 0.75, Salvage 0.55; None 1, Minor 0.94, Major 0.82).
- Option values are not renamed: they are in shared links, printed QR codes and saved passports.
- MiCar's own words only. No sentence is copied from Kelley Blue Book or any other guide.
- Every string a visitor sees has a Spanish entry in `apps/value/src/i18n-es.ts`, written with "usted". The Spanish for each new string is given in this plan; use it as written.
- The API never returns a grade. For a title other than `Clean` it never returns a value, a range, a forecast, a confidence level or the price steps.
- The segmented controls on the calculator keep their size: their three short words do not change.
- Files this lane owns. On branch `lane-c/api-branded`: `apps/value/src/api/valueApi.ts` and its test, the `Value` schema and the `/value` path in `apps/value/src/seo/api.ts`, `api.test.ts`, and the "Valuation API (live)" paragraph of `llmsTxt` in `apps/value/src/seo/pages.ts`. On branch `lane-c/trust-wording`: `apps/value/src/engine/data.ts`, `engine/data.test.ts`, `apps/value/src/i18n-es.ts`, `apps/value/src/i18n.test.ts`, `apps/value/src/App.tsx`, one line each of `door/GradeSim.tsx`, `garage/PassportPanel.tsx`, `car/StickerBuilder.tsx` and `car/CarPage.tsx`, the sentence at line 161 of `door/Door.tsx`, and the root `README.md`.
- Checks before every boss submission: `pnpm --filter @micar/value test`, `pnpm --filter @micar/sim exec tsc --noEmit` (Part 1 only: the World's server imports the API module), `pnpm site`.

## Review Focus

1. **A caller that spells the title in another case** (`title=rebuilt`). The API matches options without case; the withholding must key on the matched option, not the raw text → Task 1's first test uses three spellings.
2. **A caller that leaves the title out.** It defaults to `Clean`; the answer must say the title was MiCar's default, not the caller's word → Task 1's second test checks `titleFrom`.
3. **A client that reads `valueUsd.privateParty` without checking.** For a branded title `valueUsd` is `null`, and the OpenAPI file must say it can be → Task 1's schema test.
4. **An old link with `accident=None`.** It must still load and price exactly as before → Task 2's first test pins names and multipliers.
5. **A Spanish page showing an English notice.** → Task 2 and Task 4 add their strings to the list `i18n.test.ts` checks, and that test fails on a string with no entry.

---

## Part 1 — one pull request from `main`, branch `lane-c/api-branded`. Do this first.

### Task 1: No number for a branded title, and say what was checked

**Files:**
- Modify: `apps/value/src/api/valueApi.ts`
- Test: `apps/value/src/api/valueApi.test.ts`
- Modify: `apps/value/src/seo/api.ts` (the `Value` schema; the `/value` description), `apps/value/src/seo/api.test.ts`
- Modify: `apps/value/src/seo/pages.ts` (`llmsTxt`, the "Valuation API (live)" paragraph)

**Interfaces:**
- Produces, exported from `valueApi.ts`:

```ts
export const SELF_DECLARED_NOTE = 'Title, accident history, condition and mileage are as the caller stated them or as MiCar assumed them. MiCar has checked no record and inspected nothing.';
export const BRANDED_WITHHELD = 'MiCar does not give a value for a rebuilt or salvage title yet: its figures for these cars have not been tested against sale prices. Have the car appraised independently.';
```

- Every 200 response gains `evidence: { tier: 'self-declared'; titleFrom: 'caller' | 'default'; note: SELF_DECLARED_NOTE }`. `titleFrom` is `'caller'` when the `title` parameter was given, `'default'` when it was left out.
- For a title other than `Clean`, the 200 response is exactly these keys: `ok: true`, `asOf`, `car`, `inputs`, `assumed`, `evidence`, `withheld: { reason: 'branded-title'; message: BRANDED_WITHHELD }`, `valueUsd: null`, `confidence: null`, `drivers: []`, `steps: []`, `forecastUsd: []`, `links`. It has no `note` (that text calls the answer an estimate) and no `modelKnown`. `links.app` still opens the calculator, which shows its rule-of-thumb figure with the warning from Task 4.
- For `Clean`, the response is what it is today plus `evidence`; `withheld` is absent.

- [ ] **Step 1: Write the failing tests** (add to `valueApi.test.ts`; `call` and `Body` are already defined there; import `BRANDED_WITHHELD` and `SELF_DECLARED_NOTE`)

```ts
it('gives no number for a branded title, whatever the spelling', () => {
  for (const title of ['Rebuilt', 'salvage', 'REBUILT']) {
    const r = call(`id=honda-civic&year=2019&mileage=60000&title=${title}`);
    expect(r.status).toBe(200);
    const b = r.body as Body;
    expect(b.ok).toBe(true);
    expect(b.valueUsd).toBeNull();
    expect(b.confidence).toBeNull();
    expect([b.steps, b.forecastUsd, b.drivers]).toEqual([[], [], []]);
    expect(b.withheld).toEqual({ reason: 'branded-title', message: BRANDED_WITHHELD });
    expect(b.evidence).toEqual({ tier: 'self-declared', titleFrom: 'caller', note: SELF_DECLARED_NOTE });
    expect(['Rebuilt', 'Salvage']).toContain(b.inputs.title);
    expect('note' in b || 'modelKnown' in b).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/"(tradeIn|privateParty|dealerRetail|low|high)":\s*\d/);
  }
});

it('a clean title keeps its numbers, says nothing was checked, and never carries a grade', () => {
  const b = call('id=honda-civic&year=2019&mileage=60000').body as Body;
  expect(b.valueUsd.privateParty).toBeGreaterThan(0);
  expect(b.withheld).toBeUndefined();
  expect(b.evidence).toEqual({ tier: 'self-declared', titleFrom: 'default', note: SELF_DECLARED_NOTE });
  expect((call('id=honda-civic&year=2019&title=clean').body as Body).evidence.titleFrom).toBe('caller');
  expect('grade' in b).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @micar/value exec vitest run src/api/valueApi.test.ts`
Expected: the two new tests FAIL; the four existing ones pass.

- [ ] **Step 3: Implement in `valueQuery`.** After `parse` succeeds, branch on `inputs.title !== 'Clean'` and return the withheld shape. Do not call `valuate` or `forecast` for a branded title.

- [ ] **Step 4: Update the OpenAPI description** in `openApiJson()`:
  - `valueUsd` and `confidence` become `type: ['object', 'null']`.
  - `Value` gains `evidence` (added to `required`): an object with `tier` (a string, **no `enum`**, described as "How MiCar knows the title, accident history, condition and mileage. Today always self-declared. Other values may be added: treat one you do not know as unverified."), `titleFrom` (`enum: ['caller', 'default']`) and `note`.
  - `Value` gains `withheld`: an object with `reason` (`enum: ['branded-title']`) and `message`, described as "Present when MiCar gives no figures. valueUsd and confidence are then null, and steps, drivers and forecastUsd are empty."
  - The `/value` summary and description say that a rebuilt or salvage title returns no figures.
  - Add to `api.test.ts`:

```ts
it('the Value schema allows a withheld value and requires the evidence', () => {
  const v = (openApiJson() as any).components.schemas.Value;
  expect(v.properties.valueUsd.type).toEqual(['object', 'null']);
  expect(v.properties.confidence.type).toEqual(['object', 'null']);
  expect(v.required).toContain('evidence');
  expect(v.properties.withheld.properties.reason.enum).toEqual(['branded-title']);
});
```

- [ ] **Step 5: Update `llmsTxt`.** In the "Valuation API (live)" paragraph add: "Every answer says that the title, accidents, condition and mileage are self-declared: MiCar has checked no record. For a rebuilt or salvage title it returns no figures, because MiCar has not tested values for those cars against sale prices."

- [ ] **Step 6: Run the checks from Global Constraints**
Expected: the new tests pass, and so does every test that passed before, including the one that checks every 200 answer against the `Value` schema ("answers in the shape openapi.json publishes"); its cases must include a rebuilt and a salvage query. The World's type check is clean; `grep -c '"withheld"' site/api/v1/openapi.json` prints `1` or more.

- [ ] **Step 7: See it answer.** Run `cd apps/sim && (PORT=5820 NODE_ENV=production npx tsx server.ts &) ; sleep 8; curl -s "localhost:5820/api/v1/value?id=honda-civic&year=2019&title=Rebuilt"`
Expected: one line of JSON with `"valueUsd":null` and the `withheld` message. Then stop the server.

- [ ] **Step 8: Commit, push, and open the pull request** "Valuation API: no figure for a rebuilt or salvage title, and say nothing was checked". The boss reviews it through the relay (see the trial rules). Do not merge.

---

## Part 2 — one pull request from `main`, branch `lane-c/trust-wording`

### Task 2: Say what the title and accident choices mean

**Files:**
- Modify: `apps/value/src/engine/data.ts`
- Test: `apps/value/src/engine/data.test.ts` (create)
- Modify: `apps/value/src/i18n-es.ts` (lines 186–188, and one new entry), `apps/value/src/i18n.test.ts` (the test "has every label that comes from a data table")
- Modify: `apps/value/src/App.tsx:320` (the legend), `apps/value/src/door/GradeSim.tsx:23`, `apps/value/src/garage/PassportPanel.tsx:225`, `apps/value/src/car/StickerBuilder.tsx:159` (the text of each accident `<option>`)

**Interfaces:**
- Produces, in `data.ts`: `Option = { name: string; mult: number; desc: string; label?: string }` and
  `optionLabel(options: readonly { name: string; label?: string }[], name: string): string` — the option's `label` if it has one, else its `name`; a `name` that is not an option comes back unchanged.

The new English, exactly:

| Where | Text |
| --- | --- |
| `TITLES` Clean `desc` | No salvage or rebuilt brand on the title, as you report it. MiCar has checked no record. |
| `TITLES` Rebuilt `desc` | Once branded salvage, then repaired and retitled by a state. What the state inspected varies. |
| `TITLES` Salvage `desc` | Branded salvage, usually after an insurer declared a total loss. |
| `ACCIDENTS` `label`s | `None reported`, `Minor reported`, `Major reported` (the words the dealer sheet and the car page already print) |
| Calculator legend, `App.tsx:320` | `Reported accidents` (was `Accident history`) |

The Spanish, exactly. The three accident labels already have entries; do not add them again.

| English | Spanish |
| --- | --- |
| No salvage or rebuilt brand on the title, as you report it. MiCar has checked no record. | Sin marca de salvamento ni de reconstruido en el título, según usted lo informa. MiCar no ha revisado ningún registro. |
| Once branded salvage, then repaired and retitled by a state. What the state inspected varies. | Tuvo marca de salvamento; luego fue reparado y un estado le emitió un título nuevo. Lo que el estado inspeccionó varía. |
| Branded salvage, usually after an insurer declared a total loss. | Con marca de salvamento, por lo general después de que una aseguradora lo declaró pérdida total. |
| Reported accidents | Accidentes reportados |

- [ ] **Step 1: Write the failing tests** (`data.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { ACCIDENTS, TITLES, optionLabel } from './data';

describe('title and accident options', () => {
  it('keeps the values and multipliers that links, saved records and prices use', () => {
    expect(TITLES.map((o) => [o.name, o.mult])).toEqual([['Clean', 1], ['Rebuilt', 0.75], ['Salvage', 0.55]]);
    expect(ACCIDENTS.map((o) => [o.name, o.mult])).toEqual([['None', 1], ['Minor', 0.94], ['Major', 0.82]]);
  });
  it('shows an accident as reported, and any other option by its name', () => {
    expect(ACCIDENTS.map((o) => optionLabel(ACCIDENTS, o.name))).toEqual(['None reported', 'Minor reported', 'Major reported']);
    expect(optionLabel(TITLES, 'Rebuilt')).toBe('Rebuilt');
    expect(optionLabel(ACCIDENTS, 'Unknown')).toBe('Unknown');
  });
  it('no title description claims a check MiCar did not make', () => {
    for (const o of TITLES) expect(o.desc).not.toMatch(/re-certified|no total-loss history/i);
    expect(TITLES[0].desc).toMatch(/checked no record/);
  });
});
```

- [ ] **Step 2: Run them and see them fail** — `pnpm --filter @micar/value exec vitest run src/engine/data.test.ts`

- [ ] **Step 3: Change `data.ts`** as the table says, and add `optionLabel`.

- [ ] **Step 4: Print the label in the three selects.** In `GradeSim.tsx:23`, `PassportPanel.tsx:225` and `StickerBuilder.tsx:159` the option text `t(a.name)` (or `t(c.name)`) becomes `t(optionLabel(ACCIDENTS, a.name))`. The `value=` attributes do not change. In `App.tsx:320` only the legend changes; `Segmented` itself is not touched. Leave `accidentText` in `car/Sticker.tsx` as it is.

- [ ] **Step 5: Spanish.** Replace the three old title entries (lines 186–188) with the new ones and add `Reported accidents`. In `i18n.test.ts`, the accident entry of the data-table list becomes `...ACCIDENTS.flatMap((o) => [o.name, o.desc, optionLabel(ACCIDENTS, o.name)])`.

- [ ] **Step 6: Run** `pnpm --filter @micar/value test` — Expected: everything passes, `i18n.test.ts` included.

- [ ] **Step 7: Commit** — `git commit -am "Calculator: title and accident choices say what they mean and that nothing was checked"`

### Task 3: Nothing promises a grade for life

Verified on 2026-11-13: the grade is worked out from the passport and nothing else (`packages/engine/src/grading.ts`), for a given day (`certify(passport, report, registry, asOf)` in `certification.ts`), so it changes when the record does. The promise appears in two places and nowhere else: `README.md` line 5 and the home page's opening paragraph.

**These are words on the home page. The owner approves them by approving this plan; if the owner says to keep the old line, skip this task.**

**Files:**
- Modify: `README.md:5`, `apps/value/src/door/Door.tsx:161`, `apps/value/src/i18n-es.ts:432`

| Where | Was | Becomes |
| --- | --- | --- |
| `README.md` | …with a grade from 1 to 10 that follows the car for life. | …with a grade from 1 to 10, worked out from the car's own record: when the record changes, so does the grade. |
| `Door.tsx` (English key) | …with a grade that follows the car for life. | …with a grade worked out from the car's own record. |
| `i18n-es.ts` | …con una calificación que acompaña al auto toda su vida. | …con una calificación calculada a partir del historial del propio auto. |

Every other word of the three sentences stays. The Spanish entry's key is the English sentence, so the key changes with it.

- [ ] **Step 1: Make the three edits.**
- [ ] **Step 2: Check nothing else makes the promise** — `grep -rn -i "for life\|toda su vida" README.md apps/value/src apps/sim/src packages | grep -v node_modules`
Expected: no lines.
- [ ] **Step 3: Run** `pnpm --filter @micar/value test` — Expected: passes.
- [ ] **Step 4: Commit** — `git commit -am "Words: the grade is worked out from the car's record, not promised for life"`

### Task 4: A branded figure says it is a rule of thumb

**Files:**
- Modify: `apps/value/src/engine/data.ts`, `apps/value/src/engine/data.test.ts`
- Modify: `apps/value/src/App.tsx` (`Prices`, and its use at line 190), `apps/value/src/car/CarPage.tsx:126`
- Modify: `apps/value/src/i18n-es.ts`, `apps/value/src/i18n.test.ts`

**Interfaces:**
- Produces, in `data.ts`: `BRANDED_NOTES: Record<string, string>` with exactly the keys `Rebuilt` and `Salvage`.
- Produces, in `App.tsx`: `Prices({ val, title }: { val: Valuation; title?: string })`. When `BRANDED_NOTES[title]` exists, one paragraph with `role="note"` and the same classes as the "Most sales of a car like this land between…" paragraph, placed directly under it. No figure changes.
- The calculator passes `title={active?.title}`; the car page passes `title={r.title}`. So the warning shows wherever a branded car's figure does, the page a QR code opens included.

| Key | English | Spanish |
| --- | --- | --- |
| `Rebuilt` | This is a rule-of-thumb figure for a rebuilt title. MiCar has not tested it against sale prices and has checked no record. Get an independent appraisal before relying on it. | Esta es una cifra aproximada para un título reconstruido. MiCar no la ha comparado con precios de venta y no ha revisado ningún registro. Obtenga una tasación independiente antes de confiar en ella. |
| `Salvage` | This is a rule-of-thumb figure for a salvage title. MiCar has not tested it against sale prices and has checked no record. Get an independent appraisal before relying on it. | Esta es una cifra aproximada para un título de salvamento. MiCar no la ha comparado con precios de venta y no ha revisado ningún registro. Obtenga una tasación independiente antes de confiar en ella. |

- [ ] **Step 1: Write the failing test** (add to `data.test.ts`, importing `BRANDED_NOTES`)

```ts
it('every title that is not clean has a warning, and a clean one has none', () => {
  expect(Object.keys(BRANDED_NOTES)).toEqual(TITLES.filter((o) => o.mult !== 1).map((o) => o.name));
  for (const note of Object.values(BRANDED_NOTES)) expect(note).toMatch(/has checked no record/);
});
```

- [ ] **Step 2: Run it and see it fail; add `BRANDED_NOTES`; run it and see it pass.**
- [ ] **Step 3: Add the paragraph to `Prices` and pass `title` from both pages.** Add the two Spanish entries, and `...Object.values(BRANDED_NOTES)` to the data-table list in `i18n.test.ts`.
- [ ] **Step 4: Run** `pnpm --filter @micar/value test` — Expected: passes.
- [ ] **Step 5: Look at it.** Build, then open the calculator at 375 px and at 1280 px, in English and in Spanish, with `?make=Honda&model=Civic&year=2019&msrp=20250&mileage=60000&title=Rebuilt#/value` and with `title=Clean`.
Expected: the warning is under the value for Rebuilt and absent for Clean; the line under the Title control reads the new words (on a phone it now takes two lines where it took one); the legend reads "Reported accidents"; the three segmented controls are the same height as on `main`; nothing scrolls sideways; every dollar figure equals `main`'s for the same address. Open the home page in both languages: the opening paragraph reads the new sentence and fits as before.
Screenshots for the boss, into `.boss/shots/`: the Rebuilt calculator at 375 px in English and in Spanish, and the home page's opening at 375 px.
- [ ] **Step 6: Commit, boss (`Visual: yes`), pull request** "Trust wording: what the title and accident choices mean, a warning on a branded figure, no grade for life". Do not merge.

## Left for the owner

The judge's ruling asks for more than this plan does. Each of these removes a feature, costs money per car, needs inputs MiCar does not collect, or is a legal call:

1. **Hide the figure for a branded title** on the calculator, the car page and the dealer sheet until it is tested against sale prices (change 2 in full). Task 4 is the mild version: the figure stays and says what it is.
2. **Quote Kelley Blue Book's statement** on branded titles (change 2 asks for it). Quoting another company's text on MiCar is the owner's call, so this plan quotes and links nothing.
3. **The API for a clean title still returns a private-party figure with its range.** Change 8 says "never a midpoint value"; read strictly, that would remove the figure the API was built to give.
4. **Evidence tiers in place of the flat multipliers** (change 1). The API now names the one tier that exists, `self-declared`. The other three (file-read, documented, independently inspected) need a design of their own, and it must say how they sit beside the Garage's four levels (Registered, Documented, Verified, Certified).
5. **Name the branding state and its test** in the Rebuilt and Salvage definitions (the rest of change 3), **cause of loss** (change 5) and **accident ranges** (the rest of change 6): the calculator does not ask for any of these yet.
6. **Title-history lookups** (change 4): a paid report per car and a server call.
7. **Independent inspection, re-inspection samples, an appeal and a guarantor** (changes 7 and 8): a programme, not a wording change.

Already true, and should stay so: the grade is on no dealer sheet, no car page and no API response.
