// The four proof cars (car.test.ts) and the golden run: a fixed input log driven on each, whose state hash is pinned
// here. The plan of record asks that the same inputs give the same state hash in Chromium, Firefox, WebKit and Node;
// two runs in one process cannot show that (a platform-dependent result changes both alike), a pinned number can.
// This is ordinary source, not a test, so that a browser can bundle and run it exactly as Node does, and so that the
// determinism scan covers it too.
//
// The sheets carry the figures a maker's specification lists, typical of their kind (sources "illustrative": they
// describe no particular car).
import type { Controls, PhysicsSheet, Source } from './types';
import { rng } from './math';
import { resolveModel } from './resolve';
import { emptySheet } from './sheet';
import { FLAT, defaultControls } from './state';
import { createVehicle, hashState, step } from './vehicle';

const src: Source = { kind: 'illustrative', name: 'typical figures for the kind of car' };
function n<T>(value: T): { value: T; source: Source } { return { value, source: src }; }

/** A 3,300 lb front-drive family sedan: 2.5 L four, 200 hp, all-season tyres, an eight-speed automatic. */
export function proofSedanSheet(): PhysicsSheet {
  const s = emptySheet('proof-sedan', { year: 2022, make: 'Illustrative', model: 'Family sedan', trim: '2.5', bodyClass: 'sedan' });
  s.curbWeightLb = n(3300); s.drivetrain = n('FWD'); s.engineLocation = n('front'); s.transmissionType = n('automatic');
  s.powertrain = n('gasoline'); s.induction = n('natural'); s.displacementL = n(2.5); s.cylinders = n(4);
  s.horsepower = n(200); s.horsepowerRpm = n(6600); s.torqueLbFt = n(184); s.torqueRpmLow = n(5000); s.redlineRpm = n(6800);
  s.tyreFront = n('215/55R17'); s.tyreRear = n('215/55R17'); s.tyreCategory = n('all-season');
  s.wheelbaseIn = n(111.2); s.trackFrontIn = n(62.4); s.trackRearIn = n(62.8); s.lengthIn = n(192.1); s.widthIn = n(72.4); s.heightIn = n(56.9);
  return s;
}

/** A 3,650 lb mid-engine rear-drive sports car: 6.2 L V8, 495 hp, max-performance tyres, a dual-clutch. */
export function proofSportsSheet(): PhysicsSheet {
  const s = emptySheet('proof-sports', { year: 2022, make: 'Illustrative', model: 'Mid-engine sports car', trim: '6.2', bodyClass: 'sports' });
  s.curbWeightLb = n(3650); s.drivetrain = n('RWD'); s.engineLocation = n('mid'); s.transmissionType = n('dual-clutch');
  s.powertrain = n('gasoline'); s.induction = n('natural'); s.displacementL = n(6.2); s.cylinders = n(8);
  s.horsepower = n(495); s.horsepowerRpm = n(6450); s.torqueLbFt = n(470); s.torqueRpmLow = n(5150); s.redlineRpm = n(6600);
  s.tyreFront = n('245/35ZR19'); s.tyreRear = n('305/30ZR20'); s.tyreCategory = n('max-performance');
  s.wheelbaseIn = n(107.2); s.lengthIn = n(182.3); s.widthIn = n(76.1); s.heightIn = n(48.6); s.weightDistFrontPct = n(40);
  return s;
}

/** A 3,900 lb front-engine rear-drive coupe: 5.0 L V8, 480 hp, summer tyres, a six-speed manual. */
export function proofCoupeSheet(): PhysicsSheet {
  const s = emptySheet('proof-coupe', { year: 2022, make: 'Illustrative', model: 'V8 coupe', trim: '5.0', bodyClass: 'coupe' });
  s.curbWeightLb = n(3900); s.drivetrain = n('RWD'); s.engineLocation = n('front'); s.transmissionType = n('manual');
  s.powertrain = n('gasoline'); s.induction = n('natural'); s.displacementL = n(5.0); s.cylinders = n(8);
  s.horsepower = n(480); s.horsepowerRpm = n(7000); s.torqueLbFt = n(420); s.torqueRpmLow = n(4600); s.redlineRpm = n(7500);
  s.tyreFront = n('255/40ZR19'); s.tyreRear = n('275/40ZR19'); s.tyreCategory = n('summer');
  s.wheelbaseIn = n(107.1); s.lengthIn = n(188.5); s.widthIn = n(75.4); s.heightIn = n(54.3); s.weightDistFrontPct = n(53);
  return s;
}

/** A 5,700 lb four-wheel-drive pickup: 3.5 L twin-turbo V6, 450 hp, all-terrain tyres, an automatic. */
export function proofPickupSheet(): PhysicsSheet {
  const s = emptySheet('proof-pickup', { year: 2022, make: 'Illustrative', model: 'Desert pickup', trim: '3.5T', bodyClass: 'pickup' });
  s.curbWeightLb = n(5700); s.drivetrain = n('4WD'); s.engineLocation = n('front'); s.transmissionType = n('automatic');
  s.powertrain = n('gasoline'); s.induction = n('twin-turbo'); s.displacementL = n(3.5); s.cylinders = n(6);
  s.horsepower = n(450); s.horsepowerRpm = n(5850); s.torqueLbFt = n(510); s.torqueRpmLow = n(3500); s.redlineRpm = n(6000);
  s.tyreFront = n('LT315/70R17'); s.tyreRear = n('LT315/70R17'); s.tyreCategory = n('all-terrain');
  s.wheelbaseIn = n(145.4); s.lengthIn = n(220.0); s.widthIn = n(86.3); s.heightIn = n(78.5);
  return s;
}

/** The four proof cars by name, in a fixed order. */
export const PROOF_CARS: readonly ('sedan' | 'sports' | 'coupe' | 'pickup')[] = ['sedan', 'sports', 'coupe', 'pickup'];

/** A proof car's sheet by name. */
export function proofSheet(name: string): PhysicsSheet {
  if (name === 'sedan') return proofSedanSheet();
  if (name === 'sports') return proofSportsSheet();
  if (name === 'coupe') return proofCoupeSheet();
  if (name === 'pickup') return proofPickupSheet();
  throw new Error(`no proof car named ${name}`);
}

/** Steps in the golden run: 2,000 steps, 16.7 s of driving. */
export const GOLDEN_STEPS = 2000;

/**
 * The input log of the golden run: from a seeded source (math.ts rng(1234)), a new throttle, an occasional brake and
 * a steer every 40 steps (a third of a second), held in between. The same numbers on every machine.
 */
export function goldenLog(): Controls[] {
  const rand = rng(1234), log: Controls[] = [];
  for (let k = 0; k < GOLDEN_STEPS; k++) {
    if (k % 40 === 0) {
      const c = defaultControls();
      // One call at a time, in this order: throttle, then the brake's chance and size, then the steer.
      c.throttle = rand();
      c.brake = rand() < 0.8 ? 0 : rand();
      c.steer = 2 * rand() - 1;
      log.push(c);
    } else log.push(log[log.length - 1]);
  }
  return log;
}

/** Resolves a proof car from its sheet, drives the golden log on flat ground and returns the final state hash. */
export function goldenRun(name: string): number {
  const s = createVehicle(resolveModel(proofSheet(name)).model), log = goldenLog();
  for (let k = 0; k < log.length; k++) step(s, log[k], FLAT);
  return hashState(s);
}

/**
 * The state hash each proof car ends the golden run with. Every machine and every browser must give exactly these.
 * A deliberate change to the physics changes them: update them in the same commit as that change, and say why there.
 * (Last set when the solver's convergence loop, the road-speed centre coupling, rolling resistance as friction, the
 * tyres' re-stick, the shift logic's road speed, the auto-clutch's bite, neutral at once, the brakes' axle sizing and
 * the host-independent hash went in; set again when traction control gained its brake half, whose memory the state
 * now carries and hashes, and front-drive cars lost the class's understeering margin in their roll split.)
 */
export const GOLDEN: Readonly<Record<string, number>> = {
  sedan: 2015088161,
  sports: 3605451667,
  coupe: 246215136,
  pickup: 490601578,
};
