import { describe, expect, it } from 'vitest';
import type { VehicleState } from './types';
import type { AeroOut } from './aero';
import type { FixtureParts } from './fixtures';
import { aeroForces } from './aero';
import { rollGradient, staticLoads, steerAngles, suspensionStep, wheelLoads } from './chassis';
import { fixtureModel } from './fixtures';
import { G } from './math';
import { createState } from './state';

// The fixture: a 1,600 kg rear-drive coupe, a = 1.25 m, b = 1.45 m (53.7% front), centre of gravity 0.52 m up,
// tracks 1.58 / 1.60 m, 156 kg unsprung at 0.33 m, roll centres 0.04 / 0.10 m.
const H = 1 / 480;
const DEG = Math.PI / 180;
const NO_AIR: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };

function car(parts: FixtureParts = {}): VehicleState { return createState(fixtureModel(parts)); }

/** Holds the accelerations for some seconds of substeps, as a steady corner or a long pull would, then writes the loads. */
function hold(s: VehicleState, ax: number, ay: number, seconds = 4, air: AeroOut = NO_AIR): VehicleState {
  s.ax = ax; s.ay = ay;
  const n = Math.round(seconds / H);
  for (let i = 0; i < n; i++) suspensionStep(s, air, H);
  wheelLoads(s, air);
  return s;
}
function frontAxle(s: VehicleState): number { return s.wheelLoad[0] + s.wheelLoad[1]; }
function rearAxle(s: VehicleState): number { return s.wheelLoad[2] + s.wheelLoad[3]; }
function total(s: VehicleState): number { return frontAxle(s) + rearAxle(s); }
/** Load moved across each axle (half the difference between its wheels) times its track: the moment the tyres hold against the body's lean. */
function lateralMoment(s: VehicleState): number {
  const c = s.model.chassis;
  return 0.5 * (s.wheelLoad[1] - s.wheelLoad[0]) * c.trackFront + 0.5 * (s.wheelLoad[3] - s.wheelLoad[2]) * c.trackRear;
}
function frontLateralShare(s: VehicleState): number {
  return 0.5 * (s.wheelLoad[1] - s.wheelLoad[0]) * s.model.chassis.trackFront / lateralMoment(s);
}
/** Height of the sprung centre of gravity over the roll axis, worked out here from the fixture's own figures. */
function rollArmOf(s: VehicleState): number {
  const c = s.model.chassis, L = c.a + c.b;
  return c.sprungCgHeight - (c.rollCentreFront + (c.rollCentreRear - c.rollCentreFront) * c.a / L);
}
function rollStiffnessOf(s: VehicleState): number {
  const c = s.model.chassis;
  return c.springFront * c.trackFront * c.trackFront / 2 + c.arbFront + c.springRear * c.trackRear * c.trackRear / 2 + c.arbRear;
}

describe('standing still', () => {
  it('the four loads carry the car\'s 15,691 N, 53.7% of it on the front axle (b / L)', () => {
    const c = fixtureModel().chassis;
    const out = new Float64Array(4);
    staticLoads(c, out);
    const weight = c.mass * G;
    expect((out[0] + out[1] + out[2] + out[3]) / weight).toBeCloseTo(1, 12);
    expect((out[0] + out[1]) / weight).toBeCloseTo(c.b / (c.a + c.b), 12);
    expect((out[2] + out[3]) / weight).toBeCloseTo(c.a / (c.a + c.b), 12);
    expect(out[0]).toBe(out[1]);
    expect(out[2]).toBe(out[3]);
    expect(out[0]).toBeCloseTo(4213.2, 1);   // N on each front tyre
    expect(out[2]).toBeCloseTo(3632.1, 1);   // N on each rear tyre
  });

  it('a car at rest with no air and no motion sits on exactly its static loads', () => {
    const s = car();
    const st = new Float64Array(4);
    staticLoads(s.model.chassis, st);
    wheelLoads(s, NO_AIR);
    for (let i = 0; i < 4; i++) expect(s.wheelLoad[i]).toBeCloseTo(st[i], 9);
  });
});

describe('front to rear', () => {
  it('accelerating at 0.5 g moves m ax h / L (1,511 N) from the front axle to the rear and squats the tail', () => {
    const s = car();
    const c = s.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    hold(s, 0.5 * G, 0);
    const moved = st[0] + st[1] - frontAxle(s);
    const statics = c.mass * 0.5 * G * c.cgHeight / (c.a + c.b);
    expect(statics).toBeCloseTo(1511, 0);
    expect(Math.abs(moved / statics - 1)).toBeLessThan(0.01);
    expect(rearAxle(s) - (st[2] + st[3])).toBeCloseTo(moved, 6);   // what leaves the front arrives at the rear
    expect(total(s) / (c.mass * G)).toBeCloseTo(1, 12);
    expect(s.wheelLoad[0]).toBeCloseTo(s.wheelLoad[1], 9);         // straight line: no side loaded
    // Nose up. The springs carry what the 30% anti-squat does not: ms ax hs (1 - 0.3) / Ktheta, 0.58 degrees.
    expect(s.pitch).toBeLessThan(0);
    const kTheta = 2 * (c.springFront * c.a * c.a + c.springRear * c.b * c.b);
    expect(s.pitch / (-c.sprungMass * 0.5 * G * c.sprungCgHeight * 0.7 / kTheta)).toBeCloseTo(1, 4);
    expect(s.pitch / DEG).toBeCloseTo(-0.577, 3);
  });

  it('braking at 0.8 g dives the nose (positive pitch) and moves 2,418 N onto the front axle', () => {
    const s = car();
    const c = s.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    hold(s, -0.8 * G, 0);
    expect(s.pitch).toBeGreaterThan(0);
    expect(s.pitch / DEG).toBeCloseTo(1.055, 3);                    // with the fixture's 20% anti-dive
    const moved = frontAxle(s) - (st[0] + st[1]);
    expect(Math.abs(moved / (c.mass * 0.8 * G * c.cgHeight / (c.a + c.b)) - 1)).toBeLessThan(0.01);
    expect(moved).toBeCloseTo(2417.5, 0);
  });

  it('anti-dive changes how fast the load arrives, not where it settles, and how far the nose dives', () => {
    const plain = car({ chassis: { antiDive: 0 } });
    const anti = car({ chassis: { antiDive: 0.6 } });
    const c = plain.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    const ax = -0.8 * G;
    const statics = -c.mass * ax * c.cgHeight / (c.a + c.b);
    // The first instant of the stop, before the body has moved: the links and the unsprung masses move their share at once.
    plain.ax = ax; anti.ax = ax;
    wheelLoads(plain, NO_AIR); wheelLoads(anti, NO_AIR);
    const unsprung = c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear;
    const geometric = (share: number): number => -(share * c.sprungMass * c.sprungCgHeight + unsprung) * ax / (c.a + c.b);
    expect(frontAxle(plain) - (st[0] + st[1])).toBeCloseTo(geometric(0), 6);   // only the unsprung masses' 150 N
    expect(geometric(0)).toBeCloseTo(149.6, 1);
    expect(frontAxle(anti) - (st[0] + st[1])).toBeCloseTo(geometric(0.6), 6);  // 1,510 N, 62% of the stop's transfer at once
    expect(geometric(0.6) / statics).toBeCloseTo(0.625, 3);
    // 50 ms in, the plain car's springs have not caught up yet.
    hold(plain, ax, 0, 0.05); hold(anti, ax, 0, 0.05);
    expect(frontAxle(anti)).toBeGreaterThan(frontAxle(plain) + 200);
    // Settled, both have moved the same m ax h / L ...
    hold(plain, ax, 0, 4); hold(anti, ax, 0, 4);
    expect(Math.abs((frontAxle(plain) - (st[0] + st[1])) / statics - 1)).toBeLessThan(1e-3);
    expect(Math.abs((frontAxle(anti) - (st[0] + st[1])) / statics - 1)).toBeLessThan(1e-3);
    expect(frontAxle(anti)).toBeCloseTo(frontAxle(plain), 3);
    // ... but the car with 60% anti-dive dives only 40% as far.
    expect(anti.pitch / plain.pitch).toBeCloseTo(0.4, 4);
  });

  it('anti-squat acts only on a driven rear axle: a front-drive car squats fully', () => {
    const rwd = hold(car({ chassis: { antiSquat: 0.5 } }), 0.4 * G, 0);
    const fwd = hold(car({ chassis: { antiSquat: 0.5 }, driveline: { layout: 'FWD' } }), 0.4 * G, 0);
    expect(rwd.pitch / fwd.pitch).toBeCloseTo(0.5, 4);
    expect(frontAxle(rwd)).toBeCloseTo(frontAxle(fwd), 3);   // the same transfer once settled
  });

  it('an axle pushed off the road carries nothing and the other carries the whole car', () => {
    // A 3 g launch on this car's 0.52 m centre of gravity asks the front to give up 9,063 N it does not have.
    const s = hold(car(), 3 * G, 0);
    expect(s.wheelLoad[0]).toBe(0);
    expect(s.wheelLoad[1]).toBe(0);
    expect(rearAxle(s) / (s.model.chassis.mass * G)).toBeCloseTo(1, 12);
    expect(s.wheelLoad[2]).toBe(s.wheelLoad[3]);
  });
});

describe('across the car', () => {
  it('a steady 0.8 g left turn loads the right wheels, rolls the body right side down, and holds the overturning moment', () => {
    const s = hold(car(), 0, 0.8 * G);
    const c = s.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    expect(s.roll).toBeGreaterThan(0);
    expect(s.wheelLoad[1]).toBeGreaterThan(s.wheelLoad[0]);
    expect(s.wheelLoad[3]).toBeGreaterThan(s.wheelLoad[2]);
    // Load moves across each axle, not between them.
    expect(frontAxle(s)).toBeCloseTo(st[0] + st[1], 6);
    expect(rearAxle(s)).toBeCloseTo(st[2] + st[3], 6);
    // The moment the tyres hold is the rigid car's m ay h (6,527 N m) plus the body's weight moving outboard as it
    // rolls, ms g hRoll roll (288 N m at 2.5 degrees): 4.4% more than a rigid car, as a soft car really does.
    const ay = 0.8 * G;
    const rigid = c.mass * ay * c.cgHeight;
    const shift = c.sprungMass * G * rollArmOf(s) * s.roll;
    expect(Math.abs(lateralMoment(s) / (rigid + shift) - 1)).toBeLessThan(0.005);
    expect(rigid).toBeCloseTo(6527, 0);
    expect(lateralMoment(s) / rigid).toBeGreaterThan(1.03);
    expect(lateralMoment(s) / rigid).toBeLessThan(1.05);
    // About 2,150 N moves across each axle: the outer front tyre carries 6,360 N, the inner 2,066 N.
    expect(s.wheelLoad[1]).toBeCloseTo(6360, -1);
    expect(s.wheelLoad[0]).toBeCloseTo(2066, -1);
  });

  it('the steady roll is ms hRoll / (K - ms g hRoll) per m/s^2: 3.1 degrees per g, a coupe\'s figure', () => {
    const s = hold(car(), 0, 0.8 * G);
    const ms = s.model.chassis.sprungMass, hRoll = rollArmOf(s);
    const perMs2 = ms * hRoll / (rollStiffnessOf(s) - ms * G * hRoll);
    expect(Math.abs(s.roll / (0.8 * G) / perMs2 - 1)).toBeLessThan(0.001);
    expect(s.roll / 0.8 / DEG).toBeCloseTo(3.08, 2);                    // degrees per g
    expect(rollGradient(s.model.chassis) / perMs2).toBeCloseTo(1, 10);
  });

  it('stiffening the front anti-roll bar moves the transfer forward and leans the car less', () => {
    const soft = hold(car(), 0, 0.8 * G);
    const stiff = hold(car({ chassis: { arbFront: 52000 } }), 0, 0.8 * G);
    // Front share of the lateral load transfer: 49.8% with the stock bar, 56.3% with it doubled.
    expect(frontLateralShare(soft)).toBeCloseTo(0.498, 2);
    expect(frontLateralShare(stiff)).toBeCloseTo(0.563, 2);
    expect(frontLateralShare(stiff)).toBeGreaterThan(frontLateralShare(soft) + 0.05);
    expect(stiff.roll).toBeLessThan(soft.roll);
    // The total barely changes: only the small outboard shift of a body that leans less.
    expect(Math.abs(lateralMoment(stiff) / lateralMoment(soft) - 1)).toBeLessThan(0.01);
  });

  it('the dampers settle the body: a step into a corner overshoots the steady roll by what the damping ratio says', () => {
    const s = car();
    const c = s.model.chassis;
    const ms = c.sprungMass, hRoll = rollArmOf(s);
    const net = rollStiffnessOf(s) - ms * G * hRoll;
    const damping = c.damperFront * c.trackFront * c.trackFront / 2 + c.damperRear * c.trackRear * c.trackRear / 2;
    const zeta = damping / (2 * Math.sqrt(net * c.ixx));                // 0.44
    const predicted = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta));   // 21% overshoot
    s.ay = 0.8 * G;
    let peak = 0;
    for (let i = 0; i < 960; i++) { suspensionStep(s, NO_AIR, H); if (s.roll > peak) peak = s.roll; }
    hold(s, 0, 0.8 * G, 4);
    expect(zeta).toBeCloseTo(0.44, 2);
    expect(Math.abs(peak / s.roll - 1 - predicted)).toBeLessThan(0.01);
    expect(Math.abs(s.rollRate)).toBeLessThan(1e-9);
  });

  it('a transfer larger than half the axle lifts the inner wheel to exactly zero, and the other axle takes the rest', () => {
    // A hot hatch with a stiff rear bar three-wheels: at 1.1 g the rear wants to move 3,993 N across but each rear
    // tyre only carries 3,632 N.
    const s = hold(car({ chassis: { arbRear: 120000 } }), 0, 1.1 * G);
    const c = s.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    expect(s.wheelLoad[2]).toBe(0);                                        // inner rear in the air
    expect(s.wheelLoad[3] / (st[2] + st[3])).toBeCloseTo(1, 12);           // the outer rear carries the whole axle
    expect(s.wheelLoad[0]).toBeGreaterThan(0);                             // the front is still on the road
    // The body is stiff in torsion: what the rear cannot hold, the front does, so the overturning moment is still held.
    const ay = 1.1 * G;
    const needed = c.mass * ay * c.cgHeight + c.sprungMass * G * rollArmOf(s) * s.roll;
    expect(Math.abs(lateralMoment(s) / needed - 1)).toBeLessThan(0.005);
    expect(0.5 * (s.wheelLoad[1] - s.wheelLoad[0])).toBeCloseTo(2138, -1); // 366 N more than the front's own 1,772 N
    expect(total(s) / (c.mass * G)).toBeCloseTo(1, 12);
  });

  it('with a stiff front bar the inner front wheel lifts instead, and the rear takes what the front cannot hold', () => {
    const s = hold(car({ chassis: { arbFront: 400000 } }), 0, 1.1 * G);
    const c = s.model.chassis, st = new Float64Array(4);
    staticLoads(c, st);
    expect(s.wheelLoad[0]).toBe(0);                                        // inner front in the air
    expect(s.wheelLoad[1] / (st[0] + st[1])).toBeCloseTo(1, 12);           // the outer front carries the whole axle
    expect(s.wheelLoad[2]).toBeGreaterThan(0);                             // the rear is still on the road
    const needed = c.mass * 1.1 * G * c.cgHeight + c.sprungMass * G * rollArmOf(s) * s.roll;
    expect(Math.abs(lateralMoment(s) / needed - 1)).toBeLessThan(0.005);   // the overturning moment is still held
    // The rear carries more than its own springs, bar and roll centre ask of it: the front's spill.
    const own = (c.springRear * c.trackRear * c.trackRear / 2 + c.arbRear) * s.roll / c.trackRear
      + (c.sprungMass * c.a / (c.a + c.b)) * 1.1 * G * c.rollCentreRear / c.trackRear + c.unsprungRear * 1.1 * G * c.unsprungHeightRear / c.trackRear;
    expect(0.5 * (s.wheelLoad[3] - s.wheelLoad[2])).toBeGreaterThan(own + 100);
    expect(total(s) / (c.mass * G)).toBeCloseTo(1, 12);
  });

  it('while the body is still rolling, the dampers carry load across too: Cf roll rate / tF at the front, Cr at the rear', () => {
    // 50 ms into a step to 0.8 g the body rolls fast, so each axle's transfer is its springs' and bar's share of the
    // roll, its dampers' share of the roll rate, its roll centre's share of the sprung mass and its unsprung mass.
    const s = car(), c = s.model.chassis, L = c.a + c.b, ay = 0.8 * G;
    s.ay = ay;
    for (let k = 0; k < 24; k++) suspensionStep(s, NO_AIR, H);
    wheelLoads(s, NO_AIR);
    expect(s.rollRate).toBeGreaterThan(0.1);                               // still rolling: rad/s
    const tF = c.trackFront, tR = c.trackRear;
    const kF = c.springFront * tF * tF / 2 + c.arbFront, kR = c.springRear * tR * tR / 2 + c.arbRear;
    const cF = c.damperFront * tF * tF / 2, cR = c.damperRear * tR * tR / 2;
    const dF = (kF * s.roll + cF * s.rollRate + c.sprungMass * c.b / L * ay * c.rollCentreFront + c.unsprungFront * ay * c.unsprungHeightFront) / tF;
    const dR = (kR * s.roll + cR * s.rollRate + c.sprungMass * c.a / L * ay * c.rollCentreRear + c.unsprungRear * ay * c.unsprungHeightRear) / tR;
    expect(0.5 * (s.wheelLoad[1] - s.wheelLoad[0])).toBeCloseTo(dF, 6);
    expect(0.5 * (s.wheelLoad[3] - s.wheelLoad[2])).toBeCloseTo(dR, 6);
    expect(cF * s.rollRate / tF).toBeGreaterThan(0.1 * dF);              // the dampers' share is a real part of it
  });

  it('a left and a right turn give mirror-image loads, bit for bit', () => {
    const air: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
    const left = car(), right = car();
    aeroForces(left.model.aero, 40, air);
    // Braking into a corner at 144 km/h.
    for (const s of [left, right]) { s.ax = -0.3 * G; }
    left.ay = 0.9 * G; right.ay = -0.9 * G;
    for (let i = 0; i < 300; i++) { suspensionStep(left, air, H); suspensionStep(right, air, H); }
    wheelLoads(left, air); wheelLoads(right, air);
    expect(right.roll).toBe(-left.roll);
    expect(right.rollRate).toBe(-left.rollRate);
    expect(right.pitch).toBe(left.pitch);
    expect(right.wheelLoad[0]).toBe(left.wheelLoad[1]);
    expect(right.wheelLoad[1]).toBe(left.wheelLoad[0]);
    expect(right.wheelLoad[2]).toBe(left.wheelLoad[3]);
    expect(right.wheelLoad[3]).toBe(left.wheelLoad[2]);
    expect(left.wheelLoad[1]).toBeGreaterThan(left.wheelLoad[0]);   // and the outside (right) of the left turn is loaded
  });
});

describe('the air', () => {
  it('lift takes load off each tyre, half an axle\'s lift each, and raises the body on its springs', () => {
    const s = car({ aero: { dragArea: 0 } });
    const air: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
    aeroForces(s.model.aero, 60, air);                                   // 216 km/h: 132 N front, 154 N rear
    const st = new Float64Array(4);
    staticLoads(s.model.chassis, st);
    hold(s, 0, 0, 3, air);
    expect(air.liftFront).toBeCloseTo(132.3, 1);
    expect(st[0] - s.wheelLoad[0]).toBeCloseTo(air.liftFront / 2, 6);
    expect(st[1] - s.wheelLoad[1]).toBeCloseTo(air.liftFront / 2, 6);
    expect(st[2] - s.wheelLoad[2]).toBeCloseTo(air.liftRear / 2, 6);
    expect(st[3] - s.wheelLoad[3]).toBeCloseTo(air.liftRear / 2, 6);
    expect(s.heave).toBeGreaterThan(0);
  });

  it('downforce adds load and lowers the body: 1,764 N at 216 km/h sets the car down 12 mm', () => {
    const s = car({ aero: { dragArea: 0, liftAreaFront: -0.3, liftAreaRear: -0.5 } });
    const c = s.model.chassis;
    const air: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
    aeroForces(s.model.aero, 60, air);
    const st = new Float64Array(4);
    staticLoads(c, st);
    hold(s, 0, 0, 3, air);
    const down = -(air.liftFront + air.liftRear);
    expect(down).toBeCloseTo(1764, 0);
    for (let i = 0; i < 4; i++) expect(s.wheelLoad[i]).toBeGreaterThan(st[i]);
    expect(total(s) - c.mass * G).toBeCloseTo(down, 6);
    expect(s.wheelLoad[2] - st[2]).toBeCloseTo(-air.liftRear / 2, 6);
    expect(s.heave).toBeCloseTo(-down / (2 * (c.springFront + c.springRear)), 6);
    expect(s.heave * 1000).toBeCloseTo(-12.25, 2);
  });

  it('drag moves load onto the rear (263 N at 216 km/h) and onto the front when reversing', () => {
    const forward = car({ aero: { liftAreaFront: 0, liftAreaRear: 0 } });
    const backward = car({ aero: { liftAreaFront: 0, liftAreaRear: 0 } });
    const c = forward.model.chassis;
    const st = new Float64Array(4);
    staticLoads(c, st);
    const fwdAir: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 }, backAir: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
    aeroForces(forward.model.aero, 60, fwdAir);
    aeroForces(backward.model.aero, -20, backAir);
    // At a steady speed the tyres push at the road and the air pulls at the centre of gravity's height: a couple
    // of |drag| h that moves |drag| h / L onto the rear.
    wheelLoads(forward, fwdAir);
    const moved = rearAxle(forward) - (st[2] + st[3]);
    expect(moved).toBeCloseTo(-fwdAir.drag * c.cgHeight / (c.a + c.b), 6);
    expect(moved).toBeCloseTo(263.3, 1);
    expect(frontAxle(forward)).toBeCloseTo(st[0] + st[1] - moved, 6);
    expect(total(forward) / (c.mass * G)).toBeCloseTo(1, 12);
    wheelLoads(backward, backAir);
    expect(frontAxle(backward)).toBeGreaterThan(st[0] + st[1]);
  });
});

describe('steering', () => {
  it('turns both front wheels together to the car\'s lock, left positive, and leaves the rears straight', () => {
    const s = car();
    const lock = s.model.chassis.maxSteer;   // 0.6 rad, 34 degrees
    steerAngles(s, 1);
    expect(Array.from(s.wheelSteer)).toEqual([lock, lock, 0, 0]);
    steerAngles(s, -0.5);
    expect(s.wheelSteer[0]).toBeCloseTo(-0.3, 12);
    expect(s.wheelSteer[1]).toBeCloseTo(-0.3, 12);
    steerAngles(s, 1.7);                     // past the end stop
    expect(s.wheelSteer[0]).toBe(lock);
    steerAngles(s, -3);
    expect(s.wheelSteer[1]).toBe(-lock);
  });
});

describe('nothing breaks', () => {
  it('with every input zero, and even on a car with no figures at all, nothing is NaN', () => {
    const s = car();
    steerAngles(s, 0);
    suspensionStep(s, NO_AIR, 0);
    suspensionStep(s, NO_AIR, H);
    wheelLoads(s, NO_AIR);
    const zeroed = createState(fixtureModel({
      chassis: {
        mass: 0, sprungMass: 0, unsprungFront: 0, unsprungRear: 0, a: 0, b: 0, wheelbase: 0, trackFront: 0, trackRear: 0,
        cgHeight: 0, sprungCgHeight: 0, unsprungHeightFront: 0, unsprungHeightRear: 0, izz: 0, ixx: 0, iyy: 0,
        springFront: 0, springRear: 0, damperFront: 0, damperRear: 0, arbFront: 0, arbRear: 0,
        rollCentreFront: 0, rollCentreRear: 0, antiDive: 0, antiSquat: 0, maxSteer: 0, steerRatio: 0,
      },
      aero: { dragArea: 0, liftAreaFront: 0, liftAreaRear: 0 },
    }));
    const air: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };
    aeroForces(zeroed.model.aero, 0, air);
    steerAngles(zeroed, 0);
    suspensionStep(zeroed, air, H);
    wheelLoads(zeroed, air);
    const out = new Float64Array(4);
    staticLoads(zeroed.model.chassis, out);
    for (const st of [s, zeroed]) {
      for (const x of [st.heave, st.pitch, st.roll, st.heaveRate, st.pitchRate, st.rollRate]) expect(Number.isFinite(x)).toBe(true);
      for (let i = 0; i < 4; i++) {
        expect(Number.isFinite(st.wheelLoad[i])).toBe(true);
        expect(Number.isFinite(st.wheelSteer[i])).toBe(true);
      }
    }
    for (let i = 0; i < 4; i++) { expect(Number.isFinite(out[i])).toBe(true); expect(zeroed.wheelLoad[i]).toBe(0); }
    expect(s.wheelLoad[0]).toBeCloseTo(4213.2, 1);   // the zero-input car still stands on its tyres
  });
});
