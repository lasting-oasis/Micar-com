import { describe, expect, it } from 'vitest';
import { GarageModel, lenOf } from './garage';
import { ARCHETYPES, EVENTS, STOCK_CFG, TUNE_DEF, withV, okey, type CarCfg, type PartValue } from './data';
import type { Tune } from './physics';

// Array#at is ES2022 (the app targets ES2020); Node runs it, the brief's tests use it.
declare global { interface Array<T> { at(index: number): T | undefined } }

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** A GarageModel over an in-memory car, recording what it buys, tunes and toasts. */
function model({ money = 5000, stage = 1 }: { money?: number; stage?: number }) {
  let cash = money;
  const state = { cfg: clone(STOCK_CFG) as CarCfg, tune: clone(TUNE_DEF) as Tune, owned: [] as string[] };
  const bought: [string, unknown, number][] = [], tuned: Tune[] = [], toasts: { text: string; bad: boolean }[] = [];
  const car = () => ({ id: 'c1', spec: ARCHETYPES.sedan, state });
  const g = new GarageModel({
    money: () => cash, stage: () => stage, car,
    cars: () => [{ id: 'c1', name: 'Test car' }],
    buy: (key, v, price) => { bought.push([key, v, price]); cash -= price; state.owned.push(okey(key, v as PartValue)); state.cfg = withV(state.cfg, key, v as PartValue); },
    equip: (key, v) => { state.cfg = withV(state.cfg, key, v as PartValue); },
    tune: (t) => { tuned.push(clone(t)); state.tune = clone(t); },
    toast: (text, bad) => { toasts.push({ text, bad: !!bad }); },
    sfx: () => {},
  });
  /** Walk the menus by id: a row whose `to` or `cat` is the id, from the current menu. */
  const enterPath = (ids: string[]) => {
    for (const id of ids) {
      const i = g.rowIds().indexOf(id);
      if (i < 0) throw new Error('no row ' + id + ' in ' + g.title());
      g.select(i); g.activate();
    }
  };
  return Object.assign(g, { car, bought, tuned, toasts, enterPath });
}

describe('GarageModel', () => {
  it('buying a part you cannot afford refuses and changes nothing', () => { const g = model({ money: 100 }); g.enterPath(['visual', 'g_body', 'spoiler']); g.select(4); const before = JSON.stringify(g.car()); g.activate(); expect(g.toasts.at(-1)!.bad).toBe(true); expect(JSON.stringify(g.car())).toBe(before); expect(g.bought).toEqual([]); });
  it('buying a part you can afford calls buy with its price and equips it', () => { const g = model({ money: 10000 }); g.enterPath(['visual', 'g_body', 'spoiler']); g.select(1); g.activate(); expect(g.bought).toEqual([['spoiler', 1, 900]]); });
  it('a stage-locked performance tier refuses', () => { const g = model({ money: 1e6, stage: 1 }); g.enterPath(['perf', 'perf.turbo']); g.select(3); g.activate(); expect(g.bought).toEqual([]); expect(g.toasts.at(-1)!.text).toMatch(/stage 3/i); });
  it('dyno adjust moves a slider by 0.1 within -1..1 and saves on back', () => { const g = model({}); g.enterPath(['perf', 'dyno']); g.select(2); for (let i = 0; i < 30; i++) g.adjust(1); expect(g.previewTune().aero).toBe(1); g.back(); expect(g.tuned.at(-1)!.aero).toBe(1); });
  it('stat rows have five bars between 0 and 1', () => { const g = model({}); const rows = g.statRows(g.currentParams()); expect(rows.length).toBe(5); for (const r of rows) { expect(r.v).toBeGreaterThanOrEqual(0); expect(r.v).toBeLessThanOrEqual(1); } });
});

describe('event lengths before the circuit loads', () => {
  it('come from the index per event (a quarter-mile drag reads 402 m, not the lap)', () => {
    const ev = (id: string) => EVENTS.find(e => e.id === id)!;
    expect(Math.round(lenOf(ev('royal_drag')))).toBe(402);
    expect(Math.round(lenOf(ev('harbour_drift')))).toBe(899);
  });
});

describe('the Garage camera', () => {
  it('stands back further for a car longer than 4.9 m (a 6.1 m Tundra: 1.24x), as set for shorter ones', async () => {
    const { camFit } = await import('./GarageScene');
    expect(camFit(9.4)).toBe(1); expect(camFit(0)).toBe(1);
    expect(camFit(6.085 * 2)).toBeCloseTo(1.24, 2);
  });
});

describe('the Garage camera between cars', () => {
  it("keeps the player's zoom: scaled by the change in camFit when a longer car comes, unchanged for the same length", async () => {
    const { camFit, refitCam } = await import('./GarageScene');
    const tundra = 6.085 * 2, sedan = 9.4, zoomed = 11; // a player zoomed in on a sedan (camFit 1)
    const a = refitCam(zoomed, 1, tundra);
    expect(a.fitK).toBeCloseTo(camFit(tundra)); expect(a.r).toBeCloseTo(zoomed * camFit(tundra));
    expect(refitCam(a.r, a.fitK, tundra)).toEqual(a); // the same car rebuilt (a colour previewed): no change
    const b = refitCam(a.r, a.fitK, sedan); // back to the sedan: the player's own zoom again
    expect(b.r).toBeCloseTo(zoomed); expect(b.fitK).toBe(1);
  });
});

describe('the Options menu', () => {
  it('has a Car models row: Detailed by default, Simple after one press, which it hands to the options storage', () => {
    const set: [string, unknown][] = [];
    const g = model({});
    (g as unknown as { ctx: { setOpt: (k: string, v: unknown) => void } }).ctx.setOpt = (k, v) => { set.push([k, v]); };
    g.enterPath(['options']);
    const i = g.rowIds().indexOf('models');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(g.rows()[i].status).toEqual({ text: 'Detailed', tone: 'muted' });
    g.select(i); expect(g.desc()).toMatch(/built-in body/i);
    g.activate();
    expect(set).toEqual([['models', false]]);
    expect(g.rows()[i].status!.text).toBe('Simple');
  });
});

describe('the Car models row, following Graphics', () => {
  it('shows what the cars show (Simple on Low graphics until chosen) and a press records the opposite as the choice', () => {
    let stored: unknown = null; const set: [string, unknown][] = [];
    const g = model({});
    const ctx = (g as unknown as { ctx: { getOpt: (k: string) => unknown; setOpt: (k: string, v: unknown) => void } }).ctx;
    ctx.getOpt = (k) => k === 'models' ? (stored ?? false) : undefined; // Low graphics, no choice yet: Simple
    ctx.setOpt = (k, v) => { set.push([k, v]); if (k === 'models') stored = v; };
    g.enterPath(['options']);
    const i = g.rowIds().indexOf('models');
    expect(g.rows()[i].status!.text).toBe('Simple');
    g.select(i); expect(g.desc()).toMatch(/Graphics/);
    g.activate();
    expect(set).toEqual([['models', true]]); expect(g.rows()[i].status!.text).toBe('Detailed');
  });
});

