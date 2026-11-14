// A full copy of the state only for the page that needs one; every other page gets only what changed for it
// (docs/superpowers/specs/2026-11-14-world-data-diet-design.md). Pure: server.ts keeps one StateSync, the page applies
// patches with applyPatch, and the tests run both on plain objects.
import type { GameState, Player } from '../types';

/** What a page is sent of the state: everything but the accounts (never sent) and the chat log (sent once, at join). */
export type ViewState = Omit<GameState, 'accounts' | 'chatLog'>;
/** What changed for one page since the last copy or patch it was sent: players' records (its own in full, others as
 *  othersView shows them), the ids of players who left, shared parts of the state that changed, and shared parts that went. */
export type StatePatch = { players?: Record<string, Player>; gone?: string[]; shared?: Record<string, unknown>; unset?: string[] };

/** The keys of the state that are not shared alike by every page. */
const NOT_SHARED = new Set(['players', 'accounts', 'chatLog', 'activeWalkIns']);

/** A player's own record, as it is sent to it: all of it, with its short number. */
export function ownView(p: Player, n?: number): Player {
  return { ...p, n };
}

/** A player as everyone else sees it (what broadcastState sent before the data diet): no money, contracts, customers,
 *  books, floor-plan debt, gate code, shares, account id, tester flag or work orders, and nothing of what was paid for
 *  or spent on a car. With its short number. */
export function othersView(p: Player, n?: number): Player {
  return {
    ...p,
    n,
    money: 0,
    contracts: [],
    customers: [],
    balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 },
    floorPlanDebt: 0,
    gateCode: undefined,   // never reveal another player's gate code
    shareHoldings: {},     // portfolios are private
    accountId: undefined,  // account ids are private
    tester: undefined,     // and so is who is testing
    orders: [],            // work orders are private
    inventory: p.inventory ? p.inventory.map(c => ({ ...c, buyPrice: 0, recon: 0 })) : [], // so is what was paid and spent
  };
}

/** A record without what its own page reports while it plays: its position (`sync_player_pos`, ten times a second) and
 *  each car's fuel (`consume_fuel`) and town spot (`sync_car_pos`). What the server compares to decide whether a record
 *  changed for a page; the record itself always goes whole and current. Nobody needs those to come back:
 *  - other pages never read another player's cars (every inventory read in the page is of its own player) and take
 *    other players' positions from `pos` (the record's position is only their fallback until the first `pos`);
 *  - the page that reports them has them already: it keeps its own tank in step as it reports it (store.ts
 *    consumeFuel), places its own cars from their spot only when it first draws them (VanillaThreeScene.tsx, car meshes),
 *    and knows where it is. Its own actions still bring its record back (StateSync.patch, `acted`). */
export function steadyPart(view: Player): unknown {
  const { worldPosition: _position, inventory, ...rest } = view;
  return {
    ...rest,
    inventory: (inventory ?? []).map(car => {
      if (!car || typeof car !== 'object') return car; // a junk entry from an old save, compared as it is
      const { fuel: _fuel, lotPosition: _spot, ...steady } = car;
      return steady;
    }),
  };
}

/** A page's walk-ins: its own only. */
const walkInsOf = (state: GameState, viewerId: string) => {
  const mine = state.activeWalkIns?.[viewerId];
  return mine ? { [viewerId]: mine } : {};
};

/** The whole state as one page may see it. Changes nothing. */
export function viewFor(state: GameState, viewerId: string, nOf: (id: string) => number | undefined): ViewState {
  const players: Record<string, Player> = {};
  for (const [id, p] of Object.entries(state.players)) players[id] = id === viewerId ? ownView(p, nOf(id)) : othersView(p, nOf(id));
  const shared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) if (!NOT_SHARED.has(key) && value !== undefined) shared[key] = value;
  return { ...shared, players, activeWalkIns: walkInsOf(state, viewerId) } as ViewState;
}

type Part = { json: string; ver: number; value: unknown };
type Seen = { players: Map<string, number>; shared: Map<string, number>; walkIns: string };

/** The server's side: the state as it was last read, and what each page was last sent of it. A part counts as changed
 *  when its JSON differs from the last reading, so nothing that changes the state has to say what it changed. */
export class StateSync {
  private own = new Map<string, Part>();
  private others = new Map<string, Part>();
  private shared = new Map<string, Part>();
  private seen = new Map<string, Seen>();
  private state: GameState | null = null;
  /** The last version handed out. Every new reading of a part takes the next one, so a part that goes and comes back
   *  (a player id or a shared key) never repeats a version a page already holds. */
  private ver = 0;

  constructor(private readonly nOf: (id: string) => number | undefined) {}

  /** Read the state again: each player's two views and each shared part, once each. */
  refresh(state: GameState): void {
    this.state = state;
    for (const [id, p] of Object.entries(state.players)) {
      const mine = ownView(p, this.nOf(id)), seen = othersView(p, this.nOf(id));
      this.put(this.own, id, mine, JSON.stringify(steadyPart(mine)));
      this.put(this.others, id, seen, JSON.stringify(steadyPart(seen)));
    }
    for (const id of [...this.own.keys()]) if (!state.players[id]) { this.own.delete(id); this.others.delete(id); }
    for (const [key, value] of Object.entries(state)) if (!NOT_SHARED.has(key)) { if (value === undefined) this.shared.delete(key); else this.put(this.shared, key, value); }
    for (const key of [...this.shared.keys()]) if (!(key in state)) this.shared.delete(key);
  }

  /** A part read again: a new version only when its JSON (or the JSON it is compared by) changed. The value kept is
   *  always the latest, so whatever is sent is current. */
  private put(parts: Map<string, Part>, key: string, value: unknown, json = JSON.stringify(value)): void {
    const old = parts.get(key);
    if (old && old.json === json) { old.value = value; return; }
    parts.set(key, { json, ver: ++this.ver, value });
  }

  /** The whole view for a page (at its join), remembered as sent: its patches start from here. Call refresh first. */
  full(viewerId: string): ViewState {
    const seen: Seen = { players: new Map(), shared: new Map(), walkIns: '' };
    const players: Record<string, Player> = {};
    for (const [id, own] of this.own) {
      const part = id === viewerId ? own : this.others.get(id)!;
      players[id] = part.value as Player;
      seen.players.set(id, part.ver);
    }
    const shared: Record<string, unknown> = {};
    for (const [key, part] of this.shared) { shared[key] = part.value; seen.shared.set(key, part.ver); }
    const walkIns = this.state ? walkInsOf(this.state, viewerId) : {};
    seen.walkIns = JSON.stringify(walkIns);
    this.seen.set(viewerId, seen);
    return { ...shared, players, activeWalkIns: walkIns } as ViewState;
  }

  /** What changed for a page since it was last sent anything; null when nothing did. `acted`: this page's own action
   *  caused the change, so it gets its own record back even if unchanged (it may show a refused purchase already). */
  patch(viewerId: string, acted: boolean): StatePatch | null {
    const seen = this.seen.get(viewerId);
    if (!seen || !this.state) return null;
    const patch: StatePatch = {};
    for (const [id, own] of this.own) {
      const part = id === viewerId ? own : this.others.get(id)!;
      if (seen.players.get(id) === part.ver && !(acted && id === viewerId)) continue;
      (patch.players ??= {})[id] = part.value as Player;
      seen.players.set(id, part.ver);
    }
    for (const id of [...seen.players.keys()]) if (!this.own.has(id)) { (patch.gone ??= []).push(id); seen.players.delete(id); }
    for (const [key, part] of this.shared) {
      if (seen.shared.get(key) === part.ver) continue;
      (patch.shared ??= {})[key] = part.value;
      seen.shared.set(key, part.ver);
    }
    for (const key of [...seen.shared.keys()]) if (!this.shared.has(key)) { (patch.unset ??= []).push(key); seen.shared.delete(key); }
    const walkIns = walkInsOf(this.state, viewerId), json = JSON.stringify(walkIns);
    if (json !== seen.walkIns) { (patch.shared ??= {}).activeWalkIns = walkIns; seen.walkIns = json; }
    return patch.players || patch.gone || patch.shared || patch.unset ? patch : null;
  }

  /** Whether a page has had its full copy. */
  knows(viewerId: string): boolean {
    return this.seen.has(viewerId);
  }

  /** A page is gone, or is now sent the old messages. */
  forget(viewerId: string): void {
    this.seen.delete(viewerId);
  }
}

/** The page's side: a patch applied to the state it has, as a new object (the old one is not changed). */
export function applyPatch<S extends ViewState>(state: S, patch: StatePatch): S {
  const players = patch.players || patch.gone ? { ...state.players, ...patch.players } : state.players;
  for (const id of patch.gone ?? []) delete players[id];
  const next = { ...state, ...patch.shared, players } as S;
  for (const key of patch.unset ?? []) delete (next as Record<string, unknown>)[key];
  return next;
}
