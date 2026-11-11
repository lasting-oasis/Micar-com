import type { Car, RepairDef } from '../types';
import { CATS, getV, isOwned, okey, withV, type BodyStyle, type CarCfg, type PartValue } from '../world/data';
import { partPrice } from '../world/payout';
import { PART_KEYS, repairJobFor } from './catalog';
import { overallCondition } from './faults';
import { SLOTS, stagesFor, type SlotId, type Stage } from './slots';

export const MAX_LINES = 24;
export const REPAIR_FAIL = 0.15;
export const MECHANIC_RATE = 0.8;

export const DOORS = ['garage', 'dealership', 'shop'] as const;
export type Door = typeof DOORS[number];
export type OrderLine = { kind: 'repair'; repairId: string } | { kind: 'install'; key: string; v: PartValue };

export function isOrderLine(x: unknown): x is OrderLine {
  if (!x || typeof x !== 'object') return false;
  const l = x as Record<string, unknown>;
  if (l.kind === 'repair') return typeof l.repairId === 'string';
  return l.kind === 'install' && typeof l.key === 'string' && (typeof l.v === 'string' || typeof l.v === 'number');
}

export function isWorkOrder(x: unknown): x is WorkOrder {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.carId === 'string' && typeof o.car === 'string' && (DOORS as readonly unknown[]).includes(o.door)
    && Number.isFinite(o.total) && Number.isFinite(o.day) && Array.isArray(o.lines) && Array.isArray(o.stages);
}

export type OrderCtx = { car: Car; build: { cfg: CarCfg; owned: string[] }; style: BodyStyle; stage: number; partsInventory: Record<string, number>; hasMechanic: boolean };

/** `replaces` and `needs` hold fault names. */
export type QuoteLine = { line: OrderLine; slot: SlotId | null; n: string; price: number; status: 'ok' | 'held' | 'refused'; reason?: string; replaces?: string[]; needs?: string[] };
export type Quote = { lines: QuoteLine[]; total: number; ok: boolean; stages: Stage[] };

export type Outcome = 'done' | 'failed' | 'held';
export type OrderResult = { lines: { n: string; slot: SlotId | null; price: number; outcome: Outcome }[]; total: number; stages: Stage[] };
export type WorkOrder = OrderResult & { id: string; carId: string; car: string; door: Door; day: number };

const slotOfFault = (f: RepairDef): SlotId | null => repairJobFor(f.partName)?.slot ?? null;

const partName = (key: string, v: PartValue): string => {
  const cat = Object.prototype.hasOwnProperty.call(CATS, key) ? CATS[key] : undefined;
  const item = cat?.items.find(i => i.v === v);
  return cat && item ? cat.n + ': ' + item.n : key;
};

/** Which of a slot's open faults a part renews, and which it leaves open. A part only renews faults it lists, dearest first, while their repair prices stay within its own price; a part that costs nothing renews nothing. */
function fitPart(key: string, price: number, open: RepairDef[]): { replaces: RepairDef[]; needs: RepairDef[] } {
  const renewable = price > 0 ? open.filter(f => PART_KEYS[key]?.renews.includes(f.partName)).sort((a, b) => b.cost - a.cost) : [];
  const replaces: RepairDef[] = [];
  let sum = 0;
  for (const f of renewable) {
    if (sum + f.cost > price) break;
    sum += f.cost;
    replaces.push(f);
  }
  return { replaces, needs: open.filter(f => !replaces.includes(f)) };
}

export function quoteOrder(c: OrderCtx, lines: OrderLine[]): Quote {
  const faults = c.car.activeRepairs ?? [];
  const tooMany = lines.length > MAX_LINES;
  const out: QuoteLine[] = new Array(lines.length);
  const stock = { ...c.partsInventory };
  const closed = new Set<string>(); // ids of faults an ok line of this order closes
  const repairsSeen = new Set<string>();
  const installsSeen = new Set<string>();

  const refused = (line: OrderLine, n: string, slot: SlotId | null, reason: string): QuoteLine => ({ line, slot, n, price: 0, status: 'refused', reason });

  // Repairs first, so that parts can see which faults they cover.
  lines.forEach((line, i) => {
    if (line.kind !== 'repair') return;
    const f = faults.find(x => x.id === line.repairId);
    const slot = f ? slotOfFault(f) : null;
    let q: QuoteLine;
    if (!f) q = refused(line, line.repairId, null, tooMany ? 'Too many lines.' : 'That fault is already fixed.');
    else if (tooMany) q = refused(line, f.name, slot, 'Too many lines.');
    else if (repairsSeen.has(f.id)) q = refused(line, f.name, slot, 'Already on the order.');
    else {
      repairsSeen.add(f.id);
      let price: number;
      if ((stock[f.partName] ?? 0) > 0) { stock[f.partName]--; price = 0; }
      else price = Math.floor(f.cost * (c.hasMechanic ? MECHANIC_RATE : 1));
      closed.add(f.id);
      q = { line, slot, n: f.name, price, status: 'ok' };
    }
    out[i] = q;
  });

  lines.forEach((line, i) => {
    if (line.kind === 'repair') return;
    const { key, v } = line;
    const price = partPrice(key, v, c.stage);
    const slot = price.ok ? PART_KEYS[key]?.slot ?? null : null;
    if (tooMany) { out[i] = refused(line, partName(key, v), slot, 'Too many lines.'); return; }
    if (!price.ok) { out[i] = refused(line, partName(key, v), slot, price.reason); return; }
    const n = partName(key, v);
    if (getV(c.build.cfg, key) === v) { out[i] = refused(line, n, slot, 'Already fitted.'); return; }
    if (installsSeen.has(key)) { out[i] = refused(line, n, slot, 'One choice per part.'); return; }
    installsSeen.add(key);
    const cost = isOwned(c.build.cfg, c.build.owned, key, v) ? 0 : price.price;
    const open = faults.filter(f => slotOfFault(f) === slot && !closed.has(f.id));
    const { replaces, needs } = fitPart(key, cost, open);
    if (needs.length) {
      out[i] = { line, slot, n, price: 0, status: 'held', reason: 'Fix first: ' + needs.map(f => f.name).join(', '), needs: needs.map(f => f.name) };
      return;
    }
    for (const f of replaces) closed.add(f.id);
    out[i] = { line, slot, n, price: cost, status: 'ok', ...(replaces.length ? { replaces: replaces.map(f => f.name) } : {}) };
  });

  const ok = out.every(l => l.status === 'ok');
  const total = out.reduce((s, l) => s + (l.status === 'ok' ? l.price : 0), 0);
  const trades = out.filter(l => l.status === 'ok' && l.slot).map(l => SLOTS[l.slot!].trade);
  return { lines: out, total, ok, stages: stagesFor(trades) };
}

/** Takes a fault off the car and gives back the condition it cost. */
function close(car: Car, f: RepairDef) {
  car.activeRepairs = (car.activeRepairs ?? []).filter(x => x.id !== f.id);
  const k = f.type === 'body' ? 'bodyCondition' : 'mechanicCondition';
  car[k] = Math.min(100, car[k] + f.conditionImpact);
}

export function applyOrder(c: OrderCtx, lines: OrderLine[], rng: () => number): OrderResult {
  const q = quoteOrder(c, lines);
  if (!q.ok) throw new Error('Order does not quote clean.');
  const results: OrderResult['lines'] = new Array(q.lines.length);
  const put = (i: number, ql: QuoteLine, price: number, outcome: Outcome) => { results[i] = { n: ql.n, slot: ql.slot, price, outcome }; };

  q.lines.forEach((ql, i) => {
    if (ql.line.kind !== 'repair') return;
    const id = ql.line.repairId;
    const f = c.car.activeRepairs!.find(x => x.id === id)!;
    if (ql.price === 0 && (c.partsInventory[f.partName] ?? 0) > 0) c.partsInventory[f.partName]--;
    if (!c.hasMechanic && rng() < REPAIR_FAIL) { put(i, ql, ql.price, 'failed'); return; }
    close(c.car, f);
    put(i, ql, ql.price, 'done');
  });

  q.lines.forEach((ql, i) => {
    if (ql.line.kind !== 'install') return;
    const { key, v } = ql.line;
    const open = (c.car.activeRepairs ?? []).filter(f => slotOfFault(f) === ql.slot);
    const { replaces, needs } = fitPart(key, ql.price, open);
    if (needs.length) { put(i, ql, 0, 'held'); return; }
    for (const f of replaces) close(c.car, f);
    c.build.cfg = withV(c.build.cfg, key, v);
    if (!c.build.owned.includes(okey(key, v))) c.build.owned.push(okey(key, v));
    put(i, ql, ql.price, 'done');
  });

  const total = results.reduce((s, r) => s + r.price, 0);
  if (results.some(r => r.outcome === 'done')) c.car.condition = overallCondition(c.car.bodyCondition, c.car.mechanicCondition);
  c.car.recon = (c.car.recon ?? 0) + total;
  return { lines: results, total, stages: q.stages };
}
