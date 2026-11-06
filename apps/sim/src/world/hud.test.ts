import { describe, expect, it } from 'vitest';
import { Hud, gpsReached, fmtT, type HudState } from './hud';
import { carParams, makeVehicle, resetVehicle } from './physics';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF } from './data';
import { makeAI } from './strip/ai';

function stubCanvas() {
  const texts: string[] = [];
  const ctx = new Proxy({ fillText: (t: string) => { texts.push(t); }, createLinearGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, {
    get: (o, k: string) => k in o ? o[k] : () => {}, set: (o, k: string, v) => { o[k] = v; return true; },
  });
  const canvas = { clientWidth: 1280, clientHeight: 720, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, texts };
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
