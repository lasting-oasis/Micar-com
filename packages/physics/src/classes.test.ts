// The class tables hold every "typical" value. These tests check that each figure sits where published data puts
// it and that the tables hang together physically (a stickier tyre is stiffer, a truck's centre of gravity is high,
// brakes are biased the way production cars are), not that a number equals itself.
import { describe, expect, it } from 'vitest';
import type { AwdKind, BodyClass, DiffKind, Drivetrain, EngineLocation, SuspensionGrade, TransmissionType, TyreCategory } from './types';
import { G, P_AMBIENT, PI, T_AMBIENT, dpow } from './math';
import { MPH, RPM, parseTyreSize } from './units';
import { ABS_CUT_SLIP } from './brakes';
import * as classes from './classes';
import {
  ANTI_DIVE, ANTI_SQUAT, AWD_CENTRE, AWD_EFFICIENCY_PENALTY, BODY_CLASSES, BRAKE_AXLE_MARGIN, BRAKE_BIAS_RANGE, BRAKE_SIZING_G, CHARGE_AIR, CHASSIS_CLASS,
  CLASS_DIMENSIONS, CLASS_FINAL_DRIVE, CLASS_LIMITER, CLASS_LIMITER_PERFORMANCE, CLASS_STEER_RATIO, CLASS_TYRES,
  CLUTCH_CAPACITY_RATIO, COMPRESSOR_EFFICIENCY, DIFF_DEFAULT, FMEP, HANDBRAKE_TORQUE, KNOCK_LIMIT_PR, LIMITER_RAISE_BAND,
  LOADED_RADIUS_RATIO, PITCH_GYRATION_PER_LENGTH, ROLL_GYRATION_PER_WIDTH, SINGLE_SPEED_FINAL_DRIVE, SUSPENSION_GRADE,
  SUSPENSION_GRADES, TRANSMISSION, TRANSMISSION_TYPES, TYRE_CATEGORIES, TYRE_CATEGORY, brakeFrontShare, defaultIdle,
  defaultRedline, drivelineEfficiency, engineInertia, fmepFor, gearRatioAt, peakSpeedShares, tyreGripScaleRange,
  tyreReferenceLoad, weightFrontShare, wheelInertia, wheelMass,
} from './classes';

// The unions written out here. A Record over a union must name every member or it does not compile, so a member
// added to types.ts and forgotten in a table fails a test instead of being skipped by an empty loop.
const BODY: Record<BodyClass, true> = { sports: true, coupe: true, sedan: true, hatchback: true, wagon: true, suv: true, van: true, pickup: true, offroad: true };
const TYRES: Record<TyreCategory, true> = { 'all-season': true, summer: true, 'max-performance': true, track: true, 'all-terrain': true, winter: true, drag: true };
const BOXES: Record<TransmissionType, true> = { manual: true, 'dual-clutch': true, automatic: true, cvt: true, ecvt: true, 'single-speed': true };
const GRADES: Record<SuspensionGrade, true> = { standard: true, sport: true, adaptive: true, offroad: true };
const AWDS: Record<AwdKind, true> = { fixed: true, 'front-on-demand': true, 'rear-on-demand': true, 'part-time': true };
const DIFFS: Record<DiffKind, true> = { open: true, 'limited-slip': true, locked: true, active: true };
const bodyClasses = Object.keys(BODY).sort() as BodyClass[];
const tyreCategories = Object.keys(TYRES).sort() as TyreCategory[];
const boxes = Object.keys(BOXES).sort() as TransmissionType[];
const grades = Object.keys(GRADES).sort() as SuspensionGrade[];
const stepped: TransmissionType[] = ['manual', 'dual-clutch', 'automatic'];
const passengerCars: BodyClass[] = ['sports', 'coupe', 'sedan', 'hatchback', 'wagon'];
const trucks: BodyClass[] = ['suv', 'van', 'pickup', 'offroad'];

const degPerG = (radPerMs2: number): number => radPerMs2 * G * 180 / PI;
const rpm = (omega: number): number => omega / RPM;
function size(s: string): { width: number; rimIn: number; radius: number } {
  const t = parseTyreSize(s);
  if (t === null) throw new Error(`unreadable tyre size ${s}`);
  return t;
}
const cgHeight = (c: BodyClass): number => CHASSIS_CLASS[c].cgHeightRatio * CLASS_DIMENSIONS[c].height;

describe('every member of every union has an entry', () => {
  it('nine body classes in every class table', () => {
    expect(bodyClasses).toHaveLength(9);
    for (const table of [CHASSIS_CLASS, CLASS_DIMENSIONS, CLASS_STEER_RATIO, CLASS_FINAL_DRIVE, CLASS_LIMITER, CLASS_LIMITER_PERFORMANCE, CLASS_TYRES]) {
      expect(Object.keys(table).sort()).toEqual(bodyClasses);
    }
    expect([...BODY_CLASSES].sort()).toEqual(bodyClasses);
  });
  it('seven tyre categories, six transmissions, four suspension grades, four AWD kinds and four differentials', () => {
    expect(Object.keys(TYRE_CATEGORY).sort()).toEqual(tyreCategories);
    expect([...TYRE_CATEGORIES].sort()).toEqual(tyreCategories);
    expect(Object.keys(TRANSMISSION).sort()).toEqual(boxes);
    expect([...TRANSMISSION_TYPES].sort()).toEqual(boxes);
    expect(Object.keys(SUSPENSION_GRADE).sort()).toEqual(grades);
    expect([...SUSPENSION_GRADES].sort()).toEqual(grades);
    expect(Object.keys(AWD_CENTRE).sort()).toEqual(Object.keys(AWDS).sort());
    expect(Object.keys(DIFF_DEFAULT).sort()).toEqual(Object.keys(DIFFS).sort());
    expect(tyreCategories).toHaveLength(7);
    expect(boxes).toHaveLength(6);
    expect(grades).toHaveLength(4);
  });
  it('every class and tyre figure is a finite positive number', () => {
    let checked = 0;
    for (const c of bodyClasses) {
      for (const v of [...Object.values(CHASSIS_CLASS[c]), ...Object.values(CLASS_DIMENSIONS[c]), CLASS_STEER_RATIO[c], CLASS_FINAL_DRIVE[c], CLASS_LIMITER[c]]) {
        expect(Number.isFinite(v) && v > 0).toBe(true);
        checked++;
      }
    }
    for (const t of tyreCategories) for (const v of Object.values(TYRE_CATEGORY[t])) { expect(Number.isFinite(v) && v > 0).toBe(true); checked++; }
    expect(checked).toBe(9 * (14 + 6 + 3) + 7 * 12);
  });
});

describe('tyres', () => {
  it('each category starts inside its own calibration range, so an uncalibrated car is a legal car', () => {
    for (const t of tyreCategories) {
      const row = TYRE_CATEGORY[t], scale = tyreGripScaleRange(t);
      expect(row.muY0).toBeGreaterThan(row.muY0Min);
      expect(row.muY0).toBeLessThan(row.muY0Max);
      expect(scale.min).toBeLessThan(1);
      expect(scale.max).toBeGreaterThan(1);
      expect(scale.min * row.muY0).toBeCloseTo(row.muY0Min, 12);
      expect(scale.max * row.muY0).toBeCloseTo(row.muY0Max, 12);
      // a calibration range is about +-10%: room for one car's tyre to beat or trail its category, not to change category
      expect(scale.max - scale.min).toBeGreaterThan(0.15);
      expect(scale.max - scale.min).toBeLessThan(0.25);
    }
  });
  it('dry grip rises from all-terrain through all-season, summer and max-performance to track, and the stickier tyre is the stiffer, quicker one', () => {
    const ladder: TyreCategory[] = ['all-terrain', 'all-season', 'summer', 'max-performance', 'track'];
    for (let i = 1; i < ladder.length; i++) {
      const lo = TYRE_CATEGORY[ladder[i - 1]], hi = TYRE_CATEGORY[ladder[i]];
      expect(hi.muY0).toBeGreaterThan(lo.muY0);
      expect(hi.muY0Min).toBeGreaterThan(lo.muY0Min);
      expect(hi.muY0Max).toBeGreaterThan(lo.muY0Max);
      expect(hi.cAlphaPerFz).toBeGreaterThan(lo.cAlphaPerFz);   // stiffer carcass and shallower tread
      expect(hi.relaxLat).toBeLessThan(lo.relaxLat);            // so force builds in a shorter distance
    }
    // from a truck's all-terrain (0.80) to a track tyre (1.28): the spread magazine skidpads show
    expect(TYRE_CATEGORY.track.muY0 / TYRE_CATEGORY['all-terrain'].muY0).toBeGreaterThan(1.5);
  });
  it('a winter tyre on dry asphalt grips no better than an all-terrain', () => {
    expect(TYRE_CATEGORY.winter.muY0).toBeLessThanOrEqual(TYRE_CATEGORY['all-terrain'].muY0);
  });
  it('the drag radial has the most longitudinal grip of any tyre, enough for a 1.5 g launch on a prepared strip', () => {
    const muX = (t: TyreCategory): number => TYRE_CATEGORY[t].muY0 * TYRE_CATEGORY[t].muXRatio;
    expect(muX('drag')).toBeGreaterThanOrEqual(1.5);
    for (const t of tyreCategories) if (t !== 'drag') expect(muX('drag')).toBeGreaterThan(muX(t));
  });
  it('every figure sits in the range tyre data sheets give', () => {
    for (const t of tyreCategories) {
      const row = TYRE_CATEGORY[t];
      const perDegree = row.cAlphaPerFz * PI / 180;
      expect(perDegree).toBeGreaterThanOrEqual(0.15);   // cornering coefficient: road tyres 0.15 to 0.25 per degree,
      expect(perDegree).toBeLessThanOrEqual(0.40);      // racing tyres up to about 0.4
      expect(row.muXRatio).toBeGreaterThanOrEqual(1);   // flat-track data: braking peak 5 to 15% above cornering peak
      expect(row.muXRatio).toBeLessThanOrEqual(1.6);
      expect(row.loadSens).toBeGreaterThanOrEqual(0.05);
      expect(row.loadSens).toBeLessThanOrEqual(0.2);
      expect(row.slideRatio).toBeGreaterThanOrEqual(0.6);
      expect(row.slideRatio).toBeLessThan(1);
      expect(row.rollRes).toBeGreaterThanOrEqual(0.006);
      expect(row.rollRes).toBeLessThanOrEqual(0.015);
      expect(row.relaxLong).toBeLessThan(row.relaxLat); // a tyre takes up braking force in a shorter distance than cornering force
      expect(row.relaxLat).toBeGreaterThanOrEqual(0.3);
      expect(row.relaxLat).toBeLessThanOrEqual(0.8);
    }
  });
  it('a 225/45R17 is rated about a quarter of a 1,550 kg car, and the reference load is held to 3,000 to 7,500 N', () => {
    const mid = size('225/45R17');
    const fz0 = tyreReferenceLoad(mid.width, 2 * mid.radius);
    expect(fz0).toBeGreaterThan(3700);
    expect(fz0).toBeLessThan(4000);
    expect(fz0 / G * 4).toBeGreaterThan(1500);
    expect(fz0 / G * 4).toBeLessThan(1600);
    const small = size('175/65R14'), huge = size('37x12.50R17');
    expect(tyreReferenceLoad(small.width, 2 * small.radius)).toBe(3000);
    expect(tyreReferenceLoad(huge.width, 2 * huge.radius)).toBe(7500);
    // a wide, tall tyre carries more: a 285/30R19 above a 245/35R19
    const f = size('245/35R19'), r = size('285/30R19');
    expect(tyreReferenceLoad(r.width, 2 * r.radius)).toBeGreaterThan(tyreReferenceLoad(f.width, 2 * f.radius));
  });
  it('a loaded tyre rolls about 3% under its free radius', () => {
    expect(LOADED_RADIUS_RATIO).toBeGreaterThanOrEqual(0.95);
    expect(LOADED_RADIUS_RATIO).toBeLessThan(1);
  });
});

describe('body classes', () => {
  it('ride frequencies are 1 to 2.5 Hz with the rear above the front, for every class on every grade', () => {
    let checked = 0;
    for (const c of bodyClasses) {
      for (const g of grades) {
        const row = CHASSIS_CLASS[c], s = SUSPENSION_GRADE[g];
        const front = row.rideHzFront * s.rideScale, rear = row.rideHzRear * s.rideScale;
        expect(front).toBeGreaterThanOrEqual(1);
        expect(rear).toBeLessThanOrEqual(2.5);
        expect(rear).toBeGreaterThan(front);
        // the rear 5 to 25% quicker, so a bump's pitch dies out by the time the rear wheels reach it (flat ride)
        expect(rear / front).toBeGreaterThanOrEqual(1.05);
        expect(rear / front).toBeLessThanOrEqual(1.25);
        checked++;
      }
    }
    expect(checked).toBe(36);
  });
  it('a sports car rides at 1.5 to 2.5 Hz and a family car at 1 to 1.5 Hz', () => {
    expect(CHASSIS_CLASS.sports.rideHzFront).toBeGreaterThanOrEqual(1.5);
    for (const c of ['sedan', 'hatchback', 'wagon', 'suv', 'van'] as BodyClass[]) {
      expect(CHASSIS_CLASS[c].rideHzFront).toBeLessThanOrEqual(1.5);
      expect(CHASSIS_CLASS[c].rideHzRear).toBeLessThanOrEqual(1.5);
    }
  });
  it('damping stays between a fifth and seven tenths of critical on every grade', () => {
    for (const c of bodyClasses) for (const g of grades) {
      const zeta = CHASSIS_CLASS[c].dampingRatio + SUSPENSION_GRADE[g].dampingAdd;
      expect(zeta).toBeGreaterThanOrEqual(0.2);
      expect(zeta).toBeLessThanOrEqual(0.7);
    }
  });
  it('roll gradient: a sports car 1.5 to 3 deg/g, road cars 3 to 7; a sport suspension flattens it, an off-road one lets it roll', () => {
    expect(degPerG(CHASSIS_CLASS.sports.rollGradient)).toBeGreaterThanOrEqual(1.5);
    expect(degPerG(CHASSIS_CLASS.sports.rollGradient)).toBeLessThanOrEqual(3);
    for (const c of bodyClasses) {
      if (c === 'sports') continue;
      expect(degPerG(CHASSIS_CLASS[c].rollGradient)).toBeGreaterThanOrEqual(3);
      expect(degPerG(CHASSIS_CLASS[c].rollGradient)).toBeLessThanOrEqual(7);
      expect(CHASSIS_CLASS[c].rollGradient).toBeGreaterThan(CHASSIS_CLASS.sports.rollGradient);
    }
    expect(SUSPENSION_GRADE.sport.rollGradientScale).toBeLessThan(1);
    expect(SUSPENSION_GRADE.adaptive.rollGradientScale).toBeLessThan(1);
    expect(SUSPENSION_GRADE.offroad.rollGradientScale).toBeGreaterThan(1);
    expect(SUSPENSION_GRADE.sport.rideScale).toBeGreaterThan(1);
    expect(SUSPENSION_GRADE.offroad.rideScale).toBeLessThan(1);
    expect(degPerG(CHASSIS_CLASS.offroad.rollGradient)).toBeGreaterThan(degPerG(CHASSIS_CLASS.sedan.rollGradient));
  });
  it('every class carries more of its roll stiffness than of its weight at the front: the understeering balance of a road car', () => {
    for (const c of bodyClasses) {
      expect(CHASSIS_CLASS[c].rollShareOverWeight).toBeGreaterThan(0);
      expect(CHASSIS_CLASS[c].rollShareOverWeight).toBeLessThanOrEqual(0.15);
    }
  });
  it('static stability factor (track over twice the centre-of-gravity height) as NHTSA measures it: cars 1.3 and up, SUVs and trucks 1.0 to 1.3', () => {
    const ssf = (c: BodyClass): number => (CLASS_DIMENSIONS[c].trackFront + CLASS_DIMENSIONS[c].trackRear) / 2 / (2 * cgHeight(c));
    for (const c of passengerCars) expect(ssf(c)).toBeGreaterThanOrEqual(1.3);
    for (const c of trucks) {
      expect(ssf(c)).toBeGreaterThanOrEqual(1.0);
      expect(ssf(c)).toBeLessThanOrEqual(1.3);
    }
    expect(ssf('sports')).toBeGreaterThan(ssf('sedan'));
    expect(ssf('sedan')).toBeGreaterThan(ssf('suv'));
    expect(ssf('suv')).toBeGreaterThan(ssf('pickup'));
  });
  it('centre of gravity from 0.45 m in a sports car to under 0.8 m in a pickup', () => {
    for (const c of bodyClasses) {
      expect(cgHeight(c)).toBeGreaterThanOrEqual(0.42);
      expect(cgHeight(c)).toBeLessThanOrEqual(0.80);
    }
    expect(cgHeight('sports')).toBeLessThan(0.5);
    for (const c of bodyClasses) if (c !== 'sports') expect(cgHeight(c)).toBeGreaterThan(cgHeight('sports'));
  });
  it('the body is laid out like a car: wheelbase 54 to 66% of length, tracks inside the body width', () => {
    for (const c of bodyClasses) {
      const d = CLASS_DIMENSIONS[c];
      expect(d.wheelbase / d.length).toBeGreaterThanOrEqual(0.54);
      expect(d.wheelbase / d.length).toBeLessThanOrEqual(0.66);
      expect(d.trackFront).toBeLessThan(d.width);
      expect(d.trackRear).toBeLessThan(d.width);
      expect(d.height).toBeGreaterThan(1.1);
      expect(d.height).toBeLessThan(2.1);
    }
    expect(CLASS_DIMENSIONS.pickup.wheelbase).toBeGreaterThan(CLASS_DIMENSIONS.van.wheelbase);
    expect(CLASS_DIMENSIONS.sports.height).toBeLessThan(CLASS_DIMENSIONS.sedan.height);
  });
  it('yaw dynamic index 0.9 to 1.1, as measured on road cars', () => {
    for (const c of bodyClasses) {
      expect(CHASSIS_CLASS[c].yawIndex).toBeGreaterThanOrEqual(0.9);
      expect(CHASSIS_CLASS[c].yawIndex).toBeLessThanOrEqual(1.1);
    }
  });
  it('a mid-size sedan body of 1,450 kg gets roll and pitch inertias where measured (about 500 to 750 and 1,800 to 3,000 kg m^2)', () => {
    const d = CLASS_DIMENSIONS.sedan, ms = 1450;
    const ixx = ms * (ROLL_GYRATION_PER_WIDTH * d.width) * (ROLL_GYRATION_PER_WIDTH * d.width), iyy = ms * (PITCH_GYRATION_PER_LENGTH * d.length) * (PITCH_GYRATION_PER_LENGTH * d.length);
    expect(ixx).toBeGreaterThan(500);
    expect(ixx).toBeLessThan(750);
    expect(iyy).toBeGreaterThan(1800);
    expect(iyy).toBeLessThan(3000);
  });
  it('trucks and vans push more air than any car, and the sports car the least', () => {
    for (const t of trucks) for (const c of passengerCars) expect(CHASSIS_CLASS[t].dragArea).toBeGreaterThan(CHASSIS_CLASS[c].dragArea);
    for (const c of bodyClasses) if (c !== 'sports') expect(CHASSIS_CLASS[c].dragArea).toBeGreaterThan(CHASSIS_CLASS.sports.dragArea);
    // a sedan's Cd 0.28 on 2.2 m^2 is 0.62 m^2; a pickup's Cd about 0.45 on 2.6 to 3.3 m^2 is 1.15 to 1.5
    expect(CHASSIS_CLASS.sedan.dragArea).toBeCloseTo(0.28 * 2.2, 1);
  });
  it('unsprung mass 60 to 160 kg an axle, heaviest under a live-axle pickup', () => {
    for (const c of bodyClasses) for (const m of [CHASSIS_CLASS[c].unsprungFront, CHASSIS_CLASS[c].unsprungRear]) {
      expect(m).toBeGreaterThanOrEqual(60);
      expect(m).toBeLessThanOrEqual(160);
    }
    for (const c of passengerCars) expect(CHASSIS_CLASS.pickup.unsprungRear).toBeGreaterThan(CHASSIS_CLASS[c].unsprungRear);
  });
  it('steering ratios 13 to 20 to 1, quickest in a sports car and slowest in a pickup; anti-dive and anti-squat inside production cars 0.1 to 0.5', () => {
    for (const c of bodyClasses) {
      expect(CLASS_STEER_RATIO[c]).toBeGreaterThanOrEqual(13);
      expect(CLASS_STEER_RATIO[c]).toBeLessThanOrEqual(20);
      expect(CLASS_STEER_RATIO[c]).toBeGreaterThanOrEqual(CLASS_STEER_RATIO.sports);
      expect(CLASS_STEER_RATIO[c]).toBeLessThanOrEqual(CLASS_STEER_RATIO.pickup);
    }
    for (const anti of [ANTI_DIVE, ANTI_SQUAT]) {
      expect(anti).toBeGreaterThanOrEqual(0.1);
      expect(anti).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('layout: weight and brakes', () => {
  it('weight split: front-drive is the most nose-heavy, a mid or rear engine puts most weight on the rear, an empty pickup is nose-heavy whatever drives it', () => {
    const fwd = weightFrontShare('front', 'FWD', 'sedan'), rwd = weightFrontShare('front', 'RWD', 'sedan'), awd = weightFrontShare('front', 'AWD', 'sedan');
    expect(fwd).toBeGreaterThanOrEqual(0.58);
    expect(rwd).toBeGreaterThanOrEqual(0.5);
    expect(rwd).toBeLessThan(awd);
    expect(awd).toBeLessThan(fwd);
    expect(weightFrontShare('front', '4WD', 'suv')).toBe(awd);
    expect(weightFrontShare('mid', 'RWD', 'sports')).toBeLessThan(0.5);
    expect(weightFrontShare('rear', 'RWD', 'sports')).toBeLessThan(weightFrontShare('mid', 'RWD', 'sports'));
    expect(weightFrontShare('front', 'RWD', 'pickup')).toBe(weightFrontShare('front', '4WD', 'pickup'));
    expect(weightFrontShare('front', 'RWD', 'pickup')).toBeGreaterThan(0.55);
  });
  it('brake bias sits above the static front weight share and below what a 1.3 g stop wants: the fronts lock first in ordinary braking, the brake-force distribution trims the rear at the limit', () => {
    const cases: [EngineLocation, Drivetrain, BodyClass][] = [
      ['front', 'FWD', 'hatchback'], ['front', 'FWD', 'sedan'], ['front', 'RWD', 'coupe'], ['front', 'RWD', 'sedan'],
      ['front', 'AWD', 'suv'], ['front', 'AWD', 'sedan'], ['mid', 'RWD', 'sports'], ['rear', 'RWD', 'sports'],
    ];
    for (const [loc, drive, c] of cases) {
      const share = brakeFrontShare(loc, drive), w = weightFrontShare(loc, drive, c), hOverL = cgHeight(c) / CLASS_DIMENSIONS[c].wheelbase;
      const ideal = (g: number): number => w + hOverL * g;   // front axle's share of the load during a stop of g
      expect(share).toBeGreaterThan(ideal(0.4));
      expect(share).toBeLessThan(ideal(BRAKE_SIZING_G));
    }
    expect(brakeFrontShare('front', 'FWD')).toBeGreaterThan(brakeFrontShare('front', 'RWD'));
    expect(brakeFrontShare('mid', 'AWD')).toBe(brakeFrontShare('rear', 'RWD'));
  });
  it('the brakes\' 1.3 g floor out-brakes the touring and off-road tyres\' longitudinal peak; the sizing has the margin and bias range ABS and a setup need; the handbrake can lock a rear wheel of a 1,600 kg sedan on summer tyres', () => {
    // Longitudinal, not lateral: braking friction is muY0 x muXRatio. Summer and max-performance tyres at the top of
    // their range brake harder than 1.3 g (up to 1.37), so there the brakes are sized from each axle's need instead
    // (resolve.ts resolveBrakes; resolve.test checks it per axle for every class, layout and street category).
    const touring: TyreCategory[] = ['all-season', 'all-terrain', 'winter'];
    for (const t of touring) expect(BRAKE_SIZING_G, t).toBeGreaterThan(TYRE_CATEGORY[t].muY0Max * TYRE_CATEGORY[t].muXRatio);
    expect(TYRE_CATEGORY['max-performance'].muY0Max * TYRE_CATEGORY['max-performance'].muXRatio).toBeGreaterThan(BRAKE_SIZING_G);
    expect(BRAKE_AXLE_MARGIN).toBeGreaterThanOrEqual(ABS_CUT_SLIP);   // ABS must be able to drive the slip past its cut
    expect(BRAKE_BIAS_RANGE).toBe(0.06);                               // DESIGN.md 11's bias slider
    const rearCornerLoad = 1600 * G * (1 - weightFrontShare('front', 'FWD', 'sedan')) / 2;
    const summer = TYRE_CATEGORY.summer, r = size(CLASS_TYRES.sedan.rear).radius * LOADED_RADIUS_RATIO;
    expect(HANDBRAKE_TORQUE).toBeGreaterThan(rearCornerLoad * summer.muY0 * summer.muXRatio * r);
  });
});

describe('transmissions and gearing', () => {
  it('every driveline efficiency is below 1 and above 0.8, and all- or four-wheel drive loses 0.04 more', () => {
    for (const t of boxes) {
      for (const d of ['FWD', 'RWD', 'AWD', '4WD'] as Drivetrain[]) {
        const e = drivelineEfficiency(t, d);
        expect(e).toBeLessThan(1);
        expect(e).toBeGreaterThan(0.8);
      }
      expect(drivelineEfficiency(t, 'AWD')).toBeCloseTo(drivelineEfficiency(t, 'RWD') - AWD_EFFICIENCY_PENALTY, 12);
      expect(drivelineEfficiency(t, '4WD')).toBe(drivelineEfficiency(t, 'AWD'));
    }
    // a belt CVT loses the most, an electric car's single reduction the least
    for (const t of boxes) {
      expect(TRANSMISSION.cvt.efficiency).toBeLessThanOrEqual(TRANSMISSION[t].efficiency);
      expect(TRANSMISSION['single-speed'].efficiency).toBeGreaterThanOrEqual(TRANSMISSION[t].efficiency);
    }
  });
  it('the usual gear counts: a six-speed manual, a seven-speed dual-clutch, an eight-speed automatic, one reduction for an electric car', () => {
    expect(TRANSMISSION.manual.gearCount).toBe(6);
    expect(TRANSMISSION['dual-clutch'].gearCount).toBe(7);
    expect(TRANSMISSION.automatic.gearCount).toBe(8);
    expect(TRANSMISSION['single-speed'].gearCount).toBe(1);
    expect(TRANSMISSION.cvt.gearCount).toBe(2);   // its lowest and highest ratio
    expect(TRANSMISSION.ecvt.gearCount).toBe(2);
  });
  it('stepped gears are spaced geometrically, with steps of 1.25 to 1.45 a driver can shift through without falling off the power band', () => {
    for (const t of stepped) {
      const row = TRANSMISSION[t];
      for (const top of [row.topMin, row.topMax]) {
        const n = row.gearCount;
        expect(gearRatioAt(n, n, top, row.spread)).toBe(top);
        expect(gearRatioAt(1, n, top, row.spread)).toBeCloseTo(top * row.spread, 10);
        const step = dpow(row.spread, 1 / (n - 1));
        expect(step).toBeGreaterThanOrEqual(1.25);
        expect(step).toBeLessThanOrEqual(1.45);
        for (let g = 1; g < n; g++) expect(gearRatioAt(g, n, top, row.spread) / gearRatioAt(g + 1, n, top, row.spread)).toBeCloseTo(step, 10);
      }
      expect(row.topMin).toBeGreaterThanOrEqual(0.67);
      expect(row.topMax).toBeLessThanOrEqual(0.80);
    }
    // more gears cover a wider range: the automatic's spread is the widest
    expect(TRANSMISSION.automatic.spread).toBeGreaterThan(TRANSMISSION['dual-clutch'].spread);
    expect(TRANSMISSION['dual-clutch'].spread).toBeGreaterThan(TRANSMISSION.manual.spread);
  });
  it("first gear runs out at 20 to 60 mph on a 6,500 rpm engine with the class's final drive and tyre (a manual at 30 to 60)", () => {
    let checked = 0;
    for (const c of bodyClasses) {
      const r = size(CLASS_TYRES[c].rear).radius * LOADED_RADIUS_RATIO;
      for (const t of stepped) {
        const row = TRANSMISSION[t];
        for (const top of [row.topMin, row.topMax]) {
          const first = gearRatioAt(1, row.gearCount, top, row.spread) * CLASS_FINAL_DRIVE[c];
          const mph = 6500 * RPM / first * r / MPH;
          expect(mph).toBeGreaterThanOrEqual(t === 'manual' ? 30 : 20);
          expect(mph).toBeLessThanOrEqual(60);
          checked++;
        }
      }
    }
    expect(checked).toBe(9 * 3 * 2);
  });
  it('in top gear the class final drive turns the engine at 1,500 to 3,000 rpm at 70 mph, where makers put a cruising gear', () => {
    for (const c of bodyClasses) {
      const r = size(CLASS_TYRES[c].rear).radius * LOADED_RADIUS_RATIO;
      for (const top of [0.67, 0.80]) {
        const engine = rpm(70 * MPH / r * top * CLASS_FINAL_DRIVE[c]);
        expect(engine).toBeGreaterThanOrEqual(1500);
        expect(engine).toBeLessThanOrEqual(3000);
      }
    }
  });
  it("an electric car's single reduction lets a 14,000 rpm motor reach 100 to 160 mph on a sedan's tyre", () => {
    const r = size(CLASS_TYRES.sedan.rear).radius * LOADED_RADIUS_RATIO;
    const mph = defaultRedline('electric', 0, false, 'sedan') / SINGLE_SPEED_FINAL_DRIVE * r / MPH;
    expect(mph).toBeGreaterThanOrEqual(100);
    expect(mph).toBeLessThanOrEqual(160);
  });
  it('launch devices and shifts: a clutch for manual and dual-clutch, a converter for automatic and CVT, nothing for an electric drive; a dual-clutch shifts in under a tenth of a second', () => {
    expect(TRANSMISSION.manual.launch).toBe('clutch');
    expect(TRANSMISSION['dual-clutch'].launch).toBe('clutch');
    expect(TRANSMISSION.automatic.launch).toBe('converter');
    expect(TRANSMISSION.cvt.launch).toBe('converter');
    expect(TRANSMISSION.ecvt.launch).toBe('direct');
    expect(TRANSMISSION['single-speed'].launch).toBe('direct');
    expect(TRANSMISSION['dual-clutch'].shiftTime).toBeLessThan(0.1);
    expect(TRANSMISSION.manual.shiftTime).toBeGreaterThanOrEqual(0.25);     // a human hand and foot
    expect(TRANSMISSION.manual.shiftTorqueHold).toBe(0);                   // the clutch is open
    expect(TRANSMISSION['dual-clutch'].shiftTorqueHold).toBeGreaterThanOrEqual(0.85);
    expect(TRANSMISSION.automatic.shiftTime).toBeLessThan(TRANSMISSION.manual.shiftTime);
    expect(TRANSMISSION.cvt.cvtRatioRate).toBeGreaterThan(0);
    for (const t of stepped) expect(TRANSMISSION[t].cvtRatioRate).toBe(0);
  });
  it('torque converters stall at 1,800 to 2,800 rpm and multiply torque 1.7 to 2.5 times; an automatic locks up from second, a CVT from the start', () => {
    for (const t of boxes) {
      const k = TRANSMISSION[t].converter;
      expect(k !== null).toBe(TRANSMISSION[t].launch === 'converter');
      if (k === null) continue;
      expect(rpm(k.stallOmega)).toBeGreaterThanOrEqual(1800);
      expect(rpm(k.stallOmega)).toBeLessThanOrEqual(2800);
      expect(k.torqueRatio).toBeGreaterThanOrEqual(1.7);
      expect(k.torqueRatio).toBeLessThanOrEqual(2.5);
      expect(k.couplingRatio).toBeGreaterThanOrEqual(0.8);
      expect(k.couplingRatio).toBeLessThan(1);
    }
    expect(TRANSMISSION.automatic.converter?.lockGear).toBe(2);
    expect(TRANSMISSION.cvt.converter?.lockGear).toBe(1);
  });
  it('reverse is a little taller than first or equal to it, and a clutch holds its engine with margin', () => {
    for (const t of boxes) {
      expect(TRANSMISSION[t].reverseOverFirst).toBeGreaterThanOrEqual(0.7);
      expect(TRANSMISSION[t].reverseOverFirst).toBeLessThanOrEqual(1);
    }
    expect(CLUTCH_CAPACITY_RATIO).toBeGreaterThan(1.2);
  });
});

describe('top speed governors', () => {
  it('trucks are governed under the 112 mph S rating of their all-terrain tyres; family cars at 115 to 160 mph; a sports car is not governed in practice', () => {
    for (const c of ['pickup', 'offroad'] as BodyClass[]) expect(CLASS_LIMITER[c] / MPH).toBeLessThanOrEqual(112);
    for (const c of ['coupe', 'sedan', 'hatchback', 'wagon', 'suv', 'van'] as BodyClass[]) {
      expect(CLASS_LIMITER[c] / MPH).toBeGreaterThanOrEqual(115);
      expect(CLASS_LIMITER[c] / MPH).toBeLessThanOrEqual(160);
    }
    expect(CLASS_LIMITER.sports / MPH).toBeGreaterThan(250);
    expect(CLASS_LIMITER.coupe).toBeCloseTo(155 * 0.44704, 9);   // the German makers' 250 km/h agreement
  });
  it('a quick model is never governed lower than its class, and the raise begins around a 250 hp, 1,500 kg car', () => {
    for (const c of bodyClasses) expect(CLASS_LIMITER_PERFORMANCE[c]).toBeGreaterThanOrEqual(CLASS_LIMITER[c]);
    const wPerKg = 250 * 745.6998715822702 / 1500;
    expect(LIMITER_RAISE_BAND.from).toBeGreaterThan(0.95 * wPerKg);
    expect(LIMITER_RAISE_BAND.from).toBeLessThan(1.05 * wPerKg);
    expect(LIMITER_RAISE_BAND.to).toBeGreaterThan(LIMITER_RAISE_BAND.from);
  });
});

describe('default tyres by class', () => {
  it('all-season on family cars and vans, summer on a coupe, max-performance on a sports car, all-terrain on pickups and off-roaders', () => {
    const want: Record<BodyClass, TyreCategory> = {
      sedan: 'all-season', hatchback: 'all-season', wagon: 'all-season', suv: 'all-season', van: 'all-season',
      coupe: 'summer', sports: 'max-performance', pickup: 'all-terrain', offroad: 'all-terrain',
    };
    for (const c of bodyClasses) expect(CLASS_TYRES[c].category).toBe(want[c]);
  });
  it('every default size reads, rolls at 0.30 to 0.42 m, matches front to rear within 1%, and is tallest on the trucks', () => {
    for (const c of bodyClasses) {
      const f = size(CLASS_TYRES[c].front), r = size(CLASS_TYRES[c].rear);
      for (const t of [f, r]) {
        expect(t.radius).toBeGreaterThanOrEqual(0.30);
        expect(t.radius).toBeLessThanOrEqual(0.42);
        expect(t.width).toBeGreaterThanOrEqual(0.195);
        expect(t.width).toBeLessThanOrEqual(0.315);
      }
      expect(Math.abs(f.radius / r.radius - 1)).toBeLessThan(0.01);
      for (const k of passengerCars) {
        if (c === 'pickup' || c === 'offroad') expect(r.radius).toBeGreaterThan(size(CLASS_TYRES[k].rear).radius);
      }
    }
    // a sports car runs a wider rear to put its power down
    expect(size(CLASS_TYRES.sports.rear).width).toBeGreaterThan(size(CLASS_TYRES.sports.front).width);
    expect(size(CLASS_TYRES.sports.front).width).toBeGreaterThan(size(CLASS_TYRES.hatchback.front).width);
  });
});

describe('wheels', () => {
  it('a wheel and tyre weighs what scales show: 205/55R16 16 to 21 kg, 245/40R19 21 to 26 kg', () => {
    const small = size('205/55R16'), big = size('245/40R19');
    expect(wheelMass(small.width, small.rimIn)).toBeGreaterThanOrEqual(16);
    expect(wheelMass(small.width, small.rimIn)).toBeLessThanOrEqual(21);
    expect(wheelMass(big.width, big.rimIn)).toBeGreaterThanOrEqual(21);
    expect(wheelMass(big.width, big.rimIn)).toBeLessThanOrEqual(26);
  });
  it('a 225/45R17 corner spins with 1 to 2 kg m^2, and four of them add 3 to 6% to a 1,600 kg car in a straight line', () => {
    const t = size('225/45R17'), r = t.radius * LOADED_RADIUS_RATIO;
    const j = wheelInertia(wheelMass(t.width, t.rimIn), r);
    expect(j).toBeGreaterThan(1);
    expect(j).toBeLessThan(2);
    const equivalentMass = 4 * j / (r * r);
    expect(equivalentMass / 1600).toBeGreaterThan(0.03);
    expect(equivalentMass / 1600).toBeLessThan(0.06);
    const big = size('245/40R19');
    expect(wheelInertia(wheelMass(big.width, big.rimIn), big.radius * LOADED_RADIUS_RATIO)).toBeGreaterThan(j);
  });
});

describe('engines', () => {
  it('idles at 750 rpm, or 650 with eight cylinders or more', () => {
    for (const n of [0, 3, 4, 5, 6]) expect(rpm(defaultIdle(n))).toBeCloseTo(750, 9);
    for (const n of [8, 10, 12]) expect(rpm(defaultIdle(n))).toBeCloseTo(650, 9);
  });
  it('redline: a petrol engine 6,500 rpm, a V8 6,200, a turbo four in a truck 6,000, a diesel 5,500; an electric motor spins far past all of them', () => {
    expect(rpm(defaultRedline('gasoline', 4, false, 'sedan'))).toBeCloseTo(6500, 9);
    expect(rpm(defaultRedline('hybrid', 4, false, 'hatchback'))).toBeCloseTo(6500, 9);
    expect(rpm(defaultRedline('gasoline', 4, true, 'sedan'))).toBeCloseTo(6500, 9);
    expect(rpm(defaultRedline('gasoline', 8, false, 'coupe'))).toBeCloseTo(6200, 9);
    expect(rpm(defaultRedline('gasoline', 8, true, 'pickup'))).toBeCloseTo(6200, 9);
    expect(rpm(defaultRedline('gasoline', 4, true, 'pickup'))).toBeCloseTo(6000, 9);
    expect(rpm(defaultRedline('gasoline', 4, true, 'offroad'))).toBeCloseTo(6000, 9);
    expect(rpm(defaultRedline('gasoline', 4, false, 'pickup'))).toBeCloseTo(6500, 9);
    expect(rpm(defaultRedline('diesel', 6, true, 'pickup'))).toBeCloseTo(5500, 9);
    expect(rpm(defaultRedline('electric', 0, false, 'sedan'))).toBeGreaterThan(10000);
  });
  it('peak speeds: torque before power before redline; a boosted engine holds its torque from under 2,000 rpm and runs out of breath sooner', () => {
    for (const boosted of [false, true]) {
      const s = peakSpeedShares(boosted);
      expect(s.torqueLow).toBeLessThanOrEqual(s.torqueHigh);
      expect(s.torqueHigh).toBeLessThan(s.power);
      expect(s.power).toBeLessThan(1);
    }
    const na = peakSpeedShares(false), turbo = peakSpeedShares(true);
    expect(6500 * turbo.torqueLow).toBeLessThan(2000);
    expect(turbo.torqueLow).toBeLessThan(na.torqueLow);
    expect(turbo.power).toBeLessThan(na.power);
    expect(6500 * na.torqueLow).toBeGreaterThan(4000);   // an unboosted engine's torque peak sits high
  });
  it('friction: a petrol engine loses 1 to 2 bar of mean pressure at 2,000 rpm; a diesel loses more at every running speed', () => {
    const at = (c: readonly [number, number, number], x: number): number => c[0] + c[1] * x + c[2] * x * x;
    const petrol2000 = at(FMEP.petrol, 2);
    expect(petrol2000).toBeGreaterThan(100e3);
    expect(petrol2000).toBeLessThan(200e3);
    for (let x = 0.6; x <= 6; x += 0.2) expect(at(FMEP.diesel, x)).toBeGreaterThan(at(FMEP.petrol, x));
    expect(fmepFor('diesel')).toBe(FMEP.diesel);
    expect(fmepFor('hybrid')).toBe(FMEP.petrol);
    expect(fmepFor('gasoline')).toBe(FMEP.petrol);
  });
  it('charge air: the compressor is 0.6 to 0.78 efficient; at its default boost an intercooled engine breathes 30 to 60 C air, and the same air leaves the compressor at 90 to 140 C before it is cooled', () => {
    expect(COMPRESSOR_EFFICIENCY).toBeGreaterThanOrEqual(0.6);
    expect(COMPRESSOR_EFFICIENCY).toBeLessThanOrEqual(0.78);
    for (const kind of ['turbo', 'supercharged'] as const) {
      const a = CHARGE_AIR[kind], pr = 1 + a.boostPa / P_AMBIENT;
      expect(a.intercooler).toBeGreaterThan(0);
      expect(a.intercooler).toBeLessThan(1);
      const rise = T_AMBIENT * (dpow(pr, 0.286) - 1) / COMPRESSOR_EFFICIENCY;
      const manifoldC = T_AMBIENT + (1 - a.intercooler) * rise - 273.15;
      expect(manifoldC).toBeGreaterThan(30);
      expect(manifoldC).toBeLessThan(60);
      if (kind === 'turbo') {
        expect(T_AMBIENT + rise - 273.15).toBeGreaterThan(90);
        expect(T_AMBIENT + rise - 273.15).toBeLessThan(140);
      }
      // stock boost leaves headroom under pump fuel's knock limit for a tune
      expect(pr).toBeLessThan(KNOCK_LIMIT_PR);
    }
    expect(CHARGE_AIR.supercharged.intercooler).toBeLessThan(CHARGE_AIR.turbo.intercooler);
    expect(CHARGE_AIR.supercharged.blowerDrive).toBeCloseTo(0.12, 12);
    expect(CHARGE_AIR.turbo.blowerDrive).toBe(0);
    expect(KNOCK_LIMIT_PR).toBeCloseTo(2.6, 12);
  });
  it('a 2.0-litre four with its flywheel has 0.12 to 0.25 kg m^2, a 6.2-litre V8 0.25 to 0.45, an electric rotor less than either', () => {
    expect(engineInertia(2.0, false)).toBeGreaterThanOrEqual(0.12);
    expect(engineInertia(2.0, false)).toBeLessThanOrEqual(0.25);
    expect(engineInertia(6.2, false)).toBeGreaterThanOrEqual(0.25);
    expect(engineInertia(6.2, false)).toBeLessThanOrEqual(0.45);
    expect(engineInertia(0, true)).toBeLessThan(engineInertia(1.0, false));
  });
});

describe('differentials and all-wheel drive', () => {
  it('an open differential locks nothing, a locked one everything, a limited-slip in between with a torque bias ratio of 1.5 to 3', () => {
    expect(DIFF_DEFAULT.open.preload).toBe(0);
    expect(DIFF_DEFAULT.open.lockPerTorque).toBe(0);
    expect(DIFF_DEFAULT.locked.preload).toBe(Infinity);
    for (const k of ['limited-slip', 'active'] as DiffKind[]) {
      const d = DIFF_DEFAULT[k], tbr = (1 + d.lockPerTorque) / (1 - d.lockPerTorque);
      expect(d.kind).toBe(k);
      expect(tbr).toBeGreaterThanOrEqual(1.5);
      expect(tbr).toBeLessThanOrEqual(3);
      expect(d.preload).toBeGreaterThan(0);
    }
    expect(DIFF_DEFAULT.active.lockPerTorque).toBeGreaterThan(DIFF_DEFAULT['limited-slip'].lockPerTorque);
  });
  it('a fixed centre splits 30:70 to 50:50, an on-demand coupling starts on its own axle, a part-time system engaged is locked', () => {
    expect(AWD_CENTRE.fixed.kind).toBe('fixed');
    expect(AWD_CENTRE.fixed.frontShare).toBeGreaterThanOrEqual(0.3);
    expect(AWD_CENTRE.fixed.frontShare).toBeLessThanOrEqual(0.5);
    expect(AWD_CENTRE['front-on-demand']).toMatchObject({ kind: 'coupling', frontShare: 1 });
    expect(AWD_CENTRE['rear-on-demand']).toMatchObject({ kind: 'coupling', frontShare: 0 });
    expect(AWD_CENTRE['front-on-demand'].lockTorque).toBeGreaterThan(0);
    expect(AWD_CENTRE['part-time']).toMatchObject({ kind: 'coupling', lockTorque: Infinity });
  });
});

describe('the tables cannot be changed by one car', () => {
  // Every exported object, found from the module itself so that a table added later is covered too.
  const tables = Object.keys(classes).sort().map((k) => [k, (classes as Record<string, unknown>)[k]] as const)
    .filter(([, v]) => typeof v === 'object' && v !== null);
  it('every exported table, every row and everything inside them is frozen', () => {
    let frozen = 0;
    const walk = (name: string, v: unknown): void => {
      if (typeof v !== 'object' || v === null) return;
      expect(Object.isFrozen(v), name).toBe(true);
      frozen++;
      for (const [k, inner] of Object.entries(v)) walk(`${name}.${k}`, inner);
    };
    for (const [name, v] of tables) walk(name, v);
    expect(tables.length).toBeGreaterThanOrEqual(28);
    // at least every table, the rows of the three per-class tables, and the tyre, transmission, grade, differential
    // and centre rows: the walk really went inside
    expect(frozen).toBeGreaterThanOrEqual(tables.length + 3 * 9 + 7 + 6 + 4 + 4 + 4);
  });
  it('writing to a row throws instead of quietly changing every car', () => {
    expect(() => { (TYRE_CATEGORY.summer as { muY0: number }).muY0 = 2; }).toThrow(TypeError);
    expect(() => { (CHASSIS_CLASS.sedan as { rideHzFront: number }).rideHzFront = 3; }).toThrow(TypeError);
    expect(() => { (DIFF_DEFAULT['limited-slip'] as { preload: number }).preload = 0; }).toThrow(TypeError);
    expect(TYRE_CATEGORY.summer.muY0).toBe(1.02);
  });
});
