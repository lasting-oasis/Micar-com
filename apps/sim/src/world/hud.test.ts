import { describe, expect, it } from 'vitest';
import { Hud, gpsReached, fmtT, nearPolyline, type HudState } from './hud';
import { carParams, makeVehicle, resetVehicle } from './physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF } from './data';
import { makeAI } from './strip/ai';
import { buildRoute } from './strip/routes';
import { RaceTiming } from './strip/timing';
import type { ActiveEvent } from './strip/events';

/** `log`, when given, records every call (name and arguments) and every property set ('set:' + name, value), in order */
function stubCanvas(w = 1280, h = 720, top = 0, log?: unknown[][]) {
  const texts: string[] = [], ys: number[] = [], moves: [number, number][] = [];
  const ctx = new Proxy({ fillText: (t: string, _x?: number, y?: number) => { texts.push(t); ys.push(y ?? 0); }, translate: (x: number, y: number) => { moves.push([x, y]); log?.push(['translate', x, y]); }, createLinearGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, {
    get: (o, k: string) => k in o ? o[k] : (...a: unknown[]) => { log?.push([k, ...a]); }, set: (o, k: string, v) => { o[k] = v; log?.push(['set:' + k, v]); return true; },
  });
  const canvas = { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ top }) } as unknown as HTMLCanvasElement;
  return { canvas, texts, ys, moves };
}
const state = (o: Partial<HudState> = {}): HudState => {
  const PV = makeVehicle(carParams(ARCHETYPES.sports, STOCK_CFG.perf, TUNE_DEF)); resetVehicle(PV, 100, 100, 0); PV.u = 100 / 3.6;
  return { PV, event: null, standings: [], outrun: null, gps: null, roads: [], markers: [], ais: [], money: 12345, units: 'kmh', manual: true, small: false, touch: false, district: 'strip', ...o };
};

describe('Hud', () => {
  it('draws the speed, unit and gear, plus cash and the GPS label in the Strip', () => {
    const { canvas, texts } = stubCanvas(), hud = new Hud(canvas);
    const ev = EVENTS[0];
    hud.draw(state({ gps: { label: 'SPRINT: TEST', target: [300, 300], path: [[100, 100], [300, 300]] }, markers: [{ ev, x: 0, z: 0 }], ais: [makeAI({ x: 120, z: 100 })] }));
    expect(texts).toContain('100'); expect(texts).toContain('KM/H'); expect(texts).toContain('1'); expect(texts).toContain('$12,345');
    expect(texts.some(t => t.startsWith('SPRINT: TEST · '))).toBe(true);
    expect(canvas.width).toBeGreaterThan(0);
  });

  it('a lap race draws the tower and timer, not the cash', () => {
    const { canvas, texts } = stubCanvas(), hud = new Hud(canvas);
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const a = { type: 'circuit', state: 'race', route: r, racers: [], laps: 3, pLap: 1, pCp: 1, time: 50, pS: r.len * 1.5, pFt: null, lit: 0, timing: new RaceTiming(r.len, true) } as unknown as ActiveEvent;
    hud.draw(state({ event: a, standings: [{ name: 'Rico', key: 'r0', color: '#f00', s: 2000 }, { name: 'You', me: true, key: 'me', s: 1900, gap: 1.8 }] }));
    expect(texts).toContain('LEADER');
    expect(texts).toContain('LAP 2/3');
    expect(texts).not.toContain('$12,345');
  });

  it('on a landscape phone a lap race keeps the timer and the checkpoint label above the car and the dash, and the map above the NOS button', () => {
    // 844x390: the HUD canvas starts 64 px down the page; the car panel ends 100 px down the page (topInset 92)
    const { canvas, texts, ys, moves } = stubCanvas(844, 326, 64), hud = new Hud(canvas);
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const a = { type: 'circuit', state: 'race', route: r, racers: [], laps: 3, pLap: 1, pCp: 1, time: 50, pS: r.len * 1.5, pFt: null, lit: 0, timing: new RaceTiming(r.len, true) } as unknown as ActiveEvent;
    hud.draw(state({ small: true, touch: true, sticks: true, topInset: 92, event: a, standings: [{ name: 'Rico', key: 'r0', color: '#f00', s: 2000 }, { name: 'You', me: true, key: 'me', s: 1900, gap: 1.8 }] }));
    const y = (re: RegExp) => ys[texts.findIndex(t => re.test(t))], cue = /^(CHECKPOINT|FINISH LINE) · /;
    expect(y(/^LAST$/)).toBeLessThan(326 * .4); // the chase camera puts the car's roof about 38% down the canvas
    // the arrow's distance rides in the timer's first row (no CHECKPOINT label over the car)
    expect(y(/^\d[\d,.]* (ft|mi|m|km)$/)).toBeLessThan(326 * .3);
    expect(texts.some(t => cue.test(t))).toBe(false);
    expect(moves.some(([x, my]) => x > 844 - 100 && my < 60)).toBe(true); // the map, clear of NOS / DRIFT (94 px down)
  });

  it('a lap race draws its whole route north up in the map box: the start line, each racer in its colour, the player in yellow on top', () => {
    const log: unknown[][] = [];
    const { canvas } = stubCanvas(1280, 720, 0, log), hud = new Hud(canvas);
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const rico = Object.assign(makeAI({ kind: 'racer', x: 0, z: 200 }), { color: '#ff0000' }), gone = Object.assign(makeAI({ kind: 'racer', parked: true, x: -1e4, z: -1e4 }), { color: '#00ff00' });
    const a = { type: 'circuit', state: 'race', route: r, racers: [rico, gone], laps: 3, pLap: 1, pCp: 1, time: 50, pS: 600, pFt: null, lit: 0, timing: new RaceTiming(r.len, true) } as unknown as ActiveEvent;
    hud.draw(state({ event: a, ais: [rico, gone], standings: [{ name: 'Rico', key: 'r0', color: '#ff0000', s: 700 }, { name: 'You', me: true, key: 'me', s: 600, gap: 1.8 }] }));   // the player at (100, 100)
    const at = log.findIndex(c => c[0] === 'translate' && c[1] === 118 && c[2] === 602);   // the desktop map's place (raceLayout)
    expect(at).toBeGreaterThan(-1);
    const map = log.slice(at);
    expect(map.some(c => c[0] === 'rotate')).toBe(false);                                // north up: it does not turn with the car
    const pts = map.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo').map(c => [c[1], c[2]] as [number, number]);
    expect(pts.length).toBeGreaterThanOrEqual(5);
    for (const [x, y] of pts) { expect(Math.abs(x)).toBeLessThanOrEqual(84); expect(Math.abs(y)).toBeLessThanOrEqual(84); }
    expect(map.filter(c => c[0] === 'stroke').length).toBeGreaterThanOrEqual(3);          // the dark edge, the white line, the start line
    const dots: { x: number; y: number; fill: unknown }[] = []; let fill: unknown = '';
    for (const c of map) { if (c[0] === 'set:fillStyle') fill = c[1]; if (c[0] === 'arc') dots.push({ x: c[1] as number, y: c[2] as number, fill }); }
    expect(dots.map(d => d.fill)).not.toContain('#00ff00');                                // a parked racer is not drawn
    const me = dots[dots.length - 1], ri = dots.find(d => d.fill === '#ff0000')!;
    expect(me.fill).toBe('#ffd23f'); expect(ri).toBeDefined();
    expect(me.x).toBeGreaterThan(ri.x); expect(me.y).toBeLessThan(ri.y);                 // (100, 100) is east of and north of (0, 200)
  });

  it('keeps a car off the route on the map, at its edge', () => {
    const log: unknown[][] = [];
    const { canvas } = stubCanvas(1280, 720, 0, log), hud = new Hud(canvas);
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const a = { type: 'sprint', state: 'race', route: buildRoute([[0, 0], [0, 400], [300, 400]], false), racers: [], laps: 1, pLap: 0, pCp: 1, time: 5, pS: 50, pFt: null, lit: 0, timing: new RaceTiming(r.len, false) } as unknown as ActiveEvent;
    const s = state({ event: a, standings: [{ name: 'You', me: true, key: 'me', s: 50 }] }); s.PV.x = 5000; s.PV.z = -3000;
    hud.draw(s);
    const map = log.slice(log.findIndex(c => c[0] === 'translate' && c[1] === 118 && c[2] === 602));
    let fill: unknown = '', me: number[] | null = null;
    for (const c of map) { if (c[0] === 'set:fillStyle') fill = c[1]; if (c[0] === 'arc' && fill === '#ffd23f') me = [c[1] as number, c[2] as number]; }
    expect(me).not.toBeNull();                                                             // the player's yellow dot
    expect(Math.abs(me![0])).toBeLessThanOrEqual(84); expect(Math.abs(me![1])).toBeLessThanOrEqual(84);
    expect(me![0]).toBeGreaterThan(60); expect(me![1]).toBeLessThan(-60);                 // far east and north: the top right edge
  });

  it('drag, drift and free roam keep the radar, which turns with the car', () => {
    const turns = (o: Partial<HudState>) => { const log: unknown[][] = []; const { canvas } = stubCanvas(1280, 720, 0, log); new Hud(canvas).draw(state(o)); return log.some(c => c[0] === 'rotate'); };
    expect(turns({})).toBe(true);
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const drift = { type: 'drift', state: 'race', route: r, racers: [], laps: 2, pLap: 0, pCp: 1, time: 5, pS: 50, pFt: null, drift: { score: 0, cur: 0, mult: 1 } } as unknown as ActiveEvent;
    expect(turns({ event: drift, standings: [{ name: 'You', me: true, key: 'me', score: 0 }] })).toBe(true);
  });

  it('drops the GPS arrow label by topInset to clear the car panel', () => {
    const yOf = (topInset: number) => { const { canvas, texts, ys } = stubCanvas(); new Hud(canvas).draw(state({ small: true, touch: true, topInset, gps: { label: 'GAS', target: [300, 300], path: [] } })); return ys[texts.findIndex(t => t.startsWith('GAS · '))]; };
    expect(yOf(80) - yOf(0)).toBeGreaterThanOrEqual(80);
  });

  it('in the town draws the cluster only (no cash, no GPS), in mph when asked', () => {
    const { canvas, texts } = stubCanvas(), hud = new Hud(canvas);
    hud.draw(state({ district: 'town', units: 'mph', gps: { label: 'X', target: [300, 300], path: [] } }));
    expect(texts).toContain('62'); expect(texts).toContain('MPH');
    expect(texts.some(t => t.startsWith('$') || t.startsWith('X ·'))).toBe(false);
  });

  it('strokes each road on the minimap, closing loops', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k: string) => k in o ? o[k] : (k === 'closePath' || k === 'stroke' ? () => { calls.push(k); } : () => {}), set: (o, k: string, v) => { o[k] = v; return true; } });
    const canvas = { clientWidth: 1280, clientHeight: 720, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    new Hud(canvas).draw(state({ roads: [{ pts: [[0, 0], [100, 0], [100, 100]], loop: true, width: 12 }, { pts: [[0, 0], [50, 50]], loop: false, width: 12 }] }));
    expect(calls.filter(c => c === 'closePath').length).toBeGreaterThanOrEqual(1);
    expect(calls.filter(c => c === 'stroke').length).toBeGreaterThanOrEqual(2);
  });

  it('gpsReached and fmtT', () => {
    const s = state(); s.PV.x = 305; s.PV.z = 300;
    expect(gpsReached(s.PV, { label: '', target: [300, 300], path: [] })).toBe(true);
    expect(gpsReached(s.PV, { label: '', target: [400, 300], path: [] })).toBe(false);
    expect(fmtT(65.5)).toBe('1:05.50'); expect(fmtT(null)).toBe('--');
  });
});

describe('the minimap roads', () => {
  const rec = () => { const ops: string[] = []; const g = { moveTo: (x: number) => ops.push('M' + x), lineTo: (x: number) => ops.push('L' + x), closePath: () => ops.push('Z') } as unknown as CanvasRenderingContext2D; return { g, ops }; };
  const line: [number, number][] = [0, 100, 200, 2000, 3000, 3100].map(x => [x, 0]);
  it('skips segments with both ends far away and starts a new sub-path after the gap', () => {
    const { g, ops } = rec(); nearPolyline(g, line, false, 0, 0, 600);
    expect(ops).toEqual(['M0', 'L100', 'L200', 'L2000']);
    const b = rec(); nearPolyline(b.g, line, false, 3050, 0, 600);
    expect(b.ops).toEqual(['M2000', 'L3000', 'L3100']);
  });
  it('closes a loop that is all in range', () => {
    const { g, ops } = rec(); nearPolyline(g, [[0, 0], [10, 0], [10, 10]], true, 0, 0, 600);
    expect(ops).toEqual(['M0', 'L10', 'L10', 'Z']);
  });
});
