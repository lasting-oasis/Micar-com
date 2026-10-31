import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, Link2, RotateCcw, Search } from 'lucide-react';
import { ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, REGIONS, SEGMENT_LABELS, TITLES } from './engine/data';
import { describe as describeListings, parseListingsPage, type ParsedListing } from './engine/listings';
import { MARKET, periodLabel, snapshotAgeDays } from './engine/market';
import { findModel, modelsForMake, yearRanges } from './engine/models';
import { prefillMsrp } from './engine/prefill';
import { stickerFor, trimChoices } from './engine/stickers';
import { expectedMilesFor, forecast, mileageAdjustedPrice, valuate, type Inputs, type Valuation } from './engine/valuation';
import { MARKET_OPTIONS, URGENCY_OPTIONS, defaults, parse, readUrl, shareUrl, urlHasMsrp, writeUrl, type Errors, type FormState } from './urlState';

const COMPS_URL: string | undefined = import.meta.env.VITE_COMPS_URL || undefined;

type LiveResult = { source: string; fetchedAt: string; count: number; listings: ParsedListing[]; query: { zip: string; radius: number } };

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const usdK = (n: number) => `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
const signed = (n: number) => (n >= 0 ? '+' : '−') + usd(Math.abs(n));

function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setV(target); from.current = target; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - p, 3);
      const cur = a + (target - a) * e;
      setV(cur); from.current = cur;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export default function App() {
  const [form, setForm] = useState<FormState>(readUrl);
  const [copied, setCopied] = useState(false);
  // Shareable links only make sense when the page is hosted on its own URL.
  const canShare = useMemo(() => { try { return window.self === window.top; } catch { return false; } }, []);
  const now = useMemo(() => new Date(), []);
  const { inputs: typed, errors } = useMemo(() => parse(form, now), [form, now]);

  // Market evidence: a pasted listings page and/or a live lookup.
  const [usePage, setUsePage] = useState(true);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [liveState, setLiveState] = useState<{ status: 'idle' | 'loading' | 'error'; message?: string }>({ status: 'idle' });
  const pageResult = useMemo(
    () => parseListingsPage(form.page, { model: form.model || undefined, year: Number(form.year) || undefined }),
    [form.page, form.model, form.year],
  );
  const evidence = useMemo(() => {
    const list: ParsedListing[] = [...(usePage ? pageResult.listings : []), ...(live?.listings ?? [])];
    const subjectMiles = Number(form.mileage) || 0;
    const expected = expectedMilesFor(Number(form.year) || now.getFullYear(), now);
    const comps = list.map((l) => Math.round(mileageAdjustedPrice(l.price, l.miles, subjectMiles, expected)));
    // A listing count is only trustworthy from a live lookup, a stated page total, or a reasonably full page.
    let count: number | null = null, countSource = '';
    if (live) { count = live.count; countSource = `${live.source} live lookup`; }
    else if (usePage && pageResult.resultCount) { count = pageResult.resultCount; countSource = pageResult.source ?? 'pasted page'; }
    else if (usePage && pageResult.listings.length >= 5) { count = pageResult.listings.length; countSource = pageResult.source ?? 'pasted page'; }
    return { comps, count, countSource };
  }, [usePage, pageResult, live, form.mileage, form.year, now]);
  const inputs = useMemo<Inputs | null>(() => typed ? {
    ...typed,
    comps: [...typed.comps, ...evidence.comps],
    listings: typed.listings ?? evidence.count,
  } : null, [typed, evidence]);

  const lastGood = useRef<Inputs | null>(inputs);
  if (inputs) lastGood.current = inputs;
  const active = inputs ?? lastGood.current;
  const stale = !inputs;

  const pullLive = async () => {
    if (!COMPS_URL || !typed) return;
    if (!/^\d{5}$/.test(form.zip.trim())) { setLiveState({ status: 'error', message: 'Enter a 5-digit ZIP first.' }); return; }
    setLiveState({ status: 'loading' });
    try {
      const q = new URLSearchParams({ make: typed.make, model: typed.model || typed.body, year: String(typed.year), zip: form.zip.trim(), radius: form.radius });
      const res = await fetch(`${COMPS_URL.replace(/\/$/, '')}?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`);
      setLive({ source: data.source, fetchedAt: data.fetchedAt, count: data.count, listings: data.listings, query: { zip: form.zip.trim(), radius: Number(form.radius) } });
      setLiveState({ status: 'idle' });
    } catch (err) {
      setLive(null);
      setLiveState({ status: 'error', message: err instanceof Error ? err.message : 'Lookup failed.' });
    }
  };

  const val = useMemo(() => (active ? valuate(active, now) : null), [active, now]);
  const annual = Math.min(30000, Math.max(3000, Number(form.annual) || 12000));
  const curve = useMemo(() => (active ? forecast(active, 5, annual, now) : []), [active, annual, now]);

  useEffect(() => { const t = setTimeout(() => writeUrl(form), 300); return () => clearTimeout(t); }, [form]);

  // MSRP is prefilled from the model table until the user types their own number.
  const [msrpAuto, setMsrpAuto] = useState(() => !urlHasMsrp());
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    if (k === 'msrp') setMsrpAuto(false);
    if (k === 'make' || k === 'model' || k === 'year') setLive(null);
    const refill = k === 'model' || k === 'trim' || ((k === 'make' || k === 'year') && msrpAuto);
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (k === 'make') {
        const first = modelsForMake(value)[0];
        next.model = first ? first.model : '';
        next.trim = '';
        if (first) next.body = first.body;
      }
      if (k === 'model') {
        const info = findModel(next.make, value);
        if (info) next.body = info.body;
        next.trim = '';
      }
      if (k === 'year' || k === 'model' || k === 'make') {
        // Snap the trim to the sticker list for this year when there is one.
        const st = stickerFor(next.make, next.model, Number(next.year));
        if (st && !st.year.trims.some((t) => t.trim === next.trim)) next.trim = k === 'year' && next.trim ? next.trim : st.year.trims[0].trim;
      }
      if (refill) {
        const p = prefillMsrp(next.make, next.model, Number(next.year) || now.getFullYear(), next.trim);
        if (p) next.msrp = String(p.msrp);
      }
      return next;
    });
    if (k === 'model' || k === 'trim') setMsrpAuto(true);
  };

  const copyLink = async () => {
    const url = shareUrl(form);
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const vehicleName = [active?.year, active?.make, form.model, form.trim.trim()].filter(Boolean).join(' ');
  const asOfLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen py-6 sm:px-4 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4" style={{ color: 'var(--glass-ink)' }}>
          <div>
            <h1 className="font-cond text-3xl font-semibold leading-none tracking-tight sm:text-4xl">Nexus Valuation</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--glass-muted)' }}>What a used car is worth today, and what it will be worth later.</p>
          </div>
          <div className="flex gap-2">
            <GlassButton onClick={() => { setForm(defaults()); setMsrpAuto(true); setLive(null); setLiveState({ status: 'idle' }); }} icon={<RotateCcw size={15} />}>Start over</GlassButton>
            {canShare && <GlassButton onClick={copyLink} icon={copied ? <Check size={15} /> : <Link2 size={15} />}>{copied ? 'Link copied' : 'Copy link to this estimate'}</GlassButton>}
          </div>
        </header>

        <main className="overflow-hidden rounded-md shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]" style={{ background: 'var(--sticker)' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3 sm:px-7" style={{ background: 'var(--ink)', color: 'var(--sticker)' }}>
            <p className="font-cond text-xl font-semibold sm:text-2xl">{vehicleName || 'Your vehicle'}</p>
            <p className="text-sm opacity-80">{form.body} · Estimate for {asOfLabel}</p>
          </div>

          <div className="grid lg:grid-cols-12">
            <section aria-labelledby="vehicle-h" className="border-b p-5 sm:p-7 lg:col-span-5 lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--rule)' }}>
              <h2 id="vehicle-h" className="font-cond text-xl font-semibold">Vehicle details</h2>
              <p className="mb-5 text-sm" style={{ color: 'var(--ink-3)' }}>Prices update as you type.</p>
              <VehicleForm form={form} set={set} errors={errors} msrpAuto={msrpAuto} />
              <h2 id="market-h" className="mt-8 font-cond text-xl font-semibold">Local market</h2>
              <p className="mb-5 text-sm" style={{ color: 'var(--ink-3)' }}>Optional. What you see on listing sites near you beats any formula.</p>
              <MarketForm form={form} set={set} errors={errors} pageResult={pageResult} usePage={usePage} setUsePage={setUsePage} live={live} liveState={liveState} pullLive={pullLive} clearLive={() => setLive(null)} evidence={evidence} />
            </section>

            <section aria-labelledby="value-h" aria-live="polite" className={`p-5 sm:p-7 lg:col-span-7 transition-opacity ${stale ? 'opacity-50' : ''}`}>
              <h2 id="value-h" className="sr-only">Estimated value</h2>
              {val && <Prices val={val} />}
              {val && <Ledger val={val} />}
            </section>
          </div>

          {val && active && (
            <div className="grid border-t lg:grid-cols-12" style={{ borderColor: 'var(--rule)' }}>
              <section aria-labelledby="fc-h" className={`border-b p-5 sm:p-7 lg:col-span-8 lg:border-b-0 lg:border-r ${stale ? 'opacity-50' : ''}`} style={{ borderColor: 'var(--rule)' }}>
                <Forecast curve={curve} annual={annual} setAnnual={set('annual')} />
              </section>
              <section aria-labelledby="conf-h" className="p-5 sm:p-7 lg:col-span-4">
                <Confidence val={val} />
                <Drivers val={val} modelName={form.model} />
              </section>
            </div>
          )}

          <footer className="border-t px-5 py-4 text-xs leading-relaxed sm:px-7" style={{ borderColor: 'var(--rule)', background: 'var(--sticker-2)', color: 'var(--ink-3)' }}>
            Estimates start from the typical five-year resale value of each model, adjusted for mileage, condition, history, region, the market cycle and local supply. The model data is a rule-of-thumb snapshot, not a live feed of listings or auction sales, so the asking prices you enter under Local market carry real weight. Use the result as a starting point before you buy, sell or trade.
          </footer>
        </main>
      </div>
    </div>
  );
}

function GlassButton({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors hover:bg-white/15" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--glass-ink)', border: '1px solid rgba(255,255,255,0.14)' }}>
      {icon}{children}
    </button>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}</label>
      {children}
      {error ? <p id={`${id}-err`} className="mt-1 text-xs" style={{ color: 'var(--loss)' }}>{error}</p>
        : hint ? <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>{hint}</p> : null}
    </div>
  );
}

function Segmented({ name, legend, value, options, onChange }: { name: string; legend: string; value: string; options: { name: string; desc: string }[]; onChange: (v: string) => void }) {
  const current = options.find((o) => o.name === value);
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{legend}</legend>
      <div className="seg" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((o) => (
          <label key={o.name} title={o.desc}>
            <input type="radio" name={name} value={o.name} checked={value === o.name} onChange={() => onChange(o.name)} />
            {o.name}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>{current?.desc}</p>
    </fieldset>
  );
}

function VehicleForm({ form, set, errors, msrpAuto }: { form: FormState; set: (k: keyof FormState) => (e: { target: { value: string } }) => void; errors: Errors; msrpAuto: boolean }) {
  const err = (k: keyof FormState) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${k}-err` : undefined });
  const radio = (k: keyof FormState) => (v: string) => set(k)({ target: { value: v } });
  const models = modelsForMake(form.make);
  const sticker = stickerFor(form.make, form.model, Number(form.year));
  const prefill = prefillMsrp(form.make, form.model, Number(form.year) || new Date().getFullYear(), form.trim);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field id="make" label="Make">
          <select id="make" className="field" value={form.make} onChange={set('make')}>
            {(Object.keys(SEGMENT_LABELS) as (keyof typeof SEGMENT_LABELS)[]).map((seg) => (
              <optgroup key={seg} label={SEGMENT_LABELS[seg]}>
                {MAKES.filter((m) => m.segment === seg).map((m) => <option key={m.name}>{m.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field id="model" label="Model">
          <select id="model" className="field" value={models.some((m) => m.model === form.model) ? form.model : ''} onChange={set('model')}>
            {models.filter((m) => !m.source).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
            {models.some((m) => m.source) && (
              <optgroup label={models.some((m) => !m.source) ? 'More models (estimated sticker)' : 'Models (estimated sticker)'}>
                {models.filter((m) => m.source).sort((a, b) => a.model.localeCompare(b.model)).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
              </optgroup>
            )}
            <option value="">{models.length ? 'Not listed' : 'No model data for this make'}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="trim" label="Trim" hint={sticker ? undefined : 'Optional'}>
          {sticker ? (
            <select id="trim" className="field" value={sticker.year.trims.some((t) => t.trim === form.trim) ? form.trim : sticker.year.trims[0].trim} onChange={set('trim')}>
              {trimChoices(sticker.year).map((t) => <option key={t.trim} value={t.trim}>{t.trim} · ${t.msrp.toLocaleString()}</option>)}
            </select>
          ) : (
            <input id="trim" className="field" placeholder="e.g. XLE" value={form.trim} onChange={set('trim')} maxLength={40} autoComplete="off" />
          )}
        </Field>
        <Field id="body" label="Body style">
          <select id="body" className="field" value={form.body} onChange={set('body')}>
            {BODY_STYLES.map((b) => <option key={b.name}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id="msrp" label="Original sticker price (MSRP)" error={errors.msrp} hint={msrpAuto && prefill ? `${prefill.label}${prefill.note ? ` ${prefill.note}.` : ''}` : undefined}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--ink-3)' }}>$</span>
          <input id="msrp" className="field num" style={{ paddingLeft: '1.5rem' }} inputMode="numeric" value={form.msrp} onChange={set('msrp')} {...err('msrp')} />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="year" label="Model year" error={errors.year} hint={yearHint(form.make, form.model, Number(form.year))}>
          <input id="year" className="field num" inputMode="numeric" value={form.year} onChange={set('year')} {...err('year')} />
        </Field>
        <Field id="mileage" label="Odometer (miles)" error={errors.mileage}>
          <input id="mileage" className="field num" inputMode="numeric" value={form.mileage} onChange={set('mileage')} {...err('mileage')} />
        </Field>
      </div>
      <Segmented name="condition" legend="Condition" value={form.condition} options={CONDITIONS} onChange={radio('condition')} />
      <Segmented name="title" legend="Title" value={form.title} options={TITLES} onChange={radio('title')} />
      <Segmented name="accident" legend="Accident history" value={form.accident} options={ACCIDENTS} onChange={radio('accident')} />
      <Field id="region" label="Where it will be sold">
        <select id="region" className="field" value={form.region} onChange={set('region')}>
          {REGIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
    </div>
  );
}

type MarketFormProps = {
  form: FormState;
  set: (k: keyof FormState) => (e: { target: { value: string } }) => void;
  errors: Errors;
  pageResult: ReturnType<typeof parseListingsPage>;
  usePage: boolean;
  setUsePage: (v: boolean) => void;
  live: LiveResult | null;
  liveState: { status: 'idle' | 'loading' | 'error'; message?: string };
  pullLive: () => void;
  clearLive: () => void;
  evidence: { comps: number[]; count: number | null; countSource: string };
};

function MarketForm({ form, set, errors, pageResult, usePage, setUsePage, live, liveState, pullLive, clearLive, evidence }: MarketFormProps) {
  const radio = (k: keyof FormState) => (v: string) => set(k)({ target: { value: v } });
  const pasted = form.page.trim().length > 0;
  return (
    <div className="space-y-4">
      <Segmented name="market" legend="Used-car market right now" value={form.market} options={MARKET_OPTIONS} onChange={radio('market')} />
      {form.market === 'Auto' && <MarketStrip />}

      <Field id="page" label="Paste a listings page" hint={pasted ? undefined : 'Search for your model near you on Facebook Marketplace, OfferUp, Craigslist, CarGurus, Autotrader or Cars.com, select the whole results page (Ctrl+A / Cmd+A), copy, and paste it here. Prices, years and mileage are read from the text; nothing is fetched from those sites.'}>
        <textarea id="page" className="field" rows={pasted ? 2 : 3} value={form.page} onChange={set('page')} placeholder="Paste the whole search-results page here" spellCheck={false} />
      </Field>
      {pasted && (
        <div className="-mt-2 rounded px-3 py-2 text-xs" style={{ background: 'var(--sticker-2)', color: 'var(--ink-2)' }}>
          <p>{describeListings(pageResult, form.model || undefined)}</p>
          {pageResult.listings.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={usePage} onChange={(e) => setUsePage(e.target.checked)} />
                Use these as comps{pageResult.listings.some((l) => l.miles) ? ', adjusted to your mileage' : ''}
              </label>
              <button type="button" className="underline" onClick={() => set('page')({ target: { value: '' } })}>Clear</button>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Pull live asking prices near a ZIP</p>
        {COMPS_URL ? (
          <>
            <div className="flex flex-wrap items-stretch gap-2">
              <input id="zip" aria-label="ZIP code" className="field num w-28" inputMode="numeric" placeholder="ZIP" value={form.zip} onChange={set('zip')} maxLength={5} aria-invalid={errors.zip ? true : undefined} />
              <select id="radius" aria-label="Search radius" className="field w-32" value={form.radius} onChange={set('radius')}>
                <option value="25">25 miles</option>
                <option value="50">50 miles</option>
                <option value="100">100 miles</option>
              </select>
              <button type="button" onClick={pullLive} disabled={liveState.status === 'loading'} className="inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-semibold disabled:opacity-60" style={{ background: 'var(--ink)', color: 'var(--sticker)' }}>
                <Search size={15} />{liveState.status === 'loading' ? 'Looking…' : 'Pull live comps'}
              </button>
            </div>
            {errors.zip && <p className="mt-1 text-xs" style={{ color: 'var(--loss)' }}>{errors.zip}</p>}
            {liveState.status === 'error' && <p className="mt-1 text-xs" style={{ color: 'var(--loss)' }}>{liveState.message}</p>}
            {live && (
              <div className="mt-2 rounded px-3 py-2 text-xs" style={{ background: 'var(--sticker-2)', color: 'var(--ink-2)' }}>
                <p>{live.count.toLocaleString()} similar cars listed within {live.query.radius} miles of {live.query.zip} · {live.listings.length} priced · {live.source}, just now</p>
                <button type="button" className="mt-1 underline" onClick={clearLive}>Clear</button>
              </div>
            )}
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>Dealer inventory only; private sales don't show up here. Each pull uses one of a small monthly budget.</p>
          </>
        ) : (
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>Not connected yet. It takes two free accounts and about ten minutes; the README has the steps. Until then, pasting a listings page does the same job.</p>
        )}
      </div>

      <Field id="listings" label="Similar cars for sale near you" error={errors.listings} hint={evidence.count !== null && form.listings.trim() === '' ? `Using ${evidence.count.toLocaleString()} from the ${evidence.countSource}. Type a number to override.` : 'Count the same model, within a few years, on a listing site within about 50 miles. Around 10 is typical.'}>
        <input id="listings" className="field num" inputMode="numeric" placeholder={evidence.count !== null ? String(evidence.count) : 'e.g. 12'} value={form.listings} onChange={set('listings')} aria-invalid={errors.listings ? true : undefined} aria-describedby={errors.listings ? 'listings-err' : undefined} />
      </Field>
      <Segmented name="urgency" legend="How fast it needs to sell" value={form.urgency} options={URGENCY_OPTIONS} onChange={radio('urgency')} />
      <Field id="comps" label="Other asking prices you've seen" hint={evidence.comps.length ? `${evidence.comps.length} price${evidence.comps.length > 1 ? 's' : ''} already come from the page or lookup above; add any others here.` : 'Up to 8 prices for similar cars nearby, separated by commas. The estimate leans on them more the more you add.'}>
        <input id="comps" className="field num" placeholder="e.g. 21500, 22900, 20995" value={form.comps} onChange={set('comps')} maxLength={120} autoComplete="off" />
      </Field>
    </div>
  );
}

function Prices({ val }: { val: Valuation }) {
  const pp = useTween(val.privateParty);
  return (
    <div>
      <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Private-party value</p>
      <p className="font-cond num text-6xl font-bold leading-none tracking-tight sm:text-7xl">{usd(pp)}</p>
      <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
        Most sales of a car like this land between <strong className="num">{usd(val.range.low)}</strong> and <strong className="num">{usd(val.range.high)}</strong>.
      </p>
      {val.compsUsed > 0 && (
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
          The model alone says <span className="num">{usd(val.modelEstimate)}</span>; your {val.compsUsed} asking price{val.compsUsed > 1 ? 's' : ''} moved it {val.privateParty >= val.modelEstimate ? 'up' : 'down'}.
        </p>
      )}
      <RangeBar val={val} />
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded" style={{ background: 'var(--rule)' }}>
        <PriceCell label="Trade-in offer" value={val.tradeIn} note="What a dealer would likely pay you. Lower because they still need to recondition and resell it." />
        <PriceCell label="Dealer retail" value={val.dealerRetail} note="What you'd likely see on a dealer's lot, including their reconditioning and margin." />
      </div>
    </div>
  );
}

function RangeBar({ val }: { val: Valuation }) {
  const lo = val.tradeIn * 0.95, hi = val.dealerRetail * 1.03;
  const pct = (n: number) => `${((n - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="relative h-2 rounded-full" style={{ background: 'var(--sticker-2)', boxShadow: 'inset 0 0 0 1px var(--rule)' }}>
        <div className="absolute inset-y-0 rounded-full" style={{ left: pct(val.range.low), width: `calc(${pct(val.range.high)} - ${pct(val.range.low)})`, background: 'var(--blue-soft)' }} />
        {[{ n: val.tradeIn, c: 'var(--ink-3)' }, { n: val.privateParty, c: 'var(--blue)' }, { n: val.dealerRetail, c: 'var(--ink-3)' }].map((m, i) => (
          <div key={i} className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pct(m.n), background: m.c }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs" style={{ color: 'var(--ink-3)' }}>
        <span>Trade-in</span><span>Dealer retail</span>
      </div>
    </div>
  );
}

function PriceCell({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="p-4" style={{ background: 'var(--sticker)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{label}</p>
      <p className="font-cond num text-3xl font-semibold leading-tight">{usd(value)}</p>
      <p className="mt-1 text-xs leading-snug" style={{ color: 'var(--ink-3)' }}>{note}</p>
    </div>
  );
}

function Ledger({ val }: { val: Valuation }) {
  return (
    <div className="mt-7">
      <h3 className="font-cond text-xl font-semibold">How the price is built</h3>
      <ol className="mt-2">
        {val.steps.map((s, i) => (
          <li key={s.label} className="py-1.5">
            <div className="flex items-end">
              <span className="font-medium">{s.label}</span>
              <span className="leader" />
              <span className="num font-semibold" style={{ color: i === 0 || Math.abs(s.delta) < 1 ? 'var(--ink-2)' : s.delta < 0 ? 'var(--loss)' : 'var(--gain)' }}>
                {i === 0 ? usd(s.value) : Math.abs(s.delta) < 1 ? 'No change' : signed(s.delta)}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>{s.detail}</p>
          </li>
        ))}
        <li className="mt-1 flex items-end border-t-2 pt-2" style={{ borderColor: 'var(--ink)' }}>
          <span className="font-semibold">Private-party value</span>
          <span className="leader" />
          <span className="num font-bold">{usd(val.privateParty)}</span>
        </li>
      </ol>
    </div>
  );
}

function Forecast({ curve, annual, setAnnual }: { curve: ReturnType<typeof forecast>; annual: number; setAnnual: (e: { target: { value: string } }) => void }) {
  const first = curve[0]?.value ?? 0, last = curve[curve.length - 1]?.value ?? 0;
  const data = curve.map((d) => ({ ...d, band: [d.low, d.high] as [number, number] }));
  const min = Math.min(...curve.map((d) => d.low)), max = Math.max(...curve.map((d) => d.high));
  const pad = (max - min) * 0.1 || 1000;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="fc-h" className="font-cond text-xl font-semibold">Value over the next five years</h3>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Expected to lose <strong className="num" style={{ color: 'var(--loss)' }}>{usd(first - last)}</strong> by {curve[curve.length - 1]?.year}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="annual" style={{ color: 'var(--ink-2)' }}>Miles you drive per year</label>
        <input id="annual" type="range" min={3000} max={30000} step={1000} value={annual} onChange={setAnnual} className="w-40 accent-[var(--blue)]" />
        <span className="num font-semibold">{annual.toLocaleString()}</span>
      </div>
      <div className="mt-3 h-60" role="img" aria-label={`Private-party value falls from ${usd(first)} to ${usd(last)} over five years.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--rule)" strokeOpacity={0.6} />
            <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--rule)' }} tick={{ fill: 'var(--ink-3)', fontSize: 12 }} />
            <YAxis domain={[Math.max(0, min - pad), max + pad]} tickFormatter={usdK} tickLine={false} axisLine={false} width={52} tick={{ fill: 'var(--ink-3)', fontSize: 12 }} tickCount={5} />
            <Tooltip content={<ForecastTip />} cursor={{ stroke: 'var(--ink-3)', strokeDasharray: '3 3' }} />
            <Area dataKey="band" stroke="none" fill="var(--blue-soft)" fillOpacity={0.8} isAnimationActive={false} activeDot={false} />
            <Line dataKey="value" stroke="var(--blue)" strokeWidth={2} dot={{ r: 4, fill: 'var(--blue)', stroke: 'var(--sticker)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>Line shows the private-party estimate; the shaded band is the likely range.</p>
    </div>
  );
}

function ForecastTip({ active, payload }: { active?: boolean; payload?: { payload: { year: string; value: number; low: number; high: number; mileage: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border px-3 py-2 text-sm shadow-lg" style={{ background: 'var(--sticker)', borderColor: 'var(--rule)', color: 'var(--ink)' }}>
      <p className="font-semibold">{d.year}</p>
      <p className="num">{usd(d.value)} <span style={{ color: 'var(--ink-3)' }}>({usdK(d.low)}–{usdK(d.high)})</span></p>
      <p className="num text-xs" style={{ color: 'var(--ink-3)' }}>About {d.mileage.toLocaleString()} miles</p>
    </div>
  );
}

function Confidence({ val }: { val: Valuation }) {
  const color = val.confidence === 'High' ? 'var(--gain)' : val.confidence === 'Medium' ? 'var(--warn)' : 'var(--loss)';
  const filled = val.confidence === 'High' ? 3 : val.confidence === 'Medium' ? 2 : 1;
  return (
    <div>
      <h3 id="conf-h" className="font-cond text-xl font-semibold">How sure is this estimate?</h3>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="h-2.5 w-6 rounded-sm" style={{ background: i < filled ? color : 'var(--rule)' }} />)}
        </div>
        <p className="font-semibold" style={{ color }}>{val.confidence} confidence</p>
      </div>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>The range is ±{Math.round(val.bandPct * 100)}% of the private-party value.</p>
      <ul className="mt-3 space-y-1.5 text-sm" style={{ color: 'var(--ink-2)' }}>
        {val.confidenceReasons.map((r) => <li key={r} className="flex gap-2"><span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>–</span>{r}</li>)}
      </ul>
    </div>
  );
}

function Drivers({ val, modelName }: { val: Valuation; modelName: string }) {
  return (
    <div className="mt-6">
      <h3 className="font-cond text-xl font-semibold">{val.modelKnown && modelName ? `Why the ${modelName} prices this way` : 'What drives this price'}</h3>
      <ul className="mt-2 space-y-1.5 text-sm" style={{ color: 'var(--ink-2)' }}>
        {val.drivers.map((d) => <li key={d} className="flex gap-2"><span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>–</span>{d}</li>)}
      </ul>
    </div>
  );
}

/** Two years of the national used-car price index, from the weekly snapshot. */
function MarketStrip() {
  const h = MARKET.history;
  if (h.length < 2) return null;
  const w = 240, ht = 44, pad = 3;
  const min = Math.min(...h.map((d) => d.value)), max = Math.max(...h.map((d) => d.value));
  const x = (i: number) => pad + (i / (h.length - 1)) * (w - pad * 2);
  const y = (v: number) => ht - pad - ((v - min) / (max - min || 1)) * (ht - pad * 2);
  const path = h.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const last = h[h.length - 1];
  const stale = snapshotAgeDays() > 75;
  const tone = MARKET.condition === 'tight' ? 'var(--gain)' : MARKET.condition === 'soft' ? 'var(--loss)' : 'var(--blue)';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded px-3 py-2" style={{ background: 'var(--sticker-2)' }}>
      <svg width={w} height={ht} viewBox={`0 0 ${w} ${ht}`} className="max-w-full" role="img" aria-label={`National used-car price index, ${periodLabel(h[0].period)} to ${periodLabel(last.period)}`}>
        <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(h.length - 1)} cy={y(last.value)} r="3" fill={tone} />
      </svg>
      <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
        <p><span className="font-semibold" style={{ color: 'var(--ink-2)' }}>Reading: {MARKET.condition === 'normal' ? 'Normal' : MARKET.condition === 'soft' ? 'Soft' : 'Tight'}</span> · index {MARKET.latestValue.toFixed(1)} for {periodLabel(MARKET.latestPeriod)}</p>
        <p>{periodLabel(h[0].period)} to {periodLabel(last.period)} · refreshed {MARKET.fetchedAt}{stale ? ' · this snapshot is stale; the weekly update may have failed' : ''}</p>
      </div>
    </div>
  );
}

/** Warns when the EPA list has no such model year (e.g. a year the model wasn't sold). */
function yearHint(make: string, model: string, year: number): string | undefined {
  const years = findModel(make, model)?.years;
  if (!years?.length || !year || years.includes(year)) return undefined;
  return `The EPA has no ${year} ${model}; it lists ${yearRanges(years)}.`;
}
