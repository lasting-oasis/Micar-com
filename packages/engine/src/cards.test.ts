import { describe, expect, it } from 'vitest';
import {
  EDITION_NAMES, RARITY_THRESHOLDS, SCARCITY_UNBACKED, assemble, buildNumberCounts, catalogueCard, exampleCard, finishOf, issueEdition, rarityOf, recordSnapshot, supportedHistory,
} from './cards';
import type { RarityInput } from './cards';
import { CATALOGUE, EXAMPLES, catalogueMatch } from './database';
import { GRADE_FORMULA, grade10Of, tierOf } from './grading';
import { micarIdFromBytes } from './identity';
import { MAX_EDITIONS, MAX_EVENTS, MAX_SNAPSHOTS, addEvent, appendEvent, createPassport, parsePassport, serializePassport, updateSpec, updateVin } from './passport';
import { publicPassport } from './public';
import { emptySpec } from './specs';
import { ATTRIBUTE_KEYS, RARITY_TIERS } from './types';
import type { Attachment, CardEdition, GradeSnapshot, Passport, Sourced, VehicleSpec, VerifierRegistry } from './types';
import { EMPTY_REGISTRY, recordAttestation, voidEvent } from './verification';

const OWNER = 'owner-one';
const TODAY = '2026-11-10';
const NOW = '2026-11-10T12:00:00.000Z';
const VIN = '1M8GDM9AXKP042788';
const REGISTRY: VerifierRegistry = {
  verifiers: [{ id: 'inspector-ann', kind: 'inspector', name: 'Ann Inspector', active: true, scopes: ['identity', 'mileage', 'documentation', 'condition', 'originality', 'modification', 'specification', 'one-of-one'] }],
};

const ref = { kind: 'reference', name: 'fixture', asOf: TODAY } as const;
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });
const civic = (over: Partial<VehicleSpec> = {}): VehicleSpec => ({
  ...emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: 'LX', bodyClass: 'sedan' }),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), cylinders: s(4), horsepower: s(158), torqueLbFt: s(138), transmissionType: s('cvt'),
  drivetrain: s('FWD'), curbWeightLb: s(2877), zeroToSixtySec: s(9.7), topSpeedMph: s(126), combinedMpg: s(35), warrantyPowertrainMiles: s(60000), ...over,
});

let n = 0;
const id = () => `e${++n}`;
const file = (kind: Attachment['kind']): Attachment => ({ id: id(), kind, name: 'f.jpg', mime: 'image/jpeg', size: 1000, sha256: null });
const ok = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => { if (!r.ok) throw new Error(r.reason); return r.value; };
const MICAR_ID = ok(micarIdFromBytes([1, 2, 3, 4, 5, 6, 7, 8]));
const parked = (spec = civic()): Passport => ok(createPassport({ micarId: MICAR_ID, now: '2026-01-05T09:00:00.000Z', ownerId: OWNER, spec, vin: VIN, eventId: id() }));
const add = (p: Passport, event: Record<string, unknown>): Passport =>
  ok(addEvent(p, { id: id(), mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...event }, { now: NOW, by: OWNER }));

function documented(p: Passport = parked()): Passport {
  p = add(p, { type: 'photo', subject: 'exterior', date: '2026-02-01', attachments: [file('photo'), file('photo'), file('photo'), file('photo')] });
  p = add(p, { type: 'document', document: 'title', date: '2026-02-01', attachments: [file('title')] });
  p = add(p, { type: 'mileage', date: '2026-02-01', mileage: 48000 });
  p = add(p, { type: 'maintenance', date: '2026-03-01', shop: '', cost: null, attachments: [file('receipt')] });
  p = add(p, { type: 'maintenance', date: '2026-06-01', shop: '', cost: null, attachments: [file('receipt')] });
  return p;
}

// A build number in these tests is one that can be relied on, unless a test says otherwise.
const rarity = (over: Partial<RarityInput> = {}) => rarityOf({ productionUnits: null, buildNumberBacked: true, modelYear: 2024, asOf: TODAY, level: 'registered', originality: 0, condition: 0, oneOfOneAttested: false, ...over });

describe('rarity', () => {
  it('uses the seven names of the brief, in order', () => {
    expect([...RARITY_TIERS]).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one-of-one']);
    expect(RARITY_THRESHOLDS.map(([, from]) => from)).toEqual([0, 10, 25, 40, 55, 70]);
  });

  it('takes no attribute and no rating, so performance cannot move it', () => {
    // The input type has no field for a score: this is the whole list of what rarity may read.
    const keys: Record<keyof RarityInput, true> = { productionUnits: true, buildNumberBacked: true, modelYear: true, asOf: true, level: true, originality: true, condition: true, oneOfOneAttested: true };
    expect(Object.keys(rarity()).sort()).toEqual(['factors', 'score', 'tier']);
    expect(Object.keys(keys)).toHaveLength(8);
    // Two cars with the same paperwork and very different performance get the same rarity.
    const slow = assemble(documented(parked(civic())), EMPTY_REGISTRY, TODAY);
    const fast = assemble(documented(parked(civic({ horsepower: s(900), torqueLbFt: s(800), zeroToSixtySec: s(2.4), topSpeedMph: s(220) }))), EMPTY_REGISTRY, TODAY);
    expect(fast.card.powerRating as number).toBeGreaterThan((slow.card.powerRating as number) + 100);
    expect(fast.rarity).toEqual(slow.rarity);
  });

  it('counts scarcity from a build number on file', () => {
    expect(rarity().factors[0].points).toBe(0);
    expect(rarity({ productionUnits: s(60) }).factors[0].points).toBe(40);
    expect(rarity({ productionUnits: s(99) }).factors[0].points).toBe(40);
    expect(rarity({ productionUnits: s(100) }).factors[0].points).toBe(34);
    expect(rarity({ productionUnits: s(4999) }).factors[0].points).toBe(27);
    expect(rarity({ productionUnits: s(19999) }).factors[0].points).toBe(20);
    expect(rarity({ productionUnits: s(99999) }).factors[0].points).toBe(12);
    expect(rarity({ productionUnits: s(499999) }).factors[0].points).toBe(5);
    expect(rarity({ productionUnits: s(500000) }).factors[0].points).toBe(0);
  });

  it('counts age, provenance and preservation', () => {
    expect(rarity({ modelYear: 2017 }).score).toBe(0);
    expect(rarity({ modelYear: 2016 }).score).toBe(3);
    expect(rarity({ modelYear: 2011 }).score).toBe(6);
    expect(rarity({ modelYear: 2001 }).score).toBe(11);
    expect(rarity({ modelYear: 1986 }).score).toBe(15);
    expect(rarity({ level: 'documented' }).score).toBe(10);
    expect(rarity({ level: 'verified' }).score).toBe(20);
    expect(rarity({ level: 'certified' }).score).toBe(30);
    expect(rarity({ originality: 90, condition: 85 }).score).toBe(15);
    expect(rarity({ originality: 85, condition: 75 }).score).toBe(7);
    expect(rarity({ originality: 79, condition: 69 }).score).toBe(0);
  });

  it('sets the tier from the score', () => {
    expect(rarity().tier).toBe('common');
    expect(rarity({ level: 'documented' }).tier).toBe('uncommon');
    expect(rarity({ level: 'verified', originality: 85, condition: 75 }).tier).toBe('rare'); // 27
    expect(rarity({ level: 'certified', originality: 95, condition: 80 }).tier).toBe('epic'); // 41
    expect(rarity({ level: 'certified', originality: 95, condition: 90, modelYear: 2001 }).tier).toBe('legendary'); // 56
    expect(rarity({ level: 'certified', originality: 95, condition: 90, productionUnits: s(3000) }).tier).toBe('mythic'); // 72
  });

  it('reserves One-of-One for a build of exactly one, or a verifier’s word', () => {
    expect(rarity({ level: 'certified', originality: 100, condition: 100, productionUnits: s(2), modelYear: 1960 }).tier).toBe('mythic');
    expect(rarity({ productionUnits: s(1) }).tier).toBe('one-of-one');
    expect(rarity({ oneOfOneAttested: true }).tier).toBe('one-of-one');
  });

  it('does not count a build number nothing stands behind, or anyone could type a 1', () => {
    for (const units of [1, 60]) {
      const typed = rarity({ productionUnits: s(units), buildNumberBacked: false });
      expect(typed.tier).toBe('common');
      expect(typed.score).toBe(0);
      expect(typed.factors[0]).toMatchObject({ id: 'scarcity', points: 0, detail: SCARCITY_UNBACKED });
    }
    expect(rarity({ productionUnits: s(60), buildNumberBacked: true }).factors[0]).toMatchObject({ points: 40, detail: '60 built' });
    expect(rarity({ productionUnits: s(1), buildNumberBacked: true }).tier).toBe('one-of-one');
  });

  it('relies on a passport’s build number only when the specification is the catalogue’s own or a verifier attested it', () => {
    const entry = CATALOGUE[0];
    const fromCatalogue: VehicleSpec = { ...entry.spec, productionUnits: entry.spec.productionUnits };
    // The catalogue's own entry is itself; add a build number to it and it is no longer the catalogue's.
    expect(catalogueMatch(fromCatalogue)).not.toBeNull();
    const added: VehicleSpec = { ...entry.spec, productionUnits: { value: 1, source: { kind: 'manufacturer', name: 'the maker', url: 'https://example.invalid/press' } } };
    if (entry.spec.productionUnits === null) {
      expect(buildNumberCounts(fromCatalogue, false)).toBe(false);
      // The label says "manufacturer". On a passport that label is the holder's own word, so it decides nothing.
      expect(buildNumberCounts(added, false)).toBe(false);
      expect(assemble(parked(added), REGISTRY, TODAY).rarity).toMatchObject({ tier: 'common', score: 0 });
    }
    expect(buildNumberCounts(added, true)).toBe(true);
    expect(buildNumberCounts(civic(), true)).toBe(false);
  });
});

describe('finish', () => {
  it('follows the grade the way the slab always has', () => {
    expect(finishOf({ grade10: 9.9, tier: 10 }, false)).toEqual({ finish: 'raw', foil: 0 });
    expect(finishOf({ grade10: 5.2, tier: 5 }, true)).toEqual({ finish: 'standard', foil: 0 });
    expect(finishOf({ grade10: 7, tier: 7 }, true)).toEqual({ finish: 'blue', foil: 0.25 });
    expect(finishOf({ grade10: 9, tier: 9 }, true).finish).toBe('holo');
    expect(finishOf({ grade10: 10, tier: 10 }, true)).toEqual({ finish: 'rainbow', foil: 1 });
  });
});

describe('assembling a card', () => {
  it('puts everything a card prints on it, and no price', () => {
    const a = assemble(documented(), EMPTY_REGISTRY, TODAY);
    const card = a.card;
    expect(card.micarId).toBe(MICAR_ID);
    expect(card.title).toBe('2019 Honda Civic');
    expect(card.subtitle).toBe('LX');
    expect(card.attributes.map((x) => x.key)).toEqual([...ATTRIBUTE_KEYS]);
    expect(card.powerRating).toBe(a.stats.vehicle.powerRating);
    expect(card.level).toBe('documented');
    expect(card.grade.slabbed).toBe(true);
    expect(card.grade.grade10).toBe(a.report.grade10);
    expect(card.rarity.tier).toBe('uncommon');
    // The fixture's figures are labelled "reference", but they are not the catalogue's: on a passport that label is the holder's word.
    expect(card.quality).toBe('owner');
    expect(card.illustrative).toBe(false);
    expect(card.photoAttachmentId).not.toBeNull();
    expect(JSON.stringify(card)).not.toMatch(/price|value now|msrp|\$/i);
    expect(Object.keys(card)).not.toContain('value');
  });

  it('shows a raw, ungraded label until the car is Documented', () => {
    const card = assemble(parked(), EMPTY_REGISTRY, TODAY).card;
    expect(card.level).toBe('registered');
    expect(card.grade.slabbed).toBe(false);
    expect(card.finish).toBe('raw');
    expect(card.rarity.tier).toBe('common');
    expect(card.edition).toEqual({ number: 1, name: 'Registration Edition', issuedAt: '2026-01-05T09:00:00.000Z' });
  });

  it('shows each modification as a chip with its evidence, and its effect as a change from factory', () => {
    const p = add(documented(), { type: 'modification', action: 'install', category: 'turbo', tier: 2, install: 'professional', parts: '', undoes: null, date: '2026-07-01', attachments: [file('receipt')] });
    const a = assemble(p, EMPTY_REGISTRY, TODAY);
    expect(a.card.mods).toEqual([{ category: 'turbo', tier: 2, evidence: 'documented' }]);
    const power = a.card.attributes.filter((x) => x.key === 'power')[0];
    expect(power.delta).toBeGreaterThan(0);
    expect(power.value).toBe((power.base as number) + power.delta);
    expect(a.card.attributes.filter((x) => x.key === 'reliability')[0].delta).toBeLessThan(0);
    // Ranked play does not count it: nobody verified it.
    expect(a.stats.competition.scores.power.value).toBe(a.stats.base.scores.power.value);
  });

  it('is the same for the same passport and day, and leaves the passport alone', () => {
    const p = documented();
    const before = JSON.stringify(p);
    expect(assemble(p, EMPTY_REGISTRY, TODAY)).toEqual(assemble(p, EMPTY_REGISTRY, TODAY));
    expect(JSON.stringify(p)).toBe(before);
  });

  const attestSpec = (p: Passport): Passport =>
    ok(recordAttestation(p, { id: id(), verifierId: 'inspector-ann', scope: 'specification', date: '2026-11-01', inPerson: false, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null }, REGISTRY, { now: NOW, eventId: id() }));

  it('marks the data verified only on a verifier’s word', () => {
    const p = documented();
    expect(assemble(p, REGISTRY, TODAY).card.quality).toBe('owner');
    const attested = attestSpec(p);
    expect(assemble(attested, REGISTRY, TODAY).card.quality).toBe('verified');
    expect(assemble(attested, EMPTY_REGISTRY, TODAY).card.quality).toBe('owner');
    expect(assemble(p, REGISTRY, TODAY).specificationAttested).toBe(false);
    expect(assemble(attested, REGISTRY, TODAY).specificationAttested).toBe(true);
    // The attestation was for the specification as it stood. Raise a figure afterwards and it no longer vouches for it.
    const tuned = ok(updateSpec(attested, civic({ horsepower: s(900) }), { by: OWNER }));
    expect(assemble(tuned, REGISTRY, TODAY).card.quality).toBe('owner');
    expect(assemble(tuned, REGISTRY, TODAY).specificationAttested).toBe(false);
  });

  it('never takes a source label on a passport at its word', () => {
    // Every figure relabelled "manufacturer" in the file. Nothing checks a label, so the card claims nothing from it.
    const relabelled = civic();
    for (const field of Object.keys(relabelled) as (keyof VehicleSpec)[]) {
      const cell = relabelled[field];
      if (field !== 'identity' && cell !== null) (cell as Sourced<unknown>).source = { kind: 'manufacturer', name: 'the maker', url: 'https://example.invalid/press' };
    }
    const a = assemble(parked(relabelled), REGISTRY, TODAY);
    expect(a.card.quality).toBe('owner');
    expect(a.catalogueSpecification).toBe(false);
    // A passport whose specification is the catalogue's own, figure for figure, carries the catalogue's standing.
    const house = assemble(parked(CATALOGUE[0].spec), REGISTRY, TODAY);
    expect(house.catalogueSpecification).toBe(true);
    expect(house.card.quality).toBe('reference');
  });

  it('gives a parked car no rarity for a build number nothing stands behind', () => {
    const typed = parked(civic({ productionUnits: { value: 1, source: { kind: 'owner' } } }));
    expect(assemble(typed, REGISTRY, TODAY).rarity).toMatchObject({ tier: 'common', score: 0 });
    // The same figure labelled as published: still the holder's own word.
    const labelled = parked(civic({ productionUnits: { value: 1, source: { kind: 'manufacturer' } } }));
    expect(assemble(labelled, REGISTRY, TODAY).rarity).toMatchObject({ tier: 'common', score: 0 });
    // A verifier attests the specification the figure is part of: now it counts.
    expect(assemble(attestSpec(labelled), REGISTRY, TODAY).rarity.tier).toBe('one-of-one');
    expect(assemble(attestSpec(labelled), EMPTY_REGISTRY, TODAY).rarity.tier).toBe('common');
  });
});

describe('ranked stats on a real passport', () => {
  // A 2012 car whose odometer an inspector read at 180,000 miles on 2026-11-01.
  const attest = (p: Passport, over: Record<string, unknown>): Passport =>
    ok(recordAttestation(p, { id: id(), verifierId: 'inspector-ann', scope: 'mileage', date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over }, REGISTRY, { now: NOW, eventId: id() }));
  const old = (): Passport => attest(parked({ ...civic(), identity: { ...civic().identity, year: 2012 } }), { mileage: 180000 });
  const ranked = (p: Passport) => ATTRIBUTE_KEYS.map((k) => assemble(p, REGISTRY, TODAY).stats.competition.scores[k].value);
  const mine = (p: Passport) => ATTRIBUTE_KEYS.map((k) => assemble(p, REGISTRY, TODAY).stats.vehicle.scores[k].value);

  it('carry the wear a verifier’s reading implies', () => {
    const a = assemble(old(), REGISTRY, TODAY);
    expect(a.competitionCondition.systems.engine).toMatchObject({ wear: 0.9, basis: 'modelled', evidence: 'verified' });
    expect(a.stats.competition.scores.reliability.value as number).toBeLessThan(a.stats.base.scores.reliability.value as number);
    expect(a.stats.competitionAdjustments.every((x) => x.source === 'wear' && x.evidence === 'verified')).toBe(true);
    // With no verifier connected the same passport races at its factory figures.
    const none = assemble(old(), EMPTY_REGISTRY, TODAY);
    expect(ATTRIBUTE_KEYS.map((k) => none.stats.competition.scores[k].value)).toEqual(ATTRIBUTE_KEYS.map((k) => none.stats.base.scores[k].value));
  });

  it('cannot be raised by anything the owner types or uploads afterwards', () => {
    const before = ranked(old());
    // (a) A newer reading the owner typed. It becomes the vehicle's latest reading, and it is only declared.
    const typed = add(old(), { type: 'mileage', date: '2026-11-05', mileage: 180050 });
    expect(assemble(typed, REGISTRY, TODAY).condition.mileageEvidence).toBe('declared');
    expect(ranked(typed)).toEqual(before);
    // (b) A declared salvage title. The vehicle's own durability falls; ranked play does not move, up or down.
    const salvage = add(old(), { type: 'declaration', date: '2026-11-05', titleStatus: 'Salvage' });
    expect(ranked(salvage)).toEqual(before);
    expect(mine(salvage)[4] as number).toBeLessThan(mine(old())[4] as number);
    // (c) An engine replacement with a photo attached and no odometer reading.
    const swap = { type: 'repair', system: 'engine', work: 'replacement', shop: '', cost: null, attachments: [file('invoice')] };
    const receipt = add(old(), { ...swap, date: '2026-11-06' });
    expect(ranked(receipt)).toEqual(before);
    expect(mine(receipt)[0] as number).toBeGreaterThan(mine(old())[0] as number);
    // (d) The same receipt with an odometer reading on it.
    const dated = add(old(), { ...swap, date: '2026-11-06', mileage: 179000 });
    expect(ranked(dated)).toEqual(before);
    // An owner who rolls the odometer forward gains nothing either: the verifier's figure is the one that counts.
    expect(ranked(add(old(), { type: 'mileage', date: '2026-11-07', mileage: 400000 }))).toEqual(before);
  });

  it('cannot be moved through a verified modification either: not by an upload, not by a declared removal', () => {
    // A turbocharger kit a verifier confirmed, fitted seventeen months ago and with no upkeep on record since.
    let p = add(old(), { id: 'the-turbo', type: 'modification', date: '2025-06-01', action: 'install', category: 'turbo', tier: 3, install: 'professional', parts: '', undoes: null });
    p = attest(p, { scope: 'modification', events: ['the-turbo'] });
    const before = ranked(p);
    expect(before[0] as number).toBeGreaterThan(ranked(old())[0] as number);
    // (a) One maintenance entry with any file attached used to make the kit "kept up" in ranked play as well, and
    //     was worth RELIABILITY and DURABILITY there. It still counts for the vehicle's own stats.
    const serviced = add(p, { id: 'the-service', type: 'maintenance', date: '2026-11-05', shop: '', cost: null, attachments: [file('receipt')] });
    expect(ranked(serviced)).toEqual(before);
    expect(mine(serviced)[5] as number).toBeGreaterThan(mine(p)[5] as number);
    // (b) A removal the owner only declares used to take the kit out of ranked play, which lowered POWER there and
    //     raised DURABILITY, RELIABILITY and EFFICIENCY: the attributes an endurance or economy race is decided on.
    const removed = add(p, { id: 'the-removal', type: 'modification', date: '2026-11-06', action: 'remove', category: 'turbo', tier: 3, install: 'professional', parts: '', undoes: 'the-turbo' });
    expect(ranked(removed)).toEqual(before);
    expect(assemble(removed, REGISTRY, TODAY).modifications.applied).toEqual([]);
    expect(mine(removed)[0] as number).toBeLessThan(mine(p)[0] as number);
    // Once a verifier confirms the service record, or the removal, ranked play follows.
    const confirmedService = ranked(attest(serviced, { scope: 'documentation', events: ['the-service'] }));
    expect(confirmedService[5] as number).toBeGreaterThan(before[5] as number);
    const confirmedRemoval = ranked(attest(removed, { scope: 'modification', events: ['the-removal'] }));
    expect(confirmedRemoval).toEqual(ranked(old()));
  });

  it('follow a replacement once a verifier confirms it', () => {
    let p = add(old(), { id: 'the-swap', type: 'repair', system: 'engine', work: 'replacement', shop: 'A shop', cost: 6000, date: '2026-10-20', mileage: 179000, attachments: [file('invoice')] });
    const before = assemble(p, REGISTRY, TODAY);
    expect(before.competitionCondition.systems.engine.wear).toBe(0.9);
    p = attest(p, { scope: 'documentation', events: ['the-swap'] });
    const after = assemble(p, REGISTRY, TODAY);
    expect(after.competitionCondition.systems.engine).toMatchObject({ basis: 'modelled', evidence: 'verified', sinceMileage: 179000 });
    expect(after.competitionCondition.systems.engine.wear).toBeCloseTo(1000 / 200000, 9);
    expect(after.stats.competition.scores.power.value as number).toBeGreaterThan(before.stats.competition.scores.power.value as number);
  });
});

describe('editions and snapshots', () => {
  it('prints the first edition, then a new one only at a milestone, and keeps the earlier ones', () => {
    let p = parked();
    p = issueEdition(p, EMPTY_REGISTRY, { now: '2026-01-05T09:00:00.000Z', reason: 'Parked' });
    expect(p.editions).toHaveLength(1);
    expect(p.editions[0]).toMatchObject({ number: 1, name: EDITION_NAMES.registered, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, reason: 'Parked' });
    const same = issueEdition(p, EMPTY_REGISTRY, { now: NOW, reason: 'Nothing happened' });
    expect(same).toBe(p);
    const first = p.editions[0];
    p = issueEdition(documented(p), EMPTY_REGISTRY, { now: NOW, reason: 'Maintenance' });
    expect(p.editions).toHaveLength(2);
    expect(p.editions[0]).toEqual(first);
    expect(p.editions[1]).toMatchObject({ number: 2, name: 'Documented Edition', level: 'documented', rarity: 'uncommon', finish: 'standard', issuedAt: NOW });
    expect(p.editions[1].grade10).not.toBeNull();
    expect(Object.keys(p.editions[1].attributes)).toEqual([...ATTRIBUTE_KEYS]);
    expect(assemble(p, EMPTY_REGISTRY, TODAY).card.serial).toBe(`${MICAR_ID} · E2`);
  });

  it('prints one edition for each level reached, and shows the one for the level held now', () => {
    let p = issueEdition(parked(), EMPTY_REGISTRY, { now: '2026-01-05T09:00:00.000Z', reason: 'Parked' });
    p = issueEdition(documented(p), EMPTY_REGISTRY, { now: NOW, reason: 'Maintenance' });
    expect(p.editions.map((e) => e.level)).toEqual(['registered', 'documented']);
    // The VIN is cleared: the car is Registered again. That is not a milestone, so nothing is printed,
    // and the card goes back to showing the edition it was given as a Registered car.
    const lost = ok(updateVin(p, '', { by: OWNER }));
    expect(assemble(lost, EMPTY_REGISTRY, TODAY).certification.level).toBe('registered');
    expect(issueEdition(lost, EMPTY_REGISTRY, { now: NOW, reason: 'VIN updated' })).toBe(lost);
    expect(assemble(lost, EMPTY_REGISTRY, TODAY).card.edition).toMatchObject({ number: 1, name: 'Registration Edition' });
    // Put back, it is Documented again and shows the Documented edition it already has. Toggling prints nothing.
    const back = ok(updateVin(lost, VIN, { by: OWNER }));
    expect(issueEdition(back, EMPTY_REGISTRY, { now: NOW, reason: 'VIN updated' })).toBe(back);
    expect(assemble(back, EMPTY_REGISTRY, TODAY).card.edition).toMatchObject({ number: 2, name: 'Documented Edition' });
    expect(back.editions).toHaveLength(2);
  });

  it('does not show history a file wrote for itself', () => {
    const honest = recordSnapshot(issueEdition(documented(), EMPTY_REGISTRY, { now: NOW, reason: 'Maintenance' }), EMPTY_REGISTRY, { now: NOW, id: 'snap-real', reason: 'Maintenance' });
    const real = assemble(honest, EMPTY_REGISTRY, TODAY);
    // Added by hand in a text editor: an in-person Certified 9.9, and a One-of-One Certified Edition.
    const forged: Passport = {
      ...honest,
      snapshots: [...honest.snapshots, {
        id: 'snap-forged', at: NOW, asOf: TODAY, reason: 'Inspected in person', formula: 'micar-grade-v2', overall: 98.7, grade10: 9.9, tier: 10,
        categories: { identity: 100, documentation: 100, condition: 98, originality: 100, verification: 100 }, level: 'certified', events: honest.events.length,
      }],
      editions: [...honest.editions, {
        number: honest.editions.length + 1, name: 'Certified Edition', issuedAt: NOW, level: 'certified', rarity: 'one-of-one', finish: 'rainbow', grade10: 9.9, powerRating: 999,
        attributes: { power: 999, speed: 999, acceleration: 999, handling: 999, durability: 999, reliability: 999, efficiency: 999 }, reason: 'Inspected in person',
      }],
    };
    const read = ok(parsePassport(serializePassport(forged))).passport;
    for (const registry of [EMPTY_REGISTRY, REGISTRY]) {
      const kept = supportedHistory(read, registry, TODAY);
      expect(kept.unsupported).toBe(2);
      expect(kept.snapshots.map((s) => s.id)).toEqual(honest.snapshots.map((s) => s.id));
      expect(kept.editions.map((e) => e.level)).toEqual(honest.editions.map((e) => e.level));
      // The card, the level and the public view are the honest car's.
      const a = assemble(read, registry, TODAY);
      expect(a.certification.level).toBe('documented');
      expect(a.card.edition).toEqual(real.card.edition);
      const shown = publicPassport(read, registry, TODAY);
      expect(JSON.stringify(shown)).not.toContain('certified');
      expect(JSON.stringify(shown)).not.toContain('one-of-one');
      expect(shown.snapshots.every((s) => s.categories.verification === 0)).toBe(true);
    }
    // Writing to the forged passport appends real history after it and compares with the last real snapshot, not the forged one.
    expect(recordSnapshot(read, EMPTY_REGISTRY, { now: NOW, id: 'snap-next', reason: 'Nothing happened' })).toBe(read);
    expect(issueEdition(read, EMPTY_REGISTRY, { now: NOW, reason: 'Nothing happened' })).toBe(read);
    // Smaller lies are caught too: a Documented snapshot that claims a score no owner can reach alone.
    const padded: Passport = { ...honest, snapshots: [{ ...honest.snapshots[0], id: 'snap-padded', overall: 80, grade10: 8, tier: 8, categories: { ...honest.snapshots[0].categories, identity: 100 } }] };
    expect(supportedHistory(padded, EMPTY_REGISTRY, TODAY).snapshots).toEqual([]);
  });

  it('shows a Verified history when a registered verifier’s attestations stand behind it', () => {
    const attest = (p: Passport, scope: string, over: Record<string, unknown> = {}): Passport =>
      ok(recordAttestation(p, { id: id(), verifierId: 'inspector-ann', scope, date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over }, REGISTRY, { now: NOW, eventId: id() }));
    let p = attest(attest(documented(), 'identity'), 'mileage', { mileage: 48100 });
    p = attest(p, 'originality');
    p = recordSnapshot(issueEdition(p, REGISTRY, { now: NOW, reason: 'Attestation' }), REGISTRY, { now: NOW, id: 'snap-verified', reason: 'Attestation' });
    expect(assemble(p, REGISTRY, TODAY).certification.level).toBe('verified');
    expect(supportedHistory(p, REGISTRY, TODAY)).toMatchObject({ unsupported: 0 });
    expect(supportedHistory(p, REGISTRY, TODAY).editions.map((e) => e.level)).toContain('verified');
    // The same file read where that verifier is not registered supports none of it.
    const elsewhere = supportedHistory(p, EMPTY_REGISTRY, TODAY);
    expect(elsewhere.editions.some((e) => e.level === 'verified')).toBe(false);
    expect(elsewhere.snapshots.some((s) => s.level === 'verified')).toBe(false);
    expect(assemble(p, EMPTY_REGISTRY, TODAY).card.edition.name).toBe('Documented Edition');
  });

  /* One lie at a time. Each stored entry below is an honest one with a single thing changed, so each check is seen
     to do its own work: a forgery that breaks five rules at once would still be caught with four of them missing. */
  const honestHistory = (spec = civic()): { passport: Passport; snapshot: GradeSnapshot; raw: CardEdition; slabbed: CardEdition } => {
    let p = issueEdition(parked(spec), EMPTY_REGISTRY, { now: '2026-01-05T09:00:00.000Z', reason: 'Parked' });
    p = recordSnapshot(issueEdition(documented(p), EMPTY_REGISTRY, { now: NOW, reason: 'Maintenance' }), EMPTY_REGISTRY, { now: NOW, id: 'snap-real', reason: 'Maintenance' });
    return { passport: p, snapshot: p.snapshots[p.snapshots.length - 1], raw: p.editions[0], slabbed: p.editions[1] };
  };
  const shownSnapshots = (p: Passport, forged: GradeSnapshot, registry = EMPTY_REGISTRY, asOf = TODAY): string[] =>
    supportedHistory({ ...p, snapshots: [...p.snapshots, forged] }, registry, asOf).snapshots.map((s) => s.id);
  const editionShown = (p: Passport, forged: CardEdition, registry = EMPTY_REGISTRY, asOf = TODAY): boolean =>
    supportedHistory({ ...p, editions: [...p.editions, { ...forged, number: p.editions.length + 1 }] }, registry, asOf).editions.length === p.editions.length + 1;

  it('holds a stored grade to every rule on its own', () => {
    const { passport: p, snapshot: real } = honestHistory();
    expect(real).toMatchObject({ level: 'documented', formula: GRADE_FORMULA, asOf: TODAY });
    expect(real.categories.verification).toBe(0);
    const copy = (over: Partial<GradeSnapshot>): GradeSnapshot => ({ ...real, id: 'snap-forged', ...over });
    // A copy of the honest snapshot under another id is shown: nothing here refuses a snapshot for being a second one.
    expect(shownSnapshots(p, copy({}))).toEqual(['snap-real', 'snap-forged']);
    const refused = (over: Partial<GradeSnapshot>, why: string) => expect(shownSnapshots(p, copy(over)), why).toEqual(['snap-real']);
    refused({ level: 'verified' }, 'a level above what the record supports');
    refused({ level: 'certified' }, 'a level above what the record supports');
    // The label's number and tier are the overall's: the 10.0 a reader looks at cannot be written in beside a 12.
    refused({ grade10: 10, tier: 10 }, 'a label that is not its overall');
    refused({ grade10: real.grade10 + 0.1 }, 'a label that is not its overall');
    refused({ tier: real.tier + 1 }, 'a tier that is not its label');
    // The overall is the weighted sum of its own categories.
    const lifted = Math.round((real.overall + 3) * 10) / 10;
    refused({ overall: lifted, grade10: grade10Of(lifted), tier: tierOf(grade10Of(lifted)) }, 'an overall its categories do not add up to');
    // A category above what an owner can reach alone, with an overall that agrees with it and is itself in reach.
    const withVerification = Math.round((real.overall + 10 * 0.15) * 10) / 10;
    refused({ categories: { ...real.categories, verification: 10 }, overall: withVerification, grade10: grade10Of(withVerification), tier: tierOf(grade10Of(withVerification)) }, 'a Verification score with no verifier');
    const withIdentity = Math.round((real.overall + (100 - real.categories.identity) * 0.2) * 10) / 10;
    refused({ categories: { ...real.categories, identity: 100 }, overall: withIdentity, grade10: grade10Of(withIdentity), tier: tierOf(grade10Of(withIdentity)) }, 'an Identity score no owner reaches alone');
    // Another formula's numbers cannot be judged by this one.
    refused({ formula: 'micar-grade-v9' }, 'a formula this engine does not use');
    // A snapshot is the grade of the day it was written, and that day has to have happened.
    refused({ asOf: '2026-03-01' }, 'a day that is not the day it was written');
    refused({ at: '2042-01-01T00:00:00.000Z', asOf: '2042-01-01' }, 'a day that has not happened');
    expect(shownSnapshots(p, copy({ at: '2042-01-01T00:00:00.000Z', asOf: '2042-01-01' }), EMPTY_REGISTRY, '2042-01-01')).toEqual(['snap-real', 'snap-forged']);
    // A lower level than the record supports is nobody's gain, and is shown.
    expect(shownSnapshots(p, copy({ level: 'registered' }))).toEqual(['snap-real', 'snap-forged']);
  });

  it('holds a stored edition to every rule on its own', () => {
    const { passport: p, raw, slabbed } = honestHistory();
    expect(raw).toMatchObject({ level: 'registered', finish: 'raw', grade10: null });
    expect(slabbed).toMatchObject({ level: 'documented', finish: 'standard', rarity: 'uncommon' });
    expect(editionShown(p, slabbed)).toBe(true);
    expect(editionShown(p, raw)).toBe(true);
    const refused = (forged: CardEdition, why: string) => expect(editionShown(p, forged), why).toBe(false);
    refused({ ...slabbed, level: 'verified' }, 'a level above what the record supports');
    // Rarity: a 2019 Documented car with no attestation can be Uncommon at the very most. Its level is worth ten
    // points and the most an owner's originality (85) and condition (75) can earn is seven: seventeen, under Rare.
    // The ceiling once gave full preservation marks, and a file could show a Rare that no owner could have reached.
    expect(editionShown(p, { ...slabbed, rarity: 'uncommon' })).toBe(true);
    refused({ ...slabbed, rarity: 'rare' }, 'a rarity no owner reaches alone');
    refused({ ...slabbed, rarity: 'epic' }, 'a rarity above what the record supports');
    refused({ ...slabbed, rarity: 'one-of-one' }, 'One-of-One with nothing behind it');
    // A card's rarity is held to its own level: a Registered card has no provenance points, so seven at most. Common.
    expect(editionShown(p, { ...raw, rarity: 'common' })).toBe(true);
    refused({ ...raw, rarity: 'uncommon' }, 'a Registered card with a Documented card’s rarity');
    // The grade on the label, with the finish that grade would earn.
    refused({ ...slabbed, grade10: 9.9, finish: 'rainbow' }, 'a grade above what the record supports');
    // The finish is the one the grade earns; a raw card has neither and a slabbed one has both.
    refused({ ...slabbed, finish: 'rainbow' }, 'a finish its grade does not earn');
    refused({ ...slabbed, finish: 'raw' }, 'a finish its grade does not earn');
    refused({ ...slabbed, grade10: null }, 'a slabbed card with no grade');
    refused({ ...raw, grade10: 6.5 }, 'a raw card with a grade');
    refused({ ...raw, finish: 'standard' }, 'a raw card with a finish');
    // The Power Rating printed is the mean of the seven attributes printed with it.
    refused({ ...slabbed, powerRating: 1000 }, 'a Power Rating that is not its attributes’');
    refused({ ...slabbed, powerRating: null }, 'a Power Rating that is not its attributes’');
    // Nothing dated after today is shown.
    refused({ ...slabbed, issuedAt: '2042-01-01T00:00:00.000Z' }, 'a day that has not happened');
  });

  it('judges a stored edition by the day it is dated, the car’s age on that day and the build number the record backs', () => {
    // An honest Documented edition, to be written into other cars' files with one thing changed.
    const { slabbed } = honestHistory();
    // A 2001 car turns twenty-five in 2026: eleven age points, and with a Documented card's ten and an owner's seven
    // for preservation it can be Rare (28 points).
    const old = honestHistory({ ...civic(), identity: { ...civic().identity, year: 2001 } }).passport;
    const rare = (issuedAt: string): CardEdition => ({ ...slabbed, rarity: 'rare', issuedAt });
    expect(editionShown(old, rare(NOW))).toBe(true);
    expect(editionShown(old, { ...slabbed, rarity: 'epic' })).toBe(false);
    // Dated the year before, the car was twenty-four and Uncommon was the most it could be. Today's age is not lent to the past.
    expect(editionShown(old, rare('2025-12-31T12:00:00.000Z'))).toBe(false);
    expect(editionShown(old, { ...slabbed, rarity: 'uncommon', issuedAt: '2025-12-31T12:00:00.000Z' })).toBe(true);
    // Nor is the future's lent to today: the same claim dated 2042 on a 2002 car is not shown now, and Rare is beyond it today.
    const younger = honestHistory({ ...civic(), identity: { ...civic().identity, year: 2002 } }).passport;
    expect(editionShown(younger, rare('2042-01-01T00:00:00.000Z'))).toBe(false);
    expect(editionShown(younger, rare(NOW))).toBe(false);
    // A forty-year-old car gets fifteen: thirty-two points, still Rare. Epic takes a verifier or a backed build number.
    const forty = honestHistory({ ...civic(), identity: { ...civic().identity, year: 1986 } }).passport;
    expect(editionShown(forty, rare(NOW))).toBe(true);
    expect(editionShown(forty, { ...slabbed, rarity: 'epic' })).toBe(false);
    // A build number the owner typed lifts no ceiling: sixty built would be worth forty points if it counted.
    const typed = honestHistory(civic({ productionUnits: { value: 60, source: { kind: 'manufacturer', name: 'typed in' } } }));
    expect(editionShown(typed.passport, { ...typed.slabbed, rarity: 'uncommon' })).toBe(true);
    expect(editionShown(typed.passport, { ...typed.slabbed, rarity: 'rare' })).toBe(false);
    expect(editionShown(typed.passport, { ...typed.slabbed, rarity: 'legendary' })).toBe(false);
  });

  it('shows the card’s own edition, never one a file added for the level it holds', () => {
    const { passport: p, slabbed } = honestHistory();
    const forged: Passport = { ...p, editions: [...p.editions, { ...slabbed, number: 3, rarity: 'mythic', issuedAt: NOW }] };
    expect(assemble(forged, EMPTY_REGISTRY, TODAY).card.edition).toMatchObject({ number: 2, name: 'Documented Edition' });
    expect(assemble(forged, EMPTY_REGISTRY, TODAY).card.serial).toBe(`${MICAR_ID} · E2`);
    // And the level's edition is not printed again because a forged one sits after it.
    expect(issueEdition(forged, EMPTY_REGISTRY, { now: NOW, reason: 'Nothing happened' })).toBe(forged);
  });

  it('writes a new snapshot when the level or a single category changes, even with the overall unchanged', () => {
    const { passport: p, snapshot: real } = honestHistory();
    // The last supported snapshot says the same overall at a lower level: today's grade is news.
    const lowerLevel: Passport = { ...p, snapshots: [{ ...real, id: 'snap-lower', level: 'registered' }] };
    expect(recordSnapshot(lowerLevel, EMPTY_REGISTRY, { now: NOW, id: 'snap-next', reason: 'Maintenance' }).snapshots.map((s) => s.id)).toEqual(['snap-lower', 'snap-next']);
    // The last one says the same overall and level with two categories that differ and cancel out (5 x 0.2 = 4 x 0.25).
    const shifted: GradeSnapshot = { ...real, id: 'snap-shifted', categories: { ...real.categories, identity: real.categories.identity - 5, condition: real.categories.condition + 4 } };
    expect(supportedHistory({ ...p, snapshots: [shifted] }, EMPTY_REGISTRY, TODAY).snapshots).toHaveLength(1);
    expect(recordSnapshot({ ...p, snapshots: [shifted] }, EMPTY_REGISTRY, { now: NOW, id: 'snap-next', reason: 'Maintenance' }).snapshots.map((s) => s.id)).toEqual(['snap-shifted', 'snap-next']);
    // The honest one is still not written twice.
    expect(recordSnapshot(p, EMPTY_REGISTRY, { now: NOW, id: 'snap-next', reason: 'Nothing happened' })).toBe(p);
  });

  it('stops adding history at the most a passport can hold, so a passport it wrote can always be read back', () => {
    const { passport: p, snapshot: real, slabbed } = honestHistory();
    const full: Passport = {
      ...p,
      snapshots: Array.from({ length: MAX_SNAPSHOTS }, (_, i) => ({ ...real, id: `s${i}`, level: 'registered' as const })),
      editions: Array.from({ length: MAX_EDITIONS }, (_, i) => ({ ...slabbed, number: i + 1, rarity: 'mythic' as const })),
    };
    const after = issueEdition(recordSnapshot(full, EMPTY_REGISTRY, { now: NOW, id: 'snap-over', reason: 'Maintenance' }), EMPTY_REGISTRY, { now: NOW, reason: 'Maintenance' });
    expect(after.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(after.editions).toHaveLength(MAX_EDITIONS);
    expect(parsePassport(serializePassport(after)).ok).toBe(true);
    // One more of either in a file is refused whole.
    expect(parsePassport({ ...after, editions: [...after.editions, { ...slabbed, number: MAX_EDITIONS + 1 }] }).ok).toBe(false);
    expect(parsePassport({ ...after, snapshots: [...after.snapshots, real] }).ok).toBe(false);
  });

  it('keeps each grade as it stood and never writes the same one twice', () => {
    let p = recordSnapshot(parked(), EMPTY_REGISTRY, { now: '2026-01-05T09:00:00.000Z', id: 'snap-1', reason: 'Parked' });
    expect(p.snapshots).toHaveLength(1);
    expect(recordSnapshot(p, EMPTY_REGISTRY, { now: NOW, id: 'snap-2', reason: 'Nothing happened' })).toBe(p);
    const first = p.snapshots[0];
    p = recordSnapshot(documented(p), EMPTY_REGISTRY, { now: NOW, id: 'snap-3', reason: 'Maintenance' });
    expect(p.snapshots).toHaveLength(2);
    expect(p.snapshots[0]).toEqual(first);
    expect(p.snapshots[1].overall).toBeGreaterThan(first.overall);
    expect(p.snapshots[1].level).toBe('documented');
    expect(p.snapshots[1].formula).toBe('micar-grade-v2');
  });
});

describe('history, judged as the record stood when it was written', () => {
  const attestation = (scope: string, over: Record<string, unknown> = {}) =>
    ({ id: id(), verifierId: 'inspector-ann', scope, date: '2026-11-01', inPerson: true, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null, ...over });
  const settle = (p: Passport, now: string): Passport => issueEdition(recordSnapshot(p, REGISTRY, { now, id: id(), reason: 'Attested' }), REGISTRY, { now, reason: 'Attested' });
  /** Documented in the spring, then attested on the morning of 1 November: Verified, with its snapshot and its edition. */
  function verifiedAtNine(): { passport: Passport; identityEntry: string; identityId: string } {
    let p = settle(documented(issueEdition(parked(), REGISTRY, { now: '2026-01-05T09:00:00.000Z', reason: 'Parked' })), '2026-06-01T12:00:00.000Z');
    const identityEntry = id(), identity = attestation('identity');
    p = ok(recordAttestation(p, identity, REGISTRY, { now: '2026-11-01T09:00:00.000Z', eventId: identityEntry }));
    p = ok(recordAttestation(p, attestation('mileage', { mileage: 48500 }), REGISTRY, { now: '2026-11-01T09:00:00.000Z', eventId: id() }));
    p = ok(recordAttestation(p, attestation('originality'), REGISTRY, { now: '2026-11-01T09:00:00.000Z', eventId: id() }));
    return { passport: settle(p, '2026-11-01T09:30:00.000Z'), identityEntry, identityId: identity.id };
  }
  const levels = (p: Passport, asOf: string) => supportedHistory(p, REGISTRY, asOf).editions.map((e) => e.level);

  it('keeps a morning’s grade when the verifier takes the attestation back that afternoon', () => {
    const { passport: morning, identityEntry, identityId } = verifiedAtNine();
    expect(assemble(morning, REGISTRY, '2026-11-01').certification.level).toBe('verified');
    expect(levels(morning, '2026-11-01')).toEqual(['registered', 'documented', 'verified']);
    // 15:00 the same day: the inspector withdraws the identity attestation. The car is Documented again.
    let p = ok(voidEvent(morning, { target: identityEntry, reason: 'Wrong car', attestationId: identityId }, REGISTRY, { now: '2026-11-01T15:00:00.000Z', eventId: id() }));
    p = settle(p, '2026-11-01T15:05:00.000Z');
    expect(assemble(p, REGISTRY, '2026-11-01').certification.level).toBe('documented');
    // What was kept at 09:30 was true at 09:30. It used to be judged by the whole day, withdrawal included: the
    // Verified snapshot and its edition were hidden as claiming more than the record supports.
    const kept = supportedHistory(p, REGISTRY, '2026-11-02');
    expect(kept.unsupported).toBe(0);
    expect(kept.snapshots.map((s) => s.level)).toEqual(['documented', 'verified', 'documented']);
    expect(kept.editions.map((e) => e.level)).toEqual(['registered', 'documented', 'verified']);
    // A month on the identity is attested again. The level was lost and is regained: nothing new is printed, and
    // the card shows the Verified edition it was given the first time.
    p = ok(recordAttestation(p, attestation('identity', { date: '2026-12-01' }), REGISTRY, { now: '2026-12-01T10:00:00.000Z', eventId: id() }));
    const regained = settle(p, '2026-12-01T10:05:00.000Z');
    expect(assemble(regained, REGISTRY, '2026-12-01').certification.level).toBe('verified');
    expect(regained.editions).toHaveLength(3);
    expect(assemble(regained, REGISTRY, '2026-12-01').card.edition).toMatchObject({ number: 3, issuedAt: '2026-11-01T09:30:00.000Z' });
  });

  it('does not let a grade written after a withdrawal, or beside one dated back, stand on the attestation', () => {
    const { passport: morning, identityEntry, identityId } = verifiedAtNine();
    const withdrawn = ok(voidEvent(morning, { target: identityEntry, reason: 'Wrong car', attestationId: identityId }, REGISTRY, { now: '2026-11-01T15:00:00.000Z', eventId: id() }));
    // A Verified snapshot written into the file for 16:00, an hour after the withdrawal.
    const verified = morning.snapshots[morning.snapshots.length - 1];
    expect(verified.level).toBe('verified');
    const after: Passport = { ...withdrawn, snapshots: [...withdrawn.snapshots, { ...verified, id: 'after-the-fact', at: '2026-11-01T16:00:00.000Z' }] };
    expect(supportedHistory(after, REGISTRY, '2026-11-02')).toMatchObject({ unsupported: 1 });
    expect(supportedHistory(after, REGISTRY, '2026-11-02').snapshots.map((s) => s.id)).not.toContain('after-the-fact');
    // A withdrawal dated 1 November but written down on the 5th says nothing about the hour: it counts for the whole
    // of the day it is dated, as it does everywhere else.
    const backdated = appendEvent(morning, { ...withdrawn.events[withdrawn.events.length - 1], id: id(), recordedAt: '2026-11-05T15:00:00.000Z' });
    expect(supportedHistory(backdated, REGISTRY, '2026-11-06').unsupported).toBe(2);
    expect(levels(backdated, '2026-11-06')).toEqual(['registered', 'documented']);
    // And one written the day after leaves the day before as it was.
    const nextDay = ok(voidEvent(morning, { target: identityEntry, reason: 'Wrong car', attestationId: identityId }, REGISTRY, { now: '2026-11-02T08:00:00.000Z', eventId: id() }));
    expect(supportedHistory(nextDay, REGISTRY, '2026-11-03').unsupported).toBe(0);
  });
});

describe('a passport file of any size', () => {
  it('is judged in about the time a short one is, whatever it is padded with', () => {
    // What a file can hold at the limits: thousands of withdrawals that name the one reading, one attestation by
    // nobody (which once switched off the short cut for passports with none), a snapshot for every day of thirteen
    // years and two hundred editions. Each day used to have the whole standing worked out again, and each
    // withdrawal read the whole list twice: forty seconds to draw the card and many minutes to open the passport.
    const base = parked();
    const entry = (over: Record<string, unknown>) => ({ date: '2026-01-06', recordedAt: '2026-01-06T09:00:00.000Z', by: OWNER, mileage: null, title: '', note: '', attachments: [], visibility: 'private', ...over });
    const day = (i: number): string => new Date(Date.UTC(2010, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const snapshot = (i: number) => ({ id: `s${i}`, at: `${day(i)}T10:00:00.000Z`, asOf: day(i), reason: 'x', formula: GRADE_FORMULA, overall: 67.5, grade10: 6.8, tier: 6, categories: { identity: 55, documentation: 100, condition: 75, originality: 85, verification: 0 }, level: 'documented', events: 1 });
    const raw = JSON.parse(serializePassport(base));
    raw.events = [
      ...raw.events,
      entry({ id: 'm1', type: 'mileage', mileage: 5 }),
      entry({ id: 'zz', type: 'attestation', by: 'nobody', attestation: { id: 'a1', verifierId: 'nobody', scope: 'documentation', date: '2026-01-06', inPerson: false, conditionScore: null, systems: null, mileage: null, events: ['m1'], note: '', signature: null, subject: null } }),
      ...Array.from({ length: MAX_EVENTS - 3 }, (_, i) => entry({ id: `v${i}`, type: 'void', by: 'nobody', target: 'm1', reason: '', attestationId: 'a1' })),
    ];
    raw.snapshots = Array.from({ length: MAX_SNAPSHOTS }, (_, i) => snapshot(i));
    raw.editions = Array.from({ length: MAX_EDITIONS }, (_, i) => ({ number: i + 1, name: 'x', issuedAt: `${day(i * 20)}T10:00:00.000Z`, level: 'registered', rarity: 'common', finish: 'raw', grade10: null, powerRating: null, attributes: { power: null, speed: null, acceleration: null, handling: null, durability: null, reliability: null, efficiency: null }, reason: 'x' }));
    const read = ok(parsePassport(raw));
    expect(read.dropped).toBe(0);
    const padded = read.passport;
    expect([padded.events.length, padded.snapshots.length, padded.editions.length]).toEqual([MAX_EVENTS, MAX_SNAPSHOTS, MAX_EDITIONS]);

    const started = Date.now();
    for (const registry of [EMPTY_REGISTRY, REGISTRY]) {
      const history = supportedHistory(padded, registry, TODAY);
      expect(history.snapshots.length + history.editions.length + history.unsupported).toBe(MAX_SNAPSHOTS + MAX_EDITIONS);
      expect(assemble(padded, registry, TODAY).certification.level).toBe('registered');
      expect(publicPassport(padded, registry, TODAY).events.length).toBeGreaterThan(0);
      issueEdition(recordSnapshot(padded, registry, { now: NOW, id: 'again', reason: 'x' }), registry, { now: NOW, reason: 'x' });
    }
    // A wide margin: this takes well under a second on a slow machine, and took minutes before.
    expect(Date.now() - started).toBeLessThan(10000);
  });
});

describe('example and house cards', () => {
  it('stamps the brief’s specimens as illustrative and gives the GT-R NISMO its values', () => {
    const card = exampleCard(EXAMPLES[0], TODAY);
    expect(card.attributes.map((a) => a.value)).toEqual([950, 920, 880, 880, 650, 700, 500]);
    expect(card.powerRating).toBe(783);
    expect(card.illustrative).toBe(true);
    expect(card.quality).toBe('illustrative');
    expect(card.attributes.every((a) => a.basis === 'illustrative')).toBe(true);
    expect(card.micarId).toBe('EXAMPLE');
    const civicCard = exampleCard(EXAMPLES[1], TODAY);
    expect(civicCard.powerRating as number).toBeLessThan(783);
    expect(civicCard.illustrative).toBe(true);
  });

  it('builds a house card from a catalogue entry’s factory figures and labels it as reference data', () => {
    for (const entry of CATALOGUE) {
      const card = catalogueCard(entry, TODAY);
      expect(card.illustrative, entry.id).toBe(false);
      expect(card.quality, entry.id).toBe('reference');
      expect(card.level).toBe('registered');
      expect(card.grade.slabbed).toBe(false);
      expect(card.mods).toEqual([]);
      expect(card.serial).toBe(`HOUSE · ${entry.id}`);
    }
    const gtr = catalogueCard(CATALOGUE.filter((e) => e.id === '2024-nissan-gt-r-nismo')[0], TODAY);
    expect(gtr.attributes.map((a) => a.value)).toEqual([950, 920, 880, 880, 650, 700, 500]);
    expect(gtr.powerRating).toBe(783);
  });

  it('counts a house card’s build number only when the entry is reference data, not a placeholder', () => {
    const entry = CATALOGUE[0];
    const one = { ...entry.spec, productionUnits: { value: 1, source: { kind: 'reference' as const } } };
    expect(catalogueCard({ ...entry, spec: one }, TODAY).rarity.tier).toBe('one-of-one');
    expect(catalogueCard({ ...entry, status: 'illustrative', spec: one }, TODAY).rarity.tier).toBe('common');
  });
});

describe('the card’s picture', () => {
  it('is the newest exterior photograph, and never a picture of something else', () => {
    let p = add(parked(), { type: 'photo', subject: 'interior', date: '2026-02-01', attachments: [file('photo')] });
    p = add(p, { type: 'photo', subject: 'damage', date: '2026-02-02', attachments: [file('photo')] });
    expect(assemble(p, EMPTY_REGISTRY, TODAY).card.photoAttachmentId).toBeNull();
    p = add(p, { id: 'outside', type: 'photo', subject: 'exterior', date: '2026-02-03', attachments: [{ ...file('photo'), id: 'front' }, file('photo')] });
    p = add(p, { type: 'photo', subject: 'engine-bay', date: '2026-02-04', attachments: [file('photo')] });
    expect(assemble(p, EMPTY_REGISTRY, TODAY).card.photoAttachmentId).toBe('front');
  });
});
