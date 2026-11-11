import { describe, expect, it } from 'vitest';
import { micarIdFromBytes } from './identity';
import {
  EVENT_TYPE_LABELS, PASSPORT_REFUSALS, addEvent, appendEdition, appendSnapshot, attachmentCount, checkAttachment, checkAttestation, createPassport, currentOwner, eventById,
  everOwned, latestDeclaration, latestMileage, mileageReadings, parsePassport, serializePassport, timeline, transferOwnership, updateSpec, updateVin, MAX_EDITIONS, MAX_EVENTS,
  MAX_SNAPSHOTS, RESERVED_ENTRIES,
} from './passport';
import { emptySpec } from './specs';
import { OWNER_EVENT_TYPES } from './types';
import type { Attachment, CardEdition, GradeSnapshot, Passport, PassportEvent, Result, Sourced, VehicleSpec } from './types';

const OWNER = 'owner-one';
const NOW = '2026-11-10T12:00:00.000Z';
const VIN = '1M8GDM9AXKP042788';

const ref = { kind: 'reference', name: 'fixture', asOf: '2026-11-10' } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });
const civic: VehicleSpec = {
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), horsepower: s(158), curbWeightLb: s(2877), transmissionType: s('cvt'),
};

let n = 0;
const id = () => `e${++n}`;
const file = (kind: Attachment['kind'] = 'receipt', name = 'receipt.pdf'): Attachment => ({ id: id(), kind, name, mime: 'application/pdf', size: 2048, sha256: 'a'.repeat(64) });
const ok = <T>(r: Result<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const reason = <T>(r: Result<T>): string => { if (r.ok) throw new Error('expected a refusal'); return r.reason; };
const MICAR_ID = ok(micarIdFromBytes([1, 2, 3, 4, 5, 6, 7]));
const parked = (): Passport => ok(createPassport({ micarId: MICAR_ID, now: '2026-01-05T09:00:00.000Z', ownerId: OWNER, spec: civic, color: 'Blue', vin: VIN, eventId: id() }));
const entry = (over: Record<string, unknown>): Record<string, unknown> => ({ id: id(), type: 'maintenance', date: '2026-03-01', mileage: null, title: '', note: '', attachments: [], visibility: 'private', shop: '', cost: null, ...over });
const add = (p: Passport, over: Record<string, unknown>, by = OWNER, now = NOW): Result<Passport> => addEvent(p, entry(over), { now, by });

describe('parking a car', () => {
  it('gives it an identity, a first owner and a first entry', () => {
    const p = parked();
    expect(p.schema).toBe(1);
    expect(p.micarId).toBe(MICAR_ID);
    expect(p.vin).toBe(VIN);
    expect(p.color).toBe('Blue');
    expect(p.owners).toEqual([{ ownerId: OWNER, from: '2026-01-05', to: null }]);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({ type: 'registered', date: '2026-01-05', by: OWNER, title: 'Parked', visibility: 'private' });
    expect(p.snapshots).toEqual([]);
    expect(p.editions).toEqual([]);
    expect(currentOwner(p)).toBe(OWNER);
    expect(everOwned(p, OWNER)).toBe(true);
    expect(everOwned(p, 'someone-else')).toBe(false);
  });

  it('normalises the VIN and lets it be left out', () => {
    const base = { micarId: MICAR_ID, now: NOW, ownerId: OWNER, spec: civic, eventId: 'x1' };
    expect(ok(createPassport({ ...base, vin: ' 1m8gd-m9axkp042788 ' })).vin).toBe(VIN);
    expect(ok(createPassport(base)).vin).toBe('');
    expect(ok(createPassport({ ...base, vin: '' })).vin).toBe('');
    expect(ok(createPassport({ ...base, vin: '9F02R123456' })).vin).toBe('9F02R123456');
  });

  it('refuses what is not an identity, a time, an owner, a specification or a VIN', () => {
    const base = { micarId: MICAR_ID, now: NOW, ownerId: OWNER, spec: civic, eventId: 'x1' };
    expect(reason(createPassport({ ...base, micarId: 'MC-0000-0000-0001' }))).toBe(PASSPORT_REFUSALS.micarId);
    expect(reason(createPassport({ ...base, micarId: VIN }))).toBe(PASSPORT_REFUSALS.micarId);
    expect(reason(createPassport({ ...base, now: '2026-11-10' }))).toBe(PASSPORT_REFUSALS.timestamp);
    expect(reason(createPassport({ ...base, ownerId: '' }))).toBe(PASSPORT_REFUSALS.owner);
    expect(reason(createPassport({ ...base, ownerId: '  padded  ' }))).toBe(PASSPORT_REFUSALS.owner);
    expect(reason(createPassport({ ...base, eventId: '' }))).toBe(PASSPORT_REFUSALS.id);
    expect(reason(createPassport({ ...base, vin: 'abc' }))).toBe(PASSPORT_REFUSALS.vin);
    expect(reason(createPassport({ ...base, vin: '1M8GDM9AXKP04278!' }))).toBe(PASSPORT_REFUSALS.vin);
    expect(reason(createPassport({ ...base, spec: { ...civic, horsepower: s(99999) } }))).toBe(PASSPORT_REFUSALS.spec);
    expect(reason(createPassport({ ...base, spec: { ...civic, identity: { ...civic.identity, year: 2099 } } }))).toBe(PASSPORT_REFUSALS.spec);
    expect(reason(createPassport(null as never))).toBe(PASSPORT_REFUSALS.shape);
  });

  it('keeps its own copy of the specification', () => {
    const p = parked();
    expect(p.spec).toEqual(civic);
    expect(p.spec).not.toBe(civic);
    expect(p.spec.horsepower).not.toBe(civic.horsepower);
  });
});

describe('the owner’s door', () => {
  it('writes every kind of entry an owner may write', () => {
    let p = parked();
    p = ok(add(p, { type: 'photo', subject: 'exterior', attachments: [file('photo', 'front.jpg')] }));
    p = ok(add(p, { type: 'maintenance', shop: 'A shop', cost: 89.5, mileage: 51200, attachments: [file()] }));
    p = ok(add(p, { type: 'repair', system: 'brakes', work: 'replacement', shop: 'A shop', cost: 420 }));
    p = ok(add(p, { type: 'mileage', mileage: 52000 }));
    p = ok(add(p, { type: 'inspection', inspector: 'A person' }));
    p = ok(add(p, { type: 'modification', action: 'install', category: 'tires', tier: 1, install: 'professional', parts: 'A set', undoes: null }));
    p = ok(add(p, { type: 'restoration', scope: 'Repaint', oemParts: true }));
    p = ok(add(p, { type: 'document', document: 'registration' }));
    p = ok(add(p, { type: 'declaration', condition: 'Good', accident: 'None', titleStatus: 'Clean', originality: 'modified' }));
    expect(p.events.map((e) => e.type)).toEqual(['registered', ...OWNER_EVENT_TYPES]);
    for (const e of p.events.slice(1)) { expect(e.by).toBe(OWNER); expect(e.recordedAt).toBe(NOW); }
  });

  it('refuses anyone who is not the current owner', () => {
    const p = parked();
    expect(reason(add(p, {}, 'someone-else'))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(reason(add(p, {}, ''))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(reason(addEvent(p, entry({}), { now: 'yesterday', by: OWNER }))).toBe(PASSPORT_REFUSALS.timestamp);
    expect(reason(addEvent(p, entry({}), null as never))).toBe(PASSPORT_REFUSALS.timestamp);
  });

  it('never lets an owner write an attestation or a withdrawal', () => {
    const p = parked();
    const attestation = { id: 'a1', verifierId: OWNER, scope: 'identity', date: '2026-03-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null };
    expect(reason(add(p, { type: 'attestation', attestation }))).toBe(PASSPORT_REFUSALS.verifierOnly);
    expect(reason(add(p, { type: 'void', target: p.events[0].id, reason: 'x', attestationId: 'a1' }))).toBe(PASSPORT_REFUSALS.verifierOnly);
    expect(reason(add(p, { type: 'registered' }))).toBe(PASSPORT_REFUSALS.kind);
    expect(reason(add(p, { type: 'transfer', from: OWNER, to: 'x' }))).toBe(PASSPORT_REFUSALS.kind);
    expect(reason(add(p, { type: 'nonsense' }))).toBe(PASSPORT_REFUSALS.kind);
    expect(reason(add(p, { type: '__proto__' }))).toBe(PASSPORT_REFUSALS.kind);
  });

  it('refuses a date that is malformed, impossible, in the future or before the first car', () => {
    const p = parked();
    expect(reason(add(p, { date: '03/01/2026' }))).toBe(PASSPORT_REFUSALS.date);
    expect(reason(add(p, { date: '2026-02-30' }))).toBe(PASSPORT_REFUSALS.date);
    expect(reason(add(p, { date: 20260301 }))).toBe(PASSPORT_REFUSALS.date);
    expect(reason(add(p, { date: '2026-11-11' }))).toBe(PASSPORT_REFUSALS.future);
    expect(reason(add(p, { date: '1885-12-31' }))).toBe(PASSPORT_REFUSALS.tooEarly);
    expect(add(p, { date: '2026-11-10' }).ok).toBe(true);
    expect(add(p, { date: '1886-01-01' }).ok).toBe(true);
    // History from before the car was parked is welcome.
    expect(add(p, { date: '2019-06-01' }).ok).toBe(true);
  });

  it('refuses a reading that is not a whole number of miles in range', () => {
    const p = parked();
    for (const bad of [-1, 1.5, 2000001, Number.NaN, Number.POSITIVE_INFINITY, '50000', true]) expect(reason(add(p, { mileage: bad })), String(bad)).toBe(PASSPORT_REFUSALS.mileage);
    expect(ok(add(p, { mileage: 0 })).events[1].mileage).toBe(0);
    expect(ok(add(p, { mileage: 2000000 })).events[1].mileage).toBe(2000000);
    expect(reason(add(p, { type: 'mileage', mileage: null }))).toBe(PASSPORT_REFUSALS.mileageNeeded);
  });

  it('refuses a duplicate id, too many files, a bad file and a file id already in use', () => {
    const p = parked();
    expect(reason(add(p, { id: p.events[0].id }))).toBe(PASSPORT_REFUSALS.id);
    expect(reason(add(p, { id: '' }))).toBe(PASSPORT_REFUSALS.id);
    expect(reason(add(p, { id: 'x'.repeat(41) }))).toBe(PASSPORT_REFUSALS.id);
    const many = Array.from({ length: 21 }, () => file());
    expect(reason(add(p, { attachments: many }))).toBe(PASSPORT_REFUSALS.attachments);
    expect(add(p, { attachments: many.slice(0, 20) }).ok).toBe(true);
    expect(reason(add(p, { attachments: [{ ...file(), kind: 'virus' }] }))).toBe(PASSPORT_REFUSALS.attachments);
    expect(reason(add(p, { attachments: 'receipt.pdf' }))).toBe(PASSPORT_REFUSALS.attachments);
    const one = file();
    expect(reason(add(p, { attachments: [one, one] }))).toBe(PASSPORT_REFUSALS.attachments);
    const withFile = ok(add(p, { attachments: [one] }));
    expect(reason(add(withFile, { attachments: [one] }))).toBe(PASSPORT_REFUSALS.attachments);
  });

  it('refuses details that are not valid for the kind of entry', () => {
    const p = parked();
    expect(reason(add(p, { type: 'photo', subject: 'selfie' }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'maintenance', cost: -5 }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'repair', system: 'flux capacitor', work: 'repair' }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'repair', system: null, work: 'polish' }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'modification', action: 'install', category: 'warp-drive', tier: 1, install: 'owner', undoes: null }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'modification', action: 'install', category: 'turbo', tier: 4, install: 'owner', undoes: null }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'modification', action: 'install', category: 'turbo', tier: 1, install: 'a friend', undoes: null }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'restoration', scope: 'Repaint', oemParts: 'yes' }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'document', document: 'passport' }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'declaration', condition: 'Mint', accident: null, titleStatus: null, originality: null }))).toBe(PASSPORT_REFUSALS.field);
    expect(reason(add(p, { type: 'declaration', condition: null, accident: null, titleStatus: null, originality: null }))).toBe(PASSPORT_REFUSALS.empty);
    expect(reason(add(p, { visibility: 'friends' }))).toBe(PASSPORT_REFUSALS.visibility);
  });

  it('cleans and cuts text, and keeps entries private unless told otherwise', () => {
    const p = ok(add(parked(), { title: `  Oil\tchange\n${'x'.repeat(300)}`, note: 'n'.repeat(3000), shop: 's'.repeat(200) }));
    const e = p.events[1];
    expect(e.title.startsWith('Oil change x')).toBe(true);
    expect(e.title).toHaveLength(120);
    expect(e.note).toHaveLength(2000);
    expect(e.type === 'maintenance' && e.shop.length).toBe(120);
    expect(e.visibility).toBe('private');
    expect(ok(add(parked(), { visibility: 'public' })).events[1].visibility).toBe('public');
    expect(ok(add(parked(), { visibility: undefined })).events[1].visibility).toBe('private');
  });

  it('never throws, whatever it is handed', () => {
    const p = parked();
    const hostile: unknown[] = [null, undefined, 42, 'text', [], [entry({})], { type: 'maintenance' }, { __proto__: { type: 'maintenance' } }, { type: 'maintenance', id: {}, date: [] }, { type: 'maintenance', id: 'h1', date: '2026-03-01', attachments: [null] }, JSON.parse('{"__proto__":{"polluted":true},"type":"photo"}')];
    for (const h of hostile) {
      const result = addEvent(p, h, { now: NOW, by: OWNER });
      expect(result.ok, JSON.stringify(h)).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('adds without touching the passport it was given', () => {
    const p = parked();
    const before = JSON.stringify(p);
    const next = ok(add(p, { attachments: [file()] }));
    expect(JSON.stringify(p)).toBe(before);
    expect(next).not.toBe(p);
    expect(next.events).toHaveLength(2);
    expect(next.events[0]).toBe(p.events[0]);
    // A refusal changes nothing either.
    add(p, { date: 'bad' });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('fitting and removing a modification', () => {
  const install = { type: 'modification', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: 'kit', undoes: null, date: '2026-03-01' };

  it('ties a removal to the install it undoes and copies what it was', () => {
    const fitted = ok(add(parked(), install));
    const installId = fitted.events[1].id;
    const removed = ok(add(fitted, { type: 'modification', action: 'remove', category: 'turbo', tier: 1, install: 'unknown', parts: '', undoes: installId, date: '2026-06-01' }));
    const e = removed.events[2];
    expect(e.type === 'modification' && [e.action, e.tier, e.install, e.undoes]).toEqual(['remove', 2, 'professional', installId]);
  });

  it('refuses a removal that names nothing fitted, another category, something already removed, or a day before the install', () => {
    const fitted = ok(add(parked(), install));
    const installId = fitted.events[1].id;
    const removal = { type: 'modification', action: 'remove', category: 'turbo', tier: 2, install: 'professional', parts: '', undoes: installId, date: '2026-06-01' };
    expect(reason(add(fitted, { ...removal, undoes: 'nothing' }))).toBe(PASSPORT_REFUSALS.undo);
    expect(reason(add(fitted, { ...removal, undoes: null }))).toBe(PASSPORT_REFUSALS.undo);
    expect(reason(add(fitted, { ...removal, undoes: fitted.events[0].id }))).toBe(PASSPORT_REFUSALS.undo);
    expect(reason(add(fitted, { ...removal, category: 'tires' }))).toBe(PASSPORT_REFUSALS.undo);
    expect(reason(add(fitted, { ...removal, date: '2026-02-01' }))).toBe(PASSPORT_REFUSALS.undo);
    const removed = ok(add(fitted, removal));
    expect(reason(add(removed, removal))).toBe(PASSPORT_REFUSALS.undo);
    expect(reason(add(parked(), { ...install, undoes: 'something' }))).toBe(PASSPORT_REFUSALS.undo);
  });
});

describe('append-only', () => {
  it('exports nothing that edits or deletes an entry', async () => {
    const exported = Object.keys(await import('./passport'));
    // "appendEdition" holds the letters of "edit"; a card's edition is not an edit.
    const verbs = /delete|remove|edit(?!ion)|drop|splice|clear|amend|rewrite/i;
    expect(exported.filter((name) => verbs.test(name))).toEqual([]);
  });

  it('keeps every earlier entry exactly as it was, whatever is added', () => {
    let p = parked();
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      seen.push(JSON.stringify(p.events));
      p = ok(add(p, { date: `2026-0${i + 1}-15`, mileage: 50000 + i * 1000 }));
      expect(JSON.stringify(p.events.slice(0, -1))).toBe(seen[i]);
    }
    expect(p.events).toHaveLength(9);
  });

  it('appends snapshots and editions without touching earlier ones', () => {
    const snap = (sid: string): GradeSnapshot => ({ id: sid, at: NOW, asOf: '2026-11-10', reason: 'Parked', formula: 'micar-grade-v2', overall: 10.8, grade10: 1.1, tier: 1, categories: { identity: 10, documentation: 5, condition: 0, originality: 50, verification: 0 }, level: 'registered', events: 1 });
    const edition = (no: number): CardEdition => ({ number: no, name: 'Registration Edition', issuedAt: NOW, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: null, attributes: { power: 404, speed: null, acceleration: null, handling: 565, durability: 635, reliability: 855, efficiency: null }, reason: 'Parked' });
    const p = parked();
    const one = appendEdition(appendSnapshot(p, snap('s1')), edition(1));
    const two = appendEdition(appendSnapshot(one, snap('s2')), edition(2));
    expect(p.snapshots).toEqual([]);
    expect(one.snapshots).toHaveLength(1);
    expect(two.snapshots.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(two.snapshots[0]).toBe(one.snapshots[0]);
    expect(two.editions.map((x) => x.number)).toEqual([1, 2]);
    expect(two.editions[0]).toBe(one.editions[0]);
  });
});

describe('a change of owner', () => {
  it('keeps the identity and the whole history with the car', () => {
    let p = ok(add(parked(), { mileage: 51000, attachments: [file()] }));
    const before = p;
    p = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: '2026-08-01', attachments: [file('other', 'bill-of-sale.pdf')] }, { now: NOW, by: OWNER }));
    expect(p.micarId).toBe(before.micarId);
    expect(p.vin).toBe(before.vin);
    expect(p.spec).toBe(before.spec);
    expect(p.events.slice(0, before.events.length)).toEqual(before.events);
    expect(p.snapshots).toBe(before.snapshots);
    expect(p.editions).toBe(before.editions);
    expect(p.owners).toEqual([{ ownerId: OWNER, from: '2026-01-05', to: '2026-08-01' }, { ownerId: 'owner-two', from: '2026-08-01', to: null }]);
    const transfer = p.events[p.events.length - 1];
    expect(transfer).toMatchObject({ type: 'transfer', from: OWNER, to: 'owner-two', date: '2026-08-01', by: OWNER });
    expect(currentOwner(p)).toBe('owner-two');
    expect(everOwned(p, OWNER)).toBe(true);
    expect(JSON.stringify(before.owners)).toBe(JSON.stringify([{ ownerId: OWNER, from: '2026-01-05', to: null }]));
  });

  it('hands the pen to the new owner and takes it from the old one', () => {
    const p = ok(transferOwnership(parked(), { eventId: id(), toOwnerId: 'owner-two', date: '2026-08-01' }, { now: NOW, by: OWNER }));
    expect(reason(add(p, {}))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(add(p, {}, 'owner-two').ok).toBe(true);
    expect(reason(updateVin(p, VIN, { by: OWNER }))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(reason(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-three', date: '2026-09-01' }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.notOwner);
    const again = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-three', date: '2026-09-01' }, { now: NOW, by: 'owner-two' }));
    expect(again.owners.map((o) => [o.ownerId, o.from, o.to])).toEqual([[OWNER, '2026-01-05', '2026-08-01'], ['owner-two', '2026-08-01', '2026-09-01'], ['owner-three', '2026-09-01', null]]);
  });

  it('refuses a transfer to the same owner, to nobody, in the future, or dated before the current owner had the car', () => {
    const p = parked();
    const base = { eventId: 'tx', toOwnerId: 'owner-two', date: '2026-08-01' };
    expect(reason(transferOwnership(p, { ...base, toOwnerId: OWNER }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.sameOwner);
    expect(reason(transferOwnership(p, { ...base, toOwnerId: '' }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.owner);
    expect(reason(transferOwnership(p, { ...base, date: '2026-12-01' }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.future);
    expect(reason(transferOwnership(p, { ...base, date: '2025-12-01' }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.beforeOwnership);
    expect(reason(transferOwnership(p, { ...base, eventId: p.events[0].id }, { now: NOW, by: OWNER }))).toBe(PASSPORT_REFUSALS.id);
    expect(reason(transferOwnership(p, base, { now: NOW, by: 'a-stranger' }))).toBe(PASSPORT_REFUSALS.notOwner);
  });
});

describe('correcting the specification and the VIN', () => {
  it('belongs to the current owner and touches no entry', () => {
    const p = ok(add(parked(), {}));
    const better: VehicleSpec = { ...civic, torqueLbFt: s(138) };
    const updated = ok(updateSpec(p, better, { by: OWNER }));
    expect(updated.spec.torqueLbFt?.value).toBe(138);
    expect(updated.events).toBe(p.events);
    expect(updated.micarId).toBe(p.micarId);
    expect(p.spec.torqueLbFt).toBeNull();
    expect(reason(updateSpec(p, better, { by: 'someone-else' }))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(reason(updateSpec(p, { ...civic, horsepower: s(-1) }, { by: OWNER }))).toBe(PASSPORT_REFUSALS.spec);
    expect(ok(updateVin(p, '', { by: OWNER })).vin).toBe('');
    expect(ok(updateVin(p, '1m8gdm9axkp042788', { by: OWNER })).vin).toBe(VIN);
    expect(reason(updateVin(p, 'no', { by: OWNER }))).toBe(PASSPORT_REFUSALS.vin);
  });
});

describe('reading the history', () => {
  const history = () => {
    let p = parked();
    p = ok(add(p, { id: 'b', date: '2026-05-01', mileage: 53000 }, OWNER, '2026-11-10T10:00:00.000Z'));
    p = ok(add(p, { id: 'a', date: '2026-02-01', mileage: 51000 }, OWNER, '2026-11-10T11:00:00.000Z'));
    p = ok(add(p, { id: 'd', date: '2026-05-01', mileage: 53100, type: 'photo', subject: 'odometer', attachments: [file('photo', 'odo.jpg')] }, OWNER, '2026-11-10T12:00:00.000Z'));
    p = ok(add(p, { id: 'c', date: '2026-05-01', type: 'photo', subject: 'exterior', attachments: [file('photo'), file('photo')] }, OWNER, '2026-11-10T12:00:00.000Z'));
    return p;
  };

  it('orders the timeline by day, then by when it was written down, then by id', () => {
    expect(timeline(history()).map((e) => e.id).slice(1)).toEqual(['a', 'b', 'c', 'd']);
    expect(history().events.map((e) => e.id).slice(1)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('finds readings, the newest reading on a day, an entry and the files', () => {
    const p = history();
    expect(mileageReadings(p).map((r) => [r.date, r.mileage])).toEqual([['2026-02-01', 51000], ['2026-05-01', 53000], ['2026-05-01', 53100]]);
    expect(latestMileage(p, '2026-11-10')).toEqual({ value: 53100, date: '2026-05-01', eventId: 'd' });
    expect(latestMileage(p, '2026-03-01')).toEqual({ value: 51000, date: '2026-02-01', eventId: 'a' });
    expect(latestMileage(p, '2026-01-01')).toBeNull();
    expect(eventById(p, 'c')?.type).toBe('photo');
    expect(eventById(p, 'zzz')).toBeNull();
    expect(attachmentCount(p)).toBe(3);
    expect(attachmentCount(p, ['photo'])).toBe(3);
    expect(attachmentCount(p, ['receipt'])).toBe(0);
    expect(attachmentCount(p, ['photo'], 'exterior')).toBe(2);
    expect(attachmentCount(p, undefined, 'odometer')).toBe(1);
  });

  it('takes each declared fact from the newest entry that states it', () => {
    let p = parked();
    p = ok(add(p, { type: 'declaration', date: '2026-02-01', condition: 'Good', accident: 'None', titleStatus: 'Clean', originality: null }));
    p = ok(add(p, { type: 'declaration', date: '2026-06-01', condition: 'Fair', accident: null, titleStatus: null, originality: 'modified' }));
    expect(latestDeclaration(p, '2026-11-10')).toEqual({ condition: 'Fair', accident: 'None', titleStatus: 'Clean', originality: 'modified' });
    expect(latestDeclaration(p, '2026-03-01')).toEqual({ condition: 'Good', accident: 'None', titleStatus: 'Clean', originality: null });
    expect(latestDeclaration(p, '2026-01-01')).toEqual({ condition: null, accident: null, titleStatus: null, originality: null });
  });
});

describe('storing and loading', () => {
  const full = (): Passport => {
    let p = parked();
    p = ok(add(p, { type: 'photo', subject: 'exterior', attachments: [file('photo', 'front.jpg')], visibility: 'public', title: 'Front' }));
    p = ok(add(p, { type: 'maintenance', shop: 'A shop', cost: 89.5, mileage: 51200, attachments: [file()], note: 'Oil and filter' }));
    p = ok(add(p, { type: 'repair', system: 'brakes', work: 'replacement', shop: 'A shop', cost: 420 }));
    p = ok(add(p, { type: 'mileage', mileage: 52000 }));
    p = ok(add(p, { type: 'inspection', inspector: 'A person' }));
    p = ok(add(p, { type: 'modification', action: 'install', category: 'tires', tier: 1, install: 'professional', parts: 'A set', undoes: null }));
    p = ok(add(p, { type: 'modification', action: 'remove', category: 'tires', tier: 1, install: 'professional', parts: '', undoes: p.events[p.events.length - 1].id, date: '2026-04-01' }));
    p = ok(add(p, { type: 'restoration', scope: 'Repaint', oemParts: false }));
    p = ok(add(p, { type: 'document', document: 'title', attachments: [file('title', 'title.pdf')] }));
    p = ok(add(p, { type: 'declaration', condition: 'Good', accident: 'Minor', titleStatus: 'Clean', originality: 'modified' }));
    p = ok(transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: '2026-08-01' }, { now: NOW, by: OWNER }));
    p = appendSnapshot(p, { id: 's1', at: NOW, asOf: '2026-11-10', reason: 'Parked', formula: 'micar-grade-v2', overall: 31.2, grade10: 3.1, tier: 3, categories: { identity: 30, documentation: 28, condition: 55, originality: 96.5, verification: 0 }, level: 'registered', events: 12 });
    p = appendEdition(p, { number: 1, name: 'Registration Edition', issuedAt: NOW, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: null, attributes: { power: 404, speed: null, acceleration: null, handling: 565, durability: 635, reliability: 855, efficiency: null }, reason: 'Parked' });
    return p;
  };

  it('reads back exactly what was written, as text or as an object', () => {
    const p = full();
    const text = serializePassport(p);
    const fromText = ok(parsePassport(text));
    expect(fromText.dropped).toBe(0);
    expect(fromText.passport).toEqual(p);
    expect(serializePassport(fromText.passport)).toBe(text);
    const fromObject = ok(parsePassport(JSON.parse(text)));
    expect(fromObject.passport).toEqual(p);
    expect(fromObject.passport).not.toBe(p);
    expect(fromObject.passport.events[1]).not.toBe(p.events[1]);
  });

  it('loads a passport with a corrupt entry without that entry, and says so', () => {
    const data = JSON.parse(serializePassport(full()));
    data.events[2].date = 'not a day';
    const read = ok(parsePassport(data));
    expect(read.dropped).toBe(1);
    expect(read.passport.events).toHaveLength(data.events.length - 1);
    // A duplicated entry is dropped too.
    const twice = JSON.parse(serializePassport(full()));
    twice.events.push(twice.events[3]);
    expect(ok(parsePassport(twice)).dropped).toBe(1);
  });

  it('refuses what is not a passport, without throwing', () => {
    for (const bad of [null, undefined, 42, 'not json', '{"schema":2}', [], {}, { schema: 1 }]) expect(parsePassport(bad).ok, JSON.stringify(bad)).toBe(false);
    const data = () => JSON.parse(serializePassport(full()));
    const broken: [string, (d: Record<string, unknown>) => void][] = [
      ['micarId', (d) => { d.micarId = 'MC-0000-0000-0001'; }],
      ['createdAt', (d) => { d.createdAt = '2026'; }],
      ['spec', (d) => { d.spec = { identity: { year: 'x' } }; }],
      ['vin', (d) => { d.vin = '!!'; }],
      ['owners', (d) => { d.owners = []; }],
      ['owner gap', (d) => { (d.owners as { from: string }[])[1].from = '2026-08-05'; }],
      ['open period in the middle', (d) => { (d.owners as { to: string | null }[])[0].to = null; }],
      ['events', (d) => { d.events = 'none'; }],
      ['snapshot', (d) => { (d.snapshots as { overall: number }[])[0].overall = 500; }],
      ['edition', (d) => { (d.editions as { rarity: string }[])[0].rarity = 'shiny'; }],
    ];
    for (const [name, breakIt] of broken) {
      const d = data();
      breakIt(d);
      expect(parsePassport(d).ok, name).toBe(false);
    }
  });

  it('carries nothing over from the input that is not part of a passport', () => {
    const data = JSON.parse(serializePassport(full()));
    data.admin = true;
    data.events[1].secret = 'x';
    data.events[1].attachments[0].path = '/etc/passwd';
    const read = ok(parsePassport(data)).passport;
    expect('admin' in read).toBe(false);
    expect('secret' in read.events[1]).toBe(false);
    expect('path' in read.events[1].attachments[0]).toBe(false);
  });
});

describe('what a file can and cannot claim', () => {
  it('reads back exactly what the engine wrote, even when a text was cut at a space', () => {
    let p = ok(createPassport({ micarId: 'MC-0000-0000-0000', now: '2024-01-02T09:00:00.000Z', ownerId: OWNER, spec: civic, color: 'c'.repeat(39) + ' red', eventId: 'reg' }));
    p = ok(add(p, {
      type: 'maintenance', date: '2026-06-01', note: 'a'.repeat(1999) + ' tail that goes past the cut', shop: 'x'.repeat(119) + ' y', cost: 10, title: 't'.repeat(119) + ' z',
      attachments: [{ id: 'f-long', kind: 'receipt', name: 'n'.repeat(119) + ' long name.pdf', mime: 'application/pdf', size: 10, sha256: null }],
    }));
    const text = serializePassport(p);
    const again = ok(parsePassport(text));
    expect(again.dropped).toBe(0);
    expect(serializePassport(again.passport)).toBe(text);
  });

  it('numbers editions in the order they were printed and names each after its level', () => {
    const base = JSON.parse(serializePassport(parked())) as Record<string, unknown>;
    const edition = (over: Record<string, unknown>) => ({
      number: 1, name: 'Registration Edition', issuedAt: NOW, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: null,
      attributes: { power: null, speed: null, acceleration: null, handling: null, durability: null, reliability: null, efficiency: null }, reason: 'Parked', ...over,
    });
    // A file that calls its second printing "Certified Edition, number 7" is refused for the number and renamed for the level.
    expect(parsePassport({ ...base, editions: [edition({}), edition({ number: 7 })] }).ok).toBe(false);
    expect(parsePassport({ ...base, editions: [edition({ number: 2 })] }).ok).toBe(false);
    const read = ok(parsePassport({ ...base, editions: [edition({ name: 'Certified Edition' }), edition({ number: 2, level: 'documented', name: 'One of a kind' })] })).passport;
    expect(read.editions.map((e) => [e.number, e.name, e.level])).toEqual([[1, 'Registration Edition', 'registered'], [2, 'Documented Edition', 'documented']]);
  });

  it('is not a passport when it holds more entries than a passport can', () => {
    const base = JSON.parse(serializePassport(parked())) as { events: unknown[] };
    const one = base.events[0] as Record<string, unknown>;
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ ...one, id: `e${i}` }));
    expect(reason(parsePassport({ ...base, events: many }))).toBe(PASSPORT_REFUSALS.full);
    // At the limit it still reads, quickly, and the owner's door then says the passport is full.
    const full = ok(parsePassport({ ...base, events: many.slice(0, MAX_EVENTS) })).passport;
    expect(full.events).toHaveLength(MAX_EVENTS);
    expect(reason(add(full, { type: 'mileage', date: '2026-06-01', mileage: 10 }))).toBe(PASSPORT_REFUSALS.full);
  });

  it('keeps room for a hand-over, so no writer can leave a passport too long to be read back', () => {
    const base = JSON.parse(serializePassport(parked())) as { events: unknown[] };
    const one = base.events[0] as Record<string, unknown>;
    const holding = (count: number): Passport => ok(parsePassport({ ...base, events: Array.from({ length: count }, (_, i) => ({ ...one, id: `held-${i}` })) })).passport;
    const handOver = (p: Passport) => transferOwnership(p, { eventId: id(), toOwnerId: 'owner-two', date: '2026-06-01' }, { now: NOW, by: OWNER });
    // The owner's own entries stop short of the limit by the room kept for hand-overs and verifiers.
    const ownerLimit = MAX_EVENTS - RESERVED_ENTRIES;
    expect(RESERVED_ENTRIES).toBeGreaterThanOrEqual(100);
    expect(ok(add(holding(ownerLimit - 1), { type: 'mileage', date: '2026-06-01', mileage: 10 })).events).toHaveLength(ownerLimit);
    expect(reason(add(holding(ownerLimit), { type: 'mileage', date: '2026-06-01', mileage: 10 }))).toBe(PASSPORT_REFUSALS.full);
    // A hand-over still fits there, and what it writes reads back.
    const sold = ok(handOver(holding(ownerLimit)));
    expect(sold.events).toHaveLength(ownerLimit + 1);
    expect(ok(parsePassport(serializePassport(sold))).passport.events).toHaveLength(ownerLimit + 1);
    // It used to be accepted on a passport at the limit too, and the result could never be opened again.
    expect(ok(parsePassport(serializePassport(ok(handOver(holding(MAX_EVENTS - 1)))))).passport.events).toHaveLength(MAX_EVENTS);
    expect(reason(handOver(holding(MAX_EVENTS)))).toBe(PASSPORT_REFUSALS.full);
  });

  it('stops adding snapshots and editions at the most it will read back', () => {
    const p = parked();
    const snapshot: GradeSnapshot = { id: 's', at: NOW, asOf: '2026-11-10', reason: 'Parked', formula: 'micar-grade-v2', overall: 10, grade10: 1, tier: 1, categories: { identity: 50, documentation: 0, condition: 0, originality: 0, verification: 0 }, level: 'registered', events: 1 };
    const edition: CardEdition = { number: 1, name: 'Registration Edition', issuedAt: NOW, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: null, attributes: { power: null, speed: null, acceleration: null, handling: null, durability: null, reliability: null, efficiency: null }, reason: 'Parked' };
    const full: Passport = { ...p, snapshots: Array.from({ length: MAX_SNAPSHOTS }, (_, i) => ({ ...snapshot, id: `s${i}` })), editions: Array.from({ length: MAX_EDITIONS }, (_, i) => ({ ...edition, number: i + 1 })) };
    expect(appendSnapshot(full, snapshot)).toBe(full);
    expect(appendEdition(full, edition)).toBe(full);
    expect(parsePassport(serializePassport(full)).ok).toBe(true);
    expect(appendSnapshot(p, snapshot).snapshots).toHaveLength(1);
    expect(appendEdition(p, edition).editions).toHaveLength(1);
  });
});

describe('the order of the timeline', () => {
  it('goes by the day, then by when each entry was written down as a time, then by id', () => {
    let p = parked();
    const write = (entryId: string, date: string, now: string) => { p = ok(addEvent(p, entry({ id: entryId, date }), { now, by: OWNER })); };
    // Written half a second apart, the later one to the whole second: as text its timestamp would sort first.
    write('first', '2026-03-01', '2026-11-10T12:00:00.500Z');
    write('second', '2026-03-01', '2026-11-10T12:00:01Z');
    write('zeroth', '2026-03-01', '2026-11-10T12:00:00Z');
    write('earlier-day', '2026-02-01', '2026-11-10T12:00:02.000Z');
    write('b-tied', '2026-03-01', '2026-11-10T12:00:03.000Z');
    write('a-tied', '2026-03-01', '2026-11-10T12:00:03Z');
    expect(timeline(p).slice(1).map((e) => e.id)).toEqual(['earlier-day', 'zeroth', 'first', 'second', 'a-tied', 'b-tied']);
  });
});

describe('files and attestations as data', () => {
  it('keeps a file’s name, type, size and fingerprint, and nothing else', () => {
    expect(checkAttachment({ id: 'f1', kind: 'photo', name: ' front.jpg ', mime: 'image/jpeg', size: 1000, sha256: 'b'.repeat(64), blob: 'data' })).toEqual({ id: 'f1', kind: 'photo', name: 'front.jpg', mime: 'image/jpeg', size: 1000, sha256: 'b'.repeat(64) });
    expect(checkAttachment({ id: 'f1', kind: 'photo', name: 'x', mime: 'image/jpeg', size: 1000 })?.sha256).toBeNull();
    for (const bad of [null, 'file', { id: '', kind: 'photo', size: 1 }, { id: 'f', kind: 'movie', size: 1 }, { id: 'f', kind: 'photo', size: -1 }, { id: 'f', kind: 'photo', size: 1.5 }, { id: 'f', kind: 'photo', size: 300 * 1024 * 1024 }, { id: 'f', kind: 'photo', size: 1, sha256: 'short' }]) {
      expect(checkAttachment(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('reads an attestation’s shape and refuses a malformed one', () => {
    const good = { id: 'a1', verifierId: 'inspector-ann', scope: 'condition', date: '2026-10-01', inPerson: true, conditionScore: 88, systems: { engine: 0.2, tires: 0.5, warp: 0.9 }, mileage: 60000, events: ['e1', 'e1', 'e2'], note: ' fine ', signature: null, extra: 1 };
    expect(checkAttestation(good)).toEqual({ id: 'a1', verifierId: 'inspector-ann', scope: 'condition', date: '2026-10-01', inPerson: true, conditionScore: 88, systems: { engine: 0.2, tires: 0.5 }, mileage: 60000, events: ['e1', 'e2'], note: 'fine', subject: null, signature: null });
    expect(checkAttestation({ ...good, subject: 'a1'.repeat(32) })?.subject).toBe('a1'.repeat(32));
    const bad: Record<string, unknown>[] = [
      { ...good, subject: 'not hex!' }, { ...good, subject: 7 }, { ...good, subject: '0a1b2c3d' },
      { ...good, scope: 'opinion' }, { ...good, date: '2026-13-01' }, { ...good, inPerson: 'yes' }, { ...good, conditionScore: 101 }, { ...good, systems: { engine: 2 } },
      { ...good, mileage: -1 }, { ...good, events: 'all' }, { ...good, verifierId: '' }, { ...good, id: undefined }, { ...good, signature: 5 },
    ];
    for (const b of bad) expect(checkAttestation(b), JSON.stringify(b)).toBeNull();
    expect(checkAttestation(null)).toBeNull();
  });

  it('names every kind of entry', () => {
    const kinds: PassportEvent['type'][] = ['registered', 'photo', 'maintenance', 'repair', 'mileage', 'inspection', 'modification', 'restoration', 'document', 'declaration', 'transfer', 'attestation', 'void'];
    for (const k of kinds) expect(EVENT_TYPE_LABELS[k]).toBeTruthy();
    expect(Object.keys(EVENT_TYPE_LABELS).sort()).toEqual([...kinds].sort());
  });
});
