// The door: MiCar's home page. Type the car, the door opens on what it's worth, on a card.
// Every section below the hero shows that same card going through each thing MiCar does with it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { carName, carPageUrl, calculatorUrl, emptyRecord, stickerPageUrl, type CarRecord } from '../car/record';
import { usd } from '../car/value';
import { CONDITIONS, MAKES, SEGMENT_LABELS } from '../engine/data';
import { modelsForMake } from '../engine/models';
import { stickerFor, trimChoices } from '../engine/stickers';
import { t, tx, useLang } from '../i18n';
import calibration from '../data/calibration.json';
import stickers from '../data/stickers.json';
import samples from '../data/listing-samples.json';
import { Bay } from './Bay';
import { doorDefaults, gradeOf, makeCard, recordFrom, sampleCard, settle, type Card, type DoorInput, type GradeInputs } from './card';
import { GradeSim } from './GradeSim';
import { Inspector } from './Inspector';
import { Slab, useQr } from './Slab';
import { Strip } from '../Strip';
import { Footer } from '../Footer';
import '../door.css';

import { WORLD_URL, SHOP_URL } from '@micar/brand';
export { WORLD_URL, SHOP_URL };

const STATS = {
  models: stickers.length,
  trims: (stickers as { years: { trims: unknown[] }[] }[]).reduce((a, s) => a + s.years.reduce((b, y) => b + y.trims.length, 0), 0),
  listings: (samples as { samples: { listings: unknown[] }[] }[]).reduce((a, s) => a + s.samples.reduce((b, p) => b + p.listings.length, 0), 0),
  calibrated: (calibration as { models: unknown[] }).models.length,
};

const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Key-fob chirp and the deadbolt thud, from the concept: user-initiated, tiny, and skipped when audio is unavailable.
let ac: AudioContext | null = null;
const audio = () => { try { const AC = window.AudioContext; if (!AC) return null; return (ac ??= new AC()); } catch { return null; } };
function chirp(n: number) {
  const a = audio(); if (!a) return;
  for (let k = 0; k < n; k++) {
    const o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 2600; o.connect(g); g.connect(a.destination);
    const s = a.currentTime + k * 0.14; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.04, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.07); o.start(s); o.stop(s + 0.08);
  }
}
function thud() {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, a.currentTime); o.frequency.exponentialRampToValueAtTime(45, a.currentTime + 0.18);
  o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.3, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.22); o.start(); o.stop(a.currentTime + 0.24);
}

const Key = () => <svg className="key" viewBox="0 0 26 26" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M12.5 12.5 L23 23 M19 19 L22 16 M16 16 L19 13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>;
const Arrow = () => <svg className="arrow" viewBox="0 0 22 14" aria-hidden="true"><path d="M1 7 H20 M14 1 L20 7 L14 13" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>;

export default function Door() {
  const lang = useLang();
  const now = useMemo(() => new Date(), []);
  const sample = useMemo(() => sampleCard(now), [now]);
  const [input, setInput] = useState<DoorInput>(() => doorDefaults(now));
  const [card, setCard] = useState<Card | null>(null);
  const [g, setG] = useState<GradeInputs | null>(null);
  const [open, setOpen] = useState(false);
  const [unbolted, setUnbolted] = useState(false);
  const [lit, setLit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState('');
  const [readoutSmall, setReadoutSmall] = useState('');
  const [stampHit, setStampHit] = useState(false);
  const [showcaseClass, setShowcaseClass] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState('');
  const timers = useRef<number[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const shown: Card | null = card ?? sample;
  const shownG: GradeInputs | null = g ?? shown?.g ?? null;

  useEffect(() => { setReadout(t('Locked · Bay 01')); setReadoutSmall(t('type a car to open it')); }, [lang]);
  useEffect(() => { const id = window.setTimeout(() => setLit(true), 200); return () => window.clearTimeout(id); }, []);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const later = (fn: () => void, ms: number) => { if (reduce()) { fn(); return; } timers.current.push(window.setTimeout(fn, ms)); };
  const clearSeq = () => { timers.current.forEach(window.clearTimeout); timers.current = []; };

  const set = (k: keyof DoorInput) => (e: { target: { value: string } }) => setInput((d) => settle({ ...d, [k]: e.target.value }, k));

  const runSequence = (c: Card) => {
    setCard(c); setG(c.g); setStampHit(false); setShowcaseClass('');
    chirp(2); setReadout(t('Valuing…')); setReadoutSmall(carName(c.r));
    later(() => { setReadout(`${c.r.year} ${c.r.model || c.r.modelText} ✓`); }, 650);
    later(() => { setUnbolted(true); thud(); }, 1050);
    later(() => { setOpen(true); setLit(true); setShowcaseClass('slam'); setReadout(t('Bay 01 open')); }, 1500);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    const r = recordFrom(input, now);
    const c = makeCard(r, now);
    if (!c) { setError(t("We don't have a sticker price on file for that one yet, so the door stays shut. Value it line by line instead.")); return; }
    setBusy(true); clearSeq();
    if (open) {
      // A new car while the bay is open: close, then run the sequence for the new card.
      chirp(1); setOpen(false); setReadout(t('Closing…'));
      later(() => { setUnbolted(false); thud(); runSequence(c); }, 1900);
    } else runSequence(c);
  };

  const settled = useCallback((isOpen: boolean) => {
    if (isOpen) { setStampHit(true); setReadout(t('Value on the card')); setReadoutSmall(t('tap it to inspect')); setBusy(false); }
  }, []);

  const closeDoor = () => { if (!open || busy) return; clearSeq(); chirp(1); setOpen(false); setReadout(t('Closing…')); later(() => { setUnbolted(false); thud(); setReadout(t('Locked · Bay 01')); setReadoutSmall(t('type a car to open it')); }, 1900); };

  const rootClass = ['dp', reduce() ? '' : 'anim', 'revealed', lit ? 'lit' : '', open ? 'open' : '', unbolted ? 'unbolted' : '', inspecting ? 'inspecting' : ''].join(' ');
  const sticker = stickerFor(input.make, input.model, Number(input.year));
  const trims = sticker ? trimChoices(sticker.year) : [];
  const models = modelsForMake(input.make);
  const years = useMemo(() => Array.from({ length: now.getFullYear() + 1 - 1995 }, (_, i) => now.getFullYear() + 1 - i), [now]);

  return (
    <div className={rootClass}>
      <div className="grain" aria-hidden="true" />
      <Strip current="home" />

      <header className="hero gutter" id="top">
        <div className="inner">
          <Bay open={open} onSettled={settled} onInspect={card ? () => setInspecting(true) : undefined}
            showcase={card ? <Slab card={card} g={g ?? undefined} /> : null} showcaseClass={showcaseClass}
            readout={readout} readoutSmall={readoutSmall} stamp={t('Valued')} stampHit={stampHit}
            paint={lang === 'es' ? <>¿Qué hay<br />en su<br />garaje?</> : <>What's in<br />your<br />garage?</>}>
          <form className="console" ref={formRef} onSubmit={submit} aria-label={t("What's in your garage?")}>
            <div className="con-head"><span className="marker">{t("what's in your garage?")}</span><small>{t('free · no account · nothing to sign')}</small></div>
            <div className="con-grid">
              <label><span>{t('Year')}</span><select value={input.year} onChange={set('year')}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
              <label><span>{t('Make')}</span><select value={input.make} onChange={set('make')}>
                {Object.entries(SEGMENT_LABELS).map(([seg, label]) => <optgroup key={seg} label={t(label as string)}>{MAKES.filter((m) => m.segment === seg).map((m) => <option key={m.name} value={m.name}>{m.name === 'Other' ? t('Other') : m.name}</option>)}</optgroup>)}
              </select></label>
              <label><span>{t('Model')}</span><select value={input.model} onChange={set('model')}>{models.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</select></label>
              {trims.length > 0 && <label><span>{t('Trim')}</span><select value={input.trim} onChange={set('trim')}>{trims.map((tr) => <option key={tr.trim} value={tr.trim}>{tr.trim}</option>)}</select></label>}
              <label><span>{t('Miles')}</span><input type="number" inputMode="numeric" min={0} max={600000} step={100} value={input.mileage} onChange={set('mileage')} /></label>
              <label><span>{t('Condition')}</span><select value={input.condition} onChange={set('condition')}>{CONDITIONS.map((c) => <option key={c.name} value={c.name}>{t(c.name)}</option>)}</select></label>
            </div>
            <div className="con-foot">
              <button type="submit" className="drip" disabled={busy}>{open ? t('Value another') : t('Open the door')} <Arrow /></button>
              {open && <button type="button" className="ghostbtn" onClick={closeDoor} disabled={busy}>{t('Close it')}</button>}
              {error && <p className="con-err">{error} <a href={calculatorUrl()}>{t('Open the calculator')}</a></p>}
            </div>
          </form>
          </Bay>
          <div className="hero-copy">
            <div>
              <div className="tagline marker" style={{ '--d': '.4s' } as React.CSSProperties}><Key />{t('Bay 01 · MiCar')}</div>
              <h1>
                <span className="w"><span style={{ '--d': '.3s' } as React.CSSProperties}>{t('Value it.')}</span></span>
                <span className="w"><span style={{ '--d': '.42s' } as React.CSSProperties}>{t('Park it.')}</span></span>
                <span className="w"><span style={{ '--d': '.54s' } as React.CSSProperties}>{t('Grade it.')}</span></span>
                <span className="scrawl">{t('your car is an asset')}</span>
              </h1>
            </div>
            <div className="hero-side">
              <p style={{ '--d': '.8s' } as React.CSSProperties}>{t("Type the car. The door opens on what it's worth today, on a card. Three entries later the card goes in a case with a grade that follows the car for life. The number is free, for everyone, forever. Nobody here wants to buy your car.")}</p>
              <div className="btns" style={{ '--d': '.95s' } as React.CSSProperties}>
                <a className="ghostbtn" href="#card">{t('See a graded card')}</a>
                <a className="ghostbtn" href={WORLD_URL}>{t('Enter MiCar World')}</a>
              </div>
            </div>
          </div>
        </div>
      </header>

      {shown && shownG && <>
        <Statement card={shown} />
        <CardSection card={shown} g={shownG} />
        <section className="sec gutter" id="grade"><div className="inner">
          <div className="ghost" style={{ right: '-2%', top: 40 }}>{t('graded')}</div>
          <div className="eyebrow marker"><Key />{t('the grade')}</div>
          <h2 className="painted big">{t('Gem mint, for cars')}</h2>
          <p className="lede">{t("One number from 1 to 10, like a graded card, except you can move it. Four parts: how the car is, how its model holds value against its class, how much of its story is on record, and how many miles it carries for its age. This is {car}. Try it.", { car: carName(shown.r) })}</p>
          <GradeSim card={shown} g={shownG} onChange={setG} />
        </div></section>
        <World card={shown} />
        <Verbs card={shown} now={now} />
        <Keyholder card={shown} g={shownG} />
        <Shops />
        <Numbers />
        <Footer />
        <div className="gutter"><div className="inner"><div className="wordmark">MiCar</div></div></div>
      </>}
      {inspecting && card && <Inspector card={card} g={g ?? undefined} onClose={() => setInspecting(false)} />}
    </div>
  );
}

/** One record, two faces: the dealer's window sheet and the card share the QR. */
function Statement({ card }: { card: Card }) {
  const qr = useQr(carPageUrl(card.code));
  return (
    <section className="statement sec gutter" id="statement"><div className="inner">
      <div className="twin">
        <div className="sheet"><b>{t('Window sheet')}</b><div className="ln" /><div className="ln s" /><div className="ln" /><div className="row2"><div className="pr"><small>{t('Value today')}</small>{usd(card.value)}</div><div className="qr" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} /></div></div>
        <svg className="arrow2" viewBox="0 0 48 26" aria-hidden="true"><path d="M4 8 H40 M34 2 L40 8 L34 14 M44 18 H8 M14 12 L8 18 L14 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <Slab card={card} mini />
        <div className="cap">{t('one record, two faces. same QR.')}</div>
      </div>
      <p>{tx('The calculator stays free and anonymous. The record that prints a dealer\'s window sheet is the record that becomes a card. {yel}', { yel: <span className="yel">{t('Scan either one and you land on the same car.')}</span> })}</p>
    </div></section>
  );
}

function CardSection({ card, g }: { card: Card; g: GradeInputs }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <section className="cardsec sec gutter" id="card"><div className="inner">
      <div>
        <Slab card={card} g={g} live flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
        <p className="hint">{t('tap to flip · move to shine')}</p>
      </div>
      <div>
        <div className="eyebrow marker"><Key />{t('the card')}</div>
        <h2 className="painted big">{t('Your car, slabbed')}</h2>
        <div className="feat"><ul>
          <li><span className="k">A</span><div><h3>{t('The label')}</h3><p>{t("Grade, tier, the car, the serial, and a QR that opens the car's page. Printed on both sides, like a real slab.")}</p></div></li>
          <li><span className="k">B</span><div><h3>{t('The shine is earned')}</h3><p>{t('Foil follows the grade and is never for sale. A 9.8 Showroom throws rainbows; a 5.4 Daily is matte chrome. You can tell the grade from across the room.')}</p></div></li>
          <li><span className="k">C</span><div><h3>{t('The back tells the story')}</h3><p>{t("The rear label carries the chart: your car on its model's curve, with every service, mod and mileage check marked on the line.")}</p></div></li>
          <li><span className="k">D</span><div><h3>{t('Raw until slabbed, then minted once')}</h3><p>{t('A valued car is a raw card. Three entries later it goes in the case, gets its first grade, and is minted with a set, a number and its stamps. The grade can move. The minting never does.')}</p></div></li>
        </ul></div>
      </div>
    </div></section>
  );
}

/** The garage is a place: the same car, in the world. */
function World({ card }: { card: Card }) {
  const BASE = import.meta.env.BASE_URL;
  const cat = card.r.body;
  const render = ({ 'Sedan': 'sedan', 'SUV / Crossover': 'suv', 'Pickup Truck': 'truck', 'Coupe / Sports': 'coupe', 'Hatchback / Wagon': 'hatchback', 'Minivan': 'van' } as Record<string, string>)[cat] ?? 'sedan';
  return (
    <section className="sec gutter world" id="world"><div className="inner">
      <div className="ghost" style={{ left: '-2%', top: 30 }}>{t('world')}</div>
      <div className="eyebrow marker"><Key />{t('the world')}</div>
      <h2 className="painted big">{t('Your garage is a place')}</h2>
      <p className="lede">{t('The card lives in a garage, and the garage is a real place: MiCar World, a 3D town you drive in. It opens on your door. {car} is parked inside, in its colour, and it drives the way it is: a car that needs work drives like one.', { car: carName(card.r) })}</p>
      <div className="world-grid">
        <a className="world-shot" href={WORLD_URL}>
          <img src={`${BASE}cars/${render}.webp`} alt="" loading="lazy" />
          <span className="world-tag marker">{t('the same car, in three dimensions')}</span>
          <span className="drip">{t('Walk in')} <Arrow /></span>
        </a>
        <div className="doors">
          <div className="place"><small>{t('home')}</small><h3>{t('The Garage')}</h3><p>{t('Your cards as cars. The bay where you repair and modify them: every part you add is a part on the card.')}</p></div>
          <div className="place"><small>{t('work')}</small><h3>{t('The Dealership')}</h3><p>{t('Learn the car business without paying for your mistakes. Buy a salvage title at auction, fix it, flip it. Mistakes cost Octane, not money.')}</p></div>
          <div className="place"><small>{t('play')}</small><h3>{t('The Strip')}</h3><p>{t('Race the car you tuned: sprint, circuit, street X, drag, drift, outrun. Prizes in dollars, Octane and stamps on the card, never the grade.')}</p><a className="ghostbtn" href="https://micar-sim.onrender.com/strip">{t('Race now — no account needed.')}</a></div>
        </div>
      </div>
      <p className="lotnote">{t('In the world, condition is earned, not declared. Your car enters at the baseline for its trim; a verified trail brings its real condition with it.')}</p>
    </div></section>
  );
}

/** Four things a card does, each shown on this car. */
function Verbs({ card, now }: { card: Card; now: Date }) {
  const [copied, setCopied] = useState(false);
  const link = carPageUrl(card.code);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ } };
  const lot = useMemo(() => {
    const mk = (r: Partial<CarRecord>) => makeCard({ ...emptyRecord(now), ...r, price: 0, features: [], notes: '' } as CarRecord, now, true);
    return [mk({ year: 2019, make: 'Toyota', model: '4Runner', trim: 'SR5 Premium', body: 'SUV / Crossover', mileage: 58900, condition: 'Excellent' }), mk({ year: 2020, make: 'Honda', model: 'Civic', trim: 'Si', body: 'Sedan', mileage: 61200, condition: 'Good' })].filter((c): c is Card => !!c);
  }, [now]);
  const [pick, setPick] = useState(0);
  const other = lot[pick];
  const diff = other ? other.value - card.value : 0;
  const entryValue = Math.round(card.value * 0.012 / 10) * 10;
  return (
    <section className="sec gutter verbs" id="verbs"><div className="inner">
      <div className="eyebrow marker"><Key />{t('what a card does')}</div>
      <h2 className="painted big">{t('One card. Four verbs.')}</h2>
      <div className="verb-grid">
        <div className="verb"><small>{t('show')}</small><h3>{t('Share it')}</h3><p>{t("The card's link holds the whole car. Paste it anywhere; whoever opens it sees the car's page.")}</p>
          <button type="button" className="ghostbtn" onClick={copy}>{copied ? t('Copied') : t("Copy the card's link")}</button></div>
        <div className="verb"><small>{t('fix')}</small><h3>{t('Fix it')}</h3><p>{t('A MiCar Shop writes the work straight to the trail, receipt attached. Verified entries count double.')}</p>
          <div className="ro"><span>{t('Repair order')} · {t('sample')}</span><b>{carName(card.r)}</b><span>{t('Brakes, front pads and rotors')} · {usd(420)}</span><i>{t('→ trail entry, verified · about {v} on the card', { v: usd(entryValue) })}</i></div></div>
        <div className="verb"><small>{t('sell')}</small><h3>{t('Sell it')}</h3><p>{t('Dealers print a window sheet for this car with the value, the forecast and the QR. Scan it and you land here.')}</p>
          <a className="ghostbtn" href={stickerPageUrl(card.code)}>{t('Print a window sheet for this car')}</a></div>
        <div className="verb"><small>{t('trade')}</small><h3>{t('Trade it')}</h3><p>{t('On the lot, any two cards compare. The number is a value, never a price.')}</p>
          {other && <div className="cmp">
            <div className="row-cmp"><span>{t('Yours')}</span><b>{usd(card.value)}</b></div>
            <div className="row-cmp"><span><select value={pick} onChange={(e) => setPick(Number(e.target.value))}>{lot.map((c, i) => <option key={i} value={i}>{carName(c.r)}</option>)}</select></span><b>{usd(other.value)}</b></div>
            <div className="bal">{diff > 0 ? t('You add {v}', { v: usd(diff) }) : diff < 0 ? t('They add {v}', { v: usd(-diff) }) : t('Even swap')}</div>
          </div>}</div>
      </div>
    </div></section>
  );
}

function Keyholder({ card, g }: { card: Card; g: GradeInputs }) {
  const [yearly, setYearly] = useState(true);
  const verified = useMemo(() => ({ ...g, verified: true, receipts: true, photo: true, entries: Math.max(g.entries, 3) }), [g]);
  const grade = gradeOf(verified);
  return (
    <section className="sec gutter" id="keyholder"><div className="inner">
      <div className="eyebrow marker"><Key />{t('keyholder')}</div>
      <h2 className="painted big">{t('Pay for the work, never for the number')}</h2>
      <p className="lede">{t('The grade is free, for everyone, forever. A Keyholder pays for the work behind a Verified card: receipts checked, odometer photos read, the VIN history pulled, a certificate every quarter.')}</p>
      <div className="offer">
        <div>
          <div className="kcard-wrap"><div className="kcard">
            <div className="top"><span><span className="mi">Mi</span>Car <small>Keyholder</small></span><small>{t('Charlotte · Series 1')}</small></div>
            <div className="mid"><div className="seal"><span>MiCar<br />{t('verified')}</span></div><div className="who"><b>{card.r.year} {card.r.model || card.r.modelText}</b><span>{t('would read {g} {tier} · verified', { g: grade.G.toFixed(1), tier: t(grade.name) })}</span></div></div>
            <div className="bot"><span>{t('member')}<b>MC-·····</b></span><span>{t('since')}<b>{new Date().getFullYear()}</b></span></div>
          </div></div>
          <div className="price">
            <div className="toggle" role="tablist"><button type="button" className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>{t('Yearly')}</button><button type="button" className={yearly ? '' : 'on'} onClick={() => setYearly(false)}>{t('Monthly')}</button></div>
            <div className="amount"><b>{yearly ? '$39' : '$4'}</b><span>{yearly ? t('per year') : t('per month')}<small>{yearly ? t('one car · +$9 a year per extra car · family garage on one account') : t('one car · +$1 a month per extra car · family garage on one account')}</small></span></div>
            <div className="rule-line">{t('a fake receipt loses the entry and drops the grade, member or not')}</div>
          </div>
        </div>
        <div className="bento">
          <div className="tile work"><div><h3>{t('The work')} <em>{t('verified')}</em></h3><ul><li>{t('Receipts checked, odometer photos read')}</li><li>{t('VIN title and history check at signup and every year')}</li><li>{t('A grade and a certificate every quarter')}</li><li>{t('The Verified holographic seal on the card')}</li></ul></div><div className="seal big"><span>MiCar<br />{t('verified')}</span></div></div>
          <div className="tile custody"><h3>{t('Custody')}</h3><ul><li>{t('Recall alerts by VIN')}</li><li>{t('Registration, inspection and mileage-based service reminders')}</li><li>{t('Recent sales for your trim in your metro: low, high, average, always with the count')}</li><li>{t('Price-drop and curve alerts')}</li><li>{t('Unlimited Watch cards; trail export as PDF or CSV')}</li></ul></div>
          <div className="tile"><h3>{t('The club')}</h3><ul><li>{t('The Garage, a monthly magazine, English and Spanish in one issue')}</li><li>{t('Two printed windshield labels a year, holographic stickers')}</li><li>{t('Member number, First Edition, Slab Day priority')}</li></ul></div>
          <div className="tile"><h3>{t('Pays for itself')}</h3><ul><li>{t('Partner discounts: oil change, tires, detailing, pre-sale inspection')}</li><li>{t('100 Octane a month')}</li><li>{t('Verified condition carries into MiCar World')}</li></ul></div>
        </div>
      </div>
    </div></section>
  );
}

function Shops() {
  return (
    <section className="sec gutter shops"><div className="inner">
      <div className="shop-row">
        <div><small className="marker">{t('for shops and dealers')}</small><h3>{t('Every sheet is a billboard. Every repair order is a trail entry.')}</h3></div>
        <div className="shop-links">
          <a className="ghostbtn" href={SHOP_URL}>{t('MiCar Shop')} <Arrow /></a>
          <a className="ghostbtn" href={stickerPageUrl()}>{t('Dealer window sheets')} <Arrow /></a>
        </div>
      </div>
    </div></section>
  );
}

function Numbers() {
  return (
    <section className="numbers sec gutter"><div className="inner">
      <div className="sticker s1"><strong>{STATS.models.toLocaleString('en-US')}</strong><span>{t('models with original sticker prices, {trims} trims', { trims: STATS.trims.toLocaleString('en-US') })}</span></div>
      <div className="sticker s2"><strong>0</strong><span>{t('cards parked. Charlotte Series 1 opens with the first 1,000: First Edition, numbered by arrival.')}</span></div>
      <div className="sticker s3"><strong>{STATS.listings.toLocaleString('en-US')}</strong><span>{t('real listings behind the curve, {n} models calibrated against them', { n: STATS.calibrated })}</span></div>
    </div></section>
  );
}
