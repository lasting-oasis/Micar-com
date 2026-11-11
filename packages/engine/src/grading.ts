// The grading engine: layer C. Five categories, each scored 0 to 100 on its own: identity and authenticity,
// documentation and history, physical condition, originality and modifications, verification.
// It reads the passport and nothing else. It takes no attribute, no Power Rating and no price, so a fast car and a
// slow one with the same paperwork get the same grade. Everything an owner can do alone stops short of the
// Verification category: that one counts only attestations from independent verifiers the host has registered.
import { originalityCost, resolveModifications } from './modifications';
import type {
  AccidentHistory, ActiveModification, AttachmentKind, CategoryScore, CertificationLevel, ConditionBand, Discrepancy, GradeCategoryKey, GradeItem, GradeReport, GradeSnapshot,
  Passport, PassportEvent, PhotoSubject, TitleStatus, VerifierRegistry,
} from './types';
import { GRADE_CATEGORIES } from './types';
import { clamp, dayOf, monthsBetween, round1 } from './util';
import type { AttestationStatus, Standing } from './verification';
import { activeModifications, documentedRecords, mileageLog, standingOf } from './verification';
import { checkVin, vinMatchesYear } from './vin';

export const GRADE_FORMULA = 'micar-grade-v2';

/** How much each category counts toward the overall grade. They add up to 1. */
export const GRADE_WEIGHTS: Record<GradeCategoryKey, number> = { identity: 0.2, documentation: 0.25, condition: 0.25, originality: 0.15, verification: 0.15 };

/**
 * The most each category can score on what an owner does alone. Identity keeps 45 points for an independent check,
 * a self-reported condition stops at 75 even with the full photo set, originality stops at 85 until it is verified,
 * and Verification counts attestations only. The grade below is built so these hold; the tests check that they do.
 */
export const OWNER_CEILING: Record<GradeCategoryKey, number> = { identity: 55, documentation: 100, condition: 75, originality: 85, verification: 0 };

export const GRADE_CATEGORY_LABELS: Record<GradeCategoryKey, string> = {
  identity: 'Identity and authenticity',
  documentation: 'Documentation and history',
  condition: 'Physical condition',
  originality: 'Originality and modifications',
  verification: 'Verification',
};

/** The ten tier names the label has always used. Index 0 is unused. */
export const TIER_NAMES: readonly string[] = ['', 'Parts', 'Project', 'Rough', 'Worn', 'Daily', 'Driver', 'Clean', 'Garage-kept', 'Concours', 'Showroom'];

/** The label of every grade item, by id. The apps translate these. */
export const GRADE_ITEM_LABELS: Record<string, string> = {
  'id.vehicle': 'Year, make and model on record',
  'id.vin': 'VIN recorded and well formed',
  'id.vin-year': 'VIN agrees with the model year',
  'id.vin-photo': 'Photo of the VIN plate',
  'id.papers': 'Title or registration on file',
  'id.title': 'Title status declared',
  'id.photos': 'Exterior photographed from four sides',
  'id.verified': 'Identity verified by an independent party',
  'doc.records': 'Documented records',
  'doc.span': 'Months of history covered',
  'doc.receipts': 'Receipts or invoices attached',
  'doc.photos': 'Photographs attached',
  'doc.mileage': 'Mileage log consistent',
  'doc.ownership': 'Ownership chain documented',
  'doc.voided': 'Records withdrawn by a verifier',
  'cond.declared': 'Condition declared by the owner',
  'cond.photos': 'Full photo set (four exterior, interior, odometer)',
  'cond.inspected': 'Inspected by an independent party',
  'orig.declared': 'Originality declared',
  'orig.modifications': 'Modifications fitted',
  'orig.restoration': 'Restoration with parts that are not original',
  'orig.verified': 'Originality verified by an independent party',
  'ver.identity': 'Identity verified',
  'ver.mileage': 'Mileage verified',
  'ver.documentation': 'Records verified',
  'ver.condition': 'Condition inspected',
  'ver.originality': 'Originality verified',
};

/** Why a category is capped, by reason id. The apps translate these. */
export const GRADE_CAP_REASONS = {
  none: '',
  selfReported: 'Self-reported condition counts up to 60 until the photo set is complete.',
  photographed: 'Self-reported condition with a full photo set counts up to 75 until an independent inspection.',
  oldInspection: 'The inspection is more than 12 months old, so it counts up to 85.',
  undeclared: 'Say whether the vehicle is stock or modified to lift this above 50.',
  unverifiedOriginality: 'Originality counts up to 85 until an independent party verifies it.',
} as const;

/** What each discrepancy means, in a sentence. The apps translate these. */
export const DISCREPANCY_DETAILS: Record<Discrepancy['id'], string> = {
  'vin-check-digit': 'The VIN does not pass its own check digit.',
  'vin-year-mismatch': 'The VIN is coded for a different model year.',
  'odometer-rollback': 'A later mileage reading is lower than an earlier one.',
  'voided-record': 'A verifier withdrew a record.',
};

const CONDITION_POINTS = { Excellent: 100, Good: 75, Fair: 50, Poor: 25 } as const;
const ACCIDENT_POINTS = { None: 0, Minor: 20, Major: 40 } as const;
const TITLE_POINTS = { Clean: 5, Rebuilt: 2, Salvage: 0 } as const;

/* ---------------------------------------------------------------------- facts ---- */

/** Everything the grade and the certification levels need to know about a passport on one day, gathered once. */
export type GradeFacts = {
  asOf: string;
  /** Events dated on or before asOf that no verifier has withdrawn, in timeline order. */
  events: PassportEvent[];
  /** The owner's records a verifier has withdrawn. An attestation its own verifier took back is not one of them. */
  voided: string[];
  records: PassportEvent[];
  /** Different photographs of each subject. A picture uploaded twice (the same fingerprint) is counted once. */
  photos: Record<PhotoSubject, number>;
  attachments: Record<AttachmentKind, number>;
  hasPapers: boolean;
  /** The mileage log: one reading for each day that has any, in order, withdrawn entries left out. */
  readings: { date: string; mileage: number }[];
  /** How many different days carry a reading. */
  readingDays: number;
  /** True when a later day reads lower than an earlier day. A slipped digit corrected the same day is not one. */
  rollback: boolean;
  /** What the owner has most recently declared, each statement taken from the newest standing entry that makes it. */
  declaration: { condition: ConditionBand | null; accident: AccidentHistory | null; titleStatus: TitleStatus | null; originality: 'stock' | 'modified' | null };
  modifications: ActiveModification[];
  declaredOriginality: boolean;
  restorationsNotOem: number;
  transfersDocumented: boolean;
  attestations: AttestationStatus[];
  vin: { present: boolean; standard: boolean; pre1981: boolean; checkDigitValid: boolean; checkDigitInvalid: boolean; yearMatches: boolean | null };
};

const PHOTO_SUBJECTS: readonly PhotoSubject[] = ['exterior', 'interior', 'engine-bay', 'undercarriage', 'vin-plate', 'odometer', 'damage', 'other'];
const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['photo', 'receipt', 'invoice', 'report', 'title', 'registration', 'dyno', 'other'];

export function gradeFacts(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): GradeFacts {
  const counted = standing.attestations;
  const events = standing.events;
  const voided = standing.voided.filter((id) => passport.events.some((e) => e.id === id && e.type !== 'attestation'));

  const photos = {} as Record<PhotoSubject, number>;
  for (const s of PHOTO_SUBJECTS) photos[s] = 0;
  const attachments = {} as Record<AttachmentKind, number>;
  for (const k of ATTACHMENT_KINDS) attachments[k] = 0;
  let hasPapers = false, declaredOriginality = false, restorationsNotOem = 0, transfers = 0, transfersWithFile = 0;
  const declaration: GradeFacts['declaration'] = { condition: null, accident: null, titleStatus: null, originality: null };
  const pictures: Record<string, true> = {};
  for (const e of events) {
    if (e.type === 'declaration') {
      if (e.condition !== null) declaration.condition = e.condition;
      if (e.accident !== null) declaration.accident = e.accident;
      if (e.titleStatus !== null) declaration.titleStatus = e.titleStatus;
      if (e.originality !== null) declaration.originality = e.originality;
    }
    for (const a of e.attachments) attachments[a.kind] += 1;
    if (e.type === 'photo') {
      for (const a of e.attachments) {
        // The same picture uploaded again is one picture: four sides take four different files.
        if (a.sha256 !== null) {
          if (pictures[a.sha256] === true) continue;
          pictures[a.sha256] = true;
        }
        photos[e.subject] += 1;
      }
    }
    if (e.type === 'document' && (e.document === 'title' || e.document === 'registration') && e.attachments.length > 0) hasPapers = true;
    if (e.type === 'declaration' && e.originality !== null) declaredOriginality = true;
    if (e.type === 'modification') declaredOriginality = true;
    if (e.type === 'restoration' && !e.oemParts) restorationsNotOem += 1;
    if (e.type === 'transfer') { transfers += 1; if (e.attachments.length > 0) transfersWithFile += 1; }
  }

  const log = mileageLog(passport, registry, asOf, standing);
  const readings = log.days.map((r) => ({ date: r.date, mileage: r.mileage }));

  const vinText = passport.vin;
  const check = vinText ? checkVin(vinText) : null;
  const year = passport.spec.identity.year;
  return {
    asOf: standing.day, events, voided,
    records: documentedRecords(passport, registry, asOf, standing),
    photos, attachments, hasPapers,
    readings, readingDays: readings.length, rollback: log.rollback,
    declaration,
    modifications: resolveModifications(passport.spec, activeModifications(passport, registry, asOf, standing)).applied,
    declaredOriginality, restorationsNotOem,
    transfersDocumented: transfers === transfersWithFile,
    attestations: counted,
    vin: {
      present: vinText !== '',
      standard: check !== null && check.format === 'standard',
      pre1981: check !== null && check.format === 'pre-1981' && year < 1981,
      checkDigitValid: check !== null && check.format === 'standard' && check.checkDigit === 'valid',
      checkDigitInvalid: check !== null && check.format === 'standard' && check.checkDigit === 'invalid',
      yearMatches: check !== null && check.format === 'standard' && check.checkDigit === 'valid' ? vinMatchesYear(vinText, year) : null,
    },
  };
}

/** True when the vehicle has the full photo set: four exterior, one interior, one of the odometer. */
export const hasPhotoSet = (facts: GradeFacts): boolean => facts.photos.exterior >= 4 && facts.photos.interior >= 1 && facts.photos.odometer >= 1;

const attested = (facts: GradeFacts, scope: AttestationStatus['attestation']['scope']): AttestationStatus[] => facts.attestations.filter((s) => s.attestation.scope === scope);

/** The newest valid condition inspection that gave a score, or null. */
export function latestInspection(facts: GradeFacts): AttestationStatus | null {
  let best: AttestationStatus | null = null;
  for (const s of attested(facts, 'condition')) {
    if (s.attestation.conditionScore === null) continue;
    if (best === null || s.attestation.date > best.attestation.date) best = s;
  }
  return best;
}

/* ----------------------------------------------------------------- categories ---- */

// `|| 0` turns the -0 that a deduction of nothing would leave into a plain 0, so a page never prints "-0".
const item = (id: string, points: number, max: number, met?: boolean): GradeItem => ({ id, label: GRADE_ITEM_LABELS[id], points: round1(points) || 0, max, met: met ?? points >= max });

function category(key: GradeCategoryKey, items: GradeItem[], score: number, cap: number | null, capReason: string): CategoryScore {
  const limited = cap === null ? score : Math.min(score, cap);
  return { key, score: round1(clamp(limited, 0, 100)), cap, capReason, items };
}

function gradeIdentity(passport: Passport, facts: GradeFacts): CategoryScore {
  const id = passport.spec.identity;
  const title = facts.declaration.titleStatus;
  const items = [
    item('id.vehicle', id.year > 0 && id.make !== '' && id.model !== '' ? 10 : 0, 10),
    item('id.vin', facts.vin.checkDigitValid ? 15 : facts.vin.pre1981 ? 10 : 0, 15),
    item('id.vin-year', facts.vin.yearMatches === true ? 5 : 0, 5),
    item('id.vin-photo', facts.photos['vin-plate'] >= 1 ? 5 : 0, 5),
    item('id.papers', facts.hasPapers ? 10 : 0, 10),
    item('id.title', title === null ? 0 : TITLE_POINTS[title], 5),
    item('id.photos', facts.photos.exterior >= 4 ? 5 : 0, 5),
    item('id.verified', attested(facts, 'identity').length > 0 ? 45 : 0, 45),
  ];
  return category('identity', items, items.reduce((sum, i) => sum + i.points, 0), null, GRADE_CAP_REASONS.none);
}

function gradeDocumentation(passport: Passport, facts: GradeFacts): CategoryScore {
  const n = facts.records.length;
  let first = '', last = '';
  for (const r of facts.records) {
    if (first === '' || r.date < first) first = r.date;
    if (last === '' || r.date > last) last = r.date;
  }
  const months = n >= 2 ? Math.max(0, monthsBetween(first, last)) : 0;
  const mileage = facts.rollback ? 0 : facts.readingDays >= 2 ? 10 : facts.readingDays === 1 ? 4 : 0;
  const ownership = passport.owners.length <= 1 || facts.transfersDocumented ? 5 : 0;
  const withdrawn = -Math.min(30, facts.voided.length * 10);
  const items = [
    item('doc.records', (Math.min(n, 12) / 12) * 40, 40),
    item('doc.span', (Math.min(months, 24) / 24) * 25, 25),
    item('doc.receipts', facts.attachments.receipt + facts.attachments.invoice >= 1 ? 10 : 0, 10),
    item('doc.photos', facts.attachments.photo >= 1 ? 10 : 0, 10),
    item('doc.mileage', mileage, 10),
    item('doc.ownership', ownership, 5),
    item('doc.voided', withdrawn, 0, facts.voided.length === 0),
  ];
  return category('documentation', items, items.reduce((sum, i) => sum + i.points, 0), null, GRADE_CAP_REASONS.none);
}

function gradeCondition(facts: GradeFacts): CategoryScore {
  const band = facts.declaration.condition, accident = facts.declaration.accident;
  const declared = band === null ? 0 : Math.max(0, CONDITION_POINTS[band] - (accident === null ? 0 : ACCIDENT_POINTS[accident]));
  const photoSet = hasPhotoSet(facts);
  const inspection = latestInspection(facts);
  const items = [
    item('cond.declared', declared, 100, band !== null),
    item('cond.photos', 0, 0, photoSet),
    item('cond.inspected', inspection ? (inspection.attestation.conditionScore as number) : 0, 100, inspection !== null),
  ];
  if (inspection) {
    const old = inspection.weight < 1;
    return category('condition', items, inspection.attestation.conditionScore as number, old ? 85 : null, old ? GRADE_CAP_REASONS.oldInspection : GRADE_CAP_REASONS.none);
  }
  return category('condition', items, declared, photoSet ? 75 : 60, photoSet ? GRADE_CAP_REASONS.photographed : GRADE_CAP_REASONS.selfReported);
}

function gradeOriginality(facts: GradeFacts): CategoryScore {
  const verified = attested(facts, 'originality').length > 0;
  const cost = originalityCost(facts.modifications);
  const restoration = Math.min(20, facts.restorationsNotOem * 10);
  const items = [
    item('orig.declared', 0, 0, facts.declaredOriginality),
    item('orig.modifications', -cost, 0, facts.modifications.length === 0),
    item('orig.restoration', -restoration, 0, restoration === 0),
    item('orig.verified', 0, 0, verified),
  ];
  if (!facts.declaredOriginality) return category('originality', items, 50, 50, GRADE_CAP_REASONS.undeclared);
  return category('originality', items, 100 - cost - restoration, verified ? null : 85, verified ? GRADE_CAP_REASONS.none : GRADE_CAP_REASONS.unverifiedOriginality);
}

/** The Verification score alone, from the attestations that count. Nothing an owner writes is read. */
export const verificationScore = (facts: GradeFacts): number => gradeVerification(facts).score;

function gradeVerification(facts: GradeFacts): CategoryScore {
  const has = (scope: AttestationStatus['attestation']['scope']) => attested(facts, scope).length > 0;
  let conditionWeight = 0;
  for (const s of attested(facts, 'condition')) conditionWeight = Math.max(conditionWeight, s.weight);
  const items = [
    item('ver.identity', has('identity') ? 30 : 0, 30),
    item('ver.mileage', has('mileage') ? 10 : 0, 10),
    item('ver.documentation', has('documentation') ? 20 : 0, 20),
    item('ver.condition', 25 * conditionWeight, 25),
    item('ver.originality', has('originality') ? 15 : 0, 15),
  ];
  return category('verification', items, items.reduce((sum, i) => sum + i.points, 0), null, GRADE_CAP_REASONS.none);
}

function discrepanciesOf(facts: GradeFacts): Discrepancy[] {
  const out: Discrepancy[] = [];
  const add = (id: Discrepancy['id']) => out.push({ id, detail: DISCREPANCY_DETAILS[id] });
  if (facts.vin.checkDigitInvalid) add('vin-check-digit');
  if (facts.vin.yearMatches === false) add('vin-year-mismatch');
  if (facts.rollback) add('odometer-rollback');
  if (facts.voided.length > 0) add('voided-record');
  return out;
}

/* ------------------------------------------------------------------ the grade ---- */

/** The number on the label, from an overall score: a tenth of it, one decimal, never below 1.0. */
export const grade10Of = (overall: number): number => Math.max(1, round1(overall / 10));
/** The tier, 1 to 10. Showroom needs 9.75 or better. */
export const tierOf = (grade10: number): number => (grade10 >= 9.75 ? 10 : Math.max(1, Math.floor(grade10)));

/** Grades a passport as it stood on one day. Pure: the same passport, registry and day always give the same report. */
export function gradePassport(passport: Passport, registry: VerifierRegistry, asOf: string, facts: GradeFacts = gradeFacts(passport, registry, dayOf(asOf))): GradeReport {
  const categories: Record<GradeCategoryKey, CategoryScore> = {
    identity: gradeIdentity(passport, facts),
    documentation: gradeDocumentation(passport, facts),
    condition: gradeCondition(facts),
    originality: gradeOriginality(facts),
    verification: gradeVerification(facts),
  };
  let sum = 0;
  for (const k of GRADE_CATEGORIES) sum += categories[k].score * GRADE_WEIGHTS[k];
  const overall = round1(sum);
  const grade10 = grade10Of(overall);
  const tier = tierOf(grade10);
  return { formula: GRADE_FORMULA, asOf: dayOf(asOf), categories, overall, grade10, tier, tierName: TIER_NAMES[tier], discrepancies: discrepanciesOf(facts) };
}

/** A report frozen as a snapshot, ready to append to the passport. */
export function snapshotOf(report: GradeReport, level: CertificationLevel, ctx: { id: string; at: string; reason: string; events: number }): GradeSnapshot {
  const categories = {} as Record<GradeCategoryKey, number>;
  for (const k of GRADE_CATEGORIES) categories[k] = report.categories[k].score;
  return { id: ctx.id, at: ctx.at, asOf: report.asOf, reason: ctx.reason, formula: report.formula, overall: report.overall, grade10: report.grade10, tier: report.tier, categories, level, events: ctx.events };
}
