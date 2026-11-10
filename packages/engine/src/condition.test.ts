import { describe, expect, it } from 'vitest';
import { WEAR_LIFE, WEAR_LOSS, WEAR_SYSTEM_LABELS, assessCondition, wearFactors } from './condition';
import { ATTRIBUTE_KEYS, EVIDENCE_ORDER, WEAR_SYSTEMS } from './types';
import type { AttributeKey, ConditionInputs, ConditionState, EvidenceLevel, SystemWear, WearSystem } from './types';
import { mulberry32 } from './util';

// A petrol car on the first day of its model year with nothing on record. Each test adds what it is about.
const car = (over: Partial<ConditionInputs> = {}): ConditionInputs => ({
  asOf: '2024-01-01', modelYear: 2024, powertrain: 'gasoline', mileage: null, replacements: [], inspections: [], accident: null, titleStatus: null, ...over,
});

// An eight-year-old car at 180,000 documented miles: the engine is nine tenths through its life.
const tired = (over: Partial<ConditionInputs> = {}): ConditionInputs => car({ modelYear: 2016, mileage: { value: 180000, evidence: 'documented' }, ...over });

// The engine was replaced six months before the day asked about, at 170,000 miles.
const newEngine = (evidence: EvidenceLevel): ConditionInputs['replacements'][number] => ({ system: 'engine', date: '2023-07-01', mileage: 170000, evidence });

const nobodyKnows = (system: WearSystem): SystemWear => ({ system, wear: 0, basis: 'unknown', evidence: null, sinceMileage: null, sinceDate: null });

// A state written by hand: every system unknown except the ones named.
const stateOf = (over: Partial<Record<WearSystem, Partial<SystemWear>>>): ConditionState => {
  const systems = {} as Record<WearSystem, SystemWear>;
  for (const system of WEAR_SYSTEMS) systems[system] = { ...nobodyKnows(system), ...over[system] };
  return { asOf: '2026-11-10', mileage: null, mileageEvidence: null, systems };
};

// A state where one system is known and the rest are not.
const only = (system: WearSystem, entry: Partial<SystemWear>): ConditionState => {
  const over: Partial<Record<WearSystem, Partial<SystemWear>>> = {};
  over[system] = entry;
  return stateOf(over);
};

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
const DESIGN_TABLE = [
  '| engine | 200,000 mi or 25 years | no | POWER 12%, ACCELERATION 10%, SPEED 5%, RELIABILITY 25%, EFFICIENCY 10% |',
  '| transmission | 150,000 mi or 20 years | no | ACCELERATION 5%, RELIABILITY 15%, EFFICIENCY 4% |',
  '| suspension | 90,000 mi or 12 years | no | HANDLING 18%, DURABILITY 6% |',
  '| brakes | 45,000 mi or 6 years | yes | HANDLING 8% |',
  '| tires | 45,000 mi or 6 years | yes | HANDLING 12%, ACCELERATION 3%, EFFICIENCY 2% |',
  '| body | 250,000 mi or 20 years | no | DURABILITY 30% |',
  '| battery | 150,000 mi or 12 years | no | EFFICIENCY 8%, RELIABILITY 10%, POWER 5% |',
];

describe('the wear table', () => {
  it('carries the design’s table number for number', () => {
    const named: string[] = [];
    for (const row of DESIGN_TABLE) {
      const [system, life, consumable, lost] = row.split('|').slice(1, -1).map((cell) => cell.trim());
      named.push(system);
      const m = /^([\d,]+) mi or (\d+) years$/.exec(life);
      expect(m).not.toBeNull();
      if (m === null) continue;
      expect(WEAR_LIFE[system as WearSystem]).toEqual({ miles: Number(m[1].replace(/,/g, '')), years: Number(m[2]), consumable: consumable === 'yes' });
      const shares = Object.fromEntries(lost.split(', ').map((part) => {
        const [attribute, percent] = part.split(' ');
        return [attribute.toLowerCase(), Number(percent.replace('%', '')) / 100];
      }));
      expect(WEAR_LOSS[system as WearSystem]).toEqual(shares);
    }
    expect(named).toEqual([...WEAR_SYSTEMS]);
    expect(Object.keys(WEAR_LIFE).sort()).toEqual([...WEAR_SYSTEMS].sort());
    expect(Object.keys(WEAR_LOSS).sort()).toEqual([...WEAR_SYSTEMS].sort());
  });

  it('has a plain label of its own for every system', () => {
    const labels = WEAR_SYSTEMS.map((system) => WEAR_SYSTEM_LABELS[system]);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z]+$/);
    expect(new Set(labels).size).toBe(WEAR_SYSTEMS.length);
  });
});

/* --------------------------------------------------------------- modelled wear ---- */

describe('modelled wear', () => {
  it('wears a system by the share of its life in miles it has covered', () => {
    // On the first day of the model year no time has passed, so only the miles count.
    const halfLife: [WearSystem, number][] = [['engine', 100000], ['transmission', 75000], ['suspension', 45000], ['body', 125000]];
    for (const [system, miles] of halfLife) {
      expect(assessCondition(car({ mileage: { value: miles, evidence: 'documented' } })).systems[system].wear).toBe(0.5);
    }
  });

  it('wears a system by the share of its life in years it has stood', () => {
    // 2020-01-01 to 2024-01-01 is 1,461 days: exactly four years of 365.25 days.
    const { systems } = assessCondition(car({ modelYear: 2020 }));
    expect(systems.engine.wear).toBeCloseTo(4 / 25, 12);
    expect(systems.transmission.wear).toBeCloseTo(4 / 20, 12);
    expect(systems.suspension.wear).toBeCloseTo(4 / 12, 12);
    expect(systems.body.wear).toBeCloseTo(4 / 20, 12);
  });

  it('takes whichever of miles and years is further along', () => {
    const byMiles = assessCondition(car({ modelYear: 2020, mileage: { value: 150000, evidence: 'declared' } }));
    expect(byMiles.systems.engine.wear).toBeCloseTo(0.75, 12);
    const byYears = assessCondition(car({ modelYear: 2020, mileage: { value: 10000, evidence: 'declared' } }));
    expect(byYears.systems.engine.wear).toBeCloseTo(0.16, 12);
  });

  it('stops at fully worn and never goes below as new', () => {
    expect(assessCondition(car({ mileage: { value: 900000, evidence: 'declared' } })).systems.engine.wear).toBe(1);
    // Asked about a day before the model year begins: nothing has worn yet.
    const early = assessCondition(car({ modelYear: 2027, asOf: '2026-11-10' }));
    for (const system of ['engine', 'transmission', 'suspension', 'body'] as const) expect(early.systems[system].wear).toBe(0);
  });

  it('gives modelled wear the evidence of the mileage reading it rests on', () => {
    for (const evidence of EVIDENCE_ORDER) {
      const { systems } = assessCondition(car({ mileage: { value: 60000, evidence } }));
      for (const system of ['engine', 'transmission', 'suspension', 'body'] as const) {
        expect(systems[system].basis).toBe('modelled');
        expect(systems[system].evidence).toBe(evidence);
      }
    }
  });

  it('calls wear counted from the years alone declared', () => {
    const { systems } = assessCondition(car({ modelYear: 2012 }));
    for (const system of ['engine', 'transmission', 'suspension', 'body'] as const) {
      expect(systems[system].wear).toBeGreaterThan(0);
      expect(systems[system].basis).toBe('modelled');
      expect(systems[system].evidence).toBe('declared');
    }
  });

  it('counts from the day the vehicle was built when nothing was replaced', () => {
    const { systems } = assessCondition(tired());
    for (const system of WEAR_SYSTEMS) {
      expect(systems[system].system).toBe(system);
      expect(systems[system].sinceMileage).toBeNull();
      expect(systems[system].sinceDate).toBeNull();
    }
  });

  it('records the mileage it was given and the day it was asked about', () => {
    const state = assessCondition(car({ asOf: '2025-06-30', mileage: { value: 41250, evidence: 'verified' } }));
    expect(state.asOf).toBe('2025-06-30');
    expect(state.mileage).toBe(41250);
    expect(state.mileageEvidence).toBe('verified');
    const bare = assessCondition(car());
    expect(bare.mileage).toBeNull();
    expect(bare.mileageEvidence).toBeNull();
  });
});

/* ------------------------------------------------------------- replacements ---- */

describe('replacements and rebuilds', () => {
  it('a documented replacement resets that system’s wear clock', () => {
    expect(assessCondition(tired()).systems.engine).toEqual({ system: 'engine', wear: 0.9, basis: 'modelled', evidence: 'documented', sinceMileage: null, sinceDate: null });
    const after = assessCondition(tired({ replacements: [newEngine('documented')] })).systems;
    // 10,000 miles on the new engine is a twentieth of its life.
    expect(after.engine).toEqual({ system: 'engine', wear: 0.05, basis: 'modelled', evidence: 'documented', sinceMileage: 170000, sinceDate: '2023-07-01' });
  });

  it('a verified replacement resets it too', () => {
    const { engine } = assessCondition(tired({ replacements: [newEngine('verified')] })).systems;
    expect(engine.wear).toBe(0.05);
    expect(engine.sinceMileage).toBe(170000);
  });

  it('a declared replacement restores nothing', () => {
    expect(assessCondition(tired({ replacements: [newEngine('declared')] }))).toEqual(assessCondition(tired()));
  });

  it('resets only the system that was replaced', () => {
    const { transmission, suspension, body } = assessCondition(tired({ replacements: [newEngine('documented')] })).systems;
    expect(transmission.wear).toBe(1);
    expect(suspension.wear).toBe(1);
    expect(body.wear).toBeCloseTo(0.72, 12);
    for (const other of [transmission, suspension, body]) expect(other.sinceDate).toBeNull();
  });

  it('a replacement with no mileage counts years only', () => {
    // Replaced on 2020-01-01 with no odometer reading: four years on the new engine, whatever the odometer says today.
    const state = assessCondition(tired({
      mileage: { value: 180000, evidence: 'verified' },
      replacements: [{ system: 'engine', date: '2020-01-01', mileage: null, evidence: 'documented' }],
    }));
    expect(state.systems.engine.wear).toBeCloseTo(4 / 25, 12);
    // Counted from the receipt and nothing else, so it is as good as the receipt.
    expect(state.systems.engine.evidence).toBe('documented');
    expect(state.systems.engine.sinceMileage).toBeNull();
    expect(state.systems.engine.sinceDate).toBe('2020-01-01');
    // The systems that still count miles keep the reading's evidence.
    expect(state.systems.transmission.evidence).toBe('verified');
  });

  it('is only as well evidenced as the weakest thing it was counted from', () => {
    const since = (reading: EvidenceLevel, receipt: EvidenceLevel) =>
      assessCondition(tired({ mileage: { value: 180000, evidence: reading }, replacements: [{ system: 'engine', date: '2023-07-01', mileage: 170000, evidence: receipt }] })).systems.engine;
    // A verified odometer reading does not make an unverified receipt verified: the wear is counted from both.
    expect(since('verified', 'documented')).toMatchObject({ wear: 0.05, evidence: 'documented' });
    expect(since('documented', 'verified')).toMatchObject({ wear: 0.05, evidence: 'documented' });
    expect(since('verified', 'verified')).toMatchObject({ wear: 0.05, evidence: 'verified' });
    expect(since('declared', 'verified').evidence).toBe('declared');
    // With no replacement on record there is only the reading.
    expect(assessCondition(tired({ mileage: { value: 180000, evidence: 'verified' } })).systems.engine.evidence).toBe('verified');
  });

  it('counts years only from a replacement when no mileage is on file today', () => {
    const { engine } = assessCondition(car({ modelYear: 2016, replacements: [{ system: 'engine', date: '2020-01-01', mileage: 90000, evidence: 'documented' }] })).systems;
    expect(engine.wear).toBeCloseTo(4 / 25, 12);
    expect(engine.evidence).toBe('documented');
    expect(engine.sinceMileage).toBe(90000);
  });

  it('counts from the newest replacement on record, in whatever order they arrive', () => {
    const first: ConditionInputs['replacements'][number] = { system: 'engine', date: '2019-03-01', mileage: 90000, evidence: 'documented' };
    const second = newEngine('verified');
    for (const replacements of [[first, second], [second, first]]) {
      const { engine } = assessCondition(tired({ replacements })).systems;
      expect(engine.sinceMileage).toBe(170000);
      expect(engine.sinceDate).toBe('2023-07-01');
    }
    // A later one the owner only declared does not move the clock.
    const claimed: ConditionInputs['replacements'][number] = { system: 'engine', date: '2023-12-01', mileage: 179000, evidence: 'declared' };
    expect(assessCondition(tired({ replacements: [first, claimed, second] })).systems.engine.sinceMileage).toBe(170000);
  });

  it('ignores a replacement dated after the day asked about', () => {
    const { engine } = assessCondition(tired({ asOf: '2023-01-01', replacements: [newEngine('documented')] })).systems;
    expect(engine.sinceDate).toBeNull();
    expect(engine.wear).toBe(0.9);
  });

  it('counts two replacements on one day from the higher odometer reading, in either order', () => {
    const morning: ConditionInputs['replacements'][number] = { system: 'engine', date: '2023-07-01', mileage: 169000, evidence: 'documented' };
    const evening = newEngine('documented');
    for (const replacements of [[morning, evening], [evening, morning]]) {
      expect(assessCondition(tired({ replacements })).systems.engine.sinceMileage).toBe(170000);
    }
  });

  it('counts the years from the vehicle’s own start when a replacement is dated before it', () => {
    // A 2024 model sold in 2023 had its engine replaced that November. The new engine is no older than the car.
    const early: ConditionInputs['replacements'][number] = { system: 'engine', date: '2023-11-15', mileage: null, evidence: 'documented' };
    const without = assessCondition(car({ asOf: '2026-01-01' })).systems.engine;
    const replaced = assessCondition(car({ asOf: '2026-01-01', replacements: [early] })).systems.engine;
    expect(without.wear).toBeGreaterThan(0);
    expect(replaced.wear).toBe(without.wear);
    expect(replaced.sinceDate).toBe('2023-11-15');
  });

  it('does not count a replacement or an inspection whose date is not a real day', () => {
    const state = assessCondition(tired({
      replacements: [{ system: 'engine', date: '2023-13-45', mileage: 170000, evidence: 'documented' }],
      inspections: [{ date: '', systems: { transmission: 0.1 } }],
    }));
    expect(state).toEqual(assessCondition(tired()));
  });

  it('never reads a replacement as wear below as new', () => {
    // The odometer on file is lower than the one written on the receipt: the miles since cannot be negative.
    const { engine } = assessCondition(tired({ mileage: { value: 160000, evidence: 'documented' }, replacements: [newEngine('documented')] })).systems;
    expect(engine.wear).toBeGreaterThanOrEqual(0);
    expect(engine.wear).toBeLessThan(0.05);
  });
});

/* ---------------------------------------------------------------- consumables ---- */

describe('brakes and tires', () => {
  it('carry no penalty when nobody has recorded their state', () => {
    const { brakes, tires } = assessCondition(car({ modelYear: 2010, mileage: { value: 160000, evidence: 'verified' } })).systems;
    expect(brakes).toEqual(nobodyKnows('brakes'));
    expect(tires).toEqual(nobodyKnows('tires'));
  });

  it('wear from a documented replacement onward', () => {
    const { tires, brakes } = assessCondition(tired({ replacements: [{ system: 'tires', date: '2023-07-01', mileage: 170000, evidence: 'documented' }] })).systems;
    expect(tires).toEqual({ system: 'tires', wear: 10000 / 45000, basis: 'modelled', evidence: 'documented', sinceMileage: 170000, sinceDate: '2023-07-01' });
    expect(brakes).toEqual(nobodyKnows('brakes'));
  });

  it('are half worn at half their life in miles', () => {
    for (const system of ['brakes', 'tires'] as const) {
      const state = assessCondition(car({ mileage: { value: 32500, evidence: 'documented' }, replacements: [{ system, date: '2024-01-01', mileage: 10000, evidence: 'documented' }] }));
      expect(state.systems[system].wear).toBe(0.5);
    }
  });

  it('wear by the years since they were fitted when no mileage came with the receipt', () => {
    for (const system of ['brakes', 'tires'] as const) {
      const state = assessCondition(car({ modelYear: 2018, replacements: [{ system, date: '2020-01-01', mileage: null, evidence: 'verified' }] }));
      expect(state.systems[system].wear).toBeCloseTo(4 / 6, 12);
      expect(state.systems[system].evidence).toBe('verified');
    }
  });

  it('stay unknown after a replacement the owner only declared', () => {
    const { tires } = assessCondition(tired({ replacements: [{ system: 'tires', date: '2023-07-01', mileage: 170000, evidence: 'declared' }] })).systems;
    expect(tires).toEqual(nobodyKnows('tires'));
  });

  it('take their state from an inspection', () => {
    const { brakes, tires } = assessCondition(tired({ inspections: [{ date: '2023-11-20', systems: { brakes: 0.35 } }] })).systems;
    expect(brakes).toEqual({ system: 'brakes', wear: 0.35, basis: 'inspected', evidence: 'verified', sinceMileage: null, sinceDate: null });
    expect(tires).toEqual(nobodyKnows('tires'));
  });
});

/* -------------------------------------------------------------------- battery ---- */

describe('the battery', () => {
  it('wears only on hybrid, plug-in hybrid and electric powertrains', () => {
    for (const powertrain of ['hybrid', 'plug-in-hybrid', 'electric'] as const) {
      const { battery } = assessCondition(car({ powertrain, mileage: { value: 75000, evidence: 'documented' } })).systems;
      expect(battery).toEqual({ system: 'battery', wear: 0.5, basis: 'modelled', evidence: 'documented', sinceMileage: null, sinceDate: null });
    }
    for (const powertrain of ['gasoline', 'diesel', null] as const) {
      const { battery } = assessCondition(car({ powertrain, modelYear: 2010, mileage: { value: 160000, evidence: 'documented' } })).systems;
      expect(battery).toEqual(nobodyKnows('battery'));
    }
  });

  it('wears by years on an electric car as any other system does', () => {
    expect(assessCondition(car({ powertrain: 'electric', modelYear: 2020 })).systems.battery.wear).toBeCloseTo(4 / 12, 12);
  });

  it('starts again from a documented replacement pack', () => {
    const { battery } = assessCondition(car({
      powertrain: 'electric', modelYear: 2016, mileage: { value: 140000, evidence: 'documented' },
      replacements: [{ system: 'battery', date: '2023-07-01', mileage: 125000, evidence: 'documented' }],
    })).systems;
    expect(battery.wear).toBe(0.1);
    expect(battery.sinceMileage).toBe(125000);
  });

  it('has no state on a combustion car even when a record names it', () => {
    const { battery } = assessCondition(car({
      modelYear: 2016, mileage: { value: 140000, evidence: 'documented' },
      replacements: [{ system: 'battery', date: '2023-07-01', mileage: 125000, evidence: 'documented' }],
      inspections: [{ date: '2023-08-01', systems: { battery: 0.9 } }],
    })).systems;
    expect(battery).toEqual(nobodyKnows('battery'));
  });
});

/* ------------------------------------------------------------ accident and title ---- */

describe('declared accident and title', () => {
  it('set a floor under body wear', () => {
    const floors: [ConditionInputs['accident'], ConditionInputs['titleStatus'], number][] = [
      [null, null, 0], ['None', 'Clean', 0], ['Minor', null, 0.25], ['Major', null, 0.6], [null, 'Rebuilt', 0.5], [null, 'Salvage', 0.8],
      ['Minor', 'Clean', 0.25], ['Major', 'Rebuilt', 0.6], ['Minor', 'Rebuilt', 0.5], ['Major', 'Salvage', 0.8], ['None', 'Salvage', 0.8],
    ];
    for (const [accident, titleStatus, want] of floors) {
      // A new car, so the modelled wear is nil and the floor is all there is.
      expect(assessCondition(car({ accident, titleStatus })).systems.body.wear).toBe(want);
    }
  });

  it('touch the body and nothing else', () => {
    // A hybrid at 20,000 miles: every modelled system is far below the floor, so a floor in the wrong place would show.
    const young = (over: Partial<ConditionInputs>) => assessCondition(car({ powertrain: 'hybrid', mileage: { value: 20000, evidence: 'documented' }, ...over })).systems;
    const plain = young({});
    const crashed = young({ accident: 'Major', titleStatus: 'Salvage' });
    for (const system of WEAR_SYSTEMS) {
      if (system !== 'body') expect(crashed[system]).toEqual(plain[system]);
    }
    expect(plain.engine.wear).toBe(0.1);
    expect(plain.body.wear).toBe(0.08);
    expect(crashed.body.wear).toBe(0.8);
  });

  it('are a declaration, whatever stands behind the mileage', () => {
    // 50,000 verified miles wear the body by a fifth; the declared accident lifts that to 0.6 on the owner's word.
    const { body } = assessCondition(car({ mileage: { value: 50000, evidence: 'verified' }, accident: 'Major' })).systems;
    expect(body).toEqual({ system: 'body', wear: 0.6, basis: 'modelled', evidence: 'declared', sinceMileage: null, sinceDate: null });
  });

  it('change nothing once the body has worn past the floor', () => {
    const { body } = assessCondition(car({ mileage: { value: 200000, evidence: 'verified' }, accident: 'Major' })).systems;
    expect(body.wear).toBe(0.8);
    expect(body.evidence).toBe('verified');
  });
});

/* ---------------------------------------------------------------- inspections ---- */

describe('inspections', () => {
  const older = { date: '2022-06-01', systems: { engine: 0.7, tires: 0.2 } };
  const newer = { date: '2023-06-01', systems: { engine: 0.3, brakes: 0.5 } };

  it('the newest inspection that reads a system overrides its wear', () => {
    for (const inspections of [[older, newer], [newer, older]]) {
      const { engine, brakes, tires, transmission } = assessCondition(tired({ inspections })).systems;
      expect(engine).toEqual({ system: 'engine', wear: 0.3, basis: 'inspected', evidence: 'verified', sinceMileage: null, sinceDate: null });
      expect(brakes.wear).toBe(0.5);
      // Only the older inspection looked at the tires, so its figure stands.
      expect(tires).toEqual({ system: 'tires', wear: 0.2, basis: 'inspected', evidence: 'verified', sinceMileage: null, sinceDate: null });
      // Nobody inspected the transmission: it stays modelled from the mileage.
      expect(transmission.basis).toBe('modelled');
      expect(transmission.evidence).toBe('documented');
    }
  });

  it('lets the more worn figure stand when two inspections on one day disagree, in either order', () => {
    const lenient = { date: '2023-06-01', systems: { engine: 0.2 } };
    for (const inspections of [[lenient, newer], [newer, lenient]]) {
      expect(assessCondition(tired({ inspections })).systems.engine.wear).toBe(0.3);
    }
  });

  it('ignores an inspection dated after the day asked about', () => {
    const { engine } = assessCondition(tired({ asOf: '2023-01-01', inspections: [older, newer] })).systems;
    expect(engine.wear).toBe(0.7);
  });

  it('puts the inspector’s reading of the body above a declared accident', () => {
    const { body } = assessCondition(car({ accident: 'Major', titleStatus: 'Salvage', inspections: [{ date: '2023-12-01', systems: { body: 0.1 } }] })).systems;
    expect(body).toEqual({ system: 'body', wear: 0.1, basis: 'inspected', evidence: 'verified', sinceMileage: null, sinceDate: null });
  });

  it('keeps an inspector’s figure inside as new to worn out', () => {
    const { engine, body } = assessCondition(car({ inspections: [{ date: '2023-12-01', systems: { engine: 1.4, body: -0.2 } }] })).systems;
    expect(engine.wear).toBe(1);
    expect(body.wear).toBe(0);
  });

  it('is not displaced by a receipt the owner uploads afterwards', () => {
    // The inspector read the engine at 0.8. A documented rebuild later resets the clock on file, but the verified reading stands.
    const { engine } = assessCondition(tired({ inspections: [{ date: '2023-03-01', systems: { engine: 0.8 } }], replacements: [newEngine('documented')] })).systems;
    expect(engine).toEqual({ system: 'engine', wear: 0.8, basis: 'inspected', evidence: 'verified', sinceMileage: 170000, sinceDate: '2023-07-01' });
  });
});

/* --------------------------------------------------------------------- purity ---- */

describe('assessCondition', () => {
  it('does not change its inputs and gives the same state twice', () => {
    const inputs = frozen(tired({
      accident: 'Minor', titleStatus: 'Rebuilt',
      replacements: [newEngine('documented'), { system: 'tires', date: '2023-07-01', mileage: 170000, evidence: 'verified' }],
      inspections: [{ date: '2023-06-01', systems: { suspension: 0.4 } }],
    }));
    const before = JSON.stringify(inputs);
    const a = assessCondition(inputs), b = assessCondition(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('whatever is on record', () => {
  const systemsOf = (system: WearSystem, figure: number): Partial<Record<WearSystem, number>> => {
    const out: Partial<Record<WearSystem, number>> = {};
    out[system] = figure;
    return out;
  };

  // Seeded, so the same three hundred vehicles are drawn on every run.
  const draw = (seed: number) => {
    const next = mulberry32(seed);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
    const day = (): string => `${2015 + Math.floor(next() * 12)}-${pick(['01', '04', '07', '10'])}-${pick(['01', '15', '28'])}`;
    const vehicle = (): ConditionInputs => ({
      asOf: day(),
      modelYear: 2010 + Math.floor(next() * 18),
      powertrain: pick(['gasoline', 'diesel', 'hybrid', 'plug-in-hybrid', 'electric', null] as const),
      mileage: next() < 0.3 ? null : { value: Math.floor(next() * 400000), evidence: pick(EVIDENCE_ORDER) },
      replacements: [],
      inspections: [],
      accident: pick(['None', 'Minor', 'Major', null] as const),
      titleStatus: pick(['Clean', 'Rebuilt', 'Salvage', null] as const),
    });
    return { next, pick, day, vehicle };
  };

  it('keeps every wear between as new and worn out', () => {
    const { next, pick, day, vehicle } = draw(8675309);
    for (let run = 0; run < 300; run++) {
      const inputs: ConditionInputs = {
        ...vehicle(),
        replacements: Array.from({ length: Math.floor(next() * 4) }, () => ({ system: pick(WEAR_SYSTEMS), date: day(), mileage: next() < 0.3 ? null : Math.floor(next() * 400000), evidence: pick(EVIDENCE_ORDER) })),
        inspections: Array.from({ length: Math.floor(next() * 3) }, () => ({ date: day(), systems: systemsOf(pick(WEAR_SYSTEMS), next() * 2 - 0.5) })),
      };
      const { systems } = assessCondition(inputs);
      for (const system of WEAR_SYSTEMS) {
        const entry = systems[system];
        expect(entry.wear).toBeGreaterThanOrEqual(0);
        expect(entry.wear).toBeLessThanOrEqual(1);
        expect(entry.evidence === null).toBe(entry.basis === 'unknown');
        if (entry.basis === 'unknown') expect(entry.wear).toBe(0);
        if (entry.basis === 'inspected') expect(entry.evidence).toBe('verified');
      }
    }
  });

  it('a documented replacement never leaves a system more worn than no receipt would', () => {
    const { next, pick, day, vehicle } = draw(424242);
    for (let run = 0; run < 300; run++) {
      const inputs = vehicle();
      const system = pick(['engine', 'transmission', 'suspension', 'body', 'battery'] as const);
      const odometer = inputs.mileage === null || next() < 0.3 ? null : Math.floor(next() * (inputs.mileage.value + 1));
      const before = assessCondition(inputs).systems;
      const after = assessCondition({ ...inputs, replacements: [{ system, date: day(), mileage: odometer, evidence: pick(['documented', 'verified'] as const) }] }).systems;
      expect(after[system].wear).toBeLessThanOrEqual(before[system].wear);
      for (const other of WEAR_SYSTEMS) {
        if (other !== system) expect(after[other]).toEqual(before[other]);
      }
    }
  });

  it('treats a mileage that is not a number as no mileage on file', () => {
    const state = assessCondition(car({ modelYear: 2020, mileage: { value: Number.NaN, evidence: 'verified' } }));
    expect(state.mileage).toBeNull();
    expect(state.mileageEvidence).toBeNull();
    expect(state.systems.engine.wear).toBeCloseTo(4 / 25, 12);
    expect(state.systems.engine.evidence).toBe('declared');
  });
});

/* ---------------------------------------------------------------- wear factors ---- */

describe('wearFactors', () => {
  const ones = { power: 1, speed: 1, acceleration: 1, handling: 1, durability: 1, reliability: 1, efficiency: 1 };

  it('is all ones when there is no condition', () => {
    for (const least of EVIDENCE_ORDER) expect(wearFactors(null, least)).toEqual({ factors: ones, bySystem: [] });
  });

  it('is all ones when nobody knows the state of anything', () => {
    expect(wearFactors(stateOf({}), 'declared')).toEqual({ factors: ones, bySystem: [] });
  });

  it('takes from each attribute the share a fully worn system costs it', () => {
    const left: Record<WearSystem, Partial<Record<AttributeKey, number>>> = {
      engine: { power: 0.88, acceleration: 0.9, speed: 0.95, reliability: 0.75, efficiency: 0.9 },
      transmission: { acceleration: 0.95, reliability: 0.85, efficiency: 0.96 },
      suspension: { handling: 0.82, durability: 0.94 },
      brakes: { handling: 0.92 },
      tires: { handling: 0.88, acceleration: 0.97, efficiency: 0.98 },
      body: { durability: 0.7 },
      battery: { efficiency: 0.92, reliability: 0.9, power: 0.95 },
    };
    for (const system of WEAR_SYSTEMS) {
      const { factors, bySystem } = wearFactors(only(system, { wear: 1, basis: 'inspected', evidence: 'verified' }), 'verified');
      for (const key of ATTRIBUTE_KEYS) expect(factors[key]).toBeCloseTo(left[system][key] ?? 1, 12);
      expect(bySystem).toHaveLength(1);
      expect(bySystem[0].system).toBe(system);
      expect(bySystem[0].evidence).toBe('verified');
      expect(Object.keys(bySystem[0].factors).sort()).toEqual(Object.keys(left[system]).sort());
      for (const key of ATTRIBUTE_KEYS) {
        const want = left[system][key];
        if (want !== undefined) expect(bySystem[0].factors[key]).toBeCloseTo(want, 12);
      }
    }
  });

  it('charges wear by its power of 1.5, so early wear costs little', () => {
    // A quarter worn: 0.25 ^ 1.5 = 0.125 of the full loss.
    const { factors } = wearFactors(stateOf({ engine: { wear: 0.25, basis: 'modelled', evidence: 'declared' } }), 'declared');
    expect(factors.reliability).toBeCloseTo(0.96875, 12);
    expect(factors.power).toBeCloseTo(0.985, 12);
    expect(factors.handling).toBe(1);
  });

  it('multiplies the systems that cost the same attribute', () => {
    const worn = { wear: 1, basis: 'modelled', evidence: 'documented' } as const;
    const { factors, bySystem } = wearFactors(stateOf({ engine: worn, transmission: worn, battery: worn, tires: worn }), 'declared');
    expect(factors.reliability).toBeCloseTo(0.75 * 0.85 * 0.9, 12);
    expect(factors.efficiency).toBeCloseTo(0.9 * 0.96 * 0.98 * 0.92, 12);
    expect(factors.acceleration).toBeCloseTo(0.9 * 0.95 * 0.97, 12);
    expect(factors.power).toBeCloseTo(0.88 * 0.95, 12);
    expect(bySystem.map((entry) => entry.system)).toEqual(['engine', 'transmission', 'tires', 'battery']);
  });

  it('leaves out a system whose state nobody recorded, whatever number it carries', () => {
    const { factors, bySystem } = wearFactors(stateOf({ tires: { wear: 0.9, basis: 'unknown', evidence: null }, brakes: { wear: 0.9, basis: 'unknown', evidence: 'verified' } }), 'declared');
    expect(factors).toEqual(ones);
    expect(bySystem).toEqual([]);
  });

  it('counts only wear with at least the evidence asked for', () => {
    const state = stateOf({
      engine: { wear: 1, basis: 'modelled', evidence: 'documented' },
      suspension: { wear: 1, basis: 'inspected', evidence: 'verified' },
      body: { wear: 1, basis: 'modelled', evidence: 'declared' },
    });
    const counted = (least: EvidenceLevel) => wearFactors(state, least).bySystem.map((entry) => [entry.system, entry.evidence]);
    expect(counted('declared')).toEqual([['engine', 'documented'], ['suspension', 'verified'], ['body', 'declared']]);
    expect(counted('documented')).toEqual([['engine', 'documented'], ['suspension', 'verified']]);
    expect(counted('verified')).toEqual([['suspension', 'verified']]);
  });

  it('at verified ignores everything that is not verified', () => {
    const state = stateOf({
      engine: { wear: 1, basis: 'modelled', evidence: 'documented' },
      suspension: { wear: 1, basis: 'inspected', evidence: 'verified' },
      body: { wear: 1, basis: 'modelled', evidence: 'declared' },
    });
    const { factors } = wearFactors(state, 'verified');
    expect(factors.handling).toBeCloseTo(0.82, 12);
    // The body is only declared: suspension alone costs DURABILITY here.
    expect(factors.durability).toBeCloseTo(0.94, 12);
    // The engine is only documented: nothing it would cost is charged.
    for (const key of ['power', 'speed', 'acceleration', 'reliability', 'efficiency'] as const) expect(factors[key]).toBe(1);
    // With nothing verified at all, ranked play sees an unworn car.
    expect(wearFactors(assessCondition(tired()), 'verified')).toEqual({ factors: ones, bySystem: [] });
  });

  it('never gives a higher factor for more wear', () => {
    for (const system of WEAR_SYSTEMS) {
      const last: Partial<Record<AttributeKey, number>> = {};
      for (let step = 0; step <= 20; step++) {
        const { factors } = wearFactors(only(system, { wear: step / 20, basis: 'modelled', evidence: 'declared' }), 'declared');
        for (const key of ATTRIBUTE_KEYS) {
          expect(factors[key]).toBeLessThanOrEqual(last[key] ?? 1);
          last[key] = factors[key];
        }
      }
    }
  });

  it('never raises a score, whatever the state says', () => {
    const next = mulberry32(20261110);
    const odd = [-1, -0.2, 0, 0.3, 0.999, 1, 1.5, 40, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const bases: SystemWear['basis'][] = ['modelled', 'inspected', 'unknown'];
    const evidences: (EvidenceLevel | null)[] = ['declared', 'documented', 'verified', null];
    for (let run = 0; run < 300; run++) {
      const systems = {} as Record<WearSystem, SystemWear>;
      for (const system of WEAR_SYSTEMS) {
        const wear = next() < 0.5 ? next() : odd[Math.floor(next() * odd.length)];
        systems[system] = { system, wear, basis: bases[Math.floor(next() * bases.length)], evidence: evidences[Math.floor(next() * evidences.length)], sinceMileage: null, sinceDate: null };
      }
      const state: ConditionState = { asOf: '2026-11-10', mileage: null, mileageEvidence: null, systems };
      for (const least of EVIDENCE_ORDER) {
        const { factors, bySystem } = wearFactors(state, least);
        for (const key of ATTRIBUTE_KEYS) {
          expect(factors[key]).toBeGreaterThan(0.5);
          expect(factors[key]).toBeLessThanOrEqual(1);
        }
        for (const entry of bySystem) {
          for (const factor of Object.values(entry.factors)) {
            expect(factor).toBeGreaterThan(0.69);
            expect(factor).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('a documented replacement restores a system toward new and never past it', () => {
    const worn = wearFactors(assessCondition(tired()), 'declared').factors;
    const repaired = wearFactors(assessCondition(tired({ replacements: [newEngine('documented')] })), 'declared').factors;
    // Engine wear 0.9 costs POWER 12% x 0.9^1.5; engine wear 0.05 costs 12% x 0.05^1.5.
    expect(worn.power).toBeCloseTo(0.897542, 5);
    expect(repaired.power).toBeCloseTo(0.998658, 5);
    for (const key of ATTRIBUTE_KEYS) {
      expect(repaired[key]).toBeGreaterThanOrEqual(worn[key]);
      expect(repaired[key]).toBeLessThanOrEqual(1);
    }
  });

  it('a declared replacement changes no factor', () => {
    expect(wearFactors(assessCondition(tired({ replacements: [newEngine('declared')] })), 'declared')).toEqual(wearFactors(assessCondition(tired()), 'declared'));
  });

  it('does not change the state it reads', () => {
    const state = frozen(assessCondition(tired({ inspections: [{ date: '2023-06-01', systems: { suspension: 0.4 } }] })));
    const before = JSON.stringify(state);
    const a = wearFactors(state, 'declared'), b = wearFactors(state, 'declared');
    expect(JSON.stringify(state)).toBe(before);
    expect(a).toEqual(b);
  });
});
