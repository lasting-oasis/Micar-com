# Nexus Valuation

A used-car value estimator. Enter a vehicle's make, body style, original sticker price, model year, mileage, condition, title, accident history and region, and it shows:

- **Private-party value** with a likely price range
- **Trade-in offer** and **dealer retail** price, with spreads that depend on the car's price and condition
- **How the price is built**: a line-by-line breakdown from MSRP to the final number
- **Five-year forecast** with an adjustable miles-per-year slider
- **Confidence rating** that explains what widens or narrows the range
- **Shareable links**: every input is kept in the URL

Estimates come from rule-of-thumb depreciation for each brand and body style. They are not based on live listings or auction data.

## What changed from v6 (the AI Studio version)

| Area | Before | Now |
|---|---|---|
| New cars | A current-year car kept 98% of MSRP | Drive-off hit when titled; depreciation slows as the car ages |
| Brand data | Raw yearly "retention" guesses | Calibrated to each make's typical 5-year residual, adjusted by body style |
| Mileage | Flat dollars per mile (same on a $20k and $200k car) | Percentage of value; low-mileage bonus capped at +12% |
| Dealer spreads | Fixed 82% / 118% | Margin scales with price; reconditioning cost by condition |
| History | Title only | Title plus accident history |
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
```

## Project layout

```
src/engine/data.ts          Makes, body styles, condition/title/accident tables, regional rules
src/engine/valuation.ts     Pure valuation + forecast functions (no React)
src/engine/valuation.test.ts
src/urlState.ts             Form state, validation and shareable URLs
src/App.tsx                 UI
```

The engine has no UI dependencies, so it can be reused elsewhere, for example to price inventory in the car dealer simulator.

## Deploying

`dist/` is a static site: it works on GitHub Pages, Netlify, Vercel, Cloud Run or any static host.
