import { describe, expect, it } from 'vitest';
import { HUD_TXT, fitRoute, gapText, raceLayout, raceView, towerRows, type Box } from './raceHud';
import type { HudState } from './hud';
import { carParams, makeVehicle } from './physics';
import { ARCHETYPES, STOCK_CFG, TUNE_DEF } from './data';
import { buildRoute } from './strip/routes';
import { RaceTiming } from './strip/timing';
import type { ActiveEvent, Standing } from './strip/events';

const route = (loop = true) => buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], loop);
const event = (o: Partial<ActiveEvent> = {}): ActiveEvent => {
  const r = o.route ?? route();
  return { type: 'circuit', state: 'race', route: r, laps: 3, pLap: 1, pCp: 1, time: 50, pS: r.len * 1.5, pFt: null, lit: 0, timing: new RaceTiming(r.len, r.loop), ...o } as unknown as ActiveEvent;
};
const state = (a: ActiveEvent | null, standings: Standing[], o: Partial<HudState> = {}): HudState => ({
  PV: makeVehicle(carParams(ARCHETYPES.sedan, STOCK_CFG.perf, TUNE_DEF)), event: a, standings, outrun: null, gps: null, roads: [], markers: [], ais: [],
  money: 0, units: 'kmh', manual: false, small: false, touch: false, district: 'strip', ...o,
});
const field: Standing[] = [
  { name: 'Rico', key: 'r0', color: '#ff0000', s: 2000, gap: null },
  { name: 'You', me: true, key: 'me', s: 1900, gap: 1.84 },
  { name: 'Nadia', key: 'r1', color: '#00ff00', s: 1800, gap: 4.1 },
];

describe('race HUD view', () => {
  it('orders the tower and marks the player', () => {
    const v = raceView(state(event(), field))!;
    expect(v.rows.map(r => r.pos)).toEqual([1, 2, 3]);
    expect(v.rows[1]).toMatchObject({ me: true, name: 'YOU', gap: '+1.8' });
    expect(v.rows[0].color).toBe('#ff0000');
  });

  it('formats gaps', () => {
    const en = HUD_TXT.en;
    expect(gapText(null, 0, en)).toBe('');
    expect(gapText(0, 0, en)).toBe('');
    expect(gapText(1.234, 0, en)).toBe('+1.2');
    expect(gapText(NaN, 0, en)).toBe('');
    expect(gapText(Infinity, 0, en)).toBe('');
    expect(gapText(5, 1, en)).toBe('+1 LAP');
    expect(gapText(5, 2, en)).toBe('+2 LAPS');
    expect(gapText(5, 2, HUD_TXT.es)).toBe('+2 VUELTAS');
  });

  it('the leader reads LEADER, in Spanish LÍDER', () => {
    expect(raceView(state(event(), field))!.rows[0].gap).toBe('LEADER');
    expect(raceView(state(event(), field, { lang: 'es' }))!.rows[0].gap).toBe('LÍDER');
  });

  it('the title is LAP 2/3, VUELTA 2/3 in Spanish, SPRINT for a sprint', () => {
    expect(raceView(state(event(), field))!.title).toBe('LAP 2/3');
    expect(raceView(state(event(), field, { lang: 'es' }))!.title).toBe('VUELTA 2/3');
    expect(raceView(state(event({ type: 'sprint', route: route(false) }), field))!.title).toBe('SPRINT');
  });

  it('counting shows the lights and no lap time', () => {
    const v = raceView(state(event({ state: 'count', lit: 3 }), field))!;
    expect(v.counting).toBe(true);
    expect(v.lit).toBe(3);
    expect(v.lapTime).toBe('');
  });

  it('not a lap race: no view', () => {
    expect(raceView(state(event({ type: 'drag' }), field))).toBeNull();
    expect(raceView(state(event({ type: 'drift' }), field))).toBeNull();
    expect(raceView(state(null, []))).toBeNull();
    expect(raceView(state(event(), field, { district: 'town' }))).toBeNull();
  });

});

describe('race HUD layout on a phone', () => {
  type L = ReturnType<typeof raceLayout>;
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // what is on screen besides the race HUD: the car panel (a 160 px pill at the top centre) and the touch controls
  // (each a 168 px column at a bottom corner, starting at leftTop / rightTop)
  const clashes = (l: L, W: number, H: number, panelB: number, leftTop: number, rightTop: number, counting = false) => {
    const cue: Box = { x: l.arrow.x - 72, y: l.arrow.y - 16, w: 144, h: l.arrow.ly + 4 - (l.arrow.y - 16) };
    const parts: [string, Box][] = [[counting ? 'lights' : 'timer', counting ? l.lights : l.timer], ['dash', l.dash]];
    if (l.tower) parts.unshift(['tower', l.tower]);
    if (!counting && !l.cueIn) parts.push(['arrow', cue]); // on a phone the arrow rides in the timer's first row
    if (l.map) parts.push(['map', { x: l.map.cx - l.map.r, y: l.map.cy - l.map.r, w: l.map.r * 2, h: l.map.r * 2 }]);
    const fixed: [string, Box][] = [['car panel', { x: W / 2 - 80, y: 0, w: 160, h: panelB }],
      ['left controls', { x: 0, y: leftTop, w: 168, h: H - leftTop }], ['right controls', { x: W - 168, y: rightTop, w: 168, h: H - rightTop }]];
    const out: string[] = [];
    parts.forEach(([n, b], i) => {
      parts.slice(i + 1).forEach(([m, c]) => { if (hit(b, c)) out.push(n + ' / ' + m); });
      fixed.forEach(([m, c]) => { if (hit(b, c)) out.push(n + ' / ' + m); });
      if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) out.push(n + ' off screen');
    });
    return out;
  };
  // 844x390 landscape with the touch sticks: the HUD canvas starts 64 px down the page, so it is 326 px tall; the car
  // panel's bottom edge is 36 px down it; the steering stick starts at 162, the NOS / DRIFT buttons at 94
  const land = { W: 844, H: 326, insT: 0, insB: 0, inset: 36, small: true, rows: 4, laps: true, cx: 422, cy: 248, leftTop: 162, rightTop: 94 };

  it('in landscape nothing overlaps, the timer sits under the car panel in the top 40%, and the map fits at the top right', () => {
    const l = raceLayout(land);
    expect(clashes(l, 844, 326, 36, 162, 94)).toEqual([]);
    expect(clashes(l, 844, 326, 36, 162, 94, true)).toEqual([]);
    expect(l.timer.y).toBeGreaterThanOrEqual(36);
    expect(l.timer.y + l.timer.h).toBeLessThanOrEqual(326 * .4); // the chase camera keeps the car in the lower half
    expect(l.map).not.toBeNull();
    expect(l.map!.cx).toBeGreaterThan(844 / 2);
    // the checkpoint arrow and its distance ride in the timer's first row, left of the lap time, not down over the car
    expect(l.cueIn).toBe(true);
    expect(l.arrow.x - 11).toBeGreaterThanOrEqual(l.timer.x);
    expect(l.arrow.y - 16).toBeGreaterThanOrEqual(l.timer.y);
    expect(l.arrow.y + 10).toBeLessThanOrEqual(l.timer.y + 32);
  });

  it('in landscape with the gear buttons the tower rows shrink to clear them', () => {
    const l = raceLayout({ ...land, leftTop: 102 });
    expect(clashes(l, 844, 326, 36, 102, 94)).toEqual([]);
    expect(l.rowH).toBeGreaterThanOrEqual(14);
  });

  it('on a small landscape phone (667x375) nothing overlaps', () => {
    const l = raceLayout({ ...land, W: 667, H: 311, cx: 333.5, cy: 233, leftTop: 147, rightTop: 79 });
    expect(clashes(l, 667, 311, 36, 147, 79)).toEqual([]);
    expect(clashes(l, 667, 311, 36, 147, 79, true)).toEqual([]);
    expect(l.cueIn).toBe(true);
  });

  it('in portrait (390x844) the tower and the timer share the row under the car panel and the map sits under the timer', () => {
    const port = { ...land, W: 390, H: 780, cx: 72, cy: 540, leftTop: 616, rightTop: 548 };
    const l = raceLayout(port);
    expect(clashes(l, 390, 780, 36, 616, 548)).toEqual([]);
    expect(clashes(l, 390, 780, 36, 616, 548, true)).toEqual([]);
    expect(l.tower!.y).toBeGreaterThanOrEqual(36);
    expect(l.map).not.toBeNull();
    expect(l.map!.cy - l.map!.r).toBeGreaterThanOrEqual(l.timer.y + l.timer.h);
  });

  it('on a desktop the panels keep their corners', () => {
    const l = raceLayout({ W: 1440, H: 836, insT: 0, insB: 0, inset: 36, small: false, rows: 4, laps: true, cx: 720, cy: 756, leftTop: 836, rightTop: 836 });
    expect(l.tower).toMatchObject({ x: 34, y: 24, w: 270 });
    expect(l.timer).toMatchObject({ x: 1440 - 34 - 230, y: 24, w: 230, h: 100 });
    expect(l.map).toEqual({ cx: 118, cy: 836 - 118, r: 84 });
    expect(l.cueIn).toBe(false); // a desktop has room for the arrow and its label under the car panel
    expect(clashes(l, 1440, 836, 36, 836, 836)).toEqual([]);
  });
});

describe('race HUD layout across real phones', () => {
  // What hud.ts gives raceLayout on a phone, from the page size: the HUD canvas starts 64 px down the page; the car
  // panel is at the top centre (a 120 px fuel pill whose bottom is 36 px down the canvas, or the open 256 px card, 80);
  // the touch controls are 168 px columns at the bottom corners (sticks 140 px with NOS / DRIFT or the gear taps above
  // them, or the old buttons); the dash sits where hud.ts puts the dial.
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const setup = (pageW: number, pageH: number, sticks: boolean, gears: boolean, open: boolean) => {
    const W = pageW, H = pageH - 64, ctlL = sticks ? 164 + (gears ? 60 : 0) : 92, ctlR = sticks ? 232 : gears ? 248 : 170;
    const between = sticks && W >= 560, R = 56;
    const cx = between ? W / 2 : R + 16, cy = H - R - (between ? 22 : sticks ? (gears ? 248 : 184) : 108);
    const pw = open ? 256 : 120, inset = open ? 80 : 36;
    const input = { W, H, insT: 0, insB: 0, inset, small: true, rows: 4, laps: true, cx, cy, leftTop: H - ctlL, rightTop: H - ctlR,
      colL: 168, colR: 168, panelL: W / 2 - pw / 2, panelR: W / 2 + pw / 2 };
    const fixed: [string, Box][] = [['car panel', { x: W / 2 - pw / 2, y: 0, w: pw, h: inset }],
      ['left controls', { x: 0, y: H - ctlL, w: 168, h: ctlL }], ['right controls', { x: W - 168, y: H - ctlR, w: 168, h: ctlR }]];
    return { W, H, input, fixed };
  };
  const clashes = (W: number, H: number, l: ReturnType<typeof raceLayout>, fixed: [string, Box][], counting: boolean) => {
    const parts: [string, Box][] = [['dash', l.dash], [counting ? 'lights' : 'timer', counting ? l.lights : l.timer]];
    if (l.tower) parts.push(['tower', l.tower]);
    if (l.map) parts.push(['map', { x: l.map.cx - l.map.r, y: l.map.cy - l.map.r, w: l.map.r * 2, h: l.map.r * 2 }]);
    const out: string[] = [];
    parts.forEach(([n, b], i) => {
      parts.slice(i + 1).forEach(([m, c]) => { if (hit(b, c)) out.push(n + ' / ' + m); });
      fixed.forEach(([m, c]) => { if (hit(b, c)) out.push(n + ' / ' + m); });
      if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) out.push(n + ' off screen');
    });
    return out;
  };
  const LAND: [number, number][] = [[667, 375], [720, 360], [740, 360], [812, 375], [844, 340], [844, 390], [896, 414], [932, 430]];
  const PORT: [number, number][] = [[340, 700], [360, 740], [375, 667], [390, 844], [412, 915], [430, 932]];
  for (const [w, h] of [...LAND, ...PORT]) for (const sticks of [true, false]) for (const gears of [false, true]) for (const open of [false, true]) {
    it(`${w}x${h} ${sticks ? 'sticks' : 'buttons'}${gears ? ' + gears' : ''}${open ? ', open car card' : ''}: nothing overlaps, the tower keeps the leader and the player`, () => {
      const { W, H, input, fixed } = setup(w, h, sticks, gears, open);
      const l = raceLayout(input);
      expect(clashes(W, H, l, fixed, false)).toEqual([]);
      expect(clashes(W, H, l, fixed, true)).toEqual([]);
      expect(l.tower).not.toBeNull();
      expect(l.rowsShown).toBeGreaterThanOrEqual(2);
      expect(l.rowH).toBeGreaterThanOrEqual(14);
      expect(l.dash.w).toBeGreaterThanOrEqual(170);
    });
  }
  it('rows that do not fit leave the top ones and the player', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(pos => ({ pos, me: pos === 6 }));
    expect(towerRows(rows, 3).map(r => r.pos)).toEqual([1, 2, 6]);
    expect(towerRows(rows.map(r => ({ ...r, me: r.pos === 2 })), 3).map(r => r.pos)).toEqual([1, 2, 3]);
    expect(towerRows(rows, 9).length).toBe(6);
  });
});

describe('the race map: the route fitted to its box', () => {
  const X = (f: { s: number; ox: number }, x: number) => f.ox + f.s * x, Y = (f: { s: number; oz: number }, z: number) => f.oz + f.s * z;
  it('keeps the shape of the route, centres it, and keeps every point inside the box less its padding', () => {
    const pts: [number, number][] = [[100, 50], [300, 50], [300, 150], [100, 150], [180, 90]];
    const f = fitRoute(pts, 500, 400, 168, 168, 8);
    expect(f.s).toBeCloseTo(152 / 200);                                                    // bound by its width
    expect((X(f, 100) + X(f, 300)) / 2).toBeCloseTo(500); expect((Y(f, 50) + Y(f, 150)) / 2).toBeCloseTo(400);
    expect((X(f, 300) - X(f, 100)) / (Y(f, 150) - Y(f, 50))).toBeCloseTo(2);               // the aspect kept
    for (const [x, z] of pts) {
      expect(Math.abs(X(f, x) - 500)).toBeLessThanOrEqual(76 + 1e-9); expect(Math.abs(Y(f, z) - 400)).toBeLessThanOrEqual(76 + 1e-9);
    }
  });
  it('fits a tall route by its height, north up: x across the screen, z down it', () => {
    const f = fitRoute([[0, 0], [10, 0], [10, 400], [0, 400]], 0, 0, 200, 100, 0);
    expect(f.s).toBeCloseTo(100 / 400);
    expect(Y(f, 400)).toBeGreaterThan(Y(f, 0)); expect(X(f, 10)).toBeGreaterThan(X(f, 0));
  });
  it('gives a point or a straight line a finite scale, in the middle of the box', () => {
    const one = fitRoute([[5, 5]], 50, 60, 100, 100, 4);
    expect(Number.isFinite(one.s)).toBe(true); expect(X(one, 5)).toBeCloseTo(50); expect(Y(one, 5)).toBeCloseTo(60);
    const line = fitRoute([[0, 0], [0, 300]], 0, 0, 100, 100, 0);
    expect(line.s).toBeCloseTo(100 / 300); expect(X(line, 0)).toBeCloseTo(0); expect(Y(line, 150)).toBeCloseTo(0);
  });
});
