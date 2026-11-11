import { describe, expect, it } from 'vitest';
import { micarIdFromBytes } from './identity';
import { resolveModifications } from './modifications';
import { MAX_EVENTS, PASSPORT_REFUSALS, addEvent, appendEvent, createPassport, parsePassport, serializePassport, transferOwnership, updateSpec, updateVin } from './passport';
import { emptySpec } from './specs';
import type { Attachment, Attestation, AttestationScope, Passport, PassportEvent, Sourced, VehicleSpec, VerifierRegistry } from './types';
import { publicPassport } from './public';
import { hashString, sha256Text } from './util';
import {
  ATTESTATION_PAYLOAD, ATTESTATION_SCOPE_LABELS, ATTESTATION_VALID_MONTHS, CONDITION_FULL_MONTHS, EMPTY_REGISTRY, MILEAGE_TOLERANCE, VERIFICATION_REFUSALS,
  activeModifications, attestationPayload, attestationStatuses, attestationSubject, competitionConditionInputs, competitionModifications, conditionInputs, documentedRecords, eventEvidence, mileageLog,
  recordAttestation,
  standingOf, standingReadings, subjectFingerprint, validAttestations, voidEvent, voidedEventIds,
} from './verification';

/* ------------------------------------------------------------------ fixtures ---- */

const OWNER = 'owner-one';
const NOW = '2026-11-10T12:00:00.000Z';
const TODAY = '2026-11-10';
const VIN = '1M8GDM9AXKP042788';
const OTHER_VIN = '1HGCM82633A004352';
const ALL: AttestationScope[] = ['identity', 'mileage', 'documentation', 'condition', 'originality', 'modification', 'specification', 'one-of-one'];
const REGISTRY: VerifierRegistry = {
  verifiers: [
    { id: 'inspector-ann', kind: 'inspector', name: 'Ann Inspector', active: true, scopes: ALL },
    { id: 'shop-bob', kind: 'shop', name: 'Bob’s Shop', active: true, scopes: ['documentation', 'modification'] },
    { id: 'retired-cy', kind: 'inspector', name: 'Cy, retired', active: false, scopes: ALL },
    // A verifier who also happens to be this car's owner.
    { id: OWNER, kind: 'inspector', name: 'The owner, moonlighting', active: true, scopes: ALL },
  ],
};
const without = (id: string): VerifierRegistry => ({ ...REGISTRY, verifiers: REGISTRY.verifiers.map((v) => (v.id === id ? { ...v, active: false } : v)) });

const ref = { kind: 'reference', name: 'fixture', asOf: TODAY } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });
const civic = (over: Partial<VehicleSpec> = {}): VehicleSpec => ({
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), horsepower: s(158), torqueLbFt: s(138), transmissionType: s('cvt'), drivetrain: s('FWD'),
  curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), ...over,
});

let n = 0;
const id = () => `v${++n}`;
const file = (kind: Attachment['kind'], name = 'file'): Attachment => ({ id: id(), kind, name: `${name}.jpg`, mime: 'image/jpeg', size: 1000, sha256: null });
type R<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(r: R<T>): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const reason = <T>(r: R<T>): string => (r.ok ? 'accepted' : r.reason);

const parked = (micarId = 'MC-0000-0000-0000', vin = VIN): Passport => ok(createPassport({ micarId, now: '2024-01-02T09:00:00.000Z', ownerId: OWNER, spec: civic(), vin, eventId: id() }));
/** Adds an owner's entry and hands back the passport and the new entry's id. */
const add = (p: Passport, event: Record<string, unknown>, now = NOW): [Passport, string] => {
  const eventId = id();
  return [ok(addEvent(p, { id: eventId, mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...event }, { now, by: OWNER })), eventId];
};
const receipt = (p: Passport, date = '2026-06-01', over: Record<string, unknown> = {}): [Passport, string] =>
  add(p, { type: 'maintenance', date, shop: 'A shop', cost: 80, attachments: [file('receipt')], ...over });

const blank = (scope: AttestationScope, over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id: id(), verifierId: 'inspector-ann', scope, date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over });
const attempt = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, registry = REGISTRY, now = NOW) =>
  recordAttestation(p, blank(scope, over), registry, { now, eventId: id() });
/** Records an attestation and hands back the passport and the id of the entry that carries it. */
const attest = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, registry = REGISTRY): [Passport, string, string] => {
  const eventId = id(), attestationId = id();
  return [ok(recordAttestation(p, blank(scope, { id: attestationId, ...over }), registry, { now: NOW, eventId })), eventId, attestationId];
};
/** Writes an attestation straight into the passport, as someone editing the file by hand would. */
const forge = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, entry: Partial<PassportEvent> = {}): [Passport, string] => {
  const a = { ...blank(scope, over), subject: subjectFingerprint(p, scope) } as unknown as Attestation;
  const eventId = id();
  const event = {
    id: eventId, date: a.date, recordedAt: NOW, by: a.verifierId, mileage: a.scope === 'mileage' ? a.mileage : null, title: 'Attestation', note: '', attachments: [],
    visibility: 'private', type: 'attestation', attestation: a, ...entry,
  } as PassportEvent;
  return [appendEvent(p, event), eventId];
};
const statusOf = (p: Passport, eventId: string, registry = REGISTRY, asOf = TODAY) => attestationStatuses(p, registry, asOf).filter((x) => x.eventId === eventId)[0];

/* ------------------------------------------------------------- who may attest ---- */

describe('the empty registry', () => {
  it('lets nothing be verified, whatever the passport holds', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p);
    expect(reason(attempt(p, 'identity', {}, EMPTY_REGISTRY))).toBe(VERIFICATION_REFUSALS.unknown);
    // Even an attestation written into the file by hand counts for nothing.
    let forged: string;
    [p, forged] = forge(p, 'documentation', { events: [receiptId] });
    expect(statusOf(p, forged, EMPTY_REGISTRY)).toMatchObject({ valid: false, weight: 0, reason: VERIFICATION_REFUSALS.unknown });
    expect(validAttestations(p, EMPTY_REGISTRY, TODAY)).toEqual([]);
    expect(eventEvidence(p, receiptId, EMPTY_REGISTRY, TODAY)).toBe('documented');
    expect(standingOf(p, EMPTY_REGISTRY, TODAY).events.some((e) => e.type === 'attestation')).toBe(false);
    // A registry that is missing or malformed is an empty one, never a crash.
    for (const bad of [null, undefined, {}, { verifiers: 'all' }, { verifiers: [null] }]) {
      expect(validAttestations(p, bad as unknown as VerifierRegistry, TODAY)).toEqual([]);
    }
  });
});

describe('who may attest', () => {
  it('takes an attestation from a registered, active verifier acting within its scopes', () => {
    const [p, eventId] = attest(parked(), 'identity');
    expect(statusOf(p, eventId)).toMatchObject({ valid: true, weight: 1, reason: '' });
    const entry = p.events[p.events.length - 1];
    expect(entry).toMatchObject({ type: 'attestation', by: 'inspector-ann', date: '2026-11-01', recordedAt: NOW, visibility: 'private', mileage: null });
    expect(validAttestations(p, REGISTRY, TODAY, 'identity')).toHaveLength(1);
    expect(validAttestations(p, REGISTRY, TODAY, 'mileage')).toHaveLength(0);
  });

  it('refuses, and changes nothing, when the verifier is unknown, inactive, out of scope or an owner', () => {
    const p = parked();
    const before = serializePassport(p);
    expect(reason(attempt(p, 'identity', { verifierId: 'nobody' }))).toBe(VERIFICATION_REFUSALS.unknown);
    expect(reason(attempt(p, 'identity', { verifierId: 'retired-cy' }))).toBe(VERIFICATION_REFUSALS.inactive);
    expect(reason(attempt(p, 'identity', { verifierId: 'shop-bob' }))).toBe(VERIFICATION_REFUSALS.scope);
    expect(reason(attempt(p, 'identity', { verifierId: OWNER }))).toBe(VERIFICATION_REFUSALS.owner);
    expect(serializePassport(p)).toBe(before);
  });

  it('never lets anyone who has owned the vehicle verify it, even after selling it', () => {
    const sold = ok(transferOwnership(parked(), { eventId: id(), toOwnerId: 'owner-two', date: '2026-03-01' }, { now: NOW, by: OWNER }));
    expect(reason(attempt(sold, 'identity', { verifierId: OWNER }))).toBe(VERIFICATION_REFUSALS.owner);
    // And an attestation stops counting the day its verifier becomes an owner.
    const [attested, eventId] = attest(parked(), 'identity');
    expect(statusOf(attested, eventId).valid).toBe(true);
    const bought = ok(transferOwnership(attested, { eventId: id(), toOwnerId: 'inspector-ann', date: '2026-11-05' }, { now: NOW, by: OWNER }));
    expect(statusOf(bought, eventId)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.owner });
  });

  it('refuses a malformed attestation, a reused id, a bad time and a date in the future', () => {
    const [p] = attest(parked(), 'identity', { id: 'taken' });
    expect(reason(recordAttestation(p, 'an attestation', REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.shape);
    expect(reason(recordAttestation(p, blank('identity', { scope: 'opinion' }), REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.shape);
    expect(reason(attempt(p, 'originality', { id: 'taken' }))).toBe(VERIFICATION_REFUSALS.id);
    expect(reason(recordAttestation(p, blank('originality'), REGISTRY, { now: NOW, eventId: p.events[0].id }))).toBe(VERIFICATION_REFUSALS.id);
    expect(reason(recordAttestation(p, blank('originality'), REGISTRY, { now: 'yesterday', eventId: id() }))).toBe(VERIFICATION_REFUSALS.timestamp);
    expect(reason(attempt(p, 'originality', { date: '2026-11-11' }))).toBe(VERIFICATION_REFUSALS.future);
    expect(reason(attempt(p, 'mileage', { date: '2025-11-10', mileage: 100 }))).toBe(VERIFICATION_REFUSALS.lapsed);
  });

  it('needs what the scope attests: a reading, a score, or the records it confirms', () => {
    let p = parked();
    let receiptId: string, installId: string;
    [p, receiptId] = receipt(p);
    [p, installId] = add(p, { type: 'modification', date: '2026-05-01', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: 'kit', undoes: null });
    expect(reason(attempt(p, 'mileage'))).toBe(VERIFICATION_REFUSALS.detail);
    expect(reason(attempt(p, 'condition'))).toBe(VERIFICATION_REFUSALS.detail);
    expect(reason(attempt(p, 'documentation'))).toBe(VERIFICATION_REFUSALS.detail);
    expect(reason(attempt(p, 'modification'))).toBe(VERIFICATION_REFUSALS.detail);
    // The records it names have to be on this passport, and of the right kind.
    expect(reason(attempt(p, 'documentation', { events: ['no-such-entry'] }))).toBe(VERIFICATION_REFUSALS.records);
    expect(reason(attempt(p, 'modification', { events: [receiptId] }))).toBe(VERIFICATION_REFUSALS.records);
    const [attested, attestationEventId] = attest(p, 'identity');
    expect(reason(attempt(attested, 'documentation', { events: [attestationEventId] }))).toBe(VERIFICATION_REFUSALS.records);
    expect(reason(attempt(p, 'mileage', { mileage: 61000 }))).toBe('accepted');
    expect(reason(attempt(p, 'condition', { conditionScore: 90 }))).toBe('accepted');
    expect(reason(attempt(p, 'documentation', { events: [receiptId, installId] }))).toBe('accepted');
    expect(reason(attempt(p, 'modification', { events: [installId] }))).toBe('accepted');
  });

  it('names every scope and gives each a window', () => {
    expect(Object.keys(ATTESTATION_SCOPE_LABELS).sort()).toEqual([...ALL].sort());
    expect(Object.keys(ATTESTATION_VALID_MONTHS).sort()).toEqual([...ALL].sort());
    for (const scope of ALL) expect(ATTESTATION_SCOPE_LABELS[scope]).toBeTruthy();
    expect(ATTESTATION_VALID_MONTHS).toMatchObject({ identity: null, specification: null, 'one-of-one': null, mileage: 12, documentation: 24, originality: 24, modification: 24, condition: 24 });
    expect(CONDITION_FULL_MONTHS).toBe(12);
  });
});

describe('an attestation written into the file by hand', () => {
  it('does not count when its entry says someone else wrote it', () => {
    const [p, eventId] = forge(parked(), 'identity', {}, { by: OWNER });
    expect(statusOf(p, eventId)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.author });
  });

  it('does not count when its entry is dressed up with another day or a reading', () => {
    const [early, e1] = forge(parked(), 'condition', { conditionScore: 95, date: '2026-11-01' }, { date: '2020-01-01' });
    expect(statusOf(early, e1)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.shape });
    // An identity attestation carries no reading: one slipped onto its entry would otherwise read as verified mileage.
    const [low, e2] = forge(parked(), 'identity', {}, { mileage: 12 });
    expect(statusOf(low, e2)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.shape });
    expect(standingReadings(low, REGISTRY, TODAY)).toEqual([]);
    const [wrong, e3] = forge(parked(), 'mileage', { mileage: 90000 }, { mileage: 9000 });
    expect(statusOf(wrong, e3)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.shape });
  });

  it('does not count when it lacks what its scope attests or its fingerprint is missing', () => {
    const [p, e1] = forge(parked(), 'documentation');
    expect(statusOf(p, e1)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.detail });
    const [q, e2] = forge(parked(), 'identity');
    const stripped: Passport = { ...q, events: q.events.map((e) => (e.type === 'attestation' ? { ...e, attestation: { ...e.attestation, subject: null } } : e)) };
    expect(statusOf(q, e2).valid).toBe(true);
    expect(statusOf(stripped, e2)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.changed });
  });
});

/* --------------------------------------------------------------------- windows ---- */

describe('validity windows', () => {
  it('keeps identity for good, mileage for twelve months and records for twenty-four', () => {
    let p = parked();
    let receiptId: string, identity: string, mileage: string, records: string;
    [p, receiptId] = receipt(p);
    [p, identity] = attest(p, 'identity');
    [p, mileage] = attest(p, 'mileage', { mileage: 61000 });
    [p, records] = attest(p, 'documentation', { events: [receiptId] });
    expect(statusOf(p, identity, REGISTRY, '2046-01-01').valid).toBe(true);
    expect(statusOf(p, mileage, REGISTRY, '2027-10-31').valid).toBe(true);
    expect(statusOf(p, mileage, REGISTRY, '2027-11-01')).toMatchObject({ valid: false, weight: 0, reason: VERIFICATION_REFUSALS.lapsed });
    expect(statusOf(p, records, REGISTRY, '2028-10-31').valid).toBe(true);
    expect(statusOf(p, records, REGISTRY, '2028-11-01')).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.lapsed });
    // Looking back to a day before it was made, it had not been made yet.
    expect(statusOf(p, identity, REGISTRY, '2026-10-31')).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.future });
    expect(standingOf(p, REGISTRY, '2026-10-31').events.some((e) => e.type === 'attestation')).toBe(false);
    // Once lapsed, an attestation is still on the record as something a third party wrote down; it just verifies nothing.
    const late = standingOf(p, REGISTRY, '2028-11-01');
    expect(late.lapsed.sort()).toEqual([mileage, records].sort());
    expect(late.attestations.map((x) => x.eventId)).toEqual([identity]);
  });

  it('counts a condition inspection in full for a year, at half weight for the next, and then not at all', () => {
    const [p, eventId] = attest(parked(), 'condition', { conditionScore: 90 });
    expect(statusOf(p, eventId, REGISTRY, '2027-10-31')).toMatchObject({ valid: true, weight: 1 });
    expect(statusOf(p, eventId, REGISTRY, '2027-11-01')).toMatchObject({ valid: true, weight: 0.5 });
    expect(statusOf(p, eventId, REGISTRY, '2028-10-31')).toMatchObject({ valid: true, weight: 0.5 });
    expect(statusOf(p, eventId, REGISTRY, '2028-11-01')).toMatchObject({ valid: false, weight: 0, reason: VERIFICATION_REFUSALS.lapsed });
  });

  it('stops counting the moment its verifier leaves the registry', () => {
    const [p, eventId] = attest(parked(), 'identity');
    expect(statusOf(p, eventId, without('inspector-ann'))).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.inactive });
    expect(statusOf(p, eventId, { verifiers: [] })).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.unknown });
  });
});

/* -------------------------------------------------------- what an attestation binds ---- */

describe('what was attested', () => {
  it('stops being verified when the owner changes it afterwards', () => {
    let p = parked();
    let identity: string, specification: string, oneOfOne: string, originality: string;
    [p, identity] = attest(p, 'identity');
    [p, specification] = attest(p, 'specification');
    [p, oneOfOne] = attest(p, 'one-of-one');
    [p, originality] = attest(p, 'originality');
    expect(validAttestations(p, REGISTRY, TODAY)).toHaveLength(4);

    // A new VIN is a different identity: the identity and one-of-one attestations were about the old one.
    const revin = ok(updateVin(p, OTHER_VIN, { by: OWNER }));
    expect(statusOf(revin, identity)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.changed });
    expect(statusOf(revin, oneOfOne)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.changed });
    expect(statusOf(revin, specification).valid).toBe(true);
    expect(statusOf(revin, originality).valid).toBe(true);
    // Put back exactly as attested, it is the attested thing again.
    expect(statusOf(ok(updateVin(revin, VIN, { by: OWNER })), identity).valid).toBe(true);

    // A specification attested at 158 hp does not vouch for 500.
    const tuned = ok(updateSpec(p, civic({ horsepower: s(500) }), { by: OWNER }));
    expect(statusOf(tuned, specification)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.changed });
    expect(statusOf(tuned, identity).valid).toBe(true);
    // Changing the model is a change of identity too.
    const renamed = ok(updateSpec(p, { ...civic(), identity: { ...civic().identity, model: 'Accord' } }, { by: OWNER }));
    expect(statusOf(renamed, identity)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.changed });
  });

  it('describes the subject of each scope, and fingerprints it', () => {
    const p = parked();
    expect(attestationSubject(p, 'identity')).toBe(JSON.stringify([VIN, 2019, 'Honda', 'Civic']));
    expect(attestationSubject(p, 'one-of-one')).toBe(attestationSubject(p, 'identity'));
    expect(attestationSubject(p, 'specification')).toContain('"horsepower"');
    for (const scope of ['mileage', 'documentation', 'condition', 'originality', 'modification'] as const) {
      expect(attestationSubject(p, scope)).toBe('');
      expect(subjectFingerprint(p, scope)).toBeNull();
    }
    expect(subjectFingerprint(p, 'identity')).toMatch(/^[0-9a-f]{64}$/);
    expect(subjectFingerprint(p, 'identity')).toBe(sha256Text(attestationSubject(p, 'identity')));
    expect(subjectFingerprint(p, 'identity')).not.toBe(subjectFingerprint(ok(updateVin(p, OTHER_VIN, { by: OWNER })), 'identity'));
    // The engine writes the fingerprint; whatever a caller sends in its place is ignored.
    const [q] = attest(p, 'identity', { subject: 'f'.repeat(64) });
    const stored = q.events[q.events.length - 1];
    expect(stored.type === 'attestation' && stored.attestation.subject).toBe(subjectFingerprint(p, 'identity'));
  });
});

/* -------------------------------------------------------------------- signatures ---- */

const KEYS: Record<string, string> = { 'inspector-ann': 'ann-key', 'shop-bob': 'bob-key' };
const sign = (payload: string, key: string): string => `${key}.${hashString(payload).toString(16)}`;
let checks = 0;
const SIGNED: VerifierRegistry = {
  ...REGISTRY,
  checkSignature: (payload, signature, verifier) => { checks += 1; return signature === sign(payload, KEYS[verifier.id]); },
};
/** What a verifier does: builds the attestation, signs the engine's payload for it, and submits both. */
const signedAttestation = (p: Passport, scope: AttestationScope, over: Record<string, unknown> = {}, key = 'ann-key'): Record<string, unknown> => {
  const a = blank(scope, over);
  return { ...a, signature: sign(attestationPayload(p, { ...a, subject: null } as unknown as Attestation), key) };
};

describe('signatures', () => {
  it('are required once the registry carries a checker', () => {
    const p = parked();
    expect(reason(recordAttestation(p, blank('identity'), SIGNED, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.signature);
    expect(reason(recordAttestation(p, blank('identity', { signature: 'ann-key.0' }), SIGNED, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.signature);
    // Signed with another verifier's key.
    expect(reason(recordAttestation(p, signedAttestation(p, 'identity', {}, 'bob-key'), SIGNED, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.signature);
    const eventId = id();
    const signed = ok(recordAttestation(p, signedAttestation(p, 'identity'), SIGNED, { now: NOW, eventId }));
    expect(statusOf(signed, eventId, SIGNED)).toMatchObject({ valid: true, weight: 1 });
    // A registry with no checker takes the same passport on the host's word.
    expect(statusOf(signed, eventId, REGISTRY).valid).toBe(true);
  });

  it('cannot be moved to another vehicle', () => {
    const a = parked('MC-0000-0000-0000');
    const eventId = id();
    const signed = ok(recordAttestation(a, signedAttestation(a, 'identity'), SIGNED, { now: NOW, eventId }));
    const entry = signed.events[signed.events.length - 1];
    // The same year, make, model and VIN typed into a second passport: everything matches but the MiCar ID.
    const b = appendEvent(parked(ok(micarIdFromBytes([1, 2, 3, 4, 5, 6, 7]))), entry);
    expect(statusOf(b, eventId, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
    expect(statusOf(b, eventId, REGISTRY).valid).toBe(true);
  });

  it('stop checking when the attestation or a record it confirmed is altered', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p, '2026-06-01', { mileage: 60000 });
    const eventId = id();
    p = ok(recordAttestation(p, signedAttestation(p, 'documentation', { events: [receiptId] }), SIGNED, { now: NOW, eventId }));
    const condition = id();
    p = ok(recordAttestation(p, signedAttestation(p, 'condition', { conditionScore: 62 }), SIGNED, { now: NOW, eventId: condition }));
    expect(statusOf(p, eventId, SIGNED).valid).toBe(true);
    expect(eventEvidence(p, receiptId, SIGNED, TODAY)).toBe('verified');

    // The file is edited by hand: the confirmed receipt now shows fewer miles.
    const rolled = JSON.parse(serializePassport(p)) as Passport;
    for (const e of rolled.events) if (e.id === receiptId) e.mileage = 20000;
    const read = ok(parsePassport(rolled)).passport;
    expect(statusOf(read, eventId, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
    expect(eventEvidence(read, receiptId, SIGNED, TODAY)).toBe('documented');

    // The inspector's 62 becomes a 99.
    const flattered = JSON.parse(serializePassport(p)) as Passport;
    for (const e of flattered.events) if (e.type === 'attestation' && e.attestation.scope === 'condition') e.attestation.conditionScore = 99;
    expect(statusOf(ok(parsePassport(flattered)).passport, condition, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });

    // The confirmed receipt is deleted from the file.
    const dropped: Passport = { ...p, events: p.events.filter((e) => e.id !== receiptId) };
    expect(statusOf(dropped, eventId, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
  });

  it('survive storing and loading, whatever order the keys come back in', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p);
    const eventId = id();
    p = ok(recordAttestation(p, signedAttestation(p, 'documentation', { events: [receiptId], note: 'seen at the shop' }), SIGNED, { now: NOW, eventId }));
    const again = ok(parsePassport(serializePassport(p))).passport;
    expect(statusOf(again, eventId, SIGNED).valid).toBe(true);
    // Rebuild every object with its keys reversed: the payload is the same text.
    const reversed = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reversed);
      if (v === null || typeof v !== 'object') return v;
      const o = v as Record<string, unknown>, out: Record<string, unknown> = {};
      for (const k of Object.keys(o).reverse()) out[k] = reversed(o[k]);
      return out;
    };
    const shuffled = reversed(p) as Passport;
    const entry = p.events[p.events.length - 1], shuffledEntry = shuffled.events[shuffled.events.length - 1];
    if (entry.type !== 'attestation' || shuffledEntry.type !== 'attestation') throw new Error('expected an attestation');
    expect(attestationPayload(shuffled, shuffledEntry.attestation)).toBe(attestationPayload(p, entry.attestation));
    expect(attestationPayload(p, entry.attestation).startsWith(`["${ATTESTATION_PAYLOAD}","MC-0000-0000-0000"`)).toBe(true);
    expect(statusOf(shuffled, eventId, SIGNED).valid).toBe(true);
  });

  it('treat a checker that throws as a signature that does not check', () => {
    const [p, eventId] = forge(parked(), 'identity', { signature: 'anything' });
    const broken: VerifierRegistry = { ...REGISTRY, checkSignature: () => { throw new Error('boom'); } };
    expect(statusOf(p, eventId, broken)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
    const truthy: VerifierRegistry = { ...REGISTRY, checkSignature: (() => 'yes') as unknown as VerifierRegistry['checkSignature'] };
    expect(statusOf(p, eventId, truthy).valid).toBe(false);
  });

  it('are checked before age: a forgery dated long ago is a forgery, and only an attestation that checks can lapse', () => {
    // Written into the file by hand, with a registered inspector's name on them and dates past their windows.
    let p = parked();
    let unsigned: string, misSigned: string;
    [p, unsigned] = forge(p, 'condition', { date: '2024-06-01', conditionScore: 90, signature: null });
    [p, misSigned] = forge(p, 'mileage', { date: '2025-06-01', mileage: 12000, signature: 'forged' });
    for (const read of [p, ok(parsePassport(serializePassport(p))).passport]) {
      // They used to be called "out of date" and kept on the record as a third party's inspection and odometer reading.
      expect(statusOf(read, unsigned, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
      expect(statusOf(read, misSigned, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.signature });
      const standing = standingOf(read, SIGNED, TODAY);
      expect(standing.lapsed).toEqual([]);
      expect(standing.events.some((e) => e.type === 'attestation')).toBe(false);
      expect(mileageLog(read, SIGNED, TODAY).readings).toEqual([]);
      expect(eventEvidence(read, misSigned, SIGNED, TODAY)).toBe('declared');
      expect(publicPassport(read, SIGNED, TODAY).events.some((e) => e.type === 'attestation')).toBe(false);
    }
    // The same reading, really signed, does lapse, and stays on the record when it has.
    const car = parked();
    const real = id();
    const signed = ok(recordAttestation(car, signedAttestation(car, 'mileage', { date: '2025-06-01', mileage: 12000 }), SIGNED, { now: '2025-06-02T12:00:00.000Z', eventId: real }));
    expect(statusOf(signed, real, SIGNED)).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.lapsed });
    expect(standingOf(signed, SIGNED, TODAY).lapsed).toEqual([real]);
    expect(mileageLog(signed, SIGNED, TODAY).readings.map((r) => r.mileage)).toEqual([12000]);
    // Every other fault is named before age too: only an attestation good in every other way is ever called out of date.
    const old = { date: '2024-06-01', conditionScore: 70 };
    expect(statusOf(...forge(parked(), 'condition', { ...old, verifierId: 'nobody' })).reason).toBe(VERIFICATION_REFUSALS.unknown);
    expect(statusOf(...forge(parked(), 'condition', { ...old, verifierId: 'retired-cy' })).reason).toBe(VERIFICATION_REFUSALS.inactive);
    expect(statusOf(...forge(parked(), 'condition', { ...old, verifierId: 'shop-bob' })).reason).toBe(VERIFICATION_REFUSALS.scope);
    expect(statusOf(...forge(parked(), 'condition', { ...old, verifierId: OWNER })).reason).toBe(VERIFICATION_REFUSALS.owner);
    expect(statusOf(...forge(parked(), 'condition', old, { by: 'shop-bob' })).reason).toBe(VERIFICATION_REFUSALS.author);
    expect(statusOf(...forge(parked(), 'condition', { ...old, conditionScore: null })).reason).toBe(VERIFICATION_REFUSALS.detail);
    expect(statusOf(...forge(parked(), 'condition', old)).reason).toBe(VERIFICATION_REFUSALS.lapsed);
  });

  it('bind every part of what was attested: change any one and the text a verifier signed is another text', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p, '2026-06-01', { mileage: 60000 });
    const said = { ...blank('condition', { conditionScore: 80, systems: { engine: 0.2 }, mileage: 50000, events: [receiptId], note: 'seen on the lift' }), subject: null } as unknown as Attestation;
    const text = attestationPayload(p, said);
    const changes: Partial<Attestation>[] = [
      { id: 'another-attestation' }, { verifierId: 'shop-bob' }, { scope: 'originality' }, { date: '2026-10-31' }, { inPerson: false }, { conditionScore: 81 }, { conditionScore: null },
      { systems: { engine: 0.3 } }, { systems: { engine: 0.2, tires: 0.2 } }, { systems: null }, { mileage: 50001 }, { mileage: null }, { events: [] }, { note: 'seen in photographs' },
    ];
    const seen = new Set([text]);
    for (const change of changes) {
      const other = attestationPayload(p, { ...said, ...change });
      expect(seen.has(other), JSON.stringify(change)).toBe(false);
      seen.add(other);
    }
    // The vehicle it was made for, and each record it names exactly as the passport holds it.
    expect(attestationPayload({ ...p, micarId: ok(micarIdFromBytes([9, 9, 9, 9, 9, 9, 9])) }, said)).not.toBe(text);
    expect(attestationPayload({ ...p, events: p.events.map((e) => (e.id === receiptId ? { ...e, mileage: 20000 } : e)) }, said)).not.toBe(text);
    expect(attestationPayload({ ...p, events: p.events.filter((e) => e.id !== receiptId) }, said)).not.toBe(text);
    // The part of the passport the scope speaks for: the VIN and the year, make and model for identity and one-of-one...
    for (const scope of ['identity', 'one-of-one'] as const) {
      const about = { ...blank(scope), subject: null } as unknown as Attestation;
      const was = attestationPayload(p, about);
      const named = (identity: Partial<VehicleSpec['identity']>): Passport => ({ ...p, spec: { ...p.spec, identity: { ...p.spec.identity, ...identity } } });
      expect(attestationPayload({ ...p, vin: OTHER_VIN }, about), scope).not.toBe(was);
      for (const identity of [{ year: 2018 }, { make: 'Acura' }, { model: 'Accord' }]) expect(attestationPayload(named(identity), about), `${scope} ${JSON.stringify(identity)}`).not.toBe(was);
    }
    // ...and the whole factory specification for a specification attestation.
    const spec = { ...blank('specification'), subject: null } as unknown as Attestation;
    expect(attestationPayload({ ...p, spec: civic({ horsepower: s(159) }) }, spec)).not.toBe(attestationPayload(p, spec));
    expect(attestationPayload({ ...p, spec: { ...p.spec, identity: { ...p.spec.identity, trim: 'Si' } } }, spec)).not.toBe(attestationPayload(p, spec));
    // The stored fingerprint and the signature itself are not part of what is signed, and neither is the order of the records named.
    expect(attestationPayload(p, { ...said, signature: 'anything', subject: 'f'.repeat(64) })).toBe(text);
    let second: string;
    [p, second] = receipt(p, '2026-07-01');
    expect(attestationPayload(p, { ...said, events: [receiptId, second] })).toBe(attestationPayload(p, { ...said, events: [second, receiptId] }));
  });

  it('are checked once per attestation when a standing is worked out once and shared', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p);
    p = ok(recordAttestation(p, signedAttestation(p, 'identity'), SIGNED, { now: NOW, eventId: id() }));
    p = ok(recordAttestation(p, signedAttestation(p, 'documentation', { events: [receiptId] }), SIGNED, { now: NOW, eventId: id() }));
    checks = 0;
    const standing = standingOf(p, SIGNED, TODAY);
    expect(checks).toBe(2);
    const shared = [
      validAttestations(p, SIGNED, TODAY, undefined, standing), voidedEventIds(p, SIGNED, TODAY, standing), eventEvidence(p, receiptId, SIGNED, TODAY, standing),
      standingReadings(p, SIGNED, TODAY, standing), documentedRecords(p, SIGNED, TODAY, standing), activeModifications(p, SIGNED, TODAY, standing),
      conditionInputs(p, SIGNED, TODAY, standing), publicPassport(p, SIGNED, TODAY, standing),
    ];
    expect(checks).toBe(2);
    const fresh = [
      validAttestations(p, SIGNED, TODAY), voidedEventIds(p, SIGNED, TODAY), eventEvidence(p, receiptId, SIGNED, TODAY), standingReadings(p, SIGNED, TODAY),
      documentedRecords(p, SIGNED, TODAY), activeModifications(p, SIGNED, TODAY), conditionInputs(p, SIGNED, TODAY), publicPassport(p, SIGNED, TODAY),
    ];
    expect(shared).toEqual(fresh);
  });
});

/* ---------------------------------------------------------------------- evidence ---- */

describe('evidence', () => {
  it('stops at documented for anything an owner can do alone', () => {
    let p = parked();
    let bare: string, backed: string, heavy: string;
    [p, bare] = add(p, { type: 'maintenance', date: '2026-05-01', shop: 'A shop', cost: 80 });
    [p, backed] = receipt(p);
    const twenty = Array.from({ length: 20 }, () => file('receipt'));
    [p, heavy] = add(p, { type: 'inspection', date: '2026-07-01', inspector: 'A friend who is an inspector', attachments: twenty, title: 'VERIFIED by an inspector', note: 'certified, verified, attested' });
    expect(eventEvidence(p, bare, REGISTRY, TODAY)).toBe('declared');
    expect(eventEvidence(p, backed, REGISTRY, TODAY)).toBe('documented');
    // Twenty files and the word "verified" in every field are still the owner's own account.
    expect(eventEvidence(p, heavy, REGISTRY, TODAY)).toBe('documented');
    expect(validAttestations(p, REGISTRY, TODAY)).toEqual([]);
    // The owner's door does not take an attestation or a withdrawal.
    expect(addEvent(p, { id: id(), type: 'attestation', date: '2026-11-01', attestation: blank('identity') }, { now: NOW, by: OWNER }).ok).toBe(false);
    expect(addEvent(p, { id: id(), type: 'void', date: '2026-11-01', target: backed, attestationId: 'x', reason: '' }, { now: NOW, by: OWNER }).ok).toBe(false);
  });

  it('reaches verified only for the entries an attestation names', () => {
    let p = parked();
    let first: string, second: string, install: string;
    [p, first] = receipt(p, '2026-05-01');
    [p, second] = receipt(p, '2026-06-01');
    [p, install] = add(p, { type: 'modification', date: '2026-07-01', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: 'kit', undoes: null });
    let records: string;
    [p, records] = attest(p, 'documentation', { events: [first] }, REGISTRY);
    expect(eventEvidence(p, first, REGISTRY, TODAY)).toBe('verified');
    expect(eventEvidence(p, second, REGISTRY, TODAY)).toBe('documented');
    expect(eventEvidence(p, install, REGISTRY, TODAY)).toBe('declared');
    expect(eventEvidence(p, records, REGISTRY, TODAY)).toBe('verified');
    // Before the attestation was made, and after it lapses, the receipt is only documented.
    expect(eventEvidence(p, first, REGISTRY, '2026-10-31')).toBe('documented');
    expect(eventEvidence(p, first, REGISTRY, '2028-11-01')).toBe('documented');
    expect(eventEvidence(p, first, EMPTY_REGISTRY, TODAY)).toBe('documented');
    // A shop confirms the modification it fitted.
    [p] = attest(p, 'modification', { verifierId: 'shop-bob', events: [install] });
    expect(eventEvidence(p, install, REGISTRY, TODAY)).toBe('verified');
    expect(activeModifications(p, REGISTRY, TODAY)).toMatchObject([{ eventId: install, category: 'turbo', tier: 2, evidence: 'verified' }]);
    expect(activeModifications(p, EMPTY_REGISTRY, TODAY)).toMatchObject([{ eventId: install, evidence: 'declared' }]);
    // An entry that is not there, or is dated after the day asked about, has no standing.
    expect(eventEvidence(p, 'no-such-entry', REGISTRY, TODAY)).toBe('declared');
    expect(eventEvidence(p, second, REGISTRY, '2026-05-15')).toBe('declared');
  });

  it('is not reached through an attestation about something else that happens to name the entry', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p, '2026-05-01');
    // An inspector confirms the car's identity and lists a receipt beside it. That is not a statement about the receipt.
    for (const scope of ['identity', 'originality', 'specification', 'one-of-one'] as const) {
      const [q] = attest(p, scope, { events: [receiptId] });
      expect(validAttestations(q, REGISTRY, TODAY, scope), scope).toHaveLength(1);
      expect(eventEvidence(q, receiptId, REGISTRY, TODAY), scope).toBe('documented');
    }
    const [mileage] = attest(p, 'mileage', { mileage: 61000, events: [receiptId] });
    expect(eventEvidence(mileage, receiptId, REGISTRY, TODAY)).toBe('documented');
    const [condition] = attest(p, 'condition', { conditionScore: 80, events: [receiptId] });
    expect(eventEvidence(condition, receiptId, REGISTRY, TODAY)).toBe('documented');
    // A modifications attestation speaks for modifications. The door refuses one that names a receipt, and one
    // written into the file by hand verifies nothing but the modifications it names.
    expect(reason(attempt(p, 'modification', { verifierId: 'shop-bob', events: [receiptId] }))).toBe(VERIFICATION_REFUSALS.records);
    const [forged, forgedId] = forge(p, 'modification', { verifierId: 'shop-bob', events: [receiptId] });
    expect(statusOf(forged, forgedId).valid).toBe(true);
    expect(eventEvidence(forged, receiptId, REGISTRY, TODAY)).toBe('documented');
  });

  it('keeps a full weight for anything but a condition inspection, however old', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p, '2025-05-01');
    const old = { date: '2025-06-01' };
    const made = '2025-06-02T12:00:00.000Z';
    const record = (scope: AttestationScope, over: Record<string, unknown>) => { const eventId = id(); p = ok(recordAttestation(p, blank(scope, { ...old, ...over }), REGISTRY, { now: made, eventId })); return eventId; };
    const records = record('documentation', { events: [receiptId] });
    const originality = record('originality', {});
    const inspection = record('condition', { conditionScore: 80 });
    // Seventeen months on: the inspection counts by half, the others in full.
    expect(statusOf(p, records)).toMatchObject({ valid: true, weight: 1 });
    expect(statusOf(p, originality)).toMatchObject({ valid: true, weight: 1 });
    expect(statusOf(p, inspection)).toMatchObject({ valid: true, weight: 0.5 });
  });

  it('counts as documented records only the kinds that are records, with a file, that still stand', () => {
    let p = parked();
    let kept: string;
    [p, kept] = receipt(p, '2026-05-01');
    [p] = add(p, { type: 'maintenance', date: '2026-05-02', shop: '', cost: null });
    [p] = add(p, { type: 'photo', subject: 'exterior', date: '2026-05-03', attachments: [file('photo')] });
    [p] = add(p, { type: 'mileage', date: '2026-05-04', mileage: 100, attachments: [file('photo')] });
    [p] = add(p, { type: 'declaration', date: '2026-05-05', condition: 'Good', attachments: [file('other')] });
    let doc: string, later: string;
    [p, doc] = add(p, { type: 'document', document: 'title', date: '2026-05-06', attachments: [file('title')] });
    [p, later] = receipt(p, '2026-09-01');
    expect(documentedRecords(p, REGISTRY, TODAY).map((e) => e.id)).toEqual([kept, doc, later]);
    expect(documentedRecords(p, REGISTRY, '2026-06-01').map((e) => e.id)).toEqual([kept, doc]);
  });
});

describe('odometer readings', () => {
  it('are verified when a verifier read them, and not because an old entry shows a similar figure', () => {
    let p = parked();
    let old: string, sameDay: string, far: string;
    [p, old] = add(p, { type: 'mileage', date: '2025-01-01', mileage: 61000 });
    [p, sameDay] = add(p, { type: 'mileage', date: '2026-11-01', mileage: 61000 - MILEAGE_TOLERANCE });
    [p, far] = add(p, { type: 'mileage', date: '2026-11-01', mileage: 61000 + MILEAGE_TOLERANCE + 1 }, '2026-11-10T12:00:01.000Z');
    let attested: string;
    [p, attested] = attest(p, 'mileage', { mileage: 61000 });
    expect(MILEAGE_TOLERANCE).toBe(100);
    const byId = (eventId: string) => standingReadings(p, REGISTRY, TODAY).filter((r) => r.eventId === eventId)[0];
    expect(byId(attested)).toMatchObject({ mileage: 61000, date: '2026-11-01', evidence: 'verified' });
    expect(byId(sameDay).evidence).toBe('verified');
    expect(byId(far).evidence).toBe('declared');
    // The owner logged 61,000 two years ago. The verifier did not see that reading.
    expect(byId(old).evidence).toBe('declared');
    // As an entry, the owner's own reading is still the owner's own.
    expect(eventEvidence(p, sameDay, REGISTRY, TODAY)).toBe('declared');
    expect(publicPassport(p, REGISTRY, TODAY).events.filter((e) => e.verified).map((e) => e.type)).toEqual(['attestation']);
  });

  it('give the condition engine the newest reading with its own evidence', () => {
    let p = parked();
    [p] = add(p, { type: 'mileage', date: '2026-01-01', mileage: 50000, attachments: [file('photo')] });
    expect(conditionInputs(p, REGISTRY, TODAY).mileage).toEqual({ value: 50000, evidence: 'documented' });
    [p] = attest(p, 'mileage', { mileage: 61000 });
    expect(conditionInputs(p, REGISTRY, TODAY).mileage).toEqual({ value: 61000, evidence: 'verified' });
    // A newer reading the owner typed is the newest, and it is only declared.
    [p] = add(p, { type: 'mileage', date: '2026-11-09', mileage: 61500 });
    expect(conditionInputs(p, REGISTRY, TODAY).mileage).toEqual({ value: 61500, evidence: 'declared' });
    expect(conditionInputs(p, REGISTRY, '2026-06-01').mileage).toEqual({ value: 50000, evidence: 'documented' });
    expect(conditionInputs(parked(), REGISTRY, TODAY).mileage).toBeNull();
  });
});

describe('the mileage log', () => {
  const reading = (p: Passport, date: string, mileage: number, now = NOW): Passport => add(p, { type: 'mileage', date, mileage }, now)[0];
  const log = (p: Passport, registry = REGISTRY, asOf = TODAY) => mileageLog(p, registry, asOf);

  it('lets a slipped digit be put right the day it was written, and leaves no mark', () => {
    let p = reading(reading(parked(), '2026-03-01', 48000), '2026-06-01', 49000);
    p = reading(p, '2026-09-01', 500000, '2026-09-01T10:00:00.000Z');
    p = reading(p, '2026-09-01', 50000, '2026-09-01T10:05:00.000Z');
    expect(log(p).days.map((d) => d.mileage)).toEqual([48000, 49000, 50000]);
    expect(log(p).rollback).toBe(false);
    // The next ordinary reading, weeks later, is an ordinary reading. It used to brand the car with a rollback for good.
    p = reading(p, '2026-11-09', 51000);
    expect(log(p)).toMatchObject({ rollback: false, current: { value: 51000, date: '2026-11-09' } });
    expect(conditionInputs(p, REGISTRY, TODAY).mileage).toEqual({ value: 51000, evidence: 'declared' });
    // An old receipt entered today with a slip, and put right today, is the same thing: the day it was written is what counts.
    let q = reading(parked(), '2026-11-09', 52000, '2026-11-09T08:00:00.000Z');
    q = reading(q, '2025-04-01', 410000, '2026-11-10T09:00:00.000Z');
    expect(log(q).rollback).toBe(true);
    q = reading(q, '2025-04-01', 41000, '2026-11-10T09:02:00.000Z');
    expect(log(q)).toMatchObject({ rollback: false, current: { value: 52000 } });
    expect(log(q).days.map((d) => d.mileage)).toEqual([41000, 52000]);
  });

  it('does not let an entry written on a later day rewrite an old reading', () => {
    // 90,000 in January, 50,000 in October: a rollback, and wear is counted from 90,000.
    let p = reading(parked(), '2026-01-10', 90000, '2026-01-10T09:00:00.000Z');
    p = reading(p, '2026-10-01', 50000, '2026-10-01T09:00:00.000Z');
    expect(log(p)).toMatchObject({ rollback: true, current: { value: 90000, date: '2026-01-10' } });
    // In November the owner adds an entry dated back on the day of the high reading. It used to replace that day's
    // reading: the rollback vanished and wear was counted from 50,000. Now both readings stand.
    const rewritten = reading(p, '2026-01-10', 40000, '2026-11-10T12:00:00.000Z');
    expect(log(rewritten).rollback).toBe(true);
    expect(log(rewritten).current).toMatchObject({ value: 90000, date: '2026-01-10' });
    expect(log(rewritten).days.map((d) => d.mileage)).toEqual([90000, 50000]);
    expect(conditionInputs(rewritten, REGISTRY, TODAY).mileage).toEqual({ value: 90000, evidence: 'declared' });
    // With a single reading on file, a back-dated lower one changes nothing either: no flag to clear, no wear to shed.
    const single = reading(parked(), '2026-01-10', 90000, '2026-01-10T09:00:00.000Z');
    const lowered = reading(single, '2026-01-10', 30000, '2026-11-10T12:00:00.000Z');
    expect(log(lowered)).toMatchObject({ rollback: false, current: { value: 90000 } });
    expect(log(lowered).days.map((d) => d.mileage)).toEqual([90000]);
    expect(conditionInputs(lowered, REGISTRY, TODAY).mileage?.value).toBe(90000);
    // Not even one written the very next day.
    const nextDay = reading(single, '2026-01-10', 30000, '2026-01-11T00:00:01.000Z');
    expect(log(nextDay).current?.value).toBe(90000);
  });

  it('catches a reading wound back, whichever way round the entries are dated', () => {
    const base = reading(reading(parked(), '2026-02-01', 48000, '2026-02-01T09:00:00.000Z'), '2026-08-01', 100000, '2026-08-01T09:00:00.000Z');
    expect(log(base).rollback).toBe(false);
    // A lower reading on a later day.
    const wound = reading(base, '2026-09-01', 60000, '2026-09-01T09:00:00.000Z');
    expect(log(wound)).toMatchObject({ rollback: true, current: { value: 100000 } });
    expect(conditionInputs(wound, REGISTRY, TODAY).mileage?.value).toBe(100000);
    // A high reading dated back before a lower one is the same contradiction.
    expect(log(reading(base, '2026-01-15', 70000))).toMatchObject({ rollback: true, current: { value: 100000 } });
    // An equal reading is not a rollback, and neither are two readings of one day that differ.
    expect(log(reading(base, '2026-09-01', 100000)).rollback).toBe(false);
    expect(log(reading(base, '2026-08-01', 99990, '2026-08-20T09:00:00.000Z'))).toMatchObject({ rollback: false, current: { value: 100000 } });
    // A slip put right the same day still has to agree with the days before it.
    const slip = reading(base, '2026-08-01', 30000, '2026-08-01T09:05:00.000Z');
    expect(log(slip).days.map((d) => d.mileage)).toEqual([48000, 30000]);
    expect(log(slip).rollback).toBe(true);
  });

  it('never lets a reading the owner typed displace a verifier’s reading of the same day', () => {
    let p = reading(parked(), '2026-02-01', 48000);
    [p] = attest(p, 'mileage', { mileage: 190000 });
    p = reading(p, '2026-11-01', 20000, '2026-11-10T12:00:01.000Z');
    expect(log(p).days.map((d) => [d.mileage, d.evidence])).toEqual([[48000, 'declared'], [190000, 'verified']]);
    expect(log(p).current).toMatchObject({ value: 190000, evidence: 'verified' });
    // With no verifier registered there is no verified reading, and the owner's entries are all there is.
    expect(log(p, EMPTY_REGISTRY).days.map((d) => d.mileage)).toEqual([48000, 20000]);
    expect(log(p, EMPTY_REGISTRY).rollback).toBe(true);
    // An owner's reading that agrees with the inspector's is called verified, and still does not take its place:
    // the day reads what the inspector read, and ranked play counts the inspector's figure, not the owner's.
    let q = attest(parked(), 'mileage', { mileage: 50000 })[0];
    q = reading(q, '2026-11-01', 49900, '2026-11-10T12:00:01.000Z');
    expect(log(q).days.map((d) => [d.mileage, d.evidence])).toEqual([[50000, 'verified']]);
    q = reading(q, '2026-11-01', 50100, '2026-11-10T12:00:02.000Z');
    expect(log(q).current).toMatchObject({ value: 50100, evidence: 'verified' });
    expect(competitionConditionInputs(q, REGISTRY, TODAY).mileage).toEqual({ value: 50000, evidence: 'verified' });
    // An owner repeating the inspector's exact figure on a later day does not weaken it.
    const echoed = reading(attest(parked(), 'mileage', { mileage: 50000 })[0], '2026-11-09', 50000);
    expect(log(echoed).current).toMatchObject({ value: 50000, evidence: 'verified', date: '2026-11-01' });
  });

  it('never lets a reading the owner typed displace one on a record a verifier confirmed, even the day it was written', () => {
    // Morning: the owner enters a receipt showing 90,000. Midday: the shop confirms that record. Afternoon: the owner
    // "corrects" the same day's reading to 30,000. All on one day, which is when a slip may be put right.
    let p = parked();
    let confirmed: string;
    [p, confirmed] = add(p, { type: 'maintenance', date: '2026-11-01', mileage: 90000, shop: 'A shop', cost: 80, attachments: [file('receipt')] }, '2026-11-10T09:00:00.000Z');
    p = ok(recordAttestation(p, blank('documentation', { verifierId: 'shop-bob', events: [confirmed], date: '2026-11-10' }), REGISTRY, { now: '2026-11-10T11:00:00.000Z', eventId: id() }));
    p = reading(p, '2026-11-01', 30000, '2026-11-10T15:00:00.000Z');
    // The confirmed reading stands beside the owner's, and wear is counted from it.
    expect(log(p).readings.map((r) => [r.mileage, r.evidence])).toEqual([[90000, 'verified'], [30000, 'declared']]);
    expect(log(p).current).toMatchObject({ value: 90000, evidence: 'verified' });
    // Where the shop is not registered the record is the owner's own, and the afternoon's entry does correct it.
    expect(log(p, EMPTY_REGISTRY).readings.map((r) => r.mileage)).toEqual([30000]);
  });

  it('counts ranked wear from the highest reading a verifier took or confirmed, whatever the owner adds', () => {
    let p = parked();
    let high: string;
    [p, high] = receipt(p, '2026-03-01', { mileage: 90000 });
    [p] = attest(p, 'documentation', { verifierId: 'shop-bob', events: [high], date: '2026-03-02' });
    [p] = attest(p, 'mileage', { mileage: 50000 });
    // The later verified reading is lower: ranked wear still counts from the highest.
    expect(competitionConditionInputs(p, REGISTRY, TODAY).mileage).toEqual({ value: 90000, evidence: 'verified' });
    const before = competitionConditionInputs(p, REGISTRY, TODAY);
    for (const [date, mileage] of [['2026-11-09', 10], ['2026-11-09', 400000], ['2026-03-01', 1000], ['2026-11-01', 50050], ['2026-11-01', 49950]] as const) {
      expect(competitionConditionInputs(reading(p, date, mileage), REGISTRY, TODAY), `${date} ${mileage}`).toEqual(before);
    }
  });

  it('keeps a verifier’s reading on the record after its twelve months are up', () => {
    // Recorded the day after the inspector read the odometer, a year before today.
    const attested = id();
    let p = ok(recordAttestation(parked(), blank('mileage', { mileage: 190000, date: '2025-11-01' }), REGISTRY, { now: '2025-11-02T12:00:00.000Z', eventId: attested }));
    p = reading(p, '2026-10-05', 60000, '2026-10-05T12:00:00.000Z');
    // The owner also writes a low reading dated on the inspector's own day.
    p = reading(p, '2025-11-01', 20000, '2026-10-05T12:01:00.000Z');
    // Inside the window: verified, and the lower reading after it is a rollback.
    expect(log(p, REGISTRY, '2026-10-10')).toMatchObject({ rollback: true, current: { value: 190000, evidence: 'verified' } });
    // A month later the attestation has lapsed. It verifies nothing now, but the inspector still read 190,000 that day:
    // the reading stays in the log, the owner's entry does not take its place, and so the rollback stays too.
    // Waiting it out clears nothing.
    expect(statusOf(p, attested, REGISTRY, '2026-11-10')).toMatchObject({ valid: false, reason: VERIFICATION_REFUSALS.lapsed });
    const later = standingOf(p, REGISTRY, '2026-11-10');
    expect(later.lapsed).toEqual([attested]);
    expect(later.events.some((e) => e.id === attested)).toBe(true);
    expect(log(p, REGISTRY, '2026-11-10')).toMatchObject({ rollback: true, current: { value: 190000, evidence: 'documented' } });
    expect(log(p, REGISTRY, '2026-11-10').days.map((d) => d.mileage)).toEqual([190000, 60000]);
    expect(eventEvidence(p, attested, REGISTRY, '2026-11-10')).toBe('documented');
    expect(validAttestations(p, REGISTRY, '2026-11-10', 'mileage')).toEqual([]);
    // Ranked play reads verified readings only, so it no longer reads this one.
    expect(competitionConditionInputs(p, REGISTRY, '2026-11-10').mileage).toBeNull();
    // The public view still lists the entry, and no longer calls it verified.
    const shown = publicPassport(p, REGISTRY, '2026-11-10').events.filter((e) => e.type === 'attestation');
    expect(shown).toMatchObject([{ scope: 'mileage', mileage: 190000, verified: false }]);
    // An attestation that never counted leaves nothing behind: an unknown verifier's reading is not on the record.
    expect(log(p, EMPTY_REGISTRY, '2026-11-10').days.map((d) => d.mileage)).toEqual([20000, 60000]);
    expect(standingOf(p, EMPTY_REGISTRY, '2026-11-10').lapsed).toEqual([]);
  });
});

/* ------------------------------------------------------------------- withdrawals ---- */

describe('withdrawing a record', () => {
  const trail = (): { p: Passport; bad: string; good: string; authority: string; authorityEvent: string } => {
    let p = parked();
    let bad: string, good: string;
    [p, bad] = receipt(p, '2026-05-01');
    [p, good] = receipt(p, '2026-06-01');
    const [q, authorityEvent, authority] = attest(p, 'documentation', { verifierId: 'shop-bob', events: [good] });
    return { p: q, bad, good, authority, authorityEvent };
  };
  const withdraw = (p: Passport, target: string, attestationId: string, registry = REGISTRY, now = NOW) =>
    voidEvent(p, { target, reason: 'The invoice number belongs to another car', attestationId }, registry, { now, eventId: id() });

  it('takes a verifier with a records attestation that counts, and leaves the record on the passport', () => {
    const { p, bad, good, authority } = trail();
    const after = ok(withdraw(p, bad, authority));
    expect(after.events.some((e) => e.id === bad)).toBe(true);
    expect(after.events[after.events.length - 1]).toMatchObject({ type: 'void', by: 'shop-bob', target: bad, date: TODAY, attestationId: authority, visibility: 'private' });
    expect(voidedEventIds(after, REGISTRY, TODAY)).toEqual([bad]);
    expect(documentedRecords(after, REGISTRY, TODAY).map((e) => e.id)).toEqual([good]);
    expect(eventEvidence(after, bad, REGISTRY, TODAY)).toBe('declared');
    expect(standingOf(after, REGISTRY, TODAY).events.some((e) => e.id === bad || e.type === 'void')).toBe(false);
    // Looking back to before the withdrawal, the record still stood.
    expect(voidedEventIds(after, REGISTRY, '2026-11-09')).toEqual([]);
  });

  it('is refused without that authority, and for anything that cannot be withdrawn', () => {
    const { p, bad, authority } = trail();
    const [withIdentity, , identity] = attest(p, 'identity');
    expect(reason(withdraw(withIdentity, bad, identity))).toBe(VERIFICATION_REFUSALS.authority);
    expect(reason(withdraw(p, bad, 'no-such-attestation'))).toBe(VERIFICATION_REFUSALS.authority);
    expect(reason(withdraw(p, bad, authority, without('shop-bob')))).toBe(VERIFICATION_REFUSALS.authority);
    expect(reason(withdraw(p, bad, authority, EMPTY_REGISTRY))).toBe(VERIFICATION_REFUSALS.authority);
    // Two years on the records attestation has lapsed, and with it the authority to withdraw anything new.
    expect(reason(withdraw(p, bad, authority, REGISTRY, '2028-11-02T12:00:00.000Z'))).toBe(VERIFICATION_REFUSALS.authority);
    expect(reason(withdraw(p, 'no-such-entry', authority))).toBe(VERIFICATION_REFUSALS.target);
    expect(reason(withdraw(p, p.events[0].id, authority))).toBe(VERIFICATION_REFUSALS.target);
    const sold = ok(transferOwnership(p, { eventId: 'the-sale', toOwnerId: 'owner-two', date: '2026-11-05' }, { now: NOW, by: OWNER }));
    expect(reason(withdraw(sold, 'the-sale', authority))).toBe(VERIFICATION_REFUSALS.target);
    const once = ok(withdraw(p, bad, authority));
    expect(reason(withdraw(once, bad, authority))).toBe(VERIFICATION_REFUSALS.target);
    expect(reason(withdraw(once, once.events[once.events.length - 1].id, authority))).toBe(VERIFICATION_REFUSALS.target);
    expect(reason(voidEvent(p, { target: bad, reason: '', attestationId: authority }, REGISTRY, { now: 'soon', eventId: id() }))).toBe(VERIFICATION_REFUSALS.timestamp);
    expect(reason(voidEvent(p, { target: bad, reason: '', attestationId: authority }, REGISTRY, { now: NOW, eventId: bad }))).toBe(VERIFICATION_REFUSALS.id);
    expect(reason(voidEvent(p, null as unknown as { target: string; reason: string; attestationId: string }, REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.shape);
  });

  it('stands for good once made, and falls only if the verifier leaves the registry', () => {
    const { p, bad, authority } = trail();
    const after = ok(withdraw(p, bad, authority));
    // Three years later the records attestation has lapsed. The false receipt does not come back with it.
    expect(statusOf(after, after.events.filter((e) => e.type === 'attestation')[0].id, REGISTRY, '2029-11-10').valid).toBe(false);
    expect(voidedEventIds(after, REGISTRY, '2029-11-10')).toEqual([bad]);
    expect(documentedRecords(after, REGISTRY, '2029-11-10').some((e) => e.id === bad)).toBe(false);
    // A verifier struck from the registry takes everything it did with it.
    expect(voidedEventIds(after, without('shop-bob'), TODAY)).toEqual([]);
    expect(documentedRecords(after, without('shop-bob'), TODAY).some((e) => e.id === bad)).toBe(true);
  });

  it('cannot be faked by writing a withdrawal into the file', () => {
    const { p, bad, good, authority, authorityEvent } = trail();
    const fake = (over: Record<string, unknown>): Passport => appendEvent(p, {
      id: id(), date: TODAY, recordedAt: NOW, by: 'shop-bob', mileage: null, title: 'Record withdrawn', note: '', attachments: [], visibility: 'private',
      type: 'void', target: bad, reason: '', attestationId: authority, ...over,
    } as PassportEvent);
    // The honest shape stands; each of these does not.
    expect(voidedEventIds(fake({}), REGISTRY, TODAY)).toEqual([bad]);
    expect(voidedEventIds(fake({ by: OWNER }), REGISTRY, TODAY)).toEqual([]);
    expect(voidedEventIds(fake({ by: 'inspector-ann' }), REGISTRY, TODAY)).toEqual([]);
    expect(voidedEventIds(fake({ attestationId: 'no-such-attestation' }), REGISTRY, TODAY)).toEqual([]);
    expect(voidedEventIds(fake({ target: 'no-such-entry' }), REGISTRY, TODAY)).toEqual([]);
    expect(voidedEventIds(fake({ target: p.events[0].id }), REGISTRY, TODAY)).toEqual([]);
    // Dated before the authority existed.
    expect(voidedEventIds(fake({ date: '2026-10-01' }), REGISTRY, TODAY)).toEqual([]);
    expect(voidedEventIds(fake({ target: good }), EMPTY_REGISTRY, TODAY)).toEqual([]);
    // Dated after the day asked about: not yet.
    expect(voidedEventIds(fake({ date: '2026-11-12' }), REGISTRY, TODAY)).toEqual([]);
    // A verifier who has left the registry withdraws nothing, not even its own attestation.
    expect(voidedEventIds(fake({ target: authorityEvent }), REGISTRY, TODAY)).toEqual([authorityEvent]);
    expect(voidedEventIds(fake({ target: authorityEvent }), without('shop-bob'), TODAY)).toEqual([]);
  });

  it('cannot be faked under an attestation of another kind, or against another verifier’s attestation', () => {
    const { p, bad, authorityEvent } = trail();
    // The inspector holds a valid identity attestation. That is no authority over the owner's records.
    const [q, identityEvent, identity] = attest(p, 'identity');
    const fake = (over: Record<string, unknown>): Passport => appendEvent(q, {
      id: id(), date: TODAY, recordedAt: NOW, by: 'inspector-ann', mileage: null, title: 'Record withdrawn', note: '', attachments: [], visibility: 'private',
      type: 'void', target: bad, reason: '', attestationId: identity, ...over,
    } as PassportEvent);
    expect(voidedEventIds(fake({}), REGISTRY, TODAY)).toEqual([]);
    expect(documentedRecords(fake({}), REGISTRY, TODAY).some((e) => e.id === bad)).toBe(true);
    // Nor does her own attestation let her strike out the shop's: an attestation is taken back only by its own verifier.
    const againstShop = fake({ target: authorityEvent });
    expect(voidedEventIds(againstShop, REGISTRY, TODAY)).toEqual([]);
    expect(validAttestations(againstShop, REGISTRY, TODAY, 'documentation')).toHaveLength(1);
    // Her own she can take back, and that is all the same entry does.
    expect(voidedEventIds(fake({ target: identityEvent }), REGISTRY, TODAY)).toEqual([identityEvent]);
  });

  it('is written in the name of the verifier whose attestation gives the authority, whatever else is handed in', () => {
    const { p, bad, authority } = trail();
    const sneaky = { target: bad, reason: 'x', attestationId: authority, by: OWNER, date: '2020-01-01' } as unknown as { target: string; reason: string; attestationId: string };
    const after = ok(voidEvent(p, sneaky, REGISTRY, { now: NOW, eventId: id() }));
    expect(after.events[after.events.length - 1]).toMatchObject({ type: 'void', by: 'shop-bob', date: TODAY });
  });
});

describe('taking back an attestation', () => {
  it('is for the verifier who made it, and nobody else', () => {
    let p = parked();
    let receiptId: string;
    [p, receiptId] = receipt(p);
    const [withIdentity, identityEvent, identity] = attest(p, 'identity');
    const [both, , bobRecords] = attest(withIdentity, 'documentation', { verifierId: 'shop-bob', events: [receiptId] });
    // The shop holds a records attestation, which lets it withdraw the owner's records. Not the inspector's attestation.
    expect(reason(voidEvent(both, { target: identityEvent, reason: 'no', attestationId: bobRecords }, REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.notYours);
    const taken = ok(voidEvent(both, { target: identityEvent, reason: 'Wrong car on the lift', attestationId: identity }, REGISTRY, { now: NOW, eventId: id() }));
    expect(taken.events[taken.events.length - 1]).toMatchObject({ type: 'void', by: 'inspector-ann', target: identityEvent });
    expect(statusOf(taken, identityEvent)).toMatchObject({ valid: false, weight: 0, reason: VERIFICATION_REFUSALS.withdrawn });
    expect(validAttestations(taken, REGISTRY, TODAY, 'identity')).toEqual([]);
    expect(validAttestations(taken, REGISTRY, TODAY, 'documentation')).toHaveLength(1);
    expect(standingOf(taken, REGISTRY, TODAY).events.some((e) => e.id === identityEvent)).toBe(false);
    // A verifier who has left the registry cannot act, even on its own attestation.
    expect(reason(voidEvent(both, { target: identityEvent, reason: '', attestationId: identity }, without('inspector-ann'), { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.inactive);
    expect(reason(voidEvent(both, { target: identityEvent, reason: '', attestationId: identity }, EMPTY_REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.unknown);
  });

  it('ends the authority it gave, but not what was done under it', () => {
    let p = parked();
    let bad: string, worse: string, good: string;
    [p, bad] = receipt(p, '2026-05-01');
    [p, worse] = receipt(p, '2026-05-02');
    [p, good] = receipt(p, '2026-06-01');
    let recordsEvent: string, records: string;
    [p, recordsEvent, records] = attest(p, 'documentation', { verifierId: 'shop-bob', events: [good] });
    p = ok(voidEvent(p, { target: bad, reason: 'false', attestationId: records }, REGISTRY, { now: NOW, eventId: id() }));
    p = ok(voidEvent(p, { target: recordsEvent, reason: 'made in error', attestationId: records }, REGISTRY, { now: NOW, eventId: id() }));
    expect(reason(voidEvent(p, { target: worse, reason: 'false', attestationId: records }, REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.authority);
    expect(voidedEventIds(p, REGISTRY, TODAY)).toEqual([bad, recordsEvent]);
    expect(eventEvidence(p, good, REGISTRY, TODAY)).toBe('documented');
    // A withdrawal written into the file after the authority was taken back does not stand.
    const late = appendEvent(p, {
      id: id(), date: TODAY, recordedAt: NOW, by: 'shop-bob', mileage: null, title: '', note: '', attachments: [], visibility: 'private', type: 'void', target: worse, reason: '', attestationId: records,
    } as PassportEvent);
    expect(voidedEventIds(late, REGISTRY, TODAY)).toEqual([bad, recordsEvent]);
  });
});

/* ----------------------------------------------------------- what the engines read ---- */

describe('the modifications ranked play counts', () => {
  const install = (p: Passport, date: string, category = 'turbo', over: Record<string, unknown> = {}) =>
    add(p, { type: 'modification', date, action: 'install', category, tier: 3, install: 'professional', parts: 'kit', undoes: null, ...over });
  const remove = (p: Passport, undoes: string, date = '2026-11-06') =>
    add(p, { type: 'modification', date, action: 'remove', category: 'turbo', tier: 3, install: 'professional', parts: '', undoes });
  const ranked = (p: Passport, registry = REGISTRY, asOf = TODAY) => competitionModifications(p, registry, asOf).map((m) => [m.eventId, m.evidence, m.upkeep]);

  it('are the installs a verifier confirmed, and nothing the owner only declared', () => {
    let p = parked();
    let turbo: string, tires: string;
    [p, turbo] = install(p, '2025-06-01');
    [p, tires] = install(p, '2026-04-01', 'tires');
    expect(ranked(p)).toEqual([]);
    [p] = attest(p, 'modification', { verifierId: 'shop-bob', events: [turbo] });
    expect(ranked(p)).toEqual([[turbo, 'verified', 'lapsed']]);
    expect(activeModifications(p, REGISTRY, TODAY).map((m) => m.eventId)).toEqual([turbo, tires]);
    expect(ranked(p, EMPTY_REGISTRY)).toEqual([]);
    // On a day before the shop confirmed it, it was not on the ranked list.
    expect(ranked(p, REGISTRY, '2026-10-31')).toEqual([]);
    // Fitted less than a year before the day asked about, a verified install's upkeep is 'recent' with nothing more said.
    let q = parked();
    let newer: string;
    [q, newer] = install(q, '2026-06-01');
    [q] = attest(q, 'modification', { verifierId: 'shop-bob', events: [newer] });
    expect(ranked(q)).toEqual([[newer, 'verified', 'recent']]);
  });

  it('take their upkeep from a maintenance record only once a verifier has confirmed it', () => {
    let p = parked();
    let turbo: string;
    [p, turbo] = install(p, '2025-06-01');
    [p] = attest(p, 'modification', { verifierId: 'shop-bob', events: [turbo] });
    // The owner uploads a receipt. The vehicle's own list calls the turbo kept up; the ranked list does not move.
    let service: string;
    [p, service] = receipt(p, '2026-11-05');
    expect(activeModifications(p, REGISTRY, TODAY)[0].upkeep).toBe('documented');
    expect(ranked(p)).toEqual([[turbo, 'verified', 'lapsed']]);
    // The shop confirms the service record: now ranked play counts it too.
    [p] = attest(p, 'documentation', { verifierId: 'shop-bob', events: [service] });
    expect(ranked(p)).toEqual([[turbo, 'verified', 'documented']]);
  });

  it('keep a verified install fitted until a verifier confirms it was removed', () => {
    let p = parked();
    let turbo: string;
    [p, turbo] = install(p, '2025-06-01');
    [p] = attest(p, 'modification', { verifierId: 'shop-bob', events: [turbo] });
    // The owner declares the turbo removed, with no evidence. It leaves the vehicle's own list and stays on the ranked one:
    // dropping it there would raise the scores an endurance race is decided on.
    let removal: string;
    [p, removal] = remove(p, turbo);
    expect(activeModifications(p, REGISTRY, TODAY)).toEqual([]);
    expect(ranked(p)).toEqual([[turbo, 'verified', 'lapsed']]);
    // The shop confirms the removal.
    [p] = attest(p, 'modification', { verifierId: 'shop-bob', events: [removal] });
    expect(ranked(p)).toEqual([]);
    // Before the removal's day it was still fitted.
    expect(ranked(p, REGISTRY, '2026-11-05')).toEqual([[turbo, 'verified', 'lapsed']]);
  });
});

describe('a passport that is full', () => {
  it('refuses a verifier’s entry at the limit too, so what is written can always be read back', () => {
    const base = JSON.parse(serializePassport(parked())) as { events: unknown[] };
    const one = base.events[0] as Record<string, unknown>;
    const holding = (count: number): Passport => ok(parsePassport({ ...base, events: Array.from({ length: count }, (_, i) => ({ ...one, id: `held-${i}` })) })).passport;
    const nearly = holding(MAX_EVENTS - 1);
    const attested = ok(recordAttestation(nearly, blank('identity'), REGISTRY, { now: NOW, eventId: id() }));
    expect(attested.events).toHaveLength(MAX_EVENTS);
    expect(parsePassport(serializePassport(attested)).ok).toBe(true);
    expect(reason(recordAttestation(attested, blank('originality'), REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.full);
    expect(VERIFICATION_REFUSALS.full).toBe(PASSPORT_REFUSALS.full);
    const attestationId = (attested.events[attested.events.length - 1] as Extract<PassportEvent, { type: 'attestation' }>).attestation.id;
    expect(reason(voidEvent(attested, { target: attested.events[attested.events.length - 1].id, reason: 'made in error', attestationId }, REGISTRY, { now: NOW, eventId: id() }))).toBe(VERIFICATION_REFUSALS.full);
  });
});

describe('fitted modifications', () => {
  const install = (p: Passport, date: string, category = 'turbo', over: Record<string, unknown> = {}) =>
    add(p, { type: 'modification', date, action: 'install', category, tier: 2, install: 'professional', parts: 'kit', undoes: null, ...over });

  it('are the installs that stand and that nothing has removed', () => {
    let p = parked();
    let turbo: string, tires: string;
    [p, turbo] = install(p, '2026-03-01', 'turbo', { mileage: 58000 });
    [p, tires] = install(p, '2026-04-01', 'tires', { tier: 1, install: 'owner' });
    expect(activeModifications(p, REGISTRY, TODAY)).toEqual([
      { eventId: turbo, category: 'turbo', tier: 2, install: 'professional', evidence: 'declared', installedOn: '2026-03-01', recordedAt: NOW, installedAtMileage: 58000, upkeep: 'recent' },
      { eventId: tires, category: 'tires', tier: 1, install: 'owner', evidence: 'declared', installedOn: '2026-04-01', recordedAt: NOW, installedAtMileage: null, upkeep: 'recent' },
    ]);
    expect(activeModifications(p, REGISTRY, '2026-03-15').map((m) => m.eventId)).toEqual([turbo]);
    [p] = add(p, { type: 'modification', date: '2026-08-01', action: 'remove', category: 'turbo', tier: 2, install: 'professional', parts: '', undoes: turbo });
    expect(activeModifications(p, REGISTRY, TODAY).map((m) => m.eventId)).toEqual([tires]);
    // On a day before the removal, it was still fitted.
    expect(activeModifications(p, REGISTRY, '2026-07-31').map((m) => m.eventId)).toEqual([turbo, tires]);
  });

  it('take the later of two fitted the same day by when each was written down, not by its id', () => {
    // An upgrade on the day the car was parked. The ids are chosen so that sorting by id would pick the wrong one.
    for (const [first, second] of [['zz-street', 'aa-extreme'], ['aa-street', 'zz-extreme']]) {
      let p = parked();
      p = ok(addEvent(p, { id: first, type: 'modification', date: '2026-11-10', action: 'install', category: 'turbo', tier: 1, install: 'professional', parts: '', undoes: null }, { now: '2026-11-10T10:00:00.000Z', by: OWNER }));
      p = ok(addEvent(p, { id: second, type: 'modification', date: '2026-11-10', action: 'install', category: 'turbo', tier: 3, install: 'professional', parts: '', undoes: null }, { now: '2026-11-10T10:00:05.000Z', by: OWNER }));
      const { applied, refused } = resolveModifications(p.spec, activeModifications(p, REGISTRY, TODAY));
      expect(applied.map((m) => [m.eventId, m.tier]), first).toEqual([[second, 3]]);
      expect(refused.map((m) => m.eventId), first).toEqual([first]);
    }
  });

  it('are looked after, recently fitted, or neither', () => {
    let p = parked();
    [p] = install(p, '2024-06-01');
    const upkeep = (q: Passport, asOf = TODAY) => activeModifications(q, REGISTRY, asOf)[0].upkeep;
    expect(upkeep(p, '2025-05-31')).toBe('recent');
    expect(upkeep(p, '2025-06-01')).toBe('lapsed');
    // A maintenance entry with no file is the owner's word and does not count as upkeep.
    const [unbacked] = add(p, { type: 'maintenance', date: '2026-09-01', shop: '', cost: null });
    expect(upkeep(unbacked)).toBe('lapsed');
    const [backed] = receipt(p, '2026-09-01');
    expect(upkeep(backed)).toBe('documented');
    expect(upkeep(backed, '2027-09-01')).toBe('lapsed');
    // Maintenance from before the install says nothing about how the modification was kept.
    const [before] = receipt(p, '2024-05-01');
    expect(upkeep(before, '2025-01-01')).toBe('recent');
    expect(upkeep(before)).toBe('lapsed');
  });

  it('do not include an install a verifier withdrew', () => {
    let p = parked();
    let turbo: string, good: string;
    [p, turbo] = install(p, '2026-03-01', 'turbo', { attachments: [file('invoice')] });
    [p, good] = receipt(p);
    let records: string;
    [p, , records] = attest(p, 'documentation', { verifierId: 'shop-bob', events: [good] });
    expect(activeModifications(p, REGISTRY, TODAY)).toHaveLength(1);
    p = ok(voidEvent(p, { target: turbo, reason: 'never fitted', attestationId: records }, REGISTRY, { now: NOW, eventId: id() }));
    expect(activeModifications(p, REGISTRY, TODAY)).toEqual([]);
  });
});

describe('what the condition engine is given', () => {
  it('reads replacements, inspections and the owner’s latest standing declarations', () => {
    let p = parked();
    let swap: string;
    [p] = add(p, { type: 'repair', date: '2026-02-01', system: 'brakes', work: 'repair', shop: '', cost: null });
    [p] = add(p, { type: 'repair', date: '2026-02-02', system: null, work: 'replacement', shop: '', cost: null });
    [p, swap] = add(p, { type: 'repair', date: '2026-02-03', system: 'engine', work: 'rebuild', shop: 'A shop', cost: 4000, mileage: 59000, attachments: [file('invoice')] });
    [p] = add(p, { type: 'repair', date: '2026-02-04', system: 'tires', work: 'replacement', shop: '', cost: null });
    [p] = add(p, { type: 'declaration', date: '2026-01-01', accident: 'Minor', titleStatus: 'Clean' });
    let latest: string;
    [p, latest] = add(p, { type: 'declaration', date: '2026-03-01', accident: 'None', attachments: [file('other')] });
    [p] = attest(p, 'condition', { conditionScore: 88, systems: { engine: 0.1, tires: 0.4 } });
    [p] = attest(p, 'condition', { conditionScore: 80, date: '2026-10-01' });
    const input = conditionInputs(p, REGISTRY, TODAY);
    expect(input).toMatchObject({ asOf: TODAY, modelYear: 2019, powertrain: 'gasoline', accident: 'None', titleStatus: 'Clean', mileage: { value: 59000, evidence: 'documented' } });
    expect(input.replacements).toEqual([
      { system: 'engine', date: '2026-02-03', mileage: 59000, evidence: 'documented' },
      { system: 'tires', date: '2026-02-04', mileage: null, evidence: 'declared' },
    ]);
    // Only an inspection that looked at systems gives the engine readings.
    expect(input.inspections).toEqual([{ date: '2026-11-01', systems: { engine: 0.1, tires: 0.4 } }]);
    expect(conditionInputs(p, EMPTY_REGISTRY, TODAY).inspections).toEqual([]);
    expect(conditionInputs(p, REGISTRY, '2026-02-15').accident).toBe('Minor');

    // A verifier confirms the rebuild, and withdraws the newer declaration: the older one speaks again.
    let records: string;
    [p, , records] = attest(p, 'documentation', { events: [swap] });
    expect(conditionInputs(p, REGISTRY, TODAY).replacements[0].evidence).toBe('verified');
    p = ok(voidEvent(p, { target: latest, reason: 'The repair bill says otherwise', attestationId: records }, REGISTRY, { now: NOW, eventId: id() }));
    expect(conditionInputs(p, REGISTRY, TODAY).accident).toBe('Minor');
  });
});

describe('what the condition engine is given for ranked play', () => {
  it('is only what a verifier took or confirmed', () => {
    let p = parked();
    let swap: string, tires: string;
    [p] = add(p, { type: 'mileage', date: '2026-01-01', mileage: 50000, attachments: [file('photo')] });
    [p, swap] = add(p, { type: 'repair', date: '2026-02-03', system: 'engine', work: 'rebuild', shop: 'A shop', cost: 4000, mileage: 59000, attachments: [file('invoice')] });
    [p, tires] = add(p, { type: 'repair', date: '2026-02-04', system: 'tires', work: 'replacement', shop: '', cost: null, attachments: [file('invoice')] });
    [p] = add(p, { type: 'declaration', date: '2026-03-01', accident: 'Major', titleStatus: 'Salvage' });
    // Nothing is verified yet: ranked play is told nothing about this car's condition.
    expect(competitionConditionInputs(p, REGISTRY, TODAY)).toEqual({
      asOf: TODAY, modelYear: 2019, powertrain: 'gasoline', mileage: null, replacements: [], inspections: [], accident: null, titleStatus: null,
    });
    [p] = attest(p, 'mileage', { mileage: 61000 });
    [p] = attest(p, 'documentation', { events: [swap] });
    [p] = attest(p, 'condition', { conditionScore: 88, systems: { suspension: 0.3 } });
    // The owner's newer reading and the unconfirmed tire receipt are on the vehicle's own record, not on this one.
    [p] = add(p, { type: 'mileage', date: '2026-11-09', mileage: 61500 });
    expect(competitionConditionInputs(p, REGISTRY, TODAY)).toEqual({
      asOf: TODAY, modelYear: 2019, powertrain: 'gasoline',
      mileage: { value: 61000, evidence: 'verified' },
      replacements: [{ system: 'engine', date: '2026-02-03', mileage: 59000, evidence: 'verified' }],
      inspections: [{ date: '2026-11-01', systems: { suspension: 0.3 } }],
      accident: null, titleStatus: null,
    });
    expect(conditionInputs(p, REGISTRY, TODAY)).toMatchObject({ mileage: { value: 61500, evidence: 'declared' }, accident: 'Major', titleStatus: 'Salvage' });
    expect(conditionInputs(p, REGISTRY, TODAY).replacements.map((r) => r.system)).toEqual(['engine', 'tires']);
    expect(eventEvidence(p, tires, REGISTRY, TODAY)).toBe('documented');
    // With no verifier connected there is nothing verified to give.
    expect(competitionConditionInputs(p, EMPTY_REGISTRY, TODAY)).toMatchObject({ mileage: null, replacements: [], inspections: [] });
  });
});

/* ----------------------------------------------------------------- the public view ---- */

describe('the public view', () => {
  const MARK = 'ZQXJ';
  const PRIVATE = {
    note: `${MARK}-note`, shop: `${MARK}-shop`, inspector: `${MARK}-inspector`, parts: `${MARK}-parts`, scope: `${MARK}-scope`, fileName: `${MARK}-file`,
    privateTitle: `${MARK}-private-title`, attestationNote: `${MARK}-attestation-note`, signature: `${MARK}-signature`, reason: `${MARK}-void-reason`,
    sourceName: `${MARK}-source`, sourceUrl: `https://example.invalid/${MARK}`, snapshotReason: `${MARK}-snapshot-reason`, editionReason: `${MARK}-edition-reason`,
    snapshotId: `${MARK}-snapshot-id`,
  };
  const PUBLIC_TITLE = 'Timing belt and water pump';

  const full = (): Passport => {
    const named = (kind: Attachment['kind']): Attachment => ({ ...file(kind), name: `${PRIVATE.fileName}.pdf`, sha256: 'c'.repeat(64) });
    const source = { kind: 'manufacturer', name: PRIVATE.sourceName, url: PRIVATE.sourceUrl, asOf: TODAY } as const;
    let p = ok(createPassport({ micarId: 'MC-0000-0000-0000', now: '2024-01-02T09:00:00.000Z', ownerId: OWNER, spec: civic({ horsepower: { value: 158, source } }), vin: VIN, color: 'Rallye Red', eventId: id() }));
    [p] = add(p, { type: 'maintenance', date: '2026-03-14', mileage: 58765, title: PUBLIC_TITLE, note: PRIVATE.note, shop: PRIVATE.shop, cost: 987.65, attachments: [named('receipt'), named('invoice'), named('receipt')], visibility: 'public' });
    [p] = add(p, { type: 'inspection', date: '2026-04-15', title: PRIVATE.privateTitle, note: PRIVATE.note, inspector: PRIVATE.inspector, attachments: [named('report')] });
    [p] = add(p, { type: 'modification', date: '2026-05-16', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: PRIVATE.parts, undoes: null, note: PRIVATE.note });
    [p] = add(p, { type: 'restoration', date: '2026-06-17', scope: PRIVATE.scope, oemParts: true });
    let bad: string, good: string;
    [p, bad] = receipt(p, '2026-07-18', { title: 'Withdrawn later', visibility: 'public' });
    [p, good] = receipt(p, '2026-08-19');
    p = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: '2026-09-20' }, { now: NOW, by: OWNER }));
    let records: string;
    [p, , records] = attest(p, 'documentation', { events: [good], note: PRIVATE.attestationNote, signature: PRIVATE.signature });
    [p] = attest(p, 'mileage', { mileage: 61999, note: PRIVATE.attestationNote });
    p = ok(voidEvent(p, { target: bad, reason: PRIVATE.reason, attestationId: records }, REGISTRY, { now: NOW, eventId: id() }));
    return {
      ...p,
      snapshots: [{ id: PRIVATE.snapshotId, at: '2026-03-14T10:11:12.000Z', asOf: '2026-03-14', reason: PRIVATE.snapshotReason, formula: 'micar-grade-v2', overall: 38, grade10: 3.8, tier: 3, categories: { identity: 40, documentation: 30, condition: 60, originality: 50, verification: 0 }, level: 'registered', events: 2 }],
      editions: [{ number: 1, name: 'Registration Edition', issuedAt: '2026-03-14T10:11:12.000Z', level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: 601, attributes: { power: 404, speed: 656, acceleration: 370, handling: 565, durability: 635, reliability: 855, efficiency: 720 }, reason: PRIVATE.editionReason }],
    };
  };

  it('shows the vehicle and the shape of its history', () => {
    const view = publicPassport(full(), REGISTRY, TODAY);
    expect(view).toMatchObject({
      micarId: 'MC-0000-0000-0000', createdMonth: '2024-01', identity: { year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }, color: 'Rallye Red',
      vinOnFile: true, ownerCount: 2, currentOwnerSince: '2026-09',
    });
    expect(view.events.map((e) => [e.type, e.month, e.title, e.mileage, e.verified, e.scope])).toEqual([
      ['registered', '2024-01', 'Parked', null, false, null],
      ['maintenance', '2026-03', PUBLIC_TITLE, 58000, false, null],
      ['inspection', '2026-04', 'Inspection report', null, false, null],
      ['modification', '2026-05', 'Modification', null, false, null],
      ['restoration', '2026-06', 'Restoration', null, false, null],
      ['maintenance', '2026-08', 'Maintenance', null, true, null],
      ['transfer', '2026-09', 'Ownership transfer', null, false, null],
      ['attestation', '2026-11', 'Attestation', null, true, 'documentation'],
      ['attestation', '2026-11', 'Attestation', 61000, true, 'mileage'],
    ]);
    expect(view.events[1].attachments).toEqual({ receipt: 2, invoice: 1 });
    expect(view.snapshots).toEqual([{ month: '2026-03', formula: 'micar-grade-v2', overall: 38, grade10: 3.8, tier: 3, categories: { identity: 40, documentation: 30, condition: 60, originality: 50, verification: 0 }, level: 'registered' }]);
    // An edition is shown by what the record can stand behind. The Power Rating and attributes printed on it are the
    // specification sheet's account on the day of printing, which nothing on the record can check: they are left out.
    expect(view.editions).toEqual([{ number: 1, name: 'Registration Edition', month: '2026-03', level: 'registered', rarity: 'common', finish: 'raw', grade10: null }]);
    expect(JSON.stringify(view)).not.toContain('powerRating');
    expect(JSON.stringify(view)).not.toContain('601');
    expect(publicPassport(ok(updateVin(parked(), '', { by: OWNER })), REGISTRY, TODAY).vinOnFile).toBe(false);
  });

  it('holds none of the private strings, ids, exact days or exact figures', () => {
    const p = full();
    const text = JSON.stringify(publicPassport(p, REGISTRY, TODAY));
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(VIN);
    expect(text).not.toContain(VIN.slice(-6));
    for (const secret of [OWNER, 'owner-two', 'inspector-ann', 'shop-bob', 'Withdrawn later', '987.65', '58765', '61999', 'c'.repeat(64), 'image/jpeg', 'fixture']) expect(text, secret).not.toContain(secret);
    // No id of any entry, file, attestation or snapshot, and no exact day or time.
    for (const e of p.events) {
      expect(text, e.id).not.toContain(`"${e.id}"`);
      for (const a of e.attachments) expect(text, a.id).not.toContain(`"${a.id}"`);
      if (e.type === 'attestation') expect(text).not.toContain(`"${e.attestation.id}"`);
    }
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // The keys are exactly these: nothing rides along.
    const view = publicPassport(p, REGISTRY, TODAY);
    expect(Object.keys(view).sort()).toEqual(['color', 'createdMonth', 'currentOwnerSince', 'editions', 'events', 'identity', 'micarId', 'ownerCount', 'snapshots', 'vinOnFile']);
    for (const e of view.events) expect(Object.keys(e).sort()).toEqual(['attachments', 'mileage', 'month', 'scope', 'title', 'type', 'verified']);
    for (const snap of view.snapshots) expect(Object.keys(snap).sort()).toEqual(['categories', 'formula', 'grade10', 'level', 'month', 'overall', 'tier']);
    expect(view.editions).toHaveLength(1);
    for (const edition of view.editions) expect(Object.keys(edition).sort()).toEqual(['finish', 'grade10', 'level', 'month', 'name', 'number', 'rarity']);
  });

  it('shares nothing with the passport it was made from', () => {
    const p = full();
    const before = serializePassport(p);
    const view = publicPassport(p, REGISTRY, TODAY);
    view.identity.make = 'Changed';
    view.snapshots[0].categories.identity = 0;
    view.editions[0].name = 'Changed';
    expect(serializePassport(p)).toBe(before);
  });
});
