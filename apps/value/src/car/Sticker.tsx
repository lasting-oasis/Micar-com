// The printable window sheet: letter paper, 0.4in margins (7.7in x 10.2in of content).
// Always light-on-white so it prints the same in dark mode. Fixed pixel size at 96 dpi;
// the builder scales it to fit the screen, print CSS shows it at true size.
import { FEATURES, carName, displayModel, type CarRecord } from './record';
import { miles, monthYear, retention, usd, type Retention, type Snapshot } from './value';

export const SHEET_W = 739; // 7.7in
export const SHEET_H = 979; // 10.2in

const ink = '#18202b', ink2 = '#4a5564', ink3 = '#6b7583', rule = '#c9cdd2', paper = '#ffffff', paper2 = '#f4f5f2';
const blue = '#2a5d9f', blueSoft = '#dde7f4', gain = '#2e7d4f', loss = '#b23a3a';

export function Sticker({ r, snap, qr, now, url }: { r: CarRecord; snap: Snapshot | null; qr: string; now: Date; url: string }) {
  const feats = FEATURES.filter((f) => r.features.includes(f.id));
  const shown = feats.slice(0, 18);
  const details: [string, string][] = [
    ['Trim', r.trim || '—'], ['Body style', r.body], ['Exterior', r.exterior || '—'], ['Interior', r.interior || '—'],
    ['Title', r.title], ['Accident history', r.accident === 'None' ? 'None reported' : `${r.accident} reported`], ['Condition', r.condition],
    ['Stock number', r.stock || '—'],
  ];
  if (snap?.msrp.msrp && !r.showValue) details.push(['Original MSRP (new)', `${usd(snap.msrp.msrp)}${snap.msrp.source === 'typical' ? ' est.' : ''}`]);
  const host = url.replace(/^https?:\/\//, '').split('#')[0];
  const hold = r.showForecast ? retention(r) : null;

  return (
    <article className="sheet" aria-label={`Window sheet for ${carName(r)}`} style={{ width: SHEET_W, height: SHEET_H, background: paper, color: ink, fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      {/* Dealer band */}
      <header style={{ flexShrink: 0, background: ink, color: paper, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p className="font-cond" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.dealer.name || 'Vehicle information'}</p>
          <p style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{[r.dealer.address, r.dealer.phone, r.dealer.web].filter(Boolean).join('  ·  ') || 'Dealer information sheet'}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75 }}>Stock number</p>
          <p className="font-cond num" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{r.stock || '—'}</p>
        </div>
      </header>

      {/* Hero */}
      <section style={{ flexShrink: 0, padding: '16px 28px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, borderBottom: `1px solid ${rule}` }}>
        <div style={{ minWidth: 0 }}>
          <p className="font-cond num" style={{ fontSize: 26, fontWeight: 500, color: ink2, lineHeight: 1 }}>{r.year}</p>
          <h1 className="font-cond" style={{ fontSize: 50, fontWeight: 700, lineHeight: 0.95, letterSpacing: '-0.02em', textTransform: 'uppercase', marginTop: 4 }}>{r.make} {displayModel(r)}</h1>
          <p style={{ fontSize: 15, color: ink2, marginTop: 8 }}>{[r.trim, r.body].filter(Boolean).join('  ·  ')}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: ink3 }}>Asking price</p>
          <p className="font-cond num" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', marginTop: 2 }}>{r.price ? usd(r.price) : 'Ask'}</p>
          <p style={{ fontSize: 10, color: ink3, marginTop: 4 }}>plus tax, title, registration and fees</p>
        </div>
      </section>

      {/* Spec strip */}
      <section style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr 1.5fr 0.8fr 1.4fr', background: paper2, borderBottom: `1px solid ${rule}` }}>
        {[['Odometer', r.mileage ? miles(r.mileage) : '—'], ['Exterior / interior', [r.exterior, r.interior].filter(Boolean).join(' / ') || '—'], ['Title', r.title], ['VIN', r.vin || '—']].map(([k, v], i) => (
          <div key={k} style={{ padding: '10px 16px 10px 28px', borderLeft: i ? `1px solid ${rule}` : 'none', minWidth: 0 }}>
            <p style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink3 }}>{k}</p>
            <p className={k === 'VIN' ? 'num' : 'font-cond num'} style={{ fontSize: k === 'VIN' ? 12.5 : k.startsWith('Exterior') ? 15 : 18, fontWeight: 600, marginTop: 2, lineHeight: 1.15, whiteSpace: k.startsWith('Exterior') ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: k === 'VIN' ? 'ui-monospace, Menlo, monospace' : undefined, letterSpacing: k === 'VIN' ? '0.04em' : undefined }}>{v}</p>
          </div>
        ))}
      </section>

      {/* Highlights + details */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 28, padding: '18px 28px 14px', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div>
          <SheetHeading>Highlights</SheetHeading>
          {shown.length ? (
            <ul style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 5, marginTop: 8, listStyle: 'none', padding: 0 }}>
              {shown.map((f) => (
                <li key={f.id} style={{ fontSize: 12.5, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                  <span aria-hidden="true" style={{ color: blue, fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>
          ) : <p style={{ fontSize: 12.5, color: ink3, marginTop: 8 }}>Ask the dealer about equipment and options.</p>}
          {feats.length > shown.length && <p style={{ fontSize: 11, color: ink3, marginTop: 6 }}>+{feats.length - shown.length} more on the car page.</p>}
        </div>
        <div>
          <SheetHeading>Vehicle details</SheetHeading>
          <dl style={{ marginTop: 8 }}>
            {details.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5, padding: '2.5px 0', borderBottom: `1px dotted ${rule}` }}>
                <dt style={{ color: ink3, flexShrink: 0 }}>{k}</dt>
                <dd className="num" style={{ marginLeft: 'auto', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Value: today's value first, then where the asking price sits, then how the model holds value */}
      {r.showValue && snap && (
        <section style={{ flexShrink: 0, margin: '4px 28px 0', border: `1px solid ${rule}`, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 14px', background: paper2, borderBottom: `1px solid ${rule}` }}>
            <SheetHeading>Value check</SheetHeading>
            <p style={{ fontSize: 10, color: ink3 }}>Independent estimate · {monthYear(now)} · national market · not an appraisal</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: hold ? '1.15fr 1.15fr 1fr' : '1fr 1fr' }}>
            <div style={{ padding: '10px 14px 9px' }}>
              <CellLabel>Estimated value today</CellLabel>
              <p className="font-cond num" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 3 }}>{usd(snap.val.dealerRetail)}</p>
              <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>Typical dealer retail for this car in {r.condition.toLowerCase()} condition with {r.mileage ? miles(r.mileage) : 'these miles'}.</p>
              <p style={{ fontSize: 10, color: ink3, marginTop: 2, lineHeight: 1.35 }}>Private sale {usd(snap.val.range.low)}–{usd(snap.val.range.high)} · Trade-in {usd(snap.val.tradeIn)}</p>
            </div>
            <div style={{ padding: '10px 14px 9px', borderLeft: `1px solid ${rule}` }}>
              {r.price > 0 ? <PriceCell snap={snap} price={r.price} /> : (
                <>
                  <CellLabel>Original sticker price</CellLabel>
                  <p className="font-cond num" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 3 }}>{snap.msrp.msrp ? usd(snap.msrp.msrp) : '—'}</p>
                  <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>{snap.msrp.source === 'typical' ? 'Estimated for this model and year.' : `${r.year} ${r.trim || 'base'} sticker, before destination.`}</p>
                </>
              )}
            </div>
            {hold && <HoldCell hold={hold} />}
          </div>
          {r.price > 0 && <PriceBar snap={snap} price={r.price} />}
        </section>
      )}

      {/* Footer */}
      <footer style={{ flexShrink: 0, marginTop: 'auto', padding: '12px 28px 14px', display: 'flex', gap: 22, alignItems: 'flex-end', borderTop: `1px solid ${rule}` }}>
        <div style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 9.5, lineHeight: 1.45, color: ink3 }}>
          {r.notes ? <p style={{ fontSize: 12.5, lineHeight: 1.45, color: ink, marginBottom: 10 }}><span style={{ color: ink3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10, marginRight: 8 }}>From the dealer</span>{r.notes}</p> : <span />}
          <div>
          <p>{r.warranty}</p>
          <p style={{ marginTop: 4 }}>This information sheet was prepared by the dealer and is not the manufacturer's window label. Values marked as estimates come from public price data for a {r.condition.toLowerCase()}-condition car with a {r.title.toLowerCase()} title{snap?.msrp.msrp ? `, starting from an original sticker price of ${usd(snap.msrp.msrp)}${snap.msrp.source === 'typical' ? ' (estimated)' : ''}` : ''}; they are a starting point, not an appraisal. Confirm mileage, history and equipment before you buy.</p>
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: 'center', width: 190 }}>
          <div aria-label="QR code to this car's web page" style={{ width: 176, height: 176, margin: '0 auto', padding: 8, background: '#fff', border: `1px solid ${rule}`, borderRadius: 6, boxSizing: 'content-box' }} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-cond" style={{ fontSize: 14, fontWeight: 600, marginTop: 6, lineHeight: 1.15 }}>Scan for the full story</p>
          <p style={{ fontSize: 9.5, color: ink3, marginTop: 2, lineHeight: 1.3 }}>How the value was worked out, line by line, and every detail on this car.</p>
          <p style={{ fontSize: 8.5, color: ink3, marginTop: 3, wordBreak: 'break-all' }}>{host}</p>
        </div>
      </footer>
    </article>
  );
}

function SheetHeading({ children }: { children: string }) {
  return <h2 className="font-cond" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ink }}>{children}</h2>;
}

function CellLabel({ children }: { children: string }) {
  return <p style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink3 }}>{children}</p>;
}

/** The deal rating, in the words shoppers know from the listing sites, with the dollar gap. */
function PriceCell({ snap, price }: { snap: Snapshot; price: number }) {
  const { verdict, val } = snap;
  const color = verdict.kind === 'below' ? gain : ink;
  const detail = verdict.kind === 'below' ? `${verdict.text}. You pay ${usd(price)}; comparable cars at dealers go for about ${usd(val.dealerRetail)}.`
    : verdict.kind === 'within' ? `${verdict.text}. You pay ${usd(price)}, right at the typical dealer price of ${usd(val.dealerRetail)} for this car.`
      : `${verdict.text}. Asking ${usd(price)} against a typical dealer price of ${usd(val.dealerRetail)}; ask what's included.`;
  return (
    <>
      <CellLabel>Deal rating</CellLabel>
      <p className="font-cond" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, marginTop: 3, color }}>{verdict.label}</p>
      <p style={{ fontSize: 10, color: ink2, marginTop: 4, lineHeight: 1.35 }}>{detail}</p>
    </>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} of 5 stars`} style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}>
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
  const rank = p >= 95 ? `Top 5% of ${hold.bodyWord}s` : p >= 90 ? `Top 10% of ${hold.bodyWord}s` : p >= 50 ? `Better than ${p}% of ${hold.bodyWord}s` : `Keeps less value than ${100 - p}% of ${hold.bodyWord}s`;
  const rows: [string, number, string][] = hold.rated
    ? [[hold.ownLabel, hold.own, hold.kind === 'worse' ? loss : hold.kind === 'better' ? gain : ink2], [`Typical ${hold.bodyWord}`, hold.typical, ink3]]
    : [[`Typical ${hold.bodyWord}`, hold.typical, ink3]];
  return (
    <div style={{ padding: '10px 14px 9px', borderLeft: `1px solid ${rule}` }}>
      <CellLabel>Value retention</CellLabel>
      {hold.rated ? (
        <>
          <p style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Stars n={hold.stars} /><span className="font-cond num" style={{ fontSize: 15, fontWeight: 700 }}>{hold.stars} of 5</span></p>
          <p className="font-cond" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.15, marginTop: 2 }}>{rank}</p>
        </>
      ) : <p className="font-cond" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>What a typical {hold.bodyWord} keeps</p>}
      <div style={{ marginTop: 6, display: 'grid', rowGap: 4 }}>
        {rows.map(([label, x, color]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 30px', alignItems: 'center', columnGap: 6, fontSize: 9.5, color: ink2 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            <div style={{ height: 7, borderRadius: 4, background: paper2, boxShadow: `inset 0 0 0 1px ${rule}` }}><div style={{ width: pct(Math.min(1, x)), height: '100%', borderRadius: 4, background: color }} /></div>
            <span className="num" style={{ fontWeight: 700, color: ink, textAlign: 'right' }}>{pct(x)}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 9, color: ink3, marginTop: 4, lineHeight: 1.3 }}>
        Share of a new one's price kept at 5 years old{hold.calibrated ? ', measured on real listings' : ''}.{hold.rated && hold.makeLevel ? ` Rating is for ${hold.ownLabel} as a group; no figure for this model yet.` : ''}
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
        <span style={{ color: ink2 }}>Where this price sits</span>
        <span style={{ fontWeight: 700, color }}>Asking {usd(price)}</span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 5, background: paper2, boxShadow: `inset 0 0 0 1px ${rule}` }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(val.range.low), width: `calc(${pct(val.range.high)} - ${pct(val.range.low)})`, background: blueSoft, borderRadius: 5 }} />
        {[val.tradeIn, val.privateParty, val.dealerRetail].map((n, i) => (
          <div key={i} style={{ position: 'absolute', top: '50%', left: pct(n), width: 2, height: 14, transform: 'translate(-50%, -50%)', background: ink3, borderRadius: 1 }} />
        ))}
        <div style={{ position: 'absolute', top: '50%', left: pct(price), width: 14, height: 14, transform: 'translate(-50%, -50%)', background: color, borderRadius: 7, border: `2px solid ${paper}` }} />
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 4, fontSize: 9.5, color: ink3 }}>
        {[['Trade-in', val.tradeIn], ['Private sale', val.privateParty], ['Dealer retail', val.dealerRetail]].map(([k, n]) => (
          <span key={k as string} style={{ position: 'absolute', left: pct(n as number), transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{k} {usd(n as number)}</span>
        ))}
      </div>
    </div>
  );
}
