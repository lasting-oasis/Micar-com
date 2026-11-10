import { describe, expect, it } from 'vitest';
import { certify, isSlabbed, REQUIREMENT_LABELS } from './certification';
import { GRADE_CAP_REASONS, GRADE_FORMULA, GRADE_ITEM_LABELS, GRADE_WEIGHTS, TIER_NAMES, grade10Of, gradeFacts, gradePassport, snapshotOf, tierOf } from './grading';
import { baseStats } from './normalize';
import { addEvent, createPassport, transferOwnership } from './passport';
import { emptySpec } from './specs';
import { CERTIFICATION_LEVELS, GRADE_CATEGORIES } from './types';
import type { Attachment, AttestationScope, Passport, Sourced, VehicleSpec, VerifierRegistry } from './types';
import { EMPTY_REGISTRY, recordAttestation, voidEvent } from './verification';

/* ------------------------------------------------------------------ fixtures ---- */

const OWNER = 'owner-one';
const NOW = '2026-11-10T12:00:00.000Z';
const TODAY = '2026-11-10';
const VIN = '1M8GDM9AXKP042788'; // a well-known valid VIN; the K in position 10 is model year 1989 or 2019
const REGISTRY: VerifierRegistry = {
  verifiers: [
    { id: 'inspector-ann', kind: 'inspector', name: 'Ann Inspector', active: true, scopes: ['identity', 'mileage', 'documentation', 'condition', 'originality', 'modification', 'specification', 'one-of-one'] },
    { id: 'shop-bob', kind: 'shop', name: 'Bob’s Shop', active: true, scopes: ['documentation', 'modification'] },
  ],
};

const ref = { kind: 'reference', name: 'fixture', asOf: TODAY } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });
const civic = (over: Partial<VehicleSpec> = {}): VehicleSpec => ({
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), horsepower: s(158), torqueLbFt: s(138), transmissionType: s('cvt'), drivetrain: s('FWD'),
  curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), ...over,
});

let n = 0;
const id = () => `e${++n}`;
const file = (kind: Attachment['kind'], name = 'file'): Attachment => ({ id: id(), kind, name: `${name}.jpg`, mime: 'image/jpeg', size: 1000, sha256: null });

const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const parked = (vin = VIN, spec = civic()): Passport => ok(createPassport({ micarId: 'MC-0000-0000-0000', now: '2024-01-02T09:00:00.000Z', ownerId: OWNER, spec, vin, eventId: id() }));
const add = (p: Passport, event: Record<string, unknown>, now = NOW): Passport =>
  ok(addEvent(p, { id: id(), mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...event }, { now, by: OWNER }));
const attest = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, verifierId = 'inspector-ann'): Passport =>
  ok(recordAttestation(p, { id: id(), verifierId, scope, date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over }, REGISTRY, { now: NOW, eventId: id() }));

const score = (p: Passport, registry: VerifierRegistry = REGISTRY, asOf = TODAY) => gradePassport(p, registry, asOf);
const points = (p: Passport, itemId: string, registry: VerifierRegistry = REGISTRY) => {
  const report = score(p, registry);
  for (const k of GRADE_CATEGORIES) for (const it of report.categories[k].items) if (it.id === itemId) return it.points;
  throw new Error(`no item ${itemId}`);
};

/** A car with everything an owner can do alone: VIN, papers, photo set, twelve records over two years, mileage, declarations. */
function wellDocumented(): Passport {
  let p = parked();
  p = add(p, { type: 'photo', subject: 'exterior', date: '2026-01-06', attachments: [file('photo'), file('photo'), file('photo'), file('photo')] });
  p = add(p, { type: 'photo', subject: 'interior', date: '2026-01-06', attachments: [file('photo')] });
  p = add(p, { type: 'photo', subject: 'odometer', date: '2026-01-06', mileage: 60000, attachments: [file('photo')] });
  p = add(p, { type: 'photo', subject: 'vin-plate', date: '2026-01-06', attachments: [file('photo')] });
  p = add(p, { type: 'document', document: 'title', date: '2026-01-06', attachments: [file('title')] });
  p = add(p, { type: 'declaration', date: '2026-01-06', condition: 'Excellent', accident: 'None', titleStatus: 'Clean', originality: 'stock' });
  for (let i = 0; i < 12; i++) {
    const month = 1 + ((i * 2) % 12), year = 2024 + Math.floor((i * 2) / 12);
    // From 2024-01-05 to the title document on 2026-01-06: twenty-four months of records.
    p = add(p, { type: 'maintenance', date: `${year}-${String(month).padStart(2, '0')}-05`, mileage: 30000 + i * 2500, shop: 'A shop', cost: 80, attachments: [file('receipt')] });
  }
  return p;
}

/* -------------------------------------------------------------------- the grade ---- */

describe('the grade', () => {
  it('weighs five categories that add up to one', () => {
    expect(Object.keys(GRADE_WEIGHTS).sort()).toEqual([...GRADE_CATEGORIES].sort());
    expect(Object.values(GRADE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(GRADE_FORMULA).toBe('micar-grade-v2');
  });

  it('keeps the ten tier names and the label rule the home page has always used', () => {
    expect(TIER_NAMES.slice(1)).toEqual(['Parts', 'Project', 'Rough', 'Worn', 'Daily', 'Driver', 'Clean', 'Garage-kept', 'Concours', 'Showroom']);
    expect(grade10Of(67.5)).toBe(6.8);
    expect(grade10Of(3)).toBe(1);
    expect(grade10Of(100)).toBe(10);
    expect(tierOf(6.8)).toBe(6);
    expect(tierOf(9.7)).toBe(9);
    expect(tierOf(9.8)).toBe(10);
    expect(tierOf(1)).toBe(1);
  });

  it('scores a car that was only just parked', () => {
    const report = score(parked(''));
    expect(report.categories.identity.score).toBe(10);
    expect(report.categories.documentation.score).toBe(5); // one owner: the chain is complete
    expect(report.categories.condition.score).toBe(0);
    expect(report.categories.originality.score).toBe(50);
    expect(report.categories.originality.capReason).toBe(GRADE_CAP_REASONS.undeclared);
    expect(report.categories.verification.score).toBe(0);
    expect(report.overall).toBe(10.8); // 10*.2 + 5*.25 + 0 + 50*.15
    expect(report.grade10).toBe(1.1);
    expect(report.discrepancies).toEqual([]);
  });

  it('reaches the most an owner can reach alone, and no further', () => {
    const report = score(wellDocumented());
    expect(report.categories.identity.score).toBe(55);
    expect(report.categories.documentation.score).toBe(100);
    expect(report.categories.condition.score).toBe(75);
    expect(report.categories.condition.capReason).toBe(GRADE_CAP_REASONS.photographed);
    expect(report.categories.originality.score).toBe(85);
    expect(report.categories.verification.score).toBe(0);
    expect(report.overall).toBe(67.5);
    expect(report.grade10).toBe(6.8);
    expect(report.tierName).toBe('Driver');
  });

  it('gives every item a label and never more than its maximum', () => {
    const report = score(wellDocumented());
    for (const k of GRADE_CATEGORIES) {
      for (const it of report.categories[k].items) {
        expect(GRADE_ITEM_LABELS[it.id], it.id).toBe(it.label);
        if (it.max > 0) expect(it.points, it.id).toBeLessThanOrEqual(it.max);
      }
      expect(report.categories[k].score).toBeGreaterThanOrEqual(0);
      expect(report.categories[k].score).toBeLessThanOrEqual(100);
    }
  });

  it('is the same for two cars with the same paperwork and different performance', () => {
    const slow = wellDocumented();
    const fast: Passport = { ...slow, spec: civic({ horsepower: s(900), torqueLbFt: s(800), zeroToSixtySec: s(2.4), topSpeedMph: s(220) }) };
    expect(baseStats(fast.spec).scores.power.value).not.toBe(baseStats(slow.spec).scores.power.value);
    expect(score(fast)).toEqual(score(slow));
  });

  it('does not change the passport it reads and gives the same answer twice', () => {
    const p = wellDocumented();
    const before = JSON.stringify(p);
    expect(score(p)).toEqual(score(p));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('identity and authenticity', () => {
  it('counts a well-formed VIN, its model year, its photo, the papers, the title and the photos', () => {
    let p = parked('');
    expect(points(p, 'id.vin')).toBe(0);
    p = parked();
    expect(points(p, 'id.vin')).toBe(15);
    expect(points(p, 'id.vin-year')).toBe(5);
    expect(points(p, 'id.vin-photo')).toBe(0);
    p = add(p, { type: 'photo', subject: 'vin-plate', date: '2026-02-01', attachments: [file('photo')] });
    expect(points(p, 'id.vin-photo')).toBe(5);
    p = add(p, { type: 'document', document: 'registration', date: '2026-02-01', attachments: [file('registration')] });
    expect(points(p, 'id.papers')).toBe(10);
    p = add(p, { type: 'declaration', date: '2026-02-01', condition: null, accident: null, titleStatus: 'Rebuilt', originality: null });
    expect(points(p, 'id.title')).toBe(2);
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-01', attachments: [file('photo'), file('photo'), file('photo')] });
    expect(points(p, 'id.photos')).toBe(0);
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-02', attachments: [file('photo')] });
    expect(points(p, 'id.photos')).toBe(5);
  });

  it('does not count papers with no file behind them', () => {
    const p = add(parked(), { type: 'document', document: 'title', date: '2026-02-01' });
    expect(points(p, 'id.papers')).toBe(0);
  });

  it('reports a VIN that fails its own check digit and gives it nothing', () => {
    const p = parked('1M8GDM9A1KP042788');
    const report = score(p);
    expect(points(p, 'id.vin')).toBe(0);
    expect(report.discrepancies.map((d) => d.id)).toEqual(['vin-check-digit']);
  });

  it('reports a VIN coded for another model year', () => {
    const p = parked(VIN, civic({ identity: { year: 2021, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' } }));
    expect(score(p).discrepancies.map((d) => d.id)).toEqual(['vin-year-mismatch']);
    expect(points(p, 'id.vin-year')).toBe(0);
    expect(points(p, 'id.vin')).toBe(15);
  });

  it('gives identity verification only to an independent attestation', () => {
    const p = wellDocumented();
    expect(points(p, 'id.verified')).toBe(0);
    expect(points(attest(p, 'identity'), 'id.verified')).toBe(45);
    expect(score(attest(p, 'identity')).categories.identity.score).toBe(100);
  });
});

describe('documentation and history', () => {
  it('counts documented records up to twelve and the months they cover up to twenty-four', () => {
    let p = parked();
    p = add(p, { type: 'maintenance', date: '2026-03-01', shop: '', cost: null, attachments: [file('receipt')] });
    expect(points(p, 'doc.records')).toBe(3.3);
    expect(points(p, 'doc.span')).toBe(0);
    p = add(p, { type: 'repair', date: '2026-09-01', system: null, work: 'repair', shop: '', cost: null, attachments: [file('invoice')] });
    expect(points(p, 'doc.records')).toBe(6.7);
    expect(points(p, 'doc.span')).toBe(6.3); // six months of twenty-four
    expect(points(p, 'doc.receipts')).toBe(10);
  });

  it('counts a file once however many records it is attached to', () => {
    const copy = (sha: string, kind: Attachment['kind'] = 'receipt'): Attachment => ({ ...file(kind), sha256: sha.repeat(64).slice(0, 64) });
    let p = parked();
    // One receipt, uploaded to twelve maintenance entries: one documented record, not twelve.
    for (let i = 0; i < 12; i++) p = add(p, { type: 'maintenance', date: `2025-${String(i + 1).padStart(2, '0')}-05`, shop: '', cost: null, attachments: [copy('a')] });
    expect(gradeFacts(p, REGISTRY, TODAY).records).toHaveLength(1);
    expect(points(p, 'doc.records')).toBeCloseTo((1 / 12) * 40, 1);
    expect(certify(p, score(p), REGISTRY, TODAY).requirements.filter((r) => r.id === 'doc.records')[0].met).toBe(false);
    // A record with the old receipt and a new one has a file of its own, and counts.
    p = add(p, { type: 'repair', date: '2026-02-01', system: null, work: 'repair', shop: '', cost: null, attachments: [copy('a', 'invoice'), copy('b', 'invoice')] });
    p = add(p, { type: 'repair', date: '2026-03-01', system: null, work: 'repair', shop: '', cost: null, attachments: [copy('b', 'invoice')] });
    expect(gradeFacts(p, REGISTRY, TODAY).records).toHaveLength(2);
    // Files with no fingerprint cannot be compared, so each counts.
    let q = parked();
    for (let i = 0; i < 3; i++) q = add(q, { type: 'maintenance', date: `2025-0${i + 1}-05`, shop: '', cost: null, attachments: [file('receipt')] });
    expect(gradeFacts(q, REGISTRY, TODAY).records).toHaveLength(3);
  });

  it('counts a photograph once however many times it is uploaded', () => {
    const shot = (sha: string): Attachment => ({ ...file('photo'), sha256: sha.repeat(64).slice(0, 64) });
    let p = parked();
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-01-06', attachments: [shot('a'), shot('a'), shot('a'), shot('a')] });
    expect(gradeFacts(p, REGISTRY, TODAY).photos.exterior).toBe(1);
    expect(points(p, 'id.photos')).toBe(0);
    // The same picture again under another subject is still that picture.
    p = add(p, { type: 'photo', subject: 'interior', date: '2026-01-07', attachments: [shot('a')] });
    expect(gradeFacts(p, REGISTRY, TODAY).photos.interior).toBe(0);
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-01-08', attachments: [shot('b'), shot('c'), shot('d')] });
    expect(gradeFacts(p, REGISTRY, TODAY).photos.exterior).toBe(4);
    expect(points(p, 'id.photos')).toBe(5);
  });

  it('does not count a record with no file', () => {
    const p = add(parked(), { type: 'maintenance', date: '2026-03-01', shop: '', cost: null });
    expect(points(p, 'doc.records')).toBe(0);
    expect(points(p, 'doc.receipts')).toBe(0);
  });

  it('rewards a consistent mileage log and catches a rollback', () => {
    let p = add(parked(), { type: 'mileage', date: '2026-02-01', mileage: 50000 });
    expect(points(p, 'doc.mileage')).toBe(4);
    p = add(p, { type: 'mileage', date: '2026-06-01', mileage: 54000 });
    expect(points(p, 'doc.mileage')).toBe(10);
    const rolled = add(p, { type: 'mileage', date: '2026-09-01', mileage: 41000 });
    expect(points(rolled, 'doc.mileage')).toBe(0);
    expect(score(rolled).discrepancies.map((d) => d.id)).toEqual(['odometer-rollback']);
    // A corrected reading on the same day is not a rollback.
    const corrected = add(p, { type: 'mileage', date: '2026-06-01', mileage: 53900 });
    expect(score(corrected).discrepancies).toEqual([]);
  });

  it('wants a file behind every transfer before it calls the chain documented', () => {
    const p = wellDocumented();
    expect(points(p, 'doc.ownership')).toBe(5);
    const bare = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: TODAY }, { now: NOW, by: OWNER }));
    expect(points(bare, 'doc.ownership')).toBe(0);
    const withBill = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: TODAY, attachments: [file('other', 'bill-of-sale')] }, { now: NOW, by: OWNER }));
    expect(points(withBill, 'doc.ownership')).toBe(5);
  });

  it('takes ten points off for each record a verifier withdraws, and says so', () => {
    let p = wellDocumented();
    const target = p.events.filter((e) => e.type === 'maintenance')[0].id;
    p = attest(p, 'documentation', { id: 'att-doc', events: [target] });
    const before = score(p).categories.documentation.score;
    p = ok(voidEvent(p, { target, reason: 'The shop has no such invoice', attestationId: 'att-doc' }, REGISTRY, { now: NOW, eventId: id() }));
    const after = score(p);
    expect(after.categories.documentation.score).toBeLessThan(before);
    expect(points(p, 'doc.voided')).toBe(-10);
    expect(after.discrepancies.map((d) => d.id)).toContain('voided-record');
  });

  it('does not hold it against the owner when a verifier takes back its own attestation', () => {
    let p = wellDocumented();
    p = attest(p, 'identity', { id: 'att-identity' });
    const identityEvent = p.events[p.events.length - 1].id;
    const before = score(p);
    expect(points(p, 'id.verified')).toBe(45);
    p = ok(voidEvent(p, { target: identityEvent, reason: 'Wrong car on the lift', attestationId: 'att-identity' }, REGISTRY, { now: NOW, eventId: id() }));
    const after = score(p);
    expect(points(p, 'id.verified')).toBe(0);
    expect(points(p, 'doc.voided')).toBe(0);
    expect(after.discrepancies).toEqual([]);
    expect(after.categories.documentation.score).toBe(before.categories.documentation.score);
    expect(gradeFacts(p, REGISTRY, TODAY).voided).toEqual([]);
  });
});

describe('physical condition', () => {
  it('caps a self-reported condition at 60, and at 75 with the full photo set', () => {
    let p = add(parked(), { type: 'declaration', date: '2026-02-01', condition: 'Excellent', accident: null, titleStatus: null, originality: null });
    expect(score(p).categories.condition.score).toBe(60);
    expect(score(p).categories.condition.capReason).toBe(GRADE_CAP_REASONS.selfReported);
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-01', attachments: [file('photo'), file('photo'), file('photo'), file('photo')] });
    p = add(p, { type: 'photo', subject: 'interior', date: '2026-02-01', attachments: [file('photo')] });
    expect(score(p).categories.condition.score).toBe(60);
    p = add(p, { type: 'photo', subject: 'odometer', date: '2026-02-01', attachments: [file('photo')] });
    expect(score(p).categories.condition.score).toBe(75);
  });

  it('takes a declared accident off the declared condition', () => {
    const base = { type: 'declaration', date: '2026-02-01', titleStatus: null, originality: null };
    expect(score(add(parked(), { ...base, condition: 'Good', accident: 'None' })).categories.condition.score).toBe(60);
    expect(score(add(parked(), { ...base, condition: 'Good', accident: 'Minor' })).categories.condition.score).toBe(55);
    expect(score(add(parked(), { ...base, condition: 'Good', accident: 'Major' })).categories.condition.score).toBe(35);
    expect(score(add(parked(), { ...base, condition: 'Poor', accident: 'Major' })).categories.condition.score).toBe(0);
    expect(score(add(parked(), { ...base, condition: 'Fair', accident: null })).categories.condition.score).toBe(50);
  });

  it('uses the newest declaration', () => {
    let p = add(parked(), { type: 'declaration', date: '2026-02-01', condition: 'Fair', accident: null, titleStatus: null, originality: null });
    p = add(p, { type: 'declaration', date: '2026-05-01', condition: 'Poor', accident: null, titleStatus: null, originality: null });
    expect(score(p).categories.condition.score).toBe(25);
  });

  it('lets an independent inspection replace the self-report, uncapped while it is fresh', () => {
    let p = add(parked(), { type: 'declaration', date: '2026-02-01', condition: 'Excellent', accident: null, titleStatus: null, originality: null });
    p = attest(p, 'condition', { conditionScore: 91, date: '2026-10-01' });
    const fresh = score(p);
    expect(fresh.categories.condition.score).toBe(91);
    expect(fresh.categories.condition.cap).toBeNull();
    // Eighteen months on, the same inspection counts up to 85.
    const later = score(p, REGISTRY, '2028-04-15');
    expect(later.categories.condition.score).toBe(85);
    expect(later.categories.condition.capReason).toBe(GRADE_CAP_REASONS.oldInspection);
  });
});

describe('originality and modifications', () => {
  it('stays at 50 until the owner says whether the car is stock', () => {
    expect(score(parked()).categories.originality.score).toBe(50);
    const stock = add(parked(), { type: 'declaration', date: '2026-02-01', condition: null, accident: null, titleStatus: null, originality: 'stock' });
    expect(score(stock).categories.originality.score).toBe(85);
    expect(score(stock).categories.originality.capReason).toBe(GRADE_CAP_REASONS.unverifiedOriginality);
    expect(score(attest(stock, 'originality')).categories.originality.score).toBe(100);
  });

  it('takes a fitted modification’s cost off, less when it is documented, and gives it back when it is removed', () => {
    const install = { type: 'modification', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: 'kit', undoes: null, date: '2026-03-01' };
    const declared = add(parked(), install);
    expect(score(declared).categories.originality.score).toBe(74); // 100 - 26
    const documented = add(parked(), { ...install, attachments: [file('receipt')] });
    expect(score(documented).categories.originality.score).toBe(80.5); // 100 - 26 * 0.75
    const installId = declared.events[declared.events.length - 1].id;
    const removed = add(declared, { type: 'modification', action: 'remove', category: 'turbo', tier: 2, install: 'professional', parts: '', undoes: installId, date: '2026-06-01' });
    expect(score(removed).categories.originality.score).toBe(85);
  });

  it('takes ten off for a restoration with parts that are not original', () => {
    let p = add(parked(), { type: 'declaration', date: '2026-02-01', condition: null, accident: null, titleStatus: null, originality: 'stock' });
    p = attest(p, 'originality');
    p = add(p, { type: 'restoration', date: '2026-03-01', scope: 'Repaint', oemParts: false });
    expect(score(p).categories.originality.score).toBe(90);
    p = add(p, { type: 'restoration', date: '2026-04-01', scope: 'Interior', oemParts: true });
    expect(score(p).categories.originality.score).toBe(90);
  });
});

describe('verification', () => {
  it('is zero whatever an owner uploads or declares', () => {
    const p = wellDocumented();
    expect(score(p).categories.verification.score).toBe(0);
    expect(score(p, EMPTY_REGISTRY).categories.verification.score).toBe(0);
    for (const it of score(p).categories.verification.items) expect(it.points).toBe(0);
  });

  it('adds up only what independent verifiers attest', () => {
    let p = wellDocumented();
    p = attest(p, 'identity');
    expect(score(p).categories.verification.score).toBe(30);
    p = attest(p, 'mileage', { mileage: 60000 });
    expect(score(p).categories.verification.score).toBe(40);
    p = attest(p, 'documentation', { events: [p.events[10].id] }, 'shop-bob');
    expect(score(p).categories.verification.score).toBe(60);
    p = attest(p, 'condition', { conditionScore: 88 });
    expect(score(p).categories.verification.score).toBe(85);
    p = attest(p, 'originality');
    expect(score(p).categories.verification.score).toBe(100);
  });

  it('counts nothing from a registry that does not know the verifier', () => {
    const p = attest(attest(wellDocumented(), 'identity'), 'condition', { conditionScore: 88 });
    expect(score(p, EMPTY_REGISTRY).categories.verification.score).toBe(0);
    expect(score(p, EMPTY_REGISTRY).categories.identity.score).toBe(55);
    expect(score(p, EMPTY_REGISTRY).categories.condition.score).toBe(75);
  });

  it('counts an old inspection at half weight and then not at all', () => {
    const p = attest(wellDocumented(), 'condition', { conditionScore: 88, date: '2026-10-01' });
    expect(points(p, 'ver.condition')).toBe(25);
    expect(score(p, REGISTRY, '2028-04-15').categories.verification.score).toBe(12.5);
    expect(score(p, REGISTRY, '2029-01-15').categories.verification.score).toBe(0);
  });
});

describe('a receipt is paperwork, not horsepower', () => {
  it('moves Documentation and no attribute', () => {
    const before = parked();
    const after = add(before, { type: 'maintenance', date: '2026-03-01', shop: 'A shop', cost: 120, attachments: [file('receipt')] });
    expect(score(after).categories.documentation.score).toBeGreaterThan(score(before).categories.documentation.score);
    expect(after.spec).toEqual(before.spec);
    expect(baseStats(after.spec)).toEqual(baseStats(before.spec));
  });
});

describe('snapshots', () => {
  it('freeze a report with its formula and level', () => {
    const report = score(wellDocumented());
    const snap = snapshotOf(report, 'documented', { id: 'snap-1', at: NOW, reason: 'Maintenance', events: 18 });
    expect(snap).toEqual({
      id: 'snap-1', at: NOW, asOf: TODAY, reason: 'Maintenance', formula: 'micar-grade-v2', overall: 67.5, grade10: 6.8, tier: 6,
      categories: { identity: 55, documentation: 100, condition: 75, originality: 85, verification: 0 }, level: 'documented', events: 18,
    });
  });
});

/* -------------------------------------------------------------- certification ---- */

describe('certification levels', () => {
  const level = (p: Passport, registry: VerifierRegistry = REGISTRY, asOf = TODAY) => certify(p, gradePassport(p, registry, asOf), registry, asOf);

  it('starts at Registered and lists what Documented needs', () => {
    const c = level(parked(''));
    expect(c.level).toBe('registered');
    expect(c.next).toBe('documented');
    expect(c.missing.map((r) => r.id)).toEqual(['doc.vin', 'doc.records', 'doc.photos', 'doc.mileage', 'doc.scores']);
    expect(c.requirements.filter((r) => r.id === 'doc.records')[0].detail).toBe('0 of 3');
    expect(isSlabbed('registered')).toBe(false);
    expect(isSlabbed('documented')).toBe(true);
  });

  it('labels every requirement and covers all four levels', () => {
    const c = level(wellDocumented());
    expect([...new Set(c.requirements.map((r) => r.level))]).toEqual([...CERTIFICATION_LEVELS]);
    for (const r of c.requirements) expect(REQUIREMENT_LABELS[r.id]).toBe(r.label);
  });

  it('reaches Documented with three records, four exterior photos, a VIN and a mileage reading', () => {
    let p = parked();
    p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-01', attachments: [file('photo'), file('photo'), file('photo'), file('photo')] });
    p = add(p, { type: 'document', document: 'title', date: '2026-02-01', attachments: [file('title')] });
    p = add(p, { type: 'mileage', date: '2026-02-01', mileage: 48000 });
    expect(level(p).level).toBe('registered'); // one documented record so far
    p = add(p, { type: 'maintenance', date: '2026-03-01', shop: '', cost: null, attachments: [file('receipt')] });
    expect(level(p).level).toBe('registered');
    expect(level(p).requirements.filter((r) => r.id === 'doc.records')[0].detail).toBe('2 of 3');
    p = add(p, { type: 'maintenance', date: '2026-06-01', shop: '', cost: null, attachments: [file('receipt')] });
    const c = level(p);
    expect(c.level).toBe('documented');
    expect(c.next).toBe('verified');
    expect(c.missing.map((r) => r.id)).toEqual(['ver.identity', 'ver.second', 'ver.score']);
  });

  it('cannot be Documented with an odometer rollback or a bad VIN', () => {
    const good = wellDocumented();
    expect(level(good).level).toBe('documented');
    const rolled = add(good, { type: 'mileage', date: '2026-11-01', mileage: 100 });
    expect(level(rolled).level).toBe('registered');
    expect(level(rolled).missing.map((r) => r.id)).toContain('doc.clean');
    const badVin: Passport = { ...good, vin: '1M8GDM9A1KP042788' };
    expect(level(badVin).level).toBe('registered');
    expect(level(badVin).missing.map((r) => r.id)).toContain('doc.vin');
  });

  it('never reaches Verified on uploads alone', () => {
    const c = level(wellDocumented());
    expect(c.level).toBe('documented');
    expect(level(wellDocumented(), EMPTY_REGISTRY).level).toBe('documented');
  });

  it('reaches Verified with identity and a second independent check', () => {
    let p = attest(wellDocumented(), 'identity');
    expect(level(p).level).toBe('documented'); // Verification is 30, and nothing second
    p = attest(p, 'mileage', { mileage: 60000 });
    expect(level(p).level).toBe('verified');
    // The same passport with no registry is back to what the owner did alone.
    expect(level(p, EMPTY_REGISTRY).level).toBe('documented');
  });

  it('reaches Certified only with an in-person inspection in the last twelve months, records and originality verified', () => {
    let p = attest(attest(wellDocumented(), 'identity'), 'mileage', { mileage: 60000 });
    p = attest(p, 'documentation', { events: [p.events[10].id] });
    p = attest(p, 'originality');
    const remote = attest(p, 'condition', { conditionScore: 90, inPerson: false, date: '2026-10-01' });
    expect(level(remote).level).toBe('verified');
    expect(level(remote).missing.map((r) => r.id)).toEqual(['cert.inspection']);
    const inPerson = attest(p, 'condition', { conditionScore: 90, inPerson: true, date: '2026-10-01' });
    expect(level(inPerson).level).toBe('certified');
    expect(level(inPerson).next).toBeNull();
    expect(level(inPerson).missing).toEqual([]);
    // Thirteen months later the inspection no longer certifies.
    expect(level(inPerson, REGISTRY, '2027-11-15').level).toBe('verified');
  });

  it('gathers its facts once when handed them', () => {
    const p = wellDocumented();
    const facts = gradeFacts(p, REGISTRY, TODAY);
    const report = gradePassport(p, REGISTRY, TODAY, facts);
    expect(certify(p, report, REGISTRY, TODAY, facts)).toEqual(certify(p, report, REGISTRY, TODAY));
    expect(facts.records).toHaveLength(13);
  });
});
