/* The Garage: Night Tuner 07-garage.js's menus as a pure model (no DOM, no THREE).
   MENU, rows/renderMenu (as display data), onSel, enter, back, adjust, activate, statRows and
   renderStats (as data) are ported here; drawDyno is exported separately and draws on a canvas.
   Changes from Night Tuner: "Car lot" is `cars`, the player's inventory (no buying: the Dealership
   sells cars), "Reset progress" is gone, "Free roam" is "Drive" (it closes the garage), money, stage,
   buying, equipping and tuning go through the ctx callbacks. The dyno sliders move a preview and the
   tune is saved once on leaving the dyno (Night Tuner saved on every tick). */
import { CATS, EVENTS, EV_NAME, TRACK_NAMES, PERF, TUNES, getV, isOwned, withV, type CarCfg, type PartValue, type EventDef } from './data';
import { carParams, clamp, dynoCurve, simStats, type Params, type PerfCfg, type Tune, type VehicleSpec } from './physics';
import { routeFor, trackLoaded, TRACKS } from './strip/district';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

export type CarStateLite = { cfg: CarCfg; tune: Tune; owned: string[] };
export type GarageCtx = {
  money: () => number;
  stage: () => number;
  car: () => { id: string; spec: VehicleSpec; state: CarStateLite };
  cars: () => { id: string; name: string; drive?: string }[];
  /** Pay `price` for part `key`=`v`, add it to the car's owned parts and fit it. */
  buy: (key: string, v: unknown, price: number) => void;
  /** Fit an owned part. */
  equip: (key: string, v: unknown) => void;
  tune: (t: Tune) => void;
  toast: (t: string, bad?: boolean) => void;
  sfx: (n: string) => void;
  /** Open the garage on another of the player's cars (the `cars` listing). */
  switchCar?: (id: string) => void;
  /** Best times / scores per event id, for the quick race descriptions. */
  best?: () => Record<string, number>;
  /** Options storage; without it the options live in the model. */
  getOpt?: (k: string) => unknown;
  setOpt?: (k: string, v: unknown) => void;
};

export type MenuKind = 'menu' | 'cat' | 'dyno' | 'cars' | 'options' | 'quick';
type MenuItem = { n?: string; to?: string; act?: 'drive'; cat?: string; d?: string };
type MenuDef = { n: string; items?: MenuItem[]; kind?: Exclude<MenuKind, 'menu' | 'cat'> };
export type MenuState = { stack: { id?: string; cat?: string; sel: number }[]; preview: { cfg: CarCfg; tune: Tune } | null };

/** One row of the menu list, as display data. */
export type RowTone = 'eq' | 'lock' | 'owned' | 'price' | 'poor' | 'muted';
export type Row = {
  id: string; label: string;
  /** right-hand status (EQUIPPED, STAGE 3, a price, a current value) */
  status?: { text: string; tone: RowTone };
  /** a second, muted tag (drive layout in the car listing) */
  tag?: string;
  /** a colour swatch: a CSS background */
  swatch?: string;
  /** a dyno slider position, -1..1 */
  slider?: number;
  chevron?: boolean;
};
export type StatRow = { n: string; v: number; txt: string };

export const MENU: Record<string, MenuDef> = {
  root: { n: 'Garage', items: [
    { n: 'Drive', act: 'drive', d: 'Back to the street in this car.' },
    { n: 'Quick race', to: 'quick', d: 'Race any unlocked event straight from the garage.' },
    { n: 'Visual', to: 'visual', d: 'Paint, rims, body kits, vinyls, lights and hydraulics. Raises your star rating.' },
    { n: 'Performance', to: 'perf', d: 'Engine, turbo, nitrous and handling parts, plus dyno tuning.' },
    { n: 'Your cars', to: 'cars', d: 'Switch to another car you own. Each keeps its own parts.' },
    { n: 'Options', to: 'options', d: 'Transmission, units, camera, sound.' },
  ] },
  visual: { n: 'Visual', items: [{ n: 'Paint', to: 'g_paint' }, { n: 'Rims', to: 'g_rims' }, { n: 'Body kit', to: 'g_body' }, { n: 'Graphics', to: 'g_gfx' }, { n: 'Lights', to: 'g_lights' }, { cat: 'hydraulics' }] },
  g_paint: { n: 'Paint', items: [{ cat: 'color' }, { cat: 'finish' }] },
  g_rims: { n: 'Rims', items: [{ cat: 'rim' }, { cat: 'rimSize' }, { cat: 'rimColor' }] },
  g_body: { n: 'Body kit', items: [{ cat: 'front' }, { cat: 'rear' }, { cat: 'skirts' }, { cat: 'spoiler' }, { cat: 'hood' }, { cat: 'roof' }] },
  g_gfx: { n: 'Graphics', items: [{ cat: 'vinyl' }, { cat: 'vinylColor' }, { cat: 'tint' }] },
  g_lights: { n: 'Lights', items: [{ cat: 'neon' }, { cat: 'lights' }] },
  perf: { n: 'Performance', items: [...Object.keys(PERF).map(k => ({ cat: 'perf.' + k })), { n: 'Dyno tuning', to: 'dyno', d: 'Fine-tune the setup with sliders and read the dyno chart.' }] },
  dyno: { n: 'Dyno tuning', kind: 'dyno' }, cars: { n: 'Your cars', kind: 'cars' }, options: { n: 'Options', kind: 'options' }, quick: { n: 'Quick race', kind: 'quick' },
};
export const OPTS: { k: string; n: string; vals: unknown[]; lab: string[]; d?: string }[] = [
  { k: 'manual', n: 'Transmission', vals: [false, true], lab: ['Automatic', 'Manual'], d: 'Manual: Shift to shift up, Ctrl to shift down. Drag races are always manual.' },
  { k: 'units', n: 'Speed units', vals: ['kmh', 'mph'], lab: ['km/h', 'mph'] },
  { k: 'cam', n: 'Camera', vals: [0, 1, 2], lab: ['Chase', 'Far chase', 'Hood'] },
  { k: 'mute', n: 'Sound', vals: [false, true], lab: ['On', 'Off'] },
];
const OPT_DEF: Record<string, unknown> = { manual: false, units: 'mph', cam: 0, mute: false };

const routeLen = new Map<string, number>();
const lenOf = (ev: EventDef): number => { let l = routeLen.get(ev.id); if (l == null) { if (!trackLoaded(ev.track)) return TRACKS.find(t => t.id === ev.track)!.lenM; l = routeFor(ev.id).len; routeLen.set(ev.id, l); } return l; };
const fmtT = (s: number): string => { const m = Math.floor(s / 60), r = s - m * 60; return m ? m + ':' + r.toFixed(2).padStart(5, '0') : r.toFixed(2); };

/** The stats rows are a straight-line simulation (simStats): cached per Params object. */
const statCache = new WeakMap<Params, { s: ReturnType<typeof simStats>; rows: Omit<StatRow, 'txt'>[]; top: number; t100: number | null; nos: number }>();
function statsOf(P: Params) {
  let c = statCache.get(P);
  if (!c) {
    const s = simStats(P), cl = (v: number) => clamp(v, 0, 1);
    c = { s, top: s.top, t100: s.t100, nos: P.nos.cap, rows: [
      { n: 'Top speed', v: cl((s.top - 180) / (340 - 180)) },
      { n: 'Acceleration', v: cl((9.5 - (s.t100 || 12)) / (9.5 - 2.5)) },
      { n: 'Handling', v: cl((P.mu * P.B / 16 - 1.0) / (1.5 - 1.0)) },
      { n: 'Braking', v: cl((P.brakeMu - 1) / .2 + .2) },
      { n: 'Nitrous', v: cl(P.nos.cap * P.nos.pow / 5) },
    ] };
    statCache.set(P, c);
  }
  return c;
}

export class GarageModel {
  state: MenuState = { stack: [{ id: 'root', sel: 0 }], preview: null };
  private camName = 'orbit';
  private opts: Record<string, unknown> = { ...OPT_DEF };
  private pCache: { key: string; P: Params }[] = [];

  constructor(private ctx: GarageCtx) {}

  private top() { return this.state.stack[this.state.stack.length - 1]; }
  private cur() { return this.ctx.car().state; }
  private opt(k: string): unknown { const v = this.ctx.getOpt?.(k); return v === undefined ? this.opts[k] : v; }

  kind(): MenuKind { const t = this.top(); return t.cat ? 'cat' : (MENU[t.id!].kind || 'menu'); }
  /** The selected row. */
  sel(): number { return this.top().sel; }
  /** The camera the turntable should frame (a key of the scene's CAMS). */
  cam(): string { return this.camName; }
  /** What the turntable shows: the preview, or the car as it is. */
  shown(): { cfg: CarCfg; tune: Tune } { const p = this.state.preview, c = this.cur(); return p ? p : { cfg: c.cfg, tune: c.tune }; }
  previewTune(): Tune { return this.shown().tune; }
  /** The stat panel is the dyno (chart shown) in the dyno and the performance parts. */
  dynoPanel(): boolean { const t = this.top(), k = this.kind(); return k === 'dyno' || (k === 'cat' && t.cat!.startsWith('perf.')); }

  title(): string { const t = this.top(); return t.cat ? CATS[t.cat].n : MENU[t.id!].n; }
  crumb(): string { return ['Garage', ...this.state.stack.slice(1, -1).map(s => s.cat ? CATS[s.cat].n : MENU[s.id!].n)].join('  ›  '); }

  private catLabel(k: string): string { const v = getV(this.cur().cfg, k); const it = CATS[k].items.find(i => i.v === v); return it ? it.n : ''; }
  private rawCount(): number {
    const t = this.top(), k = this.kind();
    if (k === 'cat') return CATS[t.cat!].items.length;
    if (k === 'dyno') return TUNES.length;
    if (k === 'cars') return this.ctx.cars().length;
    if (k === 'options') return OPTS.length;
    if (k === 'quick') return EVENTS.length;
    return MENU[t.id!].items!.length;
  }
  /** Ids of the rows (a menu row's `to`, `cat` or `act`; a part's value; a car's or event's id). */
  rowIds(): string[] { return this.rows().map(r => r.id); }

  rows(): Row[] {
    const t = this.top(), k = this.kind(), c = this.cur(), stage = this.ctx.stage(), cash = this.ctx.money();
    if (k === 'cat') {
      const key = t.cat!;
      return CATS[key].items.map(r => {
        const eq = getV(c.cfg, key) === r.v, own = isOwned(c.cfg, c.owned, key, r.v), locked = !!r.stage && r.stage > stage;
        let swatch: string | undefined;
        const sv = String(r.v);
        if (key === 'color' || key === 'vinylColor' || (key === 'neon' && r.v !== 'none') || (key === 'rimColor' && sv.startsWith('#'))) swatch = sv;
        if (key === 'rimColor' && r.v === 'body') swatch = c.cfg.color;
        if (key === 'rimColor' && r.v === 'chrome') swatch = 'linear-gradient(135deg,#fff,#7d8796,#fff)';
        const status: Row['status'] = eq ? { text: 'Equipped', tone: 'eq' } : locked ? { text: 'Stage ' + r.stage, tone: 'lock' } : own ? { text: 'Owned', tone: 'owned' } : { text: money(r.p), tone: cash < r.p ? 'poor' : 'price' };
        return { id: sv, label: r.n, status, swatch };
      });
    }
    if (k === 'dyno') {
      const tune = this.shown().tune;
      return TUNES.map(r => { const v = tune[r.k]; return { id: r.k, label: r.n, slider: v, status: { text: (v > 0 ? '+' : '') + Math.round(v * 10), tone: 'muted' } }; });
    }
    if (k === 'cars') {
      const me = this.ctx.car().id;
      return this.ctx.cars().map(r => ({ id: r.id, label: r.name, tag: r.drive, status: r.id === me ? { text: 'Current', tone: 'eq' } : { text: 'Owned', tone: 'owned' } }));
    }
    if (k === 'options') {
      return OPTS.map(o => { const vi = Math.max(0, o.vals.indexOf(this.opt(o.k))); return { id: o.k, label: o.n, status: { text: o.lab[vi], tone: 'muted' }, chevron: true }; });
    }
    if (k === 'quick') {
      return EVENTS.map(r => ({ id: r.id, label: TRACK_NAMES[r.track].en + ' · ' + EV_NAME[r.type] + ': ' + r.name, status: r.stage > stage ? { text: 'Stage ' + r.stage, tone: 'lock' } : { text: money(r.prize * (1 + .25 * (stage - 1))), tone: 'price' } }));
    }
    return MENU[t.id!].items!.map(r => ({
      id: r.to ?? r.cat ?? r.act ?? '', label: r.cat ? CATS[r.cat].n : r.n!,
      status: r.cat ? { text: this.catLabel(r.cat), tone: 'muted' } : undefined,
      chevron: !!(r.to || r.cat),
    }));
  }

  desc(): string {
    const t = this.top(), k = this.kind(), i = t.sel;
    if (k === 'cat') return CATS[t.cat!].items[i]?.d || '';
    if (k === 'dyno') return TUNES[i].d;
    if (k === 'cars') return '';
    if (k === 'options') return OPTS[i].d || '';
    if (k === 'quick') {
      const r = EVENTS[i], best = this.ctx.best?.()[r.id];
      return (r.loop ? r.laps + ' laps · ' : '') + Math.round(lenOf(r) * (r.laps || 1)) + ' m' + (best != null ? ' · best ' + (r.type === 'drift' ? best.toLocaleString('en-US') + ' pts' : fmtT(best)) : '');
    }
    return MENU[t.id!].items![i]?.d || '';
  }

  /** Night Tuner's onSel: move the selection and preview the part under it. */
  select(i: number): void {
    const n = this.rawCount(); if (!n) return;
    const t = this.top(); t.sel = ((i % n) + n) % n;
    if (this.kind() === 'cat') { const it = CATS[t.cat!].items[t.sel], c = this.cur(); this.state.preview = { cfg: withV(c.cfg, t.cat!, it.v), tune: c.tune }; }
    this.ctx.sfx('tick');
  }
  move(dir: -1 | 1): void { this.select(this.top().sel + dir); }

  private enterNext(next: { id?: string; cat?: string; sel: number }): void {
    this.state.stack.push(next); const k = this.kind(), c = this.cur();
    if (k === 'cat') { const cat = CATS[next.cat!]; this.camName = cat.cam; this.select(Math.max(0, cat.items.findIndex(i => i.v === getV(c.cfg, next.cat!)))); return; }
    if (k === 'cars') { this.camName = 'front34'; next.sel = Math.max(0, this.ctx.cars().findIndex(x => x.id === this.ctx.car().id)); }
    if (k === 'dyno') { this.state.preview = { cfg: c.cfg, tune: clone(c.tune) }; this.camName = 'side34'; }
    this.ctx.sfx('tick');
  }
  /** Enter the selected row (Night Tuner's enter, reached through activate). */
  enter(): void {
    if (this.kind() !== 'menu') { this.activate(); return; }
    const r = MENU[this.top().id!].items![this.top().sel];
    if (r.to) this.enterNext({ id: r.to, sel: 0 }); else if (r.cat) this.enterNext({ cat: r.cat, sel: 0 });
  }

  back(): void {
    if (this.state.stack.length <= 1) return;
    if (this.kind() === 'dyno' && this.state.preview) {
      const t = this.state.preview.tune;
      if (JSON.stringify(t) !== JSON.stringify(this.cur().tune)) this.ctx.tune(clone(t));
    }
    this.state.stack.pop(); this.state.preview = null;
    if (!this.top().cat) this.camName = this.state.stack.length > 1 ? 'front34' : 'orbit';
    this.ctx.sfx('tick');
  }
  /** Back out to the root (saves a dyno tune on the way), for closing the garage. */
  exit(): void { while (this.state.stack.length > 1) this.back(); }

  adjust(dir: -1 | 1): void {
    const t = this.top(); if (this.kind() !== 'dyno' || !this.state.preview) return;
    const r = TUNES[t.sel], tune = this.state.preview.tune;
    tune[r.k] = clamp(Math.round((tune[r.k] + dir * .1) * 10) / 10, -1, 1);
    this.ctx.sfx('tick');
  }

  activate(): 'drive' | `quick:${string}` | void {
    const t = this.top(), k = this.kind(), ctx = this.ctx;
    if (k === 'cat') {
      const key = t.cat!, it = CATS[key].items[t.sel], c = this.cur();
      if (getV(c.cfg, key) === it.v) { ctx.toast('Already equipped'); return; }
      if (it.stage && it.stage > ctx.stage()) { ctx.toast('Unlocks at stage ' + it.stage + '. Win races for REP.', true); ctx.sfx('no'); return; }
      if (isOwned(c.cfg, c.owned, key, it.v)) { ctx.equip(key, it.v); ctx.toast('Equipped: ' + it.n); ctx.sfx('ok'); return; }
      const cash = ctx.money();
      if (cash < it.p) { ctx.toast('Need ' + money(it.p - cash) + ' more. Win races or outruns.', true); ctx.sfx('no'); return; }
      ctx.buy(key, it.v as PartValue, it.p); ctx.toast('Installed: ' + it.n); ctx.sfx('buy'); return;
    }
    if (k === 'dyno') { this.adjust(1); return; }
    if (k === 'cars') {
      const car = ctx.cars()[t.sel]; if (!car) return;
      if (car.id === ctx.car().id) { ctx.toast('Already your car'); return; }
      this.exit(); ctx.switchCar?.(car.id); ctx.toast('Switched to the ' + car.name); ctx.sfx('ok'); return;
    }
    if (k === 'options') {
      const o = OPTS[t.sel], vi = Math.max(0, o.vals.indexOf(this.opt(o.k))), v = o.vals[(vi + 1) % o.vals.length];
      this.opts[o.k] = v; ctx.setOpt?.(o.k, v); ctx.sfx('tick'); return;
    }
    if (k === 'quick') {
      const ev = EVENTS[t.sel];
      if (ev.stage > ctx.stage()) { ctx.toast('Unlocks at stage ' + ev.stage, true); ctx.sfx('no'); return; }
      this.exit(); return `quick:${ev.id}`;
    }
    const r = MENU[t.id!].items![t.sel];
    if (r.act === 'drive') { this.exit(); return 'drive'; }
    this.enter();
  }

  // ------------------------------------------------------------------------- stats
  private params(cfg: CarCfg, tune: Tune): Params {
    const spec = this.ctx.car().spec, key = spec.id + '|' + spec.name + '|' + JSON.stringify(cfg.perf) + JSON.stringify(tune);
    let e = this.pCache.find(p => p.key === key && p.P.spec === spec);
    if (!e) { e = { key, P: carParams(spec, cfg.perf as PerfCfg, tune) }; this.pCache.unshift(e); this.pCache.length = Math.min(this.pCache.length, 8); }
    return e.P;
  }
  currentParams(): Params { const c = this.cur(); return this.params(c.cfg, c.tune); }
  previewParams(): Params { const s = this.shown(); return this.params(s.cfg, s.tune); }
  private speedStr(kmh: number): string { return this.opt('units') === 'mph' ? Math.round(kmh * .6214) + ' mph' : Math.round(kmh) + ' km/h'; }
  statRows(P: Params): StatRow[] {
    const c = statsOf(P);
    const txt = [this.speedStr(c.top), (c.t100 ? c.t100.toFixed(1) : '--') + ' s 0-100', '', '', c.nos ? c.nos.toFixed(1) + ' s' : 'none'];
    return c.rows.map((r, i) => ({ ...r, txt: txt[i] }));
  }
  /** Night Tuner's renderStats as data: header, hp line, and per bar the 12 segments of now vs preview. */
  stats(): { title: string; changed: boolean; hp: number; hpRpm: number; mass: number; drive: string; bars: { n: string; txt: string; segs: ('on' | 'up' | 'down' | '')[] }[]; Pn: Params; Pp: Params } {
    const Pn = this.currentParams(), Pp = this.previewParams(), now = this.statRows(Pn), pv = this.statRows(Pp), s = statsOf(Pp).s;
    return {
      title: this.dynoPanel() ? 'Dyno' : 'Performance', changed: Pn !== Pp, hp: s.hp, hpRpm: s.hpRpm, mass: Math.round(Pp.mass), drive: Pp.drive, Pn, Pp,
      bars: now.map((b, i) => {
        const a = Math.round(b.v * 12), c = Math.round(pv[i].v * 12), segs: ('on' | 'up' | 'down' | '')[] = [];
        for (let q = 0; q < 12; q++) segs.push(q < Math.min(a, c) ? 'on' : q < c ? 'up' : q < a ? 'down' : '');
        return { n: b.n, txt: pv[i].txt, segs };
      }),
    };
  }
}

/** Night Tuner's dyno chart: now (faint) and preview curves, hp and Nm, redline mark. MiCar colours. */
export function drawDyno(c: HTMLCanvasElement, Pn: Params, Pp: Params): void {
  const d = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1), W = c.clientWidth || 264, H = 150;
  c.width = W * d; c.height = H * d;
  const g = c.getContext('2d'); if (!g) return;
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  const cn = dynoCurve(Pn), cp = dynoCurve(Pp);
  const maxR = Math.max(Pn.redline, Pp.redline) + 300, maxH = Math.max(...cn.map(p => p[2]), ...cp.map(p => p[2])) * 1.1, maxT = Math.max(...cn.map(p => p[1]), ...cp.map(p => p[1])) * 1.1;
  const X = (r: number) => 24 + (r - 800) / (maxR - 800) * (W - 30), YH = (h: number) => H - 18 - h / maxH * (H - 30), YT = (t: number) => H - 18 - t / maxT * (H - 30);
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
  for (let r = 1000; r < maxR; r += 1000) { g.beginPath(); g.moveTo(X(r), 8); g.lineTo(X(r), H - 18); g.stroke(); }
  g.fillStyle = '#8e9bb0'; g.font = '600 10px "Barlow Condensed",sans-serif'; g.textAlign = 'center';
  for (let r = 2000; r < maxR; r += 2000) g.fillText((r / 1000) + 'k', X(r), H - 6);
  const line = (cv: [number, number, number][], fn: (p: [number, number, number]) => number, col: string, w: number) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); cv.forEach((p, i) => { const y = fn(p); if (i) g.lineTo(X(p[0]), y); else g.moveTo(X(p[0]), y); }); g.stroke(); };
  const HP = '#ffd23f', NM = '#f3f6fb';
  line(cn, p => YH(p[2]), 'rgba(255,210,63,.4)', 1.5); line(cn, p => YT(p[1]), 'rgba(243,246,251,.3)', 1.5);
  line(cp, p => YH(p[2]), HP, 2.2); line(cp, p => YT(p[1]), NM, 2.2);
  g.textAlign = 'left'; g.fillStyle = HP; g.fillText('hp', 6, 14); g.fillStyle = NM; g.fillText('Nm', 6, 26);
  g.fillStyle = '#ff4d5e'; g.fillRect(X(Pp.redline), 8, 1.5, H - 26);
}
