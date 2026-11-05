import { describe, expect, it } from 'vitest';
import { applyPayout, validateFinish, validateOutrun, OUTRUN_MIN_MS, outrunEvent, clampTune, partPrice, ensureStrip } from './payout';
import { EVENTS, freshStrip, carState, withV } from './data';
import type { Player } from '../types';

const finish = (eventId: string, pos: number, time: number | null, failed = false) => ({ eventId, pos, time, score: 0, failed });
const player = (over: Partial<Player> = {}): Player => ({
  id: 'p1', name: 'Tester', money: 0, inventory: [], lotPosition: { x: 0, z: 0 }, partsInventory: {}, lotScale: 'Small', marketingTier: 'Craigslist',
  floorPlanDebt: 0, floorPlanRate: 0.005, contracts: [], customers: [], employees: { mechanic: false, salesperson: false, financeManager: false }, reputation: 50,
  balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 },
  strip: freshStrip(), octane: 0, stamps: [], ...over,
});

describe('validateFinish', () => {
  it('refuses a finish without a live entry or with the wrong event', () => { expect(validateFinish(undefined, finish('sp1', 1, 60), 0).ok).toBe(false); expect(validateFinish({ eventId: 'ci1', startedAt: 0 }, finish('sp1', 1, 60), 1000).ok).toBe(false); });
  it('refuses an impossible time and a stale entry', () => { expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 1, 2), 5000).ok).toBe(false); expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 1, 60), 21 * 60 * 1000).ok).toBe(false); });
  it('accepts a plausible finish', () => { expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 2, 70), 80000)).toEqual({ ok: true, pos: 2 }); });
  it('refuses a position outside 1-4 and a missing time on a finished run', () => {
    expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 0, 70), 80000).ok).toBe(false);
    expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 5, 70), 80000).ok).toBe(false);
    expect(validateFinish({ eventId: 'sp1', startedAt: 0 }, finish('sp1', 1, null), 80000).ok).toBe(false);
  });
  it('accepts a failed run with no time (it pays nothing)', () => { expect(validateFinish({ eventId: 'df1', startedAt: 0 }, finish('df1', 1, null, true), 30000)).toEqual({ ok: true, pos: 1 }); });
  it('counts every lap of a circuit in the time floor', () => { expect(validateFinish({ eventId: 'ci1', startedAt: 0 }, finish('ci1', 1, 12), 600000).ok).toBe(false); });
});

describe('applyPayout', () => {
  it('pays a first win with cash, octane, rep and the first-win stamp', () => { const p = player(); const r = applyPayout(p, EVENTS[0], 1, false); expect(r.cash).toBe(1500); expect(p.money).toBe(1500); expect(p.octane).toBe(38); expect(p.strip!.rep).toBe(150); expect(p.stamps).toContain('strip:first-win'); expect(applyPayout(p, EVENTS[0], 1, false).stamps).not.toContain('strip:first-win'); });
  it('a failed run pays nothing', () => { const p = player(); applyPayout(p, EVENTS[3], 1, true); expect(p.money).toBe(0); expect(p.octane).toBe(0); });
  it('stamps a drag and a drift win, deduplicated', () => {
    const p = player(); const drag = EVENTS.find(e => e.type === 'drag')!, drift = EVENTS.find(e => e.type === 'drift')!;
    expect(applyPayout(p, drag, 1, false).stamps).toEqual(['strip:first-win', 'strip:drag']);
    expect(applyPayout(p, drift, 1, false).stamps).toEqual(['strip:drift']);
    applyPayout(p, drag, 1, false);
    expect(p.stamps.filter(s => s === 'strip:drag')).toHaveLength(1);
  });
  it('counts wins and keeps the best (lowest) time', () => {
    const p = player();
    applyPayout(p, EVENTS[0], 1, false, { time: 80 }); applyPayout(p, EVENTS[0], 2, false, { time: 70 }); applyPayout(p, EVENTS[0], 1, false, { time: 90 });
    expect(p.strip!.wins.sp1).toBe(2); expect(p.strip!.best.sp1).toBe(70);
  });
  it('adds the style bonus from the stored car on a win', () => {
    const p = player(); const c = carState(p.strip!, 'car1'); c.cfg = withV(withV(c.cfg, 'spoiler', 4), 'finish', 'candy');
    const r = applyPayout(p, EVENTS[0], 1, false, { carId: 'car1' });
    expect(r.cash).toBeGreaterThan(1500); expect(p.money).toBe(r.cash);
  });
  it('a stage-2 player is paid the stage multiplier', () => { const p = player({ strip: { ...freshStrip(), rep: 400 } }); expect(applyPayout(p, EVENTS[0], 1, false).cash).toBe(1875); });
  it('an outrun win pays 800 + 250 per stage above 1, rep 60, and the outrun stamp', () => {
    const p = player({ strip: { ...freshStrip(), rep: 1100 } }); const r = applyPayout(p, outrunEvent(3), 1, false);
    expect(r).toEqual({ cash: 1300, octane: 15, rep: 60, stamps: ['strip:first-win', 'strip:outrun'] });
    expect(p.money).toBe(1300);
  });
  it('a lost outrun pays nothing', () => { const p = player(); expect(applyPayout(p, outrunEvent(1), 2, true)).toEqual({ cash: 0, octane: 0, rep: 0, stamps: [] }); expect(p.money).toBe(0); });
});

describe('validateOutrun', () => {
  it('refuses outside the Strip and during a live event', () => { expect(validateOutrun(undefined, 1e6, false).ok).toBe(false); expect(validateOutrun(0, 1e6, true).ok).toBe(false); });
  it('a second outrun inside the window is refused and pays nothing; one after the window pays once', () => {
    const p = player(); let last = 0; const pay = (now: number) => { const v = validateOutrun(last, now, false); if (!v.ok) return null; last = now; return applyPayout(p, outrunEvent(1), 1, false); };
    expect(pay(OUTRUN_MIN_MS - 1)).toBeNull(); // the first one also needs time after entering
    expect(pay(OUTRUN_MIN_MS)!.cash).toBe(800);
    expect(pay(OUTRUN_MIN_MS + 5000)).toBeNull(); expect(p.money).toBe(800);
    expect(pay(2 * OUTRUN_MIN_MS)!.cash).toBe(800); expect(p.money).toBe(1600);
  });
});

describe('quit_event', () => {
  // the server's entry bookkeeping: enter sets it, quit_event deletes it on a matching id, finish needs it
  const server = () => { let entry: { eventId: string; startedAt: number } | undefined; let last: number | undefined = 0; const p = player();
    return { p, enter: (id: string, now: number) => { entry = { eventId: id, startedAt: now }; }, quit: (id: string) => { if (entry && entry.eventId === id) entry = undefined; },
      finish: (now: number) => { const v = validateFinish(entry, finish('dr1', 1, 12), now); entry = undefined; return v.ok ? applyPayout(p, EVENTS[3], v.pos, false) : null; },
      outrun: (now: number) => { const v = validateOutrun(last, now, !!entry); if (!v.ok) return null; last = now; return applyPayout(p, outrunEvent(1), 1, false); } }; };
  it('enter, quit, then an outrun after the window pays', () => { const s = server(); s.enter('dr1', 1000); expect(s.outrun(OUTRUN_MIN_MS)).toBeNull(); s.quit('dr1'); expect(s.outrun(OUTRUN_MIN_MS + 1000)!.cash).toBe(800); });
  it('enter, quit, then a finish is refused', () => { const s = server(); s.enter('dr1', 0); s.quit('dr1'); expect(s.finish(60000)).toBeNull(); expect(s.p.money).toBe(0); });
  it('a quit for another event leaves the entry', () => { const s = server(); s.enter('dr1', 0); s.quit('sp1'); expect(s.finish(60000)!.cash).toBe(1800); });
});

describe('parts and tunes', () => {
  it('prices a part from the catalog and refuses one above the stage', () => {
    expect(partPrice('spoiler', 1, 1)).toEqual({ ok: true, price: 900 });
    expect(partPrice('perf.engine', 2, 1).ok).toBe(false);
    expect(partPrice('perf.engine', 2, 2)).toEqual({ ok: true, price: 4800 });
    expect(partPrice('spoiler', 9, 1).ok).toBe(false);
    expect(partPrice('nope', 1, 1).ok).toBe(false);
  });
  it('clamps tune sliders to -1..1 in 0.1 steps and fills missing ones', () => {
    const t = clampTune({ turbo: 3, nitrous: -0.26, aero: 'x', bias: 0.44 });
    expect(t).toEqual({ turbo: 1, nitrous: -0.3, aero: 0, bias: 0.4, ride: 0, stiff: 0, steer: 0, gears: 0 });
  });
  it('defaults a saved player that predates the Strip', () => {
    const p = player(); delete (p as Partial<Player>).strip; (p as { octane?: number }).octane = undefined as never; (p as { stamps?: string[] }).stamps = undefined as never;
    ensureStrip(p); expect(p.strip).toEqual(freshStrip()); expect(p.octane).toBe(0); expect(p.stamps).toEqual([]);
  });
});
