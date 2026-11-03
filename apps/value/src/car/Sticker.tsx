// The printable window sheet: letter paper, 0.4in margins (7.7in x 10.2in of content).
// Always light-on-white so it prints the same in dark mode. Fixed pixel size at 96 dpi;
// the builder scales it to fit the screen, print CSS shows it at true size.
import { FEATURES, carName, displayModel, type CarRecord } from './record';
import { miles, monthYear, usd, type Snapshot } from './value';

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
  const in3 = snap?.curve[3]?.value;

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

      {/* Value snapshot */}
      {r.showValue && snap && (
        <section style={{ flexShrink: 0, margin: '4px 28px 0', border: `1px solid ${rule}`, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 14px', background: paper2, borderBottom: `1px solid ${rule}` }}>
            <SheetHeading>Value snapshot</SheetHeading>
            <p style={{ fontSize: 10, color: ink3 }}>Independent estimate · {monthYear(now)} · national market</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: r.showForecast ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}>
            <Cell label="Original MSRP when new" value={snap.msrp.msrp ? usd(snap.msrp.msrp) : '—'} note={snap.msrp.source === 'typical' ? 'Estimated for this model and year' : `${r.year} ${r.trim || 'base'} sticker, before destination`} />
            <Cell label="Typical dealer retail today" value={usd(snap.val.dealerRetail)} note={`Private sale: ${usd(snap.val.range.low)}–${usd(snap.val.range.high)}`} border />
            {r.showForecast && in3 !== undefined && <Cell label="Projected value in 3 years" value={`about ${usd(in3)}`} note="at 12,000 miles a year, same condition" border />}
          </div>
          {r.price > 0 && <PriceBar snap={snap} price={r.price} />}
        </section>
      )}

      {/* Footer */}
      <footer style={{ flexShrink: 0, marginTop: 'auto', padding: '12px 28px 16px', display: 'flex', gap: 22, alignItems: 'flex-end', borderTop: `1px solid ${rule}` }}>
        <div style={{ flex: 1, fontSize: 9.5, lineHeight: 1.45, color: ink3 }}>
          {r.notes && <p style={{ fontSize: 12.5, lineHeight: 1.45, color: ink, marginBottom: 10 }}><span style={{ color: ink3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10, marginRight: 8 }}>From the dealer</span>{r.notes}</p>}
          <p>{r.warranty}</p>
          <p style={{ marginTop: 4 }}>This information sheet was prepared by the dealer and is not the manufacturer's window label. Values marked as estimates come from public price data for a {r.condition.toLowerCase()}-condition car with a {r.title.toLowerCase()} title; they are a starting point, not an appraisal. Confirm mileage, history and equipment before you buy.</p>
        </div>
        <div style={{ flexShrink: 0, textAlign: 'center', width: 150 }}>
          <div aria-label="QR code to this car's web page" style={{ width: 118, height: 118, margin: '0 auto', padding: 5, background: paper, border: `1px solid ${rule}`, borderRadius: 6 }} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-cond" style={{ fontSize: 13, fontWeight: 600, marginTop: 6, lineHeight: 1.15 }}>Scan for the full story</p>
          <p style={{ fontSize: 9.5, color: ink3, marginTop: 2, lineHeight: 1.3 }}>How the value was worked out, a 5-year forecast and every detail on this car.</p>
          <p style={{ fontSize: 8.5, color: ink3, marginTop: 3, wordBreak: 'break-all' }}>{host}</p>
        </div>
      </footer>
    </article>
  );
}

function SheetHeading({ children }: { children: string }) {
  return <h2 className="font-cond" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ink }}>{children}</h2>;
}

function Cell({ label, value, note, border }: { label: string; value: string; note: string; border?: boolean }) {
  return (
    <div style={{ padding: '10px 14px', borderLeft: border ? `1px solid ${rule}` : 'none' }}>
      <p style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ink3 }}>{label}</p>
      <p className="font-cond num" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.05, marginTop: 3 }}>{value}</p>
      <p style={{ fontSize: 10, color: ink3, marginTop: 3 }}>{note}</p>
    </div>
  );
}

/** Where the asking price sits: a track from trade-in to above retail, private-sale range shaded, asking price marked. */
function PriceBar({ snap, price }: { snap: Snapshot; price: number }) {
  const { val, verdict } = snap;
  const lo = val.tradeIn * 0.95, hi = Math.max(val.dealerRetail * 1.12, price * 1.02);
  const pct = (n: number) => `${Math.min(100, Math.max(0, ((n - lo) / (hi - lo)) * 100))}%`;
  const color = verdict.kind === 'above' ? loss : verdict.kind === 'below' ? gain : blue;
  return (
    <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${rule}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 6 }}>
        <span style={{ color: ink2 }}>Where this price sits</span>
        <span style={{ fontWeight: 700, color }}>{verdict.text}</span>
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
