// The printable window sheet: letter paper, 0.4in margins (7.7in x 10.2in of content).
// Always light-on-white so it prints the same in dark mode. Fixed pixel size at 96 dpi;
// the builder scales it to fit the screen, print CSS shows it at true size.
// It prints in the page's language (EN/ESP switch); what the dealer typed prints as typed.
import { bodyWords, t } from '../i18n';
import { DEFAULT_WARRANTY, FEATURES, carName, displayModel, type CarRecord } from './record';
import { dealLabel, miles, monthYear, retention, usd, type Retention, type Snapshot } from './value';

export const SHEET_W = 739; // 7.7in
export const SHEET_H = 979; // 10.2in

const ink = '#18202b', ink2 = '#4a5564', ink3 = '#6b7583', rule = '#c9cdd2', paper = '#ffffff', paper2 = '#f4f5f2';
const blue = '#2a5d9f', blueSoft = '#dde7f4', gain = '#2e7d4f', loss = '#b23a3a';

/** "good condition" / "buen estado" */
export function conditionPhrase(condition: string): string {
  return condition === 'Excellent' ? t('excellent condition') : condition === 'Fair' ? t('fair condition') : condition === 'Poor' ? t('poor condition') : t('good condition');
}
/** "a clean title" / "título limpio" */
export function titlePhrase(title: string): string {
  return title === 'Rebuilt' ? t('a rebuilt title') : title === 'Salvage' ? t('a salvage title') : t('a clean title');
}
/** "None reported" / "Minor reported"... */
export function accidentText(accident: string): string {
  return accident === 'Minor' ? t('Minor reported') : accident === 'Major' ? t('Major reported') : t('None reported');
}

export function Sticker({ r, snap, qr, now, url }: { r: CarRecord; snap: Snapshot | null; qr: string; now: Date; url: string }) {
  const feats = FEATURES.filter((f) => r.features.includes(f.id));
  const shown = feats.slice(0, 18);
  const colors = r.exterior && r.interior ? t('{exterior} exterior, {interior} interior', { exterior: r.exterior, interior: r.interior })
    : r.exterior ? t('{color} exterior', { color: r.exterior }) : r.interior ? t('{color} interior', { color: r.interior }) : '';
  const host = url.replace(/^https?:\/\//, '').split('#')[0];
  const hold = r.showForecast ? retention(r) : null;
  const msrpVars = { price: snap?.msrp.msrp ? usd(snap.msrp.msrp) : '' };
  const msrpNote = !snap?.msrp.msrp ? '' : snap.msrp.source === 'typical' ? t(', starting from an original sticker price of {price} (estimated)', msrpVars) : t(', starting from an original sticker price of {price}', msrpVars);

  return (
    <article className="sheet" aria-label={t('Window sheet for {car}', { car: carName(r) })} style={{ width: SHEET_W, height: SHEET_H, background: paper, color: ink, fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      {/* Dealer band */}
      <header style={{ flexShrink: 0, background: ink, color: paper, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p className="font-cond" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.dealer.name || t('Vehicle information')}</p>
          <p style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{[r.dealer.address, r.dealer.phone, r.dealer.web].filter(Boolean).join('  ·  ') || t('Dealer information sheet')}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75 }}>{t('Stock number')}</p>
          <p className="font-cond num" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{r.stock || '—'}</p>
        </div>
      </header>

      {/* Hero */}
      <section style={{ flexShrink: 0, padding: '16px 28px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, borderBottom: `1px solid ${rule}` }}>
        <div style={{ minWidth: 0 }}>
          <p className="font-cond num" style={{ fontSize: 26, fontWeight: 500, color: ink2, lineHeight: 1 }}>{r.year}</p>
          <h1 className="font-cond" style={{ fontSize: 50, fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.02em', textTransform: 'uppercase', marginTop: 4 }}>{r.make === 'Other' ? '' : `${r.make} `}{displayModel(r)}</h1>
          <p style={{ fontSize: 15, color: ink2, marginTop: 8, lineHeight: 1.3 }}>{[r.trim, t(r.body), colors].filter(Boolean).join('  ·  ')}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: ink3 }}>{t('Asking price')}</p>
          <p className="font-cond num" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', marginTop: 2 }}>{r.price ? usd(r.price) : t('Ask')}</p>
          <p style={{ fontSize: 10, color: ink3, marginTop: 4 }}>{t('plus tax, title, registration and fees')}</p>
          {!r.showValue && snap?.msrp.msrp ? <p style={{ fontSize: 10.5, color: ink2, marginTop: 6 }}>{t('Original MSRP {price}', { price: usd(snap.msrp.msrp) })}{snap.msrp.source === 'typical' ? ` ${t('est.')}` : ''}</p> : null}
        </div>
      </section>

      {/* Spec strip: the facts a buyer checks first */}
      <section style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 0.85fr 1.05fr 0.95fr 1.5fr', background: paper2, borderBottom: `1px solid ${rule}` }}>
        {([['odo', t('Odometer'), r.mileage ? miles(r.mileage) : '—'], ['cond', t('Condition'), t(r.condition)], ['acc', t('Accidents reported'), t(r.accident)], ['title', t('Title'), t(r.title)], ['vin', 'VIN', r.vin || '—']] as const).map(([id, k, v], i) => (
          <div key={id} style={{ padding: `10px 14px 10px ${i ? 14 : 28}px`, borderLeft: i ? `1px solid ${rule}` : 'none', minWidth: 0 }}>
            <p style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</p>
            <p className={id === 'vin' ? 'num' : 'font-cond num'} style={{ fontSize: id === 'vin' ? 12.5 : 18, fontWeight: 600, marginTop: 2, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: id === 'vin' ? 'ui-monospace, Menlo, monospace' : undefined, letterSpacing: id === 'vin' ? '0.04em' : undefined }}>{v}</p>
          </div>
        ))}
      </section>

      {/* Highlights, with the QR code beside them */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 190px', gap: 28, padding: '18px 28px 14px', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ minWidth: 0 }}>
          <SheetHeading>{t('Highlights')}</SheetHeading>
          {shown.length ? (
            <ul style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 5, marginTop: 8, listStyle: 'none', padding: 0 }}>
              {shown.map((f) => (
                <li key={f.id} style={{ fontSize: 12.5, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                  <span aria-hidden="true" style={{ color: blue, fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span>{t(f.label)}</span>
                </li>
              ))}
            </ul>
          ) : <p style={{ fontSize: 12.5, color: ink3, marginTop: 8 }}>{t('Ask the dealer about equipment and options.')}</p>}
          {feats.length > shown.length && <p style={{ fontSize: 11, color: ink3, marginTop: 6 }}>{t('+{n} more on the car page.', { n: feats.length - shown.length })}</p>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div aria-label={t("QR code to this car's web page")} style={{ width: 176, height: 176, margin: '0 auto', padding: 7, background: '#fff', border: `1px solid ${rule}`, borderRadius: 6, boxSizing: 'content-box' }} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-cond" style={{ fontSize: 14, fontWeight: 600, marginTop: 6, lineHeight: 1.15 }}>{t('Scan for the full story')}</p>
          <p style={{ fontSize: 9.5, color: ink3, marginTop: 2, lineHeight: 1.3 }}>{t('How the value was worked out, line by line, and every detail on this car.')}</p>
          <p style={{ fontSize: 8.5, color: ink3, marginTop: 3, wordBreak: 'break-all' }}>{host}</p>
        </div>
      </section>

      {/* Value: today's value first, then the deal rating, then how the model holds value */}
      {r.showValue && snap && (
        <section style={{ flexShrink: 0, margin: '0 28px 0', border: `1px solid ${rule}`, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '7px 14px', background: paper2, borderBottom: `1px solid ${rule}` }}>
            <SheetHeading>{t('Value check')}</SheetHeading>
            <p style={{ fontSize: 10, color: ink3, textAlign: 'right' }}>{t('Independent estimate · {date} · national market · not an appraisal', { date: monthYear(now) })}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: hold ? '1.15fr 1.15fr 1fr' : '1fr 1fr' }}>
            <div style={{ padding: '10px 14px 9px' }}>
              <CellLabel>{t('Estimated value today')}</CellLabel>
              <p className="font-cond num" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 3 }}>{usd(snap.val.dealerRetail)}</p>
              <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>{t('Typical dealer retail for this car in {condition} with {miles}.', { condition: conditionPhrase(r.condition), miles: r.mileage ? miles(r.mileage) : t('these miles') })}</p>
              <p style={{ fontSize: 10, color: ink3, marginTop: 2, lineHeight: 1.35 }}>{t('Private sale {low}–{high} · Trade-in {tradeIn}', { low: usd(snap.val.range.low), high: usd(snap.val.range.high), tradeIn: usd(snap.val.tradeIn) })}</p>
            </div>
            <div style={{ padding: '10px 14px 9px', borderLeft: `1px solid ${rule}` }}>
              {r.price > 0 ? <PriceCell snap={snap} price={r.price} /> : (
                <>
                  <CellLabel>{t('Original sticker price')}</CellLabel>
                  <p className="font-cond num" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 3 }}>{snap.msrp.msrp ? usd(snap.msrp.msrp) : '—'}</p>
                  <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>{snap.msrp.source === 'typical' ? t('Estimated for this model and year.') : t('{year} {trim} sticker, before destination.', { year: r.year, trim: r.trim || t('base') })}</p>
                </>
              )}
            </div>
            {hold && <HoldCell hold={hold} />}
          </div>
          {r.price > 0 && <PriceBar snap={snap} price={r.price} />}
        </section>
      )}

      {/* Fine print */}
      <footer style={{ flexShrink: 0, marginTop: 'auto', padding: '10px 28px 14px', fontSize: 9.5, lineHeight: 1.45, color: ink3 }}>
        {r.notes && <p style={{ fontSize: 12.5, lineHeight: 1.45, color: ink, marginBottom: 8 }}><span style={{ color: ink3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10, marginRight: 8 }}>{t('From the dealer')}</span>{r.notes}</p>}
        <p>{r.warranty === DEFAULT_WARRANTY ? t(DEFAULT_WARRANTY) : r.warranty}</p>
        <p style={{ marginTop: 4 }}>{t("This information sheet was prepared by the dealer and is not the manufacturer's window label. Values marked as estimates come from public price data for a car in {condition} with {title}{msrp}; they are a starting point, not an appraisal. Confirm mileage, history and equipment before you buy.", { condition: conditionPhrase(r.condition), title: titlePhrase(r.title), msrp: msrpNote })}</p>
      </footer>
    </article>
  );
}

function SheetHeading({ children }: { children: string }) {
  return <h2 className="font-cond" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ink, whiteSpace: 'nowrap' }}>{children}</h2>;
}

function CellLabel({ children }: { children: string }) {
  return <p style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink3 }}>{children}</p>;
}

/** The deal rating, in the words shoppers know from the listing sites, with the dollar gap. */
function PriceCell({ snap, price }: { snap: Snapshot; price: number }) {
  const { verdict, val } = snap;
  const label = dealLabel(verdict.tier);
  const vars = { gap: usd(Math.abs(verdict.diff)), price: usd(price), retail: usd(val.dealerRetail) };
  const detail = verdict.kind === 'below' ? t('{gap} under market value. You pay {price}; comparable cars at dealers go for about {retail}.', vars)
    : verdict.kind === 'within' ? t('At market value. You pay {price}, right at the typical dealer price of {retail} for this car.', vars)
      : t("{gap} over market value. Asking {price} against a typical dealer price of {retail}; ask what's included.", vars);
  return (
    <>
      <CellLabel>{t('Deal rating')}</CellLabel>
      <p className="font-cond" style={{ fontSize: label.length > 13 ? 27 : 34, fontWeight: 700, lineHeight: 1, marginTop: 3, color: verdict.kind === 'below' ? gain : ink, minHeight: 34 }}>{label}</p>
      <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>{detail}</p>
    </>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span role="img" aria-label={t('{n} of 5 stars', { n })} style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.6 6 21l1.3-6.8-5-4.7 6.8-.8z" fill={i <= n ? '#e0a52a' : 'none'} stroke={i <= n ? '#c98f12' : rule} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

/** Value retention: a star rating from where the model ranks among its body style, then the two bars behind it. */
function HoldCell({ hold }: { hold: Retention }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const p = Math.round(hold.percentile * 100);
  const w = bodyWords(hold.body, hold.make);
  const rank = p >= 95 ? t('Top {pct}% of {group}', { pct: 5, group: w.group }) : p >= 90 ? t('Top {pct}% of {group}', { pct: 10, group: w.group })
    : p >= 50 ? t('Better than {pct}% of {group}', { pct: p, group: w.group }) : t('Keeps less value than {pct}% of {group}', { pct: 100 - p, group: w.group });
  const ownLabel = hold.makeLevel ? w.makeGroup : hold.modelLabel;
  const rows: [string, number, string][] = hold.rated
    ? [[ownLabel, hold.own, hold.kind === 'worse' ? loss : hold.kind === 'better' ? gain : ink2], [w.typical, hold.typical, ink3]]
    : [[w.typical, hold.typical, ink3]];
  return (
    <div style={{ padding: '10px 14px 9px', borderLeft: `1px solid ${rule}` }}>
      <CellLabel>{t('Value retention')}</CellLabel>
      {hold.rated ? (
        <>
          <p style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Stars n={hold.stars} /><span className="font-cond num" style={{ fontSize: 15, fontWeight: 700 }}>{t('{n} of 5', { n: hold.stars })}</span></p>
          <p className="font-cond" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.15, marginTop: 2 }}>{rank}</p>
        </>
      ) : <p className="font-cond" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>{t('What {one} keeps', { one: w.typicalOne })}</p>}
      <div style={{ marginTop: 6, display: 'grid', rowGap: 4 }}>
        {rows.map(([label, x, color]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 30px', alignItems: 'center', columnGap: 6, fontSize: 9.5, color: ink2 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            <div style={{ height: 7, borderRadius: 4, background: paper2, boxShadow: `inset 0 0 0 1px ${rule}` }}><div style={{ width: pct(Math.min(1, x)), height: '100%', borderRadius: 4, background: color }} /></div>
            <span className="num" style={{ fontWeight: 700, color: ink, textAlign: 'right' }}>{pct(x)}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 9, color: ink3, marginTop: 4, lineHeight: 1.3 }}>
        {hold.calibrated ? t("Share of a new one's price kept at 5 years old, measured on real listings.") : t("Share of a new one's price kept at 5 years old.")}
        {hold.rated && hold.makeLevel ? ` ${t('Rating is for {group} as a group; no figure for this model yet.', { group: w.makeGroupIn })}` : ''}
      </p>
    </div>
  );
}

/** Where the asking price sits: a track from trade-in to above retail, private-sale range shaded, asking price marked. */
function PriceBar({ snap, price }: { snap: Snapshot; price: number }) {
  const { val, verdict } = snap;
  const lo = val.tradeIn * 0.95, hi = Math.max(val.dealerRetail * 1.12, price * 1.02);
  const pct = (n: number) => `${Math.min(100, Math.max(0, ((n - lo) / (hi - lo)) * 100))}%`;
  const color = verdict.kind === 'below' ? gain : verdict.kind === 'above' ? ink : blue;
  return (
    <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${rule}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 6 }}>
        <span style={{ color: ink2 }}>{t('Where this price sits')}</span>
        <span style={{ fontWeight: 700, color }}>{t('Asking {price}', { price: usd(price) })}</span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 5, background: paper2, boxShadow: `inset 0 0 0 1px ${rule}` }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(val.range.low), width: `calc(${pct(val.range.high)} - ${pct(val.range.low)})`, background: blueSoft, borderRadius: 5 }} />
        {[val.tradeIn, val.privateParty, val.dealerRetail].map((n, i) => (
          <div key={i} style={{ position: 'absolute', top: '50%', left: pct(n), width: 2, height: 14, transform: 'translate(-50%, -50%)', background: ink3, borderRadius: 1 }} />
        ))}
        <div style={{ position: 'absolute', top: '50%', left: pct(price), width: 14, height: 14, transform: 'translate(-50%, -50%)', background: color, borderRadius: 7, border: `2px solid ${paper}` }} />
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 4, fontSize: 9.5, color: ink3 }}>
        {([['trade', t('Trade-in'), val.tradeIn], ['private', t('Private sale'), val.privateParty], ['retail', t('Dealer retail'), val.dealerRetail]] as const).map(([id, k, n]) => (
          <span key={id} style={{ position: 'absolute', left: pct(n), transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{k} {usd(n)}</span>
        ))}
      </div>
    </div>
  );
}
