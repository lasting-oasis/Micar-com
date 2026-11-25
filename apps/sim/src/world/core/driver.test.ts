import { describe, expect, it } from 'vitest';
import { CoreDriver, bestLaunch, cannotDrift, pedalThrottle, shiftCue, type CoreDriveOpts } from './driver';
import { RPM } from './params';
import { matchDrivingMode } from './index';
import { Driver } from '../driver';
import { specFor, STOCK_CFG, TUNE_DEF, type CarCfg } from '../data';
import { engineTorque } from '@micar/physics';
import { NO_INPUT, resetVehicle, simStats, syncBody, type Input, type PerfCfg, type Tune } from '../physics';
import { snapToRoad } from '../strip/routes';

const ronin = { make: 'Ronin', model: 'GT', rental: true };           // RWD, 6-speed automatic (converter)
const camry = { make: 'Toyota', model: 'Camry', bodyStyle: 'sedan' };   // FWD, 8-speed automatic
// RWD, dual-clutch: a clutch car on the car table's figures (the Mustang now drives on its researched record, a
// six-speed manual: model.test.ts)
const camaro = { make: 'Chevy', model: 'Camaro', bodyStyle: 'sports' };
const corolla = { make: 'Toyota', model: 'Corolla', bodyStyle: 'sedan' }; // FWD, automatic, on the car table's figures
const build = (perf: Partial<PerfCfg> = {}, tune: Partial<Tune> = {}) => ({ cfg: { ...STOCK_CFG, perf: { ...STOCK_CFG.perf, ...perf } } as CarCfg, tune: { ...TUNE_DEF, ...tune } });
const opts = (o: Partial<CoreDriveOpts> = {}): CoreDriveOpts => ({ drift: false, fuel: () => 100, burn: () => {}, collide: () => 0, ...o });
const make = (car: typeof ronin | typeof camry | typeof camaro | typeof corolla, at = { x: 0, z: 0, h: 0 }, b = build()) => new CoreDriver(car, specFor(car), b, at);
const run = (d: CoreDriver, I: Input, seconds: number, o: CoreDriveOpts = opts(), each?: () => void) => {
  for (let f = 0; f < Math.round(seconds * 60); f++) { d.stepFrame(1 / 60, I, o); each?.(); }
};

describe('the game and the core agree on where the car is and which way it goes', () => {
  it('sim to core: X = z, Y = x, (hx, hy) = (cos h, sin h)', () => {
    const d = make(ronin, { x: 3, z: 4, h: 0 });
    expect([d.s.x, d.s.y, d.s.hx, d.s.hy]).toEqual([4, 3, 1, 0]);
    d.place(-7, 12, Math.PI / 2);
    expect(d.s.x).toBe(12); expect(d.s.y).toBe(-7);
    expect(d.s.hx).toBeCloseTo(0, 12); expect(d.s.hy).toBeCloseTo(1, 12);
    expect(d.pose()).toEqual({ x: -14, y: 0, z: 24, rotY: Math.PI / 2 + Math.PI });
  });

  it('driven forward at h = 0 the car goes up +Z in the scene; at h = pi/2 it goes along +X', () => {
    const d = make(ronin, { x: 3, z: 4, h: 0 });
    run(d, { ...NO_INPUT, fwd: 1 }, 3);
    expect(d.V.z - 4).toBeGreaterThan(15);                   // 3 s of full throttle: well over 15 m
    expect(Math.abs(d.V.x - 3)).toBeLessThan(0.05);
    expect(d.V.u).toBeGreaterThan(10);
    expect(d.V.vz).toBeCloseTo(d.V.u, 6); expect(d.V.vx).toBeCloseTo(0, 6);
    const e = make(ronin, { x: 0, z: 0, h: Math.PI / 2 });
    run(e, { ...NO_INPUT, fwd: 1 }, 2);
    expect(e.V.x).toBeGreaterThan(8); expect(Math.abs(e.V.z)).toBeLessThan(0.05);
  });

  it('turned left in the core (the game\'s steer -1) the car turns left in the scene: h grows, it heads for +X from +Z', () => {
    const d = make(ronin);
    run(d, { ...NO_INPUT, fwd: 1 }, 2.5);
    const h0 = d.V.h, x0 = d.V.x;
    run(d, { ...NO_INPUT, fwd: 0.3, steer: -1 }, 1.5);
    expect(d.s.r).toBeGreaterThan(0);                          // the core: yaw to the left
    expect(d.V.w).toBe(d.s.r);
    expect(d.V.h - h0).toBeGreaterThan(0.4);
    expect(d.V.x - x0).toBeGreaterThan(2);                     // left of +Z is +X
    expect(d.V.delta).toBeGreaterThan(0);                      // the drawn front wheels point left
    expect(d.V.steer).toBeGreaterThan(0);
    // and the velocity the walls read agrees with u, v and h (world/physics.ts: vx = u sin h + v cos h)
    expect(d.V.vx).toBeCloseTo(d.V.u * Math.sin(d.V.h) + d.V.v * Math.cos(d.V.h), 9);
    expect(d.V.vz).toBeCloseTo(d.V.u * Math.cos(d.V.h) - d.V.v * Math.sin(d.V.h), 9);
    // the mirror image: steer +1 (right) turns it the other way
    const m = make(ronin);
    run(m, { ...NO_INPUT, fwd: 1 }, 2.5);
    run(m, { ...NO_INPUT, fwd: 0.3, steer: 1 }, 1.5);
    expect(m.V.h).toBeCloseTo(-d.V.h, 6);
    expect(m.V.x).toBeCloseTo(-d.V.x, 6);
  });

  it('core to sim after the outside writes: a wall\'s bounce, a push and a respawn reach the core at the next sub-step', () => {
    const d = make(ronin);
    run(d, { ...NO_INPUT, fwd: 1 }, 2);
    // a wall straight ahead: the town collider reverses the closing speed (x 1.3, then x 0.92) and calls syncBody
    const V = d.V, vz = V.vz, zWas = V.z;
    V.z -= 0.3; V.vz = -0.3 * vz * 0.92; syncBody(V);
    const zPushed = V.z;
    d.stepFrame(1 / 120, NO_INPUT, opts());
    expect(d.s.u).toBeLessThan(0);                             // now rolling back off the wall
    expect(d.s.x).toBeLessThan(zWas - 0.25);                   // pushed out 0.3 m, in the core too
    expect(Math.abs(d.s.x - zPushed)).toBeLessThan(0.05);
    // a respawn at speed zero somewhere else (resetVehicle, as the race runner's grid does)
    resetVehicle(V, 40, -25, 1);
    d.stepFrame(1 / 120, NO_INPUT, opts());
    expect(Math.abs(d.s.x - -25)).toBeLessThan(0.01); expect(Math.abs(d.s.y - 40)).toBeLessThan(0.01);
    expect(Math.abs(V.u)).toBeLessThan(0.05); expect(V.gear).toBe(1);
    expect(Array.from(d.s.wheelOmega).every(w => Math.abs(w) < 1)).toBe(true);
  });
});

describe('what the readers get back, in their old units and sense', () => {
  it('rpm in rev/min: idles between 600 and 1000, and in gear turns at road speed times the gearing', () => {
    const d = make(camry);
    d.stepFrame(1 / 60, NO_INPUT, opts());
    expect(d.V.rpm).toBeGreaterThan(600); expect(d.V.rpm).toBeLessThan(1000);
    expect(d.V.P.idle).toBe(750);
    run(d, { ...NO_INPUT, fwd: 1 }, 6);
    run(d, { ...NO_INPUT, fwd: 0.25 }, 3);
    const s = d.s, m = s.model, g = d.V.gear;
    expect(g).toBeGreaterThanOrEqual(3);
    expect(d.V.shift).toBe(0);
    const wheel = 0.5 * (s.wheelOmega[0] + s.wheelOmega[1]);  // the FWD Camry's driven wheels, rad/s
    const expected = wheel * m.driveline.gears[g - 1] * m.driveline.finalDrive / RPM;
    expect(d.V.rpm).toBeGreaterThan(expected * 0.92);         // a converter slips a little before it locks
    expect(d.V.rpm).toBeLessThan(expected * 1.15);
    // P describes the core's car: the Camry's researched 7,400 rpm redline, in rev/min.
    expect(d.V.P.redline).toBe(7400);
  });

  it('gear: -1 in reverse and never 0, through the automatic\'s shifts, a stop, reverse and a manual\'s gear changes', () => {
    const d = make(camaro), seen = new Set<number>(), note = () => seen.add(d.V.gear);
    run(d, { ...NO_INPUT, fwd: 1 }, 7, opts(), note);         // up through the gears
    run(d, { ...NO_INPUT, back: 1 }, 6, opts(), note);        // braked to a stop, then the down pedal held: reverse
    expect(d.V.gear).toBe(-1);
    expect(d.V.u).toBeLessThan(-1);                           // and it drives backward
    run(d, { ...NO_INPUT, fwd: 1 }, 3, opts(), note);         // the up pedal: forward again
    const man: Input = { ...NO_INPUT, manual: true, fwd: 1 };
    for (let k = 0; k < 4; k++) { run(d, man, 1, opts(), note); d.stepFrame(1 / 60, { ...man, shiftUp: true }, opts()); note(); }
    for (let k = 0; k < 8; k++) { run(d, { ...NO_INPUT, manual: true, back: 1 }, 1, opts(), note); d.stepFrame(1 / 60, { ...NO_INPUT, manual: true, shiftDn: true }, opts()); note(); }
    expect(seen.has(0)).toBe(false);
    expect(seen.has(-1)).toBe(true);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(4);
    expect([...seen].every(g => g === -1 || (g >= 1 && g <= d.V.P.gears.length))).toBe(true);
  });

  it('manual gears in an automatic or a dual-clutch car: when the box changes up by itself at redline the gear asked for follows it, so it never hunts and the next shift-up press goes up a gear', () => {
    // The gear asked for changed only on a press: the box's own change up at redline was asked back down whenever the
    // revs allowed (a dual-clutch 1 2 1 2 3 4 3 4 5 4 5 in 10 s flat out, the HUD's digit and the shift sound with it),
    // and a press only caught up with the gear the box was already in.
    for (const car of [camaro, camry]) {
      const d = make(car), gears: number[] = [];
      const man: Input = { ...NO_INPUT, manual: true, fwd: 1 };
      run(d, man, 10, opts(), () => { if (gears[gears.length - 1] !== d.V.gear) gears.push(d.V.gear); });
      expect(gears.length, `${car.model}: ${gears.join(' ')}`).toBeGreaterThan(2);
      for (let k = 1; k < gears.length; k++) expect(gears[k], `${car.model}: ${gears.join(' ')}`).toBeGreaterThan(gears[k - 1]);
      const before = d.s.gear;
      d.stepFrame(1 / 60, { ...man, shiftUp: true }, opts());
      run(d, man, 1);
      expect(d.s.gear, car.model).toBe(before + 1);
    }
  });

  it('the HUD\'s SHIFT cue is shown only where a shift press changes gear: not for a CVT, not in Casual (its gears are the car\'s), and as ever on the old model', () => {
    // A CVT is counted as six ratios for the old model's straight-line run, so P.gears had six entries while the core
    // kept the gear at 1: in a drag race (always manual) the Civic and the Prius flashed SHIFT near redline for good;
    // in Casual every automatic upshift was announced by a SHIFT the driver could not act on.
    const civic = { make: 'Honda', model: 'Civic', bodyStyle: 'sedan' };
    const cvt = new CoreDriver(civic, specFor(civic), build(), { x: 0, z: 0, h: 0 });
    expect(cvt.s.model.driveline.transmission).toMatch(/cvt/);
    expect(cvt.V.P.gears.length).toBeGreaterThan(1);
    expect(shiftCue(cvt, true)).toBe(false);
    const casual = new CoreDriver(camry, specFor(camry), build(), { x: 0, z: 0, h: 0 }, { preset: 'casual' });
    expect(shiftCue(casual, true)).toBe(false);
    for (const car of [camry, camaro]) {
      expect(shiftCue(make(car), true), car.model).toBe(true);
      expect(shiftCue(make(car), false), car.model).toBe(false);
    }
    const old = new Driver(specFor(civic), build(), { x: 0, z: 0, h: 0 });
    expect(shiftCue(old, true)).toBe(true);
    expect(shiftCue(old, false)).toBe(false);
    expect(shiftCue(null, true)).toBe(true);
    // And the press does nothing in either, as the cue now says: a CVT stays in its one gear, Casual shifts for itself.
    run(cvt, { ...NO_INPUT, manual: true, fwd: 1 }, 3);
    cvt.stepFrame(1 / 60, { ...NO_INPUT, manual: true, fwd: 1, shiftUp: true }, opts());
    run(cvt, { ...NO_INPUT, manual: true, fwd: 1 }, 1);
    expect(cvt.V.gear).toBe(1);
  });

  it('boost 0 to 1: exactly 0 without a turbo; with the turbo kit it builds at full throttle and never passes 1', () => {
    const na = make(camry);
    let most = 0;
    run(na, { ...NO_INPUT, fwd: 1 }, 4, opts(), () => { most = Math.max(most, na.V.boost); });
    expect(most).toBe(0); expect(na.V.P.turbo).toBeNull();
    const t = make(camry, { x: 0, z: 0, h: 0 }, build({ turbo: 1 }));
    expect(t.V.P.turbo).not.toBeNull();
    expect(t.V.P.turbo!.gain).toBeGreaterThan(0.1); expect(t.V.P.turbo!.gain).toBeLessThan(1.5);
    let least = 1; most = 0;
    run(t, { ...NO_INPUT, fwd: 1 }, 6, opts(), () => { most = Math.max(most, t.V.boost); least = Math.min(least, t.V.boost); });
    expect(most).toBeGreaterThan(0.6); expect(most).toBeLessThanOrEqual(1); expect(least).toBeGreaterThanOrEqual(0);
  });

  it('nos in seconds: a full bottle is P.nos.cap seconds of full shot, and a second of full shot takes a second off it', () => {
    // A car whose traction control leaves the pedal whole in the shot's window (the Camry's record, 203 hp through
    // the front wheels in a low gear, has its own cut it to 0.97 there).
    const d = make(corolla, { x: 0, z: 0, h: 0 }, build({ nos: 1 }));
    const cap = d.V.P.nos.cap, n = d.s.model.nitrous!;
    expect(cap).toBeCloseTo(n.bottleMass / n.flow, 9);
    expect(d.V.nos).toBeCloseTo(cap, 9);
    run(d, { ...NO_INPUT, fwd: 1 }, 1);
    let on = false, fastest = 0, last = d.V.nos;
    const before = d.V.nos;
    run(d, { ...NO_INPUT, fwd: 1, nos: true }, 2, opts(), () => { on = on || d.V.nosOn; fastest = Math.max(fastest, last - d.V.nos); last = d.V.nos; });
    expect(on).toBe(true);
    // the core's shot follows the pedal and its window switch (none low in the revs, none in a shift), so the bottle
    // goes down by at most the time on the button, and at full throttle in the window by exactly a frame a frame
    expect(fastest).toBeCloseTo(1 / 60, 4);
    expect(before - d.V.nos).toBeGreaterThan(0.5); expect(before - d.V.nos).toBeLessThanOrEqual(2);
    run(d, { ...NO_INPUT, fwd: 1 }, 0.5);
    expect(d.V.nosOn).toBe(false);
    // off the button it stays where it is: a real bottle refills only when it is filled
    const low = d.V.nos;
    run(d, { ...NO_INPUT, fwd: 0.2 }, 5.5);
    expect(d.V.nos).toBe(low);
    expect(low).toBeLessThan(cap - 0.5);
    // the race runner's refill at a start (PV.nos = PV.P.nos.cap) reaches the bottle
    d.V.nos = cap; d.stepFrame(1 / 120, NO_INPUT, opts());
    expect(d.s.nitrousLeft).toBeCloseTo(n.bottleMass, 2);
  });

  it('the other readers\' fields: spin flags 0 to 1, beta in rad, ax smoothed m/s^2, thr and brk 0 to 1, a finite hyd', () => {
    const d = make(camaro);
    let spin = 0, ax = 0;
    run(d, { ...NO_INPUT, fwd: 1, hb: true }, 1.5, opts(), () => { spin = Math.max(spin, d.V.spinR); });
    run(d, { ...NO_INPUT, fwd: 1 }, 3, opts(), () => { ax = Math.max(ax, d.V.ax); });
    expect(ax).toBeGreaterThan(3); expect(ax).toBeLessThan(15);            // a 4-second car pulls about half a g
    expect(spin).toBeGreaterThanOrEqual(0); expect(spin).toBeLessThanOrEqual(1);
    run(d, { ...NO_INPUT, back: 1 }, 0.5);
    expect(d.V.brk).toBe(1); expect(d.V.thr).toBe(0);
    for (const k of ['f', 'r', 'l'] as const) expect(Number.isFinite(d.V.hyd[k])).toBe(true);
    run(d, { ...NO_INPUT, fwd: 0.5, steer: 1 }, 1);
    expect(Math.abs(d.V.beta)).toBeLessThan(Math.PI / 2);
    expect(Number.isFinite(d.V.beta)).toBe(true);
  });

  it('a blown engine (the drag race sets it) gives no drive until the page mends it', () => {
    const d = make(ronin);
    d.V.blown = true;
    run(d, { ...NO_INPUT, fwd: 1 }, 2);
    expect(Math.abs(d.V.u)).toBeLessThan(0.5);
    d.V.blown = false; d.V.overRev = 0;
    run(d, { ...NO_INPUT, fwd: 1 }, 2);
    expect(d.V.u).toBeGreaterThan(5);
  });
});

describe('race starts and pulling away', () => {
  it('held on the line the car does not move and the pedal sets the revs; at the green it launches', () => {
    for (const car of [camaro, ronin]) {
      const d = make(car);
      let held = true;
      const o = opts({ held: () => held });
      run(d, { ...NO_INPUT, fwd: 1 }, 2.5, o);
      const launch = bestLaunch(d.s.model) / RPM;
      expect(Math.hypot(d.V.x, d.V.z)).toBeLessThan(0.05);
      if (car === camaro) { // a clutch car: the pedal holds the revs at the launch speed
        expect(d.V.rpm).toBeGreaterThan(launch * 0.9); expect(d.V.rpm).toBeLessThan(launch * 1.1);
        run(d, { ...NO_INPUT, fwd: 0.5 }, 1, o);
        const half = (d.s.model.engine.idle / RPM + launch) / 2;
        expect(d.V.rpm).toBeGreaterThan(half * 0.9); expect(d.V.rpm).toBeLessThan(half * 1.1);
      } else expect(d.V.rpm).toBeGreaterThan(d.V.P.idle * 1.3); // a converter car revs against its brakes
      run(d, { ...NO_INPUT, fwd: 1 }, 1, o);
      held = false;
      let low = Infinity;
      run(d, { ...NO_INPUT, fwd: 1 }, 1.5, o, () => { low = Math.min(low, d.V.rpm); });
      expect(d.V.u).toBeGreaterThan(8);                       // off the line: 30 km/h in 1.5 s
      expect(low).toBeGreaterThan(d.V.P.idle * 1.2);          // without bogging to idle
    }
  });

  it('a turbo car launches on boost: its launch revs are where its boosted curve reaches 90% of its peak, not 1.5 x idle', () => {
    // Read off the curve without boost, a turbo engine was at 90% of that at once: the GT-RR launched at 1,125 rpm,
    // its turbos asleep, half a second slower to 60 mph from the line than at the revs its boost comes in.
    const gtr = { make: 'Nizzan', model: 'GT-RR', bodyStyle: 'sports' };
    const d = new CoreDriver(gtr, specFor(gtr), build(), { x: 0, z: 0, h: 0 }), e = d.s.model.engine;
    expect(e.kind).toBe('turbo');
    const launch = bestLaunch(d.s.model);
    expect(launch).toBeGreaterThan(2 * e.idle);
    // On the full-boost curve the launch speed is the first point at 90% of the peak.
    let peak = 0;
    for (let i = 0; i < e.n && i * e.dOmega <= e.redline; i++) peak = Math.max(peak, e.wot[i]);
    expect(e.wot[Math.round(launch / e.dOmega)]).toBeGreaterThanOrEqual(0.9 * peak - 1e-9);
    let held = true;
    const o = opts({ held: () => held });
    run(d, { ...NO_INPUT, fwd: 1 }, 3, o);
    held = false;
    let t = 0;
    while (d.V.u < 60 * 0.44704 && t < 10) { d.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, o); t += 1 / 60; }
    expect(t).toBeLessThan(3.5);
  });

  it('a clutch car pulled away in a manual\'s first gear keeps its revs well off idle (the core\'s own bite sits at 1.15 x idle)', () => {
    const d = make(camaro);
    let low = Infinity;
    run(d, { ...NO_INPUT, manual: true, fwd: 1 }, 0.2);
    run(d, { ...NO_INPUT, manual: true, fwd: 1 }, 1.8, opts(), () => { low = Math.min(low, d.V.rpm); });
    expect(low).toBeGreaterThan(d.V.P.idle * 1.3);
    expect(d.V.u).toBeGreaterThan(10);
  });

  it('says so when a drift is asked of a car that cannot drift', () => {
    const said: string[] = [];
    const d = new CoreDriver(camry, specFor(camry), build(), { x: 0, z: 0, h: 0 }, { notice: t => said.push(t) });
    run(d, NO_INPUT, 0.2, opts({ drift: true }));
    expect(said).toEqual(['This car cannot drift: front-wheel drive']);
    expect(cannotDrift(make(camaro).s.model)).toBeNull();
  });
});

describe('the pedals', () => {
  it('a light squeeze of an analog pedal drives the car: 10 s at a tenth or a fifth of the pedal from rest moves an automatic and a clutch car at a walk and more', () => {
    // The core's throttle is the throttle plate, its torque in a straight line from the closed throttle's drag to
    // full: passed through, a tenth of the pedal left every clutch car standing and a fifth gave an automatic only its
    // converter's creep (the Camry 6 km/h). The old model's pedal is the pedal times the torque.
    const speed = (car: typeof camry | typeof camaro, pedal: number) => { const d = make(car); run(d, { ...NO_INPUT, fwd: pedal }, 10); return d.V.u * 3.6; };
    expect(speed(camaro, 0.1)).toBeGreaterThan(10);
    expect(speed(camry, 0.1)).toBeGreaterThan(10);
    expect(speed(camry, 0.2)).toBeGreaterThan(20);
    expect(speed(camry, 0.2)).toBeGreaterThan(speed(camry, 0.1) + 8); // and the pedal sets the pace
  });

  it('the pedal asks for its share of the engine\'s torque; a lifted foot still brakes on the engine', () => {
    const d = make(camry), s = d.s, e = s.model.engine;
    for (const rpm of [1000, 3000, 5000]) {
      s.engineOmega = rpm * RPM;
      const w = s.engineOmega;
      expect(pedalThrottle(s, 0)).toBe(0);
      expect(engineTorque(e, w, pedalThrottle(s, 0), s.boost)).toBeLessThan(0);
      expect(pedalThrottle(s, 1)).toBe(1);
      const full = engineTorque(e, w, 1, s.boost);
      for (const p of [0.1, 0.2, 0.5]) expect(engineTorque(e, w, pedalThrottle(s, p), s.boost), `${rpm} rpm, pedal ${p}`).toBeCloseTo(p * full, 6);
    }
  });

  it('an automatic left with no pedal stands still, as on the old model: from rest, and rolled to a stop from 30 km/h; the throttle still pulls away', () => {
    // A converter's creep moved the Camry and the Ronin GT at 5 km/h for as long as no key was held (12 m in 10 s), and a
    // car let roll from 30 km/h settled at that creep instead of stopping; the brake key held at a standstill selects
    // reverse (the old model's rule), so only the handbrake kept a stopped car still.
    for (const car of [camry, ronin]) {
      const d = make(car), z0 = d.V.z;
      run(d, NO_INPUT, 10);
      expect(Math.abs(d.V.u), `${car.make} from rest`).toBeLessThan(0.05);
      expect(Math.hypot(d.V.x, d.V.z - z0), `${car.make} from rest`).toBeLessThan(0.5);
      run(d, { ...NO_INPUT, fwd: 1 }, 3);
      expect(d.V.u * 3.6, `${car.make} pulls away`).toBeGreaterThan(30);
      run(d, NO_INPUT, 30);
      expect(Math.abs(d.V.u), `${car.make} let roll from speed`).toBeLessThan(0.05);
      const at = d.V.z;
      run(d, NO_INPUT, 5);
      expect(Math.abs(d.V.z - at), `${car.make} stopped`).toBeLessThan(0.1);
      // and a light squeeze still moves it off
      run(d, { ...NO_INPUT, fwd: 0.1 }, 5);
      expect(d.V.u * 3.6, `${car.make} a tenth of the pedal`).toBeGreaterThan(5);
    }
  });
});

describe('the same Vehicle object, whatever happens to the build or the model', () => {
  it('a Garage rebuild keeps the object, the place, the speed and the gear, with the new parts in P', () => {
    const d = make(camry), V = d.V;
    run(d, { ...NO_INPUT, fwd: 1 }, 4);
    const at = [V.x, V.z, V.h, V.u], gear = V.gear;
    d.rebuild(specFor(camry), build({ engine: 2, ecu: 1 }));
    expect(d.V).toBe(V);
    expect([V.x, V.z, V.h]).toEqual(at.slice(0, 3));
    expect(V.u).toBeCloseTo(at[3], 9);
    expect(V.gear).toBe(gear);
    expect(V.P.redline).toBeGreaterThan(6500);                  // the ECU's 150 rpm
  });

  it('the old model can take over the core\'s Vehicle and the core the old one\'s, and the old model\'s P still runs simStats', () => {
    const spec = specFor(ronin), b = build();
    const old = new Driver(spec, b, { x: 1, z: 2, h: 0.3 });
    const V = old.V;
    for (let i = 0; i < 120; i++) old.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, opts());
    const u = V.u;
    const core = matchDrivingMode(old, ronin, spec, b, undefined, true) as CoreDriver;
    expect(core).toBeInstanceOf(CoreDriver); expect(core.V).toBe(V);
    expect(core.s.u).toBeCloseTo(u, 9);
    const st = simStats(V.P);                                     // the Strip's AI pace reads the core car's portrait
    expect(st.t100).not.toBeNull(); expect(st.top).toBeGreaterThan(150); expect(st.top).toBeLessThan(330);
    run(core, { ...NO_INPUT, fwd: 1 }, 1);
    const back = matchDrivingMode(core, ronin, spec, b, undefined, false);
    expect(back).toBeInstanceOf(Driver); expect(back.V).toBe(V);
    back.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, opts());
    expect(Number.isFinite(V.u) && V.u > 5).toBe(true);
  });

  it('snapToRoad (the Strip\'s free-roam reset) stops the car where it puts it', () => {
    const d = make(ronin);
    run(d, { ...NO_INPUT, fwd: 1 }, 3);
    snapToRoad(d.V, [{ id: 'r', pts: [[100, 100], [100, 200]], loop: false, width: 10 }]);
    d.stepFrame(1 / 60, NO_INPUT, opts());
    expect(Math.abs(d.V.u)).toBeLessThan(0.2);
    expect(Math.abs(d.V.x - 100)).toBeLessThan(0.1);
  });
});

describe('race fuel draws more from the tank (DESIGN.md 11: fuel-1, fuel flow x1.3 for the same power)', () => {
  it('with the ECU at its third tier (race fuel fitted) the throttle draws 1.3 times the fuel for the same throttle; the car\'s running costs the same', () => {
    // Two seconds flat out from rest: what the tank gives up (world/driver.ts: the throttle's draw plus the speed's).
    const draw = (ecu: 2 | 3) => {
      const e = make(camry, { x: 0, z: 0, h: 0 }, build({ ecu, engine: 3, turbo: 0 }));
      let burned = 0, thr = 0;
      for (let f = 0; f < 120; f++) {
        e.stepFrame(1 / 60, { ...NO_INPUT, fwd: 1 }, opts({ burn: (x) => { burned += x; } }));
        thr += e.V.thr;
      }
      return { burned, e, thr };
    };
    const pump = draw(2), race = draw(3);
    expect(pump.e.core.build.parts.some(p => p.id === 'fuel-1')).toBe(false);
    expect(race.e.core.build.parts.some(p => p.id === 'fuel-1')).toBe(true);
    expect(pump.e.fuelFlow).toBe(1);
    expect(race.e.fuelFlow).toBe(1.3);
    // Both on full throttle nearly all the way; the race-fuel car draws 1.2 to 1.3 times as much (the speed term, the
    // same per metre, is a small share of it).
    expect(pump.thr / 120).toBeGreaterThan(0.8);
    expect(race.thr / 120).toBeGreaterThan(0.8);
    expect(race.burned / pump.burned).toBeGreaterThan(1.2);
    expect(race.burned / pump.burned).toBeLessThan(1.32);
  });
});
