// The proof of DESIGN.md section 9 on whole cars. Four sheets with the figures a maker's specification lists, typical
// of their kind (sources "illustrative": they describe no particular car):
//   - a 3,300 lb front-drive family sedan, 2.5 L four, 200 hp, all-season tyres, an eight-speed automatic;
//   - a 3,650 lb mid-engine rear-drive sports car, 6.2 L V8, 495 hp, max-performance tyres, a dual-clutch;
//   - a 3,900 lb front-engine rear-drive coupe, 5.0 L V8, 480 hp, summer tyres, a six-speed manual;
//   - a 5,700 lb four-wheel-drive pickup, 3.5 L twin-turbo V6, 450 hp, all-terrain tyres, an automatic.
// Each is resolved by resolve.ts with nothing tuned, and then:
//   - the invariants hold (rest, energy, mirror, random input, replay, substep);
//   - the behaviour a driver knows emerges from the physics (throttle and lift in a corner, all-wheel drive off the
//     line, centre of gravity, mass, roll stiffness, power);
//   - the bench's figures land where a vehicle engineer would expect such cars to (bands fixed before the run; a band
//     that cannot be met honestly is left failing and reported, never moved);
//   - a step costs what a phone can afford.
import { describe, expect, it } from 'vitest';
import type { BenchResult, Build, Controls, PhysicsSheet, Source, SurfaceSample, VehicleModel, VehicleState, WorldQuery } from './types';
import { AUTO_GEAR } from './types';
import { runBench, runBenchWith, setRolling, skidpadAt } from './bench';
import { circleDriver, launchDriver } from './drivers';
import { G, datan2, rng } from './math';
import { tyreGripScaleRange } from './classes';
import { sheetById } from './data/sheets';
import { resolveModel } from './resolve';
import { GOLDEN, GOLDEN_STEPS, goldenLog, goldenRun, proofCoupeSheet, proofPickupSheet, proofSedanSheet, proofSportsSheet } from './golden';
import { fixtureModel } from './fixtures';
import { FLAT, defaultControls } from './state';
import { IN, LB } from './units';
import { STEP, createVehicle, hashState, step } from './vehicle';

/* ------------------------------------------------------------------ the four cars (their sheets are in golden.ts) */

const src: Source = { kind: 'illustrative', name: 'typical figures for the kind of car' };
const n = <T,>(value: T): { value: T; source: Source } => ({ value, source: src });

type Name = 'sedan' | 'sports' | 'coupe' | 'pickup';
const NAMES: readonly Name[] = ['sedan', 'sports', 'coupe', 'pickup'];
const SHEET: Record<Name, () => PhysicsSheet> = { sedan: proofSedanSheet, sports: proofSportsSheet, coupe: proofCoupeSheet, pickup: proofPickupSheet };

const models = new Map<string, VehicleModel>();
const benches = new Map<string, BenchResult>();
/** The car resolved from its sheet (cached: resolving and benching are pure). */
function model(name: Name): VehicleModel {
  let m = models.get(name);
  if (m === undefined) { m = resolveModel(SHEET[name]()).model; models.set(name, m); }
  return m;
}
/** The whole bench on that car (cached). */
function bench(name: Name): BenchResult {
  let b = benches.get(name);
  if (b === undefined) { b = runBench(model(name)); benches.set(name, b); }
  return b;
}
/** A sheet changed by `edit`, resolved (with a build when given). */
function variant(name: Name, edit: (s: PhysicsSheet) => void, build?: Build): VehicleModel {
  const s = SHEET[name]();
  edit(s);
  return resolveModel(s, build).model;
}
const steps = (seconds: number): number => Math.round(seconds / STEP);
const ctl = (over: Partial<Controls> = {}): Controls => ({ ...defaultControls(), ...over });
const LONG = 120000;

/**
 * More drivetrains for the invariants (plan section 7: "Invariants, for every car"): the GT-R sheet (a coupling all-
 * wheel drive behind a dual-clutch), and the sedan made an electric all-wheel drive, a CVT and an eCVT hybrid.
 */
let extras: [string, VehicleModel][] | null = null;
function extraCars(): [string, VehicleModel][] {
  if (extras !== null) return extras;
  const gtr = sheetById('2024-nissan-gt-r-nismo');
  if (gtr === null) throw new Error('no GT-R sheet');
  extras = [
    ['GT-R', resolveModel(gtr).model],
    ['electric AWD', variant('sedan', (s) => {
      s.powertrain = n('electric'); s.transmissionType = n('single-speed'); s.drivetrain = n('AWD'); s.displacementL = null; s.cylinders = null;
      s.induction = null; s.horsepower = n(400); s.torqueLbFt = n(400); s.horsepowerRpm = null; s.torqueRpmLow = null; s.redlineRpm = n(16000);
    })],
    ['CVT sedan', variant('sedan', (s) => { s.transmissionType = n('cvt'); })],
    ['eCVT hybrid', variant('sedan', (s) => { s.powertrain = n('hybrid'); s.transmissionType = n('ecvt'); })],
  ];
  return extras;
}
/** The four proof cars and the extra drivetrains. */
function everyCar(): [string, VehicleModel][] {
  const out: [string, VehicleModel][] = NAMES.map((name) => [name, model(name)]);
  return out.concat(extraCars());
}

describe('the four cars, resolved from their sheets with nothing tuned', () => {
  it('are what their sheets say: layout, gearbox, tyres and weight as driven (curb plus a 75 kg driver)', () => {
    const want: Record<Name, [string, string, string, number]> = {
      sedan: ['FWD', 'automatic', 'converter', 3300], sports: ['RWD', 'dual-clutch', 'clutch', 3650],
      coupe: ['RWD', 'manual', 'clutch', 3900], pickup: ['AWD', 'automatic', 'converter', 5700],
    };
    for (const name of NAMES) {
      const m = model(name), [layout, box, launch, lb] = want[name];
      expect(m.driveline.layout, name).toBe(layout);
      expect(m.driveline.transmission, name).toBe(box);
      expect(m.driveline.launch, name).toBe(launch);
      expect(m.chassis.mass, name).toBeCloseTo(lb * LB + 75, 6);
    }
    expect(model('sedan').driveline.gears.length).toBe(8);
    expect(model('pickup').driveline.centre.lockTorque).toBe(Infinity);   // part-time four-wheel drive, engaged
  });
});

/* ------------------------------------------------------------------ invariants */

describe('invariants', () => {
  it('at rest it stays at rest for a minute, within 1 mm: on the brakes in gear; a clutch car with nothing pressed; an automatic set in neutral', () => {
    for (const name of NAMES) {
      const m = model(name), converter = m.driveline.launch === 'converter';
      const cases: [string, (s: VehicleState) => Controls][] = [
        ['brake held', () => ctl({ brake: 1 })],
        [converter ? 'neutral' : 'nothing pressed', (s) => {
          if (!converter) return ctl();
          s.gear = 0; s.gearNext = 0; s.ratio = 0;
          return ctl({ gear: 0 });
        }],
      ];
      for (const [label, setup] of cases) {
        const s = createVehicle(m), c = setup(s);
        let far = 0;
        for (let k = 0; k < steps(60); k++) { step(s, c, FLAT); far = Math.max(far, Math.sqrt(s.x * s.x + s.y * s.y)); }
        expect(far, `${name}, ${label}`).toBeLessThan(0.001);
        expect(Math.abs(s.u), `${name}, ${label}`).toBeLessThan(1e-4);
      }
    }
  }, LONG);

  it('an automatic with all four wheels driven, held on a light brake in drive, does not creep: its brakes out-pull the converter', () => {
    // The pickup (part-time four-wheel drive engaged, so the centre is locked; open differentials) idles at about 720
    // rpm, where its converter pushes about 1,900 N m through first gear to the wheels; the tyres' rolling resistance
    // holds a little of that, so 2,150 N m of brake must hold it. The sedan with an on-demand coupling: about 800 N m
    // of creep, held by 850 N m. Below those (1,600 and 600 N m) both must creep, which shows the brake is the margin.
    // The pedal is set to give those torques on each car's own brakes.
    const awd = variant('sedan', (s) => { s.drivetrain = n('AWD'); });
    expect(awd.driveline.centre.kind).toBe('coupling');
    const pedal = (m: VehicleModel, torque: number): number => torque / (2 * (m.brakes.maxTorqueFront + m.brakes.maxTorqueRear));
    const cases: [string, VehicleModel, number, number][] = [
      ['pickup', model('pickup'), pedal(model('pickup'), 2150), pedal(model('pickup'), 1600)],
      ['sedan AWD', awd, pedal(awd, 850), pedal(awd, 600)],
    ];
    for (const [name, m, hold, light] of cases) {
      const s = createVehicle(m), c = ctl({ brake: hold });
      let x10 = NaN;
      for (let k = 0; k < steps(60); k++) { step(s, c, FLAT); if (k === steps(10)) x10 = s.x; }
      expect(Math.abs(s.x - x10) * 1000, `${name} at ${hold}: mm moved from 10 s to 60 s`).toBeLessThan(0.05);
      for (let i = 0; i < 4; i++) expect(Math.abs(s.wheelOmega[i]), `${name} wheel ${i}`).toBeLessThan(1e-9);
      const t = createVehicle(m), d = ctl({ brake: light });
      for (let k = 0; k < steps(20); k++) step(t, d, FLAT);
      expect(t.x, `${name} at ${light} creeps`).toBeGreaterThan(0.1);
    }
  }, LONG);

  it('an all-wheel-drive car on its handbrake on a 10% grade stays put, in neutral and in drive: every wheel dead still', () => {
    // The handbrake holds the rear wheels; the coupling holds the fronts to them. Its tyres settle on their springs in
    // the first second (1 to 3 mm on this grade); after that nothing may move.
    const hill: WorldQuery = { surfaceAt(_x: number, _y: number, out: SurfaceSample): void { out.height = 0; out.gradX = 0.1; out.gradY = 0; out.grip = 1; out.rolling = 1; } };
    const awdSedan = variant('sedan', (s) => { s.drivetrain = n('AWD'); });
    const rearOnDemand = variant('pickup', (s) => { s.drivetrain = n('AWD'); s.awdKind = n('rear-on-demand'); });
    for (const [name, m] of [['pickup', model('pickup')], ['sedan AWD', awdSedan], ['pickup on demand', rearOnDemand]] as const) {
      expect(m.driveline.centre.kind, name).toBe('coupling');
      for (const gear of [0, AUTO_GEAR]) {
        const s = createVehicle(m), c = ctl({ handbrake: 1, gear });
        let x1 = NaN;
        for (let k = 0; k < steps(61); k++) { step(s, c, hill); if (k === steps(1)) x1 = s.x; }
        expect(Math.abs(s.x - x1) * 1000, `${name}, gear ${gear}: mm moved from 1 s to 61 s`).toBeLessThan(1);
        // The braked rears exactly still; the fronts, held through the coupling, still to the rounding of its sums.
        for (let i = 2; i < 4; i++) expect(s.wheelOmega[i], `${name}, gear ${gear}, wheel ${i}`).toBe(0);
        for (let i = 0; i < 2; i++) expect(Math.abs(s.wheelOmega[i]), `${name}, gear ${gear}, wheel ${i}`).toBeLessThan(1e-12);
      }
    }
  }, LONG);

  it('moving the selector to neutral opens the drive at once: revving it there, or letting a converter idle, moves nothing', () => {
    // Held on the brake in first, then the brake let go as neutral is selected: the box has only to open its clutch,
    // so no share of the old gear's drive may reach the wheels through the shift time.
    for (const name of ['sports', 'sedan', 'coupe'] as const) {
      for (const throttle of [0, 1]) {
        const s = createVehicle(model(name)), c = ctl({ brake: 1, gear: 1 });
        for (let k = 0; k < steps(1); k++) step(s, c, FLAT);
        c.brake = 0; c.gear = 0; c.throttle = throttle;
        let far = 0;
        for (let k = 0; k < steps(3); k++) { step(s, c, FLAT); far = Math.max(far, Math.abs(s.x)); }
        expect(s.gear, name).toBe(0);
        expect(far * 1000, `${name}, throttle ${throttle}: mm moved`).toBeLessThan(1);
      }
    }
  }, LONG);

  it('an automatic in drive with the brake off creeps at a walking pace, as its converter makes it (the one standstill a car is allowed to leave)', () => {
    for (const name of ['sedan', 'pickup'] as const) {
      const s = createVehicle(model(name)), c = ctl();
      for (let k = 0; k < steps(20); k++) step(s, c, FLAT);
      expect(s.u, name).toBeGreaterThan(0.5);
      expect(s.u, name).toBeLessThan(2.5);
    }
  }, LONG);

  it('with no input its energy never rises: coasting in gear from 30 m/s, and in neutral to rest, on every drivetrain', () => {
    // The car's motion, its wheels' spin and its engine's: a CVT or a power-split hybrid hands the flywheel's energy
    // to the wheels as its ratio moves, so without the engine the sum is not the car's energy. The one input with the
    // pedal up is a shift's rev-match (the box's own blip, or the driver's), paid for in fuel: those steps are left out.
    const energy = (s: VehicleState, engine: boolean): number => {
      const m = s.model, w = s.wheelOmega;
      return 0.5 * m.chassis.mass * (s.u * s.u + s.v * s.v) + 0.5 * m.chassis.izz * s.r * s.r
        + 0.5 * m.wheelInertiaFront * (w[0] * w[0] + w[1] * w[1]) + 0.5 * m.wheelInertiaRear * (w[2] * w[2] + w[3] * w[3])
        + (engine ? 0.5 * m.engine.inertia * s.engineOmega * s.engineOmega : 0);
    };
    for (const [name, m] of everyCar()) {
      const variator = m.driveline.transmission === 'cvt' || m.driveline.transmission === 'ecvt';
      for (const neutral of [false, true]) {
        const s = createVehicle(m), c = ctl();
        setRolling(s, 30, 0);
        if (neutral) { s.gear = 0; s.gearNext = 0; s.ratio = 0; c.gear = 0; }
        let before = energy(s, true), motion = energy(s, false), rises = 0, motionRises = 0, k = 0, shifting = false;
        // In gear, down to 3 m/s: below that an automatic's converter may creep, which the engine pays for.
        for (; k < steps(400) && s.u > (neutral ? 0.01 : 3); k++) {
          const gear = s.gear, was = s.shiftTimer > 0;
          step(s, c, FLAT);
          const now = energy(s, true), moving = energy(s, false);
          const shift = was || s.shiftTimer > 0 || s.gear !== gear;
          if (now > before && !shift && !shifting) rises++;
          if (moving > motion) motionRises++;
          shifting = shift; before = now; motion = moving;
        }
        const label = `${name}${neutral ? ' in neutral' : ''}`;
        expect(rises, label).toBe(0);
        // A stepped box or a direct drive never feeds the car from the flywheel at all, shifts included.
        if (!variator) expect(motionRises, `${label}, motion and wheels alone`).toBe(0);
        expect(k, label).toBeGreaterThan(steps(10));   // it coasted a long way: the test saw something
      }
    }
  }, LONG);

  it('every extra drivetrain also stays at rest for a minute on the brake and in neutral, and mirrors its path', () => {
    for (const [name, m] of extraCars()) {
      for (const c of [ctl({ brake: 1 }), ctl({ gear: 0 })]) {
        const s = createVehicle(m);
        if (c.gear === 0) { s.gear = 0; s.gearNext = 0; s.ratio = 0; }
        let far = 0;
        for (let k = 0; k < steps(60); k++) { step(s, c, FLAT); far = Math.max(far, Math.sqrt(s.x * s.x + s.y * s.y)); }
        expect(far, `${name}, ${c.gear === 0 ? 'neutral' : 'brake held'}`).toBeLessThan(0.001);
      }
      const run = (side: number): VehicleState => {
        const s = createVehicle(m), c = ctl({ throttle: 0.6 });
        for (let k = 0; k < steps(8); k++) { if (k === steps(2)) { c.steer = 0.25 * side; c.throttle = 0.4; } step(s, c, FLAT); }
        return s;
      };
      const left = run(1), right = run(-1);
      expect(left.y, name).toBeGreaterThan(5);
      expect(Math.abs(left.x - right.x), name).toBeLessThan(1e-6);
      expect(Math.abs(left.y + right.y), name).toBeLessThan(1e-6);
      expect(Math.abs(left.r + right.r), name).toBeLessThan(1e-9);
    }
  }, LONG);

  it('mirrored steering gives a mirrored path', () => {
    for (const name of NAMES) {
      const run = (side: number): VehicleState => {
        const s = createVehicle(model(name)), c = ctl({ throttle: 0.6 });
        for (let k = 0; k < steps(8); k++) {
          if (k === steps(2)) { c.steer = 0.25 * side; c.throttle = 0.4; }
          step(s, c, FLAT);
        }
        return s;
      };
      const left = run(1), right = run(-1);
      expect(left.y, name).toBeGreaterThan(5);                 // it did turn
      expect(Math.abs(left.x - right.x), name).toBeLessThan(1e-6);
      expect(Math.abs(left.y + right.y), name).toBeLessThan(1e-6);
      expect(Math.abs(left.hy + right.hy), name).toBeLessThan(1e-9);
      expect(Math.abs(left.r + right.r), name).toBeLessThan(1e-9);
    }
  }, LONG);

  it('100,000 steps of random input on each car give no NaN and no runaway', () => {
    for (const name of NAMES) {
      const m = model(name), s = createVehicle(m), c = ctl(), rand = rng(name.length * 7919);
      const top = bench(name).topSpeed;
      let fastest = 0, worstEngine = 0, nan = 0, next = 0;
      for (let k = 0; k < 100000; k++) {
        // Each input held for a random quarter of a second to six seconds, so the car reaches every speed it can.
        if (k === next) {
          next = k + Math.floor(steps(0.25) + rand() * steps(6));
          const flat = rand() < 0.4;
          c.throttle = flat ? 1 : rand() < 0.3 ? 0 : rand();
          c.brake = flat || rand() < 0.75 ? 0 : rand();
          c.steer = rand() < 0.4 ? 0 : 2 * rand() - 1;
          c.handbrake = rand() < 0.95 ? 0 : rand();
          c.gear = rand() < 0.9 ? AUTO_GEAR : Math.floor(rand() * (m.driveline.gears.length + 2)) - 1;
          c.abs = rand() < 0.8; c.tcs = rand() < 0.8; c.esc = rand() < 0.8;
        }
        step(s, c, FLAT);
        const speed = Math.sqrt(s.u * s.u + s.v * s.v);
        if (!(Number.isFinite(speed) && Number.isFinite(s.r) && Number.isFinite(s.x) && Number.isFinite(s.engineOmega)
          && s.wheelOmega.every(Number.isFinite) && s.wheelLoad.every(Number.isFinite))) nan++;
        fastest = Math.max(fastest, speed);
        worstEngine = Math.max(worstEngine, s.engineOmega / m.engine.redline);
      }
      expect(nan, name).toBe(0);
      expect(fastest, name).toBeGreaterThan(25);                        // it was driven hard
      expect(fastest * 2.2369, name).toBeLessThan(1.05 * top + 5);      // never faster than flat out allows (mph)
      expect(worstEngine, name).toBeLessThan(2.5);                      // a wrong gear may over-rev it, never run away
    }
  }, LONG);

  it('the same input log gives the same state hash at every step; one control different and it differs', () => {
    for (const name of NAMES) {
      const rand = rng(1234), log: Controls[] = [];
      for (let k = 0; k < 2000; k++) {
        const prev = log.length > 0 ? log[log.length - 1] : ctl();
        log.push(k % 40 === 0 ? ctl({ throttle: rand(), brake: rand() < 0.8 ? 0 : rand(), steer: 2 * rand() - 1 }) : prev);
      }
      const a = createVehicle(model(name)), b = createVehicle(model(name)), d = createVehicle(model(name));
      let same = true;
      for (let k = 0; k < log.length; k++) {
        step(a, log[k], FLAT); step(b, log[k], FLAT);
        step(d, k === 1000 ? { ...log[k], steer: log[k].steer + 1e-9 } : log[k], FLAT);
        if (hashState(a) !== hashState(b)) same = false;
      }
      expect(same, name).toBe(true);
      expect(hashState(d), name).not.toBe(hashState(a));
      expect(a.distance, name).toBeGreaterThan(20);
    }
  }, LONG);

  it('the golden run ends on the pinned state hash on every car: the same bits as every other machine and browser', () => {
    // golden.ts drives a fixed 2,000-step input log on each proof car; its hash is pinned there. A platform that
    // computed one bit differently anywhere in the run would end on another hash.
    expect(goldenLog().length).toBe(GOLDEN_STEPS);
    for (const name of NAMES) expect(goldenRun(name), name).toBe(GOLDEN[name]);
    // The log does drive the cars (throttle, brakes, steering), so the hash covers a run that went somewhere.
    const log = goldenLog();
    expect(log.some((c) => c.brake > 0) && log.some((c) => c.steer < -0.5) && log.some((c) => c.steer > 0.5)).toBe(true);
  }, LONG);

  it('halving the substep moves no bench figure by more than 1%', () => {
    for (const name of NAMES) {
      const a = bench(name), b = runBenchWith(model(name), 'all', 8);
      const pairs: [string, number, number][] = [
        ['0-30', a.zeroToThirty, b.zeroToThirty], ['0-60', a.zeroToSixty, b.zeroToSixty], ['0-100', a.zeroToHundred, b.zeroToHundred],
        ['0-60 rollout', a.zeroToSixtyRollout, b.zeroToSixtyRollout], ['launch rpm', a.launchRpm, b.launchRpm], ['shift rpm', a.shiftRpm, b.shiftRpm],
        ['braking 60', a.braking60, b.braking60], ['braking 70', a.braking70, b.braking70],
        ['skidpad 300', a.skidpad300, b.skidpad300], ['skidpad 200', a.skidpad200, b.skidpad200], ['top speed', a.topSpeed, b.topSpeed],
      ];
      for (const k of ['sixtyFoot', 'threeThirty', 'eighth', 'thousand', 'quarter', 'eighthMph', 'trapMph'] as const) pairs.push([k, a.timeslip[k], b.timeslip[k]]);
      let differ = 0;
      for (const [what, x, y] of pairs) {
        expect(Number.isFinite(x), `${name} ${what}`).toBe(true);
        expect(Math.abs(y / x - 1), `${name} ${what}: ${x} at 4 substeps, ${y} at 8`).toBeLessThan(0.01);
        if (x !== y) differ++;
      }
      // The halved substep did run: some figure moved, however little. (Were the count ignored, every figure would
      // be compared with itself and the test above could not fail.)
      expect(differ, name).toBeGreaterThan(0);
    }
  }, LONG);
});

/* ------------------------------------------------------------------ behaviour that must emerge */

/**
 * A steady corner near the limit: the circle driver holds a 300 ft circle at `share` of the car's skidpad figure for
 * 15 s; then the steering is frozen where it is and, for one second, the throttle is held (the control), floored, or
 * lifted, with stability and traction control off. Returns how far outside the circle the car ends, the heading it
 * turned through, its final yaw rate and its sideslip angle (rad; negative is the tail out).
 */
function corner(name: Name, action: 'hold' | 'floor' | 'lift', share = 0.9): { wide: number; turned: number; r: number; beta: number } {
  const m = model(name), R = 150 * 0.3048, v = Math.sqrt(share * bench(name).skidpad300 * G * R);
  const s = createVehicle(m), c = defaultControls(), d = circleDriver(m, 0, R, R, v, 0);
  setRolling(s, v, v / R);
  for (let k = 0; k < steps(15); k++) { d.control(s, c); step(s, c, FLAT); }
  const steer = c.steer, throttle = c.throttle, gear = s.gear;
  let last = datan2(s.hy, s.hx), turned = 0;
  for (let k = 0; k < steps(1); k++) {
    c.steer = steer; c.gear = gear; c.brake = 0; c.esc = false; c.tcs = false;
    c.throttle = action === 'hold' ? throttle : action === 'floor' ? 1 : 0;
    step(s, c, FLAT);
    const a = datan2(s.hy, s.hx);
    let da = a - last;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    turned += da; last = a;
  }
  return { wide: Math.sqrt(s.x * s.x + (s.y - R) * (s.y - R)) - R, turned, r: s.r, beta: datan2(s.v, s.u) };
}

describe('behaviour that must emerge', () => {
  it('in a steady corner at the limit, adding throttle runs the front-drive sedan wide: it yaws less and leaves the line', () => {
    const hold = corner('sedan', 'hold'), floor = corner('sedan', 'floor');
    expect(floor.wide - hold.wide).toBeGreaterThan(0.3);   // m further out after one second
    expect(floor.r).toBeLessThan(0.9 * hold.r);
    expect(floor.turned).toBeLessThan(hold.turned);
  }, LONG);

  it('...and rotates the powerful rear-drive coupe: it yaws more and its tail steps out', () => {
    const hold = corner('coupe', 'hold'), floor = corner('coupe', 'floor');
    expect(floor.turned).toBeGreaterThan(1.3 * hold.turned);
    expect(floor.r).toBeGreaterThan(1.3 * hold.r);
    expect(floor.beta).toBeLessThan(hold.beta - 0.05);     // at least 3 degrees more tail-out sideslip
  }, LONG);

  it('lifting off in a steady corner tightens the line, whatever drives the wheels', () => {
    for (const name of NAMES) {
      const hold = corner(name, 'hold'), lift = corner(name, 'lift');
      expect(lift.wide, name).toBeLessThan(hold.wide - 0.05);
      expect(lift.turned, name).toBeGreaterThan(hold.turned);
    }
  }, LONG);

  it('left to choose its gears at full throttle with traction control off, a car changes up and never back down, wheelspin or not', () => {
    // A gearbox reads its output shaft; with the driven wheels spinning past their peak that is not the road speed,
    // and a box that took it for one would change up at walking pace, fall back as the wheels caught the road in the
    // shift, and hunt. So the coupe and the fixture (rear drive, manual, a 0.3 s shift) on dry, damp and wet roads.
    const surface = (grip: number): WorldQuery => ({ surfaceAt(_x: number, _y: number, out: SurfaceSample): void { out.height = 0; out.gradX = 0; out.gradY = 0; out.grip = grip; out.rolling = 1; } });
    for (const [name, m] of [['coupe', model('coupe')], ['fixture', fixtureModel()]] as const) {
      for (const grip of [0.5, 0.85, 1]) {
        const s = createVehicle(m), c = ctl({ throttle: 1, tcs: false }), world = surface(grip);
        let last = s.gear, downs = 0, ups = 0, spun = 0;
        for (let k = 0; k < steps(12); k++) {
          step(s, c, world);
          if (s.gear < last) downs++;
          if (s.gear > last) ups++;
          last = s.gear;
          const R = m.tyreRear.radius;
          if (s.u > 1 && s.wheelOmega[2] * R > 1.5 * s.u) spun++;
        }
        expect(downs, `${name} at grip ${grip}: changes down`).toBe(0);
        // On a wet road the wheels spin past their peak in first until the road speed catches up (the box holds the
        // gear it cannot judge, as the tyres slide at the same friction in either gear); then it changes up.
        expect(ups, `${name} at grip ${grip}: changes up`).toBeGreaterThanOrEqual(grip < 0.8 ? 1 : 2);
        if (grip < 1) expect(spun, `${name} at grip ${grip}: the wheels did spin`).toBeGreaterThan(steps(0.5));
      }
    }
  }, LONG);

  it('an automatic asked for first at speed takes it only when first would not over-rev the engine, as its controller does', () => {
    // At 40 m/s first gear would turn either engine at two to three times its redline. The box goes down as far as
    // redline allows and takes first once the car has slowed enough for it.
    for (const name of ['pickup', 'sedan'] as const) {
      const m = model(name), s = createVehicle(m), c = ctl({ throttle: 0.2 });
      setRolling(s, 40, 0);
      for (let k = 0; k < steps(2); k++) step(s, c, FLAT);
      c.gear = 1; c.throttle = 0; c.brake = 0.3;
      let worst = 0;
      for (let k = 0; k < steps(20) && s.u > 2; k++) { step(s, c, FLAT); worst = Math.max(worst, s.engineOmega); }
      expect(worst / m.engine.redline, `${name}: highest engine speed over redline`).toBeLessThan(1.05);
      expect(s.gear, name).toBe(1);
    }
  }, LONG);

  it('a car choosing its own gear keeps it when the driven wheels lock under the handbrake', () => {
    // Locked rear wheels say 0 km/h at the output shaft; the road is still going by at 20 m/s.
    const m = model('coupe'), s = createVehicle(m), c = ctl({ throttle: 0.3 });
    setRolling(s, 20, 0);
    for (let k = 0; k < steps(3); k++) step(s, c, FLAT);
    const gear = s.gear;
    expect(gear).toBeGreaterThan(1);
    c.throttle = 0; c.handbrake = 1;
    let least = gear, locked = 0;
    for (let k = 0; k < steps(1.5) && s.u > 3; k++) {
      step(s, c, FLAT);
      least = Math.min(least, s.gear);
      if (s.wheelOmega[2] === 0 && s.wheelOmega[3] === 0) locked++;
    }
    expect(locked).toBeGreaterThan(steps(0.3));   // the rear wheels were locked
    expect(least).toBeGreaterThanOrEqual(gear - 1);   // at most the one gear the slowing car itself asks for
  }, LONG);

  it('a clutch launched at high revs bites only until first gear has caught up: after every upshift it is closed', () => {
    // The auto-clutch holds the bite speed (here the launch speed, 4,950 rpm) only while the car is slower than first
    // gear at that speed; above it, a clutch that slipped again after a shift would flare the engine and waste power.
    const m = model('sports'), launch = 4950 * Math.PI / 30;
    const d = launchDriver(m, launch, 1), s = createVehicle(m), c = ctl();
    const R = m.tyreRear.radius, match = launch / (m.driveline.gears[0] * m.driveline.finalDrive) * R;
    let slipping = 0, bitten = 0, top = 1;
    while (s.time < 12 && s.u < 100 * 0.44704) {
      d.control(s, c);
      const shifting = s.shiftTimer > 0;   // a shift that ends inside this step ends in it, not before it
      step(s, c, FLAT);
      top = Math.max(top, s.gear);
      if (s.u < match && s.clutchLocked === 0) bitten++;
      if (s.u > match && s.gear >= 2 && !shifting && s.shiftTimer === 0 && s.clutchLocked === 0) slipping++;
    }
    expect(c.launchOmega).toBe(launch);   // the driver kept the launch speed set all the way
    expect(top).toBeGreaterThanOrEqual(3);
    expect(bitten).toBeGreaterThan(steps(0.3));   // it did slip pulling away
    expect(slipping / 120, 's of clutch slip after upshifts').toBe(0);
  }, LONG);

  it('the same sports car launches harder with all-wheel drive than with rear drive', () => {
    const rwd = bench('sports'), awd = runBench(variant('sports', (s) => { s.drivetrain = n('AWD'); }), 'accel');
    expect(awd.timeslip.sixtyFoot).toBeLessThan(rwd.timeslip.sixtyFoot - 0.05);
    expect(awd.zeroToThirty).toBeLessThan(rwd.zeroToThirty - 0.05);
    expect(awd.zeroToSixty).toBeLessThan(rwd.zeroToSixty);
  }, LONG);

  it('raising the centre of gravity 30% lowers the skidpad figure', () => {
    for (const name of NAMES) {
      const h = model(name).chassis.cgHeight / IN;
      const base = skidpadAt(variant(name, (s) => { s.cgHeightIn = n(h); }), 300);
      const high = skidpadAt(variant(name, (s) => { s.cgHeightIn = n(1.3 * h); }), 300);
      expect(Math.abs(base / bench(name).skidpad300 - 1), name).toBeLessThan(0.005);   // the same car, with its height on file
      expect(high, name).toBeLessThan(base - 0.005);
    }
  }, LONG);

  it('adding 300 kg lowers the skidpad figure and never shortens a stop or a 0-60', () => {
    for (const name of NAMES) {
      const heavy = variant(name, (s) => { s.curbWeightLb = n((s.curbWeightLb?.value ?? 0) + 300 / LB); });
      const b = runBench(heavy, 'brake'), a = runBench(heavy, 'accel');
      expect(skidpadAt(heavy, 300), name).toBeLessThan(bench(name).skidpad300);
      expect(b.braking60, name).toBeGreaterThanOrEqual(bench(name).braking60);
      expect(b.braking70, name).toBeGreaterThanOrEqual(bench(name).braking70);
      expect(a.zeroToSixty, name).toBeGreaterThan(bench(name).zeroToSixty);
    }
  }, LONG);

  it('more rear anti-roll bar moves the balance toward oversteer: less steer for the same corner, the tail further out', () => {
    // Steady on a 300 ft circle at 0.65 g: the steer needed and the sideslip of the body, averaged over 5 s.
    const steady = (m: VehicleModel): { steer: number; beta: number } => {
      const R = 150 * 0.3048, v = Math.sqrt(0.65 * G * R);
      const s = createVehicle(m), c = defaultControls(), d = circleDriver(m, 0, R, R, v, 0);
      setRolling(s, v, v / R);
      let steer = 0, beta = 0, k = 0;
      for (; k < steps(20); k++) {
        d.control(s, c); step(s, c, FLAT);
        if (k >= steps(15)) { steer += c.steer * m.chassis.maxSteer; beta += datan2(s.v, s.u); }
      }
      return { steer: steer / steps(5), beta: beta / steps(5) };
    };
    // The sedan's rear bar made 2.5 times as stiff. The coupe has none (its rear springs alone carry the class's share
    // of roll stiffness, as the sports car's and the pickup's do): it is fitted one half as stiff as its front bar.
    for (const name of ['sedan', 'coupe'] as const) {
      const base = steady(model(name));
      const m = resolveModel(SHEET[name]()).model, ch = m.chassis;
      ch.arbRear = ch.arbRear > 0 ? 2.5 * ch.arbRear : 0.5 * ch.arbFront;
      expect(ch.arbRear, name).toBeGreaterThan(model(name).chassis.arbRear);
      const stiff = steady(m);
      expect(stiff.steer, name).toBeLessThan(base.steer - 0.001);   // measurably less lock: 0.11 to 0.14 degree here
      expect(stiff.beta, name).toBeLessThan(base.beta);
    }
  }, LONG);

  it('more power is never slower over the quarter mile', () => {
    for (const name of NAMES) {
      const strong = variant(name, (s) => {
        s.horsepower = n((s.horsepower?.value ?? 0) * 1.15);
        s.torqueLbFt = n((s.torqueLbFt?.value ?? 0) * 1.15);
      });
      const a = runBench(strong, 'accel');
      expect(a.timeslip.quarter, name).toBeLessThan(bench(name).timeslip.quarter);
      expect(a.timeslip.trapMph, name).toBeGreaterThan(bench(name).timeslip.trapMph);
    }
  }, LONG);

  it('on a split surface traction control\'s brake lets the gripping wheel push: front and four-wheel drive pull away a fifth faster, none slower', () => {
    // Left wheels on 0.3 grip, right on dry, full throttle from rest, stability control off. An open differential holds
    // the axle to twice what the slippery wheel can take; braking that wheel sends its torque across. The coupe's
    // limited-slip differential already does it, so traction control there must at least do no harm.
    const SPLIT: WorldQuery = {
      surfaceAt(_x: number, y: number, out: SurfaceSample): void { out.height = 0; out.gradX = 0; out.gradY = 0; out.grip = y > 0 ? 0.3 : 1; out.rolling = 1; },
    };
    const away = (name: Name, tcs: boolean): VehicleState => {
      const s = createVehicle(model(name)), c = defaultControls();
      c.throttle = 1; c.tcs = tcs; c.esc = false;
      for (let k = 0; k < Math.round(3 / STEP); k++) step(s, c, SPLIT);
      return s;
    };
    for (const name of ['sedan', 'pickup', 'coupe'] as const) {
      const on = away(name, true), off = away(name, false);
      if (name !== 'coupe') expect(on.u / off.u, name).toBeGreaterThan(1.2);
      expect(on.u / off.u, name).toBeGreaterThan(0.99);
      expect(Math.abs(on.y), name).toBeLessThanOrEqual(Math.abs(off.y) + 0.1);
    }
  }, LONG);
});

/* ------------------------------------------------------------------ plausibility */

describe('plausibility: where a vehicle engineer expects these four cars, nothing tuned to land there', () => {
  it('the family sedan: 0-60 in 6.5 to 9 s, 60-0 in 115 to 140 ft', () => {
    const b = bench('sedan');
    expect(b.zeroToSixty).toBeGreaterThan(6.5); expect(b.zeroToSixty).toBeLessThan(9);
    expect(b.braking60).toBeGreaterThan(115); expect(b.braking60).toBeLessThan(140);
  }, LONG);

  // The sedan sits low in this band: 0.790 g, 86% of its 0.916 g friction limit at static loads. Real front-drive
  // sedans of its size on all-season tyres post about 0.82 to 0.86 g; the gap is in the cornering, not in traction
  // control (the figure is the same with it off). A car with a published skidpad is calibrated to it (calibrate.ts),
  // so the gap matters only for cars without one. It was 0.776 g, below the band, until front-drive cars stopped
  // taking the class's understeering margin in their roll split (resolve.ts, resolveChassis).
  it('the family sedan: 0.78 to 0.90 g on the 300 ft skidpad', () => {
    const b = bench('sedan');
    expect(b.skidpad300).toBeGreaterThanOrEqual(0.78); expect(b.skidpad300).toBeLessThanOrEqual(0.90);
  }, LONG);

  it('the sports car: 0-60 in 2.7 to 3.6 s, 0.98 to 1.10 g, 60-0 in 95 to 115 ft', () => {
    const b = bench('sports');
    expect(b.zeroToSixty).toBeGreaterThan(2.7); expect(b.zeroToSixty).toBeLessThan(3.6);
    expect(b.skidpad300).toBeGreaterThanOrEqual(0.98); expect(b.skidpad300).toBeLessThanOrEqual(1.10);
    expect(b.braking60).toBeGreaterThan(95); expect(b.braking60).toBeLessThan(115);
  }, LONG);

  it('the coupe: 0-60 in 4.0 to 5.2 s', () => {
    const b = bench('coupe');
    expect(b.zeroToSixty).toBeGreaterThan(4.0); expect(b.zeroToSixty).toBeLessThan(5.2);
  }, LONG);

  it('the pickup: 0.66 to 0.80 g, 60-0 in 125 to 155 ft', () => {
    const b = bench('pickup');
    expect(b.skidpad300).toBeGreaterThanOrEqual(0.66); expect(b.skidpad300).toBeLessThanOrEqual(0.80);
    expect(b.braking60).toBeGreaterThan(125); expect(b.braking60).toBeLessThan(155);
  }, LONG);

  it('full pedal reaches the tyres\' grip, so a stop is the tyres\': 1.4 times the brake torque shortens no 60-0 by more than 1.5%', () => {
    // Max-performance tyres brake at up to 1.37 g at the top of their range, and a hard stop puts well over the class
    // bias on the front axle: brakes sized at a flat 1.3 g would leave such a stop limited by the calipers.
    const top = (name: Name): PhysicsSheet => {
      const s = SHEET[name]();
      s.calibration.tyreGripScale = tyreGripScaleRange(s.tyreCategory?.value ?? 'summer').max;
      return s;
    };
    const gtr = sheetById('2024-nissan-gt-r-nismo');
    if (gtr === null) throw new Error('no GT-R sheet');
    const cases: [string, () => PhysicsSheet][] = [
      ['sports', SHEET.sports], ['sports at the top of its grip range', () => top('sports')], ['coupe at the top of its grip range', () => top('coupe')],
      ['GT-R', () => sheetById('2024-nissan-gt-r-nismo') as PhysicsSheet],
    ];
    for (const [name, sheet] of cases) {
      const stock = resolveModel(sheet()).model, strong = resolveModel(sheet()).model;
      strong.brakes.maxTorqueFront *= 1.4; strong.brakes.maxTorqueRear *= 1.4;
      const a = runBench(stock, 'brake').braking60, b = runBench(strong, 'brake').braking60;
      expect(a / b - 1, `${name}: ${a.toFixed(1)} ft as sized, ${b.toFixed(1)} ft with 1.4 times the torque`).toBeLessThan(0.015);
    }
  }, LONG);

  it('every quarter-mile trap speed within 6% of 234 x (hp / lb as driven)^(1/3) mph', () => {
    for (const name of NAMES) {
      const sheet = SHEET[name]();
      const hp = sheet.horsepower?.value ?? NaN, lb = (sheet.curbWeightLb?.value ?? NaN) + 75 / LB;
      const expected = 234 * Math.cbrt(hp / lb);
      expect(Math.abs(bench(name).timeslip.trapMph / expected - 1), `${name}: ${bench(name).timeslip.trapMph} mph against ${expected}`).toBeLessThan(0.06);
    }
  }, LONG);
});

/* ------------------------------------------------------------------ cost */

// The host's clock, console and environment: not in the ES2020 library the package compiles against, so reached
// through globalThis.
type Host = { performance: { now(): number }; console: { log(...args: unknown[]): void }; process?: { env?: Record<string, string | undefined> } };
const host = globalThis as unknown as Host;

/**
 * The plan's budget for one step, microseconds (DESIGN.md 9; plan section 7: on the CI machine). A slow local machine
 * may loosen it only by setting PHYSICS_STEP_BUDGET_US explicitly; nothing loosens it by itself.
 */
function stepBudget(): number {
  const asked = Number(host.process?.env?.PHYSICS_STEP_BUDGET_US);
  return asked > 0 ? asked : 20;
}

describe('the cost of a step', () => {
  it('is 20 microseconds or less on each car (the fastest of five batches of 4,000 steps, after a warm-up)', () => {
    const budget = stepBudget(), results: string[] = [];
    for (const name of NAMES) {
      const s = createVehicle(model(name)), c = ctl();
      let k = 0;
      const drive = (): void => {
        c.throttle = k % 2400 < 1500 ? 1 : 0; c.brake = k % 2400 >= 1900 ? 0.6 : 0; c.steer = k % 900 < 450 ? 0.2 : -0.2;
        step(s, c, FLAT);
        k++;
      };
      for (let i = 0; i < 4000; i++) drive();   // warm the compiler
      // The fastest batch: the scheduler and the collector only ever add time, so the least is the step's own cost.
      let us = Infinity;
      for (let batch = 0; batch < 5; batch++) {
        const t0 = host.performance.now();
        for (let i = 0; i < 4000; i++) drive();
        us = Math.min(us, (host.performance.now() - t0) * 1000 / 4000);
      }
      results.push(`${name} ${us.toFixed(2)} us`);
      expect(us, `${name}: ${us} us a step against ${budget}`).toBeLessThanOrEqual(budget);
    }
    host.console.log(`step cost: ${results.join(', ')} (budget ${budget} us)`);
  }, LONG);
});
