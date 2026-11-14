// Patches instead of full copies (docs/superpowers/specs/2026-11-14-world-data-diet-design.md): what each player may see,
// what changed for it since it was last sent, and how the page applies a patch.
import { describe, expect, it } from 'vitest';
import type { Car, GameState, Player } from '../types';
import { StateSync, applyPatch, othersView, viewFor, type StatePatch, type ViewState } from './stateSync';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const car = (id: string, extra: Partial<Car> = {}): Car => ({ id, make: 'Toyota', model: 'Camry', year: 2019, bodyStyle: 'sedan', condition: 90, mileage: 40000, buyPrice: 9000, recon: 700, color: 'Silver', ownerId: null, daysOnLot: 0, titleStatus: 'Clean', activeRepairs: [], ...extra } as unknown as Car);
const player = (id: string, extra: Partial<Player> = {}): Player => ({
  id, name: 'P ' + id, money: 1000, inventory: [], lotPosition: { x: 0, z: 0 }, lotScale: 'Small', marketingTier: 'Craigslist', floorPlanDebt: 50, floorPlanRate: 0.005,
  contracts: [{ id: 'c' }], customers: [{ id: 'k' }], employees: { mechanic: false, salesperson: false, financeManager: false }, partsInventory: {}, reputation: 0,
  balanceSheet: { totalIncome: 5, totalExpenses: 6, lastTickIncome: 7, lastTickExpense: 8 }, gateCode: '1234', shareHoldings: { x: 2 }, insurance: { liability: false, inventory: false, gap: false },
  insuranceLog: [], orders: [{ id: 'o1' }], accountId: 'acct-' + id, tester: true, strip: { rep: 0, cars: {} }, octane: 0, stamps: [], isStandaloneOperator: false, ...extra,
} as unknown as Player);
const world = (players: Player[]): GameState => ({
  day: 1, timeOfDay: 8, players: Object.fromEntries(players.map(p => [p.id, p])), accounts: { a: { id: 'a' } } as any, market: [car('m1')], junkyard: [car('j1')],
  economy: { federalInterestRate: 0.05, usedCarDemand: 1, inflation: 0.025, primeRate: 0.08, priceIndex: 1, rateHistory: [] } as any,
  activeWalkIns: {}, fractionalMarket: [], chatLog: [{ id: 'm', playerId: '', name: 'System', text: 'hi', ts: 1 }] as any, hostId: null,
});
const numbers = new Map<string, number>();
const nOf = (id: string) => { if (!numbers.has(id)) numbers.set(id, numbers.size + 1); return numbers.get(id); };

/** Today's broadcastState (server.ts before the data diet), for one recipient: the reference the views must match. */
function todaysUpdate(state: GameState, id: string) {
  const players: Record<string, any> = {};
  for (const pid in state.players) {
    const p = state.players[pid] as any;
    if (pid === id) players[pid] = p;
    else players[pid] = { ...p, money: 0, contracts: [], customers: [], balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 }, floorPlanDebt: 0,
      gateCode: undefined, shareHoldings: {}, accountId: undefined, tester: undefined, orders: [], inventory: p.inventory ? p.inventory.map((c: any) => ({ ...c, buyPrice: 0, recon: 0 })) : [] };
  }
  const myWalkIns = state.activeWalkIns?.[id];
  const { chatLog: _c, accounts: _a, ...shared } = state as any;
  return { ...shared, players, activeWalkIns: myWalkIns ? { [id]: myWalkIns } : {} };
}
/** The view as today's update had it: without the short numbers. */
const withoutN = (v: ViewState) => { const c = clone(v); for (const p of Object.values(c.players)) delete (p as any).n; return c; };
/** What a page needs from the server of a view: everything but the three things pages report about themselves (a
 *  player's position, and each car's fuel and town spot). Written out here, apart from the module's steadyPart. */
const used = (v: ViewState) => {
  const c = clone(v);
  for (const p of Object.values(c.players) as any[]) {
    delete p.worldPosition;
    for (const car of p.inventory ?? []) if (car && typeof car === 'object') { delete car.fuel; delete car.lotPosition; }
  }
  return c;
};

describe('views', () => {
  it("is today's update for every recipient, plus each player's short number", () => {
    const s = world([player('d1', { inventory: [car('c1')] }), player('g1', { guest: true } as any)]);
    s.activeWalkIns = { d1: [{ id: 'w' }] as any, g1: [{ id: 'v' }] as any };
    for (const id of ['d1', 'g1']) {
      expect(withoutN(viewFor(s, id, nOf))).toEqual(clone(todaysUpdate(s, id)));
      expect(viewFor(s, id, nOf).players[id].n).toBe(nOf(id));
    }
  });

  it("hides another player's private fields", () => {
    const v = clone(othersView(player('d1', { inventory: [car('c1')] }), 3));
    expect(v).toMatchObject({ n: 3, money: 0, contracts: [], customers: [], orders: [], shareHoldings: {}, floorPlanDebt: 0 });
    expect(v.gateCode).toBeUndefined(); expect(v.accountId).toBeUndefined(); expect(v.tester).toBeUndefined();
    expect(v.inventory[0]).toMatchObject({ id: 'c1', buyPrice: 0, recon: 0 });
  });
});

describe('patches', () => {
  it('a page that applies every patch ends where a fresh copy starts, through 400 random changes', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const viewers = ['v1', 'v2', 'v3'];
    const s = world(viewers.map(id => player(id)));
    const sync = new StateSync(nOf);
    sync.refresh(s);
    const replica: Record<string, ViewState> = Object.fromEntries(viewers.map(v => [v, clone(sync.full(v))]));
    let made = 0;
    for (let step = 0; step < 400; step++) {
      const ids = Object.keys(s.players), someone = s.players[pick(ids)];
      switch (Math.floor(rand() * 15)) {
        case 12: someone.worldPosition = { x: step, y: 0, z: -step, rotation: 0, district: 'town' }; break; // drifts
        case 13: if (someone.inventory.length) someone.inventory[0].fuel = 100 - (step % 100); break; // drifts
        case 14: if (someone.inventory.length) someone.inventory[0].lotPosition = { x: step, z: step } as any; break; // drifts
        case 0: { const id = 'p' + made++; s.players[id] = player(id); break; } // a join
        case 1: { const id = pick(ids.filter(i => !viewers.includes(i))); if (id) delete s.players[id]; break; } // a departure
        case 2: someone.money += 10; break;
        case 3: someone.inventory.push(car('c' + step, { recon: step })); break;
        case 4: (someone as any).strip = { rep: step, cars: { x: { cfg: step } } }; break;
        case 5: s.market.push(car('m' + step)); break;
        case 6: s.market.splice(0, 1); break;
        case 7: s.economy.inflation = (s.economy.inflation ?? 0) + 0.001; s.day++; break;
        case 8: s.timeOfDay += 1 / 30; break;
        case 9: s.activeWalkIns[pick(ids)] = rand() < 0.5 ? [{ id: 'w' + step }] as any : []; break;
        case 10: s.hostId = rand() < 0.5 ? pick(ids) : null; break;
        case 11: if ('junkyard' in s) delete (s as any).junkyard; else (s as any).junkyard = [car('j' + step)]; break;
      }
      sync.refresh(s);
      for (const v of viewers) {
        const patch = sync.patch(v, rand() < 0.2);
        if (patch) replica[v] = applyPatch(replica[v], clone(patch));
        expect(used(replica[v])).toEqual(used(viewFor(s, v, nOf)));
      }
    }
  });

  it('makes no patch for what a page reports itself, and sends it current when the record goes', () => {
    const s = world([player('a'), player('b', { inventory: [car('cb', { fuel: 100 } as any)] })]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a'); sync.full('b');
    // b drives: its position, its car's fuel and town spot change, as b's page reports them
    s.players.b.worldPosition = { x: 10, y: 0, z: 20, rotation: 1, district: 'town' };
    s.players.b.inventory[0].fuel = 73;
    s.players.b.inventory[0].lotPosition = { x: 5, z: 6 } as any;
    sync.refresh(s);
    expect(sync.patch('a', false)).toBeNull(); // nothing a needs
    expect(sync.patch('b', false)).toBeNull(); // nothing b's page does not already have
    // b acts: its page gets its record back, current
    expect(clone(sync.patch('b', true)!).players!.b.inventory[0]).toMatchObject({ fuel: 73, lotPosition: { x: 5, z: 6 } });
    // something else of b changes: a gets b's record whole and current
    s.players.b.name = 'Renamed';
    sync.refresh(s);
    const seen = clone(sync.patch('a', false)!).players!.b;
    expect(seen.name).toBe('Renamed');
    expect(seen.worldPosition).toEqual({ x: 10, y: 0, z: 20, rotation: 1, district: 'town' });
    expect(seen.inventory[0]).toMatchObject({ fuel: 73, lotPosition: { x: 5, z: 6 }, buyPrice: 0, recon: 0 });
    expect(clone(sync.patch('b', false)!).players!.b.inventory[0].fuel).toBe(73); // and b too
  });

  it('compares a junk inventory entry as it is, without failing', () => {
    const s = world([player('a'), player('b', { inventory: [null, 'x', car('ok')] as any })]), sync = new StateSync(nOf);
    sync.refresh(s);
    expect(() => sync.full('a')).not.toThrow();
    s.players.b.inventory.push(car('more'));
    sync.refresh(s);
    expect(Object.keys(sync.patch('a', false)?.players ?? {})).toEqual(['b']);
  });

  it('sends nothing when nothing changed', () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    sync.refresh(s);
    expect(sync.patch('a', false)).toBeNull();
  });

  it("sends a player's change only where it shows: money is hidden from the others", () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a'); sync.full('b');
    s.players.a.money += 500;
    sync.refresh(s);
    expect(sync.patch('b', false)).toBeNull();
    expect(Object.keys(sync.patch('a', false)?.players ?? {})).toEqual(['a']);
  });

  it('sends the others only the newcomer when someone joins', () => {
    const s = world([player('a')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    s.players.c = player('c');
    sync.refresh(s);
    const patch = sync.patch('a', false)!;
    expect(Object.keys(patch.players ?? {})).toEqual(['c']);
    expect(patch.shared).toBeUndefined(); expect(patch.gone).toBeUndefined();
  });

  it('gives the player who acted its own record back, changed or not', () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    sync.refresh(s);
    expect(Object.keys(sync.patch('a', true)?.players ?? {})).toEqual(['a']);
    expect(sync.patch('a', false)).toBeNull();
  });

  it('sends a player or a shared part that went and came back under the same name, even if the page saw neither change', () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    const b = s.players.b, junk = s.junkyard;
    delete s.players.b; delete (s as any).junkyard;
    sync.refresh(s); // a is not patched here (as when another page's init reads the state)
    s.players.b = { ...b, name: 'B again' }; s.junkyard = [...junk, car('j2')];
    sync.refresh(s);
    const patch = sync.patch('a', false)!;
    expect(patch.players?.b?.name).toBe('B again');
    expect((patch.shared?.junkyard as any[])?.map(c => c.id)).toEqual(['j1', 'j2']);
  });

  it('says who left, and which shared part went, once', () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    delete s.players.b; delete (s as any).junkyard;
    sync.refresh(s);
    expect(sync.patch('a', false)).toEqual({ gone: ['b'], unset: ['junkyard'] });
    sync.refresh(s);
    expect(sync.patch('a', false)).toBeNull();
  });

  it("never sends another player's private fields", () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a');
    s.players.b.inventory.push(car('rich', { recon: 4000 })); s.players.b.orders = [{ id: 'o2' }] as any; s.players.b.gateCode = '9999';
    sync.refresh(s);
    const text = JSON.stringify(sync.patch('a', false));
    expect(text).toContain('"rich"');
    expect(text).not.toContain('9999'); expect(text).not.toContain('o2'); expect(text).not.toContain('acct-b'); expect(text).not.toContain('"recon":4000');
  });

  it("sends a player only its own walk-ins", () => {
    const s = world([player('a'), player('b')]), sync = new StateSync(nOf);
    sync.refresh(s); sync.full('a'); sync.full('b');
    s.activeWalkIns.b = [{ id: 'wb' }] as any;
    sync.refresh(s);
    expect(sync.patch('a', false)).toBeNull();
    expect(sync.patch('b', false)?.shared).toEqual({ activeWalkIns: { b: [{ id: 'wb' }] } });
  });

  it('knows only the pages it has sent a full copy, and forgets them', () => {
    const s = world([player('a')]), sync = new StateSync(nOf);
    sync.refresh(s);
    expect(sync.knows('a')).toBe(false); expect(sync.patch('a', true)).toBeNull();
    sync.full('a');
    expect(sync.knows('a')).toBe(true);
    sync.forget('a');
    expect(sync.knows('a')).toBe(false);
  });
});

describe("the page's side", () => {
  it('applies players, departures, shared parts and removals without changing the state it had', () => {
    const before = clone(viewFor(world([player('a'), player('b')]), 'a', nOf));
    const kept = clone(before);
    const patch: StatePatch = { players: { c: clone(othersView(player('c'), 9)) }, gone: ['b'], shared: { day: 2 }, unset: ['junkyard'] };
    const after = applyPatch(kept, patch);
    expect(Object.keys(after.players).sort()).toEqual(['a', 'c']);
    expect(after.day).toBe(2); expect('junkyard' in after).toBe(false);
    expect(kept).toEqual(before);
  });
});
