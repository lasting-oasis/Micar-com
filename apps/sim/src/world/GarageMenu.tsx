// The Garage overlay: Night Tuner's garage screen on MiCar's night and paint yellow. The menu logic is
// GarageModel (garage.ts); the turntable is GarageScene; this file draws them and routes keys and pointer.
// Open with useGameStore.openGarage(carId) (one of the player's inventory cars); "Drive" closes it.
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { deriveStyle } from '../scene/carModel';
import { GarageModel, drawDyno, type Row, type RowTone } from './garage';
import { GarageScene } from './GarageScene';
import { Audio } from './audio';
import { useDriveUi } from './driveUi';
import { getOption, getOptions, setOption } from './options';
import { getCarSpec } from '../carSpecs';
import { STAGE_REP, STOCK_CFG, STYLES, TUNE_DEF, specFor, stageOf, visualRating, type BodyStyle, type PartValue, type StripRecord } from './data';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const TONE: Record<RowTone, string> = { eq: 'text-success', lock: 'text-warning', owned: 'text-haze', price: 'text-market', poor: 'text-warning', muted: 'text-haze' };
const TONE_SEL: Record<RowTone, string> = { eq: 'text-background', lock: 'text-[#6a0010]', owned: 'text-background/70', price: 'text-background', poor: 'text-[#6a0010]', muted: 'text-background/70' };
const SEG: Record<string, string> = { on: 'bg-market', up: 'bg-success', down: 'bg-warning', '': 'bg-white/10' };

export function GarageMenu({ onQuickRace }: { onQuickRace?: (eventId: string) => void } = {}) {
  const carId = useGameStore(s => s.garageCarId);
  const me = useGameStore(s => (s.playerId && s.gameState ? s.gameState.players[s.playerId] : undefined));
  const strip = useGameStore(s => s.strip);
  const octane = useGameStore(s => s.octane);
  const car = me?.inventory.find(c => c.id === carId);
  const close = useGameStore(s => s.closeGarage);

  // spec: specFor scales an archetype to the real car (~20 ms), so once per car
  const spec = useMemo(() => car ? specFor({ make: car.make, model: car.model, bodyStyle: car.bodyStyle, rental: car.rental, testCar: car.testCar }) : null, [car?.id, car?.make, car?.model, car?.bodyStyle, car?.rental, car?.testCar]);
  const style: BodyStyle = useMemo(() => { const s = car ? (car.bodyStyle ?? deriveStyle(car.model)) : 'sedan'; return (STYLES as string[]).includes(s) ? s as BodyStyle : 'sedan'; }, [car?.bodyStyle, car?.model]);
  const fallback = useMemo(() => ({ cfg: clone(STOCK_CFG), tune: clone(TUNE_DEF), owned: [] as string[] }), [carId]);

  const live = useRef({ carId, spec, fallback, cars: [] as { id: string; name: string; drive?: string }[] });
  live.current = { carId, spec, fallback, cars: (me?.inventory ?? []).map(c => { const d = getCarSpec(c, c.bodyStyle ?? deriveStyle(c.model)).drive; return { id: c.id, name: `${c.year} ${c.make} ${c.model}`, drive: d === '4WD' ? 'AWD' : d }; }) };

  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [toast, setToast] = useState<{ text: string; bad: boolean; n: number } | null>(null);
  const audio = useRef<Audio | null>(null);

  const model = useRef<GarageModel | null>(null);
  if (!model.current) {
    const st = () => useGameStore.getState();
    const rec = (): StripRecord | null => st().strip;
    model.current = new GarageModel({
      money: () => { const s = st(); return (s.playerId && s.gameState?.players[s.playerId]?.money) || 0; },
      stage: () => stageOf(rec()?.rep ?? 0),
      car: () => { const L = live.current; return { id: L.carId ?? '', spec: L.spec!, state: rec()?.cars[L.carId ?? ''] ?? L.fallback }; },
      cars: () => live.current.cars,
      buy: (key, v, price) => { const id = live.current.carId; if (id) st().buyStripPart(id, key, v as PartValue, price); },
      equip: (key, v) => { const id = live.current.carId; if (id) st().equipStripPart(id, key, v as PartValue); },
      tune: (t) => { const id = live.current.carId; if (id) st().setStripTune(id, t); },
      toast: (text, bad) => setToast(p => ({ text, bad: !!bad, n: (p?.n ?? 0) + 1 })),
      sfx: (n) => audio.current?.sfx(n),
      switchCar: (id) => st().openGarage(id),
      best: () => rec()?.best ?? {},
      // the options are saved (world/options.ts) and read by the driving: transmission, units, camera, sound
      getOpt: (k) => getOption(k),
      setOpt: (k, v) => { setOption(k, v); if (k === 'mute') audio.current?.setMute(!!getOptions().mute); },
    });
  }
  const g = model.current;

  // toast fades after 2.4 s
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2400); return () => clearTimeout(t); }, [toast?.n]);

  // sound, and the world under the garage drawn sparingly while it is covered
  useEffect(() => {
    audio.current = new Audio(getOptions().mute);
    const s = useGameStore.getState(), was = s.menuCoversWorld; s.setMenuCoversWorld(true);
    return () => { audio.current?.dispose(); audio.current = null; useGameStore.getState().setMenuCoversWorld(was); };
  }, []);

  // the turntable
  const sceneCanvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<GarageScene | null>(null);
  const lastCam = useRef('');
  useEffect(() => {
    if (!sceneCanvas.current) return;
    try { scene.current = new GarageScene(sceneCanvas.current); } catch (e) { console.warn('garage scene', e); }
    return () => { scene.current?.dispose(); scene.current = null; lastCam.current = ''; };
  }, []);

  const act = (f: () => unknown) => {
    audio.current?.resume();
    const r = f();
    if (r === 'drive') { driveThis(); close(); return; }
    if (typeof r === 'string' && r.startsWith('quick:')) { driveThis(); close(); onQuickRace?.(r.slice(6)); return; }
    bump();
  };
  // out of the Garage in the car it shows (after "Your cars" switched to another one, that one)
  const driveThis = () => useDriveUi.setState({ driveCar: live.current.carId });
  const leave = () => { g.exit(); driveThis(); close(); };

  // keyboard: Night Tuner's garage keys. Captured on the window so the world under it does not drive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!model.current) return;
      const m = model.current, k = m.kind();
      e.stopPropagation();
      const c = e.code;
      if (c === 'ArrowDown' || c === 'KeyS') act(() => m.move(1));
      else if (c === 'ArrowUp' || c === 'KeyW') act(() => m.move(-1));
      else if (k === 'dyno' && (c === 'ArrowRight' || c === 'KeyD')) act(() => m.adjust(1));
      else if (k === 'dyno' && (c === 'ArrowLeft' || c === 'KeyA')) act(() => m.adjust(-1));
      else if (c === 'Enter' || c === 'ArrowRight' || c === 'Space' || c === 'KeyD') act(() => m.activate());
      else if (c === 'Escape' && m.state.stack.length <= 1) leave();
      else if (c === 'Escape' || c === 'ArrowLeft' || c === 'Backspace' || c === 'KeyA') act(() => m.back());
      else if (c === 'Tab') { /* swallowed: the world's UI toggle */ }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // close if the car leaves the inventory (sold, scrapped)
  useEffect(() => { if (me && carId && !car) { g.exit(); close(); } }, [me, carId, car, close]);

  const shown = car && spec ? g.shown() : null;
  // keep the turntable on the previewed cfg and the menu's camera
  useEffect(() => {
    const sc = scene.current; if (!sc || !shown) return;
    sc.setCar(style, shown.cfg, shown.tune);
    const cam = g.cam(); if (cam !== lastCam.current) { lastCam.current = cam; sc.setCam(cam); }
  });

  const dynoCanvas = useRef<HTMLCanvasElement>(null);
  const stats = car && spec ? g.stats() : null;
  const dyno = car && spec ? g.dynoPanel() : false;
  useEffect(() => { if (dyno && stats && dynoCanvas.current) drawDyno(dynoCanvas.current, stats.Pn, stats.Pp); });

  const listRef = useRef<HTMLDivElement>(null);
  const sel = car && spec ? g.sel() : 0;
  useEffect(() => { (listRef.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }); }, [sel, car && spec ? g.title() : '']);

  if (!car || !spec || !shown || !stats) {
    return <div className="fixed inset-0 z-[10000] bg-background grid place-items-center font-cond text-haze">Loading the garage…</div>;
  }

  const rows = g.rows(), kind = g.kind();
  const rep = strip?.rep ?? 0, stage = stageOf(rep);
  const rating = visualRating((strip?.cars[car.id] ?? fallback).cfg);
  const onRowClick = (i: number, e: React.MouseEvent) => {
    if (g.sel() !== i) { act(() => g.select(i)); if ((e.nativeEvent as PointerEvent).pointerType === 'touch' || e.detail === 0) return; }
    if (kind === 'dyno') act(() => g.adjust(1)); else act(() => g.activate());
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-background text-ink font-sans select-none overflow-hidden" role="dialog" aria-label="Garage">
      <canvas ref={sceneCanvas} className="absolute inset-0 w-full h-full block touch-none" />

      {/* header: the car, its style stars; money, REP and stage. Above the menu column: on a narrow screen the column's
          box reaches up under "Drive", and the way out has to stay tappable. */}
      <div className="absolute z-10 top-4 left-4 right-4 md:left-6 md:right-6 flex justify-between items-start gap-4 pointer-events-none">
        <div className="min-w-0">
          <div className="font-cond italic font-black text-2xl md:text-3xl leading-none truncate">{spec.name} <span className="text-haze text-lg not-italic font-semibold">· {spec.drive}</span></div>
          <div className="mt-1 flex items-center gap-2 text-market text-sm" aria-label={`Style ${rating.toFixed(1)} of 10`}>
            <span>{Array.from({ length: 10 }, (_, i) => <span key={i} className={i < Math.round(rating) ? '' : 'text-white/20'}>★</span>)}</span>
            <span className="font-cond text-haze text-xs tracking-wider">{rating.toFixed(1)} / 10</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 pointer-events-auto">
          <div className="font-cond italic font-extrabold text-3xl md:text-4xl leading-none text-market tabular-nums">{money(me?.money ?? 0)}</div>
          <div className="font-cond italic font-extrabold text-lg leading-none text-[#79a6ff] tabular-nums" aria-label={`${octane} Octane`}>{Math.round(octane).toLocaleString('en-US')} Octane</div>
          <div className="font-cond font-semibold text-xs tracking-[.14em] text-haze">REP {rep.toLocaleString('en-US')} · Stage {stage}{stage < 5 ? ` · next at ${STAGE_REP[stage].toLocaleString('en-US')}` : ''}</div>
          <button type="button" onClick={leave} className="mt-1 px-4 py-1.5 bg-market text-background font-cond font-bold italic text-base -skew-x-[10deg] hover:brightness-110">
            <span className="inline-block skew-x-[10deg]">Drive</span>
          </button>
        </div>
      </div>

      {/* menu column */}
      <div className="absolute left-4 md:left-6 top-[112px] w-[min(400px,calc(100vw-32px))] grid gap-2.5">
        <div className="font-cond font-bold text-xs tracking-[.2em] text-market min-h-[14px]">{g.crumb()}</div>
        <h2 className="m-0 font-cond italic font-black text-4xl md:text-5xl leading-[.9]">{g.title()}</h2>
        <div ref={listRef} role="listbox" aria-label="Menu" className="grid gap-1 max-h-[calc(100dvh-470px)] md:max-h-[calc(100vh-360px)] overflow-y-auto overflow-x-hidden py-1 pl-2 pr-3.5">
          {rows.map((r, i) => <MenuRow key={r.id + i} r={r} sel={i === sel} dyno={kind === 'dyno'}
            onEnter={(e) => { if (e.pointerType === 'mouse' && g.sel() !== i) act(() => g.select(i)); }}
            onClick={(e) => onRowClick(i, e)}
            onNudge={(d) => act(() => { g.select(i); g.adjust(d); })} />)}
        </div>
        <div className="min-h-[20px] text-sm text-haze max-w-[46ch] pl-2">{g.desc()}</div>
        {g.state.stack.length > 1 && (
          <button type="button" onClick={() => act(() => g.back())} className="justify-self-start ml-2 font-cond font-semibold text-sm text-haze hover:text-ink">‹ Back</button>
        )}
      </div>

      {/* stat panel */}
      <div className="absolute left-4 right-4 bottom-3 md:left-auto md:right-6 md:bottom-20 md:w-[300px] bg-night/80 border border-line px-3 py-2 md:px-[18px] md:py-4 grid gap-1.5 md:gap-2.5">
        <h3 className="m-0 font-cond italic font-extrabold text-base md:text-lg">{stats.title}<span className="ml-2 not-italic font-semibold text-xs tracking-[.14em] text-haze">{stats.changed ? 'Preview' : 'Current'}</span></h3>
        <div className="font-cond font-semibold text-xs md:text-sm text-haze"><b className="text-ink">{stats.hp} hp</b> @ {stats.hpRpm} rpm · <b className="text-ink">{stats.mass} kg</b> · {stats.drive}</div>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-x-3 gap-y-1.5 md:gap-y-2.5">
        {stats.bars.map(b => (
          <div key={b.n} className="grid gap-1">
            <div className="flex justify-between gap-2 font-cond font-bold text-[11px] md:text-xs tracking-[.12em] text-haze"><span>{b.n}</span><b className="text-ink tabular-nums tracking-normal">{b.txt}</b></div>
            <div className="grid grid-cols-12 gap-[2px] md:gap-[3px] h-1.5 md:h-2.5">{b.segs.map((s, q) => <i key={q} className={`block -skew-x-[20deg] ${SEG[s]}`} />)}</div>
          </div>
        ))}
        </div>
        {dyno && <canvas ref={dynoCanvas} width={300} height={150} className="hidden md:block w-full h-[150px]" />}
      </div>

      {toast && (
        <div role="status" className={`absolute left-1/2 bottom-44 md:bottom-8 -translate-x-1/2 z-10 px-5 py-2.5 -skew-x-[10deg] border font-cond font-bold text-base ${toast.bad ? 'bg-[#2a0d12] border-warning text-ink' : 'bg-night border-market text-ink'}`}>
          <span className="inline-block skew-x-[10deg]">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

function MenuRow({ r, sel, dyno, onEnter, onClick, onNudge }: { r: Row; sel: boolean; dyno: boolean; onEnter: (e: React.PointerEvent) => void; onClick: (e: React.MouseEvent) => void; onNudge: (d: -1 | 1) => void }) {
  const st = r.status;
  return (
    <div role="option" aria-selected={sel} onPointerEnter={onEnter} onClick={onClick}
      className={`relative flex items-center gap-2.5 min-h-[40px] md:min-h-[42px] px-4 py-1.5 border cursor-pointer -skew-x-[10deg] transition-[transform,background-color] duration-100 ${sel ? 'bg-market text-background border-market translate-x-2 shadow-[0_0_24px_rgba(255,210,63,.3)]' : 'bg-night/75 border-line hover:bg-night-2'}`}>
      {r.swatch && <span className="skew-x-[10deg] w-[22px] h-[22px] flex-none border border-white/35" style={{ background: r.swatch }} />}
      <span className={`skew-x-[10deg] font-cond italic font-bold text-lg md:text-xl leading-none truncate ${dyno ? 'basis-[42%] flex-none' : 'flex-1'}`}>{r.label}</span>
      {r.slider != null && (
        <span className="skew-x-[10deg] flex-1 flex items-center gap-2">
          <button type="button" aria-label="Less" onClick={(e) => { e.stopPropagation(); onNudge(-1); }} className={`font-cond font-bold w-5 ${sel ? 'text-background' : 'text-haze'}`}>−</button>
          <span className={`relative flex-1 h-2 ${sel ? 'bg-black/25' : 'bg-white/10'}`}>
            <b className="absolute left-1/2 -top-0.5 w-px h-3 bg-white/40" />
            <i className={`absolute -top-1 w-[5px] h-4 -ml-0.5 ${sel ? 'bg-background' : 'bg-market'}`} style={{ left: `${50 + r.slider * 50}%` }} />
          </span>
          <button type="button" aria-label="More" onClick={(e) => { e.stopPropagation(); onNudge(1); }} className={`font-cond font-bold w-5 ${sel ? 'text-background' : 'text-haze'}`}>+</button>
        </span>
      )}
      {r.tag && <span className={`skew-x-[10deg] font-cond font-semibold text-xs tracking-wider ${sel ? 'text-background/70' : 'text-haze'}`}>{r.tag}</span>}
      {st && <span className={`skew-x-[10deg] font-cond font-bold text-sm tracking-wider whitespace-nowrap tabular-nums ${st.tone === 'price' || st.tone === 'poor' ? 'text-base' : ''} ${sel ? TONE_SEL[st.tone] : TONE[st.tone]}`}>{st.text}</span>}
      {r.chevron && <span className={`skew-x-[10deg] font-cond italic font-extrabold text-lg ${sel ? 'text-background' : 'text-haze'}`}>›</span>}
    </div>
  );
}
