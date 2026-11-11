import { describe, expect, it } from 'vitest';
import { PASSPORT_REFUSALS, emptySpec, micarIdFromBytes } from '@micar/engine';
import type { Passport, Sourced, VehicleSpec } from '@micar/engine';
import { garageIdFromBytes, normalizeGarageId } from './ids';
import {
  GARAGE_KEY, MAX_FORMER_IDS, QUARANTINE_KEY, STORE_REFUSALS, assembleCar, emptyGarage, exportGarage, filesOnlyOf, findCar, garageIds, holdingOf, importGarage, loadGarage, ownsCar, park, record,
  removeCar, replaceSpec, replaceVin, saveGarage, takeUpGarage, transfer,
} from './store';
import type { GarageState, GarageStorage, Restorable } from './store';
import { SNAPSHOT_REASONS } from './words';

/* ------------------------------------------------------------------ fixtures ---- */

const NOW = '2026-11-10T12:00:00.000Z';
const TODAY = '2026-11-10';
const ME = garageIdFromBytes([1, 1, 1, 1, 1, 1, 1, 1]);
const BUYER = garageIdFromBytes([2, 2, 2, 2, 2, 2, 2, 2]);
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
    expect(loaded).toEqual({ state: { version: 1, ownerId: ME, formerIds: [], passports: [] }, skipped: 0, persisted: true });
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

  it('refuses an ID with a slipped character, because a hand-over cannot be undone', () => {
    const state = parkCar(emptyGarage(ME));
    const body = BUYER.slice(2);
    // One character wrong, two swapped, one missing, one extra, or four letters of anything: none of these is a garage.
    const wrong = body[3] === '7' ? '8' : '7';
    const slips = [
      `G-${body.slice(0, 3)}${wrong}${body.slice(4)}`,
      `G-${body.slice(0, 5)}${body[6]}${body[5]}${body.slice(7)}`,
      `G-${body.slice(0, -1)}`, `G-${body}0`, 'abcd', 'G-', '',
    ].filter((text) => text !== BUYER);
    for (const text of slips) expect(reason(transfer(state, CAR, { ...sale, eventId: id(), toOwnerId: text }, { now: NOW })), text).toBe(STORE_REFUSALS[2]);
    expect(car(state).owners).toHaveLength(1);
    // Typed in lower case, with spaces, without the dash: it is still the buyer's ID, and it is stored in its one true form.
    for (const typed of [BUYER.toLowerCase(), ` ${BUYER} `, BUYER.replace('-', ''), BUYER.replace('-', ' - ')]) {
      const moved = ok(transfer(state, CAR, { ...sale, eventId: id(), toOwnerId: typed }, { now: NOW }));
      expect(car(moved).owners[1].ownerId, typed).toBe(BUYER);
    }
    expect(normalizeGarageId(BUYER)).toBe(BUYER);
    expect(normalizeGarageId(12345)).toBeNull();
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
    expect(holdingOf(buyer, car(buyer))).toBe('owner');
    expect(holdingOf(seller, sold)).toBe('transferred');
    // A passport file carries no Garage ID to take up: the buyer's garage is still the buyer's.
    expect(brought.restorable).toBeNull();
    expect(buyer.ownerId).toBe(BUYER);
    // Somebody who is neither is shown the car and cannot write to it.
    const onlooker = ok(importGarage(emptyGarage(garageIdFromBytes([3, 3, 3, 3, 3, 3, 3, 3])), file)).state;
    expect(holdingOf(onlooker, car(onlooker))).toBe('other');
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

describe('the garage file as a backup', () => {
  const FRESH = garageIdFromBytes([9, 9, 9, 9, 9, 9, 9, 9]);
  const sale = { toOwnerId: BUYER, date: TODAY, attachments: [] };

  it('never changes this garage’s ID by itself: a backup is offered, and taken up only when the page says so', () => {
    const mine = write(parkCar(parkCar(emptyGarage(ME)), micarId(2)), receipt('2026-06-01'));
    const backup = exportGarage(mine, NOW);
    // Site data cleared, a new phone, a private window: a fresh Garage ID and no cars.
    const fresh = emptyGarage(FRESH);
    const brought = ok(importGarage(fresh, backup));
    expect(brought).toMatchObject({ added: 2, updated: 0, skipped: 0, restorable: { ownerId: ME, formerIds: [] } });
    // The cars are here and the ID has not moved: until the person says so they are another garage's, read-only.
    expect(brought.state.ownerId).toBe(FRESH);
    for (const p of brought.state.passports) expect(holdingOf(brought.state, p)).toBe('other');
    // Taken up: the cars are the owner's again, not read-only copies, and can be written to.
    const back = takeUpGarage(brought.state, brought.restorable as { ownerId: string; formerIds: string[] });
    expect(back.ownerId).toBe(ME);
    expect(back.passports).toEqual(mine.passports);
    for (const p of back.passports) expect(holdingOf(back, p)).toBe('owner');
    expect(car(write(back, receipt(TODAY))).events).toHaveLength(car(mine).events.length + 1);
    // Bringing the same file in again offers nothing: this browser already answers to that ID.
    expect(ok(importGarage(back, backup))).toMatchObject({ added: 0, skipped: 2, restorable: null });
  });

  it('keeps the ID it gave out before, so a car on its way to that ID still arrives', () => {
    // A buyer opens the Garage for the first time and gives the seller the ID shown. Then the buyer takes up an old
    // backup. The ID given out is still this browser's: when the seller hands the car over, it arrives writable.
    const backup = exportGarage(parkCar(emptyGarage(ME), micarId(2)), NOW);
    const brought = ok(importGarage(emptyGarage(BUYER), backup));
    const buyer = takeUpGarage(brought.state, brought.restorable as { ownerId: string; formerIds: string[] });
    expect(buyer).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    expect(garageIds(buyer)).toEqual([ME, BUYER]);
    const seller = ok(transfer(parkCar(emptyGarage(FRESH)), CAR, { ...sale, toOwnerId: BUYER, eventId: id() }, { now: NOW }));
    const arrived = ok(importGarage(buyer, exportGarage(seller, NOW, CAR))).state;
    expect(holdingOf(arrived, car(arrived))).toBe('owner');
    // It is written to as the ID that owns it, and can be handed on.
    const written = write(arrived, receipt(TODAY));
    expect(car(written).events[car(written).events.length - 1].by).toBe(BUYER);
    expect(reason(transfer(written, CAR, { ...sale, toOwnerId: ME, eventId: id() }, { now: NOW }))).toBe(STORE_REFUSALS[3]);
    expect(reason(transfer(written, CAR, { ...sale, toOwnerId: BUYER, eventId: id() }, { now: NOW }))).toBe(STORE_REFUSALS[3]);
    const third = garageIdFromBytes([7, 7, 7, 7, 7, 7, 7, 7]);
    const handedOn = ok(transfer(written, CAR, { ...sale, toOwnerId: third, eventId: id() }, { now: NOW }));
    expect(holdingOf(handedOn, car(handedOn))).toBe('transferred');
    // The former IDs are saved with the garage, come back from storage, and travel in its backup.
    const storage = fakeStorage();
    saveGarage(storage, buyer);
    expect(loadGarage(storage, () => 'unused').state.formerIds).toEqual([BUYER]);
    expect(JSON.parse(exportGarage(buyer, NOW))).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    const again = ok(importGarage(emptyGarage(FRESH), exportGarage(buyer, NOW)));
    expect(again.restorable).toEqual({ ownerId: ME, formerIds: [BUYER] });
    expect(takeUpGarage(again.state, again.restorable as { ownerId: string; formerIds: string[] })).toMatchObject({ ownerId: ME, formerIds: [FRESH, BUYER] });
  });

  it('does not offer a seller’s garage file as a backup: the buyer keeps their ID and the car they were handed', () => {
    // The seller parks two cars, hands one to the buyer, and sends the whole-garage file instead of the passport file.
    let seller = parkCar(parkCar(emptyGarage(ME)), micarId(2));
    seller = ok(transfer(seller, CAR, { ...sale, eventId: id() }, { now: NOW }));
    const wrongFile = exportGarage(seller, NOW);
    // The buyer's garage is empty, which is what a first-time buyer's garage is. It used to take up the seller's ID
    // on the spot: the buyer's own ID was gone for good and the car they had bought read 'transferred'.
    const brought = ok(importGarage(emptyGarage(BUYER), wrongFile));
    expect(brought).toMatchObject({ added: 2, restorable: null });
    expect(brought.state.ownerId).toBe(BUYER);
    expect(brought.state.formerIds).toEqual([]);
    expect(holdingOf(brought.state, car(brought.state))).toBe('owner');
    expect(holdingOf(brought.state, car(brought.state, micarId(2)))).toBe('other');
    expect(car(write(brought.state, receipt(TODAY))).events.length).toBe(car(brought.state).events.length + 1);
  });

  it('offers only a real garage’s backup: a well-formed ID that still owns a car in the file', () => {
    const mine = parkCar(emptyGarage(ME));
    const fresh = emptyGarage(BUYER);
    const offered = (file: unknown) => ok(importGarage(fresh, JSON.stringify(file))).restorable;
    expect(offered({ micarGarage: 1, ownerId: ME, passports: mine.passports })).toEqual({ ownerId: ME, formerIds: [] });
    // Not an ID, an ID with a wrong check character, or one not in its written form.
    expect(offered({ micarGarage: 1, ownerId: 'not an id!', passports: mine.passports })).toBeNull();
    expect(offered({ micarGarage: 1, ownerId: `${ME.slice(0, -1)}${ME.endsWith('0') ? '1' : '0'}`, passports: mine.passports })).toBeNull();
    expect(offered({ micarGarage: 1, ownerId: ME.toLowerCase(), passports: mine.passports })).toBeNull();
    expect(offered({ micarGarage: 1, ownerId: 12345, passports: mine.passports })).toBeNull();
    // An ID that owns nothing in the file is nobody's backup.
    expect(offered({ micarGarage: 1, ownerId: FRESH, passports: mine.passports })).toBeNull();
    expect(offered({ micarGarage: 1, ownerId: ME, passports: [] })).toBeNull();
    // A single car's passport file has no Garage ID in it at all.
    expect(JSON.parse(exportGarage(mine, NOW, CAR))).not.toHaveProperty('ownerId');
    expect(offered(JSON.parse(exportGarage(mine, NOW, CAR)))).toBeNull();
    // A garage that already holds cars is offered it too, and loses nothing by taking it up: its own cars stay its own.
    const other = parkCar(emptyGarage(FRESH), micarId(5));
    const merged = ok(importGarage(other, exportGarage(mine, NOW)));
    expect(merged).toMatchObject({ added: 1, restorable: { ownerId: ME } });
    expect(merged.state.ownerId).toBe(FRESH);
    expect(holdingOf(merged.state, car(merged.state))).toBe('other');
    const both = takeUpGarage(merged.state, merged.restorable as { ownerId: string; formerIds: string[] });
    expect(both.passports.map((p) => holdingOf(both, p))).toEqual(['owner', 'owner']);
    // Junk in a file's list of former IDs is left out, and taking up an ID that is not one changes nothing.
    expect(offered({ micarGarage: 1, ownerId: ME, formerIds: ['x', 7, BUYER, FRESH, FRESH, 'not an id!'], passports: mine.passports })).toEqual({ ownerId: ME, formerIds: [FRESH] });
    expect(takeUpGarage(fresh, { ownerId: 'nonsense', formerIds: [] })).toBe(fresh);
    expect(takeUpGarage(fresh, { ownerId: BUYER, formerIds: [] })).toBe(fresh);
  });

  it('offers a later backup of this very garage the IDs it has gathered since, whatever else the file holds', () => {
    // The laptop is garage ME with one car. The phone starts as BUYER, restores the laptop's backup and takes it up:
    // it gives out ME and still answers to BUYER. A seller hands a car to BUYER, and it arrives on the phone.
    const laptop = parkCar(emptyGarage(ME));
    const restored = ok(importGarage(emptyGarage(BUYER), exportGarage(laptop, NOW)));
    let phone = takeUpGarage(restored.state, restored.restorable as Restorable);
    expect(phone).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    const seller = ok(transfer(parkCar(emptyGarage(FRESH), micarId(2)), micarId(2), { ...sale, toOwnerId: BUYER, eventId: id() }, { now: NOW }));
    phone = ok(importGarage(phone, exportGarage(seller, NOW, micarId(2)))).state;
    expect(holdingOf(phone, car(phone, micarId(2)))).toBe('owner');
    // The phone's backup goes back to the laptop. The file gives out the laptop's own ID, so it used to offer nothing:
    // the car owned by BUYER stayed another garage's, with no file that could make the page ask.
    const phoneBackup = exportGarage(phone, NOW);
    const brought = ok(importGarage(laptop, phoneBackup));
    expect(brought).toMatchObject({ added: 1, updated: 0, skipped: 1, restorable: { ownerId: ME, formerIds: [BUYER] } });
    expect(holdingOf(brought.state, car(brought.state, micarId(2)))).toBe('other');
    const both = takeUpGarage(brought.state, brought.restorable as Restorable);
    // The ID the laptop gives out does not move; it answers to the other one as well, and the car is its own.
    expect(both).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    expect(both.passports.map((p) => holdingOf(both, p))).toEqual(['owner', 'owner']);
    expect(car(write(both, receipt(TODAY), micarId(2)), micarId(2)).events.length).toBe(car(both, micarId(2)).events.length + 1);
    // Taken up once, it is not offered again, and taking it up again changes nothing.
    expect(ok(importGarage(both, phoneBackup)).restorable).toBeNull();
    expect(takeUpGarage(both, brought.restorable as Restorable)).toBe(both);

    // The phone then takes up a third garage, THIRD: it gives out THIRD and answers to ME and BUYER. Its backup holds
    // cars owned by ME, which made it look like a seller's file to the laptop, and it was refused.
    const THIRD = garageIdFromBytes([7, 7, 7, 7, 7, 7, 7, 7]);
    const thirdBackup = exportGarage(parkCar(emptyGarage(THIRD), micarId(3)), NOW);
    const merged = ok(importGarage(phone, thirdBackup));
    const phoneThree = takeUpGarage(merged.state, merged.restorable as Restorable);
    expect(phoneThree).toMatchObject({ ownerId: THIRD, formerIds: [ME, BUYER] });
    const offered = ok(importGarage(laptop, exportGarage(phoneThree, NOW)));
    expect(offered.restorable).toEqual({ ownerId: THIRD, formerIds: [BUYER] });
    const all = takeUpGarage(offered.state, offered.restorable as Restorable);
    expect(all).toMatchObject({ ownerId: THIRD, formerIds: [ME, BUYER] });
    expect(all.passports.map((p) => holdingOf(all, p))).toEqual(['owner', 'owner', 'owner']);

    // An older backup that answers to an ID this browser holds only as a former one: the ID given out stays.
    const older = ok(importGarage({ ...emptyGarage(THIRD), formerIds: [ME] }, phoneBackup));
    expect(older.restorable).toEqual({ ownerId: ME, formerIds: [BUYER] });
    expect(takeUpGarage(older.state, older.restorable as Restorable)).toMatchObject({ ownerId: THIRD, formerIds: [ME, BUYER] });
    // Nothing is offered when no ID this browser lacks owns a car in the file.
    expect(ok(importGarage(laptop, exportGarage({ ...laptop, formerIds: [BUYER] }, NOW))).restorable).toBeNull();
  });

  it('offers its own backup an ID that owns a car already parked here, whichever file came first', () => {
    // The laptop is garage ME. The phone starts as BUYER and gives that ID to a seller, then restores the laptop's
    // backup and takes it up: it gives out ME and still answers to BUYER.
    const laptop = parkCar(emptyGarage(ME));
    const restored = ok(importGarage(emptyGarage(BUYER), exportGarage(laptop, NOW)));
    const phone = takeUpGarage(restored.state, restored.restorable as Restorable);
    expect(phone).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    // The seller hands the car to BUYER and e-mails the passport file. It is opened on the LAPTOP, where it reads
    // "another garage": the laptop does not answer to BUYER.
    const seller = ok(transfer(parkCar(emptyGarage(FRESH), micarId(2)), micarId(2), { ...sale, toOwnerId: BUYER, eventId: id() }, { now: NOW }));
    const passportFile = exportGarage(seller, NOW, micarId(2));
    const opened = ok(importGarage(laptop, passportFile));
    expect(opened.restorable).toBeNull();
    expect(holdingOf(opened.state, car(opened.state, micarId(2)))).toBe('other');
    // The page says to bring the garage's file in. The phone's backup names BUYER but does not hold the car: the car
    // is here. That used to be no reason to ask, and the car stayed read-only whatever the owner did.
    const phoneBackup = exportGarage(phone, NOW);
    expect(JSON.parse(phoneBackup).passports).toHaveLength(1);
    const asked = ok(importGarage(opened.state, phoneBackup));
    expect(asked.restorable).toEqual({ ownerId: ME, formerIds: [BUYER] });
    const mine = takeUpGarage(asked.state, asked.restorable as Restorable);
    expect(mine).toMatchObject({ ownerId: ME, formerIds: [BUYER] });
    expect(holdingOf(mine, car(mine, micarId(2)))).toBe('owner');
    // The other order: the backup first, when there is nothing yet for BUYER to own here, so nothing to ask about.
    const early = ok(importGarage(laptop, phoneBackup));
    expect(early.restorable).toBeNull();
    // Then the passport file, which carries no Garage ID of its own to ask about.
    const late = ok(importGarage(early.state, passportFile));
    expect(late.restorable).toBeNull();
    expect(holdingOf(late.state, car(late.state, micarId(2)))).toBe('other');
    // The backup again, as the page says: now it is asked.
    expect(ok(importGarage(late.state, phoneBackup)).restorable).toEqual({ ownerId: ME, formerIds: [BUYER] });
    // A file that shares no ID with this garage is still judged by its own cars alone: a car parked here under
    // somebody's ID is no reason to offer that somebody's backup.
    const strangers = exportGarage({ ...emptyGarage(BUYER), formerIds: [] }, NOW);
    expect(ok(importGarage(opened.state, strangers)).restorable).toBeNull();
  });

  it('keeps every ID it has taken up: past the most it can keep, no more is offered or taken', () => {
    const ids = Array.from({ length: MAX_FORMER_IDS + 2 }, (_, i) => garageIdFromBytes([3, 3, 3, 3, 3, 3, Math.floor(i / 200), i % 200]));
    const full: GarageState = { ...emptyGarage(ME), formerIds: ids.slice(0, MAX_FORMER_IDS) };
    const storage = fakeStorage();
    saveGarage(storage, full);
    expect(loadGarage(storage, () => 'unused').state.formerIds).toEqual(full.formerIds);
    // One more would be the first to be dropped the next time the garage is read back. It is not taken up.
    const another = exportGarage(parkCar(emptyGarage(ids[MAX_FORMER_IDS]), micarId(4)), NOW);
    expect(ok(importGarage(full, another)).restorable).toBeNull();
    expect(takeUpGarage(full, { ownerId: ids[MAX_FORMER_IDS], formerIds: [] })).toBe(full);
    expect(takeUpGarage(full, { ownerId: ME, formerIds: [ids[MAX_FORMER_IDS + 1]] })).toBe(full);
    // With room for exactly one more, one more is kept: an ID this garage lacked, or the one it gave out until now.
    const room: GarageState = { ...full, formerIds: full.formerIds.slice(1) };
    expect(takeUpGarage(room, { ownerId: ME, formerIds: [ids[MAX_FORMER_IDS + 1]] }).formerIds).toHaveLength(MAX_FORMER_IDS);
    expect(takeUpGarage(room, { ownerId: ids[MAX_FORMER_IDS], formerIds: [] })).toMatchObject({ ownerId: ids[MAX_FORMER_IDS], formerIds: [ME, ...room.formerIds] });
    // Not two.
    expect(takeUpGarage(room, { ownerId: ids[MAX_FORMER_IDS], formerIds: [ids[MAX_FORMER_IDS + 1]] })).toBe(room);
    expect(takeUpGarage(room, { ownerId: ME, formerIds: [ids[MAX_FORMER_IDS], ids[MAX_FORMER_IDS + 1]] })).toBe(room);
  });

  it('reads a garage saved before former IDs existed, and ignores junk where they should be', () => {
    const saved = parkCar(emptyGarage(ME));
    const old = JSON.stringify({ version: 1, ownerId: ME, passports: saved.passports });
    expect(loadGarage(fakeStorage({ [GARAGE_KEY]: old }), () => 'unused').state).toMatchObject({ ownerId: ME, formerIds: [] });
    const junk = JSON.stringify({ version: 1, ownerId: ME, formerIds: [ME, BUYER, BUYER, 3, null, 'no'], passports: saved.passports });
    expect(loadGarage(fakeStorage({ [GARAGE_KEY]: junk }), () => 'unused').state.formerIds).toEqual([BUYER]);
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

  it('takes with it only the files no other car here names', () => {
    // Two cars, each with a receipt of its own.
    const photo = (fileId: string) => ({ id: fileId, kind: 'receipt', name: 'r.jpg', mime: 'image/jpeg', size: 10, sha256: null });
    const entry = (fileIds: string[]): Record<string, unknown> => ({ ...receipt('2026-06-01'), id: id(), attachments: fileIds.map(photo) });
    let state = parkCar(parkCar(emptyGarage(ME)), micarId(2));
    state = write(state, entry(['mine-1', 'mine-2']));
    state = write(state, entry(['other-1']), micarId(2));
    expect(filesOnlyOf(state, CAR)).toEqual(['mine-1', 'mine-2']);
    expect(filesOnlyOf(state, micarId(2))).toEqual(['other-1']);
    expect(filesOnlyOf(state, micarId(9))).toEqual([]);
    // A passport file from someone else can name any file ID: here, the IDs of the first car's receipts (they travel
    // in every passport file its owner has shared). Removing that car must not take the first car's files with it.
    const theirs = write(parkCar(emptyGarage(BUYER), micarId(3)), entry(['mine-1', 'mine-2', 'theirs-1']), micarId(3));
    // Written into the file by hand, the same ID can even be named twice: it is listed once.
    const file = JSON.parse(exportGarage(theirs, NOW, micarId(3)));
    const named = file.passports[0].events[file.passports[0].events.length - 1];
    file.passports[0].events.push({ ...named, id: 'again', attachments: [named.attachments[2]] });
    const both = ok(importGarage(state, JSON.stringify(file))).state;
    expect(car(both, micarId(3)).events.filter((e) => e.attachments.some((a) => a.id === 'theirs-1'))).toHaveLength(2);
    expect(filesOnlyOf(both, micarId(3))).toEqual(['theirs-1']);
    // And the first car's own files stay for as long as any car here names them.
    expect(filesOnlyOf(both, CAR)).toEqual([]);
    expect(filesOnlyOf(removeCar(both, micarId(3)), CAR)).toEqual(['mine-1', 'mine-2']);
  });
});
