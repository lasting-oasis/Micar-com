/* The race menu ("Races", T or its tap button): a circuit screen laid out like a race game's quick-race menu, in
   MiCar's look. A circuit's name, place, line and stats beside a large map (three sectors, numbered corners, the
   start line), the ten circuits as cards along the bottom; Enter (or a second tap) shows its events, Enter again
   starts one through the Garage's quick path (useDriveUi.quick). The model is raceMenu.ts; the maps come from
   circuitMaps.json (tools/blender/circuit_maps.py), loaded on first open. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDriveUi } from './driveUi';
import { useGameStore } from '../store';
import { EVENTS, EV_NAME, freshStrip } from './data';
import { getOptions } from './options';
import { t, useLang, type Lang } from '../i18n';
import { CIRCUITS, circuitView, eventViews, eventsOf, firstCircuit, labelRadiusPx, menuKey, menuKeydown, startAction, startBar, unitsPerPx, type CircuitMaps, type MenuKey, type MenuState } from './raceMenu';

/** the map's sector colours: yellow, red, blue */
export const SECTOR_COL = ['#ffd23f', '#ff4d5e', '#3d7bff'];

/** whether a media query matches, following it as it changes (a phone turned, a window resized) */
function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q); if (!mq) return;
    const f = () => setM(mq.matches); f();
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, [q]);
  return m;
}

let mapsCache: CircuitMaps | null = null;
const loadMaps = (): Promise<CircuitMaps> => mapsCache ? Promise.resolve(mapsCache) : import('./strip/circuitMaps.json').then(m => (mapsCache = m.default as unknown as CircuitMaps));

export function RaceMenu() {
  const open = useDriveUi(s => s.racesOpen);
  return open ? createPortal(<Menu />, document.body) : null;
}

type Note = { txt: string; lock?: boolean } | null;
const EMPTY: CircuitMaps = { version: 1, circuits: {}, events: {} };

function Menu() {
  const lang = useLang();
  const stored = useGameStore(s => s.strip);
  const rec = stored ?? freshStrip();
  const driving = useDriveUi(s => s.driving);
  const last = useDriveUi(s => s.lastEvent);
  const eventLive = useDriveUi(s => s.eventLive);
  const units = getOptions().units;
  // a short screen (a phone on its side) packs the layout tighter; a touch screen shows taps, not keys
  const short = useMedia('(max-height: 480px)'), coarse = useMedia('(pointer: coarse)');
  const [maps, setMaps] = useState<CircuitMaps | null>(mapsCache);
  useEffect(() => { let live = true; if (!maps) loadMaps().then(m => { if (live) setMaps(m); }); return () => { live = false; }; }, [maps]);
  const [st, setSt] = useState<MenuState>(() => ({ step: 'circuit', circuit: Math.max(0, CIRCUITS.findIndex(c => c.id === firstCircuit(rec, last))), event: 0 }));
  const [note, setNote] = useState<Note>(null);
  const close = () => useDriveUi.setState({ racesOpen: false });
  // an event that starts some other way (a challenge's start) closes the menu
  useEffect(() => { if (eventLive) close(); }, [eventLive]);
  const go = (s: MenuState) => { setSt(s); setNote(null); };
  const start = (id: string) => {
    const ev = EVENTS.find(e => e.id === id)!, a = startAction(ev, rec, driving);
    if (a === 'start') useDriveUi.setState({ racesOpen: false, quick: id });
    else setNote(a === 'needCar' ? { txt: t(lang, 'races.needCar') } : { txt: t(lang, 'races.stage').replace('{n}', String(ev.stage)), lock: true });
  };
  const act = (k: MenuKey) => {
    const a = menuKey(st, k, c => eventsOf(CIRCUITS[c].id).length);
    if (a.kind === 'close') close();
    else if (a.kind === 'start') start(a.eventId);
    else go(a.state);
  };
  // modal: the keys go to the menu, not the game (menuKeydown); capture on window comes before the game's listeners
  const actRef = useRef(act); actRef.current = act;
  useEffect(() => {
    const down = new Set<string>();
    const kd = (e: KeyboardEvent) => {
      const r = menuKeydown(e, down);
      if (r.stop) e.stopPropagation();
      if (r.prevent) e.preventDefault();
      if (r.key) actRef.current(r.key);
    };
    const ku = (e: KeyboardEvent) => { down.delete(e.code); };
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
    return () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); };
  }, []);

  const c = CIRCUITS[st.circuit], v = circuitView(c.id, lang, rec, units, maps ?? EMPTY), evs = eventViews(c.id, lang, rec, units);
  const ev = st.step === 'event' ? evs[st.event] : null;
  const pickCircuit = (i: number) => go(i === st.circuit ? { step: 'event', circuit: i, event: 0 } : { step: 'circuit', circuit: i, event: 0 });
  const pickEvent = (i: number) => { if (i === st.event) start(evs[i].id); else go({ ...st, event: i }); };
  const map = maps?.circuits[c.id];
  // the chosen card stays in view as the arrows move through a row wider than the screen
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { row.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [st.step, st.circuit, st.event, short]);
  const blocked = st.step === 'event' && (!driving || !!ev?.locked);
  // a click counts only when its press began on the menu: the tap on the Race button opens the menu under the finger,
  // and that tap's click would otherwise land on whatever is there now (the close button, in the same corner).
  // Keyboard clicks (detail 0) always count.
  const pressedHere = useRef(false);

  return (
    <div className="fixed inset-0 z-[10000] text-ink font-sans select-none" role="dialog" aria-modal="true" aria-label={t(lang, 'races.title')} data-races={st.step}
      onPointerDownCapture={() => { pressedHere.current = true; }}
      onClickCapture={e => { if (!pressedHere.current && e.detail > 0) { e.stopPropagation(); e.preventDefault(); } }}>
      {/* no backdrop blur: over the live 3D view it costs every frame on a phone */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(14,18,23,.98) 0%, rgba(14,18,23,.95) 45%, rgba(14,18,23,.9) 100%)' }} />
      <div className={`relative h-full flex flex-col ${short ? 'gap-1.5 pb-2' : 'gap-2 md:gap-4 pb-3 md:pb-5'}`}
        style={{ paddingTop: 'max(10px, env(safe-area-inset-top))', paddingLeft: 'max(var(--rm-x), env(safe-area-inset-left))', paddingRight: 'max(var(--rm-x), env(safe-area-inset-right))', ['--rm-x' as string]: 'clamp(16px, 3vw, 40px)' }}>
        <header className={`shrink-0 flex items-center gap-3 md:gap-6 ${short ? 'h-9' : 'h-10 md:h-12'}`}>
          <div className="font-cond italic font-black text-xl md:text-2xl leading-none"><span className="text-market">Mi</span>Car</div>
          <div className="font-cond italic font-black uppercase tracking-[.22em] text-xs md:text-sm text-haze">{t(lang, 'races.title')}</div>
          <nav className="ml-auto flex items-center gap-1.5 font-cond font-bold uppercase text-[11px] md:text-xs tracking-[.14em]">
            <StepTab on={st.step === 'circuit'} onClick={() => go({ ...st, step: 'circuit', event: 0 })}>{t(lang, 'races.circuit')}</StepTab>
            <span className="text-haze px-0.5" aria-hidden>›</span>
            <StepTab on={st.step === 'event'} onClick={() => go({ ...st, step: 'event' })}>{t(lang, 'races.event')}</StepTab>
          </nav>
          <button type="button" aria-label={t(lang, 'races.close')} onClick={close} className="w-10 h-10 shrink-0 rounded-lg border border-line bg-night/70 text-ink/80 text-lg hover:text-market hover:border-market/60">✕</button>
        </header>

        <section className="flex-1 min-h-0 flex gap-4 md:gap-10 max-[560px]:flex-col">
          <div className="w-[42%] max-[560px]:w-full min-w-0 flex flex-col justify-center">
            <h2 data-races-name className={`font-cond italic font-black uppercase leading-[.88] tracking-tight break-words ${short ? 'line-clamp-1 text-[clamp(26px,4.4vw,40px)]' : 'line-clamp-2 text-[clamp(30px,6vw,92px)]'}`}>{v.name}</h2>
            <div className={`flex items-center gap-2 font-cond font-bold uppercase tracking-[.12em] whitespace-nowrap ${short ? 'mt-1 text-[11px]' : 'mt-1.5 md:mt-3 text-[11px] md:text-sm'}`}>
              <span className="px-1.5 py-px rounded-sm bg-ink text-night text-[10px] md:text-xs leading-tight">{v.cc}</span>
              <span>{v.country}</span><span className="text-haze">·</span>
              <span className="text-haze">{t(lang, 'races.of').replace('{n}', String(v.n)).replace('{m}', String(v.of))}</span>
            </div>
            {!short && <p className="mt-2 md:mt-4 max-w-[46ch] text-[12.5px] md:text-[15px] leading-snug text-ink/75">{v.blurb}</p>}
            <dl className={`grid grid-cols-4 max-w-[560px] ${short ? 'mt-2.5 gap-2' : 'mt-3 md:mt-7 gap-2 md:gap-6'}`}>
              <Stat short={short} value={v.length} label={t(lang, 'races.length')} />
              <Stat short={short} value={v.corners ? String(v.corners) : '—'} label={t(lang, 'races.corners')} />
              <Stat short={short} value={String(v.events)} label={t(lang, 'races.events')} />
              <Stat short={short} value={v.best ?? '—'} label={t(lang, 'races.best')} accent={!!v.best} />
            </dl>
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="relative flex-1 min-h-[110px] rounded-xl border border-line bg-night-2/70 overflow-hidden">
              {map && <TrackMap c={map} route={ev && maps ? maps.events[ev.id] : undefined} routeCol={ev?.col} labels />}
            </div>
            {!short && <Legend lang={lang} />}
          </div>
        </section>

        <section className="shrink-0 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-races-cards>
          <div ref={row} className="flex gap-2 pb-1">   {/* ten 110 px cards fit from 1280 px wide; narrower screens scroll */}
            {st.step === 'circuit'
              ? CIRCUITS.map((ci, i) => {
                const cv = circuitView(ci.id, lang, rec, units, maps ?? EMPTY), on = i === st.circuit;
                return (
                  <button key={ci.id} type="button" onClick={() => pickCircuit(i)} aria-pressed={on} data-circuit={ci.id} aria-label={`${cv.name}, ${cv.country}`}
                    className={`relative flex-1 min-w-[110px] max-w-[210px] ${short ? 'h-[74px]' : 'h-[92px] md:h-[118px]'} rounded-lg border text-left px-2.5 py-2 flex flex-col overflow-hidden ${on ? 'bg-ink text-night border-ink' : 'bg-night/80 border-line hover:border-haze/60'}`}>
                    {on && <span className="absolute left-0 top-0 right-0 h-[5px] bg-market" />}
                    <div className="shrink-0 flex items-center justify-between font-cond font-bold text-[10px] md:text-[11px] tracking-[.14em] uppercase opacity-80">
                      <span>{String(i + 1).padStart(2, '0')} · {ci.cc}</span>{cv.locked && <Lock />}
                    </div>
                    <div className="flex-1 min-h-0 my-1">{maps && <TrackMap c={maps.circuits[ci.id]} thumb dark={on} />}</div>
                    <div className="shrink-0 font-cond italic font-black uppercase text-[13px] md:text-[15px] leading-none truncate">{cv.name}</div>
                    {!short && <div className={`shrink-0 text-[10px] md:text-[11px] truncate ${on ? 'text-night/60' : 'text-haze'}`}>{cv.country}</div>}
                  </button>
                );
              })
              : evs.map((e, i) => {
                const on = i === st.event;
                return (
                  <button key={e.id} type="button" onClick={() => pickEvent(i)} aria-pressed={on} data-event={e.id}
                    className={`relative shrink-0 w-[178px] md:w-[230px] ${short ? 'h-[74px]' : 'h-[92px] md:h-[118px]'} rounded-lg border text-left px-3 py-2 flex flex-col overflow-hidden ${on ? 'bg-ink text-night border-ink' : 'bg-night/80 border-line hover:border-haze/60'}`}>
                    <span className="absolute left-0 top-0 right-0 h-1" style={{ background: e.col }} />
                    <div className="shrink-0 flex items-center justify-between gap-2 font-cond font-bold text-[10px] md:text-[11px] tracking-[.14em] uppercase opacity-80 mt-0.5">
                      <span>{EV_NAME[e.type]}</span>
                      {e.locked ? <span className="flex items-center gap-1"><Lock />{t(lang, 'races.stage').replace('{n}', String(e.stage))}</span> : <span className="tabular-nums">{e.prize}</span>}
                    </div>
                    <div className={`shrink-0 mt-1 font-cond italic font-black uppercase leading-none truncate ${short ? 'text-[16px]' : 'text-[15px] md:text-[19px]'}`}>{e.name}</div>
                    <div className={`shrink-0 mt-1 truncate text-[11px] ${short ? '' : 'md:text-[12.5px]'} ${on ? 'text-night/70' : 'text-haze'}`}>{e.detail}{short && <span className="tabular-nums"> · {t(lang, 'races.best')} {e.best ?? '—'}</span>}</div>
                    {!short && <div className={`shrink-0 mt-auto font-cond font-bold text-[11px] md:text-xs tabular-nums uppercase tracking-[.08em] ${on ? 'text-night/70' : 'text-ink/70'}`}>{t(lang, 'races.best')} {e.best ?? '—'}</div>}
                  </button>
                );
              })}
          </div>
        </section>

        <footer className="shrink-0 flex items-center gap-3 md:gap-5 font-cond font-bold uppercase text-[11px] md:text-xs tracking-[.12em] text-haze min-h-[44px]">
          {note
            ? <span role="status" className="flex items-center gap-1.5 text-[#ff6b78] normal-case tracking-normal text-[13px] md:text-sm font-sans font-semibold">{note.lock && <Lock />}{note.txt}</span>
            : coarse && st.step === 'circuit' && <span className="normal-case tracking-normal font-sans font-semibold text-[13px]">{t(lang, 'races.tap')}</span>}
          <div className="ml-auto flex items-center gap-3 md:gap-5">
          <span className={`items-center gap-4 ${coarse ? 'hidden' : 'hidden md:flex'}`}>
            <span><Key>◀ ▶</Key> {st.step === 'circuit' ? t(lang, 'races.circuit') : t(lang, 'races.event')}</span>
            <span><Key>Enter</Key> {st.step === 'circuit' ? t(lang, 'races.confirm') : t(lang, 'races.start')}</span>
            <span><Key>Esc</Key> {st.step === 'circuit' ? t(lang, 'races.close') : t(lang, 'races.back')}</span>
          </span>
          <button type="button" onClick={() => act('enter')} data-races-go
            className={`min-h-[44px] px-5 rounded-lg flex items-center gap-1.5 font-cond italic font-black uppercase text-base tracking-wide ${blocked ? 'bg-night border border-line text-haze' : 'bg-market text-night'}`}>
            {st.step === 'circuit' ? t(lang, 'races.continue')
              : !driving ? t(lang, 'races.needCar')
              : ev?.locked ? <><Lock />{t(lang, 'races.stage').replace('{n}', String(ev.stage))}</>
              : t(lang, 'races.start')}
          </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function StepTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`px-2.5 md:px-3.5 py-1.5 rounded-md ${on ? 'bg-ink text-night' : 'text-haze hover:text-ink'}`} aria-current={on ? 'step' : undefined}>{children}</button>;
}
function Stat({ value, label, accent, short }: { value: string; label: string; accent?: boolean; short?: boolean }) {
  return (
    <div className="min-w-0 flex flex-col-reverse">
      <dt className={`mt-1 font-cond font-bold uppercase tracking-[.14em] text-haze truncate ${short ? 'text-[9.5px]' : 'text-[9.5px] md:text-[11px]'}`}>{label}</dt>
      <dd className={`font-cond italic font-black leading-none tabular-nums truncate ${short ? 'text-[22px]' : 'text-[clamp(18px,2.6vw,36px)]'} ${accent ? 'text-market' : ''}`}>{value}</dd>
    </div>
  );
}
function Key({ children }: { children: ReactNode }) {
  return <span className="inline-block min-w-[26px] text-center px-1.5 py-0.5 mr-1 rounded border border-line bg-night text-ink/90 tracking-normal">{children}</span>;
}
function Lock() {
  return <svg viewBox="0 0 12 14" className="w-2.5 h-3 inline-block shrink-0" aria-hidden><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="1.5" y="6" width="9" height="7" rx="1.2" fill="currentColor" /></svg>;
}
function Legend({ lang }: { lang: Lang }) {
  return (
    <div className="shrink-0 mt-1.5 md:mt-2.5 flex items-center gap-3 md:gap-5 font-cond font-bold uppercase text-[9.5px] md:text-[11px] tracking-[.14em] text-haze [@media(max-height:420px)]:hidden">
      {SECTOR_COL.map((col, i) => <span key={col} className="flex items-center gap-1.5"><span className="w-4 md:w-6 h-[3px] rounded" style={{ background: col }} />{t(lang, 'races.sector')} {i + 1}</span>)}
      <span className="flex items-center gap-1.5"><span className="w-[3px] h-3 bg-white" />{t(lang, 'races.startLine')}</span>
    </div>
  );
}

type Pts = [number, number][];
const join = (P: Pts) => P.map(p => p[0] + ',' + p[1]).join(' ');

/** A circuit from circuitMaps.json as an SVG, north up: sectors, start line and corner numbers (labels), or a plain
 *  outline (thumb). An event's route can lie over it in its colour, the circuit dimmed under it. Lines and labels
 *  keep their size in screen pixels whatever the map's size. */
export function TrackMap({ c, route, routeCol, labels, thumb, dark }: {
  c: CircuitMaps['circuits'][string]; route?: CircuitMaps['events'][string]; routeCol?: string; labels?: boolean; thumb?: boolean; dark?: boolean;
}) {
  const box = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);  // the map's box on screen
  useEffect(() => {
    if (thumb || !box.current) return;
    const el = box.current, read = () => setSize(s => (s[0] === el.clientWidth && s[1] === el.clientHeight ? s : [el.clientWidth, el.clientHeight]));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, [thumb]);
  const P = c.pts as Pts, withLabels = !!labels && !thumb;
  const xs = P.map(p => p[0]).concat(withLabels ? c.corners.map(q => q[2]) : []), zs = P.map(p => p[1]).concat(withLabels ? c.corners.map(q => q[3]) : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), w = x1 - x0, h = z1 - z0;
  const pad = Math.max(w, h) * (thumb ? 0.04 : 0.07), vw = w + 2 * pad, vh = h + 2 * pad, view = `${x0 - pad} ${z0 - pad} ${vw} ${vh}`;
  const NS = { vectorEffect: 'non-scaling-stroke' as const, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, fill: 'none' };
  const loopPts = join(P) + ' ' + P[0][0] + ',' + P[0][1];
  if (thumb) return (
    <svg viewBox={view} preserveAspectRatio="xMidYMid meet" className="w-full h-full" aria-hidden>
      <polyline points={loopPts} stroke={dark ? '#0e1217' : '#e7eaee'} strokeWidth={2} {...NS} />
    </svg>
  );
  const [bw, bh] = size, u = unitsPerPx(vw, vh, bw, bh);
  // corner numbers as big as the drawn circuit allows without two overlapping (none before the box is measured)
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
  for (const [x, z] of P) { tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); tz0 = Math.min(tz0, z); tz1 = Math.max(tz1, z); }
  const rPx = bw > 0 ? labelRadiusPx(Math.hypot(tx1 - tx0, tz1 - tz0) / u) : 0, r = rPx * u, showLabels = withLabels && rPx > 0;
  const [s2, s3] = c.sectors, sect = [P.slice(0, s2 + 1), P.slice(s2, s3 + 1), [...P.slice(s3), P[0]] as Pts];
  const bar = startBar(route ? route.pts as Pts : P, route ? route.loop : true, 9 * u), end = route && !route.loop ? route.pts[route.pts.length - 1] : null;
  return (
    <svg ref={box} viewBox={view} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full" role="img" aria-label="" data-track-map>
      <polyline points={loopPts} stroke="#05070a" strokeWidth={10} {...NS} />
      {sect.map((pts, i) => <polyline key={i} points={join(pts)} stroke={SECTOR_COL[i]} strokeWidth={4} opacity={route ? 0.25 : 1} {...NS} />)}
      {route && <polyline points={join(route.pts as Pts) + (route.loop ? ' ' + route.pts[0][0] + ',' + route.pts[0][1] : '')} stroke="#05070a" strokeWidth={9} {...NS} />}
      {route && <polyline points={join(route.pts as Pts) + (route.loop ? ' ' + route.pts[0][0] + ',' + route.pts[0][1] : '')} stroke={routeCol ?? '#e7eaee'} strokeWidth={5} {...NS} data-route />}
      {end && <circle cx={end[0]} cy={end[1]} r={5 * u} fill="#0e1217" stroke={routeCol ?? '#e7eaee'} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
      <line {...bar} stroke="#ffffff" strokeWidth={4} {...NS} data-start />
      {showLabels && c.corners.map(([, , lx, lz], i) => (
        <g key={i} opacity={route ? 0.55 : 1}>
          <circle cx={lx} cy={lz} r={r} fill="#0e1217" stroke="rgba(231,234,238,.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={lx} y={lz} fontSize={r * 1.15} textAnchor="middle" dominantBaseline="central" fill="#e7eaee" fontFamily="'Barlow Condensed', sans-serif" fontWeight={700}>{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}
