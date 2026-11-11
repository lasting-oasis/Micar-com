import type { Car, RepairDef } from '../types';
import { STOCK_CFG, type PartValue } from '../world/data';
import { repairJobFor } from './catalog';
import type { OrderCtx, OrderLine } from './order';

/** A fault as the lot would list it, for the job on `partName`; `impact` overrides the job's own. */
export const fault = (id: string, partName: string, impact?: number): RepairDef => {
  const j = repairJobFor(partName)!;
  return { id, name: j.n, partName, type: j.trade, cost: j.cost, conditionImpact: impact ?? j.impact };
};

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
export const ctx = (over: Partial<OrderCtx> = {}, extra: RepairDef[] = []): OrderCtx => ({ car: { id: 'c1', bodyCondition: 85, mechanicCondition: 45, condition: 65, activeRepairs: [fault('f1', 'Brake Pad Set'), fault('f2', 'Rebuilt Transmission'), fault('f3', 'Paint & Clear Coat Gallon'), ...extra] } as Car, build: { cfg: clone(STOCK_CFG), owned: [] }, style: 'sedan', stage: 1, partsInventory: {}, hasMechanic: false, ...over });
export const part = (key: string, v: PartValue): OrderLine => ({ kind: 'install', key, v });
export const fix = (repairId: string): OrderLine => ({ kind: 'repair', repairId });
