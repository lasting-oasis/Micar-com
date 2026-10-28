import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, Link2, RotateCcw } from 'lucide-react';
import { ACCIDENTS, BODY_STYLES, CONDITIONS, MAKES, REGIONS, TITLES } from './engine/data';
import { forecast, valuate, type Inputs, type Valuation } from './engine/valuation';
import { defaults, parse, readUrl, shareUrl, writeUrl, type Errors, type FormState } from './urlState';

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
  const { inputs, errors } = useMemo(() => parse(form, now), [form, now]);
  const lastGood = useRef<Inputs | null>(inputs);
  if (inputs) lastGood.current = inputs;
  const active = inputs ?? lastGood.current;
  const stale = !inputs;

  const val = useMemo(() => (active ? valuate(active, now) : null), [active, now]);
  const annual = Math.min(30000, Math.max(3000, Number(form.annual) || 12000));
  const curve = useMemo(() => (active ? forecast(active, 5, annual, now) : []), [active, annual, now]);

  useEffect(() => { const t = setTimeout(() => writeUrl(form), 300); return () => clearTimeout(t); }, [form]);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

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

  const vehicleName = [active?.year, active?.make, form.model.trim()].filter(Boolean).join(' ');
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
            <GlassButton onClick={() => setForm(defaults())} icon={<RotateCcw size={15} />}>Start over</GlassButton>
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
              <VehicleForm form={form} set={set} errors={errors} />
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
              </section>
            </div>
          )}

          <footer className="border-t px-5 py-4 text-xs leading-relaxed sm:px-7" style={{ borderColor: 'var(--rule)', background: 'var(--sticker-2)', color: 'var(--ink-3)' }}>
            Estimates come from typical depreciation for each brand and body style, adjusted for mileage, condition, history and region. They are not based on live listings or auction sales, so use them as a starting point and compare against local listings before you buy, sell or trade.
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

function VehicleForm({ form, set, errors }: { form: FormState; set: (k: keyof FormState) => (e: { target: { value: string } }) => void; errors: Errors }) {
  const err = (k: keyof FormState) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${k}-err` : undefined });
  const radio = (k: keyof FormState) => (v: string) => set(k)({ target: { value: v } });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field id="make" label="Make">
          <select id="make" className="field" value={form.make} onChange={set('make')}>
            {MAKES.map((m) => <option key={m.name}>{m.name}</option>)}
          </select>
        </Field>
        <Field id="body" label="Body style">
          <select id="body" className="field" value={form.body} onChange={set('body')}>
            {BODY_STYLES.map((b) => <option key={b.name}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id="model" label="Model and trim" hint="Optional, but it narrows the price range.">
        <input id="model" className="field" placeholder="e.g. RAV4 XLE" value={form.model} onChange={set('model')} maxLength={60} autoComplete="off" />
      </Field>
      <Field id="msrp" label="Original sticker price (MSRP)" error={errors.msrp}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--ink-3)' }}>$</span>
          <input id="msrp" className="field num" style={{ paddingLeft: '1.5rem' }} inputMode="numeric" value={form.msrp} onChange={set('msrp')} {...err('msrp')} />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="year" label="Model year" error={errors.year}>
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

function Prices({ val }: { val: Valuation }) {
  const pp = useTween(val.privateParty);
  return (
    <div>
      <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Private-party value</p>
      <p className="font-cond num text-6xl font-bold leading-none tracking-tight sm:text-7xl">{usd(pp)}</p>
      <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
        Most sales of a car like this land between <strong className="num">{usd(val.range.low)}</strong> and <strong className="num">{usd(val.range.high)}</strong>.
      </p>
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
