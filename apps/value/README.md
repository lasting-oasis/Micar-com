# Nexus Valuation

**Live site:** https://lasting-oasis.github.io/queen_city_mycarvalue/

A used-car value estimator. Enter a vehicle's make, body style, original sticker price, model year, mileage, condition, title, accident history and region, and it shows:

- **Private-party value** with a likely price range
- **Trade-in offer** and **dealer retail** price, with spreads that depend on the car's price and condition
- **How the price is built**: a line-by-line breakdown from MSRP to the final number
- **Five-year forecast** with an adjustable miles-per-year slider
- **Confidence rating** that explains what widens or narrows the range
- **Market layer**: model-level resale data for ~170 common models, plus the used-car market cycle, how many similar cars are listed nearby, how fast it needs to sell, and real asking prices you've seen
- **Paste a listings page**: copy a search-results page from Facebook Marketplace, OfferUp, Craigslist, CarGurus, Autotrader or Cars.com and the app reads every price, year and mileage out of the text, adjusts the comps to your mileage and uses the page's result count as local supply
- **Live comps button** (optional): one click pulls dealer asking prices within 25–100 miles of a ZIP through a tiny Cloudflare Worker that holds a free MarketCheck key
- **Shareable links**: every input is kept in the URL

## How the market layer works

A pure depreciation formula knows what a car *should* be worth from its sticker price and age, but not whether anyone wants it. The engine handles that in four layers:

1. **Model-level resale.** `src/engine/models.ts` lists ~170 common models with the share of MSRP a typical example keeps after five years (a Toyota 4Runner ~70%, a Chevy Malibu ~44%). That number already reflects reliability reputation and demand, measured by what buyers actually paid. Unlisted models fall back to make + body style.
2. **Traits as elasticity.** Each model carries traits (`reliability`, `enthusiast`, `fleet`, `luxury`, `ev`, `truck`) that explain its resale in the UI and set how hard it reacts to oversupply and the market cycle. A fleet-heavy Buick Enclave with 40 copies listed nearby loses ~12%; a Honda Civic in the same spot loses ~5%, because there is a demand floor under it.
3. **Supply and demand inputs.** The page can't see the market, but the user can: the used-car cycle (soft / normal / tight), how many similar cars are listed nearby (undercutting), and how fast it needs to sell (priced to sell).
4. **Real comps.** Paste asking prices you've seen and the estimate shrinks toward their median (minus a typical ~4% negotiation discount), with weight `n / (n + 1.5)`, so five comps count for about three-quarters of the answer. Comps also tighten the range and anchor the five-year forecast.

The model table is a rule-of-thumb snapshot from published depreciation studies, not live listings or auction data. The natural next step is a live comps feed (MarketCheck, Auto.dev or a dealer's own inventory system) feeding the same `comps` input.

## Real sticker prices

`src/engine/stickers.ts` serves official MSRPs by model year and trim (excluding destination) from `src/data/stickers.json`. When the chosen make, model and year are on file, the Trim field becomes a picker and the MSRP box is prefilled with the real sticker; otherwise it falls back to `typicalMsrp` in `models.ts`, a rough mid-trim figure scaled 3% a year, and says so. Fifteen models are on file for 2016–2026 (Honda Civic, Accord, CR-V; Toyota Camry, Corolla, RAV4, Tacoma; Ford F-150, Explorer; Chevrolet Silverado 1500, Equinox; Nissan Altima, Rogue; Hyundai Elantra; Jeep Grand Cherokee). Each year records where the price came from: the manufacturer's own pricing release where one could be read, otherwise a published price list marked `secondary`. Pickups carry a configuration on every row, and the engine picks the crew-cab 4x4 row for a trim because that is what most used trucks are.

## Calibration against real listings

The depreciation curve and each model's five-year resale share are fitted to real asking prices rather than guessed:

1. `data/research/` holds the raw research: one sticker file and one listings file per model. The listings are a bounded sample from TrueCar (one search page per model-year for 2016, 2019, 2022 and 2024, up to 20 cars each, the volume trim: Civic LX, Camry LE, F-150 XLT, Silverado LT, and so on). Each page was read once, by hand-equivalent means, with no pagination and nothing stored beyond the sample.
2. `npm run build:data` (`scripts/build-data.ts`) merges that into `src/data/stickers.json` and `src/data/listing-samples.json`.
3. `npm run calibrate` (`scripts/calibrate.ts`) values every sampled car with its real sticker (or the typical estimate when a year has none), today's market index and the listing's region, then searches for the curve shape (`driveOff`, `decay`, trim-content retention) and per-model `residual5` that minimise the error against asking prices. Listings more than 35% off are dropped as outliers (wrecks, mislabelled trims). The result goes to `src/data/calibration.json`, which `models.ts` and `valuation.ts` apply at load.
4. `src/engine/backtest.test.ts` is the regression test: every calibrated model must stay within 12% mean absolute error and 6% median bias against its sample (20% / 15% for an uncalibrated model).

CALIBRATION_SUMMARY

What the first backtest (Civic only) found still holds and shaped the engine: used prices follow the price of a **new replacement**, so the sticker is inflated to today's dollars (3% a year) before the curve is applied, and depreciation measured that way is close to a constant percentage a year with a drive-off hit at titling. Option content depreciates faster than the base car, so trim premiums are retained at less than face value.

The whole dataset, with sources, also lives in a Google Sheet ("Queen City MyCarValue · Sticker prices and used-price calibration"): tabs for Models, Stickers, Used sample, Calibration (with live formulas over the sample) and Data Sources.

## Weekly national market snapshot

`scripts/fetch-market.mjs` pulls the Bureau of Labor Statistics CPI-U index for used cars and trucks (series `CUSR0000SETA02`, public domain, no API key; FRED is the fallback) and writes `src/data/market.json` with the year-over-year change, three-month momentum, a market index from −1 (very soft) to +1 (very tight) and a Soft / Normal / Tight reading. `.github/workflows/market.yml` runs it every Sunday, commits the file when it changes and redeploys the site. The page's "Used-car market right now" control defaults to **Auto**, which uses that reading; the ledger shows the resulting adjustment with the data month it came from.

Why not scrape listing sites for per-model prices? Cars.com, Autotrader and CarGurus all prohibit automated collection in their terms and block search pages in `robots.txt`; Facebook Marketplace and OfferUp sit behind logins and bot protection and forbid it too. The free tiers of the listings APIs (MarketCheck, Auto.dev) don't allow caching a persistent weekly dataset either. So local prices come in two ways that are in bounds: a person pastes a page they are looking at, or a person clicks a button that makes one live query.

## Paste a listings page

`src/engine/listings.ts` parses text copied from a search-results page. It finds listing titles ("2021 Buick Enclave Essence"), works out whether the page puts the price above or below the title (Marketplace vs. dealer sites), reads the nearest mileage, skips monthly payments, "Was" prices and discounts, drops other models and years more than two away, dedupes repeats, and picks up a stated total ("47 results"). Comps are adjusted to the subject car's mileage (capped ±25%) before the engine blends them in, and the stated total or a reasonably full page becomes the "similar cars nearby" count. Nothing is fetched from any site.

## Live comps (optional, two free accounts)

`worker/index.js` is a Cloudflare Worker that proxies one MarketCheck query per click and caches identical questions for three hours. MarketCheck's free plan allows 500 calls a month within a 100-mile radius and is written for exactly this kind of live, user-triggered lookup; the key never leaves the worker.

1. Sign up at marketcheck.com and copy the API key from the dashboard.
2. Sign up at dash.cloudflare.com → Workers & Pages → Create → Start with Hello World → Edit code → replace it with `worker/index.js` → Deploy.
3. In the worker's Settings → Variables and Secrets, add the secret `MARKETCHECK_KEY` and the variable `ALLOWED_ORIGIN` = `https://lasting-oasis.github.io`. Copy the worker URL (ends in `.workers.dev`).
4. In this repo: Settings → Secrets and variables → Actions → Variables → New repository variable `COMPS_URL` = the worker URL. Re-run the Deploy workflow (or push anything) and the "Pull live comps" button goes live.

Dealer inventory only; private-party listings don't appear in MarketCheck.

## What changed from v6 (the AI Studio version)

| Area | Before | Now |
|---|---|---|
| New cars | A current-year car kept 98% of MSRP | Drive-off hit when titled; depreciation slows as the car ages |
| Brand data | Raw yearly "retention" guesses | Calibrated to each make's typical 5-year residual, adjusted by body style |
| Mileage | Flat dollars per mile (same on a $20k and $200k car) | Percentage of value; low-mileage bonus capped at +12% |
| Dealer spreads | Fixed 82% / 118% | Margin scales with price; reconditioning cost by condition |
| History | Title only | Title plus accident history |
| Model data | Make only | ~190 models with 5-year resale shares (15 of them fitted to real listings) and demand traits; real stickers for 15 models, typical MSRP otherwise |
| Market | None | Market cycle (auto from a weekly BLS snapshot), local listing count, urgency, and real asking prices blended in |
| Region | None | Small regional demand adjustments (trucks, EVs, AWD) |
| Uncertainty | Single exact numbers, made-up "Market Trust %" | Price range and an explained confidence rating |
| Transparency | None | Step-by-step breakdown and methodology note |
| Inputs | No validation | Range checks with clear error messages |
| Accessibility | Unlabelled inputs, buttons without state | Linked labels, native radio groups, focus styles, reduced motion |
| Polish | "My Google AI Studio App" title, no favicon, chart axis from $0 | Real title, meta description, favicon, chart scaled to the data |

## Run it

```bash
npm install
npm run dev        # local dev server
npm test           # engine unit tests
npm run build      # production build in dist/
npm run build:single  # one self-contained HTML file in dist-single/
node scripts/fetch-market.mjs   # refresh the national market snapshot by hand
npm run build:data    # data/research/** -> src/data/stickers.json + listing-samples.json
npm run calibrate     # refit the curve and per-model resale shares -> src/data/calibration.json
npm run sheet-rows    # row arrays for the Google Sheet tabs (JSON on stdout)
```

## Project layout

```
src/engine/data.ts          Makes, body styles, condition/title/accident tables, regional rules
src/engine/models.ts        Model-level resale data, demand traits, typical MSRP
src/engine/valuation.ts     Pure valuation + forecast functions (no React)
src/engine/market.ts        Reads the weekly snapshot in src/data/market.json
src/engine/listings.ts      Parses a pasted listings page into comps
src/engine/stickers.ts      Official MSRPs by year and trim (15 models, 2016-2026)
src/engine/prefill.ts       Picks the sticker or the typical estimate for the MSRP box
src/engine/backtest.test.ts Engine vs 1,173 real listings across 15 models (regression test)
src/data/                   market.json, stickers.json, listing-samples.json, calibration.json
data/research/              Raw sticker and listings research, one JSON per model, with sources and gaps
scripts/build-data.ts       Merges data/research into src/data
scripts/calibrate.ts        Fits curve + per-model resale shares to the listings sample
scripts/sheet-rows.ts       Exports the dataset as rows for the Google Sheet
worker/index.js             Cloudflare Worker: live MarketCheck lookup (optional)
scripts/fetch-market.mjs    Weekly BLS fetch (run by .github/workflows/market.yml)
src/engine/valuation.test.ts
src/urlState.ts             Form state, validation and shareable URLs
src/App.tsx                 UI
```

The engine has no UI dependencies, so it can be reused elsewhere, for example to price inventory in the car dealer simulator.

## Deploying

Every push to `main` runs the tests, builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). `dist/` is a plain static site, so it also works on Netlify, Vercel, Cloud Run or any static host.
