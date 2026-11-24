import { describe, expect, it } from 'vitest';
import type { AeroModel } from './types';
import type { AeroOut } from './aero';
import { aeroForces, roadLoad } from './aero';
import { fixtureModel } from './fixtures';

// The fixture coupe: Cd A = 0.62 m^2 (Cd 0.30 on 2.07 m^2), a little lift at each axle (Cl A 0.06 front, 0.07 rear).
const coupe = fixtureModel().aero;
const KMH = 1 / 3.6;
const out: AeroOut = { drag: 0, liftFront: 0, liftRear: 0 };

function drag(a: AeroModel, u: number): number { aeroForces(a, u, out); return out.drag; }

describe('drag', () => {
  it('takes 8.1 kW to push the coupe through still air at 100 km/h, and eight times that (65 kW) at 200', () => {
    // Power against the air is 0.5 rho Cd A v^3: the figure every road-load and top-speed estimate starts from.
    expect(-drag(coupe, 100 * KMH) * 100 * KMH).toBeCloseTo(8139, 0);
    expect(-drag(coupe, 200 * KMH) * 200 * KMH / 1000).toBeCloseTo(65.1, 1);
    expect(drag(coupe, 50)).toBeCloseTo(-949.4, 1);   // N at 180 km/h
  });

  it('grows with the square of speed', () => {
    expect(drag(coupe, 60) / drag(coupe, 30)).toBeCloseTo(4, 12);
    expect(drag(coupe, 90) / drag(coupe, 30)).toBeCloseTo(9, 12);
    expect(drag(coupe, 0.3) / drag(coupe, 0.1)).toBeCloseTo(9, 12);
    // And with the drag area: a car twice as draggy is pulled back twice as hard.
    expect(drag({ ...coupe, dragArea: 1.24 }, 40) / drag(coupe, 40)).toBeCloseTo(2, 12);
  });

  it('opposes the motion both ways, the same size forward and reversing', () => {
    for (const u of [0.5, 5, 25, 80]) {
      expect(drag(coupe, u)).toBeLessThan(0);
      expect(drag(coupe, -u)).toBeGreaterThan(0);
      expect(drag(coupe, -u)).toBe(-drag(coupe, u));
    }
    expect(drag(coupe, 0)).toBeCloseTo(0, 15);
  });
});

describe('lift', () => {
  it('lifts each axle by 0.5 rho Cl A u^2 (132 N front, 154 N rear at 216 km/h), the same reversing', () => {
    aeroForces(coupe, 60, out);
    expect(out.liftFront).toBeCloseTo(132.3, 1);
    expect(out.liftRear).toBeCloseTo(154.35, 2);
    const front = out.liftFront, rear = out.liftRear;
    aeroForces(coupe, -60, out);
    expect(out.liftFront).toBe(front);
    expect(out.liftRear).toBe(rear);
    aeroForces(coupe, 30, out);
    expect(front / out.liftFront).toBeCloseTo(4, 12);
  });

  it('a negative lift area is downforce: a splitter and wing worth -0.3 and -0.5 m^2 press 1,764 N down at 216 km/h', () => {
    aeroForces({ ...coupe, liftAreaFront: -0.3, liftAreaRear: -0.5 }, 60, out);
    expect(out.liftFront).toBeLessThan(0);
    expect(out.liftRear).toBeLessThan(0);
    expect(-(out.liftFront + out.liftRear)).toBeCloseTo(1764, 0);
    expect(out.liftRear / out.liftFront).toBeCloseTo(5 / 3, 12);   // the balance is the areas' ratio at every speed
  });

  it('with everything zero gives zero force, never NaN', () => {
    aeroForces({ dragArea: 0, liftAreaFront: 0, liftAreaRear: 0, roadLoadA: 0, roadLoadB: 0 }, 0, out);
    expect(Math.abs(out.drag) + Math.abs(out.liftFront) + Math.abs(out.liftRear)).toBe(0);
    aeroForces(coupe, 0, out);
    expect(Number.isFinite(out.drag) && Number.isFinite(out.liftFront) && Number.isFinite(out.liftRear)).toBe(true);
    expect(Math.abs(out.drag) + Math.abs(out.liftFront) + Math.abs(out.liftRear)).toBe(0);
  });
});

describe('road load from a coast-down', () => {
  // A mid-size car's EPA coast-down: A = 30 lbf (133 N), B = 0.2 lbf per mph (1.99 N per m/s).
  const coast: AeroModel = { ...coupe, roadLoadA: 133.4, roadLoadB: 1.99 };

  it('is zero at rest, so a parked car is not pushed either way', () => {
    expect(roadLoad(coast, 0)).toBeCloseTo(0, 15);
  });

  it('opposes the motion and is A + B v once rolling: friction, within 2% from walking pace up', () => {
    for (const u of [0.05, 1, 10, 30]) {
      expect(roadLoad(coast, u)).toBeLessThan(0);
      expect(roadLoad(coast, -u)).toBe(-roadLoad(coast, u));
    }
    for (const u of [1, 30]) expect(Math.abs(-roadLoad(coast, u) / (133.4 + 1.99 * u) - 1), `at ${u} m/s`).toBeLessThan(0.02);
    // A damper-like fade would leave a slowing car crawling: at 0.1 m/s most of A must still act.
    expect(-roadLoad(coast, 0.1)).toBeGreaterThan(0.8 * 133.4);
  });

  it('is zero for a car with no coast-down on file (the tyres\' rolling resistance stands in for it)', () => {
    expect(roadLoad(coupe, 30)).toBeCloseTo(0, 15);
  });
});
