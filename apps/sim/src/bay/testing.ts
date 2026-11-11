import type { RepairDef } from '../types';
import { repairJobFor } from './catalog';

/** A fault as the lot would list it, for the job on `partName`; `impact` overrides the job's own. */
export const fault = (id: string, partName: string, impact?: number): RepairDef => {
  const j = repairJobFor(partName)!;
  return { id, name: j.n, partName, type: j.trade, cost: j.cost, conditionImpact: impact ?? j.impact };
};
