import { describe, expect, it } from 'vitest';
import { EDITION_NAMES, RARITY_THRESHOLDS, SCARCITY_UNBACKED, assemble, buildNumberCounts, catalogueCard, exampleCard, finishOf, issueEdition, rarityOf, recordSnapshot } from './cards';
import type { RarityInput } from './cards';
import { CATALOGUE, EXAMPLES } from './database';
import { micarIdFromBytes } from './identity';
import { addEvent, createPassport, updateSpec } from './passport';
import { emptySpec } from './specs';
import { ATTRIBUTE_KEYS, RARITY_TIERS } from './types';
import type { Attachment, Passport, Sourced, VehicleSpec, VerifierRegistry } from './types';
import { EMPTY_REGISTRY, recordAttestation } from './verification';

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

const rarity = (over: Partial<RarityInput> = {}) => rarityOf({ productionUnits: null, modelYear: 2024, asOf: TODAY, level: 'registered', originality: 0, condition: 0, oneOfOneAttested: false, ...over });

describe('rarity', () => {
  it('uses the seven names of the brief, in order', () => {
    expect([...RARITY_TIERS]).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one-of-one']);
    expect(RARITY_THRESHOLDS.map(([, from]) => from)).toEqual([0, 10, 25, 40, 55, 70]);
  });

  it('takes no attribute and no rating, so performance cannot move it', () => {
    // The input type has no field for a score: this is the whole list of what rarity may read.
    const keys: Record<keyof RarityInput, true> = { productionUnits: true, specificationAttested: true, modelYear: true, asOf: true, level: true, originality: true, condition: true, oneOfOneAttested: true };
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

  it('does not count a build number the owner typed in, or anyone could type a 1', () => {
    const typed = (value: number, kind: 'owner' | 'illustrative' = 'owner') => ({ value, source: { kind } });
    for (const kind of ['owner', 'illustrative'] as const) {
      const one = rarity({ productionUnits: typed(1, kind) });
      expect(one.tier).toBe('common');
      expect(one.score).toBe(0);
      expect(one.factors[0]).toMatchObject({ id: 'scarcity', points: 0, detail: SCARCITY_UNBACKED });
      expect(buildNumberCounts(typed(1, kind))).toBe(false);
    }
    expect(rarity({ productionUnits: typed(60) }).factors[0].points).toBe(0);
    // A published source counts, and so does a verifier's attestation of the specification the figure is part of.
    for (const kind of ['manufacturer', 'agency', 'test', 'reference'] as const) expect(rarity({ productionUnits: { value: 60, source: { kind } } }).factors[0].points).toBe(40);
    expect(rarity({ productionUnits: typed(60), specificationAttested: true }).factors[0]).toMatchObject({ points: 40, detail: '60 built' });
    expect(rarity({ productionUnits: typed(1), specificationAttested: true }).tier).toBe('one-of-one');
    expect(buildNumberCounts(null, true)).toBe(false);
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
    expect(card.quality).toBe('reference');
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

  it('marks the data verified only on a verifier’s word', () => {
    const p = documented();
    expect(assemble(p, REGISTRY, TODAY).card.quality).toBe('reference');
    const attested = ok(recordAttestation(p, { id: id(), verifierId: 'inspector-ann', scope: 'specification', date: '2026-11-01', inPerson: false, conditionScore: null, systems: null, mileage: null, events: [], note: '', signature: null }, REGISTRY, { now: NOW, eventId: id() }));
    expect(assemble(attested, REGISTRY, TODAY).card.quality).toBe('verified');
    expect(assemble(attested, EMPTY_REGISTRY, TODAY).card.quality).toBe('reference');
    expect(assemble(p, REGISTRY, TODAY).specificationAttested).toBe(false);
    expect(assemble(attested, REGISTRY, TODAY).specificationAttested).toBe(true);
    // The attestation was for the specification as it stood. Raise a figure afterwards and it no longer vouches for it.
    const tuned = ok(updateSpec(attested, civic({ horsepower: s(900) }), { by: OWNER }));
    expect(assemble(tuned, REGISTRY, TODAY).card.quality).toBe('reference');
    expect(assemble(tuned, REGISTRY, TODAY).specificationAttested).toBe(false);
  });

  it('gives a parked car no rarity for a build number its owner typed', () => {
    const typed = parked(civic({ productionUnits: { value: 1, source: { kind: 'owner' } } }));
    expect(assemble(typed, REGISTRY, TODAY).rarity).toMatchObject({ tier: 'common', score: 0 });
    const published = parked(civic({ productionUnits: s(1) }));
    expect(assemble(published, REGISTRY, TODAY).rarity.tier).toBe('one-of-one');
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
});
