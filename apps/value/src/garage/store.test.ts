import { describe, expect, it } from 'vitest';
import { PASSPORT_REFUSALS, emptySpec, micarIdFromBytes } from '@micar/engine';
import type { Passport, Sourced, VehicleSpec } from '@micar/engine';
import {
  GARAGE_KEY, QUARANTINE_KEY, STORE_REFUSALS, assembleCar, emptyGarage, exportGarage, findCar, importGarage, loadGarage, ownsCar, park, record, removeCar, replaceSpec, replaceVin,
  saveGarage, transfer,
} from './store';
import type { GarageState, GarageStorage } from './store';
import { SNAPSHOT_REASONS } from './words';

/* ------------------------------------------------------------------ fixtures ---- */

const NOW = '2026-11-10T12:00:00.000Z';
const TODAY = '2026-11-10';
const ME = 'G-SELLER0000000A';
const BUYER = 'G-BUYER00000000B';
const VIN = '1M8GDM9AXKP042788';

const own = { kind: 'owner', asOf: TODAY } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: own });
const civic = (over: Partial<VehicleSpec> = {}): VehicleSpec => ({
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), horsepower: s(158), torqueLbFt: s(138), transmissionType: s('cvt'), drivetrain: s('FWD'),
  curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), ...over,
});

let n = 0;
const id = () => `s${++n}`;
type R<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(r: R<T>): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const reason = <T>(r: R<T>): string => (r.ok ? 'accepted' : r.reason);
const micarId = (seed: number): string => ok(micarIdFromBytes([seed, 2, 3, 4, 5, 6, 7]));
const CAR = micarId(1);

/** A stand-in for the browser's storage. */
function fakeStorage(initial: Record<string, string> = {}): GarageStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? (data.get(k) as string) : null), setItem: (k, v) => { data.set(k, v); } };
}
const parkCar = (state: GarageState, car = CAR, spec = civic()): GarageState =>
  ok(park(state, { micarId: car, eventId: id(), snapshotId: id(), now: NOW, spec, color: 'Red', vin: VIN }));
const receipt = (date: string): Record<string, unknown> => ({
  id: id(), type: 'maintenance', date, mileage: null, title: 'Oil change', note: '', shop: 'A shop', cost: 60, visibility: 'private',
  attachments: [{ id: id(), kind: 'receipt', name: 'receipt.jpg', mime: 'image/jpeg', size: 1000, sha256: null }],
});
const write = (state: GarageState, event: Record<string, unknown>, car = CAR): GarageState => ok(record(state, car, event, { now: NOW, snapshotId: id(), reason: 'Maintenance' }));
const car = (state: GarageState, which = CAR): Passport => findCar(state, which) as Passport;

/* ---------------------------------------------------------- loading and saving ---- */

describe('loading the garage', () => {
  it('starts empty with a new Garage ID when nothing is saved', () => {
    const loaded = loadGarage(fakeStorage(), () => ME);
    expect(loaded).toEqual({ state: { version: 1, ownerId: ME, passports: [] }, skipped: 0, persisted: true });
  });

  it('works, and says it is not being kept, when the browser has no storage', () => {
    expect(loadGarage(null, () => ME)).toEqual({ state: emptyGarage(ME), skipped: 0, persisted: false });
    const blocked: GarageStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadGarage(blocked, () => ME)).toEqual({ state: emptyGarage(ME), skipped: 0, persisted: false });
    expect(saveGarage(null, emptyGarage(ME))).toBe(false);
    expect(saveGarage(blocked, emptyGarage(ME))).toBe(false);
  });

  it('comes back exactly as it was saved', () => {
    const storage = fakeStorage();
    const state = write(parkCar(emptyGarage(ME)), receipt('2026-06-01'));
    expect(saveGarage(storage, state)).toBe(true);
    const loaded = loadGarage(storage, () => 'G-SOMEONEELSE000');
    expect(loaded.skipped).toBe(0);
    expect(loaded.state).toEqual(state);
  });

  it('sets aside a save it cannot read instead of writing over it', () => {
    for (const text of ['not json', '{"ownerId":7}', '[]', '{"ownerId":"bad id!"}']) {
      const storage = fakeStorage({ [GARAGE_KEY]: text });
      const loaded = loadGarage(storage, () => ME);
      expect(loaded.state).toEqual(emptyGarage(ME));
      expect(loaded.skipped).toBe(1);
      expect(storage.data.get(QUARANTINE_KEY)).toBe(text);
      expect(storage.data.get(GARAGE_KEY)).toBe(text);
    }
  });

  it('keeps the cars it can read when one cannot be, and sets the whole save aside', () => {
    const state = parkCar(parkCar(emptyGarage(ME)), micarId(2));
    const broken = { ...state, passports: [state.passports[0], { ...state.passports[1], micarId: 'MC-NOPE' }, state.passports[0]] };
    const text = JSON.stringify(broken);
    const storage = fakeStorage({ [GARAGE_KEY]: text });
    const loaded = loadGarage(storage, () => 'G-SOMEONEELSE000');
    // One was unreadable; one was the same car twice.
    expect(loaded.skipped).toBe(2);
    expect(loaded.state.ownerId).toBe(ME);
    expect(loaded.state.passports.map((p) => p.micarId)).toEqual([CAR]);
    expect(storage.data.get(QUARANTINE_KEY)).toBe(text);
  });
});

/* -------------------------------------------------------------------- actions ---- */

describe('parking a car', () => {
  it('gives it a passport, its first grade in the history and its first card', () => {
    const state = parkCar(emptyGarage(ME));
    const p = car(state);
    expect(p).toMatchObject({ micarId: CAR, vin: VIN, color: 'Red', owners: [{ ownerId: ME, from: TODAY, to: null }] });
    expect(p.events.map((e) => e.type)).toEqual(['registered']);
    expect(p.snapshots).toHaveLength(1);
    expect(p.snapshots[0]).toMatchObject({ reason: SNAPSHOT_REASONS.parked, level: 'registered', asOf: TODAY });
    expect(p.editions).toHaveLength(1);
    expect(p.editions[0]).toMatchObject({ number: 1, level: 'registered', finish: 'raw', grade10: null });
    expect(ownsCar(state, p)).toBe(true);
    const assembly = assembleCar(p, TODAY);
    expect(assembly.card.micarId).toBe(CAR);
    expect(assembly.certification.level).toBe('registered');
  });

  it('refuses the same MiCar ID twice and anything the engine refuses, changing nothing', () => {
    const state = parkCar(emptyGarage(ME));
    expect(reason(park(state, { micarId: CAR, eventId: id(), snapshotId: id(), now: NOW, spec: civic(), color: '', vin: '' }))).toBe(STORE_REFUSALS[0]);
    expect(reason(park(state, { micarId: 'MC-NOPE', eventId: id(), snapshotId: id(), now: NOW, spec: civic(), color: '', vin: '' }))).toBe(PASSPORT_REFUSALS.micarId);
    expect(reason(park(state, { micarId: micarId(3), eventId: id(), snapshotId: id(), now: NOW, spec: civic(), color: '', vin: 'bad vin!' }))).toBe(PASSPORT_REFUSALS.vin);
    expect(state.passports).toHaveLength(1);
  });
});

describe('writing to a car', () => {
  it('adds the entry and keeps the new grade in the history only when the grade changed', () => {
    let state = parkCar(emptyGarage(ME));
    state = write(state, { id: id(), type: 'declaration', date: TODAY, condition: 'Good', accident: null, titleStatus: null, originality: 'stock' });
    expect(car(state).events).toHaveLength(2);
    expect(car(state).snapshots).toHaveLength(2);
    // A second declaration that says the same thing changes no score: no new snapshot.
    state = write(state, { id: id(), type: 'declaration', date: TODAY, condition: 'Good', accident: null, titleStatus: null, originality: 'stock' });
    expect(car(state).events).toHaveLength(3);
    expect(car(state).snapshots).toHaveLength(2);
    // Earlier snapshots are never rewritten.
    expect(car(state).snapshots[0].reason).toBe(SNAPSHOT_REASONS.parked);
  });

  it('prints a new edition when the car reaches the next level, and keeps the first', () => {
    let state = parkCar(emptyGarage(ME));
    state = write(state, { id: id(), type: 'photo', subject: 'exterior', date: '2026-01-06', attachments: [1, 2, 3, 4].map(() => ({ id: id(), kind: 'photo', name: 'p.jpg', mime: 'image/jpeg', size: 1000, sha256: null })) });
    state = write(state, { id: id(), type: 'document', document: 'title', date: '2026-01-06', attachments: [{ id: id(), kind: 'title', name: 't.pdf', mime: 'application/pdf', size: 1000, sha256: null }] });
    state = write(state, { id: id(), type: 'mileage', date: '2026-01-06', mileage: 48000 });
    for (const date of ['2026-02-01', '2026-05-01', '2026-08-01']) state = write(state, receipt(date));
    const p = car(state);
    expect(assembleCar(p, TODAY).certification.level).toBe('documented');
    expect(p.editions.map((e) => [e.number, e.level])).toEqual([[1, 'registered'], [2, 'documented']]);
    expect(p.editions[1].grade10).not.toBeNull();
  });

  it('refuses a car that is not here and an entry the engine refuses', () => {
    const state = parkCar(emptyGarage(ME));
    expect(reason(record(state, micarId(9), receipt(TODAY), { now: NOW, snapshotId: id(), reason: 'Maintenance' }))).toBe(STORE_REFUSALS[1]);
    expect(reason(record(state, CAR, { ...receipt(TODAY), date: '2026-11-11' }, { now: NOW, snapshotId: id(), reason: 'Maintenance' }))).toBe(PASSPORT_REFUSALS.future);
    expect(reason(record(state, CAR, { id: id(), type: 'attestation', date: TODAY }, { now: NOW, snapshotId: id(), reason: 'x' }))).toBe(PASSPORT_REFUSALS.verifierOnly);
  });

  it('replaces the specification or the VIN without touching an entry', () => {
    let state = write(parkCar(emptyGarage(ME)), receipt('2026-06-01'));
    const before = car(state).events;
    state = ok(replaceSpec(state, CAR, civic({ horsepower: s(180) }), { now: NOW, snapshotId: id() }));
    expect(car(state).spec.horsepower?.value).toBe(180);
    state = ok(replaceVin(state, CAR, '', { now: NOW, snapshotId: id() }));
    expect(car(state).vin).toBe('');
    expect(car(state).events).toEqual(before);
    // Losing the VIN lowers Identity, so the grade's history gains a snapshot that says why.
    expect(car(state).snapshots[car(state).snapshots.length - 1].reason).toBe(SNAPSHOT_REASONS.vin);
    expect(reason(replaceSpec(state, micarId(9), civic(), { now: NOW, snapshotId: id() }))).toBe(STORE_REFUSALS[1]);
    expect(reason(replaceVin(state, CAR, 'bad vin!', { now: NOW, snapshotId: id() }))).toBe(PASSPORT_REFUSALS.vin);
  });
});

/* ------------------------------------------------------------------- transfers ---- */

describe('handing a car to a new owner', () => {
  const sale = { toOwnerId: BUYER, date: TODAY, attachments: [] };

  it('needs a Garage ID that is not this garage’s own', () => {
    const state = parkCar(emptyGarage(ME));
    expect(reason(transfer(state, CAR, { ...sale, eventId: id(), toOwnerId: 'a b' }, { now: NOW }))).toBe(STORE_REFUSALS[2]);
    expect(reason(transfer(state, CAR, { ...sale, eventId: id(), toOwnerId: ME }, { now: NOW }))).toBe(STORE_REFUSALS[3]);
    expect(reason(transfer(state, micarId(9), { ...sale, eventId: id() }, { now: NOW }))).toBe(STORE_REFUSALS[1]);
  });

  it('keeps the car listed, read-only, and lets the buyer take it up with its whole history', () => {
    let seller = write(parkCar(emptyGarage(ME)), receipt('2026-06-01'));
    seller = ok(transfer(seller, CAR, { ...sale, eventId: id() }, { now: NOW }));
    const sold = car(seller);
    expect(ownsCar(seller, sold)).toBe(false);
    expect(sold.micarId).toBe(CAR);
    expect(sold.owners).toEqual([{ ownerId: ME, from: TODAY, to: TODAY }, { ownerId: BUYER, from: TODAY, to: null }]);
    expect(reason(record(seller, CAR, receipt(TODAY), { now: NOW, snapshotId: id(), reason: 'Maintenance' }))).toBe(PASSPORT_REFUSALS.notOwner);
    expect(reason(replaceSpec(seller, CAR, civic(), { now: NOW, snapshotId: id() }))).toBe(PASSPORT_REFUSALS.notOwner);

    // The seller sends the passport file. The buyer brings it in and carries on.
    const file = exportGarage(seller, NOW, CAR);
    const brought = ok(importGarage(emptyGarage(BUYER), file));
    expect(brought).toMatchObject({ added: 1, updated: 0, skipped: 0 });
    let buyer = brought.state;
    expect(ownsCar(buyer, car(buyer))).toBe(true);
    expect(car(buyer).events).toEqual(sold.events);
    expect(car(buyer).snapshots).toEqual(sold.snapshots);
    buyer = write(buyer, receipt(TODAY));
    expect(car(buyer).events).toHaveLength(sold.events.length + 1);
  });
});

/* ---------------------------------------------------------- export and import ---- */

describe('the garage file', () => {
  it('holds every car, or just one, and reads back the same', () => {
    const state = write(parkCar(parkCar(emptyGarage(ME)), micarId(2)), receipt('2026-06-01'));
    const all = JSON.parse(exportGarage(state, NOW)) as { micarGarage: number; exportedAt: string; passports: Passport[] };
    expect(all).toMatchObject({ micarGarage: 1, exportedAt: NOW });
    expect(all.passports.map((p) => p.micarId)).toEqual([CAR, micarId(2)]);
    expect((JSON.parse(exportGarage(state, NOW, micarId(2))) as { passports: Passport[] }).passports.map((p) => p.micarId)).toEqual([micarId(2)]);
    const back = ok(importGarage(emptyGarage(ME), exportGarage(state, NOW)));
    expect(back.state.passports).toEqual(state.passports);
    expect(back).toMatchObject({ added: 2, updated: 0, skipped: 0 });
  });

  it('refuses anything that is not a garage export and changes nothing', () => {
    const state = parkCar(emptyGarage(ME));
    for (const text of ['', 'not json', '[]', '{}', '{"micarGarage":2,"passports":[]}', '{"micarGarage":1,"passports":"all"}', JSON.stringify(state)]) {
      expect(reason(importGarage(state, text)), text).toBe(STORE_REFUSALS[4]);
    }
  });

  it('takes a copy that continues a car parked here, and leaves out one that is the same or behind', () => {
    const start = parkCar(emptyGarage(ME));
    const further = write(start, receipt('2026-06-01'));
    const updated = ok(importGarage(start, exportGarage(further, NOW)));
    expect(updated).toMatchObject({ added: 0, updated: 1, skipped: 0 });
    expect(updated.state.passports).toEqual(further.passports);
    expect(ok(importGarage(further, exportGarage(further, NOW)))).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    const behind = ok(importGarage(further, exportGarage(start, NOW)));
    expect(behind).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    expect(behind.state.passports).toEqual(further.passports);
  });

  it('never lets a file overwrite a history with a different one, however long the file’s is', () => {
    const mine = write(parkCar(emptyGarage(ME)), receipt('2026-06-01'));
    // The same MiCar ID with another story: a different first entry and many more after it.
    let other = parkCar(emptyGarage(ME));
    for (const date of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']) other = write(other, receipt(date));
    expect(car(other).events.length).toBeGreaterThan(car(mine).events.length);
    const result = ok(importGarage(mine, exportGarage(other, NOW)));
    expect(result).toMatchObject({ added: 0, updated: 0, skipped: 1 });
    expect(result.state.passports).toEqual(mine.passports);
    // The same story with one earlier entry altered is not a continuation either.
    const tampered = JSON.parse(exportGarage(write(mine, receipt('2026-07-01')), NOW)) as { micarGarage: 1; passports: Passport[] };
    tampered.passports[0].events[1].title = 'Engine rebuild';
    expect(ok(importGarage(mine, JSON.stringify(tampered)))).toMatchObject({ added: 0, updated: 0, skipped: 1 });
  });

  it('counts cars in a file that cannot be read, and brings in the rest', () => {
    const state = parkCar(parkCar(emptyGarage(ME)), micarId(2));
    const file = JSON.parse(exportGarage(state, NOW)) as { micarGarage: 1; passports: unknown[] };
    file.passports.push({ schema: 1, micarId: 'MC-NOPE' }, 'a car');
    expect(ok(importGarage(emptyGarage(BUYER), JSON.stringify(file)))).toMatchObject({ added: 2, updated: 0, skipped: 2 });
  });
});

describe('removing a car', () => {
  it('takes it out of this garage and leaves the others', () => {
    const state = parkCar(parkCar(emptyGarage(ME)), micarId(2));
    const after = removeCar(state, CAR);
    expect(after.passports.map((p) => p.micarId)).toEqual([micarId(2)]);
    expect(findCar(after, CAR)).toBeNull();
    expect(removeCar(after, CAR)).toEqual(after);
  });
});
