// The card behind the door: a CarRecord valued by the engine, plus the MiCar grade math.
// Everything on the home page is computed from one of these, so the visitor's own car
// carries through every section.
import { emptyRecord, encodeRecord, recordInputs, type CarRecord } from '../car/record';
import { retention, snapshot, type Snapshot } from '../car/value';
import { modelsForMake, findModel } from '../engine/models';
import { stickerFor } from '../engine/stickers';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---- Grade -------------------------------------------------------------------------------

export const TIERS = ['', 'Parts', 'Project', 'Rough', 'Worn', 'Daily', 'Driver', 'Clean', 'Garage-kept', 'Concours', 'Showroom'];
const COND_SCORE: Record<string, number> = { Excellent: 10, Good: 7.5, Fair: 5, Poor: 2.5 };

export type GradeInputs = {
  cond: string; acc: number; curve: number; miles: number;
  entries: number; months: number; receipts: boolean; photo: boolean; verified: boolean;
};
export type Grade = { C: number; K: number; T: number; M: number; G: number; tier: number; name: string; slabbed: boolean; foil: number };

/** Condition 30%, curve 30%, trail 30%, miles 10%. Three entries put the card in the case. */
export function gradeOf(g: GradeInputs): Grade {
  const C = Math.max(0, (COND_SCORE[g.cond] ?? 7.5) - (g.acc >= 2 ? 4 : g.acc === 1 ? 2 : 0));
  const K = clamp(6 + 0.4 * g.curve, 0, 10);
  const T = clamp((Math.min(g.entries * (g.verified ? 2 : 1), 12) / 12) * 5 + (Math.min(g.months, 24) / 24) * 3 + (g.receipts ? 1 : 0) + (g.photo ? 1 : 0), 0, 10);
  const M = clamp(5 - g.miles / 8, 0, 10);
  const G = Math.round((0.3 * C + 0.3 * K + 0.3 * T + 0.1 * M) * 10) / 10;
  const tier = G >= 9.75 ? 10 : Math.max(1, Math.floor(G));
  return { C, K, T, M, G, tier, name: TIERS[tier], slabbed: g.entries >= 3, foil: clamp((G - 6) / 4, 0, 1) };
}

export const finishOf = (g: Grade) => (!g.slabbed ? 'raw' : g.tier >= 10 ? 'rainbow' : g.tier >= 9 ? 'holo' : g.tier >= 7 ? 'blue' : 'standard');

// ---- The card ----------------------------------------------------------------------------

/** Category render and body-type colour for a record's body style (one colour per category, so a card reads from across the room). */
export const CATEGORY: Record<string, { render: string; color: string }> = {
  'Sedan': { render: 'sedan', color: '#3f6fb5' },
  'SUV / Crossover': { render: 'suv', color: '#2f3a46' },
  'Pickup Truck': { render: 'truck', color: '#c8692a' },
  'Coupe / Sports': { render: 'coupe', color: '#b43a3a' },
  'Hatchback / Wagon': { render: 'hatchback', color: '#4f9a6a' },
  'Minivan': { render: 'van', color: '#e9ecef' },
};
export const categoryOf = (body: string) => CATEGORY[body] ?? CATEGORY['Sedan'];

export type Card = {
  r: CarRecord;
  snap: Snapshot;
  code: string;
  /** The grade inputs the engine can fill from the record alone; the trail starts empty. */
  g: GradeInputs;
  grade: Grade;
  /** Private-party value today. */
  value: number;
  /** % the model holds against its body-style peers at five years. */
  curvePct: number;
  /** % the odometer sits against the expected miles for the car's age. */
  milesPct: number;
  sample: boolean;
};

export function makeCard(r: CarRecord, now: Date, sample = false): Card | null {
  const snap = snapshot(r, now);
  if (!snap) return null;
  const ret = retention(r);
  const curvePct = clamp(Math.round(((ret.own - ret.typical) / ret.typical) * 100 * 10) / 10, -12, 12);
  const milesPct = clamp(Math.round(((r.mileage - snap.val.expectedMiles) / Math.max(1, snap.val.expectedMiles)) * 100), -40, 40);
  const g: GradeInputs = {
    cond: r.condition, acc: r.accident === 'Major' ? 2 : r.accident === 'Minor' ? 1 : 0, curve: curvePct, miles: milesPct,
    entries: 0, months: 0, receipts: false, photo: false, verified: false,
  };
  return { r, snap, code: encodeRecord(r), g, grade: gradeOf(g), value: snap.val.privateParty, curvePct, milesPct, sample };
}

/** What the visitor types on the door. */
export type DoorInput = { year: string; make: string; model: string; trim: string; mileage: string; condition: string; zip: string };

export function doorDefaults(now: Date): DoorInput {
  return { year: String(now.getFullYear() - 5), make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', mileage: '41200', condition: 'Excellent', zip: '' };
}

/** Keep model and trim valid for the make and year, the way the calculator does. */
export function settle(d: DoorInput, changed: keyof DoorInput): DoorInput {
  const next = { ...d };
  if (changed === 'make') {
    const first = modelsForMake(next.make)[0];
    next.model = first ? first.model : '';
    next.trim = '';
  }
  if (changed === 'model') next.trim = '';
  if (changed === 'make' || changed === 'model' || changed === 'year') {
    const st = stickerFor(next.make, next.model, Number(next.year));
    if (st && !st.year.trims.some((t) => t.trim === next.trim)) next.trim = st.year.trims[0].trim;
    if (!st) next.trim = '';
  }
  return next;
}

export function recordFrom(d: DoorInput, now: Date): CarRecord {
  const info = findModel(d.make, d.model);
  const year = Number(d.year) || now.getFullYear() - 5;
  return {
    ...emptyRecord(now), year, make: d.make, model: info ? d.model : '', modelText: info ? '' : d.model, trim: d.trim,
    body: info?.body ?? 'Sedan', mileage: Math.max(0, Math.round(Number(d.mileage) || 0)), price: 0, msrp: null,
    condition: d.condition, title: 'Clean', accident: 'None', zip: /^\d{5}$/.test(d.zip.trim()) ? d.zip.trim() : '', showValue: true, showForecast: true,
    features: [], notes: '',
  };
}

/** The sample car the page shows before a visitor opens the door. */
export function sampleCard(now: Date): Card | null {
  const r = { ...emptyRecord(now), year: 2021, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', body: 'Pickup Truck', mileage: 41200, price: 0, condition: 'Excellent', exterior: 'Army Green', features: [], notes: '' };
  const c = makeCard(r, now, true);
  return c;
}

export const canValue = (r: CarRecord, now: Date) => recordInputs(r, now) !== null;
