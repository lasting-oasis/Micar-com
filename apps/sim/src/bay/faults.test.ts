import { describe, it, expect } from 'vitest';
import type { Car, RepairDef } from '../types';
import { REPAIR_JOBS, repairJobFor } from './catalog';
import { carSheet, explainCondition, overallCondition } from './faults';
import { fault } from './testing';

const car = (body: number, mech: number, faults: RepairDef[] = []) => ({ id: 'c1', bodyCondition: body, mechanicCondition: mech, condition: Math.floor((body + mech) / 2), activeRepairs: faults }) as Car;
const ids = () => { let n = 0; return () => 'rep-t-' + ++n; };
const lost = (fs: RepairDef[]) => fs.reduce((s, f) => s + f.conditionImpact, 0);

describe('bay faults', () => {
  it('a trade-in at 60 body with no faults gets body faults worth exactly 40', () => { const c = car(60, 100), added = explainCondition(c, () => 0, ids()); expect(lost(added)).toBe(40); expect(added.every(f => f.type === 'body' && repairJobFor(f.partName)?.trade === 'body')).toBe(true); expect(c.activeRepairs).toEqual(added); expect(new Set(added.map(f => f.id)).size).toBe(added.length); });
  it('adds nothing twice, and nothing when the faults already cover the loss', () => { const c = car(60, 100); explainCondition(c, () => 0, ids()); expect(explainCondition(c, () => 0.99, ids())).toEqual([]); const over = car(0, 100, [fault('a', 'Frame Pulling Service'), fault('b', 'Frame Pulling Service'), fault('c', 'Frame Pulling Service')]); expect(explainCondition(over, () => 0, ids())).toEqual([]); });
  it('adds only the unexplained part, to the trade that lost it', () => { const c = car(100, 73, [fault('a', 'Brake Pad Set')]), added = explainCondition(c, () => 0.5, ids()); expect(lost(added)).toBe(17); expect(added.every(f => f.type === 'mechanic')).toBe(true); });
  it("a gap smaller than any fault becomes the smallest fault at that size, at the library's cost per point", () => { const added = explainCondition(car(97, 100), () => 0, ids()); expect(added.length).toBe(1); expect(added[0].conditionImpact).toBe(3); const job = repairJobFor(added[0].partName)!; expect(added[0].cost).toBe(Math.round(job.cost * 3 / job.impact)); expect(added[0].cost).toBe(150); });
  it('a library fault repeats when no unused one fits, at its own size and price', () => {
    const c = car(100, 30, [fault('a', 'Brake Pad Set'), fault('b', 'Alternator'), fault('c', 'Aluminum Radiator'), fault('d', 'Spark Plugs & Coils')]);
    const added = explainCondition(c, () => 0, ids());
    expect(added.map(f => [f.partName, f.conditionImpact, f.cost])).toEqual([['Aluminum Radiator', 15, 400], ['Aluminum Radiator', 15, 400]]);
  });
  it("no fault is ever larger than the catalogue's", () => {
    for (const trade of ['mechanic', 'body'] as const) {
      const jobs = REPAIR_JOBS.filter(j => j.trade === trade);
      const smallest = jobs.find(j => j.impact === Math.min(...jobs.map(x => x.impact)))!;
      for (let lostPts = 1; lostPts <= 95; lostPts++) for (const rng of [() => 0, () => 0.37, () => 0.5, () => 0.99, () => 1]) {
        const c = trade === 'body' ? car(100 - lostPts, 100) : car(100, 100 - lostPts);
        const added = explainCondition(c, rng, ids());
        expect(lost(added)).toBe(lostPts);
        expect(added.every(f => f.type === trade)).toBe(true);
        const small = added.filter(f => f.conditionImpact < repairJobFor(f.partName)!.impact);
        expect(small.length).toBeLessThanOrEqual(1);
        for (const f of added) {
          const job = repairJobFor(f.partName)!;
          expect(f.conditionImpact).toBeLessThanOrEqual(job.impact);
          if (small.includes(f)) { expect(f.partName).toBe(smallest.partName); expect(f.cost).toBe(Math.round(job.cost * f.conditionImpact / job.impact)); }
          else expect(f.cost).toBe(job.cost);
        }
        expect(explainCondition(c, rng, ids())).toEqual([]);
      }
    }
  });
  it("a car's headline condition is the floor of its two scores' average", () => { expect(overallCondition(66, 78)).toBe(72); expect(overallCondition(59.6, 100)).toBe(79); });
  it('a car saved with no fault list and a score that is not a whole number is handled', () => { const c = { id: 'c2', bodyCondition: 59.6, mechanicCondition: 100, condition: 79 } as Car; expect(lost(explainCondition(c, () => 0, ids()))).toBe(40); });
  it('the sheet gives each slot its open faults and what they cost it', () => { const s = carSheet(car(85, 45, [fault('a', 'Brake Pad Set'), fault('b', 'Rebuilt Transmission'), fault('c', 'Paint & Clear Coat Gallon')])); expect([s.mechanical, s.body]).toEqual([45, 85]); expect([s.slots.brakes.condition, s.slots.transmission.condition, s.slots.paint.condition, s.slots.engine.condition]).toEqual([90, 55, 85, 100]); expect(s.slots.brakes.faults.map(f => f.id)).toEqual(['a']); expect(s.slots.wheels.faults).toEqual([]); });
  it('a rental stays stock: it gets no faults for lost condition', () => {
    const c = { ...car(60, 70), rental: true } as Car;
    expect(explainCondition(c, Math.random, ids())).toEqual([]); expect(c.activeRepairs).toEqual([]);
  });
});
