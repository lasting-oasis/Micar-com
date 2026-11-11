// The certification levels and the ceiling, one requirement at a time. grading.test.ts walks a car up the levels;
// here each requirement is taken away on its own from a car that otherwise holds the level, so every one of them is
// seen to do its own work, and the ceiling is checked against every combination of attestations that matters.
import { describe, expect, it } from 'vitest';
import { EXTERIOR_PHOTOS_FOR_DOCUMENTED, RECORDS_FOR_DOCUMENTED, attestedOn, certify, gradeCeiling, hasInPersonInspection, isSlabbed } from './certification';
import { OWNER_CEILING, gradeFacts, gradePassport } from './grading';
import { addEvent, createPassport } from './passport';
import { emptySpec } from './specs';
import type { Attachment, AttestationScope, CertificationLevel, Passport, Sourced, VehicleSpec, VerifierRegistry } from './types';
import { EMPTY_REGISTRY, recordAttestation, voidEvent } from './verification';

/* ------------------------------------------------------------------ fixtures ---- */

const OWNER = 'owner-one';
const NOW = '2026-11-10T12:00:00.000Z';
const TODAY = '2026-11-10';
const VIN = '1M8GDM9AXKP042788'; // valid; the K in position 10 is model year 1989 or 2019
const ALL: AttestationScope[] = ['identity', 'mileage', 'documentation', 'condition', 'originality', 'modification', 'specification', 'one-of-one'];
const REGISTRY: VerifierRegistry = { verifiers: [{ id: 'inspector-ann', kind: 'inspector', name: 'Ann Inspector', active: true, scopes: ALL }] };

const ref = { kind: 'reference', name: 'fixture', asOf: TODAY } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });
const civic = (over: Partial<VehicleSpec> = {}): VehicleSpec => ({
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), horsepower: s(158), curbWeightLb: s(2877), ...over,
});

let n = 0;
const id = () => `c${++n}`;
const file = (kind: Attachment['kind']): Attachment => ({ id: id(), kind, name: 'file.jpg', mime: 'image/jpeg', size: 1000, sha256: null });
const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const parked = (vin = VIN, spec = civic()): Passport => ok(createPassport({ micarId: 'MC-0000-0000-0000', now: '2024-01-02T09:00:00.000Z', ownerId: OWNER, spec, vin, eventId: id() }));
const add = (p: Passport, event: Record<string, unknown>, now = NOW): Passport =>
  ok(addEvent(p, { id: id(), mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...event }, { now, by: OWNER }));
const attest = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, now = NOW): Passport =>
  ok(recordAttestation(p, { id: id(), verifierId: 'inspector-ann', scope, date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over }, REGISTRY, { now, eventId: id() }));

const certified = (p: Passport, registry: VerifierRegistry = REGISTRY, asOf = TODAY) => certify(p, gradePassport(p, registry, asOf), registry, asOf);
const missing = (p: Passport, registry: VerifierRegistry = REGISTRY, asOf = TODAY): string[] => certified(p, registry, asOf).missing.map((r) => r.id);
const unmet = (p: Passport, level: CertificationLevel): string[] => certified(p).requirements.filter((r) => r.level === level && !r.met).map((r) => r.id);

/**
 * The parts of a car that just holds Documented. Each can be left out or replaced on its own.
 * The title on file is itself a documented record, so with it two service records make the three.
 */
type Parts = { vin?: string; photos?: number; services?: number; serviceFile?: Attachment['kind']; serviceDate?: string; reading?: boolean; papers?: boolean; title?: boolean };
function documentedCar(parts: Parts = {}, from?: Passport): Passport {
  const { vin = VIN, photos = EXTERIOR_PHOTOS_FOR_DOCUMENTED, services = RECORDS_FOR_DOCUMENTED - 1, serviceFile = 'receipt', serviceDate = '2026-03-01', reading = true, papers = true, title = true } = parts;
  let p = from ?? parked(vin);
  if (photos > 0) p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-01', attachments: Array.from({ length: photos }, () => file('photo')) });
  if (papers) p = add(p, { type: 'document', document: 'title', date: '2026-02-01', attachments: [file('title')] });
  if (title) p = add(p, { type: 'declaration', date: '2026-02-01', titleStatus: 'Clean' });
  if (reading) p = add(p, { type: 'mileage', date: '2026-02-01', mileage: 48000 });
  for (let i = 0; i < services; i++) p = add(p, { type: 'maintenance', date: serviceDate, shop: '', cost: null, attachments: [file(serviceFile)] });
  return p;
}

/** A car an owner has done everything for, ready for verifiers: every category an owner can lift is well above 60. */
function readyCar(from?: Passport): Passport {
  let p = documentedCar({ services: 0 }, from);
  p = add(p, { type: 'photo', subject: 'interior', date: '2026-02-01', attachments: [file('photo')] });
  p = add(p, { type: 'photo', subject: 'odometer', date: '2026-02-01', attachments: [file('photo')] });
  p = add(p, { type: 'declaration', date: '2026-02-01', condition: 'Excellent', accident: 'None', originality: 'stock' });
  for (let i = 0; i < 12; i++) p = add(p, { id: `service-${++n}`, type: 'maintenance', date: `${2024 + Math.floor(i / 6)}-${String(1 + (i % 6) * 2).padStart(2, '0')}-05`, shop: '', cost: null, attachments: [file('receipt')] });
  return p;
}
const aRecord = (p: Passport): string => p.events.filter((e) => e.type === 'maintenance')[0].id;
const INSPECTION = { conditionScore: 88, inPerson: true, date: '2026-10-01' };
/** Everything Certified asks for, each part of which a test can leave out. */
function certifiedCar(leave: { identity?: boolean; mileage?: boolean; records?: boolean; originality?: boolean; inspection?: Record<string, unknown> | null } = {}, from?: Passport): Passport {
  let p = readyCar(from);
  if (leave.identity !== false) p = attest(p, 'identity');
  if (leave.mileage !== false) p = attest(p, 'mileage', { mileage: 61000 });
  if (leave.records !== false) p = attest(p, 'documentation', { events: [aRecord(p)] });
  if (leave.originality !== false) p = attest(p, 'originality');
  if (leave.inspection !== null) p = attest(p, 'condition', { ...INSPECTION, ...(leave.inspection ?? {}) });
  return p;
}

/* ------------------------------------------------------------------ Registered ---- */

describe('Registered', () => {
  it('asks for a vehicle and an owner, and says which is missing when a hand-built passport has neither', () => {
    expect(certified(parked()).level).toBe('registered');
    expect(unmet(parked(), 'registered')).toEqual([]);
    const nameless: Passport = { ...parked(), spec: { ...civic(), identity: { ...civic().identity, make: '' } } };
    expect(unmet(nameless, 'registered')).toEqual(['reg.vehicle']);
    expect(certified(nameless)).toMatchObject({ level: 'registered', next: 'registered' });
    expect(missing(nameless)).toEqual(['reg.vehicle']);
    const ownerless: Passport = { ...parked(), owners: [] };
    expect(unmet(ownerless, 'registered')).toEqual(['reg.owner']);
    // A car that fails Registered holds nothing above it, whatever else it has.
    const built: Passport = { ...documentedCar(), owners: [] };
    expect(unmet(built, 'documented')).toEqual([]);
    expect(certified(built)).toMatchObject({ level: 'registered', next: 'registered' });
  });

  it('is a raw card: the case starts at Documented', () => {
    expect(isSlabbed('registered')).toBe(false);
    for (const level of ['documented', 'verified', 'certified'] as const) expect(isSlabbed(level)).toBe(true);
  });
});

/* ------------------------------------------------------------------ Documented ---- */

describe('Documented, one requirement at a time', () => {
  it('is held by a car with a VIN, three records, four photographs, a reading and the two scores', () => {
    const c = certified(documentedCar());
    expect(c).toMatchObject({ level: 'documented', next: 'verified' });
    expect(unmet(documentedCar(), 'documented')).toEqual([]);
    expect(RECORDS_FOR_DOCUMENTED).toBe(3);
    expect(EXTERIOR_PHOTOS_FOR_DOCUMENTED).toBe(4);
    // With no verifier anywhere it is the same car at the same level.
    expect(certified(documentedCar(), EMPTY_REGISTRY).level).toBe('documented');
  });

  it('needs the third record', () => {
    expect(gradeFacts(documentedCar(), REGISTRY, TODAY).records).toHaveLength(3);
    expect(missing(documentedCar({ services: 1 }))).toEqual(['doc.records']);
    expect(certified(documentedCar({ services: 1 })).level).toBe('registered');
    // Three service records with no title on file are three as well.
    expect(certified(documentedCar({ papers: false, services: 3 })).level).toBe('documented');
    expect(missing(documentedCar({ papers: false, services: 2 }))).toEqual(['doc.records']);
  });

  it('needs the fourth exterior photograph', () => {
    expect(missing(documentedCar({ photos: 3 }))).toEqual(['doc.photos']);
    expect(certified(documentedCar({ photos: 3 })).level).toBe('registered');
  });

  it('needs a mileage reading', () => {
    expect(missing(documentedCar({ reading: false }))).toEqual(['doc.mileage']);
  });

  it('needs a VIN, and one that passes its own checks', () => {
    // No VIN at all, and one too short for a car of this year: the requirement itself is unmet, whatever the scores do.
    expect(missing(documentedCar({ vin: '' }))).toContain('doc.vin');
    expect(missing(documentedCar({ vin: '1M8GDM9AXKP04278' }))).toContain('doc.vin');
    // A check digit that does not agree.
    expect(missing(documentedCar({ vin: '1M8GDM9A1KP042788' }))).toContain('doc.vin');
    // A well-formed VIN coded for another model year: everything else still holds, and this alone keeps the car Registered.
    const otherYear = documentedCar({ vin: '1HGCM82633A004352' });
    expect(gradePassport(otherYear, REGISTRY, TODAY).discrepancies.map((d) => d.id)).toEqual(['vin-year-mismatch']);
    expect(missing(otherYear)).toEqual(['doc.vin']);
    expect(certified(otherYear).level).toBe('registered');
  });

  it('needs a log with no rollback', () => {
    const rolled = add(documentedCar(), { type: 'mileage', date: '2026-06-01', mileage: 100 });
    expect(missing(rolled)).toEqual(['doc.clean']);
    expect(certified(rolled).level).toBe('registered');
  });

  it('needs no record withdrawn by a verifier', () => {
    // Six service records, so the ten points a withdrawal costs leave Documentation above 30: the withdrawal alone is what blocks.
    let p = documentedCar({ services: 6 });
    const [kept, bad] = p.events.filter((e) => e.type === 'maintenance').map((e) => e.id);
    p = attest(p, 'documentation', { id: 'records-attestation', events: [kept] });
    expect(certified(p).level).toBe('documented');
    p = ok(voidEvent(p, { target: bad, reason: 'No such invoice', attestationId: 'records-attestation' }, REGISTRY, { now: NOW, eventId: id() }));
    expect(gradePassport(p, REGISTRY, TODAY).categories.documentation.score).toBeGreaterThanOrEqual(30);
    expect(missing(p)).toEqual(['doc.clean']);
    expect(certified(p).level).toBe('registered');
  });

  it('needs Identity at 40', () => {
    // A VIN that agrees with the year and four photographs make 35. A title on file, or a title status declared, makes the rest.
    const bare = documentedCar({ papers: false, title: false, services: 3 });
    expect(gradePassport(bare, REGISTRY, TODAY).categories.identity.score).toBe(35);
    expect(missing(bare)).toEqual(['doc.scores']);
    const declared = documentedCar({ papers: false, services: 3 });
    expect(gradePassport(declared, REGISTRY, TODAY).categories.identity.score).toBe(40);
    expect(certified(declared).level).toBe('documented');
  });

  it('needs Documentation at 30', () => {
    // Three records the same day, none of them a receipt or an invoice: 10 for the records, 10 for the photographs,
    // 4 for one reading and 5 for the ownership chain make 29.
    const thin = documentedCar({ serviceFile: 'other', serviceDate: '2026-02-01' });
    expect(gradePassport(thin, REGISTRY, TODAY).categories.documentation.score).toBe(29);
    expect(missing(thin)).toEqual(['doc.scores']);
    expect(certified(thin).level).toBe('registered');
    // A second day's reading is six more points.
    expect(certified(add(thin, { type: 'mileage', date: '2026-03-01', mileage: 48500 })).level).toBe('documented');
  });
});

/* -------------------------------------------------------------------- Verified ---- */

describe('Verified, one requirement at a time', () => {
  it('is held with identity and one more independent check', () => {
    expect(certified(attest(attest(documentedCar(), 'identity'), 'mileage', { mileage: 48100 })).level).toBe('verified');
    const records = documentedCar();
    expect(certified(attest(attest(records, 'identity'), 'documentation', { events: [aRecord(records)] })).level).toBe('verified');
  });

  it('needs identity verified, however much else is', () => {
    // Mileage, records and an in-person inspection: 55 points of Verification and no identity.
    let p = documentedCar();
    p = attest(attest(attest(p, 'mileage', { mileage: 48100 }), 'documentation', { events: [aRecord(p)] }), 'condition', INSPECTION);
    expect(gradePassport(p, REGISTRY, TODAY).categories.verification.score).toBe(55);
    expect(missing(p)).toEqual(['ver.identity']);
    expect(certified(p).level).toBe('documented');
  });

  it('needs mileage or records verified as well, however much else is', () => {
    // Identity, originality and an in-person inspection: 70 points of Verification and no second check of the trail.
    const p = attest(attest(attest(documentedCar(), 'identity'), 'originality'), 'condition', INSPECTION);
    expect(gradePassport(p, REGISTRY, TODAY).categories.verification.score).toBe(70);
    expect(missing(p)).toEqual(['ver.second']);
    expect(certified(p).level).toBe('documented');
    // Identity alone is 30 points: short on both counts.
    expect(missing(attest(documentedCar(), 'identity'))).toEqual(['ver.second', 'ver.score']);
  });

  it('is not held without Documented, whatever verifiers have attested', () => {
    // Two records only. Identity and mileage are verified, and every Verified requirement is met.
    const p = attest(attest(documentedCar({ services: 1 }), 'identity'), 'mileage', { mileage: 48100 });
    expect(unmet(p, 'verified')).toEqual([]);
    expect(certified(p)).toMatchObject({ level: 'registered', next: 'documented' });
    expect(missing(p)).toEqual(['doc.records']);
  });
});

/* ------------------------------------------------------------------- Certified ---- */

describe('Certified, one requirement at a time', () => {
  it('is held with everything verified and an in-person inspection inside its year', () => {
    const c = certified(certifiedCar());
    expect(c).toMatchObject({ level: 'certified', next: null, missing: [] });
    expect(gradePassport(certifiedCar(), REGISTRY, TODAY).categories.verification.score).toBe(100);
    // The same file where the inspector is not registered is what its owner did alone.
    expect(certified(certifiedCar(), EMPTY_REGISTRY).level).toBe('documented');
  });

  it('needs the inspection made in person', () => {
    const p = certifiedCar({ inspection: { inPerson: false } });
    expect(missing(p)).toEqual(['cert.inspection']);
    expect(certified(p).level).toBe('verified');
    expect(missing(certifiedCar({ inspection: null }))).toEqual(['cert.inspection', 'cert.scores']);
  });

  it('needs the inspection less than twelve months old', () => {
    // Made thirteen months ago. It still counts by half, and Verification is 87.5: only its age is in the way.
    // The inspection is the first thing on the passport after parking; everything else was written this month.
    const made = { date: '2025-10-01' };
    const inspected = ok(recordAttestation(parked(), { id: id(), verifierId: 'inspector-ann', scope: 'condition', inPerson: true, conditionScore: 88, systems: null, mileage: null, events: [], note: '', signature: null, ...made }, REGISTRY, { now: '2025-10-02T12:00:00.000Z', eventId: id() }));
    const p = certifiedCar({ inspection: null }, inspected);
    expect(gradePassport(p, REGISTRY, TODAY).categories.verification.score).toBe(87.5);
    expect(hasInPersonInspection(gradeFacts(p, REGISTRY, TODAY))).toBe(false);
    expect(missing(p)).toEqual(['cert.inspection']);
    expect(certified(p).level).toBe('verified');
    // The day before its first birthday the same inspection was one Certified would take.
    expect(hasInPersonInspection(gradeFacts(p, REGISTRY, '2026-09-30'))).toBe(true);
    expect(hasInPersonInspection(gradeFacts(p, REGISTRY, '2026-10-01'))).toBe(false);
  });

  it('needs originality verified', () => {
    // Without it Verification is exactly 85 and Originality is capped at 85: every score is in reach, and it still is not Certified.
    const p = certifiedCar({ originality: false });
    expect(gradePassport(p, REGISTRY, TODAY).categories.verification.score).toBe(85);
    expect(missing(p)).toEqual(['cert.originality']);
    expect(certified(p).level).toBe('verified');
  });

  it('needs the records verified', () => {
    const p = certifiedCar({ records: false });
    expect(missing(p)).toEqual(['cert.records', 'cert.scores']);
    expect(certified(p).level).toBe('verified');
  });

  it('needs every category at 60', () => {
    // The inspector found the car in poor condition.
    const p = certifiedCar({ inspection: { conditionScore: 50 } });
    expect(gradePassport(p, REGISTRY, TODAY).categories.condition.score).toBe(50);
    expect(missing(p)).toEqual(['cert.scores']);
    expect(certified(p).level).toBe('verified');
  });
});

/* ----------------------------------------------------------------- the ceiling ---- */

describe('the ceiling', () => {
  const ceiling = (p: Passport, registry: VerifierRegistry = REGISTRY, asOf = TODAY) => gradeCeiling(p, registry, asOf);

  it('is what an owner can reach alone when no verifier has attested anything', () => {
    for (const p of [parked(), documentedCar(), readyCar()]) {
      expect(ceiling(p)).toEqual({ level: 'documented', categories: { ...OWNER_CEILING }, overall: 67.5, oneOfOne: false });
    }
    expect(OWNER_CEILING).toEqual({ identity: 55, documentation: 100, condition: 75, originality: 85, verification: 0 });
    // And it is the same for a full set of attestations nobody registered stands behind.
    expect(ceiling(certifiedCar(), EMPTY_REGISTRY)).toEqual(ceiling(parked()));
  });

  it('is never below the grade and the level the passport really holds', () => {
    for (const p of [parked(), documentedCar(), readyCar(), certifiedCar({ inspection: null }), certifiedCar({ originality: false }), certifiedCar()]) {
      const report = gradePassport(p, REGISTRY, TODAY), top = ceiling(p);
      const order = ['registered', 'documented', 'verified', 'certified'];
      expect(order.indexOf(certified(p).level)).toBeLessThanOrEqual(order.indexOf(top.level));
      expect(report.overall).toBeLessThanOrEqual(top.overall);
      for (const k of ['identity', 'documentation', 'condition', 'originality', 'verification'] as const) expect(report.categories[k].score, k).toBeLessThanOrEqual(top.categories[k]);
    }
  });

  it('lifts each category only for the attestation that stands behind it', () => {
    const bare = parked();
    expect(ceiling(attest(bare, 'identity')).categories).toEqual({ ...OWNER_CEILING, identity: 100, verification: 30 });
    expect(ceiling(attest(bare, 'originality')).categories).toEqual({ ...OWNER_CEILING, originality: 100, verification: 15 });
    expect(ceiling(attest(bare, 'mileage', { mileage: 100 })).categories).toEqual({ ...OWNER_CEILING, verification: 10 });
    // A fresh inspection can score to 100. One past its first year counts by half and is capped at 85.
    expect(ceiling(attest(bare, 'condition', INSPECTION)).categories).toEqual({ ...OWNER_CEILING, condition: 100, verification: 25 });
    const old = ok(recordAttestation(bare, { id: id(), verifierId: 'inspector-ann', scope: 'condition', date: '2025-10-01', inPerson: true, conditionScore: 88, systems: null, mileage: null, events: [], note: '', signature: null }, REGISTRY, { now: '2025-10-02T12:00:00.000Z', eventId: id() }));
    expect(ceiling(old).categories).toEqual({ ...OWNER_CEILING, condition: 85, verification: 12.5 });
    // Before the attestation's day, and after it lapses, the ceiling is the owner's own again.
    expect(ceiling(attest(bare, 'mileage', { mileage: 100 }), REGISTRY, '2026-10-31').categories).toEqual({ ...OWNER_CEILING });
    expect(ceiling(attest(bare, 'mileage', { mileage: 100 }), REGISTRY, '2027-11-01').categories).toEqual({ ...OWNER_CEILING });
  });

  it('allows Verified only with identity and a second check, and Certified only with all four and an in-person inspection', () => {
    const records = (p: Passport) => attest(p, 'documentation', { events: [aRecord(p)] });
    const base = documentedCar();
    const level = (p: Passport) => ceiling(p).level;
    expect(level(attest(base, 'identity'))).toBe('documented');
    expect(level(attest(attest(base, 'identity'), 'mileage', { mileage: 48100 }))).toBe('verified');
    expect(level(records(attest(base, 'identity')))).toBe('verified');
    // 55 points of Verification without identity.
    expect(level(attest(records(attest(base, 'mileage', { mileage: 48100 })), 'condition', INSPECTION))).toBe('documented');
    // 70 points without a second check of the trail.
    expect(level(attest(attest(attest(base, 'identity'), 'originality'), 'condition', INSPECTION))).toBe('documented');
    // Everything, with the inspection made from photographs: 100 points and not Certified.
    const all = (inspection: Record<string, unknown> | null, leave: { records?: boolean; originality?: boolean } = {}) => {
      let p = attest(attest(base, 'identity'), 'mileage', { mileage: 48100 });
      if (leave.records !== false) p = records(p);
      if (leave.originality !== false) p = attest(p, 'originality');
      return inspection === null ? p : attest(p, 'condition', { ...INSPECTION, ...inspection });
    };
    expect(level(all({ inPerson: false }))).toBe('verified');
    expect(level(all(null))).toBe('verified');
    // In person, without originality (85 points) or without the records (80 points).
    expect(level(all({}, { originality: false }))).toBe('verified');
    expect(level(all({}, { records: false }))).toBe('verified');
    expect(level(all({}))).toBe('certified');
  });

  it('allows One-of-One only on a verifier’s word, or a build of one the record backs', () => {
    expect(ceiling(attest(parked(), 'one-of-one')).oneOfOne).toBe(true);
    // A build of one the owner typed in, whatever source is named beside it.
    const typed = parked(VIN, civic({ productionUnits: { value: 1, source: { kind: 'manufacturer', name: 'typed in' } } }));
    expect(ceiling(typed).oneOfOne).toBe(false);
    expect(ceiling(attest(typed, 'identity')).oneOfOne).toBe(false);
    // The same figure once a verifier has attested the specification it is part of.
    expect(ceiling(attest(typed, 'specification')).oneOfOne).toBe(true);
    expect(ceiling(attest(typed, 'specification'), EMPTY_REGISTRY).oneOfOne).toBe(false);
    // Two built is not one.
    expect(ceiling(attest(parked(VIN, civic({ productionUnits: s(2) })), 'specification')).oneOfOne).toBe(false);
  });

  it('reads what verifiers stand behind and nothing an owner wrote', () => {
    const p = certifiedCar();
    expect(attestedOn(p, REGISTRY, TODAY).attestations.map((a) => a.attestation.scope).sort()).toEqual(['condition', 'documentation', 'identity', 'mileage', 'originality']);
    expect(attestedOn(p, REGISTRY, TODAY).asOf).toBe(TODAY);
    // The ceiling from the standing alone is the ceiling from the full facts.
    expect(gradeCeiling(p, REGISTRY, TODAY)).toEqual(gradeCeiling(p, REGISTRY, TODAY, gradeFacts(p, REGISTRY, TODAY)));
    expect(gradeCeiling(p, REGISTRY, TODAY)).toMatchObject({ level: 'certified', overall: 100 });
  });
});
