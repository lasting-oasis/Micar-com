# Trial Lane A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/superpowers/plans/2026-11-13-trial-rules.md` first: its rules apply to every task here.

**Goal:** MiCar World stays awake and keeps its data across deploys, every pull request gets a link that opens on a phone, and MiCar's addresses live in one file so the site can move to its own domain in one small commit.

**Architecture:** Render's Blueprint (`render.yaml`) gains a paid instance, a persistent disk at the folder the server already saves to, a health check and a free static preview site. A pure `healthReport` function lets anyone see from outside that a deploy happened and whether the new boot found the save file on disk. The site is built with a relative base so one build runs at `/Micar-com/`, at a preview address and at a domain root. `packages/brand/src/doors.ts` becomes the only place an address is written, and a test fails when one is typed anywhere else.

**Tech Stack:** Render Blueprint YAML; apps/sim (Express 4.22, socket.io 4.8, vitest 2.1.9); apps/value (Vite, vitest); bash; Playwright for the existing smoke scripts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-platform-upgrade-design.md`

## Global Constraints

- No dependency additions or upgrades. Node ≥22 <23, pnpm as pinned by `packageManager`.
- Secrets are typed into Render's dashboard by the owner and appear nowhere else: `MAGIC_SECRET`, `RESEND_API_KEY`, `MAGIC_FROM`, `GOOGLE_CLIENT_ID`.
- The disk's mount path is exactly `/opt/render/project/src/apps/sim/data`. Render's Node source path is `/opt/render/project/src`; the server writes `data/gameState.json` relative to `apps/sim`.
- Every address that works today keeps working: `https://lasting-oasis.github.io/Micar-com/…` (printed QR codes point there) and `https://micar-sim.onrender.com/…`.
- `/healthz` reports counts, booleans, a boot id and the state of the save file, and nothing else: no email address, no account id, no token, no secret, no player name.
- Money and accounts are the owner's: this plan never buys, signs up or changes a dashboard setting. Steps that need the owner are marked **OWNER** and the worker stops there.
- Files this lane owns: `render.yaml`, `apps/sim/README.md`, `apps/sim/src/world/health.ts` and its test, the HTTP routes block and `DEFAULT_ORIGIN` in `apps/sim/server.ts`, `packages/brand/src/doors.ts`, `apps/value/src/addresses.test.ts`, `tools/build-site.sh`, `tools/*-redirect.html`, `tools/value-alias.html`, `.github/workflows/pages.yml`, `apps/value/vite.config.ts` (the `base` line only), the address lines of `apps/value/index.html`, and, only if Task 3 finds a fault there, the lines that use `BASE` in `apps/value/src/door/Slab.tsx`, `door/Door.tsx`, `garage/CollectibleCard.tsx` and `garage/back.ts`. In Part 2 only: the address lines of `apps/value/src/seo/pages.ts`, `apps/value/src/seo/api.ts`, `apps/value/src/api/valueApi.ts`, `apps/value/src/door/Door.tsx` (the Strip link, line 253) and `packages/brand/src/analytics.ts`. In Part 3 only: `apps/value/worker/wrangler.toml`, `README.md` and `apps/value/README.md` (address lines).
- Checks before every boss submission: `pnpm --filter @micar/sim exec tsc --noEmit`, `pnpm --filter @micar/sim test`, `pnpm --filter @micar/value test`, `pnpm site`.

## Review Focus

1. **A fresh disk with no save file yet.** `/healthz` must answer 200 with `saveAtBoot: 'missing'` and `savedSecondsAgo: null`, not crash or report a stale time → Task 1 test "a fresh disk has no save yet".
2. **Health output that leaks.** Someone adds a field later and an email or id slips out → Task 1's first test asserts the exact key set.
3. **The site opened under a sub-path and at a root from the same build.** A leading-slash asset path works in one and 404s in the other → Task 3 serves one build at both and runs the smoke scripts against each.
4. **An address typed into a new file after this plan.** → Task 4's test scans the source tree and fails on any stray host.
5. **An old printed QR link after the domain switch.** → Task 5 Step 6 opens a real old link and has a written fallback.

---

## Part 1 — one pull request, branch `lane-a/platform`

### Task 1: Health report

**Files:**
- Create: `apps/sim/src/world/health.ts` (beside `persistence.ts` and `accounts.ts`, the World's other server modules)
- Test: `apps/sim/src/world/health.test.ts`
- Modify: `apps/sim/server.ts` (the import under the `persistence.js` import, the save callback inside `coalescingSaver`, and one route directly **above** `app.get('/api/caps'…)`; pull request #21 adds its own import and route a few lines lower, and these positions keep the two from colliding)

**Interfaces:**
- Produces: `healthReport(input: HealthInput): HealthReport` where
  `SaveAtBoot = 'loaded' | 'missing' | 'quarantined' | null` (the `kind` that `loadOrQuarantine` returned at boot; `null` until the load has finished),
  `HealthInput = { bootedAt: number; now: number; saveAtBoot: SaveAtBoot; savedAt: number | null; accounts: number; players: number; caps: { google: boolean; magic: boolean } }` and
  `HealthReport = { ok: true; bootId: string; upSeconds: number; saveAtBoot: SaveAtBoot; savedSecondsAgo: number | null; accounts: number; players: number; signIn: { google: boolean; magic: boolean } }`.
  `bootId` is `bootedAt.toString(36)`: it changes on every boot, which is how a deploy is seen from outside. `saveAtBoot` is the proof of persistence: after a deploy it is `loaded` only if the save file outlived the old instance. The counts cannot prove it, because the server saves every 15 seconds, drops its players at every boot, and has no accounts while they are switched off.
- Produces: `GET /healthz` → 200, `Cache-Control: no-store`, the report as JSON.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { healthReport } from './health';

const base = { bootedAt: 1_000_000, now: 1_090_000, saveAtBoot: 'loaded' as const, savedAt: 1_060_000, accounts: 3, players: 2, caps: { google: false, magic: true } };

describe('healthReport', () => {
  it('reports exactly these eight things and nothing else', () => {
    expect(healthReport(base)).toEqual({ ok: true, bootId: (1_000_000).toString(36), upSeconds: 90, saveAtBoot: 'loaded', savedSecondsAgo: 30, accounts: 3, players: 2, signIn: { google: false, magic: true } });
  });
  it('a fresh disk has no save yet', () => {
    const r = healthReport({ ...base, saveAtBoot: 'missing', savedAt: null });
    expect(r.saveAtBoot).toBe('missing');
    expect(r.savedSecondsAgo).toBeNull();
  });
  it('a clock that runs backwards never reports negative time', () => {
    const r = healthReport({ ...base, now: 900_000 });
    expect(r.upSeconds).toBe(0);
    expect(r.savedSecondsAgo).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @micar/sim exec vitest run src/world/health.test.ts`
Expected: FAIL, cannot find `./health`.

- [ ] **Step 3: Implement `healthReport` in `apps/sim/src/world/health.ts`** (whole seconds, floored, never below 0).

- [ ] **Step 4: Wire it into `server.ts`**

  - A module-level `const BOOTED_AT = Date.now();`, `let lastSavedAt: number | null = null;` (set to `Date.now()` on the line after `writeAtomic` resolves inside the existing saver) and `let saveAtBoot: SaveAtBoot = null;` (set to `loaded.kind` in `loadGameState`, on the line after `loadOrQuarantine` returns).
  - `app.get('/healthz', …)` directly above `/api/caps`, passing `Object.keys(gameState.accounts ?? {}).length`, `Object.keys(gameState.players).length`, and `{ google: CAPS.google, magic: CAPS.magic }`. Never pass `CAPS.googleClientId`.

- [ ] **Step 5: Run the tests and the type check**

Run: `pnpm --filter @micar/sim exec vitest run src/world/health.test.ts && pnpm --filter @micar/sim exec tsc --noEmit`
Expected: 3 passed; no type errors.

- [ ] **Step 6: See it answer**

Run: `cd apps/sim && (PORT=3920 NODE_ENV=production npx tsx server.ts &) ; sleep 8; curl -s localhost:3920/healthz`
Expected: one line of JSON with exactly the eight keys of `HealthReport`. `saveAtBoot` is `missing` in a folder that has never run the server, and `loaded` the next time.

- [ ] **Step 7: Commit** — `git add apps/sim/src/world/health.ts apps/sim/src/world/health.test.ts apps/sim/server.ts && git commit -m "World: /healthz reports boot, save age and counts"`

### Task 2: Blueprint — paid instance, disk, health check, preview site

**Files:**
- Modify: `render.yaml`
- Modify: `apps/sim/README.md` (the section "Deploy (Render) and accounts")

**Interfaces:**
- Consumes: `GET /healthz` from Task 1.

- [ ] **Step 1: Change the `micar-sim` service in `render.yaml`**

  - `plan: free` → `plan: 0.5c-512mb` (Render's id for its smallest paid instance: 512 MB, $7 a month. Render's Blueprint and pricing pages, read on 2026-11-13, list no plan called "starter".)
  - directly under it, add `healthCheckPath: /healthz`
  - directly under that, add the disk. Keep all three above `buildCommand`: pull request #21 adds a line to `buildFilter`, further down, and the two changes must not touch.

```yaml
    disk:
      name: micar-data
      mountPath: /opt/render/project/src/apps/sim/data
      sizeGB: 1
```

- [ ] **Step 2: Add the preview site as a second service**

```yaml
  # The public site, built the same way as GitHub Pages builds it, for one purpose: a link per pull request
  # that opens on a phone. Production stays on GitHub Pages.
  - type: web
    name: micar-site-preview
    runtime: static
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm site
    staticPublishPath: ./site
    previews:
      generation: automatic
    buildFilter:
      paths:
        - apps/value/**
        - packages/**
        - tools/**
        - pnpm-lock.yaml
        - render.yaml
```

- [ ] **Step 3: Rewrite the gate in `apps/sim/README.md`**

It must now say, in this order: the service runs on Render's smallest paid instance (`0.5c-512mb`, $7 a month) with a 1 GB disk mounted at `apps/sim/data`; Render snapshots the disk daily and keeps snapshots at least seven days; a deploy takes the World offline for a few seconds because of the disk; and the gate itself, reworded: **set the four secrets only after a deploy has given `/healthz` a new `bootId` with `saveAtBoot` reading `loaded`.** Keep the three bullets that explain each secret.

- [ ] **Step 4: Check the file still reads as a Blueprint**

Run: `grep -n "plan: 0.5c-512mb\|mountPath: /opt/render/project/src/apps/sim/data\|healthCheckPath: /healthz\|name: micar-site-preview\|generation: automatic" render.yaml | wc -l`
Expected: `5`

- [ ] **Step 5: Commit** — `git add render.yaml apps/sim/README.md && git commit -m "Render: paid instance, data disk, health check, preview site per pull request"`

### Task 3: One build of the site runs at any address

**Files:**
- Modify: `tools/build-site.sh` (the `BASE_PATH=/Micar-com/ pnpm --filter @micar/value build` line)
- Modify: `apps/value/vite.config.ts` only if `base` needs a different default
- Modify: any of `apps/value/src/door/Slab.tsx`, `door/Door.tsx`, `garage/CollectibleCard.tsx`, `garage/back.ts` that turn out to assume `BASE_URL` starts with `/`
- Modify: `tools/value-alias.html`, `tools/*-redirect.html` only where they hard-code `/Micar-com/`

**Interfaces:**
- Produces: `site/` whose every link to its own files is relative, so the same folder works under `/Micar-com/`, at a preview address and at a domain root.

- [ ] **Step 1: Write the check first, and see it fail on today's build**

Run: `pnpm site && grep -c '"/Micar-com/' site/index.html`
Expected today: a number above 0. That is the failure this task removes.

- [ ] **Step 2: Build with a relative base**

In `tools/build-site.sh` change the build line to `BASE_PATH="${BASE_PATH:-./}" pnpm --filter @micar/value build`.

- [ ] **Step 3: Rebuild and check**

Run: `pnpm site && grep -c '"/Micar-com/' site/index.html; grep -c '="\./assets/' site/index.html`
Expected: `0`, then a number above 0.

- [ ] **Step 4: Serve the one build at both kinds of address and run the smoke scripts against each**

```bash
rm -rf /tmp/mc && mkdir -p /tmp/mc/root /tmp/mc/sub/Micar-com && cp -r site/. /tmp/mc/root/ && cp -r site/. /tmp/mc/sub/Micar-com/
(cd /tmp/mc/root && python3 -m http.server 8801 >/dev/null 2>&1 &) ; (cd /tmp/mc/sub && python3 -m http.server 8802 >/dev/null 2>&1 &)
```

Read `apps/value/e2e/card-back.smoke.mjs` and `every-card.smoke.mjs` for how they take a base address, then run both against `http://localhost:8801/` and against `http://localhost:8802/Micar-com/`.
Expected: both scripts pass at both addresses. Also open, at both, `…/cars/honda-civic/` and `…/value/`: the first shows the page, the second lands on the door with the hash kept.

- [ ] **Step 5: Fix what Step 4 finds**, one file at a time, re-running Step 4 after each. A path built as `` `${BASE}cards/…` `` is already correct; a path that starts with a bare `/` is not.

- [ ] **Step 6: Run the full checks from Global Constraints, then commit** — `git commit -am "Site: one build runs under any address (relative base)"`

- [ ] **Step 7: Boss, then pull request.** Submit Part 1 to the boss with `Visual: no`. Open the pull request "Platform: World keeps its data, preview links, address-independent site". Do not merge.

- [ ] **Step 8: OWNER** — add a payment method in Render **before** merging this pull request, then merge, then open the Blueprint in Render's dashboard and apply it ("Manual sync" if it has not applied itself). Merging is the yes to about $7.25 a month: Render may apply a changed Blueprint by itself once it reaches `main` (not confirmed in Render's documentation). Render lists what it will change before it does it. It should say it will **update** the existing `micar-sim` and **create** `micar-site-preview`. If it offers to create a second `micar-sim`, cancel and tell the worker. Then tell the worker it is applied.

- [ ] **Step 9: Prove persistence on the real service**

Run: `curl -s https://micar-sim.onrender.com/healthz` and note `bootId`. The first boot on the new, empty disk says `"saveAtBoot":"missing"`; that is expected. Wait a minute, so a save has been written, then ask the owner to press "Manual Deploy" once. Run it again when the deploy is live.
Expected: `bootId` changed and `saveAtBoot` is `loaded`. That is the proof: the new instance found the file the old one wrote. Also expected: the first response came back in under two seconds, because the service no longer sleeps. Write both responses into the pull request as a comment.
If `saveAtBoot` is `missing` again, the disk is not where the server saves: stop and tell the owner, and do not turn accounts on.

---

## Part 2 — one pull request, branch `lane-a/addresses`. Start only after PR #21 is merged.

### Task 4: One address book

**Files:**
- Test: `apps/value/src/addresses.test.ts` (create)
- Modify: `packages/brand/src/doors.ts` (stays the only place `SITE_URL` and `WORLD_URL` are written)
- Modify: `apps/value/src/seo/pages.ts`, `apps/value/src/seo/api.ts`, `apps/value/src/api/valueApi.ts`, `apps/value/src/door/Door.tsx`, `packages/brand/src/analytics.ts`, `apps/sim/server.ts` (`DEFAULT_ORIGIN`)

**Interfaces:**
- Consumes: `SITE_URL`, `WORLD_URL` from `@micar/brand` (both end in `/`).
- Produces: `pages.ts` keeps exporting `SITE_URL` (re-exported from `@micar/brand`) so no importer changes; `api.ts` builds `VALUE_API_URL` as `` `${WORLD_URL}api/v1/value` ``; `valueApi.ts` drops its own `APP_URL` for `SITE_URL`; `Door.tsx` builds the Strip link as `` `${WORLD_URL}strip` ``; `server.ts` sets `DEFAULT_ORIGIN` to `WORLD_URL` without its trailing slash. Two files name a host only in a comment (`packages/brand/src/analytics.ts` lines 6–7, `seo/pages.ts` line 6): reword each comment to point at `doors.ts`.
- This test was run against `main` on 2026-11-13: tests 1 and 3 pass and test 2 lists `apps/value/src/door/Door.tsx`, `apps/value/src/seo/pages.ts`, `packages/brand/src/analytics.ts` and `apps/sim/server.ts`. Once pull request #21 is merged it will also list `apps/value/src/seo/api.ts` and `apps/value/src/api/valueApi.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_URL, WORLD_URL } from '@micar/brand';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const HOSTS = ['lasting-oasis.github.io', 'micar-sim.onrender.com'];
// Plain HTML and config can't import a constant; they are checked against the address book below instead.
const STATIC = ['apps/value/index.html', 'tools/strip-redirect.html', 'tools/tuner-redirect.html', 'tools/value-alias.html'];
const SKIP = [/node_modules/, /\/dist\//, /^site\//, /\.test\.[tj]sx?$/, /^packages\/brand\/src\/doors\.ts$/, /^apps\/(explainer|tuner)\//, /^apps\/value\/(worker|tools)\//, /^assets\//, /^docs\//];
const DIRS = ['apps/value/src', 'apps/sim/src', 'packages', 'tools'];
const FILES = ['apps/sim/server.ts', ...STATIC];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(root, p).split('\\').join('/');
const all = [...DIRS.flatMap((d) => walk(join(root, d))), ...FILES.map((f) => join(root, f))].map(rel).filter((p) => !SKIP.some((s) => s.test(p)));

describe('addresses', () => {
  it('the address book has two addresses that end in a slash', () => {
    for (const u of [SITE_URL, WORLD_URL]) { expect(u.endsWith('/')).toBe(true); expect(() => new URL(u)).not.toThrow(); }
  });
  it('no code file types a MiCar host: import it from @micar/brand', () => {
    const strays = all.filter((p) => !STATIC.includes(p) && /\.(ts|tsx|js|mjs|sh|ya?ml)$/.test(p)).filter((p) => HOSTS.some((h) => readFileSync(join(root, p), 'utf8').includes(h)));
    expect(strays).toEqual([]);
  });
  it('every MiCar address in a plain HTML file is one from the address book', () => {
    for (const p of STATIC) {
      const text = readFileSync(join(root, p), 'utf8');
      for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+(?:\/[^"'\s<)]*)?/g)) {
        if (HOSTS.some((h) => m[0].includes(h))) expect(m[0].startsWith(SITE_URL) || m[0].startsWith(WORLD_URL), `${p}: ${m[0]}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and see the second test fail**

Run: `pnpm --filter @micar/value exec vitest run src/addresses.test.ts`
Expected: FAIL, listing the files that type a host.

- [ ] **Step 3: Replace each stray with an import**, as the Interfaces block says. Change nothing else in those files.

- [ ] **Step 4: Run the test and the full checks**

Run: `pnpm --filter @micar/value exec vitest run src/addresses.test.ts` then the Global Constraints checks.
Expected: 3 passed; everything else as before. `site/llms.txt` and `site/api/v1/openapi.json` must read exactly as they did (compare with `git stash` builds or `diff -r` against a build of `main`).

- [ ] **Step 5: Stop saying the World sleeps, if it no longer does.** Only if Part 1 Step 9 has passed: remove the sentence "Free hosting: the first call after a quiet spell can take up to a minute." from `seo/api.ts` (the `/value` server description) and from the "Valuation API (live)" paragraph in `seo/pages.ts`. If Step 9 has not passed yet, leave both and say so in the pull request.

- [ ] **Step 6: Commit, boss, pull request** "One address book: every MiCar address comes from @micar/brand". Do not merge.

---

## Part 3 — one pull request, branch `lane-a/domain`. Start only when the owner has bought the domain and named it.

### Task 5: Move to the domain

**Files:**
- Modify: `packages/brand/src/doors.ts`, `apps/value/index.html`, `tools/strip-redirect.html`, `tools/tuner-redirect.html`, `render.yaml` (`domains:` on `micar-sim`), `apps/sim/README.md`, `apps/value/worker/wrangler.toml`, `README.md`, `apps/value/README.md`

**Interfaces:**
- Consumes: the domain the owner names, written here as `<domain>`.
- Produces: `SITE_URL = 'https://<domain>/'`, `WORLD_URL = 'https://world.<domain>/'`.

- [ ] **Step 1: OWNER — DNS records** (at the registrar or DNS host; with Cloudflare DNS, set them to "DNS only" so GitHub and Render can issue certificates):

| Name | Type | Value |
| --- | --- | --- |
| `@` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `www` | CNAME | `lasting-oasis.github.io` |
| `world` | CNAME | `micar-sim.onrender.com` |
| as Resend shows | TXT / CNAME | the records Resend lists when the domain is added there |

- [ ] **Step 2: Change the two addresses in `doors.ts` and the addresses in the HTML files.** Add `<domain>` to `HOSTS` in `addresses.test.ts`, so the test guards the new address as it guards the old ones. That test is this step's test: it fails until every address matches.

- [ ] **Step 3: Add under `micar-sim` in `render.yaml`:** `domains: [world.<domain>]`. Leave the `onrender.com` address reachable.

- [ ] **Step 3a: Let the comps lookup answer the new address.** The "live comps" button (shown only when the repository variable `COMPS_URL` is set) calls a Cloudflare Worker that refuses any page whose origin is not on its list. In `apps/value/worker/wrangler.toml` change `ALLOWED_ORIGIN` to `"https://<domain>,https://www.<domain>,https://lasting-oasis.github.io"` (the worker already splits the value on commas). **OWNER:** set the same value on the worker in Cloudflare's dashboard (Worker → Settings → Variables), or the button answers "Origin not allowed" on the new domain.

- [ ] **Step 3b: Update the addresses people read:** the table of doors in `README.md` and the links in `apps/value/README.md`. Leave `apps/explainer/`, `apps/tuner/`, `apps/value/tools/merge-kit/`, `assets/` and old plans in `docs/` alone: they are records of what was, or are no longer deployed.

- [ ] **Step 4: Run the full checks; confirm** `grep -c "<domain>" site/sitemap.xml` is above 500 and `grep -c "github.io" site/llms.txt` is `0`.

- [ ] **Step 5: Commit, boss, pull request** "MiCar moves to <domain>". Do not merge.

- [ ] **Step 6: OWNER, right after merging:** GitHub → repository Settings → Pages → Custom domain → `<domain>` → Save, then tick "Enforce HTTPS" when it is offered. Render → apply the Blueprint. Cloudflare → the worker's `ALLOWED_ORIGIN` from Step 3a.

- [ ] **Step 7: Test the old addresses, the same hour**

Open, on a phone: an old dealer-sheet link of the form `https://lasting-oasis.github.io/Micar-com/value/#/c/<code>` (take a real one from a printed sheet or build one in `#/sticker`), `https://lasting-oasis.github.io/Micar-com/cars/honda-civic/`, and `https://micar-sim.onrender.com/strip`.
Expected: each ends on the same content, at the new domain or the old address.
**If an old `github.io` link shows a 404:** remove the custom domain in GitHub's settings at once (the old addresses work again), revert this pull request, and tell the owner. The fallback is to keep the site at `github.io` and use the domain for the World and for email only.

### Task 6: Turn accounts on

- [ ] **Step 1: Confirm Part 1 Step 9 passed** (a new `bootId` with `saveAtBoot` reading `loaded`, after a deploy). Do not go on without it.
- [ ] **Step 2: OWNER — in Resend:** add `<domain>`, add the DNS records it shows, wait for "verified".
- [ ] **Step 3: OWNER — in Render's dashboard, Environment:** set `MAGIC_SECRET` (a long random value the owner generates), `RESEND_API_KEY`, `MAGIC_FROM` (for example `MiCar <signin@<domain>>`), and `GOOGLE_CLIENT_ID` if Google sign-in is wanted now. For Google sign-in, also add `https://world.<domain>` to that client's "Authorized JavaScript origins" in Google Cloud Console; the sign-in button does not work from an origin that is not listed there.
- [ ] **Step 4: Check from outside**

Run: `curl -s https://world.<domain>/healthz`
Expected: `"signIn":{"google":…,"magic":true}`.

- [ ] **Step 5: OWNER — sign in once** from the Strip with an emailed link, reload, and confirm the account is still signed in. Then ask for one manual deploy and reload again.
Expected: still the same account, same money. `/healthz` shows `accounts` one higher than before, and unchanged by the deploy.

### Task 7 (optional): Switch visitor counts on

Counting is built (`packages/brand/src/analytics.ts`, Cloudflare Web Analytics, no cookies) but has never been on: both tokens in `ANALYTICS_TOKENS` are empty, and an empty token loads nothing. A token belongs to one hostname, so the time to make them is now, for the final addresses.

- [ ] **Step 1: OWNER — in Cloudflare:** Analytics & Logs → Web Analytics → Add a site, once for `<domain>` and once for `world.<domain>`. Copy each token (32 letters and digits). A token is public, since it ships in the page: it may be sent in chat and committed.
- [ ] **Step 2: Paste them** into `ANALYTICS_TOKENS` as `door` and `world`. `apps/sim/src/analytics.test.ts` already checks the wiring, and that anything but a 32-character token loads nothing.
- [ ] **Step 3: Run the full checks, commit, boss, pull request** "Visitor counts on, for the new addresses". Do not merge.
- [ ] **Step 4: After the merge,** open the site and the World once each, then look for the two visits in Cloudflare (they can take a few minutes to show).
