// The card behind the door: a CarRecord valued by the value engine, with the grade it would start at.
// Everything on the home page is computed from one of these, so the visitor's own car
// carries through every section.
import {
  EMPTY_REGISTRY, TIER_NAMES, addEvent, bodyClassFromValueBody, checkIdentity, createPassport, emptySpec, gradePassport, micarIdFromBytes,
} from '@micar/engine';
import type { GradeCategoryKey, GradeReport } from '@micar/engine';
import { emptyRecord, encodeRecord, recordInputs, type CarRecord } from '../car/record';
import { snapshot, type Snapshot } from '../car/value';
import { modelsForMake, findModel } from '../engine/models';
import { stickerFor } from '../engine/stickers';

// ---- Grade -------------------------------------------------------------------------------

/** The ten tier names a graded card carries. Index 0 is unused. */
export const TIERS = TIER_NAMES;

/** Beside a category the home page has no way to know. */
export const RAISE_IN_GARAGE = 'add records in the Garage to raise this';
/** Beside Verification: the one category nothing an owner adds can raise. */
export const RAISE_BY_VERIFIER = 'only an independent verifier can raise this';

/** What the home page is told that the grade reads: how the car is, whether it has been in an accident, and its miles. */
export type GradeInputs = { cond: string; accident: string; mileage: number };
export type Grade = {
  /** The engine's report: five categories, each 0 to 100, and the overall score they add up to. */
  report: GradeReport;
  /** The number on the label: a tenth of the overall score. */
  G: number;
  /** For each category the page cannot know, how it is raised. Empty for the one it was told. */
  notes: Record<GradeCategoryKey, string>;
};

const HOME = 'home-page';
const NOTES: Record<GradeCategoryKey, string> = {
  identity: RAISE_IN_GARAGE, documentation: RAISE_IN_GARAGE, condition: '', originality: RAISE_IN_GARAGE, verification: RAISE_BY_VERIFIER,
};

/**
 * The grade a car starts with: the MiCar grade itself (the engine's five categories, the same rules the Garage
 * uses), worked out for a passport that holds only what the home page is told. That is the car's name, one odometer
 * reading and the owner's word on its condition. The page knows nothing of its VIN, its papers, its photographs or
 * its records, so those categories start near the floor, and each says how it is raised. Nothing is stored.
 * Null when the record does not name a vehicle.
 */
export function startingGrade(r: CarRecord, g: GradeInputs, day: string): Grade | null {
  const identity = checkIdentity({ year: r.year, make: r.make, model: r.model || r.modelText, trim: r.trim, bodyClass: bodyClassFromValueBody(r.body) }, Number(day.slice(0, 4)));
  const id = micarIdFromBytes([0, 0, 0, 0, 0, 0, 0, 0]);
  if (!identity.ok || !id.ok) return null;
  const now = `${day}T12:00:00.000Z`;
  const made = createPassport({ micarId: id.value, now, ownerId: HOME, spec: emptySpec(identity.value), eventId: 'start' });
  if (!made.ok) return null;
  let passport = made.value;
  const write = (event: Record<string, unknown>) => {
    const added = addEvent(passport, { date: day, mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...event }, { now, by: HOME });
    if (added.ok) passport = added.value;
  };
  write({ id: 'miles', type: 'mileage', mileage: Math.max(0, Math.round(g.mileage)) });
  write({ id: 'condition', type: 'declaration', condition: g.cond, accident: g.accident, titleStatus: null, originality: null });
  const report = gradePassport(passport, EMPTY_REGISTRY, day);
  return { report, G: report.grade10, notes: NOTES };
}

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
  /** The day the card was made, on the visitor's calendar (YYYY-MM-DD). */
  day: string;
  /** What the record itself says of the things the grade reads. */
  g: GradeInputs;
  /** The grade the car starts with, from those. */
  grade: Grade;
  /** Private-party value today. */
  value: number;
  sample: boolean;
};

const two = (n: number) => (n < 10 ? `0${n}` : String(n));
const dayOf = (now: Date) => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;

export function makeCard(r: CarRecord, now: Date, sample = false): Card | null {
  const snap = snapshot(r, now);
  if (!snap) return null;
  const day = dayOf(now);
  const g: GradeInputs = { cond: r.condition, accident: r.accident, mileage: r.mileage };
  const grade = startingGrade(r, g, day);
  if (!grade) return null;
  return { r, snap, code: encodeRecord(r), day, g, grade, value: snap.val.privateParty, sample };
}

/** A card's starting grade with other inputs than its own (the grade section lets the visitor change them). */
export const gradeFor = (card: Card, g?: GradeInputs): Grade => (g ? startingGrade(card.r, g, card.day) ?? card.grade : card.grade);

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
