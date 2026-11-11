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

type PartLine = { i: number; key: string; price: number };
type PartVerdict = { status: 'ok'; replaces: RepairDef[] } | { status: 'held'; needs: RepairDef[] };

/** Judges one slot's part lines together against the slot's open faults, so the answer cannot depend on line order. With nothing open every part is ok. Otherwise the dearest part that renews every open fault within its price (the lower key on a tie) replaces them and the others are ok beside it; with no such part, every part on the slot is held. */
function judgeSlot(parts: PartLine[], open: RepairDef[]): Map<number, PartVerdict> {
  const out = new Map<number, PartVerdict>();
  if (!open.length) { for (const p of parts) out.set(p.i, { status: 'ok', replaces: [] }); return out; }
  const fits = parts.map(p => ({ p, fit: fitPart(p.key, p.price, open) }));
  const capable = fits.filter(x => x.p.price > 0 && !x.fit.needs.length)
    .sort((a, b) => b.p.price - a.p.price || (a.p.key < b.p.key ? -1 : a.p.key > b.p.key ? 1 : 0));
  const renewer = capable[0];
  for (const { p, fit } of fits) {
    if (renewer) out.set(p.i, { status: 'ok', replaces: p === renewer.p ? fit.replaces : [] });
    else out.set(p.i, { status: 'held', needs: fit.needs });
  }
  return out;
}

/** Groups part lines by slot. */
function bySlot(parts: (PartLine & { slot: SlotId })[]): Map<SlotId, PartLine[]> {
  const m = new Map<SlotId, PartLine[]>();
  for (const p of parts) m.set(p.slot, [...(m.get(p.slot) ?? []), p]);
  return m;
}

/** A quote, and for each line what applying it acts on: the fault a repair line resolved to and whether its part comes from stock. */
type Judged = { quote: Quote; fault: Map<number, RepairDef>; fromStock: Set<number> };

function judge(c: OrderCtx, lines: OrderLine[]): Judged {
  const faults = c.car.activeRepairs ?? [];
  const tooMany = lines.length > MAX_LINES;
  const out: QuoteLine[] = new Array(lines.length);
  const stock = { ...c.partsInventory };
  const faultOf = new Map<number, RepairDef>();
  const fromStock = new Set<number>();
  const closed = new Set<RepairDef>(); // the faults a valid repair line of this order closes
  const installsSeen = new Set<string>();

  const refused = (line: OrderLine, n: string, slot: SlotId | null, reason: string): QuoteLine => ({ line, slot, n, price: 0, status: 'refused', reason });

  // Repairs first, so that parts can see which faults they cover. Lines are validated in line order.
  lines.forEach((line, i) => {
    if (line.kind !== 'repair') return;
    const f = faults.find(x => x.id === line.repairId);
    const slot = f ? slotOfFault(f) : null;
    if (!f) out[i] = refused(line, line.repairId, null, tooMany ? 'Too many lines.' : 'That fault is already fixed.');
    else if (tooMany) out[i] = refused(line, f.name, slot, 'Too many lines.');
    else if (closed.has(f)) out[i] = refused(line, f.name, slot, 'Already on the order.');
    else { closed.add(f); faultOf.set(i, f); }
  });
  // Stock goes to the dearest faults first (the lower id on a tie), whatever the line order.
  const repairs = [...faultOf].sort(([ia, a], [ib, b]) => b.cost - a.cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || ia - ib);
  for (const [i, f] of repairs) {
    let price: number;
    if ((stock[f.partName] ?? 0) > 0) { stock[f.partName]--; price = 0; fromStock.add(i); }
    else price = Math.floor(f.cost * (c.hasMechanic ? MECHANIC_RATE : 1));
    out[i] = { line: lines[i], slot: slotOfFault(f), n: f.name, price, status: 'ok' };
  }

  const parts: (PartLine & { slot: SlotId })[] = [];
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
    out[i] = { line, slot, n, price: cost, status: 'ok' };
    if (slot) parts.push({ i, key, price: cost, slot });
  });
  for (const [slot, ps] of bySlot(parts)) {
    const verdicts = judgeSlot(ps, faults.filter(f => slotOfFault(f) === slot && !closed.has(f)));
    for (const p of ps) {
      const v = verdicts.get(p.i)!, q = out[p.i];
      if (v.status === 'held') out[p.i] = { ...q, price: 0, status: 'held', reason: 'Fix first: ' + v.needs.map(f => f.name).join(', '), needs: v.needs.map(f => f.name) };
      else if (v.replaces.length) out[p.i] = { ...q, replaces: v.replaces.map(f => f.name) };
    }
  }

  const ok = out.every(l => l.status === 'ok');
  const total = out.reduce((s, l) => s + (l.status === 'ok' ? l.price : 0), 0);
  const trades = out.filter(l => l.status === 'ok' && l.slot).map(l => SLOTS[l.slot!].trade);
  return { quote: { lines: out, total, ok, stages: stagesFor(trades) }, fault: faultOf, fromStock };
}

export function quoteOrder(c: OrderCtx, lines: OrderLine[]): Quote {
  return judge(c, lines).quote;
}

/** Takes this fault (this object, not every fault with its id) off the car and gives back the condition it cost. */
function close(car: Car, f: RepairDef) {
  car.activeRepairs = (car.activeRepairs ?? []).filter(x => x !== f);
  const k = f.type === 'body' ? 'bodyCondition' : 'mechanicCondition';
  car[k] = Math.min(100, car[k] + f.conditionImpact);
}

export function applyOrder(c: OrderCtx, lines: OrderLine[], rng: () => number): OrderResult {
  const { quote: q, fault: faultOf, fromStock } = judge(c, lines);
  if (!q.ok) throw new Error('Order does not quote clean.');
  const results: OrderResult['lines'] = new Array(q.lines.length);
  const put = (i: number, ql: QuoteLine, price: number, outcome: Outcome) => { results[i] = { n: ql.n, slot: ql.slot, price, outcome }; };

  q.lines.forEach((ql, i) => {
    if (ql.line.kind !== 'repair') return;
    const f = faultOf.get(i)!;
    if (fromStock.has(i)) c.partsInventory[f.partName] = (c.partsInventory[f.partName] ?? 0) - 1;
    if (!c.hasMechanic && rng() < REPAIR_FAIL) { put(i, ql, ql.price, 'failed'); return; }
    close(c.car, f);
    put(i, ql, ql.price, 'done');
  });

  const parts: (PartLine & { slot: SlotId })[] = [];
  q.lines.forEach((ql, i) => { if (ql.line.kind === 'install' && ql.slot) parts.push({ i, key: ql.line.key, price: ql.price, slot: ql.slot }); });
  const verdicts = new Map<number, PartVerdict>();
  for (const [slot, ps] of bySlot(parts)) {
    for (const [i, v] of judgeSlot(ps, (c.car.activeRepairs ?? []).filter(f => slotOfFault(f) === slot))) verdicts.set(i, v);
  }

  q.lines.forEach((ql, i) => {
    if (ql.line.kind !== 'install') return;
    const { key, v } = ql.line;
    const verdict = verdicts.get(i) ?? { status: 'ok', replaces: [] };
    if (verdict.status === 'held') { put(i, ql, 0, 'held'); return; }
    for (const f of verdict.replaces) close(c.car, f);
    c.build.cfg = withV(c.build.cfg, key, v);
    if (!c.build.owned.includes(okey(key, v))) c.build.owned.push(okey(key, v));
    put(i, ql, ql.price, 'done');
  });

  const total = results.reduce((s, r) => s + r.price, 0);
  if (results.some(r => r.outcome === 'done')) c.car.condition = overallCondition(c.car.bodyCondition, c.car.mechanicCondition);
  c.car.recon = (c.car.recon ?? 0) + total;
  return { lines: results, total, stages: q.stages };
}
