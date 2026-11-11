import type { ModCategory } from '@micar/engine';
import { MECHANIC_LIB, BODY_LIB } from '../constants';
import { CATS, PERF } from '../world/data';
import type { SlotId, Trade } from './slots';

export type RepairJob = { n: string; partName: string; trade: Trade; slot: SlotId; cost: number; impact: number };

const FAULT_SLOT: Record<string, SlotId> = {
  'Brake Pad Set': 'brakes',
  'Aluminum Radiator': 'cooling',
  'Head Gasket Kit': 'engine',
  'Rebuilt Transmission': 'transmission',
  'Alternator': 'electrical',
  'Spark Plugs & Coils': 'engine',
  'Replacement Fender': 'panels',
  'OEM Windshield': 'glass',
  'Paint & Clear Coat Gallon': 'paint',
  'Frame Pulling Service': 'frame',
  'Headlight Assembly': 'lights',
  'Sheet Metal & Welding Wire': 'panels',
};

const job = (trade: Trade) => (f: { name: string; partName: string; cost: number; impact: number }): RepairJob =>
  ({ n: f.name, partName: f.partName, trade, slot: FAULT_SLOT[f.partName], cost: f.cost, impact: f.impact });

export const REPAIR_JOBS: RepairJob[] = [...MECHANIC_LIB.map(job('mechanic')), ...BODY_LIB.map(job('body'))];

export const repairJobFor = (partName: string): RepairJob | undefined => REPAIR_JOBS.find(j => j.partName === partName);

export type PartKey = { key: string; slot: SlotId; mod: ModCategory | null; renews: string[] };

const KEY_SLOT: Record<string, SlotId> = {
  'perf.engine': 'engine', 'perf.ecu': 'engine',
  'perf.turbo': 'induction', 'perf.nos': 'induction',
  'perf.trans': 'transmission',
  'perf.brakes': 'brakes',
  'perf.susp': 'suspension', hydraulics: 'suspension',
  front: 'panels', rear: 'panels', skirts: 'panels', hood: 'panels', 'perf.weight': 'panels',
  color: 'paint', finish: 'paint', vinyl: 'paint', vinylColor: 'paint',
  tint: 'glass',
  lights: 'lights',
  rim: 'wheels', rimSize: 'wheels', rimColor: 'wheels',
  'perf.tires': 'tires',
  spoiler: 'aero', roof: 'aero',
  neon: 'accessories',
};

const KEY_MOD: Record<string, ModCategory> = {
  'perf.engine': 'engine', 'perf.ecu': 'ecu', 'perf.turbo': 'turbo', 'perf.nos': 'nitrous', 'perf.trans': 'transmission',
  'perf.susp': 'suspension', 'perf.tires': 'tires', 'perf.brakes': 'brakes', 'perf.weight': 'weight', spoiler: 'aero',
};

const KEY_RENEWS: Record<string, string[]> = {
  'perf.engine': ['Head Gasket Kit', 'Spark Plugs & Coils'],
  'perf.trans': ['Rebuilt Transmission'],
  'perf.brakes': ['Brake Pad Set'],
  color: ['Paint & Clear Coat Gallon'],
  finish: ['Paint & Clear Coat Gallon'],
  lights: ['Headlight Assembly'],
};

export const PART_KEYS: Record<string, PartKey> = {};
for (const key of [...Object.keys(CATS), ...Object.keys(PERF).map(k => 'perf.' + k)]) {
  PART_KEYS[key] = { key, slot: KEY_SLOT[key], mod: KEY_MOD[key] ?? null, renews: KEY_RENEWS[key] ?? [] };
}

export const slotOfKey = (key: string): SlotId | undefined => PART_KEYS[key]?.slot;

export const keysOfSlot = (slot: SlotId): string[] => Object.values(PART_KEYS).filter(p => p.slot === slot).map(p => p.key);
