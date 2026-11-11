import type { Car, RepairDef } from '../types';
import { REPAIR_JOBS, repairJobFor } from './catalog';
import { SLOT_IDS, type SlotId, type Trade } from './slots';

export type SlotSheet = { slot: SlotId; condition: number; faults: RepairDef[] };
export type CarSheet = { mechanical: number; body: number; slots: Record<SlotId, SlotSheet> };

const MAX_FAULTS_PER_TRADE = 8;

export function carSheet(car: Pick<Car, 'bodyCondition' | 'mechanicCondition' | 'activeRepairs'>): CarSheet {
  const slots = {} as Record<SlotId, SlotSheet>;
  for (const slot of SLOT_IDS) slots[slot] = { slot, condition: 100, faults: [] };
  for (const f of car.activeRepairs ?? []) {
    const job = repairJobFor(f.partName);
    if (job) slots[job.slot].faults.push(f);
  }
  for (const s of Object.values(slots)) s.condition = Math.max(0, 100 - s.faults.reduce((sum, f) => sum + f.conditionImpact, 0));
  return { mechanical: Math.round(car.mechanicCondition), body: Math.round(car.bodyCondition), slots };
}

/** Gives the car faults for every point of condition it lost that no listed fault accounts for. Returns the faults added. */
export function explainCondition(car: Car, rng: () => number, id: () => string): RepairDef[] {
  if (!car.activeRepairs) car.activeRepairs = [];
  const added: RepairDef[] = [];
  const scores: Record<Trade, number> = { mechanic: car.mechanicCondition, body: car.bodyCondition };
  for (const trade of ['mechanic', 'body'] as const) {
    const jobs = REPAIR_JOBS.filter(j => j.trade === trade);
    let gap = 100 - Math.round(scores[trade]) - car.activeRepairs.filter(f => f.type === trade).reduce((s, f) => s + f.conditionImpact, 0);
    for (let n = 0; gap > 0 && n < MAX_FAULTS_PER_TRADE; n++) {
      const candidates = jobs.filter(j => j.impact <= gap && !car.activeRepairs!.some(f => f.partName === j.partName));
      let job = candidates[Math.floor(rng() * candidates.length)];
      let impact = job?.impact;
      if (!job) {
        const smallest = Math.min(...jobs.map(j => j.impact));
        job = jobs.find(j => j.impact === smallest)!;
        impact = gap;
      }
      const f: RepairDef = { id: id(), name: job.n, partName: job.partName, type: trade, cost: job.cost, conditionImpact: impact! };
      car.activeRepairs.push(f);
      added.push(f);
      gap -= f.conditionImpact;
    }
  }
  return added;
}
