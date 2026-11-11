import { describe, expect, it } from 'vitest';
import { INSTALL_FACTOR, MODS, MOD_TIER_NAMES, UPKEEP_FACTOR, applyModifications, modLabel, originalityCost, resolveModifications } from './modifications';
import type { ModEffect } from './modifications';
import { scoreSpec } from './normalize';
import { ATTRIBUTE_KEYS, MOD_CATEGORIES } from './types';
import type { ActiveModification, AttributeKey, InstallQuality, ModCategory, ModTier, Source, Sourced, VehicleSpec } from './types';

const ref: Source = { kind: 'reference', name: 'test fixture', asOf: '2026-11-10' };
const owner: Source = { kind: 'owner', asOf: '2026-11-10' };
const s = <T>(value: T, source: Source = ref): Sourced<T> => ({ value, source });

const blank = (bodyClass: VehicleSpec['identity']['bodyClass'], model = 'Test'): VehicleSpec => ({
  identity: { year: 2024, make: 'Test', model, trim: '', bodyClass },
  engine: null, powertrain: null, induction: null, displacementL: null, cylinders: null, horsepower: null, torqueLbFt: null,
  transmission: null, transmissionType: null, drivetrain: null, curbWeightLb: null, zeroToSixtySec: null, topSpeedMph: null,
  topSpeedGoverned: null, combinedMpg: null, cityMpg: null, highwayMpg: null, evRangeMiles: null, lateralGripG: null,
  braking60to0Ft: null, braking70to0Ft: null, groundClearanceIn: null, construction: null, suspension: null, suspensionGrade: null,
  brakes: null, brakeGrade: null, warrantyPowertrainMiles: null, warrantyPowertrainYears: null, productionUnits: null,
});

// The reference figures gathered for the 2024 Nissan GT-R NISMO, the calibration vehicle. Its top speed is what the power allows.
const gtr: VehicleSpec = {
  ...blank('sports', 'GT-R'),
  powertrain: s('gasoline'), induction: s('twin-turbo'), displacementL: s(3.8), cylinders: s(6), horsepower: s(600), torqueLbFt: s(481),
  transmissionType: s('dual-clutch'), drivetrain: s('AWD'), curbWeightLb: s(3867), zeroToSixtySec: s(2.9), topSpeedMph: s(196), topSpeedGoverned: s(false),
  combinedMpg: s(18), cityMpg: s(16), highwayMpg: s(22), lateralGripG: s(1.02), construction: s('unibody'), brakeGrade: s('carbon-ceramic'),
  suspensionGrade: s('sport'), warrantyPowertrainMiles: s(60000), warrantyPowertrainYears: s(5),
};

// The reference figures gathered for the 2024 Honda Civic Sedan LX: no top speed and no skidpad figure were found.
const civic: VehicleSpec = {
  ...blank('sedan', 'Civic'),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(2), cylinders: s(4), horsepower: s(158), torqueLbFt: s(138),
  transmissionType: s('cvt'), drivetrain: s('FWD'), curbWeightLb: s(2877), zeroToSixtySec: s(9.7), combinedMpg: s(35), cityMpg: s(31),
  highwayMpg: s(40), groundClearanceIn: s(5.3), construction: s('unibody'), suspensionGrade: s('standard'), brakeGrade: s('standard'),
  warrantyPowertrainMiles: s(60000), warrantyPowertrainYears: s(5),
};

// Figures typical of a rear-drive electric sedan: one motor, one gear, a top speed held by the limiter.
const ev: VehicleSpec = {
  ...blank('sedan', 'Electric Sedan'),
  powertrain: s('electric'), horsepower: s(271), torqueLbFt: s(310), transmissionType: s('single-speed'), drivetrain: s('RWD'), curbWeightLb: s(3862),
  zeroToSixtySec: s(5.8), topSpeedMph: s(125), topSpeedGoverned: s(true), combinedMpg: s(132), cityMpg: s(138), highwayMpg: s(126), evRangeMiles: s(272),
  groundClearanceIn: s(5.5), construction: s('unibody'), suspensionGrade: s('standard'), warrantyPowertrainMiles: s(100000), warrantyPowertrainYears: s(8),
};

// Figures typical of a full-size 4x4 pickup with a naturally aspirated V8 on a separate frame. No top speed and no skidpad figure on file.
const truck: VehicleSpec = {
  ...blank('pickup', 'Pickup'),
  powertrain: s('gasoline'), induction: s('natural'), displacementL: s(5), cylinders: s(8), horsepower: s(400), torqueLbFt: s(410),
  transmissionType: s('automatic'), drivetrain: s('4WD'), curbWeightLb: s(4941), zeroToSixtySec: s(6.1), combinedMpg: s(19), cityMpg: s(16),
  highwayMpg: s(24), groundClearanceIn: s(9.4), construction: s('body-on-frame'), suspensionGrade: s('offroad'), warrantyPowertrainMiles: s(60000),
  warrantyPowertrainYears: s(5),
};

// Figures typical of a turbocharged six-cylinder sport sedan whose top speed is an electronic limit, not what the power allows.
const sportSedan: VehicleSpec = {
  ...blank('sedan', 'Sport Sedan'),
  powertrain: s('gasoline'), induction: s('turbo'), displacementL: s(3), cylinders: s(6), horsepower: s(382), torqueLbFt: s(369),
  transmissionType: s('automatic'), drivetrain: s('AWD'), curbWeightLb: s(3990), zeroToSixtySec: s(4.1), topSpeedMph: s(155), topSpeedGoverned: s(true),
  combinedMpg: s(26), cityMpg: s(23), highwayMpg: s(32), lateralGripG: s(0.93), groundClearanceIn: s(5.3), construction: s('unibody'),
  suspensionGrade: s('sport'), brakeGrade: s('performance'), warrantyPowertrainMiles: s(50000), warrantyPowertrainYears: s(4),
};

// One modification on record. Fitted by the owner and newly installed unless a test says otherwise, so both factors are 1.
const mod = (category: ModCategory, tier: ModTier = 2, over: Partial<ActiveModification> = {}): ActiveModification => ({
  eventId: `ev-${category}`, category, tier, install: 'owner', evidence: 'declared', installedOn: '2025-03-01', installedAtMileage: null, upkeep: 'recent', ...over,
});

// The seven values of a specification after the modifications: the modified figures scored by scoreSpec with the adjustments.
const values = (spec: VehicleSpec, mods: readonly ActiveModification[]): Record<AttributeKey, number | null> => {
  const out = applyModifications(spec, mods);
  const scores = scoreSpec(out.spec, { adjust: out.adjust });
  return Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, scores[k].value])) as Record<AttributeKey, number | null>;
};

const NO_ADJUSTMENT = { gripG: 0, durabilityPoints: 0, reliabilityPoints: 0, sprintFactor: 1, topSpeedFactor: 1 };

// Freezes a fixture all the way down, so a function that tried to change it would throw.
const frozen = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as object)) frozen(inner);
    Object.freeze(value);
  }
  return value;
};

/* ------------------------------------------------------------------ the table ---- */

// The design's table, copied cell for cell from docs/superpowers/specs/2026-11-10-collectible-card-platform-design.md.
// Columns: category, name, horsepower x, torque x, weight x, economy x, 0-60 x, top speed x, clearance + in, grip + g,
// durability points, reliability points, originality. Three tiers to a cell: Street / Pro / Extreme.
const DESIGN_TABLE = [
  '| engine | Engine build | 1.08 / 1.16 / 1.25 | 1.06 / 1.12 / 1.20 | | 0.98 / 0.96 / 0.93 | | | | | −5 / −10 / −20 | −20 / −45 / −80 | 10 / 18 / 28 |',
  '| ecu | ECU tune | 1.05 / 1.09 / 1.13 | 1.05 / 1.10 / 1.15 | | 1 / 0.99 / 0.97 | | | | | 0 / −5 / −10 | −10 / −25 / −45 | 4 / 6 / 8 |',
  '| intake-exhaust | Intake and exhaust | 1.02 / 1.04 / 1.06 | 1.02 / 1.03 / 1.05 | 1 / 0.995 / 0.99 | | | | | | | 0 / −5 / −10 | 3 / 5 / 7 |',
  '| turbo | Turbocharger kit | 1.25 / 1.45 / 1.70 | 1.25 / 1.45 / 1.65 | 1.01 / 1.015 / 1.02 | 0.94 / 0.90 / 0.85 | | | | | −15 / −30 / −50 | −60 / −100 / −150 | 18 / 26 / 35 |',
  '| supercharger | Supercharger kit | 1.30 / 1.45 / 1.60 | 1.28 / 1.40 / 1.52 | 1.015 / 1.02 / 1.025 | 0.90 / 0.86 / 0.82 | | | | | −15 / −25 / −45 | −50 / −85 / −130 | 18 / 26 / 35 |',
  '| nitrous | Nitrous | 1.10 / 1.18 / 1.28 | 1.10 / 1.18 / 1.28 | 1.005 / 1.008 / 1.01 | | | | | | −5 / −10 / −20 | −30 / −60 / −100 | 6 / 9 / 12 |',
  '| transmission | Transmission and clutch | | | | | 0.98 / 0.96 / 0.94 | | | | 0 / 5 / 5 | 0 / −5 / −15 | 4 / 7 / 10 |',
  '| suspension | Suspension | | | | | | | −0.3 / −0.6 / −1.0 | 0.02 / 0.04 / 0.06 | −5 / −15 / −30 | | 5 / 8 / 12 |',
  '| tires | Performance tires | | | | 0.98 / 0.96 / 0.93 | 0.99 / 0.98 / 0.97 | | | 0.03 / 0.06 / 0.09 | −5 / −15 / −30 | | 2 / 3 / 4 |',
  '| brakes | Brakes | | | | | | | | 0.005 / 0.01 / 0.02 | 0 / 5 / 5 | | 2 / 4 / 6 |',
  '| weight | Weight reduction | | | 0.97 / 0.94 / 0.90 | | | | | | −10 / −25 / −45 | | 6 / 12 / 20 |',
  '| aero | Aero | | | 1.002 / 1.004 / 1.006 | 0.995 / 0.99 / 0.98 | | 0.99 / 0.98 / 0.96 | | 0.01 / 0.02 / 0.04 | | | 3 / 5 / 8 |',
  '| offroad | Off-road kit | | | 1.01 / 1.02 / 1.035 | 0.97 / 0.94 / 0.90 | 1.01 / 1.02 / 1.04 | 0.98 / 0.96 / 0.93 | 1 / 2 / 3.5 | −0.02 / −0.04 / −0.07 | 15 / 30 / 45 | 0 / −5 / −10 | 6 / 10 / 15 |',
  '| eco | Economy setup | 0.99 / 0.98 / 0.97 | | | 1.03 / 1.05 / 1.07 | 1.01 / 1.02 / 1.03 | | | −0.01 / −0.02 / −0.03 | | 0 / 5 / 5 | 2 / 3 / 4 |',
];
const COLUMNS = ['horsepower', 'torque', 'weight', 'economy', 'sprint', 'topSpeed', 'clearanceIn', 'gripG', 'durability', 'reliability', 'originality'] as const;
const NO_EFFECT: ModEffect = { horsepower: 1, torque: 1, weight: 1, economy: 1, sprint: 1, topSpeed: 1, clearanceIn: 0, gripG: 0, durability: 0, reliability: 0, originality: 0 };

// Reads the rows above. An empty cell is "no effect": 1 for a multiplier, 0 for an addition. The design writes minus as U+2212.
const DESIGN = DESIGN_TABLE.map((row) => {
  const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
  const tier = (index: number): ModEffect => {
    const effect = { ...NO_EFFECT };
    COLUMNS.forEach((column, at) => {
      const cell = cells[at + 2];
      if (cell !== '') effect[column] = Number(cell.split('/')[index].trim().replace('−', '-'));
    });
    return effect;
  };
  return { category: cells[0] as ModCategory, name: cells[1], tiers: [tier(0), tier(1), tier(2)] };
});

describe('the modification catalogue', () => {
  it('carries the design’s table number for number', () => {
    expect(DESIGN.map((row) => row.category)).toEqual([...MOD_CATEGORIES]);
    expect(Object.keys(MODS).sort()).toEqual([...MOD_CATEGORIES].sort());
    for (const row of DESIGN) {
      expect(MODS[row.category].category).toBe(row.category);
      expect(MODS[row.category].name).toBe(row.name);
      expect(MODS[row.category].tiers).toEqual(row.tiers);
    }
    // Two rows typed out by hand, so a slip in reading the table above could not hide a slip in the catalogue.
    expect(MODS.turbo.tiers[1]).toEqual({ horsepower: 1.45, torque: 1.45, weight: 1.015, economy: 0.9, sprint: 1, topSpeed: 1, clearanceIn: 0, gripG: 0, durability: -30, reliability: -100, originality: 26 });
    expect(MODS.offroad.tiers[2]).toEqual({ horsepower: 1, torque: 1, weight: 1.035, economy: 0.9, sprint: 1.04, topSpeed: 0.93, clearanceIn: 3.5, gripG: -0.07, durability: 45, reliability: -10, originality: 15 });
  });

  it('marks the six combustion modifications and the two groups where only one fitment counts', () => {
    const combustion = MOD_CATEGORIES.filter((category) => MODS[category].combustionOnly);
    expect(combustion).toEqual(['engine', 'ecu', 'intake-exhaust', 'turbo', 'supercharger', 'nitrous']);
    expect(MOD_CATEGORIES.filter((category) => MODS[category].group === 'induction')).toEqual(['turbo', 'supercharger']);
    expect(MOD_CATEGORIES.filter((category) => MODS[category].group === 'tires')).toEqual(['tires', 'offroad', 'eco']);
    expect(MOD_CATEGORIES.filter((category) => MODS[category].group === null)).toHaveLength(9);
  });

  it('labels a modification with its name and its tier', () => {
    expect(MOD_TIER_NAMES).toEqual(['Street', 'Pro', 'Extreme']);
    expect(modLabel('turbo', 2)).toBe('Turbocharger kit · Pro');
    expect(modLabel('ecu', 1)).toBe('ECU tune · Street');
    expect(modLabel('offroad', 3)).toBe('Off-road kit · Extreme');
  });

  it('has a sentence to print on every modification card', () => {
    for (const category of MOD_CATEGORIES) expect(MODS[category].summary).toMatch(/^[A-Z].{30,}\.$/);
    expect(new Set(MOD_CATEGORIES.map((category) => MODS[category].summary)).size).toBe(MOD_CATEGORIES.length);
  });
});

/* ------------------------------------------------------- which modifications count ---- */

describe('which modifications count', () => {
  it('counts a single modification and refuses nothing', () => {
    expect(resolveModifications(civic, [mod('turbo')])).toEqual({ applied: [mod('turbo')], refused: [] });
    expect(resolveModifications(civic, [])).toEqual({ applied: [], refused: [] });
  });

  it('keeps the latest of two installs in one category', () => {
    const first = mod('turbo', 1, { eventId: 'e1', installedOn: '2023-05-01' });
    const second = mod('turbo', 2, { eventId: 'e2', installedOn: '2025-02-01' });
    for (const list of [[first, second], [second, first]]) {
      expect(resolveModifications(civic, list)).toEqual({ applied: [second], refused: [{ eventId: 'e1', category: 'turbo', reason: 'replaced by a later fitment' }] });
    }
  });

  it('settles two installs on one day by the event id', () => {
    const a = mod('ecu', 1, { eventId: 'evt-0007' });
    const b = mod('ecu', 3, { eventId: 'evt-0012' });
    for (const list of [[a, b], [b, a]]) {
      expect(resolveModifications(civic, list)).toEqual({ applied: [b], refused: [{ eventId: 'evt-0007', category: 'ecu', reason: 'replaced by a later fitment' }] });
    }
  });

  it('refuses a combustion-only modification on an electric powertrain', () => {
    const combustion: ModCategory[] = ['engine', 'ecu', 'intake-exhaust', 'turbo', 'supercharger', 'nitrous'];
    for (const category of MOD_CATEGORIES) {
      const resolved = resolveModifications(ev, [mod(category)]);
      if (combustion.indexOf(category) >= 0) {
        expect(resolved).toEqual({ applied: [], refused: [{ eventId: `ev-${category}`, category, reason: 'not for an electric powertrain' }] });
      } else {
        expect(resolved).toEqual({ applied: [mod(category)], refused: [] });
      }
    }
  });

  it('gives every combustion modification on an electric car the same reason, superseded or not', () => {
    const early = mod('turbo', 1, { eventId: 'e1', installedOn: '2023-05-01' });
    const late = mod('supercharger', 2, { eventId: 'e2', installedOn: '2025-02-01' });
    expect(resolveModifications(ev, [late, early]).refused).toEqual([
      { eventId: 'e1', category: 'turbo', reason: 'not for an electric powertrain' },
      { eventId: 'e2', category: 'supercharger', reason: 'not for an electric powertrain' },
    ]);
  });

  it('lets a hybrid, a plug-in hybrid, a diesel and a car of unknown powertrain keep them', () => {
    for (const powertrain of [s('hybrid' as const), s('plug-in-hybrid' as const), s('diesel' as const), null]) {
      expect(resolveModifications({ ...civic, powertrain }, [mod('turbo'), mod('ecu')]).refused).toEqual([]);
    }
  });

  it('counts only the later of a turbocharger and a supercharger', () => {
    const turbo = (installedOn: string) => mod('turbo', 2, { installedOn });
    const blower = (installedOn: string) => mod('supercharger', 2, { installedOn });
    expect(resolveModifications(civic, [turbo('2024-01-10'), blower('2025-06-01')])).toEqual({
      applied: [blower('2025-06-01')], refused: [{ eventId: 'ev-turbo', category: 'turbo', reason: 'replaced by a later fitment' }],
    });
    expect(resolveModifications(civic, [turbo('2025-06-01'), blower('2024-01-10')])).toEqual({
      applied: [turbo('2025-06-01')], refused: [{ eventId: 'ev-supercharger', category: 'supercharger', reason: 'replaced by a later fitment' }],
    });
  });

  it('counts only the latest of performance tires, an off-road kit and an economy setup', () => {
    const tires = mod('tires', 2, { installedOn: '2023-04-01' });
    const offroad = mod('offroad', 1, { installedOn: '2024-04-01' });
    const eco = mod('eco', 3, { installedOn: '2025-04-01' });
    expect(resolveModifications(truck, [eco, tires, offroad])).toEqual({
      applied: [eco],
      refused: [
        { eventId: 'ev-tires', category: 'tires', reason: 'replaced by a later fitment' },
        { eventId: 'ev-offroad', category: 'offroad', reason: 'replaced by a later fitment' },
      ],
    });
    expect(resolveModifications(truck, [mod('eco', 3, { installedOn: '2022-04-01' }), tires, offroad]).applied).toEqual([offroad]);
  });

  it('refuses nothing else: one of every category leaves eleven fitted', () => {
    // All on one day, so the event ids decide: turbo over supercharger, tires over off-road kit and economy setup.
    const { applied, refused } = resolveModifications(civic, MOD_CATEGORIES.map((category) => mod(category)));
    expect(applied.map((m) => m.category)).toEqual(['aero', 'brakes', 'ecu', 'engine', 'intake-exhaust', 'nitrous', 'suspension', 'tires', 'transmission', 'turbo', 'weight']);
    expect(refused).toEqual([
      { eventId: 'ev-eco', category: 'eco', reason: 'replaced by a later fitment' },
      { eventId: 'ev-offroad', category: 'offroad', reason: 'replaced by a later fitment' },
      { eventId: 'ev-supercharger', category: 'supercharger', reason: 'replaced by a later fitment' },
    ]);
  });

  it('lists what counts in install order, whatever order the records arrive in', () => {
    const a = mod('brakes', 1, { installedOn: '2022-01-05' });
    const b = mod('aero', 2, { installedOn: '2023-08-20' });
    const c = mod('weight', 3, { installedOn: '2023-08-20' });
    const d = mod('ecu', 1, { installedOn: '2025-11-01' });
    for (const list of [[a, b, c, d], [d, c, b, a], [c, a, d, b]]) {
      expect(resolveModifications(civic, list).applied).toEqual([a, b, c, d]);
    }
  });

  it('hands back records of its own and leaves the caller’s alone', () => {
    const list = frozen([mod('turbo', 1, { installedOn: '2025-06-01' }), mod('supercharger', 2, { installedOn: '2024-01-10' }), mod('brakes', 3)]);
    const before = JSON.stringify(list);
    const { applied } = resolveModifications(frozen(civic), list);
    expect(JSON.stringify(list)).toBe(before);
    expect(applied).toEqual([list[2], list[0]]);
    expect(applied[0]).not.toBe(list[2]);
    expect(applied[1]).not.toBe(list[0]);
  });
});

/* ------------------------------------------------------------ the specification ---- */

describe('what a modification does to the specification', () => {
  it('does exactly what its row of the table says, tier by tier', () => {
    // The pickup has every figure the table can move on file and no skidpad figure, so each column can be read back alone.
    for (const row of DESIGN) {
      for (const tier of [1, 2, 3] as const) {
        const stated = row.tiers[tier - 1];
        const { spec, adjust } = applyModifications(truck, [mod(row.category, tier)]);
        const label = `${row.name}, tier ${tier}`;
        expect(spec.horsepower?.value, label).toBeCloseTo(400 * stated.horsepower, 9);
        expect(spec.torqueLbFt?.value, label).toBeCloseTo(410 * stated.torque, 9);
        expect(spec.curbWeightLb?.value, label).toBeCloseTo(4941 * stated.weight, 9);
        // Economy takes the tier's own multiplier, and 0.6% more for each 1% of weight removed (less for weight added).
        const economy = stated.economy * (1 + 0.6 * (1 - stated.weight));
        expect(spec.combinedMpg?.value, label).toBeCloseTo(19 * economy, 9);
        expect(spec.cityMpg?.value, label).toBeCloseTo(16 * economy, 9);
        expect(spec.highwayMpg?.value, label).toBeCloseTo(24 * economy, 9);
        expect(spec.groundClearanceIn?.value, label).toBeCloseTo(9.4 + stated.clearanceIn, 9);
        expect(adjust.sprintFactor, label).toBe(stated.sprint);
        expect(adjust.topSpeedFactor, label).toBe(stated.topSpeed);
        expect(adjust.gripG, label).toBe(stated.gripG);
        expect(adjust.durabilityPoints, label).toBe(stated.durability);
        expect(adjust.reliabilityPoints, label).toBe(stated.reliability);
        expect(originalityCost([mod(row.category, tier)]), label).toBe(stated.originality);
      }
    }
  });

  it('multiplies horsepower, torque, weight and economy by the tier’s multipliers', () => {
    const { spec } = applyModifications(civic, [mod('turbo', 2)]);
    expect(spec.horsepower?.value).toBeCloseTo(229.1, 9); // 158 x 1.45
    expect(spec.torqueLbFt?.value).toBeCloseTo(200.1, 9); // 138 x 1.45
    expect(spec.curbWeightLb?.value).toBeCloseTo(2920.155, 9); // 2877 x 1.015
    // The kit's own 0.90, and 1.5% more weight takes another 0.9%: 0.90 x 0.991 = 0.8919.
    expect(spec.combinedMpg?.value).toBeCloseTo(31.2165, 9);
    expect(spec.cityMpg?.value).toBeCloseTo(27.6489, 9);
    expect(spec.highwayMpg?.value).toBeCloseTo(35.676, 9);
  });

  it('multiplies together the multipliers of everything fitted', () => {
    const { spec } = applyModifications(civic, [mod('engine', 1), mod('ecu', 1), mod('intake-exhaust', 1)]);
    expect(spec.horsepower?.value).toBeCloseTo(182.75544, 9); // 158 x 1.08 x 1.05 x 1.02
    expect(spec.torqueLbFt?.value).toBeCloseTo(156.66588, 9); // 138 x 1.06 x 1.05 x 1.02
    expect(spec.combinedMpg?.value).toBeCloseTo(34.3, 9); // 35 x 0.98 x 1
  });

  it('gives back 0.6% of economy for each 1% of weight removed, and takes it for weight added', () => {
    const lighter = applyModifications(civic, [mod('weight', 3)]).spec;
    expect(lighter.curbWeightLb?.value).toBeCloseTo(2589.3, 9);
    expect(lighter.combinedMpg?.value).toBeCloseTo(37.1, 9); // 35 x 1.06
    expect(lighter.cityMpg?.value).toBeCloseTo(32.86, 9);
    expect(lighter.highwayMpg?.value).toBeCloseTo(42.4, 9);
    const heavier = applyModifications(truck, [mod('offroad', 3)]).spec;
    expect(heavier.curbWeightLb?.value).toBeCloseTo(5113.935, 9);
    expect(heavier.combinedMpg?.value).toBeCloseTo(16.7409, 9); // 19 x 0.90 x (1 - 0.6 x 0.035)
  });

  it('leaves economy to the tier’s own multiplier when no curb weight is on file to change', () => {
    const noWeight = { ...civic, curbWeightLb: null };
    expect(applyModifications(noWeight, [mod('weight', 3)]).spec.combinedMpg).toEqual(civic.combinedMpg);
    expect(applyModifications(noWeight, [mod('turbo', 2)]).spec.combinedMpg?.value).toBeCloseTo(31.5, 9); // 35 x 0.90
  });

  it('moves a 0-60 time on file with pounds per horsepower, to the power of 0.75', () => {
    // Turbo, Pro: 1.5% more weight over 45% more power leaves 0.7 of the pounds per horsepower.
    expect(applyModifications(civic, [mod('turbo', 2)]).spec.zeroToSixtySec?.value).toBeCloseTo(7.42327, 4);
    // Weight reduction, Extreme: 0.9 of the pounds on the same power.
    expect(applyModifications(gtr, [mod('weight', 3)]).spec.zeroToSixtySec?.value).toBeCloseTo(2.67966, 4);
  });

  it('never takes a 0-60 time on file below the estimate’s own floor, however many parts are stacked', () => {
    // Six Extreme power and weight parts used to give the calibration car a 1.12 s time: quicker than anything the
    // estimate itself would ever say, and quicker than the same car with no time on file.
    const stack = [mod('turbo', 3), mod('engine', 3), mod('ecu', 3), mod('nitrous', 3), mod('intake-exhaust', 3), mod('weight', 3)];
    const out = applyModifications(gtr, stack);
    expect(out.spec.zeroToSixtySec?.value).toBe(1.9);
    expect(scoreSpec(out.spec, { adjust: out.adjust, derived: out.changed }).acceleration).toMatchObject({ metric: 1.9, basis: 'modelled' });
    // The 0-60 multipliers of a transmission and tires stop at the same floor.
    const more = applyModifications(gtr, [...stack, mod('transmission', 3), mod('tires', 3)]);
    expect(scoreSpec(more.spec, { adjust: more.adjust, derived: more.changed }).acceleration.metric).toBe(1.9);
    // The same car with no time on file ends at the same place, so a time on file is never worth more than its estimate.
    const noTime = applyModifications({ ...gtr, zeroToSixtySec: null }, stack);
    expect(scoreSpec(noTime.spec, { adjust: noTime.adjust, derived: noTime.changed }).acceleration.metric).toBe(1.9);
    // A legal free-play setup (turbo and engine build, both Extreme) cannot go under it either.
    expect(applyModifications(gtr, [mod('turbo', 3), mod('engine', 3)]).spec.zeroToSixtySec?.value).toBe(1.9);
    // A car that was already quicker than the floor keeps its own time: parts neither slow it nor quicken it.
    const hyper = { ...gtr, zeroToSixtySec: s(1.7) };
    expect(applyModifications(hyper, stack).spec.zeroToSixtySec).toEqual(hyper.zeroToSixtySec);
    // Added weight still slows a time on file.
    expect(applyModifications(gtr, [mod('offroad', 3)]).spec.zeroToSixtySec?.value as number).toBeGreaterThan(2.9);
  });

  it('moves a 0-60 time on file only when horsepower and weight are both on file', () => {
    expect(applyModifications({ ...civic, curbWeightLb: null }, [mod('turbo', 2)]).spec.zeroToSixtySec).toEqual(civic.zeroToSixtySec);
    expect(applyModifications({ ...civic, horsepower: null }, [mod('weight', 3)]).spec.zeroToSixtySec).toEqual(civic.zeroToSixtySec);
  });

  it('scales an ungoverned top speed on file with the cube root of the power gain', () => {
    // Turbo, Street: 25% more power is 7.7% more top speed.
    expect(applyModifications(gtr, [mod('turbo', 1)]).spec.topSpeedMph?.value).toBeCloseTo(211.1346, 3);
    // Nobody said the figure is a limiter: it is treated as what the power allows.
    expect(applyModifications({ ...gtr, topSpeedGoverned: null }, [mod('turbo', 1)]).spec.topSpeedMph?.value).toBeCloseTo(211.1346, 3);
    // Less power is less top speed by the same rule: economy setup, Extreme, 3% less power.
    expect(applyModifications(gtr, [mod('eco', 3)]).spec.topSpeedMph?.value).toBeCloseTo(194.0201, 3);
  });

  it('does not raise a governed top speed with power', () => {
    const out = applyModifications(sportSedan, [mod('turbo', 1)]);
    expect(out.spec.horsepower?.value).toBeCloseTo(477.5, 9);
    expect(out.spec.topSpeedMph).toEqual(sportSedan.topSpeedMph);
    expect(out.spec.topSpeedGoverned).toEqual(sportSedan.topSpeedGoverned);
    const before = scoreSpec(sportSedan), after = scoreSpec(out.spec, { adjust: out.adjust });
    expect(after.power.value).toBe(857);
    expect(before.speed.value).toBe(750);
    expect(after.speed.value).toBe(750);
  });

  it('leaves a top speed alone when no horsepower is on file to compare', () => {
    expect(applyModifications({ ...gtr, horsepower: null }, [mod('turbo', 1)]).spec.topSpeedMph).toEqual(gtr.topSpeedMph);
  });

  it('adds the tiers’ inches to the ground clearance', () => {
    expect(applyModifications(truck, [mod('offroad', 3)]).spec.groundClearanceIn?.value).toBeCloseTo(12.9, 9);
    expect(applyModifications(civic, [mod('suspension', 3)]).spec.groundClearanceIn?.value).toBeCloseTo(4.3, 9);
    expect(applyModifications(truck, [mod('offroad', 2), mod('suspension', 1)]).spec.groundClearanceIn?.value).toBeCloseTo(11.1, 9);
  });

  it('marks a figure it changed as worked out, no longer its source’s own, and says which fields those are', () => {
    const mixed: VehicleSpec = { ...civic, horsepower: s(158, owner) };
    const { spec, changed } = applyModifications(mixed, [mod('turbo', 2), mod('suspension', 1)]);
    expect(spec.horsepower?.source).toEqual({ kind: 'owner', asOf: '2026-11-10', note: 'after modifications' });
    // Nobody published 200 lb-ft or 7.42 s for this car: the figures are the engine's, so they are not reference data any more.
    for (const field of ['torqueLbFt', 'curbWeightLb', 'combinedMpg', 'cityMpg', 'highwayMpg', 'zeroToSixtySec', 'groundClearanceIn'] as const) {
      expect(spec[field]?.source, field).toEqual({ kind: 'owner', name: 'test fixture', asOf: '2026-11-10', note: 'after modifications' });
    }
    expect([...changed].sort()).toEqual(['cityMpg', 'combinedMpg', 'curbWeightLb', 'groundClearanceIn', 'highwayMpg', 'horsepower', 'torqueLbFt', 'zeroToSixtySec']);
    // An illustrative figure stays illustrative: a modification does not make a placeholder into anyone's data.
    const placeholder: VehicleSpec = { ...civic, horsepower: s(158, { kind: 'illustrative' }) };
    expect(applyModifications(placeholder, [mod('ecu', 1)]).spec.horsepower?.source.kind).toBe('illustrative');
    // What it did not change comes through as it was.
    for (const field of ['powertrain', 'induction', 'displacementL', 'cylinders', 'transmissionType', 'drivetrain', 'construction', 'warrantyPowertrainMiles'] as const) {
      expect(spec[field], field).toEqual(mixed[field]);
    }
    expect(spec.identity).toEqual(mixed.identity);
  });

  it('marks the top speed it scaled', () => {
    const out = applyModifications(gtr, [mod('turbo', 1)]);
    expect(out.spec.topSpeedMph?.source).toEqual({ ...ref, kind: 'owner', note: 'after modifications' });
    expect(out.changed).toContain('topSpeedMph');
  });

  it('puts its mark in place of a note the source already had', () => {
    const noted: VehicleSpec = { ...civic, horsepower: s(158, { ...ref, note: 'dyno sheet, 2024' }) };
    expect(applyModifications(noted, [mod('ecu', 1)]).spec.horsepower?.source).toEqual({ ...ref, kind: 'owner', note: 'after modifications' });
  });

  it('leaves a figure unmarked when the tier does not move it', () => {
    // ECU tune, Street: economy x 1, no weight change, no clearance change.
    const { spec } = applyModifications(civic, [mod('ecu', 1)]);
    expect(spec.combinedMpg).toEqual(civic.combinedMpg);
    expect(spec.curbWeightLb).toEqual(civic.curbWeightLb);
    expect(spec.groundClearanceIn).toEqual(civic.groundClearanceIn);
    expect(spec.horsepower?.source.note).toBe('after modifications');
  });

  it('leaves a figure as it was rather than write something that is not a number', () => {
    // A record with a horsepower of nought has no pounds per horsepower and no power gain to speak of.
    const dead: VehicleSpec = { ...gtr, horsepower: s(0) };
    const { spec } = applyModifications(dead, [mod('turbo', 2), mod('weight', 3)]);
    expect(spec.horsepower).toEqual(dead.horsepower);
    expect(spec.zeroToSixtySec).toEqual(gtr.zeroToSixtySec);
    expect(spec.topSpeedMph).toEqual(gtr.topSpeedMph);
    // What can be computed still is: 3,867 lb x 1.015 for the kit x 0.90 for the weight taken out.
    expect(spec.curbWeightLb?.value).toBeCloseTo(3532.5045, 9);
  });

  it('never touches a null field: a missing figure stays missing', () => {
    const everything = MOD_CATEGORIES.map((category) => mod(category, 3));
    const empty = blank('sedan');
    const out = applyModifications(empty, everything);
    expect(out.applied).toHaveLength(11);
    expect(out.spec).toEqual(empty);
    // The Civic has no top speed and no skidpad figure on file, and none appears. The pickup the same.
    for (const subject of [civic, truck, ev, gtr]) {
      const after = applyModifications(subject, everything).spec;
      for (const field of Object.keys(subject) as (keyof VehicleSpec)[]) expect(after[field] === null, field).toBe(subject[field] === null);
    }
  });
});

/* ------------------------------------------------------------ the adjustments ---- */

describe('what a modification changes outside the specification', () => {
  it('is nothing at all when nothing is fitted', () => {
    const out = applyModifications(gtr, []);
    expect(out).toEqual({ spec: gtr, adjust: NO_ADJUSTMENT, changed: [], applied: [], refused: [] });
    expect(out.spec).not.toBe(gtr);
  });

  it('sends the tiers’ 0-60 multipliers to the sprint factor and leaves the time on file to power and weight', () => {
    const out = applyModifications(civic, [mod('transmission', 2), mod('tires', 1)]);
    expect(out.adjust.sprintFactor).toBeCloseTo(0.9504, 12); // 0.96 x 0.99
    expect(out.spec.zeroToSixtySec).toEqual(civic.zeroToSixtySec);
  });

  it('applies the sprint factor to an estimated time too', () => {
    const noTime: VehicleSpec = { ...civic, zeroToSixtySec: null };
    const out = applyModifications(noTime, [mod('transmission', 3)]);
    expect(out.spec.zeroToSixtySec).toBeNull();
    const before = scoreSpec(noTime).acceleration, after = scoreSpec(out.spec, { adjust: out.adjust }).acceleration;
    expect(after.basis).toBe('estimated');
    // The estimate is 9.8 s; 6% quicker is 9.21 s.
    expect(before.metric).toBe(9.8);
    expect(after.metric).toBe(9.21);
    expect(after.value as number).toBeGreaterThan(before.value as number);
  });

  it('sends the tiers’ top-speed multipliers to the top-speed factor', () => {
    expect(applyModifications(gtr, [mod('aero', 2)]).adjust.topSpeedFactor).toBe(0.98);
    expect(applyModifications(truck, [mod('aero', 2), mod('offroad', 1)]).adjust.topSpeedFactor).toBeCloseTo(0.9604, 12);
    // Drag holds back a limited car as well: the factor applies to a governed top speed, 155 x 0.98 = 151.9 mph.
    const out = applyModifications(sportSedan, [mod('aero', 2)]);
    expect(out.spec.topSpeedMph).toEqual(sportSedan.topSpeedMph);
    expect(scoreSpec(out.spec, { adjust: out.adjust }).speed.metric).toBe(151.9);
  });

  it('adds up the grip of everything fitted', () => {
    expect(applyModifications(civic, [mod('tires', 2), mod('suspension', 1), mod('brakes', 3)]).adjust.gripG).toBeCloseTo(0.1, 12); // 0.06 + 0.02 + 0.02
    expect(applyModifications(truck, [mod('offroad', 3), mod('brakes', 1)]).adjust.gripG).toBeCloseTo(-0.065, 12); // -0.07 + 0.005
  });

  it('adds what a change of weight is worth in grip when the skidpad figure is on file', () => {
    // 386.7 lb lighter at 0.00002 g per pound.
    expect(applyModifications(gtr, [mod('weight', 3)]).adjust.gripG).toBeCloseTo(0.007734, 9);
    // 58.005 lb heavier.
    expect(applyModifications(gtr, [mod('turbo', 2)]).adjust.gripG).toBeCloseTo(-0.0011601, 9);
    expect(applyModifications({ ...gtr, curbWeightLb: null }, [mod('weight', 3)]).adjust.gripG).toBe(0);
  });

  it('leaves the weight to the grip model when no skidpad figure is on file', () => {
    const out = applyModifications(civic, [mod('weight', 3)]);
    expect(out.adjust.gripG).toBe(0);
    // The model reads the lighter car itself: HANDLING 565 becomes 576.
    expect(scoreSpec(civic).handling.value).toBe(565);
    expect(scoreSpec(out.spec, { adjust: out.adjust }).handling.value).toBe(576);
  });

  it('adds up the durability and reliability points of everything fitted', () => {
    // Turbo Pro -30 and -100, off-road kit Pro +30 and -5, transmission Extreme +5 and -15.
    const { adjust } = applyModifications(truck, [mod('turbo', 2), mod('offroad', 2), mod('transmission', 3)]);
    expect(adjust.durabilityPoints).toBe(5);
    expect(adjust.reliabilityPoints).toBe(-120);
  });

  it('gives the same result whatever order the records arrive in', () => {
    const list = [mod('engine', 2, { installedOn: '2021-03-03' }), mod('turbo', 3, { installedOn: '2022-07-19' }), mod('weight', 1, { installedOn: '2023-01-30' }), mod('aero', 2), mod('offroad', 1, { installedOn: '2020-02-02' })];
    const forward = applyModifications(gtr, list);
    expect(applyModifications(gtr, [...list].reverse())).toEqual(forward);
    expect(applyModifications(gtr, [list[2], list[4], list[0], list[3], list[1]])).toEqual(forward);
  });
});

/* ------------------------------------------------------------------ trade-offs ---- */

describe('trade-offs', () => {
  // A realistic vehicle for each modification, on which everything its row states can be seen in the scores.
  const SUBJECT: Record<ModCategory, VehicleSpec> = {
    engine: civic, ecu: civic, 'intake-exhaust': civic, turbo: civic, supercharger: civic, nitrous: civic, transmission: civic,
    suspension: civic, tires: civic, brakes: civic, weight: civic, aero: gtr, offroad: truck, eco: civic,
  };
  // The score each column of the table is meant to move. A multiplier does nothing at 1, an addition nothing at 0.
  const MOVES: { column: keyof ModEffect; nothing: number; attribute: AttributeKey; moreIsBetter: boolean }[] = [
    { column: 'horsepower', nothing: 1, attribute: 'power', moreIsBetter: true },
    { column: 'torque', nothing: 1, attribute: 'power', moreIsBetter: true },
    { column: 'economy', nothing: 1, attribute: 'efficiency', moreIsBetter: true },
    { column: 'sprint', nothing: 1, attribute: 'acceleration', moreIsBetter: false }, // a shorter 0-60 time is a higher score
    { column: 'topSpeed', nothing: 1, attribute: 'speed', moreIsBetter: true },
    { column: 'gripG', nothing: 0, attribute: 'handling', moreIsBetter: true },
    { column: 'durability', nothing: 0, attribute: 'durability', moreIsBetter: true },
    { column: 'reliability', nothing: 0, attribute: 'reliability', moreIsBetter: true },
  ];

  it('every loss the table states lowers its score and every gain raises it', () => {
    let checked = 0;
    for (const row of DESIGN) {
      const subject = SUBJECT[row.category];
      const before = values(subject, []);
      for (const tier of [1, 2, 3] as const) {
        const after = values(subject, [mod(row.category, tier)]);
        for (const move of MOVES) {
          const stated = row.tiers[tier - 1][move.column];
          if (stated === move.nothing) continue;
          const label = `${row.name}, tier ${tier}: ${move.column} ${stated} on ${move.attribute}`;
          if ((stated > move.nothing) === move.moreIsBetter) expect(after[move.attribute], label).toBeGreaterThan(before[move.attribute] as number);
          else expect(after[move.attribute], label).toBeLessThan(before[move.attribute] as number);
          checked++;
        }
      }
    }
    // Every stated figure in those eight columns, over fourteen rows and three tiers.
    expect(checked).toBe(151);
  });

  it('a turbocharger kit raises POWER and ACCELERATION and lowers RELIABILITY and EFFICIENCY', () => {
    expect(values(civic, [])).toEqual({ power: 404, speed: 506, acceleration: 370, handling: 565, durability: 635, reliability: 855, efficiency: 720 });
    // 229 hp and 200 lb-ft; 0-60 in 7.42 s; 31.2 mpg; 115 hp per litre and the kit's own 100 points off reliability.
    // The estimated top speed climbs from 120.7 to 132.2 mph with the power, and 43 lb more costs a point of modelled grip.
    expect(values(civic, [mod('turbo', 2)])).toEqual({ power: 533, speed: 590, acceleration: 526, handling: 564, durability: 595, reliability: 746, efficiency: 675 });
  });

  it('an off-road kit raises DURABILITY and ground clearance and lowers HANDLING and EFFICIENCY', () => {
    expect(values(truck, [])).toEqual({ power: 774, speed: 430, acceleration: 618, handling: 311, durability: 915, reliability: 865, efficiency: 515 });
    expect(values(truck, [mod('offroad', 2)])).toEqual({ power: 774, speed: 392, acceleration: 603, handling: 240, durability: 962, reliability: 860, efficiency: 491 });
    expect(applyModifications(truck, [mod('offroad', 2)]).spec.groundClearanceIn?.value).toBeCloseTo(11.4, 9);
  });

  it('weight reduction improves ACCELERATION and lowers DURABILITY', () => {
    expect(values(gtr, [])).toEqual({ power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 });
    // 387 lb lighter: 0-60 in 2.68 s, a little more grip and economy, and 45 points plus the lost mass off durability.
    expect(values(gtr, [mod('weight', 3)])).toEqual({ power: 950, speed: 920, acceleration: 905, handling: 886, durability: 589, reliability: 700, efficiency: 516 });
  });

  it('more power is charged again through horsepower per litre', () => {
    // The Civic makes 79 hp per litre: under both stress pivots. A turbo kit takes it to 115, past both (90 and 100).
    const { adjust, spec } = applyModifications(civic, [mod('turbo', 2)]);
    const stated = scoreSpec(civic, { adjust });
    const charged = scoreSpec(spec, { adjust });
    expect(stated.reliability.value).toBe(755); // 855 - 100
    expect(charged.reliability.value).toBe(746); // and 14.55 hp per litre over the pivot at 0.6 a point
    expect(charged.durability.value as number).toBeLessThan(stated.durability.value as number);
  });
});

/* ------------------------------------------------------------ install and upkeep ---- */

describe('who fitted it and how it is kept', () => {
  it('scale what a modification costs in reliability and durability', () => {
    expect(INSTALL_FACTOR).toEqual({ professional: 0.75, owner: 1, unknown: 1.25 });
    expect(UPKEEP_FACTOR).toEqual({ documented: 0.85, recent: 1, lapsed: 1.15 });
    // Turbo, Pro costs 100 reliability points and 30 durability points before the factors.
    const cases: [InstallQuality, ActiveModification['upkeep'], number][] = [
      ['professional', 'documented', 0.6375], ['professional', 'recent', 0.75], ['professional', 'lapsed', 0.8625],
      ['owner', 'documented', 0.85], ['owner', 'recent', 1], ['owner', 'lapsed', 1.15],
      ['unknown', 'documented', 1.0625], ['unknown', 'recent', 1.25], ['unknown', 'lapsed', 1.4375],
    ];
    for (const [install, upkeep, factor] of cases) {
      const { adjust } = applyModifications(civic, [mod('turbo', 2, { install, upkeep })]);
      expect(adjust.reliabilityPoints, `${install}, ${upkeep}`).toBeCloseTo(-100 * factor, 9);
      expect(adjust.durabilityPoints, `${install}, ${upkeep}`).toBeCloseTo(-30 * factor, 9);
    }
  });

  it('the same turbo kit costs less reliability fitted professionally and kept up than fitted by nobody knows whom and neglected', () => {
    const cared = values(civic, [mod('turbo', 2, { install: 'professional', upkeep: 'documented' })]);
    const neglected = values(civic, [mod('turbo', 2, { install: 'unknown', upkeep: 'lapsed' })]);
    // The difference is the factors: 100 x (1.25 x 1.15 - 0.75 x 0.85) = 80 points of reliability, 30 x 0.8 = 24 of durability.
    expect(cared.reliability).toBe(783);
    expect(neglected.reliability).toBe(703);
    expect(cared.durability).toBe(605);
    expect(neglected.durability).toBe(581);
    // Nothing else depends on who fitted it.
    for (const key of ['power', 'speed', 'acceleration', 'handling', 'efficiency'] as const) expect(cared[key]).toBe(neglected[key]);
  });

  it('do not scale a gain', () => {
    // Off-road kit, Pro: +30 durability, -5 reliability.
    const cared = applyModifications(truck, [mod('offroad', 2, { install: 'professional', upkeep: 'documented' })]).adjust;
    const neglected = applyModifications(truck, [mod('offroad', 2, { install: 'unknown', upkeep: 'lapsed' })]).adjust;
    expect(cared.durabilityPoints).toBe(30);
    expect(neglected.durabilityPoints).toBe(30);
    expect(cared.reliabilityPoints).toBeCloseTo(-3.1875, 9);
    expect(neglected.reliabilityPoints).toBeCloseTo(-7.1875, 9);
    // Economy setup, Pro: +5 reliability, whoever fitted it.
    expect(applyModifications(civic, [mod('eco', 2, { install: 'unknown', upkeep: 'lapsed' })]).adjust.reliabilityPoints).toBe(5);
  });

  it('scale each modification by its own install and upkeep', () => {
    // Turbo Pro, professional and documented: -63.75. Nitrous Street, unknown and lapsed: -30 x 1.4375 = -43.125.
    const { adjust } = applyModifications(civic, [mod('turbo', 2, { install: 'professional', upkeep: 'documented' }), mod('nitrous', 1, { install: 'unknown', upkeep: 'lapsed' })]);
    expect(adjust.reliabilityPoints).toBeCloseTo(-106.875, 9);
  });

  it('change no figure and no other adjustment', () => {
    const cared = applyModifications(gtr, [mod('turbo', 2, { install: 'professional', upkeep: 'documented' }), mod('aero', 1)]);
    const neglected = applyModifications(gtr, [mod('turbo', 2, { install: 'unknown', upkeep: 'lapsed' }), mod('aero', 1)]);
    expect(cared.spec).toEqual(neglected.spec);
    expect(cared.adjust.gripG).toBe(neglected.adjust.gripG);
    expect(cared.adjust.sprintFactor).toBe(neglected.adjust.sprintFactor);
    expect(cared.adjust.topSpeedFactor).toBe(neglected.adjust.topSpeedFactor);
  });
});

/* ---------------------------------------------------------------- electric cars ---- */

describe('an electric car', () => {
  it('refuses a turbocharger kit, says why and changes nothing', () => {
    const out = applyModifications(ev, [mod('turbo', 3)]);
    expect(out.refused).toEqual([{ eventId: 'ev-turbo', category: 'turbo', reason: 'not for an electric powertrain' }]);
    expect(out.applied).toEqual([]);
    expect(out.spec).toEqual(ev);
    expect(out.adjust).toEqual(NO_ADJUSTMENT);
    expect(scoreSpec(out.spec, { adjust: out.adjust })).toEqual(scoreSpec(ev));
  });

  it('still takes what is not about combustion', () => {
    const out = applyModifications(ev, [mod('turbo', 3), mod('tires', 2), mod('weight', 1), mod('nitrous', 1)]);
    expect(out.applied.map((m) => m.category)).toEqual(['tires', 'weight']);
    expect(out.refused.map((r) => r.category)).toEqual(['nitrous', 'turbo']);
    expect(out.spec.horsepower).toEqual(ev.horsepower);
    expect(values(ev, [])).toEqual({ power: 626, speed: 540, acceleration: 639, handling: 539, durability: 674, reliability: 955, efficiency: 987 });
    // Stickier tires and 116 lb less: quicker and grippier, and it costs range and durability. The limited top speed stays.
    expect(values(ev, [mod('turbo', 3), mod('tires', 2), mod('weight', 1), mod('nitrous', 1)])).toEqual({ power: 626, speed: 540, acceleration: 656, handling: 650, durability: 645, reliability: 955, efficiency: 984 });
  });
});

/* ------------------------------------------------------------------ originality ---- */

describe('originalityCost', () => {
  it('is nothing for a vehicle with nothing fitted', () => {
    expect(originalityCost([])).toBe(0);
  });

  it('sums the originality figures of what is fitted', () => {
    expect(originalityCost([mod('turbo', 2)])).toBe(26);
    expect(originalityCost([mod('turbo', 2), mod('engine', 1), mod('brakes', 3)])).toBe(42); // 26 + 10 + 6
  });

  it('charges a documented modification three quarters and a verified one six tenths', () => {
    expect(originalityCost([mod('turbo', 2, { evidence: 'documented' })])).toBe(19.5);
    expect(originalityCost([mod('turbo', 2, { evidence: 'verified' })])).toBe(15.6);
    // Engine Extreme declared 28, ECU Pro documented 6 x 0.75, brakes Street verified 2 x 0.6.
    expect(originalityCost([mod('engine', 3), mod('ecu', 2, { evidence: 'documented' }), mod('brakes', 1, { evidence: 'verified' })])).toBe(33.7);
    // Nitrous Pro verified is 9 x 0.6: it comes back as 5.4, not as the 5.3999999999999995 the multiplication leaves.
    expect(originalityCost([mod('nitrous', 2, { evidence: 'verified' })])).toBe(5.4);
  });

  it('does not charge twice for a fitment a later one replaced', () => {
    const first = mod('turbo', 1, { eventId: 'e1', installedOn: '2023-05-01' });
    const second = mod('turbo', 2, { eventId: 'e2', installedOn: '2025-02-01' });
    expect(originalityCost([first, second])).toBe(26);
    expect(originalityCost([second, first])).toBe(26);
    // A supercharger fitted after the turbo kit came off the same engine: only the supercharger is on the car.
    expect(originalityCost([second, mod('supercharger', 1, { installedOn: '2025-09-09' })])).toBe(18);
    expect(originalityCost([mod('tires', 3, { installedOn: '2024-01-01' }), mod('eco', 1, { installedOn: '2025-01-01' })])).toBe(2);
  });

  it('does not change the records it reads', () => {
    const list = frozen([mod('turbo', 2), mod('engine', 1, { evidence: 'verified' })]);
    const before = JSON.stringify(list);
    expect(originalityCost(list)).toBe(32);
    expect(JSON.stringify(list)).toBe(before);
  });
});

/* ---------------------------------------------------------------------- purity ---- */

describe('applyModifications', () => {
  it('does not change the specification or the records it is given, and gives the same answer twice', () => {
    const spec = frozen({ ...gtr, horsepower: s(600, { ...ref }), curbWeightLb: s(3867, { ...ref }) });
    const list = frozen([mod('turbo', 3, { installedOn: '2024-02-02' }), mod('weight', 2), mod('aero', 1), mod('supercharger', 1, { installedOn: '2023-01-01' })]);
    const specBefore = JSON.stringify(spec), listBefore = JSON.stringify(list);
    const a = applyModifications(spec, list), b = applyModifications(spec, list);
    expect(JSON.stringify(spec)).toBe(specBefore);
    expect(JSON.stringify(list)).toBe(listBefore);
    expect(a).toEqual(b);
    expect(a.spec).not.toBe(spec);
    expect(a.spec.horsepower).not.toBe(spec.horsepower);
    expect(spec.horsepower.source.note).toBeUndefined();
  });
});
