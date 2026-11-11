import type { Car, RepairDef } from '../types';
import { isRental } from '../world/rental';
import { REPAIR_JOBS, repairJobFor, type RepairJob } from './catalog';
import { SLOT_IDS, type SlotId, type Trade } from './slots';

export type SlotSheet = { slot: SlotId; condition: number; faults: RepairDef[] };
export type CarSheet = { mechanical: number; body: number; slots: Record<SlotId, SlotSheet> };

/** A loop guard only: by the rule in `explainCondition` no gap of 1 to 100 needs more than 9 faults in a trade. */
const MAX_FAULTS_PER_TRADE = 12;

/** A car's headline condition: the floor of the average of its body and mechanical scores. */
export const overallCondition = (body: number, mechanic: number): number => Math.floor((body + mechanic) / 2);

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

/** Gives the car faults for every point of condition it lost that no listed fault accounts for. A rental gets none. Returns the faults added. */
export function explainCondition(car: Car, rng: () => number, id: () => string): RepairDef[] {
  if (isRental(car)) return []; // a rental stays stock
  if (!car.activeRepairs) car.activeRepairs = [];
  const added: RepairDef[] = [];
  const scores: Record<Trade, number> = { mechanic: car.mechanicCondition, body: car.bodyCondition };
  for (const trade of ['mechanic', 'body'] as const) {
    const jobs = REPAIR_JOBS.filter(j => j.trade === trade);
    let gap = 100 - Math.round(scores[trade]) - car.activeRepairs.filter(f => f.type === trade).reduce((s, f) => s + f.conditionImpact, 0);
    for (let n = 0; gap > 0 && n < MAX_FAULTS_PER_TRADE; n++) {
      const fits = jobs.filter(j => j.impact <= gap);
      const unused = fits.filter(j => !car.activeRepairs!.some(f => f.partName === j.partName));
      let job: RepairJob, impact: number, cost: number;
      if (unused.length) { // an unused library fault that fits
        job = unused[Math.min(unused.length - 1, Math.floor(rng() * unused.length))];
        impact = job.impact; cost = job.cost;
      } else if (fits.length) { // a repeat: the largest that fits, the first on a tie
        job = fits.reduce((a, b) => (b.impact > a.impact ? b : a));
        impact = job.impact; cost = job.cost;
      } else { // a remainder smaller than any fault: the smallest, at the library's cost per point
        job = jobs.reduce((a, b) => (b.impact < a.impact ? b : a));
        impact = gap; cost = Math.round(job.cost * gap / job.impact);
      }
      const f: RepairDef = { id: id(), name: job.n, partName: job.partName, type: trade, cost, conditionImpact: impact };
      car.activeRepairs.push(f);
      added.push(f);
      gap -= f.conditionImpact;
    }
  }
  return added;
}
