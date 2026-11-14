# Platform upgrade — design

Date: 2026-11-13
Status: **proposed, waiting for the owner's yes.** Nothing has been bought, signed up for or switched. Prices were read from the providers' own pages on 2026-11-13; the one that was not (the domain) is marked.

## What this decides

Where MiCar runs, what it costs each month, and in what order to change it, so the three-worker trial (`docs/superpowers/plans/2026-11-13-trial-rules.md`) builds on the upgraded platform and not on the one being replaced.

"Most efficient" is read as: lowest monthly cost, least rework of code that already works, and no bill that can grow without a limit.

## What MiCar runs on today

Read from the repository, not assumed.

| Part | Where it runs | Cost | State |
| --- | --- | --- | --- |
| The site: door, calculator, Garage, car pages, data API | GitHub Pages, `lasting-oasis.github.io/Micar-com/` | $0 | Works. Static files only. |
| MiCar World: the 3D town, the Strip, the Dealership, MiCar Shop | One Node process (Express + socket.io) on Render's free plan, `micar-sim.onrender.com` | $0 | Sleeps after 15 minutes idle and takes about a minute to wake. |
| The World's data (`apps/sim/data/gameState.json`) | The Render instance's own disk | $0 | Wiped on every deploy and every sleep. `apps/sim/README.md` says so. |
| Accounts (emailed sign-in link through Resend, and Google) | Built and tested in `apps/sim/src/world/accounts.ts` | $0 | **Switched off in production**, on purpose, until the data stops being wiped. |
| Garage cards and passports | The visitor's own browser (`localStorage`, IndexedDB), behind `apps/value/src/garage/store.ts` | $0 | Works, on one device only. |
| The optional live-comps button | One small Cloudflare Worker (`apps/value/worker/`) | $0 | Shown only when the repository variable `COMPS_URL` is set (not checked here). The worker's configuration lets only pages from `lasting-oasis.github.io` call it. |
| Visitor counts | Cloudflare Web Analytics, wired into both apps | $0 | **Never switched on:** both tokens in `packages/brand/src/analytics.ts` are empty, so nothing is counted. |
| A domain | None | | Every address is a `github.io` or `onrender.com` one. |

## The three problems worth paying to fix

1. **The World sleeps and forgets.** A visitor waits a minute, and anything saved is gone at the next deploy.
2. **Accounts can't be turned on.** They are finished, and held back only by problem 1. Without accounts nobody has a reason to come back.
3. **MiCar has no address of its own.** That blocks a proper sender for sign-in emails, makes links look temporary, and will block the links a phone app needs.

## Approaches considered

One fact shapes all of them: **the World's server keeps every player connected over a live socket and holds the town in memory.** Firebase, Cloudflare Workers and Supabase do not run a server like that as it is built. So in every option below the World stays on a small always-on host, and that host is the only real monthly cost.

### A. Fix in place (recommended)

Pay for the Render service that already runs the World, attach a disk, buy a domain, keep the site on GitHub Pages.

- Cost: about **$8.25 a month** (see Costs).
- Rework: almost none. A few lines of `render.yaml`, then settings the owner clicks. Render's Blueprint page says that naming an existing service in the file applies the file's settings to that service, so the World is upgraded in place, not rebuilt.
- What it fixes: all three problems.
- What it does not give: a database with a console, more than one server, deploys without a few seconds offline.

### B. Firebase for sign-in, data and hosting; the World on a paid host

- Cost: the same $7 host, plus Firebase usage. Usage would likely be $0 at today's size, but the plan that MiCar would need (Blaze) is pay-as-you-go with a card on file. Google recommends budget alerts; as far as I know an alert warns and does not stop the charges.
- Why Blaze and not the free plan: emailed sign-in links are limited to **5 a day** on the free plan (25,000 on Blaze), and Cloud Functions and Cloud Storage are Blaze-only.
- Rework: replace the sign-in that already works, move the World's save file and the Garage store to Firestore, write and test security rules. Workers would need Java installed to run Firebase's local emulators.
- What it adds that A lacks: managed sign-in (Apple included), push notifications, a database console, phone-app SDKs.

### C. Cloudflare for the site, an API and data; the World on a paid host

- Cost: the same $7 host; Cloudflare's free plan covers the rest and stops at its limits instead of billing (100,000 requests a day; 10 ms of CPU per request; D1 database 5 GB).
- Rework: move the site, port the account code to Workers, build a new data layer.
- What it adds: an API at the edge, a real database, previews for every branch, all of it runnable locally with npm alone.

### D. Supabase for sign-in and data (the earlier Garage spec's choice); the World on a paid host

- Cost: the same $7 host; Supabase free to start, **$25 a month** once it must not pause (free projects pause after a week without activity) or needs backups.
- Rework: similar to B. Local development needs Docker.

## Recommendation: A now, built so B can be added later

**Do A this week.** It is the only option that fixes all three problems without replacing code that works, and it costs less than any other because every option needs the $7 host anyway.

**Firebase is the right second step, not the first.** Its strongest parts for MiCar are push notifications and managed sign-in for a phone app. Neither is needed until the app is packaged. Adding them then is cheap because:

- Accounts are an email address or a Google identity, with no passwords. Moving them to another sign-in system later is a re-link by email, not a migration of secrets.
- The Garage already keeps its storage behind one module (`garage/store.ts`). The World's save is one call in `server.ts`, made through the helpers in `world/persistence.ts`. Those two seams are where a database slots in.

### Stage 1: what changes now

1. **The World stays awake and keeps its data.** Render's smallest paid instance (plan id `0.5c-512mb`: 512 MB, $7 a month) and a 1 GB persistent disk mounted at `apps/sim/data`. Render snapshots the disk every 24 hours and keeps snapshots at least seven days.
2. **Accounts are turned on** once a deploy has been seen to keep the save file: the four secrets named in `apps/sim/README.md` are set in Render's dashboard.
3. **One domain.** The site moves to it through GitHub Pages' custom-domain setting (free). `world.<domain>` points at Render. Sign-in emails are sent from an address at the domain.
4. **A preview link for every pull request**, so a change can be opened on a phone before it is merged: a free Render static site with previews on, declared in `render.yaml`.
5. **Visitor counts are switched on**, with tokens made for the new addresses. They are built and have never been on, so today there is no number for how many people visit.
6. **The valuation API stays on the World's server.** It was placed there in PR #21 because GitHub Pages can't run code; once the server no longer sleeps, the one-minute wait goes away without moving it.

### Stage 2: what to add, and what triggers it

| Trigger | Add |
| --- | --- |
| The phone app is being packaged | Firebase Cloud Messaging for push (no-cost product), and decide on managed sign-in at the same time |
| First paying shop, or about 2,000 accounts, or deploys that interrupt races become a complaint | A managed database (Firestore or Postgres) behind the two seams, replacing the disk. This also brings back deploys with no downtime |
| Photos and receipts need to follow an account across devices | File storage (Firebase Storage, R2 or similar) |

## Costs

| Item | Monthly | Source |
| --- | --- | --- |
| Render web service, smallest paid instance `0.5c-512mb` (512 MB, never sleeps) | $7.00 | render.com/pricing, read again 2026-11-13 |
| Render persistent disk, 1 GB | $0.25 | render.com/pricing |
| Render static site with pull-request previews | $0 | render.com |
| GitHub Pages with a custom domain | $0 | docs.github.com |
| Resend for sign-in emails | $0 up to 100 emails a day and one sending domain; $20 a month beyond that | resend.com/pricing (the daily limit is on Resend's own page; reviewers reading the same page give 3,000 a month) |
| Domain | about $1 ($10–15 a year for a `.com`) | **not checked today**; the registrar shows the price at checkout |
| **Total** | **about $8.25** | |

Later costs, for planning only: Supabase Pro $25 a month; Cloudflare Workers Paid from $5 a month; Firebase Blaze by usage; Apple's and Google's developer fees for the app stores (not checked).

## What only the owner can do

These cost money or create accounts, so no worker and no assistant does them.

1. **Say yes or no to this design.**
2. **Render:** add a payment method, then merge the Foundation lane's first pull request, then apply the Blueprint in the dashboard (the $7 instance, the disk, the preview site). Merging is the yes to the monthly cost: Render may apply a changed Blueprint by itself once it reaches `main` (not confirmed in its documentation).
3. **Buy the domain.** Name is the owner's call; the spec in `claude/micar-garage-product-spec.md` notes that bare "MiCar" is taken as an app name and that a trademark search is still to do.
4. **DNS records** (the Foundation plan lists the exact ones): the apex and `www` to GitHub Pages, `world` to Render, and the records Resend shows for the sending address.
5. **Secrets, typed into Render's dashboard and nowhere else:** `MAGIC_SECRET`, `RESEND_API_KEY`, `MAGIC_FROM`, `GOOGLE_CLIENT_ID`. Never in chat, never in the repository.
6. **Three settings that name the old addresses**, changed when the domain goes live: the live-comps worker's `ALLOWED_ORIGIN` in Cloudflare; the Google sign-in client's "Authorized JavaScript origins" (only if Google sign-in is turned on); and two Cloudflare Web Analytics sites, one per new hostname, whose tokens are public and can be handed to a worker.

## Risks and open items

- **Old links and printed QR codes.** Every dealer sheet printed so far points at `lasting-oasis.github.io/Micar-com/…`. GitHub is expected to forward those to the custom domain: guides written for other projects say it does, but GitHub's own documentation does not say so plainly. Treat it as **not confirmed**, so the Foundation plan tests one old link the moment the domain is set and has a fallback (leave the site at the `github.io` address and use the domain for the World and email only).
- **A few seconds offline at each World deploy.** A disk means Render stops the old instance before starting the new one. Mitigation in Stage 1: deploy only after checks pass, and only when World code changed (the build filter already does this). Stage 2's database removes it.
- **One file for the World's save.** `gameState.json` is rewritten whole. Fine for hundreds of accounts; it is one of the Stage 2 triggers.
- **One server.** A disk cannot be shared, so the World cannot run on two instances. Acceptable before launch.
- **Render build minutes.** The free workspace includes 500 a month; three workers pushing often could pass that. With a card on file, extra minutes are billed at $5 per 1,000.
- **512 MB of memory.** Same as today's free instance, so no worse; not measured under load.
- **Preview links are for looking, not for everything.** A preview is the site only. Its World links go to the real World, and it has no live-comps button, because the preview build is not given the worker's address.

## Sources

- Render pricing and free-plan limits: https://render.com/pricing, https://render.com/docs/faq, https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses
- Render disks, snapshots and deploys: https://render.com/docs/disks, https://render.com/docs/deploys, https://render.com/docs/blueprint-spec
- Render static sites and previews: https://render.com/articles/render-vs-netlify
- Firebase plans and limits: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans, https://firebase.google.com/pricing, https://firebase.google.com/docs/auth/limits
- Cloudflare Workers, D1 and Pages limits: https://developers.cloudflare.com/workers/platform/pricing/, https://developers.cloudflare.com/workers/platform/limits/, https://developers.cloudflare.com/pages/platform/limits/
- Supabase plans: https://supabase.com/pricing, https://supabase.com/kb/faqs/platform/free-project-pausing
- GitHub Pages custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- Resend's plans: https://resend.com/pricing
