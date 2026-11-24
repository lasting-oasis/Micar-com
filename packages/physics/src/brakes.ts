// The brakes (DESIGN.md section 6): what the pedal and the handbrake ask of each wheel, and what the ABS unit lets
// through. The unit does two jobs, as real ones do:
//  - ABS: a wheel whose slip runs well past the tyre's braking peak has its pressure dumped until the wheel spins
//    back up, then built again. Past the peak the tyre gives less force and, locked, none to steer with.
//  - Brake-force distribution: a car's fixed front-to-rear bias is right for one deceleration only. Stopping harder,
//    weight moves forward and the rear wheels would lock first, which makes the car swap ends. So a rear wheel whose
//    slip runs past the front's has its pressure held, and trimmed if it keeps going.
// Both go together: with ABS off (or not fitted) the pedal goes straight to the calipers.
// The unit judges slip as a real one does, from each wheel's speed against the road under it. The tyre's own slip
// state lags that by its relaxation length (7 ms at 100 km/h, 36 ms at 18 km/h), and a wheel can lock in less; a unit
// that waited for the tyre would dump late and deep and give back 10 to 25% of the stop instead of 1 to 4%.
// The handbrake is a separate circuit that the unit does not see, so a handbrake turn still locks the rears.
// Runs inside the step for every wheel: plain arithmetic, nothing allocated.
import type { Controls, VehicleState } from './types';
import { dcos, dsin } from './math';
import { peakSlipRatio } from './tyre';

/** ABS dumps a wheel's pressure while its braking slip is beyond this many peak slips... */
export const ABS_CUT_SLIP = 1.15;
/** ...and builds it again while the slip is within this many. */
export const ABS_RESTORE_SLIP = 0.75;
/** Time constant, s, of a dump: pressure falls fast through the outlet valve. */
export const ABS_CUT_TAU = 0.03;
/** Time constant, s, of the build back: the pump returns pressure more slowly than the valve lets it out. */
export const ABS_RESTORE_TAU = 0.08;
/**
 * Time constant, s, of the slow, stepped build a unit makes while the slip sits between the two thresholds, where
 * the tyre gives 94% of its peak or more: it feels for the peak again, so the wheel works through it instead of
 * parking at the bottom of the band.
 */
export const ABS_PROBE_TAU = 0.25;
/**
 * Below this wheel speed over the road, m/s, the unit lets the pedal through, as real ones do below 5 to 10 km/h:
 * the wheel-speed signal is too coarse there, and a car held on the brake at rest must stay held.
 */
export const ABS_MIN_SPEED = 2;
/**
 * Brake-force distribution trims a rear wheel's pressure while its slip is past the front axle's, and holds it while
 * the slip is within this many peak slips below that, so the rear settles just under the front instead of cycling.
 */
export const EBD_MARGIN = 0.15;
/** Below this many peak slips a rear tyre is nowhere near locking, and distribution leaves it alone whatever the fronts do. */
export const EBD_FLOOR = 0.3;
/** Time constant, s, of the trim: it corrects a bias, not a lock, so it is gentler than a dump. */
export const EBD_TAU = 0.08;
// A hold factor this close to 1 is 1: the build is asymptotic and "not acting" must be reachable exactly.
const HOLD_FULL = 0.999;

// Moves x toward a target with time constant tau over h seconds, implicitly, so it is stable for any h.
function approach(x: number, target: number, h: number, tau: number): number {
  const k = h / tau;
  return (x + target * k) / (1 + k);
}

function unit(x: number): number { return x > 0 ? (x < 1 ? x : 1) : 0; }

/** The speed of wheel i's centre along the way the wheel points, m/s, from the body's motion and the wheel's steer angle. */
export function wheelRoadSpeed(s: VehicleState, i: number): number {
  const ch = s.model.chassis;
  const front = i < 2;
  const x = front ? ch.a : -ch.b;
  const half = 0.5 * (front ? ch.trackFront : ch.trackRear);
  const y = i === 0 || i === 2 ? half : -half;
  const vx = s.u - s.r * y, vy = s.v + s.r * x;
  const steer = s.wheelSteer[i];
  return steer === 0 ? vx : vx * dcos(steer) + vy * dsin(steer);
}

/**
 * Works out the brake torque at each wheel, N m, from the pedal and the handbrake (both 0 to 1), and lets the car's
 * ABS act on it: per wheel, a slip well past the tyre's braking peak dumps that wheel's pressure (0.03 s) until the
 * slip recovers, then builds it back (0.08 s), and a rear wheel is held to the front's slip (brake-force
 * distribution). grip is the surface grip under each wheel. Writes s.wheelBrake, s.absHold (the share of pedal
 * torque each wheel is let through) and s.absActive (1 where the unit is holding a braked wheel back).
 */
export function brakeTorques(s: VehicleState, c: Controls, grip: Float64Array, h: number): void {
  const m = s.model, b = m.brakes;
  const pedal = unit(c.brake), hand = unit(c.handbrake);
  const absOn = m.systems.abs && c.abs;
  // How far the front axle's wheels are slipping under braking, on average: the rears are kept within it.
  let frontSlip = 0;
  if (absOn) {
    frontSlip = 0.5 * (brakingSlip(s, 0, wheelRoadSpeed(s, 0)) + brakingSlip(s, 1, wheelRoadSpeed(s, 1)));
    if (frontSlip < 0) frontSlip = 0;
  }

  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const pedalTorque = pedal * (front ? b.maxTorqueFront : b.maxTorqueRear);
    let hold = s.absHold[i];
    const road = absOn ? wheelRoadSpeed(s, i) : 0;
    if (!absOn) {
      hold = 1;
    } else if (!(pedalTorque > 0) || !(road > ABS_MIN_SPEED || road < -ABS_MIN_SPEED)) {
      // Nothing asked of this wheel, or too slow to judge: the valves go back to letting the pedal through.
      hold = approach(hold, 1, h, ABS_RESTORE_TAU);
    } else {
      const peak = peakSlipRatio(front ? m.tyreFront : m.tyreRear, s.wheelLoad[i], grip[i]);
      const slip = brakingSlip(s, i, road);
      if (slip > ABS_CUT_SLIP * peak) {
        hold = approach(hold, 0, h, ABS_CUT_TAU);
      } else {
        // Brake-force distribution: a rear wheel may slip as much as the front axle, no more. Past that its pressure
        // is trimmed in proportion to how far past it is, so it settles instead of cycling; just under it, held.
        let ref = Infinity;
        if (!front) { const floor = EBD_FLOOR * peak; ref = frontSlip > floor ? frontSlip : floor; }
        if (slip > ref) hold = approach(hold, hold * ref / slip, h, EBD_TAU);
        else if (slip > ref - EBD_MARGIN * peak) { /* held: the inlet valve stays shut */ }
        else if (slip < ABS_RESTORE_SLIP * peak) hold = approach(hold, 1, h, ABS_RESTORE_TAU);
        else hold = approach(hold, 1, h, ABS_PROBE_TAU);
      }
    }
    if (hold > HOLD_FULL) hold = 1;
    s.absHold[i] = hold;
    // The handbrake's own circuit bypasses the unit.
    s.wheelBrake[i] = pedalTorque * hold + (front ? 0 : hand * b.handbrakeTorque);
    s.absActive[i] = hold < 1 && pedalTorque > 0 ? 1 : 0;
  }
}

// How much slower wheel i turns than the road under it (road: wheelRoadSpeed), as a share of the road speed (0
// rolling, 1 locked), the way an ABS unit reads it from its wheel-speed sensor. 0 when the wheel barely moves over the road.
function brakingSlip(s: VehicleState, i: number, road: number): number {
  if (!(road > ABS_MIN_SPEED || road < -ABS_MIN_SPEED)) return 0;
  const radius = i < 2 ? s.model.tyreFront.radius : s.model.tyreRear.radius;
  // (road - omega R) / road: the same in reverse, where both are negative.
  return 1 - s.wheelOmega[i] * radius / road;
}
