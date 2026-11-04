// Home page. Two audiences, two doors. The hero is the product itself: a window sticker
// on dark glass showing real engine output for a sample car, with the headline painted
// on like a windshield price. Everything else stays quiet.
import { ArrowRight, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Nav } from './Nav';
import { useTween } from './App';
import { getLang, monthYear, period, t, te, tx, useLang } from './i18n';
import { calculatorUrl, carPageUrl, emptyRecord, encodeRecord, recordInputs, stickerPageUrl, type CarRecord } from './car/record';
import { miles, usd } from './car/value';
import calibration from './data/calibration.json';
import samples from './data/listing-samples.json';
import stickers from './data/stickers.json';
import { MARKET } from './engine/market';
import { valuate } from './engine/valuation';
import { defaults, shareUrl } from './urlState';

// Real counts from the data that ships with the site, so they never go stale.
const STATS = {
  models: stickers.length,
  trims: stickers.reduce((a, s) => a + s.years.reduce((b, y) => b + y.trims.length, 0), 0),
  listings: samples.reduce((a, s) => a + s.samples.reduce((b, p) => b + p.listings.length, 0), 0),
  calibrated: (calibration as { models: unknown[] }).models.length,
  firstYear: Math.min(...stickers.flatMap((s) => s.years.map((y) => y.year))),
};

const SAMPLE_CARS: Partial<CarRecord>[] = [
  { year: 2019, make: 'Honda', model: 'Civic', trim: 'EX', body: 'Sedan', mileage: 48210, exterior: 'Aegean Blue' },
  { year: 2018, make: 'Ford', model: 'F-150', trim: 'XLT', body: 'Pickup Truck', mileage: 71400, exterior: 'Magnetic' },
  { year: 2021, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', body: 'Pickup Truck', mileage: 36800, exterior: 'Army Green' },
  { year: 2017, make: 'Lexus', model: 'RX', trim: 'RX 350 AWD', body: 'SUV / Crossover', mileage: 64900, exterior: 'Nebula Gray' },
  { year: 2020, make: 'Subaru', model: 'Outback', trim: 'Premium', body: 'Hatchback / Wagon', mileage: 41200, exterior: 'Crystal White' },
];

const SAMPLE_SHEET: CarRecord = {
  ...emptyRecord(), ...SAMPLE_CARS[0], price: 19995, interior: 'Black cloth', vin: '2HGFC2F7XKH000000', stock: 'DEMO-1',
  features: [0, 1, 3, 4, 8, 10, 14, 19, 22, 23, 32, 33, 34, 36], notes: 'Sample car. One owner, serviced on schedule; second key and floor mats included.',
  dealer: { name: 'Sample Motors', phone: '(555) 010-0100', address: '100 Example Ave, Charlotte, NC', web: '' },
} as CarRecord;

export default function Landing() {
  return (
    <div className="min-h-screen py-6 sm:px-4 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Nav active="home" />
        <Hero />
        <Doors />
        <Sources />
        <StraightTalk />
        <footer className="mt-14 border-t pt-6 text-xs leading-relaxed" style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'var(--glass-muted)' }}>
          <p>{t("Nexus Valuation is a free tool. Values are estimates, not appraisals or offers to buy. A window sheet is a dealer's information sheet, not the manufacturer's label, and it doesn't replace the FTC Buyers Guide required on used cars.")}</p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <a className="hover:underline" href={calculatorUrl()}>{t('Value a car')}</a>
            <a className="hover:underline" href={stickerPageUrl()}>{t('Window sheet')}</a>
            <a className="hover:underline" href={sampleUrl()}>{t('Sample car page')}</a>
            <a className="hover:underline" href="https://github.com/lasting-oasis/queen_city_mycarvalue" target="_blank" rel="noreferrer">{t("How it's built (source code)")}</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

/** The sample car page opens in the language you're reading. */
const sampleUrl = () => carPageUrl(encodeRecord({ ...SAMPLE_SHEET, lang: getLang(), interior: t('Black cloth'), notes: t('Sample car. One owner, serviced on schedule; second key and floor mats included.') }));

function Hero() {
  const lang = useLang();
  return (
    <section className="grid items-center gap-10 py-6 lg:grid-cols-12 lg:py-12">
      <div className="lg:col-span-6" style={{ color: 'var(--glass-ink)' }}>
        <h1 className="painted">{lang === 'es' ? <>¿Cuánto vale<br />de verdad?</> : <>What's it<br />really worth?</>}</h1>
        <p className="mt-7 max-w-md text-lg leading-relaxed" style={{ color: 'var(--glass-ink)' }}>
          {t("A used-car value you can check line by line. It starts from what the car cost new, then shows every adjustment that gets to today's number. Free, no sign-up, no ads.")}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Door href={calculatorUrl()} primary="paint">{t('Value a car')}<ArrowRight size={18} /></Door>
          <Door href={stickerPageUrl()}><Printer size={18} />{t('Print a window sheet')}</Door>
        </div>
        <p className="mt-4 text-sm" style={{ color: 'var(--glass-muted)' }}>{t('Owners, buyers and sellers use the first. Dealers use the second.')}</p>
      </div>
      <div className="lg:col-span-6">
        <LiveSticker />
      </div>
    </section>
  );
}

/** A window sticker showing real engine output for one sample car at a time. */
function LiveSticker() {
  const now = useMemo(() => new Date(), []);
  const cars = useMemo(() => SAMPLE_CARS.map((c) => {
    const r = { ...emptyRecord(now), ...c } as CarRecord;
    const inputs = recordInputs(r, now);
    const val = inputs ? valuate(inputs, now) : null;
    const form = { ...defaults(now), make: r.make, model: r.model, trim: r.trim, body: r.body, msrp: String(inputs?.msrp ?? ''), year: String(r.year), mileage: String(r.mileage) };
    return { r, val, link: shareUrl(form) };
  }).filter((c) => c.val), [now]);
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (cars.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setI((n) => (n + 1) % cars.length); setVisible(true); }, 350);
    }, 7000);
    return () => clearInterval(t);
  }, [cars.length]);
  const c = cars[i];
  const pp = useTween(c?.val?.privateParty ?? 0, 900);
  if (!c?.val) return null;
  const { r, val } = c;
  const built = val.steps.filter((s) => s.delta !== 0).slice(0, 3);
  const lo = val.tradeIn * 0.95, hi = val.dealerRetail * 1.03;
  const pct = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;

  return (
    <div className="sticker-tape">
      <article className="rounded-sm shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] transition-opacity duration-300" style={{ background: 'var(--sticker)', color: 'var(--ink)', opacity: visible ? 1 : 0 }}>
        <div className="flex items-baseline justify-between px-6 py-3 text-sm" style={{ background: 'var(--ink)', color: 'var(--sticker)' }}>
          <span className="font-cond text-lg font-semibold">{t('Live example')}</span>
          <span className="opacity-80">{t('as of {date}', { date: monthYear(now) })}</span>
        </div>
        <div className="px-6 pt-5">
          <p className="font-cond num text-xl" style={{ color: 'var(--ink-2)' }}>{r.year}</p>
          <p className="font-cond text-4xl font-bold uppercase leading-none tracking-tight">{r.make} {r.model}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>{t('{trim}, {color}, {miles}, good condition, clean title', { trim: r.trim, color: r.exterior, miles: miles(r.mileage) })}</p>
          <p className="mt-5 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{t('Private-party value')}</p>
          <p className="font-cond num text-6xl font-bold leading-none tracking-tight">{usd(pp)}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>{tx('Most sales land between {low} and {high}.', { low: <strong className="num">{usd(val.range.low)}</strong>, high: <strong className="num">{usd(val.range.high)}</strong> })}</p>
          <div className="mt-3" aria-hidden="true">
            <div className="relative h-2 rounded-full" style={{ background: 'var(--sticker-2)', boxShadow: 'inset 0 0 0 1px var(--rule)' }}>
              <div className="absolute inset-y-0 rounded-full" style={{ left: pct(val.range.low), width: `calc(${pct(val.range.high)} - ${pct(val.range.low)})`, background: 'var(--blue-soft)' }} />
              {[[val.tradeIn, 'var(--ink-3)'], [val.privateParty, 'var(--blue)'], [val.dealerRetail, 'var(--ink-3)']].map(([n, color], k) => (
                <div key={k} className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pct(n as number), background: color as string }} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs" style={{ color: 'var(--ink-3)' }}><span>{t('Trade-in {price}', { price: usd(val.tradeIn) })}</span><span>{t('Dealer retail {price}', { price: usd(val.dealerRetail) })}</span></div>
          </div>
        </div>
        <div className="mx-6 mt-5 border-t pt-3" style={{ borderColor: 'var(--rule)' }}>
          <p className="font-cond text-base font-semibold">{t("How it's built")}</p>
          <ul className="mt-1 text-sm">
            <li className="flex justify-between py-1"><span style={{ color: 'var(--ink-2)' }}>{te.label(val.steps[0].label)}</span><span className="num">{usd(val.steps[0].value)}</span></li>
            {built.map((s) => (
              <li key={s.label} className="flex justify-between py-1"><span style={{ color: 'var(--ink-2)' }}>{te.label(s.label)}</span><span className="num" style={{ color: s.delta >= 0 ? 'var(--gain)' : 'var(--loss)' }}>{s.delta >= 0 ? '+' : '−'}{usd(Math.abs(s.delta))}</span></li>
            ))}
            <li className="flex justify-between py-1 text-xs" style={{ color: 'var(--ink-3)' }}><span>{t('and {n} more lines on the full page', { n: Math.max(0, val.steps.length - 1 - built.length) })}</span></li>
          </ul>
        </div>
        <a href={c.link} className="mx-6 mb-5 mt-2 inline-flex items-center gap-1 text-sm font-semibold hover:underline" style={{ color: 'var(--blue)' }}>{t('Open this estimate and change anything')}<ArrowRight size={15} /></a>
      </article>
    </div>
  );
}

function Doors() {
  return (
    <section className="mt-6 grid gap-5 lg:grid-cols-2" aria-label={t('How to use the site')}>
      <DoorCard title={t('I want to know what a car is worth')} who={t('Owners, buyers and sellers')} steps={[
        [t('Pick the make, model, year and trim.'), t('The original sticker price fills in from our records, which cover {models} models from {year} on. For anything else, type the sticker price.', { models: STATS.models, year: STATS.firstYear })],
        [t('Add the miles and the condition.'), t('If you have a few local listings for the same car, paste the page in; real asking prices carry weight.')],
        [t('Read the number, and the reasons.'), t('The value, the likely range, every adjustment that got there, and where the value is heading over the next five years.')],
      ]}>
        <Door href={calculatorUrl()} primary>{t('Value a car')}<ArrowRight size={18} /></Door>
      </DoorCard>
      <DoorCard title={t("I'm selling a car and want a window sheet")} who={t('Dealers, and private sellers too')} steps={[
        [t('Describe the car once.'), t('Price, miles, colors, highlights, condition and your contact details. The sticker price, body style and value come from the engine.')],
        [t('Print the sheet on letter paper.'), t('It shows the car, its value today, a deal rating and where your price sits. Switch the value section off if you prefer.')],
        [t('Buyers scan the QR code.'), t('They get every detail and an independent value check on their phone. Scan it yourself to edit or reprint later.')],
      ]}>
        <Door href={stickerPageUrl()} primary><Printer size={18} />{t('Build a window sheet')}</Door>
        <Door href={sampleUrl()}>{t('See a sample car page')}</Door>
      </DoorCard>
    </section>
  );
}

function DoorCard({ title, who, steps, children }: { title: string; who: string; steps: [string, string][]; children: React.ReactNode }) {
  return (
    <article className="rounded-md p-6 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] sm:p-8" style={{ background: 'var(--sticker)', color: 'var(--ink)' }}>
      <h2 className="font-cond text-3xl font-semibold leading-tight tracking-tight">{title}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>{who}</p>
      <ol className="mt-5 space-y-4">
        {steps.map(([head, body], n) => (
          <li key={head} className="flex gap-4">
            <span className="font-cond num mt-0.5 h-7 w-7 shrink-0 rounded-full text-center text-base font-semibold leading-7" style={{ background: 'var(--ink)', color: 'var(--sticker)' }}>{n + 1}</span>
            <span><strong className="font-semibold">{head}</strong> <span style={{ color: 'var(--ink-2)' }}>{body}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">{children}</div>
    </article>
  );
}

function Sources() {
  const n = (x: number) => x.toLocaleString('en-US');
  const facts: [string, string][] = [
    [t('{n} models', { n: n(STATS.models) }), t('with original sticker prices by trim, {from} to {to}: {trims} prices from published price lists and manufacturer releases.', { from: STATS.firstYear, to: new Date().getFullYear(), trims: n(STATS.trims) })],
    [t('{n} real listings', { n: n(STATS.listings) }), t('used to measure how fast {n} popular models actually lose value, instead of guessing.', { n: STATS.calibrated })],
    [t('A national market index'), t("the Bureau of Labor Statistics' used-car price index, checked every week, so a soft or tight market moves every estimate. Latest reading: {period}.", { period: period(MARKET.latestPeriod) })],
    [t('Every line shown'), t('No black box. Each estimate lists the adjustments that got to the number, so you can disagree with one and change it.')],
  ];
  return (
    <section className="mt-14" style={{ color: 'var(--glass-ink)' }}>
      <h2 className="font-cond text-3xl font-semibold tracking-tight">{t('Where the numbers come from')}</h2>
      <dl className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
            <dt className="font-cond text-2xl font-semibold">{k}</dt>
            <dd className="mt-1 max-w-md text-sm leading-relaxed" style={{ color: 'var(--glass-muted)' }}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function StraightTalk() {
  return (
    <section className="mt-14 max-w-3xl" style={{ color: 'var(--glass-ink)' }}>
      <h2 className="font-cond text-3xl font-semibold tracking-tight">{t('Straight talk about accuracy')}</h2>
      <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--glass-muted)' }}>
        {t("On the {n} models we've checked against real listings, the typical miss is about 8%. Models without listing data use a rate for their make and body style, so expect a wider range there; the page tells you which kind you're looking at. No formula can see a car's service history, paint or the way it drives. Treat the number as a well-reasoned starting point, and let the local listings you paste carry weight.", { n: STATS.calibrated })}
      </p>
    </section>
  );
}

/** A button-shaped link. `primary` fills it: 'paint' is the windshield yellow for the hero on glass,
 *  `true` is ink on the paper cards. Others are outlined in the surrounding text color. */
function Door({ href, primary, children }: { href: string; primary?: boolean | 'paint'; children: React.ReactNode }) {
  const style = primary === 'paint' ? { background: '#ffd23f', color: '#18202b', boxShadow: '0 12px 24px -12px rgba(255,210,63,0.6)' }
    : primary ? { background: 'var(--ink)', color: 'var(--sticker)', boxShadow: '0 12px 24px -12px rgba(0,0,0,0.6)' }
      : { color: 'inherit', boxShadow: 'inset 0 0 0 1.5px currentColor' };
  return (
    <a href={href} className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={style}>
      {children}
    </a>
  );
}
