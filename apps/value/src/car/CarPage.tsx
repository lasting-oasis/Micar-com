// Buyer side: what the QR code opens. Every detail from the sheet, then the independent
// value check: how the asking price compares, how the value was built, and the 5-year forecast.
// Opens in the sheet's language unless the viewer has picked one (EN/ESP switch).
import { Check, Link2, MapPin, Pencil, Phone } from 'lucide-react';
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Confidence, Drivers, Forecast, Ledger, Prices } from '../App';
import { forecast } from '../engine/valuation';
import { Footer } from '../Footer';
import { langChosen, setLang, t, tx } from '../i18n';
import { Nav } from '../Nav';
import { DEFAULT_WARRANTY, FEATURES, FEATURE_GROUPS, calculatorUrl, carName, decodeRecord, displayModel, stickerPageUrl, type CarRecord } from './record';
import { accidentText, conditionPhrase } from './Sticker';
import { dealGap, dealLabel, miles, monthYear, snapshot, usd } from './value';

export default function CarPage({ code }: { code: string }) {
  const now = useMemo(() => new Date(), []);
  const r = useMemo(() => decodeRecord(code), [code]);
  // Before the first paint, so a Spanish sheet's page never flashes in English.
  useLayoutEffect(() => { if (r?.lang === 'es' && !langChosen()) setLang('es', false); }, [r]);
  if (!r) {
    return (
      <Shell>
        <Nav active="car" />
        <Notice>{tx("This link doesn't point to a car. It may have been cut short when copied. Ask the dealer for the sheet, or {link}.", { link: <a className="underline" href={calculatorUrl()}>{t('value a car yourself')}</a> })}</Notice>
      </Shell>
    );
  }
  return <Shell><Car r={r} code={code} now={now} /></Shell>;
}

function Car({ r, code, now }: { r: CarRecord; code: string; now: Date }) {
  const [annual, setAnnual] = useState(12000);
  const [copied, setCopied] = useState(false);
  const snap = useMemo(() => snapshot(r, now, annual), [r, now, annual]);
  const curve = useMemo(() => (snap ? forecast(snap.inputs, 5, annual, now) : []), [snap, annual, now]);
  const feats = FEATURES.filter((f) => r.features.includes(f.id));
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ } };
  const d = r.dealer;
  const hasDealer = d.name || d.phone || d.address || d.web;
  const webHref = d.web ? (d.web.startsWith('http') ? d.web : `https://${d.web}`) : '';
  const msrpSuffix = !snap ? '' : snap.msrp.source === 'typical' ? t('(estimated)') : snap.msrp.source === 'dealer' ? t('(entered by the dealer)') : t('({year} {trim} MSRP)', { year: r.year, trim: r.trim || t('base') });

  return (
    <>
      <Nav active="car" />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3" style={{ color: 'var(--glass-ink)' }}>
        <div>
          <h1 className="font-cond text-3xl font-semibold leading-none tracking-tight sm:text-4xl">{carName(r)}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--glass-muted)' }}>{t("Details from the dealer's window sheet, with an independent value check.")}</p>
        </div>
        <Glass onClick={copy} icon={copied ? <Check size={15} /> : <Link2 size={15} />}>{copied ? t('Link copied') : t('Share this page')}</Glass>
      </header>

      <main className="overflow-hidden rounded-md shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]" style={{ background: 'var(--sticker)' }}>
        {hasDealer && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 text-sm sm:px-7" style={{ background: 'var(--ink)', color: 'var(--sticker)' }}>
            <p className="font-cond text-xl font-semibold">{d.name || t('Offered by the dealer')}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 opacity-90">
              {d.phone && <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} />{d.phone}</a>}
              {d.address && <a className="inline-flex items-center gap-1 hover:underline" href={`https://www.google.com/maps/search/${encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer"><MapPin size={14} />{d.address}</a>}
              {d.web && <a className="hover:underline" href={webHref} target="_blank" rel="noreferrer">{d.web.replace(/^https?:\/\//, '')}</a>}
            </div>
          </div>
        )}

        <section className="grid gap-6 p-5 sm:p-7 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="font-cond num text-2xl" style={{ color: 'var(--ink-2)' }}>{r.year}</p>
            <h2 className="font-cond text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl">{r.make === 'Other' ? '' : `${r.make} `}{displayModel(r)}</h2>
            <p className="mt-2 text-base" style={{ color: 'var(--ink-2)' }}>{[r.trim, t(r.body), r.exterior && t('{color} exterior', { color: r.exterior }), r.interior && t('{color} interior', { color: r.interior })].filter(Boolean).join(' · ')}</p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded sm:grid-cols-4" style={{ background: 'var(--rule)' }}>
              {([['odo', t('Odometer'), r.mileage ? miles(r.mileage) : '—'], ['title', t('Title'), t(r.title)], ['acc', t('Accidents'), accidentText(r.accident)], ['cond', t('Condition'), t(r.condition)]] as const).map(([id, k, v]) => (
                <div key={id} className="p-3" style={{ background: 'var(--sticker)' }}>
                  <dt className="text-xs uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{k}</dt>
                  <dd className="font-cond num text-xl font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {(r.vin || r.stock) && <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>{r.vin && <>VIN <span className="font-mono tracking-wider">{r.vin}</span></>}{r.vin && r.stock && ' · '}{r.stock && <>{t('Stock')} {r.stock}</>}</p>}
            {feats.length > 0 && (
              <div className="mt-6">
                <h3 className="font-cond text-xl font-semibold">{t('Equipment & highlights')}</h3>
                {FEATURE_GROUPS.filter((g) => feats.some((f) => f.group === g)).map((g) => (
                  <div key={g} className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{t(g)}</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {feats.filter((f) => f.group === g).map((f) => <li key={f.id} className="rounded-full px-3 py-1 text-sm" style={{ background: 'var(--sticker-2)', boxShadow: 'inset 0 0 0 1px var(--rule)' }}>{t(f.label)}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {r.notes && <p className="mt-6 text-sm leading-relaxed"><span className="mr-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{t('From the dealer')}</span>{r.notes}</p>}
            <p className="mt-4 text-xs" style={{ color: 'var(--ink-3)' }}>{r.warranty === DEFAULT_WARRANTY ? t(DEFAULT_WARRANTY) : r.warranty}</p>
          </div>

          <aside className="lg:col-span-5">
            <div className="rounded-md p-5" style={{ background: 'var(--sticker-2)', boxShadow: 'inset 0 0 0 1px var(--rule)' }}>
              <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--ink-3)' }}>{t('Asking price')}</p>
              <p className="font-cond num text-6xl font-bold leading-none tracking-tight">{r.price ? usd(r.price) : t('Ask')}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>{t('plus tax, title, registration and fees')}</p>
              {snap && r.price > 0 && (
                <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--rule)' }}>
                  <p className="text-sm font-semibold" style={{ color: snap.verdict.kind === 'above' ? 'var(--loss)' : snap.verdict.kind === 'below' ? 'var(--gain)' : 'var(--ink-2)' }}>{dealLabel(snap.verdict.tier)}: {dealGap(snap.verdict)}</p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
                    {tx('An independent estimate puts a {year} {model} in {condition} with {miles} at {retail} on a dealer lot, or {low}–{high} in a private sale. Dealer prices include reconditioning, a warranty of some kind and margin.', {
                      year: r.year, model: displayModel(r), condition: conditionPhrase(r.condition), miles: r.mileage ? miles(r.mileage) : t('these miles'),
                      retail: <strong className="num">{usd(snap.val.dealerRetail)}</strong>,
                      low: <strong className="num">{usd(snap.val.range.low)}</strong>, high: <strong className="num">{usd(snap.val.range.high)}</strong>,
                    })}
                  </p>
                  {snap.msrp.msrp > 0 && <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>{t('Original sticker price: {price} {note}.', { price: usd(snap.msrp.msrp), note: msrpSuffix })}</p>}
                </div>
              )}
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>{t("Estimate as of {date}, national market, no local comps. It's a starting point for a conversation, not an appraisal.", { date: monthYear(now) })}</p>
          </aside>
        </section>

        {snap ? (
          <>
            <div className="grid border-t lg:grid-cols-12" style={{ borderColor: 'var(--rule)' }}>
              <section className="border-b p-5 sm:p-7 lg:col-span-7 lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--rule)' }}>
                <h2 className="font-cond text-2xl font-semibold">{t('How the value was worked out')}</h2>
                <p className="mb-5 text-sm" style={{ color: 'var(--ink-3)' }}>{t('Starting from what this car cost new, step by step.')}</p>
                <Prices val={snap.val} title={r.title} />
                <Ledger val={snap.val} />
              </section>
              <section className="p-5 sm:p-7 lg:col-span-5">
                <Confidence val={snap.val} />
                <Drivers val={snap.val} modelName={displayModel(r)} />
              </section>
            </div>
            <section className="border-t p-5 sm:p-7" style={{ borderColor: 'var(--rule)' }}>
              <Forecast curve={curve} annual={annual} setAnnual={(e) => setAnnual(Math.min(60000, Math.max(1000, Number(e.target.value) || 12000)))} />
            </section>
          </>
        ) : (
          <section className="border-t p-5 text-sm sm:p-7" style={{ borderColor: 'var(--rule)', color: 'var(--ink-2)' }}>
            {tx("No value estimate: there is no original sticker price on file for this car and the dealer didn't enter one. You can {link}.", { link: <a className="underline" href={calculatorUrl()}>{t('enter it yourself in the calculator')}</a> })}
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs sm:px-7" style={{ borderColor: 'var(--rule)', background: 'var(--sticker-2)', color: 'var(--ink-3)' }}>
          <span>{t("This page was generated from the dealer's window sheet; the value check is independent of the dealer.")}</span>
          <a className="inline-flex items-center gap-1 hover:underline" href={stickerPageUrl(code)}><Pencil size={12} /> {t('Dealer: edit or reprint this sheet')}</a>
        </footer>
      </main>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="w-full flex-1 py-6 sm:px-4 sm:py-10"><div className="mx-auto max-w-6xl">{children}</div></div>
      <Footer bleed />
    </div>
  );
}
function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-md p-6 text-sm" style={{ background: 'var(--sticker)', color: 'var(--ink-2)' }}>{children}</p>;
}
function Glass({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition hover:brightness-110" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--glass-ink)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}>
      {icon}{children}
    </button>
  );
}
