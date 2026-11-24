// Calibration and the check against tests, on two illustrative sheets: a 3,300 lb front-drive family sedan on
// all-season tyres and a 3,650 lb mid-engine sports car on max-performance tyres. Only the tyres' grip (to a skidpad
// figure, inside the category's range) and the drag area (to an ungoverned top speed, when no drag figure is on file)
// may be fitted; everything else is checked at the plan of record's tolerances.
import { describe, expect, it } from 'vitest';
import type { BenchResult, PhysicsSheet, Source } from './types';
import type { Check } from './calibrate';
import { skidpadAt, topSpeedOf } from './bench';
import { MEDIAN_QUARTER, MEDIAN_ZERO_TO_SIXTY, ORDER_GAP, TOLERANCE, calibrate, checkSheet, dragTarget, fleetMedians, orderInversions } from './calibrate';
import { tyreGripScaleRange } from './classes';
import { resolveModel } from './resolve';
import { emptySheet } from './sheet';

const src: Source = { kind: 'illustrative', name: 'typical figures for the class' };
const n = <T,>(value: T): { value: T; source: Source } => ({ value, source: src });

function sedan(): PhysicsSheet {
  const s = emptySheet('cal-sedan', { year: 2022, make: 'Illustrative', model: 'Sedan', trim: '2.5', bodyClass: 'sedan' });
  s.curbWeightLb = n(3300); s.drivetrain = n('FWD'); s.engineLocation = n('front'); s.transmissionType = n('automatic');
  s.powertrain = n('gasoline'); s.induction = n('natural'); s.displacementL = n(2.5); s.cylinders = n(4);
  s.horsepower = n(200); s.horsepowerRpm = n(6600); s.torqueLbFt = n(184); s.torqueRpmLow = n(5000); s.redlineRpm = n(6800);
  s.tyreFront = n('215/55R17'); s.tyreRear = n('215/55R17'); s.tyreCategory = n('all-season');
  s.wheelbaseIn = n(111.2); s.trackFrontIn = n(62.4); s.trackRearIn = n(62.8); s.lengthIn = n(192.1); s.widthIn = n(72.4); s.heightIn = n(56.9);
  return s;
}

function sports(): PhysicsSheet {
  const s = emptySheet('cal-sports', { year: 2022, make: 'Illustrative', model: 'Sports', trim: '6.2', bodyClass: 'sports' });
  s.curbWeightLb = n(3650); s.drivetrain = n('RWD'); s.engineLocation = n('mid'); s.transmissionType = n('dual-clutch');
  s.powertrain = n('gasoline'); s.induction = n('natural'); s.displacementL = n(6.2); s.cylinders = n(8);
  s.horsepower = n(495); s.horsepowerRpm = n(6450); s.torqueLbFt = n(470); s.torqueRpmLow = n(5150); s.redlineRpm = n(6600);
  s.tyreFront = n('245/35ZR19'); s.tyreRear = n('305/30ZR20'); s.tyreCategory = n('max-performance');
  s.wheelbaseIn = n(107.2); s.lengthIn = n(182.3); s.widthIn = n(76.1); s.heightIn = n(48.6); s.weightDistFrontPct = n(40);
  return s;
}

describe('fitting the tyres\' grip to a skidpad figure', () => {
  const sheet = sedan();
  sheet.tests.skidpadG = n(0.8);
  const fitted = calibrate(sheet);

  it('finds the grip scale at which the bench\'s 300 ft skidpad meets the test, inside the all-season range', () => {
    const scale = fitted.calibration.tyreGripScale as number;
    const range = tyreGripScaleRange('all-season');
    expect(scale).toBeGreaterThan(range.min);
    expect(scale).toBeLessThan(range.max);
    expect(scale).toBeGreaterThan(1);   // the class's all-season friction gives this sedan a little under 0.80 g
    expect(Math.abs(skidpadAt(resolveModel(fitted).model, 300) - 0.8)).toBeLessThan(0.003);
  });

  it('marks the grip calibrated and fits nothing else; the sheet it was given is not changed', () => {
    const { model, basis } = resolveModel(fitted);
    expect(basis['tyreFront.muY0']).toBe('calibrated');
    expect(basis['tyreRear.muY0']).toBe('calibrated');
    expect(fitted.calibration.dragAreaM2).toBeNull();   // no top speed on file to fit drag to
    expect(model.tyreFront.muY0).toBeCloseTo(0.92 * (fitted.calibration.tyreGripScale as number), 12);
    expect(sheet.calibration.tyreGripScale).toBeNull();
    expect(Object.values(basis).filter((b) => b === 'calibrated').length).toBe(2);
  });

  it('stops at the edge of the range when the test is out of the category\'s reach, and the check reports the miss', () => {
    const greedy = sedan();
    greedy.tests.skidpadG = n(1.05);   // a track tyre's figure: no all-season tyre gets there
    const out = calibrate(greedy);
    expect(out.calibration.tyreGripScale).toBeCloseTo(tyreGripScaleRange('all-season').max, 12);
    const bench = { skidpad300: skidpadAt(resolveModel(out).model, 300) } as BenchResult;
    const checks = checkSheet(out, bench);
    expect(checks.length).toBe(1);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].name).toContain('grip fitted');
    expect(checks[0].real - checks[0].model).toBeGreaterThan(0.1);
  });
});

describe('fitting the drag area to an ungoverned top speed', () => {
  it('fits it only when the sheet has no drag figure, no coast-down, and a top speed the car is not governed at', () => {
    const plain = sports();
    plain.topSpeedMph = n(190);
    expect(dragTarget(plain)).toBe(190);
    const withCd = sports(); withCd.topSpeedMph = n(190); withCd.dragCoefficient = n(0.35);
    expect(dragTarget(withCd)).toBeNull();
    const withCoast = sports(); withCoast.topSpeedMph = n(190); withCoast.roadLoadC = n(0.02);
    expect(dragTarget(withCoast)).toBeNull();
    const governed = sports(); governed.topSpeedMph = n(190); governed.topSpeedGoverned = n(true);
    expect(dragTarget(governed)).toBeNull();
    const family = sedan(); family.topSpeedMph = n(130);   // a family sedan's 130 mph is its governor
    expect(dragTarget(family)).toBeNull();
  });

  it('finds the drag area at which the bench\'s top speed meets it: 190 mph from 495 hp needs more drag than the class\'s', () => {
    const sheet = sports();
    sheet.topSpeedMph = n(190);
    const out = calibrate(sheet);
    const area = out.calibration.dragAreaM2 as number;
    expect(area).toBeGreaterThan(resolveModel(sheet).model.aero.dragArea);
    expect(area).toBeGreaterThan(0.6);
    expect(area).toBeLessThan(1.0);
    expect(Math.abs(topSpeedOf(resolveModel(out).model).mph - 190)).toBeLessThan(0.5);
    expect(resolveModel(out).basis['aero.dragArea']).toBe('calibrated');
  });
});

describe('the check against tests', () => {
  const bench = {
    zeroToSixty: 4.2, zeroToSixtyRollout: 3.9, timeslip: { quarter: 12.5, trapMph: 117 }, braking60: 104, braking70: 150,
    topSpeed: 155.4, topSpeedGoverned: true, skidpad300: 0.96, skidpad200: 0.97,
  } as BenchResult;
  const sheet = sports();
  sheet.tests.zeroToSixtySec = n(4.0); sheet.tests.quarterMileSec = n(12.2); sheet.tests.quarterMileMph = n(118);
  sheet.tests.braking60to0Ft = n(98); sheet.tests.braking70to0Ft = n(146); sheet.tests.topSpeedMph = n(155);
  sheet.tests.skidpadG = n(0.99);
  const checks = checkSheet(sheet, bench);
  const byName = (name: string) => checks.find((c) => c.name.startsWith(name)) as (typeof checks)[number];

  it('checks each test on file once, with the error as model minus real', () => {
    expect(checks.map((c) => c.name)).toEqual(['0-60 mph', 'quarter mile', 'trap speed', '60-0 mph', '70-0 mph', 'top speed', 'skidpad 300 ft']);
    for (const c of checks) expect(c.error).toBeCloseTo(c.model - c.real, 12);
  });

  it('0-60 within 7% or 0.3 s, whichever is larger: 4.2 s against 4.0 s passes on the 0.3 s floor', () => {
    expect(byName('0-60').tolerance).toBeCloseTo(0.3, 12);
    expect(byName('0-60').pass).toBe(true);
  });

  it('quarter mile and trap within 4%, braking within 7%', () => {
    expect(byName('quarter mile').tolerance).toBeCloseTo(0.488, 12);
    expect(byName('quarter mile').pass).toBe(true);    // 0.3 s slow
    expect(byName('trap speed').pass).toBe(true);
    expect(byName('60-0').tolerance).toBeCloseTo(6.86, 12);
    expect(byName('60-0').pass).toBe(true);            // 6 ft long
    expect(byName('70-0').pass).toBe(true);
  });

  it('a governed top speed within 1 mph of the test; a skidpad within 0.04 g on the nearer circle', () => {
    expect(byName('top speed').tolerance).toBe(TOLERANCE.governedMph);
    expect(byName('top speed').pass).toBe(true);
    expect(byName('skidpad').model).toBe(0.96);
    expect(byName('skidpad').pass).toBe(true);         // 0.03 g short
    const small = { ...sheet, tests: { ...sheet.tests, skidpadDiameterFt: n(200) } };
    const c = checkSheet(small, bench).find((k) => k.name.startsWith('skidpad'));
    expect(c?.name).toBe('skidpad 200 ft');
    expect(c?.model).toBe(0.97);
  });

  it('uses the rollout 0-60 when the tester left out the first foot, and misses by more than the tolerance fail', () => {
    const rolled = { ...sheet, tests: { ...sheet.tests, rollout: n(true), zeroToSixtySec: n(3.5) } };
    const c = checkSheet(rolled, bench)[0];
    expect(c.name).toBe('0-60 mph (rollout)');
    expect(c.model).toBe(3.9);
    expect(c.pass).toBe(false);                        // 0.4 s slow against a 0.3 s tolerance
  });

  it('does not check a skidpad figure the grip was fitted to, when the fit met it', () => {
    const fitted = { ...sheet, calibration: { tyreGripScale: 1.02, dragAreaM2: null } };
    const met = { ...bench, skidpad300: 0.99 } as BenchResult;
    expect(checkSheet(fitted, met).some((c) => c.name.startsWith('skidpad'))).toBe(false);
  });
});

describe('the fleet-wide criteria (plan of record, section 7)', () => {
  // Synthetic check tables: what checkSheet would write for cars whose figures are given.
  const row = (name: string, real: number, model: number, tolerance: number): Check => {
    const error = model - real;
    return { name, unit: name.startsWith('0-60') || name === 'quarter mile' ? 's' : 'ft', real, model, error, tolerance, pass: Math.abs(error) <= tolerance };
  };
  const z60 = (real: number, share: number): Check => row('0-60 mph', real, real * (1 + share), Math.max(0.07 * real, 0.3));
  const quarter = (real: number, share: number): Check => row('quarter mile', real, real * (1 + share), 0.04 * real);

  it('the medians can fail while every car passes its own checks: errors of 5 to 6% on 0-60 and 3.5% on the quarter', () => {
    const tables = [5.0, 6.0, 4.5, 3.0, 6.5].map((share, i) => [z60(4 + i, share / 100), quarter(12 + i, (i % 2 === 0 ? 3.5 : -3.5) / 100)]);
    for (const t of tables) for (const c of t) expect(c.pass, `${c.name} ${c.real}`).toBe(true);
    const m = fleetMedians(tables);
    expect(m.zeroToSixty).toBeCloseTo(0.05, 12);   // the middle of 3, 4.5, 5, 6, 6.5 percent
    expect(m.quarter).toBeCloseTo(0.035, 12);
    expect(m.zeroToSixty as number).toBeGreaterThan(MEDIAN_ZERO_TO_SIXTY);
    expect(m.quarter as number).toBeGreaterThan(MEDIAN_QUARTER);
  });

  it('takes the median of an even count as the mean of the middle two, counts the rollout 0-60 with the other, and is null without the figure', () => {
    const tables = [[z60(4, 0.01)], [row('0-60 mph (rollout)', 5, 5.2, 0.35)], [z60(6, -0.03)], [z60(7, 0.05), row('60-0 mph', 110, 120, 7.7)]];
    expect(fleetMedians(tables).zeroToSixty).toBeCloseTo(0.035, 12);   // 1, 3, 4, 5 percent: (3 + 4) / 2
    expect(fleetMedians(tables).quarter).toBeNull();
    expect(fleetMedians([])).toEqual({ zeroToSixty: null, quarter: null });
  });

  it('finds two cars more than 10% apart on a published figure that the core puts the other way round, though each is within tolerance', () => {
    // 4.0 s and 4.5 s (12.5% apart): the core says 4.25 s and 4.20 s, each inside its 7%, but the order is reversed.
    const cars = [
      { id: 'quick', checks: [z60(4.0, 0.0625), row('60-0 mph', 100, 104, 7)] },
      { id: 'slower', checks: [z60(4.5, -0.0667), row('60-0 mph', 109, 112, 7.6)] },
    ];
    for (const car of cars) for (const c of car.checks) expect(c.pass).toBe(true);
    const found = orderInversions(cars);
    expect(found.length).toBe(1);
    expect(found[0]).toContain('0-60 mph');
    expect(found[0]).toContain('quick');
    expect(found[0]).toContain('slower');
    // 100 ft and 109 ft are 9% apart: not a pair the plan holds the core to, whichever way the model puts them.
    const close = [{ id: 'a', checks: [row('60-0 mph', 100, 110, 7)] }, { id: 'b', checks: [row('60-0 mph', 109, 105, 7.6)] }];
    expect(orderInversions(close)).toEqual([]);
    // A tie in the model between two cars the tests set 20% apart is not the same order.
    const tie = [{ id: 'a', checks: [row('70-0 mph', 150, 160, 10.5)] }, { id: 'b', checks: [row('70-0 mph', 180, 160, 12.6)] }];
    expect(orderInversions(tie).length).toBe(1);
  });

  it('compares like with like: 60-0 with 60-0 and 70-0 with 70-0, the rollout 0-60 apart from the other', () => {
    const cars = [
      { id: 'a', checks: [row('60-0 mph', 100, 100, 7), row('0-60 mph (rollout)', 4, 4, 0.3)] },
      { id: 'b', checks: [row('70-0 mph', 150, 90, 10.5), z60(5, -0.5)] },
    ];
    expect(orderInversions(cars)).toEqual([]);
    expect(ORDER_GAP).toBe(0.1);
  });
});
