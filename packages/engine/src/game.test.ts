import { describe, expect, it } from 'vitest';
import {
  EXCLUSION_REASONS, LUCK_SPREAD, RACE_CLASSES, RACE_MODE_RULES, SERIES_POINTS, SETUP_BUDGET, SETUP_CARDS, SETUP_REFUSALS,
  checkSetup, entrantFromLayer, entrantWithSetup, luckOf, pickRivals, race, raceClassOf, series, terrainFactor,
} from './game';
import { baseStats, powerRating } from './normalize';
import { ATTRIBUTE_KEYS, MOD_CATEGORIES, RACE_MODES } from './types';
import type { Attributes, RaceEntrant, Source, Sourced, VehicleSpec } from './types';

const ref: Source = { kind: 'reference', name: 'test fixture', asOf: '2026-11-10' };
const s = <T>(value: T): Sourced<T> => ({ value, source: ref });

const blank = (bodyClass: VehicleSpec['identity']['bodyClass'], model: string): VehicleSpec => ({
  identity: { year: 2024, make: 'Test', model, trim: '', bodyClass },
  engine: null, powertrain: null, induction: null, displacementL: null, cylinders: null, horsepower: null, torqueLbFt: null,
  transmission: null, transmissionType: null, drivetrain: null, curbWeightLb: null, zeroToSixtySec: null, topSpeedMph: null,
  topSpeedGoverned: null, combinedMpg: null, cityMpg: null, highwayMpg: null, evRangeMiles: null, lateralGripG: null,
  braking60to0Ft: null, braking70to0Ft: null, groundClearanceIn: null, construction: null, suspension: null, suspensionGrade: null,
  brakes: null, brakeGrade: null, warrantyPowertrainMiles: null, warrantyPowertrainYears: null, productionUnits: null,
});

const gtrSpec: VehicleSpec = {
  ...blank('sports', 'GT-R'), powertrain: s('gasoline'), induction: s('twin-turbo'), displacementL: s(3.8), cylinders: s(6), horsepower: s(600), torqueLbFt: s(481),
  transmissionType: s('dual-clutch'), drivetrain: s('AWD'), curbWeightLb: s(3867), zeroToSixtySec: s(2.9), topSpeedMph: s(196), combinedMpg: s(18),
  lateralGripG: s(1.02), brakeGrade: s('carbon-ceramic'), warrantyPowertrainMiles: s(60000),
};
const civicSpec: VehicleSpec = {
  ...blank('sedan', 'Civic'), powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), cylinders: s(4), horsepower: s(158), torqueLbFt: s(138),
  transmissionType: s('cvt'), drivetrain: s('FWD'), curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), groundClearanceIn: s(5.3), warrantyPowertrainMiles: s(60000),
};
const truckSpec: VehicleSpec = {
  ...blank('pickup', 'Truck'), powertrain: s('gasoline'), induction: s('natural'), displacementL: s(3.5), cylinders: s(6), horsepower: s(278), torqueLbFt: s(265),
  transmissionType: s('automatic'), drivetrain: s('4WD'), curbWeightLb: s(4445), zeroToSixtySec: s(7.7), topSpeedMph: s(113), combinedMpg: s(20),
  groundClearanceIn: s(9.4), construction: s('body-on-frame'), warrantyPowertrainMiles: s(60000),
};
const evSpec: VehicleSpec = {
  ...blank('sedan', 'Volt'), powertrain: s('electric'), transmissionType: s('single-speed'), horsepower: s(271), torqueLbFt: s(310), drivetrain: s('RWD'),
  curbWeightLb: s(3880), zeroToSixtySec: s(5.8), topSpeedMph: s(125), combinedMpg: s(132), warrantyPowertrainMiles: s(100000),
};

const entry = (id: string, spec: VehicleSpec, basis: RaceEntrant['basis'] = 'base', trusted = true): RaceEntrant => entrantFromLayer({ id, name: id, spec, layer: baseStats(spec), basis, trusted });
const gtr = entry('gtr', gtrSpec), civic = entry('civic', civicSpec), truck = entry('truck', truckSpec), ev = entry('ev', evSpec);
const field = [gtr, civic, truck, ev];

const flat = (id: string, value: number, extra: Partial<RaceEntrant> = {}): RaceEntrant => {
  const attributes = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) attributes[k] = value;
  return { id, name: id, attributes, powerRating: powerRating(attributes), bodyClass: 'sedan', drivetrain: 'FWD', groundClearanceIn: null, basis: 'base', trusted: true, ...extra };
};

describe('the modes', () => {
  it('weigh only the attributes the brief names for each, and each mode adds up to 1', () => {
    expect(Object.keys(RACE_MODE_RULES.drag.weights).sort()).toEqual(['acceleration', 'power', 'speed']);
    expect(Object.keys(RACE_MODE_RULES.circuit.weights).sort()).toEqual(['acceleration', 'handling', 'speed']);
    expect(Object.keys(RACE_MODE_RULES.endurance.weights).sort()).toEqual(['durability', 'efficiency', 'reliability']);
    expect(Object.keys(RACE_MODE_RULES.economy.weights).sort()).toEqual(['efficiency', 'reliability']);
    expect(Object.keys(RACE_MODE_RULES.offroad.weights).sort()).toEqual(['durability', 'handling', 'reliability']);
    for (const mode of RACE_MODES) {
      const total = Object.values(RACE_MODE_RULES[mode].weights).reduce((a, b) => a + (b as number), 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('give every kind of car somewhere to win without changing its scores', () => {
    // Over many seeds luck evens out: count wins.
    const wins: Record<string, Record<string, number>> = {};
    for (const mode of RACE_MODES) {
      wins[mode] = {};
      for (let seed = 1; seed <= 40; seed++) {
        const w = race(mode, field, seed).winnerId as string;
        wins[mode][w] = (wins[mode][w] ?? 0) + 1;
      }
    }
    expect(wins.drag.gtr).toBe(40);
    expect(wins.circuit.gtr).toBe(40);
    expect(wins.economy.gtr ?? 0).toBe(0);
    expect((wins.economy.ev ?? 0) + (wins.economy.civic ?? 0)).toBe(40);
    expect(wins.offroad.truck).toBe(40);
    expect(wins.endurance.gtr ?? 0).toBe(0);
    // The attributes themselves were never touched.
    expect(gtr.attributes.power).toBe(950);
  });
});

describe('a race', () => {
  it('is decided by the entrants and the seed and nothing else', () => {
    const a = race('circuit', field, 7);
    const b = race('circuit', field, 7);
    expect(a).toEqual(b);
    expect(race('circuit', field.slice().reverse(), 7)).toEqual(a);
    expect(race('circuit', [truck, ev, gtr, civic], 7)).toEqual(a);
  });

  it('keeps luck inside its spread and independent of who else is entered', () => {
    for (let seed = 0; seed < 200; seed++) {
      const l = luckOf(seed, 'drag', 'gtr');
      expect(l).toBeGreaterThanOrEqual(1 - LUCK_SPREAD);
      expect(l).toBeLessThanOrEqual(1 + LUCK_SPREAD);
    }
    const alone = race('drag', [gtr, civic], 3).rows.filter((r) => r.id === 'gtr')[0];
    const crowd = race('drag', field, 3).rows.filter((r) => r.id === 'gtr')[0];
    expect(alone.luck).toBe(crowd.luck);
    expect(alone.score).toBe(crowd.score);
  });

  it('shows where the score came from', () => {
    const row = race('drag', [gtr, civic], 1).rows[0];
    expect(row.id).toBe('gtr');
    expect(row.contributions).toEqual({ power: 332.5, speed: 184, acceleration: 396 });
    expect(row.rawScore).toBe(912.5);
    expect(row.terrain).toBe(1);
    expect(row.score).toBe(Math.round(912.5 * row.luck * 10) / 10);
    expect(row.position).toBe(1);
  });

  it('breaks an exact tie the same way every time', () => {
    const a = flat('aaa', 500), b = flat('bbb', 500);
    const first = race('endurance', [a, b], 11);
    expect(race('endurance', [b, a], 11)).toEqual(first);
    expect(first.rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('leaves out an entrant with no rating for an attribute the mode needs, and says why', () => {
    const noEconomy = { ...civic, id: 'noeco', attributes: { ...civic.attributes, efficiency: null } };
    const result = race('economy', [noEconomy, gtr, ev], 5);
    expect(result.excluded).toEqual([{ id: 'noeco', name: 'civic', reason: EXCLUSION_REASONS.missing.efficiency }]);
    expect(result.rows.map((r) => r.id).sort()).toEqual(['ev', 'gtr']);
    // The same car can still race where efficiency does not count.
    expect(race('drag', [noEconomy, gtr], 5).excluded).toEqual([]);
  });

  it('has no winner with fewer than two starters', () => {
    const one = race('drag', [gtr], 1);
    expect(one.winnerId).toBeNull();
    expect(one.margin).toBe(0);
    expect(one.rows).toHaveLength(1);
    expect(race('drag', [], 1).rows).toEqual([]);
  });

  it('refuses the same entrant twice', () => {
    const result = race('drag', [gtr, gtr, civic], 1);
    expect(result.rows).toHaveLength(2);
    expect(result.excluded).toEqual([{ id: 'gtr', name: 'gtr', reason: EXCLUSION_REASONS.twice }]);
  });
});

describe('ranked play', () => {
  it('takes only base and competition stats', () => {
    const declared = entry('declared', gtrSpec, 'vehicle');
    const setup = entry('setup', gtrSpec, 'setup');
    const verified = entry('verified', gtrSpec, 'competition');
    const result = race('drag', [declared, setup, verified, civic], 2, { ranked: true });
    expect(result.rows.map((r) => r.id).sort()).toEqual(['civic', 'verified']);
    expect(result.excluded.map((e) => e.reason)).toEqual([EXCLUSION_REASONS.ranked, EXCLUSION_REASONS.ranked]);
    expect(race('drag', [declared, setup, verified, civic], 2).rows).toHaveLength(4);
  });

  it('leaves out a car whose specification is only its owner’s word, however it is entered', () => {
    // 5,000 typed-in horsepower would win any drag race. Ranked play never lets it start.
    const typed = entry('typed', { ...gtrSpec, horsepower: s(5000) }, 'base', false);
    const result = race('drag', [typed, gtr, civic], 3, { ranked: true });
    expect(result.rows.map((r) => r.id).sort()).toEqual(['civic', 'gtr']);
    expect(result.excluded).toEqual([{ id: 'typed', name: 'typed', reason: EXCLUSION_REASONS.untrusted }]);
    // Free play takes anyone.
    expect(race('drag', [typed, gtr, civic], 3).winnerId).toBe('typed');
    // An entry is untrusted unless the host says otherwise.
    expect(entrantFromLayer({ id: 'x', name: 'x', spec: gtrSpec, layer: baseStats(gtrSpec), basis: 'base' }).trusted).toBe(false);
    const withSetup = entrantWithSetup({ id: 'y', name: 'y', spec: gtrSpec, cardIds: [] });
    expect(withSetup.ok && withSetup.value.trusted).toBe(false);
    const whole = series([typed, gtr, civic], 3, { ranked: true });
    expect(whole.standings.map((r) => r.id).sort()).toEqual(['civic', 'gtr']);
  });
});

describe('off-road', () => {
  it('rewards driven wheels and clearance, which are real configuration', () => {
    expect(terrainFactor('drag', truck)).toBe(1);
    expect(terrainFactor('offroad', truck)).toBeCloseTo(0.976, 3);
    expect(terrainFactor('offroad', civic)).toBeCloseTo(0.68 * 0.812, 3);
    expect(terrainFactor('offroad', { ...civic, groundClearanceIn: null })).toBeCloseTo(0.68 * 0.84, 3);
    expect(terrainFactor('offroad', { ...civic, drivetrain: null })).toBeCloseTo(0.8 * 0.812, 3);
    expect(terrainFactor('offroad', { ...truck, groundClearanceIn: 30 })).toBe(1.05);
  });

  it('lets a truck beat a supercar on dirt though the supercar handles better', () => {
    expect(gtr.attributes.handling as number).toBeGreaterThan(truck.attributes.handling as number);
    const result = race('offroad', [gtr, truck], 9);
    expect(result.winnerId).toBe('truck');
  });
});

describe('classes and rivals', () => {
  it('sorts Power Ratings into classes', () => {
    expect(raceClassOf(null)).toBeNull();
    expect(raceClassOf(0)).toBe('D');
    expect(raceClassOf(449)).toBe('D');
    expect(raceClassOf(450)).toBe('C');
    expect(raceClassOf(783)).toBe('S');
    expect(raceClassOf(850)).toBe('X');
    expect(RACE_CLASSES.map((c) => c.min)).toEqual([0, 450, 550, 650, 750, 850]);
  });

  it('picks rivals of the same class first, never the player, the same way for the same seed', () => {
    const pool = [flat('a', 600), flat('b', 610), flat('c', 620), flat('d', 900), flat('e', 300), flat('me', 605)];
    const me = flat('me', 605);
    const picked = pickRivals(me, pool, 2, 4);
    expect(picked).toHaveLength(2);
    expect(picked.every((p) => ['a', 'b', 'c'].indexOf(p.id) !== -1)).toBe(true);
    expect(pickRivals(me, pool.slice().reverse(), 2, 4)).toEqual(picked);
    // When the class is too thin, the nearest by rating fill in.
    const more = pickRivals(me, pool, 5, 4);
    expect(more.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(pickRivals(me, [me], 3, 1)).toEqual([]);
  });
});

describe('a series', () => {
  it('runs every mode once and gives points by place', () => {
    const result = series(field, 100);
    expect(result.races.map((r) => r.mode)).toEqual([...RACE_MODES]);
    expect(result.races.map((r) => r.seed)).toEqual([100, 101, 102, 103, 104]);
    const total = result.standings.reduce((sum, row) => sum + row.points, 0);
    expect(total).toBe(5 * (SERIES_POINTS[0] + SERIES_POINTS[1] + SERIES_POINTS[2] + SERIES_POINTS[3]));
    expect(result.standings[0].id).toBe(result.championId);
    expect(series(field.slice().reverse(), 100)).toEqual(result);
    expect(result.standings.reduce((sum, row) => sum + row.wins, 0)).toBe(5);
  });

  it('has no champion when no race could be decided', () => {
    expect(series([gtr], 1).championId).toBeNull();
  });
});

describe('setup cards', () => {
  it('are the card face of the modification catalogue: one per category and tier, costing its tier', () => {
    expect(SETUP_CARDS).toHaveLength(MOD_CATEGORIES.length * 3);
    expect(SETUP_CARDS.filter((c) => c.category === 'turbo').map((c) => [c.id, c.cost])).toEqual([['turbo:1', 1], ['turbo:2', 2], ['turbo:3', 3]]);
    expect(new Set(SETUP_CARDS.map((c) => c.id)).size).toBe(SETUP_CARDS.length);
  });

  it('refuses an unknown card, two cards in one category and a setup over budget', () => {
    expect(checkSetup(civicSpec, ['nope:1'])).toEqual({ ok: false, reason: SETUP_REFUSALS.unknown });
    expect(checkSetup(civicSpec, ['turbo:1', 'turbo:2'])).toEqual({ ok: false, reason: SETUP_REFUSALS.category });
    expect(checkSetup(civicSpec, ['turbo:3', 'engine:3', 'ecu:1'])).toEqual({ ok: false, reason: SETUP_REFUSALS.budget });
    expect(SETUP_BUDGET).toBe(6);
    expect(checkSetup(civicSpec, ['turbo:3', 'engine:3']).ok).toBe(true);
    expect(checkSetup(civicSpec, []).ok).toBe(true);
  });

  it('refuses what the vehicle cannot take', () => {
    expect(checkSetup(evSpec, ['turbo:1'])).toEqual({ ok: false, reason: SETUP_REFUSALS.electric });
    expect(checkSetup(civicSpec, ['turbo:1', 'supercharger:1'])).toEqual({ ok: false, reason: SETUP_REFUSALS.together });
    expect(checkSetup(civicSpec, ['tires:1', 'offroad:1'])).toEqual({ ok: false, reason: SETUP_REFUSALS.together });
    expect(checkSetup(evSpec, ['tires:2', 'brakes:1']).ok).toBe(true);
  });

  it('changes the entry through the modification engine, trade-offs included, and marks it as a setup', () => {
    const stock = entry('civic', civicSpec);
    const built = entrantWithSetup({ id: 'civic', name: 'civic', spec: civicSpec, cardIds: ['turbo:2'] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.basis).toBe('setup');
    expect(built.value.attributes.power as number).toBeGreaterThan(stock.attributes.power as number);
    expect(built.value.attributes.acceleration as number).toBeGreaterThan(stock.attributes.acceleration as number);
    expect(built.value.attributes.reliability as number).toBeLessThan(stock.attributes.reliability as number);
    expect(built.value.attributes.efficiency as number).toBeLessThan(stock.attributes.efficiency as number);
    // The factory specification is untouched.
    expect(civicSpec.horsepower).toEqual(s(158));
  });

  it('makes a setup card matter where it should: an off-road kit helps on dirt and costs on tarmac', () => {
    const stock = entry('truck', truckSpec);
    const lifted = entrantWithSetup({ id: 'truck', name: 'truck', spec: truckSpec, cardIds: ['offroad:3'] });
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(terrainFactor('offroad', lifted.value)).toBeGreaterThan(terrainFactor('offroad', stock));
    expect(lifted.value.attributes.durability as number).toBeGreaterThan(stock.attributes.durability as number);
    expect(lifted.value.attributes.handling as number).toBeLessThan(stock.attributes.handling as number);
    expect(lifted.value.attributes.efficiency as number).toBeLessThan(stock.attributes.efficiency as number);
  });
});

describe('separation', () => {
  it('builds an entry from stats and configuration only: no grade, no rarity, no value', () => {
    expect(Object.keys(gtr).sort()).toEqual(['attributes', 'basis', 'bodyClass', 'drivetrain', 'groundClearanceIn', 'id', 'name', 'powerRating', 'trusted']);
  });

  it('imports nothing that knows a price, anywhere in the package', () => {
    const sources = import.meta.glob(['./*.ts', './data/*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
        // Only relative imports inside the package are allowed, and none of them may be a pricing module.
        if (!/^\.\.?\//.test(m[1]) || /valuation|valuate|price|market|apps\//i.test(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
