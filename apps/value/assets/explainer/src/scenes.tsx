// The ten scenes. Each one is a Sequence the length of its narration plus a little air;
// element timings below are frames from the scene's start (voice starts at LEAD).
import QRCode from 'qrcode';
import { createContext, useContext, type CSSProperties } from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import data from './data.json';
import { Brand, C, Count, Cue, FONT, Glass, Painted, Paper, Rise, SceneFade, easeOut, signed, useIn, useRamp, usd } from './kit';
import { textFor } from './text';
import { LEAD, scenesFor, voFile, type Lang, type SceneId } from './timing';

export const LangContext = createContext<Lang>('en');

/** The scene's language, its words, and `s(seconds)`: a frame at `seconds` into the narration.
 *  Beats were placed against the English voice; another language's voice stretches them in proportion. */
function useScene(id: SceneId) {
  const lang = useContext(LangContext);
  const ratio = scenesFor(lang).find((x) => x.id === id)!.vo / scenesFor('en').find((x) => x.id === id)!.vo;
  const s = (seconds: number) => LEAD + Math.round(seconds * ratio * 30);
  return { lang, T: textFor(lang), s, voice: <Cue at={LEAD} src={voFile(lang, id)} /> };
}

const label: CSSProperties = { fontSize: 15, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.ink3 };
const big: CSSProperties = { fontFamily: FONT.cond, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' };

// ---------------------------------------------------------------------------------------------
export function Intro() {
  const { T, s, voice } = useScene('intro');
  const brand = useRamp(0, 15);
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={10} src="paint" />
      <Brand style={{ opacity: brand }} />
      <div style={{ position: 'absolute', left: 150, top: 300 }}>
        <Painted lines={T.heroLines} from={10} size={180} />
        <Rise from={s(5.0)} style={{ marginTop: 70, maxWidth: 900, fontSize: 40, lineHeight: 1.3, color: C.glassInk }}>
          {T.intro[0]}<span style={{ color: C.paint, fontWeight: 600 }}>{T.intro[1]}</span>{T.intro[2]}
        </Rise>
      </div>
      <Rise from={s(1.0)} style={{ position: 'absolute', right: 72, top: 44, fontSize: 22, color: C.glassMuted }}>{T.free}</Rise>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
function Door({ from, icon, title, who, line, accent }: { from: number; icon: 'calc' | 'tag'; title: string; who: string; line: string; accent: string }) {
  const p = useIn(from, { damping: 15, stiffness: 110 });
  return (
    <Paper style={{ width: 720, padding: '44px 48px 48px', opacity: p, transform: `translateY(${(1 - p) * 60}px) scale(${0.96 + p * 0.04})` }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: accent, display: 'grid', placeItems: 'center' }}>
        {icon === 'calc'
          ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.paper} strokeWidth="2" strokeLinecap="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h2M12 10h2M16 10h0M8 14h2M12 14h2M16 14h0M8 18h2M12 18h2M16 18h0" /></svg>
          : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.paper} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4L12 2z" /><circle cx="7" cy="7" r="1.5" /></svg>}
      </div>
      <div style={{ fontFamily: FONT.cond, fontWeight: 600, fontSize: 56, lineHeight: 1.05, marginTop: 26, letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 24, color: C.ink3, marginTop: 8 }}>{who}</div>
      <div style={{ fontSize: 26, color: C.ink2, marginTop: 26, lineHeight: 1.4 }}>{line}</div>
    </Paper>
  );
}
export function Doors() {
  const { T, s, voice } = useScene('doors');
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={16} src="pop" /><Cue at={s(2.8)} src="pop" />
      <Brand />
      <Rise from={0} style={{ position: 'absolute', top: 130, left: 0, right: 0, textAlign: 'center', fontFamily: FONT.cond, fontWeight: 600, fontSize: 54, color: C.glassInk }}>{T.doorsTitle}</Rise>
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 48 }}>
        <Door from={14} icon="calc" title={T.door1Title} who={T.door1Who} line={T.door1Line} accent={C.blue} />
        <Door from={s(2.7)} icon="tag" title={T.door2Title} who={T.door2Who} line={T.door2Line} accent={C.ink} />
      </div>
      <Rise from={s(5.4)} style={{ position: 'absolute', top: 820, left: 0, right: 0, textAlign: 'center', fontSize: 30, color: C.glassMuted }}>{T.doorsFoot}</Rise>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
function Field({ from, name, value, hint, width = 'auto' }: { from: number; name: string; value: string; hint?: string; width?: CSSProperties['width'] }) {
  const p = useIn(from, { damping: 18, stiffness: 160 });
  const typed = useRamp(from, from + 14);
  const shown = value.slice(0, Math.ceil(value.length * typed));
  return (
    <div style={{ width, opacity: Math.min(1, p * 1.4) }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: C.ink2, marginBottom: 8 }}>{name}</div>
      <div style={{ border: `2px solid ${typed < 1 ? C.blue : C.rule}`, borderRadius: 8, padding: '14px 18px', fontSize: 28, minHeight: 64, fontVariantNumeric: 'tabular-nums', boxShadow: typed < 1 ? `0 0 0 4px ${C.blueSoft}` : 'none' }}>{shown}{typed < 1 && <span style={{ color: C.blue }}>|</span>}</div>
      {hint && <Rise from={from + 16} style={{ fontSize: 18, color: C.ink3, marginTop: 8 }} dist={8}>{hint}</Rise>}
    </div>
  );
}
function Stat({ from, n, text }: { from: number; n: string; text: string }) {
  const p = useIn(from);
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * 40}px)`, borderTop: '1px solid rgba(255,255,255,0.18)', paddingTop: 18 }}>
      <div style={{ fontFamily: FONT.cond, fontWeight: 700, fontSize: 72, lineHeight: 1, color: C.paint, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 26, color: C.glassMuted, marginTop: 6 }}>{text}</div>
    </div>
  );
}
export function Pick() {
  const { T, s, voice } = useScene('pick');
  const cond = useIn(s(10.6), { damping: 18, stiffness: 160 });
  return (
    <SceneFade><Glass>
      {voice}
      {[20, 42, 64, 86].map((f) => <Cue key={f} at={f} src="tick" volume={0.8} />)}
      <Cue at={s(2.9)} src="pop" /><Cue at={s(5.5)} src="pop" volume={0.8} /><Cue at={s(7.0)} src="pop" volume={0.8} /><Cue at={s(8.6)} src="pop" volume={0.8} />
      <Cue at={s(10.0)} src="tick" volume={0.8} /><Cue at={s(10.7)} src="tick" volume={0.8} />
      <Brand />
      <Paper style={{ position: 'absolute', left: 110, top: 140, width: 820, padding: '40px 44px' }}>
        <div style={{ fontFamily: FONT.cond, fontWeight: 600, fontSize: 40 }}>{T.vehicle}</div>
        <div style={{ fontSize: 22, color: C.ink3, marginBottom: 28 }}>{T.vehicleSub}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <Field from={20} name={T.make} value="Honda" />
          <Field from={42} name={T.model} value="Civic" />
          <Field from={64} name={T.year} value="2019" />
          <Field from={86} name={T.trim} value="EX" />
        </div>
        <div style={{ marginTop: 24 }}>
          <Field from={s(2.8)} name={T.msrp} value="$23,400" hint={T.msrpHint} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
          <Field from={s(10.0)} name={T.odometer} value="48,210" />
          <div style={{ opacity: cond }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.ink2, marginBottom: 8 }}>{T.condition}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: `2px solid ${C.rule}`, borderRadius: 8, overflow: 'hidden', fontSize: 19, fontWeight: 500, textAlign: 'center' }}>
              {T.conditions.map((c, i) => <div key={c} style={{ padding: '18px 0', background: i === 1 ? C.ink : C.paper, color: i === 1 ? C.paper : C.ink2 }}>{c}</div>)}
            </div>
          </div>
        </div>
      </Paper>
      <div style={{ position: 'absolute', left: 1040, top: 250, width: 720, display: 'grid', gap: 34 }}>
        <Rise from={s(2.6)} style={{ fontSize: 30, color: C.glassInk, lineHeight: 1.35 }}>{T.fills}</Rise>
        <Stat from={s(5.5)} n={T.statModels[0]} text={T.statModels[1]} />
        <Stat from={s(7.0)} n={T.statPrices[0]} text={T.statPrices[1]} />
        <Stat from={s(8.6)} n={T.statYears[0]} text={T.statYears[1]} />
      </div>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
const STEPS = data.steps;
function Line({ from, lbl, detail, amount, first, swap, noChange }: { from: number; lbl: string; detail: string; amount: number; first?: boolean; swap?: { at: number; amount: number; detail: string }; noChange: string }) {
  const frame = useCurrentFrame();
  const p = useIn(from, { damping: 18, stiffness: 150 });
  const swapped = swap && frame >= swap.at;
  const a = swapped ? swap.amount : amount;
  const color = first ? C.ink2 : Math.abs(a) < 1 ? C.ink2 : a < 0 ? C.loss : C.gain;
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * -24}px)`, padding: '13px 0', borderBottom: `1.5px dotted ${C.rule}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 30 }}>
        <span style={{ fontWeight: 500 }}>{lbl}</span>
        <span style={{ ...big, fontSize: 34, color }}>
          {first ? <Count value={amount} from={from} frames={22} /> : Math.abs(a) < 1 ? noChange : swapped ? <Count value={a} from={swap.at} frames={18} start={amount} format={signed} /> : <Count value={a} from={from} frames={22} format={signed} />}
        </span>
      </div>
      <div style={{ fontSize: 19, color: C.ink3, marginTop: 4 }}>{swapped ? swap.detail : detail}</div>
    </div>
  );
}
export function Ledger() {
  const { T, s, voice } = useScene('ledger');
  const frame = useCurrentFrame();
  const at = [s(2.1), s(4.3), s(7.0), s(10.4), s(11.5), s(12.9)];
  const landed = s(14.3), swap = s(15.8);
  const total = useIn(landed, { damping: 14, stiffness: 120 });
  const totalShown = frame >= swap ? data.miles75k : data.privateParty;
  const mileSwap = { at: swap, amount: 844, detail: T.mileSwap };
  return (
    <SceneFade><Glass>
      {voice}
      {at.map((f) => <Cue key={f} at={f} src="tick" volume={0.9} />)}
      <Cue at={landed - 20} src="rise" volume={0.7} /><Cue at={landed} src="chime" />
      <Cue at={swap} src="tick" volume={0.9} /><Cue at={swap + 6} src="pop" volume={0.7} />
      <Brand />
      <Paper style={{ position: 'absolute', left: 150, top: 110, width: 1000, padding: '36px 48px 30px' }}>
        <div style={{ fontFamily: FONT.cond, fontWeight: 600, fontSize: 44 }}>{T.ledgerTitle}</div>
        <div style={{ fontSize: 22, color: C.ink3, marginBottom: 14 }}>{T.ledgerSub}</div>
        {STEPS.map((st, i) => <Line key={st.label} from={at[i]} lbl={T.steps[i]} detail={T.details[i]} amount={i === 0 ? st.value : st.delta} first={i === 0} swap={i === 3 ? mileSwap : undefined} noChange={T.noChange} />)}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18, paddingTop: 16, borderTop: `3px solid ${C.ink}`, opacity: total, transform: `translateY(${(1 - total) * 16}px)` }}>
          <span style={{ fontSize: 32, fontWeight: 600 }}>{T.privateParty}</span>
          <span style={{ ...big, fontSize: 64 }}>{frame >= swap ? <Count value={totalShown} from={swap} frames={18} start={data.privateParty} /> : <Count value={data.privateParty} from={landed} frames={26} start={data.msrp} />}</span>
        </div>
      </Paper>
      <div style={{ position: 'absolute', left: 1230, top: 300, width: 560 }}>
        <Rise from={s(0.3)} style={{ fontSize: 32, lineHeight: 1.35, color: C.glassInk }}>{T.ledgerAside}</Rise>
        <Rise from={swap - 20} style={{ marginTop: 44, background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)', borderRadius: 12, padding: '22px 26px' }}>
          <div style={{ fontSize: 20, color: C.glassMuted }}>{T.changeAny}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6 }}>
            <span style={{ fontSize: 22, color: C.glassMuted }}>{T.odo}</span>
            <span style={{ ...big, fontSize: 40, color: C.paint }}>{frame >= swap ? <Count value={75000} from={swap} frames={16} start={48210} format={(n) => Math.round(n).toLocaleString('en-US')} /> : '48,210'}</span>
            <span style={{ fontSize: 22, color: C.glassMuted }}>mi</span>
          </div>
          <div style={{ fontSize: 20, color: C.glassMuted, marginTop: 8 }}>{T.watch}</div>
        </Rise>
      </div>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
function PriceCell({ from, lbl, value, note, hero }: { from: number; lbl: string; value: number; note: string; hero?: boolean }) {
  const p = useIn(from);
  return (
    <Paper style={{ padding: '44px 44px 48px', flex: hero ? 1.3 : 1, opacity: p, transform: `translateY(${(1 - p) * 40}px)`, background: hero ? C.paper : C.paper2 }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: C.ink2 }}>{lbl}</div>
      <div style={{ ...big, fontSize: hero ? 128 : 88, marginTop: 12, color: C.ink }}><Count value={value} from={from + 4} frames={28} /></div>
      <div style={{ fontSize: 23, color: C.ink3, marginTop: 18, lineHeight: 1.4 }}>{note}</div>
    </Paper>
  );
}
export function Prices() {
  const { T, s, voice } = useScene('prices');
  const bar = easeOut(useRamp(s(7.2), s(8.2)));
  const lo = data.tradeIn * 0.95, hi = data.dealerRetail * 1.03;
  const pct = (n: number) => ((n - lo) / (hi - lo)) * 100;
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={s(1.5)} src="rise" volume={0.6} /><Cue at={s(3.4)} src="rise" volume={0.6} /><Cue at={s(5.2)} src="rise" volume={0.6} /><Cue at={s(7.2)} src="pop" />
      <Brand />
      <Rise from={0} style={{ position: 'absolute', top: 120, left: 150, fontFamily: FONT.cond, fontWeight: 600, fontSize: 54, color: C.glassInk }}>{T.pricesTitle}</Rise>
      <div style={{ position: 'absolute', top: 240, left: 150, right: 150, display: 'flex', gap: 28, alignItems: 'stretch' }}>
        <PriceCell from={s(1.5)} lbl={T.tradeIn} value={data.tradeIn} note={T.tradeInNote} />
        <PriceCell from={s(3.4)} lbl={T.privateParty} value={data.privateParty} note={T.ppNote} hero />
        <PriceCell from={s(5.2)} lbl={T.retail} value={data.dealerRetail} note={T.retailNote} />
      </div>
      <div style={{ position: 'absolute', left: 150, right: 150, top: 800, opacity: bar }}>
        <div style={{ position: 'relative', height: 18, borderRadius: 9, background: 'rgba(255,255,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(data.range.low)}%`, width: `${(pct(data.range.high) - pct(data.range.low)) * bar}%`, background: C.blueSoft, borderRadius: 9 }} />
          {[data.tradeIn, data.privateParty, data.dealerRetail].map((n, i) => <div key={i} style={{ position: 'absolute', top: '50%', left: `${pct(n)}%`, width: 5, height: 34, transform: 'translate(-50%,-50%)', borderRadius: 3, background: i === 1 ? C.paint : C.glassMuted }} />)}
        </div>
        <div style={{ position: 'relative', height: 40, marginTop: 14, fontSize: 24, color: C.glassMuted }}>
          <span style={{ position: 'absolute', left: `${pct(data.range.low)}%`, transform: 'translateX(-50%)' }}>{usd(data.range.low)}</span>
          <span style={{ position: 'absolute', left: `${pct(data.range.high)}%`, transform: 'translateX(-50%)' }}>{usd(data.range.high)}</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: 28, color: C.glassInk, marginTop: 10 }}>{T.range[0]}<b>{usd(data.range.low)}</b>{T.range[1]}<b>{usd(data.range.high)}</b>{T.range[2]}</div>
      </div>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
const LISTINGS = ['2019 Honda Civic EX · 51,200 mi · $18,900', '2019 Honda Civic EX · 44,800 mi · $19,400', '2019 Honda Civic EX-L · 39,100 mi · $18,750', '2019 Honda Civic EX · 36,500 mi · $19,900', '2018 Honda Civic EX · 58,300 mi · $18,500', '2019 Honda Civic EX · 47,900 mi · $19,250'];
export function Market() {
  const { T, s, voice } = useScene('market');
  const frame = useCurrentFrame();
  const pasted = useRamp(14, 54);
  const nLines = Math.round(pasted * LISTINGS.length);
  const chart = easeOut(useRamp(s(5.6), s(8.6)));
  const fc = data.forecast;
  const W = 640, H = 360, min = 10000, max = 20500;
  const x = (i: number) => (i / (fc.length - 1)) * W, y = (v: number) => H - ((v - min) / (max - min)) * H;
  const path = fc.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const band = fc.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.high)}`).join(' ') + ' ' + [...fc].reverse().map((d, i) => `L${x(fc.length - 1 - i)},${y(d.low)}`).join(' ') + ' Z';
  const len = 1000;
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={14} src="flip" volume={0.7} /><Cue at={s(2.4)} src="tick" /><Cue at={s(3.6)} src="rise" volume={0.7} /><Cue at={s(5.6)} src="whoosh" volume={0.5} />
      <Brand />
      <Paper style={{ position: 'absolute', left: 110, top: 170, width: 820, padding: '38px 44px' }}>
        <div style={{ fontFamily: FONT.cond, fontWeight: 600, fontSize: 44 }}>{T.marketTitle}</div>
        <div style={{ fontSize: 21, color: C.ink3, marginBottom: 18 }}>{T.marketSub}</div>
        <div style={{ border: `2px solid ${C.rule}`, borderRadius: 8, padding: '16px 20px', minHeight: 300, fontSize: 24, lineHeight: 1.6, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>
          {LISTINGS.slice(0, nLines).map((l) => <div key={l}>{l}</div>)}
        </div>
        <Rise from={s(2.4)} style={{ marginTop: 16, background: C.paper2, borderRadius: 8, padding: '12px 18px', fontSize: 22, color: C.ink2 }} dist={10}>
          {T.listingsLine}
        </Rise>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, paddingTop: 16, borderTop: `3px solid ${C.ink}` }}>
          <span style={{ fontSize: 28, fontWeight: 600 }}>{T.privateParty}</span>
          <span style={{ ...big, fontSize: 60, color: frame >= s(3.6) ? C.gain : C.ink }}>{frame >= s(3.6) ? <Count value={18226} from={s(3.6)} frames={24} start={data.privateParty} /> : usd(data.privateParty)}</span>
        </div>
      </Paper>
      <Rise from={s(5.4)} style={{ position: 'absolute', left: 1000, top: 170 }}>
        <Paper style={{ width: 800, padding: '38px 44px' }}>
          <div style={{ fontFamily: FONT.cond, fontWeight: 600, fontSize: 44 }}>{T.forecastTitle}</div>
          <div style={{ fontSize: 21, color: C.ink3 }}>{T.forecastSub}</div>
          <svg width={W + 60} height={H + 70} viewBox={`-50 -20 ${W + 60} ${H + 70}`} style={{ marginTop: 18, overflow: 'visible' }}>
            {[12000, 14000, 16000, 18000, 20000].map((v) => <g key={v}><line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={C.rule} strokeWidth="1" /><text x={-10} y={y(v) + 6} textAnchor="end" fontSize="16" fill={C.ink3} fontFamily={FONT.sans}>${v / 1000}k</text></g>)}
            <clipPath id="reveal"><rect x={0} y={-30} width={W * chart} height={H + 60} /></clipPath>
            <path d={band} fill={C.blueSoft} clipPath="url(#reveal)" />
            <path d={path} fill="none" stroke={C.blue} strokeWidth="4" strokeDasharray={len} strokeDashoffset={len * (1 - chart)} strokeLinecap="round" />
            {fc.map((d, i) => <g key={d.year} opacity={chart >= i / (fc.length - 1) ? 1 : 0}><circle cx={x(i)} cy={y(d.value)} r="7" fill={C.blue} stroke={C.paper} strokeWidth="3" /><text x={x(i)} y={H + 34} textAnchor="middle" fontSize="18" fill={C.ink3} fontFamily={FONT.sans}>{d.year}</text></g>)}
          </svg>
          <Rise from={s(8.6)} style={{ fontSize: 24, color: C.ink2 }} dist={8}>{T.forecastFoot[0]}<b style={{ color: C.loss }}>{usd(fc[0].value - fc[fc.length - 1].value)}</b>{T.forecastFoot[1]}</Rise>
        </Paper>
      </Rise>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
/** The real sheet, filmed: whole, then close on the value check, the deal, the stars, the code. */
export function Sheet() {
  const { T, s, voice, lang } = useScene('sheet');
  const frame = useCurrentFrame();
  const enter = useIn(16, { damping: 16, stiffness: 90, mass: 1.1 });
  // camera: [frame, scale, focusX, focusY] in sheet px (739 x 979)
  const keys = [[s(0), 1, 369, 490], [s(3.5), 1, 369, 490], [s(4.4), 1.95, 220, 700], [s(5.6), 1.95, 220, 700], [s(6.4), 1.95, 385, 700], [s(8.4), 1.95, 385, 700], [s(9.2), 1.95, 610, 700], [s(10.6), 1.95, 610, 700], [s(11.5), 1.7, 600, 370], [s(13.5), 1.7, 600, 370]];
  const k = (i: number) => interpolate(frame, keys.map((x) => x[0]), keys.map((x) => x[i]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: (t) => t * t * (3 - 2 * t) });
  const scale = k(1) * 1.03, fx = k(2), fy = k(3);
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={18} src="print" /><Cue at={s(4.4)} src="whoosh" volume={0.5} /><Cue at={s(6.4)} src="pop" /><Cue at={s(9.3)} src="pop" volume={0.8} /><Cue at={s(9.5)} src="pop" volume={0.8} /><Cue at={s(9.7)} src="pop" volume={0.8} /><Cue at={s(11.5)} src="whoosh" volume={0.5} />
      <Brand />
      <Rise from={0} style={{ position: 'absolute', top: 44, right: 72, fontSize: 24, color: C.glassMuted }}>{T.sheetLabel}</Rise>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 960, top: 560, width: 739, height: 979, marginLeft: -369.5, marginTop: -489.5, transformOrigin: `${fx}px ${fy}px`, transform: `translate(${369.5 - fx}px, ${489.5 - fy}px) scale(${scale}) translateY(${(1 - enter) * 700}px) rotateX(${(1 - enter) * 20}deg)`, opacity: enter, boxShadow: '0 60px 120px -40px rgba(0,0,0,0.9)', background: '#fff' }}>
          <Img src={staticFile(`shots/sheet-${lang}.png`)} style={{ width: 739, height: 979, display: 'block' }} />
        </div>
      </AbsoluteFill>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
function QR({ text, size }: { text: string; size: number }) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size, cell = size / n;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) rects.push(`M${c * cell},${r * cell}h${cell}v${cell}h-${cell}z`);
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff" /><path d={rects.join('')} fill="#000" /></svg>;
}
const PHONE_PAGE_HEIGHT: Record<Lang, number> = { en: 3675, es: 3925 }; // css px of the captures
export function Phone({ link }: { link: string }) {
  const { T, s, voice, lang } = useScene('phone');
  const frame = useCurrentFrame();
  const scanY = interpolate(frame, [12, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const found = useIn(42, { damping: 12, stiffness: 180 });
  const phone = useIn(s(1.2), { damping: 15, stiffness: 90, mass: 1.1 });
  const scroll = easeOut(useRamp(s(2.2), s(8.8)));
  const pw = 440, ph = 900, imgW = 1170 / 3 * (pw / 390);
  const imgH = PHONE_PAGE_HEIGHT[lang] * (pw / 390);
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={38} src="scan" /><Cue at={s(1.2)} src="whoosh" volume={0.5} /><Cue at={s(5.3)} src="pop" volume={0.8} />
      <Brand />
      <div style={{ position: 'absolute', left: 230, top: 300, width: 420, height: 420, background: '#fff', borderRadius: 14, padding: 20, boxSizing: 'border-box', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.8)' }}>
        <QR text={link} size={380} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 20 + scanY * 380, height: 4, background: C.paint, boxShadow: `0 0 24px 6px rgba(255,210,63,0.55)`, opacity: scanY < 1 ? 1 : 0 }} />
        <div style={{ position: 'absolute', inset: -4, borderRadius: 18, border: `6px solid ${C.gain}`, opacity: found, transform: `scale(${0.96 + found * 0.04})` }} />
      </div>
      <Rise from={0} style={{ position: 'absolute', left: 230, top: 760, width: 520, fontSize: 28, lineHeight: 1.35, color: C.glassInk }}>{T.scanLine}</Rise>
      <div style={{ position: 'absolute', left: 1120, top: 90, width: pw + 36, height: ph + 36, borderRadius: 56, background: '#0b0d10', padding: 18, boxSizing: 'border-box', boxShadow: '0 60px 120px -40px rgba(0,0,0,0.9), inset 0 0 0 3px #2a2f36', opacity: phone, transform: `translateY(${(1 - phone) * 140}px)` }}>
        <div style={{ width: pw, height: ph, borderRadius: 40, overflow: 'hidden', background: C.glass, position: 'relative' }}>
          <Img src={staticFile(`shots/phone-${lang}.png`)} style={{ position: 'absolute', left: 0, top: -scroll * (imgH - ph) * 0.62, width: imgW, height: imgH }} />
          <div style={{ position: 'absolute', top: 12, left: '50%', width: 120, height: 30, marginLeft: -60, borderRadius: 15, background: '#0b0d10' }} />
        </div>
      </div>
      <Rise from={s(5.3)} style={{ position: 'absolute', left: 230, top: 850, width: 760, fontSize: 26, lineHeight: 1.4, color: C.glassMuted }}>{T.phoneFoot}</Rise>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
export function Spanish() {
  const { T, s, voice, lang } = useScene('spanish');
  const frame = useCurrentFrame();
  const cursor = easeOut(useRamp(10, 50));
  const press = useIn(58, { damping: 12, stiffness: 240 });
  const es = interpolate(frame, [62, 78], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const inset = useIn(s(2.0), { damping: 15, stiffness: 100 });
  // the EN / ESP buttons in the 1920-wide render of the 1440-wide capture; the film taps the other language
  const other: Lang = lang === 'es' ? 'en' : 'es';
  const tx = other === 'es' ? 428 : 372, ty = 92;
  const cx = 900 + (tx - 900) * cursor, cy = 600 + (ty - 600) * cursor;
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={58} src="pop" volume={0.8} /><Cue at={62} src="flip" /><Cue at={s(2.0)} src="whoosh" volume={0.5} />
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img src={staticFile(`shots/home-${lang}.png`)} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1200 }} />
        <Img src={staticFile(`shots/home-${other}.png`)} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1200, opacity: es }} />
        <div style={{ position: 'absolute', left: cx - 14, top: cy - 14, width: 28, height: 28, borderRadius: 14, background: 'rgba(255,255,255,0.9)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', transform: `scale(${1 - press * 0.35 + (frame > 70 ? 0.35 : 0)})`, opacity: frame < s(2.6) ? 1 : 0 }} />
        <div style={{ position: 'absolute', left: 1130, top: 190, width: 640, transform: `translateX(${(1 - inset) * 900}px) rotate(-2deg)`, opacity: inset, boxShadow: '0 60px 120px -40px rgba(0,0,0,0.9)', background: '#fff' }}>
          <Img src={staticFile(`shots/sheet-${lang}.png`)} style={{ width: 640, display: 'block' }} />
        </div>
      </AbsoluteFill>
      <Rise from={s(0.2)} style={{ position: 'absolute', left: 72, bottom: 70, padding: '18px 26px', borderRadius: 14, background: 'rgba(24,32,43,0.85)', fontSize: 30, color: C.glassInk, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}>
        {frame < 70 ? T.langBefore : T.langAfter}
      </Rise>
    </Glass></SceneFade>
  );
}

// ---------------------------------------------------------------------------------------------
function Source({ from, n, text }: { from: number; n: string; text: string }) {
  const p = useIn(from);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, borderTop: '1px solid rgba(255,255,255,0.18)', paddingTop: 20 }}>
      <div style={{ fontFamily: FONT.cond, fontWeight: 700, fontSize: 64, lineHeight: 1, color: C.glassInk, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 24, color: C.glassMuted, marginTop: 8, lineHeight: 1.35 }}>{text}</div>
    </div>
  );
}
export function Sources() {
  const { T, s, voice } = useScene('sources');
  const frame = useCurrentFrame();
  const end = s(7.3);
  const fade = interpolate(frame, [end - 10, end + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const qrIn = useIn(end + 20);
  return (
    <SceneFade><Glass>
      {voice}
      <Cue at={s(0.6)} src="pop" volume={0.8} /><Cue at={s(2.7)} src="pop" volume={0.8} /><Cue at={s(4.6)} src="pop" volume={0.8} /><Cue at={end} src="paint" /><Cue at={end + 30} src="chime" volume={0.8} />
      <div style={{ opacity: fade }}>
        <Brand />
        <Rise from={0} style={{ position: 'absolute', top: 130, left: 150, fontFamily: FONT.cond, fontWeight: 600, fontSize: 54, color: C.glassInk }}>{T.sourcesTitle}</Rise>
        <div style={{ position: 'absolute', top: 260, left: 150, right: 150, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 60 }}>
          <Source from={s(0.6)} n={T.src1[0]} text={T.src1[1]} />
          <Source from={s(2.7)} n={T.src2[0]} text={T.src2[1]} />
          <Source from={s(4.6)} n={T.src3[0]} text={T.src3[1]} />
        </div>
        <Rise from={s(5.6)} style={{ position: 'absolute', top: 640, left: 150, width: 1200, fontSize: 28, lineHeight: 1.4, color: C.glassMuted }}>{T.accuracy}</Rise>
      </div>
      <div style={{ opacity: 1 - fade, position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', left: 150, top: 330 }}>
          <Painted lines={T.endLines} from={end} size={190} />
        </div>
        <Rise from={end + 24} style={{ position: 'absolute', left: 150, top: 760, fontSize: 36, color: C.glassInk }}>{T.free}</Rise>
        <Rise from={end + 40} style={{ position: 'absolute', left: 150, top: 830, fontSize: 30, color: C.glassMuted, fontVariantNumeric: 'tabular-nums' }}>lasting-oasis.github.io/queen_city_mycarvalue</Rise>
        <div style={{ position: 'absolute', right: 150, top: 330, opacity: qrIn }}>
          <div style={{ background: '#fff', padding: 18, borderRadius: 14, boxShadow: '0 40px 80px -30px rgba(0,0,0,0.8)' }}><QR text="https://lasting-oasis.github.io/queen_city_mycarvalue/" size={300} /></div>
          <div style={{ textAlign: 'center', fontSize: 22, color: C.glassMuted, marginTop: 14 }}>{T.scanSite}</div>
        </div>
      </div>
    </Glass></SceneFade>
  );
}
