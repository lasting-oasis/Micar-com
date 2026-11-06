# Shared Site Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One footer, defined in `packages/brand`, on the door, calculator, car page, World setup screen, Shop gateway and Garage placeholder, in English and Spanish, with every link tested, and section links that land on their sections.

**Architecture:** `packages/brand/src/footer.ts` holds the links and copy as plain data, plus string renderers for static pages. Each React app has a small `Footer.tsx` that renders the same data. `pnpm site` generates the Garage page from a template.

**Tech Stack:** TypeScript, React 19 (value), React 18 (sim), vitest, tsx, bash.

**Spec:** `docs/superpowers/specs/2026-11-06-site-footer-design.md`. Read it first. It holds the link table and all exact copy.

## Global Constraints

- No dependency upgrades or additions.
- Brand colours `#ffd23f` on `#0e1217`, Barlow and Barlow Condensed, through the `--mc-*` tokens.
- Every user-facing string has English and Spanish.
- Phones first: 44px minimum tap height at 720px and under, no horizontal page scroll at 375px.
- Commits as `lasting-oasis <blueoceanlegacies@gmail.com>` (already set in this repo's config). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't re-author commits.
- Work on branch `site-footer`. Do not push or merge.
- This machine is Windows. Before any command, in PowerShell from `C:\Users\Owner\Micar-com`:
  ```powershell
  $env:Path = "$HOME\.fnm\node-versions\v22.23.4\installation;$env:Path"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'
  ```
- For `pnpm site` only, also add Git's `bin` folder and stop Git Bash rewriting paths:
  ```powershell
  $env:Path = "C:\Program Files\Git\bin;$env:Path"; $env:MSYS_NO_PATHCONV='1'
  ```

## Review Focus

1. **A hash that is neither a route nor a section** (`#nope`, `#link=abc`, `#%E0`): the page renders and nothing throws. Tests in Task 2; browser check in Task 7.
2. **Blocked or empty storage on the Garage page** (private window, `localStorage` throws): the English footer shows and nothing breaks. Test in Task 3.
3. **The longest Spanish labels on the narrowest phone** (320px and 375px): they wrap inside their column, with no sideways page scroll. Browser check in Task 7.
4. **A notched phone in landscape:** footer text stays clear of the safe area, and `bleed` cancels the real body padding rather than a fixed 16px. Test in Task 3 and Task 5.
5. **A Spanish sheet opened by an English-language browser:** the car page switches to Spanish without remembering it (`setLang('es', false)`), and the footer follows. Browser check in Task 7.

---

### Task 1: Make the sim test suite exit clean on Windows

**Files:**
- Modify: `apps/sim/src/world/serverWiring.test.ts:66`

- [ ] **Step 1: See the failure**

Run: `pnpm --filter @micar/sim test`
Expected: 151 tests pass, the suite fails with `EBUSY … rmdir`, exit 1.

- [ ] **Step 2: Add `maxRetries: 10, retryDelay: 100` to that `rmSync` call's options**

- [ ] **Step 3: Run it again**

Run: `pnpm --filter @micar/sim test`
Expected: 151/151, exit 0. Confirm no `micar-wiring-*` folder remains in `$env:TEMP`.

- [ ] **Step 4: Commit**

```bash
git add apps/sim/src/world/serverWiring.test.ts
git commit -m "test: retry the wiring test's temp cleanup, which Windows still holds locked"
```

### Task 2: Section links land on their sections

**Files:**
- Create: `apps/value/src/route.ts`
- Create: `apps/value/src/route.test.ts`
- Modify: `apps/value/src/main.tsx:15-32`
- Modify: `apps/value/src/door.css` (add scroll margin)

**Interfaces:**
- Produces, from `route.ts`, with no DOM access or side effects:
  ```ts
  export type ValueRoute = { view: 'car' | 'sticker' | 'value' | 'door'; code?: string };
  export function routeFromHash(hash: string, search: string): ValueRoute;
  export function sectionFromHash(hash: string): string | null;
  ```

- [ ] **Step 1: Write the failing tests in `route.test.ts`**

`routeFromHash`, with `search` empty unless stated:

| Input | Result |
|---|---|
| `''`, `'#grade'`, `'#nope'` | `{ view: 'door' }` |
| `'#/value'` | `{ view: 'value' }` |
| `'#/sticker'` | `{ view: 'sticker' }` (`code` undefined) |
| `'#/sticker/abc'` | `{ view: 'sticker', code: 'abc' }` |
| `'#/c/abc'`, `'#/car/abc'` | `{ view: 'car', code: 'abc' }` |
| `'#/c'` | `{ view: 'car', code: '' }` |
| `'#grade'` with search `'?make=Toyota'` | `{ view: 'value' }` |
| `'#/value?x=1'` | `{ view: 'value' }` |

`sectionFromHash`:

| Input | Result |
|---|---|
| `'#grade'` | `'grade'` |
| `'#keyholder'` | `'keyholder'` |
| `'#card-2'` | `'card-2'` |
| `'#/value'`, `'#/c/abc'`, `'#'`, `''` | `null` |
| `'#link=abc'`, `'#%E0'` | `null` |

Include a test that importing `route.ts` works with no `document` (running in vitest's Node environment proves this).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @micar/value exec vitest run src/route.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `route.ts`**

`routeFromHash` keeps the regex from `main.tsx:27` and the legacy `[?&](make|model|msrp|year)=` check from `main.tsx:16`, tested against `search`. `car` passes `code` as `m[2] ?? ''`. `sticker` passes `m[2] || undefined`. `sectionFromHash` matches `/^#([A-Za-z][\w-]*)$/`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @micar/value exec vitest run src/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Use them in `main.tsx`**

`Router` renders from `routeFromHash(hash, window.location.search)`, keeping the `try/catch` protection the old `legacyCalculatorLink` had around `window.location`. The `hashchange` listener only calls `setHash`; remove its `window.scrollTo(0, 0)`.

Add this behaviour in a `useLayoutEffect` keyed on `hash`:

```ts
const previous = useRef(hash);
useLayoutEffect(() => {
  const changed = previous.current !== hash;
  previous.current = hash;
  const id = sectionFromHash(hash);
  const el = id ? document.getElementById(id) : null;
  if (el) el.scrollIntoView();
  else if (changed) window.scrollTo(0, 0);
}, [hash]);
```

The effect lives in `Router`, so it runs after the new page's children have rendered. If Task 7's browser check shows late fonts or images moving the section, also scroll once more on `document.fonts.ready`. Do not add that unless the check shows it's needed.

- [ ] **Step 6: Add the scroll margin**

In `door.css`: `.dp section[id], .dp header[id] { scroll-margin-top: 64px; }`.

- [ ] **Step 7: Run the value tests and typecheck**

Run: `pnpm --filter @micar/value test`, then `pnpm --filter @micar/value exec tsc -b`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/value/src/route.ts apps/value/src/route.test.ts apps/value/src/main.tsx apps/value/src/door.css
git commit -m "value: section links land on their sections, on a hash change and on a fresh load"
```

### Task 3: The shared footer in `packages/brand`

**Files:**
- Create: `packages/brand/src/footer.ts`
- Create: `packages/brand/src/footer.css`
- Modify: `packages/brand/package.json` (exports, description)
- Create: `apps/value/src/footer.test.ts`
- Create: `apps/sim/src/footer.test.ts`

**Interfaces:**
- Consumes: `SITE_URL`, `WORLD_URL`, `SHOP_URL` from `./doors`; `routeFromHash` from Task 2.
- Produces, from `@micar/brand/footer`:
  ```ts
  export type FooterLang = 'en' | 'es';
  export type FooterText = Record<FooterLang, string>;
  export type FooterLink = { id: string; label: FooterText; href: string; soon?: boolean; external?: boolean };
  export type FooterColumn = { id: string; title: FooterText; blurb?: FooterText; links: FooterLink[] };
  export const REPO_URL: string;                 // https://github.com/lasting-oasis/Micar-com
  export const FOOTER_COLUMNS: FooterColumn[];
  export const FOOTER_SOON: FooterText;          // soon / pronto
  export const FOOTER_ESTIMATES: FooterText;
  export function footerCopyright(year: number): string;
  export function footerHtml(lang: FooterLang, year: number): string;
  export const GARAGE_LANG_SCRIPT: string;
  export function garagePageHtml(template: string, css: string, year: number): string;
  ```
- Produces, class names every renderer must use:
  - `mc-foot` (root, on a `<footer>`), then `mc-foot-in` holding `mc-foot-cols` and `mc-foot-legal`.
  - Each column is `mc-foot-col`, holding `<p class="mc-foot-h">`, optional `<p class="mc-foot-blurb">`, and `<div class="mc-foot-links">` with the `<a>`s.
  - The soon marker is `<em>` inside its link.
- Link ids, in order: `home`; `value`, `sheet`, `grade`; `world`, `strip`, `shop`, `garage`; `built`, `keyholder`. Column ids: `micar`, `value`, `world`, `about`.

- [ ] **Step 1: Write the failing tests**

In `apps/value/src/footer.test.ts`, importing nothing from `main.tsx` and using `?raw` rather than `node:fs`:

- `footer links match the spec's table`: the flat `[columnId, linkId, href]` list equals the spec's table exactly, as literal strings (`https://lasting-oasis.github.io/Micar-com/#grade`, and so on).
- `every label has both languages`: every title, blurb, link label, `FOOTER_SOON` and `FOOTER_ESTIMATES` has non-empty `en` and `es`.
- `exact copy`: `built.label.es === 'Cómo está hecho'`, `strip.label.es === 'Entra al Strip'`, `home.label.es === 'Inicio'`, and the blurb and estimates line in both languages as written in the spec.
- `only the source link opens a new tab, only Garage is soon`.
- `site routes resolve`: each `SITE_URL#/x` link gets a non-door view from `routeFromHash`.
- `door sections exist`: each `SITE_URL#x` link has `id="x"` in `./door/Door.tsx?raw`.
- `footerCopyright(2031)` is `© 2031 MiCar`.
- `footerHtml`:
  - `footerHtml('es', 2031)` starts with `<footer class="mc-foot">`, contains every `href`, every Spanish label and `© 2031 MiCar`, and contains no English-only label such as `The grade`.
  - `footerHtml('en', 2031)` contains `How it&#39;s built`, escaping `&`, `<`, `>`, `"` and `'` in text.
  - The source link has `target="_blank" rel="noreferrer"`.
- `garagePageHtml`:
  - With template `<style>/* css */</style><!-- footer -->`, the output has both `<footer class="mc-foot">` blocks, the Spanish block `hidden`, the css, and the script.
  - It throws when the template has no `<!-- footer -->` marker, or no `/* css */` marker.
- `GARAGE_LANG_SCRIPT`: run it with `new Function('location', 'localStorage', 'navigator', 'document', GARAGE_LANG_SCRIPT)` and fakes that record which footer was unhidden. Expect:

  | `?lang` | stored `nexus.lang` | browser | Result |
  |---|---|---|---|
  | `es` | `en` | `en-US` | Spanish |
  | none | `es` | `en-US` | Spanish |
  | none | none | `es-MX` | Spanish |
  | none | none | `en-US` | English |
  | none | `localStorage.getItem` throws | `en-US` | English, no throw |

- `footer.css`: from `@micar/brand/footer.css?raw`, expect `safe-area-inset-left`, `safe-area-inset-right`, `@media print`, and no bare `.mc-foot p` selector.

In `apps/sim/src/footer.test.ts`:

- `World links reach their views`: `world`, `strip` and `shop` hrefs, passed through `new URL(href)` then `routeFromLocation`, give `world`, `strip` and `shop`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @micar/value exec vitest run src/footer.test.ts`, then `pnpm --filter @micar/sim exec vitest run src/footer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `footer.ts`**

The data comes from the spec's table and copy. Add `"./footer": "./src/footer.ts"` and `"./footer.css": "./src/footer.css"` to the package's `exports`. Do not re-export from `doors.ts`.

`garagePageHtml` replaces `/* css */` with `css`, and `<!-- footer -->` with `<div id="mc-foot-en">…en…</div><div id="mc-foot-es" hidden>…es…</div>` plus `<script>` + `GARAGE_LANG_SCRIPT` + `</script>`. Use function replacers so `$` in CSS isn't treated as a pattern.

`GARAGE_LANG_SCRIPT` picks the language, in order: `?lang=` when it's `en` or `es`, then `nexus.lang` inside `try/catch` when it's `en` or `es`, then `/^es\b/i` on `navigator.languages?.[0] ?? navigator.language`. If Spanish, hide `#mc-foot-en` and unhide `#mc-foot-es`.

- [ ] **Step 4: Implement `footer.css`**

Port `door.css:542-548`, `:562-563` and `:666` to these rules, with all colours and fonts from `--mc-*`:

- `.mc-foot`: `box-sizing: border-box`, `--mc-night` background, `--mc-ink` text, top padding 56px, bottom padding 32px, side padding `max(16px, env(safe-area-inset-left, 0px))` and the right equivalent, top margin 40px.
- `.mc-foot .mc-foot-in`: `max-width: 1240px`, centred.
- `.mc-foot .mc-foot-cols`: grid of `1.4fr repeat(3, 1fr)`, gap 24px. At 1000px and under, two columns with the first spanning all.
- `.mc-foot .mc-foot-h`, `.mc-foot .mc-foot-blurb`, `.mc-foot .mc-foot-links a`, `.mc-foot .mc-foot-legal`, `.mc-foot .mc-foot-links em`: every rule for a child has at least two classes. Link colour is `inherit`, no underline, paint on hover. The `em` matches the strip's soon marker in `strip.css:17`.
- `.mc-foot-col { min-width: 0; }`, and `overflow-wrap: anywhere` on links and blurb, so long Spanish labels wrap.
- At 720px and under: links are `display: flex; align-items: center; min-height: 44px`.
- `@media print { .mc-foot { display: none; } }`.

- [ ] **Step 5: Run to verify they pass**

Run the two commands from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/brand apps/value/src/footer.test.ts apps/sim/src/footer.test.ts
git commit -m "brand: the shared footer's links, copy, styles and static renderers"
```

### Task 4: The footer on the door

**Files:**
- Create: `apps/value/src/Footer.tsx`
- Modify: `apps/value/src/door/Door.tsx:184,349-362`
- Modify: `apps/value/src/door.css:542-548,562-563,666`

**Interfaces:**
- Consumes: `FOOTER_COLUMNS`, `FOOTER_SOON`, `FOOTER_ESTIMATES`, `footerCopyright` and the class names from Task 3; `useLang` from `./i18n`.
- Produces: `export function Footer({ bleed }: { bleed?: boolean })` in `apps/value/src/Footer.tsx`. The root class is `mc-foot`, plus `mc-foot-bleed` when `bleed` is set. Year is `new Date().getFullYear()`.

- [ ] **Step 1: Implement `Footer.tsx`**

It renders the same structure as `footerHtml`, and imports `@micar/brand/footer.css`.

- [ ] **Step 2: Swap it into the door**

Delete Door's local `Footer` function and import the new one. The door renders `<Footer />` followed by `<div className="gutter"><div className="inner"><div className="wordmark">MiCar</div></div></div>`, keeping the giant wordmark. Remove the listed `.dp footer`, `.dp .foot*` and `.dp .legal` rules; keep `.dp .wordmark`. Leave `.wordmark`'s `margin-top` as it is.

- [ ] **Step 3: Run the value tests and build**

Run: `pnpm --filter @micar/value test`, then `pnpm --filter @micar/value build`
Expected: all pass. `i18n.test.ts` still passes, because removing `t()` calls leaves no missing keys.

- [ ] **Step 4: Check the door in the browser**

Start value's dev server through a `.claude/launch.json` entry in the repo, running `pnpm --filter @micar/value dev`. If that file would be new, do not commit it. Open the door. Expected: the four columns, the legal line and the wordmark look the same as today's door footer, with the extra links. Compare title spacing and link colour by computed style: title `margin-bottom` is 10px, and link colour matches `--mc-ink`. Toggle EN/ESP. No console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/value/src/Footer.tsx apps/value/src/door/Door.tsx apps/value/src/door.css
git commit -m "value: the door uses the shared footer"
```

### Task 5: The footer on the calculator and car page

**Files:**
- Modify: `apps/value/src/App.tsx:156-157` and the matching closing tags
- Modify: `apps/value/src/car/CarPage.tsx:152-154`
- Modify: `apps/value/src/index.css`

**Interfaces:**
- Consumes: `Footer` from Task 4.

- [ ] **Step 1: Add the bleed test to `footer.test.ts`**

`bleed cancels the body padding`: from `./index.css?raw`, `.mc-foot-bleed` has `margin-left: calc(-1 * max(16px, env(safe-area-inset-left, 0px)))` and the right equivalent, and the file does not use `100vw` in that rule.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @micar/value exec vitest run src/footer.test.ts`
Expected: FAIL on the new test.

- [ ] **Step 3: Add `.mc-foot-bleed` to `index.css`**

- [ ] **Step 4: Restructure both pages to the spec's "Page shape"**

`App` and `Shell` use the exact three-level shape in the spec, with `<Footer bleed />` as the outer element's last child. The window sheet builder is not touched.

- [ ] **Step 5: Run the value tests and build**

Run: `pnpm --filter @micar/value test`, then `pnpm --filter @micar/value build`
Expected: all pass.

- [ ] **Step 6: Check in the browser**

Open `#/value` and `#/c/notacode`. Expected: at 375px and desktop, the footer's left and right edges equal the viewport's (`getBoundingClientRect`), `document.documentElement.scrollWidth` equals `clientWidth`, the notice stays as wide as the page content, and the footer sits at the bottom of the short page. `#/sticker` has no footer.

- [ ] **Step 7: Commit**

```bash
git add apps/value/src/App.tsx apps/value/src/car/CarPage.tsx apps/value/src/index.css apps/value/src/footer.test.ts
git commit -m "value: the calculator and car page carry the footer, edge to edge"
```

### Task 6: The footer in the World and on the Garage page

**Files:**
- Create: `apps/sim/src/Footer.tsx`
- Modify: `apps/sim/src/index.css:2`
- Modify: `apps/sim/src/App.tsx:2126` (after the setup grid)
- Modify: `apps/sim/src/main.tsx:141-143` (after the `shop.footer` line)
- Modify: `tools/garage-placeholder.html`
- Create: `tools/build-garage.ts`
- Modify: `tools/build-site.sh:16`
- Modify: `apps/value/src/footer.test.ts`

**Interfaces:**
- Consumes: the data and class names from Task 3; `garagePageHtml` from Task 3; `useLang` from `apps/sim/src/i18n`.
- Produces: `export function Footer()` in `apps/sim/src/Footer.tsx`.

- [ ] **Step 1: Add the failing generator test to `footer.test.ts`**

`the Garage link's page is really built`: from `../../../tools/build-site.sh?raw`, some line that doesn't start with `#` contains `tools/build-garage.ts`, and some line contains `grep -q '<footer class="mc-foot"' site/garage/index.html`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @micar/value exec vitest run src/footer.test.ts`
Expected: FAIL on the new test.

- [ ] **Step 3: Add the World footer**

Implement `Footer.tsx` to the same structure as value's, and add `@import '@micar/brand/footer.css';` after line 2 of `index.css`. Render `<Footer />` as the last child of the setup screen's scrolling container, and after the Shop gateway's existing `<footer>`.

- [ ] **Step 4: Build the Garage generator**

Template, per the spec:
- Google Fonts links matching `apps/value/index.html:17-19`.
- A `<style>` containing `/* css */` plus the page's own rules, with the body a full-height column and the message centred in the remaining height.
- The unchanged three-line message.
- `<!-- footer -->` at the end.

`build-garage.ts` imports `garagePageHtml` from `../packages/brand/src/footer.ts`, and resolves every path from `import.meta.url`, with the repo root one level above `tools/`. It reads the template, `tokens.css` and `footer.css`, then writes `site/garage/index.html` with the current year.

Replace `build-site.sh:16` with the two lines in the spec, and update the comment on line 6 if it no longer fits.

- [ ] **Step 5: Run the tests and the site build**

Run: `pnpm --filter @micar/value test`, `pnpm --filter @micar/sim test`, `pnpm --filter @micar/sim exec tsc --noEmit`, then `pnpm site` with the extra Windows variables.
Expected: all pass, and `site/garage/index.html` has both footers. Check `git status` shows no stray output under `apps/value/site`.

- [ ] **Step 6: Check the guard catches a missing footer**

Temporarily remove the `<!-- footer -->` marker from the template and run `pnpm site`. Expected: it fails with the marker error. Restore the marker with `git checkout tools/garage-placeholder.html` only if that file is already committed; otherwise put it back by hand.

- [ ] **Step 7: Commit**

```bash
git add apps/sim/src/Footer.tsx apps/sim/src/index.css apps/sim/src/App.tsx apps/sim/src/main.tsx tools/garage-placeholder.html tools/build-garage.ts tools/build-site.sh apps/value/src/footer.test.ts
git commit -m "world, garage: the setup screen, Shop gateway and Garage placeholder carry the footer"
```

### Task 7: Full verification

**Files:** none, unless a check finds a fault. Fix faults in the owning files and commit them separately.

- [ ] **Step 1: Run every gate**

Run: `pnpm --filter @micar/sim test`, `pnpm --filter @micar/value test`, `pnpm --filter @micar/sim exec tsc --noEmit`, `pnpm --filter @micar/sim build`, `pnpm site`.
Expected: all exit 0. Test counts are at least sim 152 and value 102, plus the new tests.

- [ ] **Step 2: Browser, every page in both languages, at 320px, 375px and desktop**

Pages: door, `#/value`, `#/c/<a real code>`, `#/c/notacode`, World setup, `/shop`, and the generated Garage page served from `site/`.

Expected on each:
- The footer is present.
- `scrollWidth` equals `clientWidth`.
- Links at 720px and under are at least 44px tall.
- EN/ESP updates the footer live where the page has a switch.
- The longest Spanish labels wrap inside their column.
- No console errors.

- [ ] **Step 3: Pages that must not have it**

`#/sticker`, `/strip` and a 3D view. Expected: no `.mc-foot` element. Print emulation on `#/value` and the door: footer `display` is `none`.

- [ ] **Step 4: Section links**

On a local build:
- Set the hash to `#grade` and `#keyholder` on the door.
- Load `/#grade` fresh.
- Go from `#/c/notacode` to `#grade`.

Expected: the section heading is in view and below the sticky strip. Set the hash to `#nope` and `#link=abc`: the door renders, no console errors. Then `#/value` scrolls to the top. If a late font or image moves the section, add the `document.fonts.ready` scroll from Task 2.

- [ ] **Step 5: Spanish sheet in an English browser**

Create a sheet with language Spanish in `#/sticker`, open its car page with `nexus.lang` cleared. Expected: page and footer are both Spanish, and `nexus.lang` stays empty afterwards.

- [ ] **Step 6: Whole-branch review, then report**

Report the commands' output and screenshots. Do not merge or push. Merging waits for the user's word.
