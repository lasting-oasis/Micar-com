// Dealer side: describe a car on the lot, see the window sheet update live, print it.
// The QR code on the sheet opens the car page with the same record (nothing is stored on a server).
import { Check, Download, ExternalLink, Link2, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, REGIONS, SEGMENT_LABELS, TITLES } from '../engine/data';
import { findModel, modelsForMake, yearRanges } from '../engine/models';
import { stickerFor, trimChoices } from '../engine/stickers';
import { qrSvg } from './qr';
import { Nav } from '../Nav';
import { FEATURES, FEATURE_GROUPS, carPageUrl, decodeRecord, emptyRecord, encodeRecord, recordMsrp, soldYears, type CarRecord, type Dealer } from './record';
import { SHEET_H, SHEET_W, Sticker } from './Sticker';
import { snapshot, usd } from './value';

const DEALER_KEY = 'nexus.dealer';
const loadDealer = (): Dealer | null => { try { const s = localStorage.getItem(DEALER_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const saveDealer = (d: Dealer) => { try { localStorage.setItem(DEALER_KEY, JSON.stringify(d)); } catch { /* private window */ } };

export default function StickerBuilder({ code }: { code?: string }) {
  const now = useMemo(() => new Date(), []);
  const [r, setR] = useState<CarRecord>(() => {
    const fromUrl = code ? decodeRecord(code) : null;
    if (fromUrl) return fromUrl;
    const base = emptyRecord(now);
    const d = loadDealer();
    return d ? { ...base, dealer: d } : base;
  });
  const [otherTrim, setOtherTrim] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  const encoded = useMemo(() => encodeRecord(r), [r]);
  const url = carPageUrl(encoded);
  const snap = useMemo(() => snapshot(r, now), [r, now]);
  const sticker = stickerFor(r.make, r.model, r.year);
  const trims = sticker ? trimChoices(sticker.year) : [];
  const onFile = recordMsrp({ ...r, msrp: null });
  const years = soldYears(r);

  // QR: regenerate shortly after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => { qrSvg(url).then(setQr).catch(() => setQr('')); }, 250);
    return () => clearTimeout(t);
  }, [url]);
  useEffect(() => { saveDealer(r.dealer); }, [r.dealer]);

  const set = <K extends keyof CarRecord>(k: K, v: CarRecord[K]) => setR((p) => ({ ...p, [k]: v }));
  const setDealer = (k: keyof Dealer, v: string) => setR((p) => ({ ...p, dealer: { ...p.dealer, [k]: v } }));
  const setMake = (make: string) => {
    const first = modelsForMake(make)[0];
    const st = first ? stickerFor(make, first.model, r.year) : undefined;
    setR((p) => ({ ...p, make, model: first?.model ?? '', modelText: '', body: first?.body ?? p.body, trim: st ? trimChoices(st.year)[0].trim : '' }));
  };
  const setModel = (model: string) => {
    const info = findModel(r.make, model);
    const st = stickerFor(r.make, model, r.year);
    setR((p) => ({ ...p, model, body: info?.body ?? p.body, trim: st ? trimChoices(st.year)[0].trim : (model ? '' : p.trim) }));
    setOtherTrim(false);
  };
  const setYear = (year: number) => {
    const st = stickerFor(r.make, r.model, year);
    setR((p) => ({ ...p, year, trim: st && !trimChoices(st.year).some((t) => t.trim === p.trim) ? trimChoices(st.year)[0].trim : p.trim }));
  };
  const toggleFeature = (id: number) => setR((p) => ({ ...p, features: p.features.includes(id) ? p.features.filter((x) => x !== id) : [...p.features, id] }));

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ } };
  const downloadQr = () => {
    const blob = new Blob([qr], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `qr-${r.year}-${r.make}-${r.model || r.modelText || 'car'}.svg`.replace(/\s+/g, '-').toLowerCase(); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const problems: string[] = [];
  if (!r.price) problems.push('an asking price');
  if (!r.mileage && r.mileage !== 0) problems.push('the odometer reading');
  if (!snap) problems.push('an original MSRP (none on file for this car)');
  const models = modelsForMake(r.make);

  return (
    <>
      <div className="no-print min-h-screen py-6 sm:px-4 sm:py-10">
        <div className="mx-auto max-w-7xl">
          <Nav active="sheet" />
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4" style={{ color: 'var(--glass-ink)' }}>
            <div>
              <h1 className="font-cond text-3xl font-semibold leading-none tracking-tight sm:text-4xl">Print a window sheet for a car you're selling</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--glass-muted)' }}>Describe the car once. The sheet updates as you type; the QR code opens a page with every detail and an independent value check.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Glass onClick={() => window.print()} icon={<Printer size={15} />}>Print sheet</Glass>
              <Glass onClick={copy} icon={copied ? <Check size={15} /> : <Link2 size={15} />}>{copied ? 'Link copied' : 'Copy car-page link'}</Glass>
              <Glass onClick={() => window.open(url, '_blank')} icon={<ExternalLink size={15} />}>Open car page</Glass>
              <Glass onClick={downloadQr} icon={<Download size={15} />}>QR only</Glass>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-12">
            <section className="rounded-md p-5 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] sm:p-6 lg:col-span-5" style={{ background: 'var(--sticker)' }}>
              <Group title="Dealer" hint="Saved on this device, so you only type it once.">
                <Text label="Dealership name" value={r.dealer.name} onChange={(v) => setDealer('name', v)} max={60} />
                <div className="grid grid-cols-2 gap-3">
                  <Text label="Phone" value={r.dealer.phone} onChange={(v) => setDealer('phone', v)} max={30} />
                  <Text label="Website" value={r.dealer.web} onChange={(v) => setDealer('web', v)} max={80} placeholder="example.com" />
                </div>
                <Text label="Address" value={r.dealer.address} onChange={(v) => setDealer('address', v)} max={120} />
              </Group>

              <Group title="The car" hint="Pick the model and the sheet fills in the sticker price, body style and value from the engine.">
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Make" value={r.make} onChange={setMake}>
                    {(Object.keys(SEGMENT_LABELS) as (keyof typeof SEGMENT_LABELS)[]).map((seg) => (
                      <optgroup key={seg} label={SEGMENT_LABELS[seg]}>{MAKES.filter((m) => m.segment === seg).map((m) => <option key={m.name}>{m.name}</option>)}</optgroup>
                    ))}
                  </Select>
                  <Select label="Model" value={models.some((m) => m.model === r.model) ? r.model : ''} onChange={setModel}>
                    {models.filter((m) => !m.source).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
                    {models.some((m) => m.source) && <optgroup label="More models">{models.filter((m) => m.source).sort((a, b) => a.model.localeCompare(b.model)).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</optgroup>}
                    <option value="">Not listed (type it)</option>
                  </Select>
                </div>
                {!r.model && <Text label="Model name" value={r.modelText} onChange={(v) => set('modelText', v)} max={60} />}
                <div className="grid grid-cols-2 gap-3">
                  <Num label="Model year" value={r.year} onChange={setYear} min={1990} max={now.getFullYear() + 1} hint={years?.length && !years.includes(r.year) ? `EPA lists this model for ${yearRanges(years)}.` : undefined} />
                  <Select label="Body style" value={r.body} onChange={(v) => set('body', v)}>{BODY_STYLES.map((b) => <option key={b.name}>{b.name}</option>)}</Select>
                </div>
                {trims.length && !otherTrim ? (
                  <Select label="Trim" value={trims.some((t) => t.trim === r.trim) ? r.trim : '__other'} onChange={(v) => { if (v === '__other') { setOtherTrim(true); set('trim', ''); } else set('trim', v); }}>
                    {trims.map((t) => <option key={t.trim} value={t.trim}>{t.trim} · {usd(t.msrp)}</option>)}
                    <option value="__other">Other (type it)</option>
                  </Select>
                ) : (
                  <Text label="Trim" value={r.trim} onChange={(v) => set('trim', v)} max={80} placeholder="e.g. EX-L" hint={trims.length ? <button type="button" className="underline" onClick={() => { setOtherTrim(false); set('trim', trims[0].trim); }}>Back to the trim list</button> : undefined} />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Num label="Odometer (miles)" value={r.mileage} onChange={(v) => set('mileage', v)} min={0} max={600_000} />
                  <Num label="Asking price ($)" value={r.price} onChange={(v) => set('price', v)} min={0} max={2_000_000} />
                </div>
                <Num label="Original MSRP ($)" value={r.msrp ?? ''} onChange={(v) => set('msrp', v || null)} min={0} max={1_000_000} placeholder={onFile.msrp ? String(onFile.msrp) : 'required: none on file'}
                  hint={onFile.msrp ? (onFile.source === 'typical' ? `No price list for this model-year; ${usd(onFile.msrp)} is an estimate. Type the real one if you know it.` : `${usd(onFile.msrp)} is on file for this trim. Leave blank to use it.`) : 'Nothing on file for this car yet. Enter the sticker price to get a value.'} />
                <div className="grid grid-cols-2 gap-3">
                  <Text label="Exterior color" value={r.exterior} onChange={(v) => set('exterior', v)} max={40} />
                  <Text label="Interior" value={r.interior} onChange={(v) => set('interior', v)} max={40} placeholder="e.g. Black cloth" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Text label="VIN" value={r.vin} onChange={(v) => set('vin', v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} max={17} mono />
                  <Text label="Stock number" value={r.stock} onChange={(v) => set('stock', v)} max={20} />
                </div>
              </Group>

              <Group title="Condition & history">
                <div className="grid grid-cols-3 gap-3">
                  <Select label="Condition" value={r.condition} onChange={(v) => set('condition', v)}>{CONDITIONS.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
                  <Select label="Title" value={r.title} onChange={(v) => set('title', v)}>{TITLES.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
                  <Select label="Accidents" value={r.accident} onChange={(v) => set('accident', v)}>{ACCIDENTS.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Region (for the value)" value={r.region} onChange={(v) => set('region', v as CarRecord['region'])}>{REGIONS.map((x) => <option key={x}>{x}</option>)}</Select>
                  <Text label="ZIP (optional)" value={r.zip} onChange={(v) => set('zip', v.replace(/\D/g, '').slice(0, 5))} max={5} />
                </div>
              </Group>

              <Group title="Highlights" hint="Tick what the car has. The first 18 print; all of them show on the car page.">
                {FEATURE_GROUPS.map((g) => (
                  <fieldset key={g}>
                    <legend className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{g}</legend>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                      {FEATURES.filter((f) => f.group === g).map((f) => (
                        <label key={f.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={r.features.includes(f.id)} onChange={() => toggleFeature(f.id)} />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </Group>

              <Group title="Notes & fine print">
                <label className="block text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>From the dealer (optional)
                  <textarea className="field mt-1 w-full" rows={3} maxLength={400} value={r.notes} onChange={(e) => set('notes', e.target.value)} placeholder="One owner, serviced here since new. Second key and all-weather mats included." />
                </label>
                <Text label="Warranty line" value={r.warranty} onChange={(v) => set('warranty', v)} max={200} hint="The FTC Buyers Guide on the window is still required for used cars; this line should match it." />
                <div className="flex flex-wrap gap-5 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={r.showValue} onChange={(e) => set('showValue', e.target.checked)} /> Show the value snapshot on the sheet</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={r.showForecast} onChange={(e) => set('showForecast', e.target.checked)} disabled={!r.showValue} /> Include the 3-year projection</label>
                </div>
              </Group>
            </section>

            <section className="lg:col-span-7">
              {problems.length > 0 && (
                <p className="mb-3 rounded px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--glass-ink)' }}>
                  To finish the sheet, add {problems.join(', ').replace(/, ([^,]*)$/, ' and $1')}.
                </p>
              )}
              <ScaledSheet>
                <Sticker r={r} snap={snap} qr={qr} now={now} url={url} />
              </ScaledSheet>
              <p className="mt-3 text-xs" style={{ color: 'var(--glass-muted)' }}>
                Prints on letter paper. The QR link carries the whole car record ({encoded.length} characters), so the car page works without any account or database. Edit this sheet later by scanning it and tapping "Edit this sheet".
              </p>
            </section>
          </div>
        </div>
      </div>
      <div className="print-root">
        <Sticker r={r} snap={snap} qr={qr} now={now} url={url} />
      </div>
    </>
  );
}

/** Shows the fixed-size sheet scaled to the available width. */
function ScaledSheet({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / SHEET_W)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full overflow-hidden rounded-sm shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]" style={{ height: SHEET_H * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_W }}>{children}</div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-7 last:mb-0">
      <h2 className="font-cond text-xl font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm" style={{ color: 'var(--ink-3)' }}>{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Text({ label, value, onChange, max, placeholder, hint, mono }: { label: string; value: string; onChange: (v: string) => void; max: number; placeholder?: string; hint?: ReactNode; mono?: boolean }) {
  return (
    <label className="block text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}
      <input className={`field mt-1 w-full ${mono ? 'font-mono tracking-wider' : ''}`} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      {hint && <span className="mt-1 block text-xs font-normal" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  );
}

function Num({ label, value, onChange, min, max, placeholder, hint }: { label: string; value: number | ''; onChange: (v: number) => void; min: number; max: number; placeholder?: string; hint?: string }) {
  return (
    <label className="block text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}
      <input className="field num mt-1 w-full" inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => { const n = Number(e.target.value.replace(/[^\d]/g, '')); onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0))); }} />
      {hint && <span className="mt-1 block text-xs font-normal" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}
      <select className="field mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

function Glass({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition hover:brightness-110" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--glass-ink)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}>
      {icon}{children}
    </button>
  );
}
