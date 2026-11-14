// The plain-HTML pages that say what MiCar is and how a value is worked out, for readers that run no JavaScript
// (search engines, AI readers), and the two data files beside them:
//   about/index.html              the calculator, the Garage (MiCar ID, passport, grade, card), the World, dealers, shops,
//                                 and what is and is not checked today
//   method/index.html             every input and step of a valuation, and its measured error model by model
//   api/v1/method.json            the same multipliers and errors as data
//   api/v1/passport.schema.json   the format of the public view of one car's passport
// Every figure on these pages is read from the tables the engines themselves use, so a page cannot drift from the code.
// They describe what is true today: nothing here is independently verified, and the pages must say so.
import {
  ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, CERTIFICATION_LEVELS, EVENT_TYPE_LABELS, GRADE_CATEGORIES, GRADE_CATEGORY_LABELS, GRADE_FORMULA,
  GRADE_WEIGHTS, LEVEL_LABELS, LEVEL_SUMMARIES, OWNER_CEILING, RARITY_TIERS, ATTESTATION_SCOPE_LABELS, BODY_CLASSES,
} from '@micar/engine';
import type { AttachmentKind, CardFinish } from '@micar/engine';
import { ACCIDENTS, CONDITIONS, TITLES, optionLabel } from '../engine/data';
import { ASKING_TO_SALE, CURVE, MARKET_SWING, MILES_PER_YEAR, TYPICAL_LISTINGS, URGENCY_DISCOUNT } from '../engine/valuation';
import { appLang, langDir, tr, type Lang } from './lang';
import { ABOUT_URL, METHOD_URL, SITE_URL, escapeHtml, otherLanguage, pageUrl, shell, type PageEnv } from './pages';

const WORLD = 'https://micar-sim.onrender.com/';
const API = `${SITE_URL}api/v1/`;
const VALUE_API = `${WORLD}api/v1/value`;

/** One model's fit in calibration.json: how many listings, and how far the engine lands from them. */
export type Fit = { make: string; model: string; n: number; dropped: number; residual5: number; mae: number; medianBias: number };
export type Calibration = { fittedAt: string; models: Fit[] };
/** What the build knows about the published data. */
export type SiteCounts = { models: number; makes: number; modelYears: number; trims: number; manufacturerYears: number };

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;
const mult = (m: number) => (m === 1 ? 'no change' : `${m > 1 ? '+' : '−'}${Math.abs((m - 1) * 100).toFixed(1).replace(/\.0$/, '')}%`);

/** The totals of the fit, worked out from the file itself. */
export function fitTotals(c: Calibration) {
  const listings = c.models.reduce((n, m) => n + m.n, 0);
  const dropped = c.models.reduce((n, m) => n + m.dropped, 0);
  const mae = listings ? c.models.reduce((s, m) => s + m.mae * m.n, 0) / listings : 0;
  const worst = c.models.reduce((a, b) => (b.mae > a.mae ? b : a), c.models[0]);
  const best = c.models.reduce((a, b) => (b.mae < a.mae ? b : a), c.models[0]);
  return { models: c.models.length, listings, dropped, mae, worst, best };
}

const crumbs = (lang: Lang, here: string, path: string) => `<p class="crumbs"><a href="${homeOf(lang)}${appLang(lang)}">MiCar</a> › ${escapeHtml(here)} · ${otherLanguage(lang, pageUrl(lang === 'es' ? 'en' : 'es', path))}</p>`;
/** From a page one folder deep to the site's root: about/ is one level down, es/about/ two. */
const homeOf = (lang: Lang) => (lang === 'es' ? '../../' : '../');
const n = (x: number) => x.toLocaleString('en-US');

export function aboutPageHtml(counts: SiteCounts, cal: Calibration, env: PageEnv, lang: Lang = 'en'): string {
  const t = tr(lang);
  const fit = fitTotals(cal);
  const home = homeOf(lang), app = `${home}${appLang(lang)}`, here = `${home}${langDir(lang)}`;
  const yes = t('Yes'), notYet = t('Not yet: no verifier is connected');
  const grade = GRADE_CATEGORIES.map((k) => `<tr><td>${escapeHtml(t(GRADE_CATEGORY_LABELS[k]))}</td><td>${pct(GRADE_WEIGHTS[k])}</td><td>${t('{points} of 100', { points: OWNER_CEILING[k] })}</td></tr>`).join('\n');
  const levels = CERTIFICATION_LEVELS.map((l) => `<tr><td>${escapeHtml(t(LEVEL_LABELS[l]))}</td><td>${escapeHtml(t(LEVEL_SUMMARIES[l]))}</td><td>${l === 'registered' || l === 'documented' ? yes : notYet}</td></tr>`).join('\n');
  const entries = Object.entries(EVENT_TYPE_LABELS).filter(([k]) => !['registered', 'transfer', 'attestation', 'void'].includes(k)).map(([, v]) => t(v).toLowerCase()).join(', ');
  const schema = `${API}passport.schema.json`;
  const body = `${crumbs(lang, t('What MiCar is'), 'about/')}
<h1>${t('What MiCar is')}</h1>
<p>${t('MiCar (said MEE-car) treats a car as an asset with a record. You type a car and get its value; you park it in the Garage and it becomes a card with its own MiCar ID, a passport of its history and a grade; and the card\'s car can be driven in MiCar World, a 3D town. It is free and needs no account.')}</p>
<p>${t("<strong>What is checked today: nothing.</strong> Every fact about a single car on MiCar (its mileage, condition, title, accidents, records) is what its owner states, with or without files attached. MiCar has checked no record, inspected no car and connected no inspector, shop or data provider. The grade and the levels below are built so that an owner's word alone can only go so far, and the pages say where that limit is.")}</p>

<h2 id="value">${t('Value a car')}</h2>
<p>${t("A free calculator for {models} models from {makes} makes. It gives today's trade-in, private-party and dealer retail value, a price range, a confidence level with its reasons, the build-up line by line, and a five-year forecast. It starts from the car's original window-sticker price (MiCar holds {trims} trim prices across {years} model years) and adjusts for age, mileage, condition, title, reported accidents, region and the used-car market, and for local supply and asking prices when you give them.", { models: counts.models, makes: counts.makes, trims: n(counts.trims), years: n(counts.modelYears) })}</p>
<p>${t('The values are estimates, not offers and not appraisals. For {fitted} models the resale curve is fitted to {listings} real asking prices, with an average miss of {mae}; for the others it rests on published resale figures or on the make and body style. <a href="{method}">How a value is worked out, and how far off it can be</a>.', { fitted: fit.models, listings: n(fit.listings), mae: pct(fit.mae, 1), method: `${here}method/` })}</p>
<p><a class="cta" href="${app}#/value">${t('Open the calculator')}</a></p>
<p class="muted">${t('Browse <a href="{cars}">every car MiCar can value</a>, with each trim\'s original MSRP, the EPA\'s engine and drivetrain configurations and the price source.', { cars: `${here}cars/` })}</p>

<h2 id="garage">${t('The Garage: one car, one record')}</h2>
<p>${t('Park a car in the Garage and it gets:')}</p>
<ul>
<li>${t('<strong>A MiCar ID</strong>, written <code>MC-XXXX-XXXX-XXXC</code>. It is random, with a check character so a mistyped ID is refused. It is never made from the VIN, and it stays with the car when the owner changes.')}</li>
<li>${t("<strong>A specification sheet</strong> where every figure carries its source: the manufacturer, a government agency (the EPA's vehicle file), a named test, reference data, or the owner. A figure nobody has is left blank, never invented.")}</li>
<li>${t('<strong>Seven attributes</strong> scored 0 to 1000 from that specification ({attributes}) and a Power Rating, their average. Modifications and wear move them, each change shown with its evidence.', { attributes: ATTRIBUTE_KEYS.map((k) => t(ATTRIBUTE_LABELS[k])).join(', ') })}</li>
<li>${t('<strong>A passport</strong>: a history that is only ever added to. Entries are {entries}, each with photographs, receipts or reports attached if the owner has them. It keeps an odometer log that flags a reading lower than an earlier one, and the chain of owners.', { entries: escapeHtml(entries) })}</li>
<li>${t('<strong>A grade</strong> from 1 to 10, worked out from the passport and nothing else. When the record changes, so does the grade.')}</li>
<li>${t('<strong>A collectible card</strong> with a rarity tier, a finish that follows the grade, and a numbered edition for each level the car reaches. No price is ever printed on a card, and nothing in a race changes a grade.')}</li>
</ul>
<p>${t("<strong>Where it is kept:</strong> in the visitor's own browser, and nowhere else. Nothing is uploaded and accounts are not open yet, so a car parked on one device is not on another, and nobody can look a car up on MiCar by its VIN or its MiCar ID. An owner can download the passport as a file and hand a car over to another Garage.")}</p>
<p><a class="cta" href="${app}#/garage">${t('Open the Garage')}</a></p>

<h3 id="grade">${t('The grade ({formula})', { formula: escapeHtml(GRADE_FORMULA) })}</h3>
<p>${t('Five parts, each scored 0 to 100, weighted and divided by ten. The last column is the most an owner can reach alone, without an independent check.')}</p>
<table>
<thead><tr><th>${t('Part')}</th><th>${t('Weight')}</th><th>${t("Most an owner's own word and files can score")}</th></tr></thead>
<tbody>
${grade}
</tbody>
</table>
<p>${t("So a grade earned on an owner's records alone has a ceiling, and the Verification part stays at zero until someone independent has checked something.")}</p>

<h3 id="evidence">${t('Evidence, and the four levels')}</h3>
<p>${t('Every entry is one of three things: <strong>declared</strong> (the owner says so), <strong>documented</strong> (a file is attached) or <strong>verified</strong> (an independent verifier attested to it). Attaching a file moves a claim from declared to documented and no further.')}</p>
<table>
<thead><tr><th>${t('Level')}</th><th>${t('What it means')}</th><th>${t('Can a car reach it today?')}</th></tr></thead>
<tbody>
${levels}
</tbody>
</table>
<p>${t('The rules for verifiers are built and tested (who may attest, what an attestation is bound to, when it lapses, how one is withdrawn), but the list of verifiers is empty. Until that changes, no car on MiCar is Verified or Certified, and any claim that one is would be false.')}</p>

<h3 id="public">${t('What others may see of a car')}</h3>
<p>${t('The Garage shows each owner the public view of their car. It leaves out the VIN (only whether one is on file), every owner\'s identity, every file, note, cost and shop name. Days are blurred to months and mileage is rounded down to the thousand. Its format is published as a <a href="{schema}">JSON Schema</a>.', { schema })}</p>

<h2 id="world">MiCar World</h2>
<p>${t('A 3D town in the browser with three places. The Garage, where cars are tuned and fitted with parts. The Dealership, a simulator of the car business: buy at auction, recondition, sell. The Strip, with six kinds of race, alone or live against friends through a link. It runs at <a href="{world}">micar-sim.onrender.com</a> and needs JavaScript and WebGL. Money and prizes in the World are game currency.', { world: WORLD })}</p>

<h2 id="dealers">${t('For dealers')}</h2>
<p>${t("A printable window sheet for a car on the lot: the car's details, the asking price, MiCar's value check and forecast, and a QR code that opens the car's page. The whole record is packed into the link, so nothing is stored on a server. It is an information sheet, not the manufacturer's label and not the FTC Buyers Guide.")} <a href="${app}#/sticker">${t('Build a window sheet')}</a>.</p>

<h2 id="shops">${t('For shops')}</h2>
<p>${t('MiCar Shop: a body shop, a mechanic bay and a customer tracker for real shops, at <a href="{shop}">micar-sim.onrender.com/shop</a>.', { shop: `${WORLD}shop` })}</p>

<h2 id="data">${t('For software and AI agents')}</h2>
<ul>
<li>${t('<a href="{url}">llms.txt</a>: a short map of the site', { url: `${SITE_URL}llms.txt` })}</li>
<li>${t('<a href="{index}">The data API</a>: every model, year, trim, MSRP, EPA configuration and source as JSON, described in <a href="{openapi}">OpenAPI 3.1</a>', { index: `${API}index.json`, openapi: `${API}openapi.json` })}</li>
<li>${t('The live valuation endpoint:')} <code>${VALUE_API}?id=honda-civic&amp;year=2019&amp;mileage=60000</code></li>
<li>${t('<a href="{method}">The valuation method as data</a> and the <a href="{schema}">vehicle record format</a>', { method: `${API}method.json`, schema })}</li>
<li>${t('<a href="{repo}">The source code</a>, including every formula of the card engine in <code>packages/engine/README.md</code>', { repo: 'https://github.com/lasting-oasis/Micar-com' })}</li>
</ul>${lang === 'es' ? `\n<p class="muted">${t('The data files and the source code are in English.')}</p>` : ''}`;
  const description = t('What MiCar is: a free used-car value calculator for {models} models, a Garage that gives each car a MiCar ID, a passport, a grade and a collectible card, and a 3D world to drive it in. And what is checked today: nothing; every fact about a car is its owner\'s word.', { models: counts.models });
  const url = pageUrl(lang, 'about/');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'AboutPage', name: t('What MiCar is'), url, description, inLanguage: lang, isPartOf: { '@type': 'WebSite', name: 'MiCar', url: SITE_URL } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'MiCar', item: SITE_URL }, { '@type': 'ListItem', position: 2, name: t('What MiCar is'), item: url }] },
  ];
  return shell({ title: t('What MiCar is: car values, the Garage, the passport and the grade | MiCar'), description, canonical: url, css: env.css, footer: env.footer, jsonld, body, lang, alternates: { en: ABOUT_URL, es: pageUrl('es', 'about/') } });
}

/** The engine's own multipliers and the measured error of each fitted model, as data. */
export function methodJson(counts: SiteCounts, cal: Calibration, generatedAt: string) {
  const fit = fitTotals(cal);
  const options = (list: readonly { name: string; mult: number; desc: string; label?: string }[]) => list.map((o) => ({ value: o.name, label: optionLabel(list, o.name), multiplier: o.mult, meaning: o.desc }));
  return {
    name: 'MiCar valuation method',
    generatedAt,
    html: METHOD_URL,
    kind: 'estimate',
    notes: [
      'An estimate from a fitted depreciation model, not an offer, an appraisal or a live market price.',
      'Accuracy is measured against dealer asking prices, not sale prices.',
      'Title, accident history, condition and mileage are whatever the caller states. MiCar has checked no record.',
    ],
    steps: ['Original MSRP', 'New-car prices since then', 'Age and model resale', 'Mileage', 'Condition', 'Title status', 'Accident history', 'Regional demand', 'Market conditions', 'Local supply', 'Priced to sell', 'Local asking prices'],
    constants: {
      newCarPriceGrowthPerYear: CURVE.inflation,
      expectedMilesPerYear: MILES_PER_YEAR,
      valueLostPerThousandMilesAboveExpected: CURVE.milesRate,
      lowMileageBonusCap: 0.12,
      trimPremiumRetention: CURVE.trimRetention,
      marketSwing: MARKET_SWING,
      urgencyDiscount: URGENCY_DISCOUNT,
      askingToSale: ASKING_TO_SALE,
      typicalListingsNearby: TYPICAL_LISTINGS,
      localSupplyRange: { low: -0.18, high: 0.08 },
      rangeBand: { low: 0.03, high: 0.22 },
    },
    condition: CONDITIONS.map((c) => ({ value: c.name, multiplier: c.mult, reconditioningUsd: c.recon, meaning: c.desc })),
    title: options(TITLES),
    accident: options(ACCIDENTS),
    coverage: { models: counts.models, fittedToListings: fit.models, notFitted: counts.models - fit.models },
    fit: {
      fittedAt: cal.fittedAt,
      against: 'dealer asking prices',
      listings: fit.listings,
      droppedAsOutliers: fit.dropped,
      meanAbsoluteError: Math.round(fit.mae * 1000) / 1000,
      models: cal.models.map((m) => ({ make: m.make, model: m.model, listings: m.n, fiveYearResaleShare: m.residual5, meanAbsoluteError: m.mae, medianBias: m.medianBias })),
    },
  };
}

export function methodPageHtml(counts: SiteCounts, cal: Calibration, env: PageEnv, lang: Lang = 'en'): string {
  const t = tr(lang);
  const fit = fitTotals(cal);
  const home = homeOf(lang), app = `${home}${appLang(lang)}`, here = `${home}${langDir(lang)}`;
  const change = (m: number) => (m === 1 ? t('no change') : mult(m));
  const optRows = (list: readonly { name: string; mult: number; desc: string; label?: string }[]) => list.map((o) => `<tr><td>${escapeHtml(t(optionLabel(list, o.name)))}</td><td>${change(o.mult)}</td><td>${escapeHtml(t(o.desc))}</td></tr>`).join('\n');
  const fitRows = [...cal.models].sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model))
    .map((m) => `<tr><td>${escapeHtml(`${m.make} ${m.model}`)}</td><td>${m.n}</td><td>${pct(m.residual5)}</td><td>${pct(m.mae, 1)}</td><td>${signed(m.medianBias)}</td></tr>`).join('\n');
  const perThousand = (1 - Math.exp(-CURVE.milesRate)) * 100;
  const best = escapeHtml(`${fit.best.make} ${fit.best.model}`), worst = escapeHtml(`${fit.worst.make} ${fit.worst.model}`);
  const head = (first: string) => `<thead><tr><th>${t(first)}</th><th>${t('Change')}</th><th>${t('Meaning')}</th></tr></thead>`;
  const body = `${crumbs(lang, t('How a value is worked out'), 'method/')}
<h1>${t('How MiCar works out a value')}</h1>
<p>${t('A MiCar value is an estimate from a depreciation model fitted to real asking prices. It is not an offer to buy, not an appraisal of a particular car, and not a live market price. This page gives every step, the numbers the engine uses, how far off it has measured itself to be, and what it does not know.')}</p>

<h2 id="steps">${t('The steps, in order')}</h2>
<p>${t('The calculator and the <a href="{api}">valuation API</a> show these same lines with the dollars for the car in question.', { api: `${VALUE_API}?id=honda-civic&amp;year=2019&amp;mileage=60000` })}</p>
<ol>
<li>${t("<strong>Original MSRP.</strong> The window-sticker price of that trim in that model year, excluding destination. MiCar has {trims} trim prices for {years} model years of {models} models; each model year names its source on the <a href=\"{cars}\">car pages</a>. {maker} of those model years come from the manufacturer's own pricing; the rest come from secondary pricing sites.", { trims: n(counts.trims), years: n(counts.modelYears), models: counts.models, cars: `${here}cars/`, maker: n(counts.manufacturerYears) })}</li>
<li>${t('<strong>New-car prices since then.</strong> Used buyers compare against what a new one costs today, so the sticker is raised {rate} for each year since the model year.', { rate: pct(CURVE.inflation) })}</li>
<li>${t("<strong>Age and model resale.</strong> A curve that lands on the share of a new car's price this model typically keeps after five years. Trim content above the base car is taken to keep {keep} as much of its value as the car itself.", { keep: pct(CURVE.trimRetention) })}</li>
<li>${t('<strong>Mileage.</strong> {miles} miles a year is expected. Each 1,000 miles above that takes about {per}% off, to at most half; each 1,000 below adds 0.4%, to at most 12%.', { miles: n(MILES_PER_YEAR), per: perThousand.toFixed(2) })}</li>
<li>${t('<strong>Condition, title and reported accidents.</strong> The tables below.')}</li>
<li>${t('<strong>Regional demand.</strong> A few percent either way for trucks, electric cars and all-wheel-drive brands by US region.')}</li>
<li>${t("<strong>Market conditions.</strong> The US Bureau of Labor Statistics' used-car price index, read weekly, moves the value up to {swing} either way for an average model, more for luxury, fleet and electric models and less for models with steady demand.", { swing: pct(MARKET_SWING.tight) })}</li>
<li>${t('<strong>Local supply, if you give it.</strong> How many similar cars are listed nearby, against a typical {typical}: from 18% off when there are many to 8% on when there are few.', { typical: TYPICAL_LISTINGS })}</li>
<li>${t('<strong>Priced to sell, if you say so.</strong> {month} off to sell within a month, {week} off within a week.', { month: pct(-URGENCY_DISCOUNT.month), week: pct(-URGENCY_DISCOUNT.week) })}</li>
<li>${t('<strong>Local asking prices, if you give them.</strong> The estimate moves toward the median of the asking prices you enter, less {under} because buyers usually pay under asking. More prices count for more: five count for about three quarters of the answer. A price far from the estimate is ignored and said to be.', { under: pct(1 - ASKING_TO_SALE) })}</li>
</ol>
<p>${t("The result is the private-party value. Trade-in is that less a dealer's margin (8% to 16%, larger on cheaper cars) and the cost of reconditioning; dealer retail is that plus most of the margin. The range around it runs from 3% to 22% either side, wider for older cars, branded titles, major accidents, unusual mileage and models with no data of their own, and each answer lists its reasons.")}</p>

<h3 id="condition">${t('Condition')}</h3>
<table>
${head('Condition')}
<tbody>
${CONDITIONS.map((c) => `<tr><td>${escapeHtml(t(c.name))}</td><td>${change(c.mult)}</td><td>${escapeHtml(t(c.desc))}</td></tr>`).join('\n')}
</tbody>
</table>
<h3 id="title">${t('Title')}</h3>
<table>
${head('Title')}
<tbody>
${optRows(TITLES)}
</tbody>
</table>
<p>${t("The figures for a rebuilt and a salvage title are a dealer's rule of thumb. MiCar has not tested them against sale prices, and every such value carries a warning saying so. Get an independent appraisal before relying on one.")}</p>
<h3 id="accident">${t('Reported accidents')}</h3>
<table>
${head('Accidents')}
<tbody>
${optRows(ACCIDENTS)}
</tbody>
</table>

<h2 id="accuracy">${t('How far off it is')}</h2>
<p>${t("On {date}, the resale curve of {fitted} models was fitted to {listings} real listings: dealer asking prices for the volume trim of several model years of each model. Across them the engine's value misses the asking price by {mae} on average. {dropped} listings more than 35% from the estimate were left out as outliers (wrecks, mislabelled trims). The closest fit is the {best} ({bestMae}), the worst the {worst} ({worstMae}).", { date: cal.fittedAt, fitted: fit.models, listings: n(fit.listings), mae: pct(fit.mae, 1), dropped: fit.dropped, best, bestMae: pct(fit.best.mae, 1), worst, worstMae: pct(fit.worst.mae, 1) })}</p>
<p>${t('Three limits on that figure. These are <strong>asking prices, not sale prices</strong>. The samples are small: between {min} and {max} listings a model. And the other <strong>{rest} of {models} models are not fitted to listings at all</strong>: their resale share comes from published resale studies or from the make and body style, and no error has been measured for them. The calculator and the API say which case a car is in, under its confidence level.', { min: Math.min(...cal.models.map((m) => m.n)), max: Math.max(...cal.models.map((m) => m.n)), rest: counts.models - fit.models, models: counts.models })}</p>
<p>${t("Kept at 5 yrs is the share of a new one's price the model keeps after five years. Miss is the average distance from the asking price. Lean is the typical direction: plus means the engine runs high.")}</p>
<table>
<thead><tr><th>${t('Model')}</th><th>${t('Listings')}</th><th>${t('Kept at 5 yrs')}</th><th>${t('Miss')}</th><th>${t('Lean')}</th></tr></thead>
<tbody>
${fitRows}
</tbody>
</table>
<p class="muted">${t('The same figures as <a href="{json}">JSON</a>.', { json: `${API}method.json` })}</p>

<h2 id="limits">${t('What it does not know')}</h2>
<ul>
<li>${t('<strong>Anything about the particular car.</strong> Mileage, condition, title and accidents are what the person asking states. MiCar looks up no title history, reads no odometer and inspects nothing.')}</li>
<li>${t('<strong>Sale prices.</strong> It has asking prices for some models and none for most.')}</li>
<li>${t("<strong>Options.</strong> It knows the trim's sticker price, not the packages or accessories fitted to one car.")}</li>
<li>${t('<strong>Your local market, unless you tell it.</strong> Without the number of similar cars nearby or their asking prices, it uses the national index only.')}</li>
<li>${t('<strong>A generation that behaves differently.</strong> One resale share serves every year of a model, which is why the {worst} fits worst.', { worst })}</li>
<li>${t('<strong>Classic, exotic and very old cars.</strong> The curve is fitted to ordinary cars of recent model years.')}</li>
</ul>
<p><a class="cta" href="${app}#/value">${t('Open the calculator')}</a></p>`;
  const description = t('How MiCar works out a used-car value: every step from the original MSRP, the numbers the engine uses, its measured error against {listings} real asking prices ({mae} on average, for {fitted} of {models} models), and what it does not know.', { listings: n(fit.listings), mae: pct(fit.mae, 1), fitted: fit.models, models: counts.models });
  const url = pageUrl(lang, 'method/');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'TechArticle', headline: t('How MiCar works out a value'), url, description, inLanguage: lang, dateModified: cal.fittedAt, isPartOf: { '@type': 'WebSite', name: 'MiCar', url: SITE_URL } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'MiCar', item: SITE_URL }, { '@type': 'ListItem', position: 2, name: t('How a value is worked out'), item: url }] },
  ];
  return shell({ title: t('How MiCar works out a used-car value, and how far off it can be | MiCar'), description, canonical: url, css: env.css, footer: env.footer, jsonld, body, json: `${API}method.json`, lang, alternates: { en: METHOD_URL, es: pageUrl('es', 'method/') } });
}

const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['photo', 'receipt', 'invoice', 'report', 'title', 'registration', 'dyno', 'other'];
const CARD_FINISHES: readonly CardFinish[] = ['raw', 'standard', 'blue', 'holo', 'rainbow'];

/**
 * JSON Schema (2020-12) of the public view of a passport: what `publicPassport()` in @micar/engine returns, and what
 * the Garage shows under "What others see". The test builds a real passport and checks its public view against this.
 */
export function passportSchemaJson() {
  const month = { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'A month, YYYY-MM. Days are never given.' };
  const level = { enum: [...CERTIFICATION_LEVELS], description: 'Certification level. Verified and Certified need an independent verifier; none is connected today.' };
  const obj = (properties: Record<string, unknown>, description?: string) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${API}passport.schema.json`,
    title: 'MiCar public passport',
    description:
      "The public view of one vehicle's passport: the only projection of a car's record meant to leave its owner's device. It never holds the VIN, an owner's identity, a file, a note, a cost or a shop name; days are blurred to months and mileage is rounded down to the thousand. No MiCar endpoint serves these today: passports are kept in the owner's browser until accounts open. Unless an entry says verified, everything in it is the owner's own statement.",
    ...obj({
      micarId: { type: 'string', pattern: '^MC-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$', description: "The vehicle's MiCar ID: random, never derived from the VIN, unchanged when the owner changes. The last character is a check character." },
      createdMonth: month,
      identity: obj({ year: { type: 'integer' }, make: { type: 'string' }, model: { type: 'string' }, trim: { type: 'string' }, bodyClass: { enum: [...BODY_CLASSES] } }),
      color: { type: 'string' },
      vinOnFile: { type: 'boolean', description: 'Whether the owner entered a VIN. The VIN itself is never shown.' },
      ownerCount: { type: 'integer', minimum: 1 },
      currentOwnerSince: month,
      events: {
        type: 'array',
        description: 'The history, only ever added to. Withdrawn entries are left out.',
        items: obj({
          type: { enum: Object.keys(EVENT_TYPE_LABELS) },
          month,
          title: { type: 'string', description: "The owner's title when they marked the entry public, otherwise the plain name of its kind." },
          mileage: { type: ['integer', 'null'], description: 'Rounded down to the thousand.' },
          attachments: { type: 'object', description: 'How many files of each kind stand behind the entry.', additionalProperties: false, properties: Object.fromEntries(ATTACHMENT_KINDS.map((k) => [k, { type: 'integer', minimum: 1 }])) },
          verified: { type: 'boolean', description: 'True only when an independent verifier attested to the entry. False means declared or documented by the owner.' },
          scope: { enum: [...Object.keys(ATTESTATION_SCOPE_LABELS), null], description: 'For an attestation, what was attested; null for every other entry.' },
        }),
      },
      snapshots: {
        type: 'array',
        description: 'The grade each time it changed.',
        items: obj({
          month,
          formula: { type: 'string', description: `The grade formula, e.g. ${GRADE_FORMULA}.` },
          overall: { type: 'number', minimum: 0, maximum: 100 },
          grade10: { type: 'number', minimum: 1, maximum: 10 },
          tier: { type: 'integer', minimum: 1, maximum: 10 },
          categories: obj(Object.fromEntries(GRADE_CATEGORIES.map((k) => [k, { type: 'number', minimum: 0, maximum: 100 }]))),
          level,
        }),
      },
      editions: {
        type: 'array',
        description: 'The card editions printed for this vehicle.',
        items: obj({ number: { type: 'integer', minimum: 1 }, name: { type: 'string' }, month, level, rarity: { enum: [...RARITY_TIERS] }, finish: { enum: [...CARD_FINISHES] }, grade10: { type: ['number', 'null'] } }),
      },
    }),
  };
}
