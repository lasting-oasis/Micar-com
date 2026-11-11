import type { WearSystem } from '@micar/engine';

export type Tab = 'mechanical' | 'body' | 'custom';
export type Trade = 'mechanic' | 'body';

export const SLOT_IDS = ['engine', 'induction', 'cooling', 'transmission', 'electrical', 'brakes', 'suspension', 'frame', 'panels', 'paint', 'glass', 'lights', 'wheels', 'tires', 'aero', 'accessories'] as const;
export type SlotId = typeof SLOT_IDS[number];

export type SlotDef = { id: SlotId; n: string; tab: Tab; trade: Trade; wear: WearSystem | null; cam: string };

const S = (id: SlotId, n: string, tab: Tab, trade: Trade, wear: WearSystem | null, cam: string): SlotDef => ({ id, n, tab, trade, wear, cam });

export const SLOTS: Record<SlotId, SlotDef> = {
  engine: S('engine', 'Engine', 'mechanical', 'mechanic', 'engine', 'hood'),
  induction: S('induction', 'Turbo & nitrous', 'mechanical', 'mechanic', 'engine', 'front34'),
  cooling: S('cooling', 'Cooling', 'mechanical', 'mechanic', 'engine', 'front'),
  transmission: S('transmission', 'Transmission', 'mechanical', 'mechanic', 'transmission', 'side34'),
  electrical: S('electrical', 'Electrical', 'mechanical', 'mechanic', 'battery', 'hood'),
  brakes: S('brakes', 'Brakes', 'mechanical', 'mechanic', 'brakes', 'wheel'),
  suspension: S('suspension', 'Suspension', 'mechanical', 'mechanic', 'suspension', 'low'),
  frame: S('frame', 'Frame', 'body', 'body', 'body', 'low'),
  panels: S('panels', 'Panels & bumpers', 'body', 'body', 'body', 'front34'),
  paint: S('paint', 'Paint & graphics', 'body', 'body', 'body', 'top34'),
  glass: S('glass', 'Glass', 'body', 'body', 'body', 'side34'),
  lights: S('lights', 'Lights', 'body', 'body', 'body', 'front'),
  wheels: S('wheels', 'Wheels', 'custom', 'mechanic', null, 'wheel'),
  tires: S('tires', 'Tires', 'custom', 'mechanic', 'tires', 'wheel'),
  aero: S('aero', 'Aero', 'custom', 'body', null, 'rear'),
  accessories: S('accessories', 'Accessories', 'custom', 'body', null, 'top34'),
};

export const TAB_SLOTS: Record<Tab, SlotId[]> = {
  mechanical: SLOT_IDS.filter(id => SLOTS[id].tab === 'mechanical'),
  body: SLOT_IDS.filter(id => SLOTS[id].tab === 'body'),
  custom: SLOT_IDS.filter(id => SLOTS[id].tab === 'custom'),
};

export type Stage = { id: string; n: string; d: string };

export const PIPELINES: Record<Trade, Stage[]> = {
  mechanic: [
    { id: 'diag', n: 'Diagnostic Scan', d: 'OBD-II Fault Scanning & Verification' },
    { id: 'teardown', n: 'Disassembly', d: 'Tearing down engine or subsystem components' },
    { id: 'parts', n: 'Part Replacement', d: 'Installing new mechanical hardware' },
    { id: 'reassembly', n: 'Reassembly', d: 'Rebuilding subsystem back to factory spec' },
    { id: 'coding', n: 'ECU Coding & Tune', d: 'Coding modules and clearing codes' },
    { id: 'roadtest', n: 'Road Testing', d: 'Dynamo & highway verification testing' },
    { id: 'ready', n: 'Ready', d: 'Ready for client pickup' },
  ],
  body: [
    { id: 'intake', n: 'Intake', d: 'Vehicle checked in' },
    { id: 'inspection', n: 'Inspection', d: 'Evaluating damage & ordering parts' },
    { id: 'bodywork', n: 'Body Work', d: 'Structural and dent repairs' },
    { id: 'paint', n: 'Paint', d: 'Priming, painting & clear coat' },
    { id: 'reassembly', n: 'Reassembly', d: 'Putting everything back together' },
    { id: 'qc', n: 'Quality Control', d: 'Final checks and detailing' },
    { id: 'ready', n: 'Ready', d: 'Ready for pickup!' },
  ],
};

const STAGE_ORDER = ['intake', 'inspection', 'diag', 'teardown', 'parts', 'bodywork', 'paint', 'reassembly', 'coding', 'roadtest', 'qc', 'ready'];

/** The stages of the given trades' pipelines, in shop order. A stage both have comes from the first trade given. */
export function stagesFor(trades: Trade[]): Stage[] {
  const byId = new Map<string, Stage>();
  for (const t of trades) for (const s of PIPELINES[t]) if (!byId.has(s.id)) byId.set(s.id, s);
  return STAGE_ORDER.filter(id => byId.has(id)).map(id => byId.get(id)!);
}
