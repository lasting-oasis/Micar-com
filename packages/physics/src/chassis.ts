// The chassis (DESIGN.md section 4): where the car's weight sits on its four tyres, and how the sprung body heaves,
// pitches and rolls on its springs, dampers and anti-roll bars.
//
// Load moves between wheels by three paths, as on a real car:
//  - geometric, at once: through the roll centres and the anti-dive or anti-squat links, and through the unsprung
//    masses, which sit on their own tyres;
//  - elastic, as the body moves: whatever the springs, bars and dampers push back with;
//  - aerodynamic: lift or downforce at each axle, and the couple drag makes with the tyres' push at the road.
// In the steady state they add up to what statics demands (m ax h / L front to rear, m ay h across), because the
// resolver keeps ms hs + mu hu = m h. All of it runs inside the step: plain arithmetic, nothing allocated.
import type { ChassisModel, VehicleState } from './types';
import type { AeroOut } from './aero';
import { G } from './math';

/** Writes the four wheel loads of the car standing on level ground, N (0 FL, 1 FR, 2 RL, 3 RR): its weight split between the axles by where the centre of gravity sits. */
export function staticLoads(c: ChassisModel, out: Float64Array): void {
  const front = frontAxleShare(c) * c.mass * G;
  const rear = c.mass * G - front;
  out[0] = 0.5 * front; out[1] = 0.5 * front;
  out[2] = 0.5 * rear; out[3] = 0.5 * rear;
}

/** Sets the road wheels' steer angles from the steering input (-1 to 1, +1 full lock left): both fronts turn together to the car's lock, the rears stay straight. */
export function steerAngles(s: VehicleState, steer: number): void {
  // The rack has end stops: an input past full lock turns the wheels no further.
  const lock = (steer > 1 ? 1 : steer < -1 ? -1 : steer) * s.model.chassis.maxSteer;
  s.wheelSteer[0] = lock; s.wheelSteer[1] = lock;
  s.wheelSteer[2] = 0; s.wheelSteer[3] = 0;
}

/**
 * Writes each wheel's load, N, from the car's weight, the air (lift and drag), the last substep's accelerations
 * (s.ax, s.ay) and where the body sits on its springs (pitch, roll and their rates). A wheel pushed off the road
 * carries nothing and its partner on the axle carries the whole axle; the moment that wheel can no longer hold
 * goes to the other axle, as a stiff body passes it, so the car's weight and its overturning moment are always held.
 */
export function wheelLoads(s: VehicleState, air: AeroOut): void {
  const c = s.model.chassis;
  const L = c.a + c.b, invL = L > 0 ? 1 / L : 0;
  const ax = s.ax, ay = s.ay;
  const weight = c.mass * G;

  // Each axle's share of the weight, less the lift on it.
  const staticFront = frontAxleShare(c) * weight;
  let front = staticFront - air.liftFront;
  let rear = (weight - staticFront) - air.liftRear;

  // Front to rear. The links (anti-dive, anti-squat) and the unsprung masses move their share at once; the springs
  // and dampers carry the rest as the body pitches. Drag acts at the centre of gravity's height while the tyres push
  // at the road, so the two make a couple that moves load onto the rear (moving backward, onto the front).
  const anti = antiShare(s, ax);
  const pitchMoment = c.sprungMass * ax * c.sprungCgHeight * anti
    + (c.unsprungFront * c.unsprungHeightFront + c.unsprungRear * c.unsprungHeightRear) * ax
    - pitchStiffness(c) * s.pitch - pitchDamping(c) * s.pitchRate
    - air.drag * c.cgHeight;
  const toRear = pitchMoment * invL;
  front -= toRear;
  rear += toRear;
  // An axle the road no longer touches carries nothing and the other carries the car (a wheelie, a stoppie); with
  // more lift than weight the car is off the ground.
  if (front < 0) { rear += front; front = 0; }
  if (rear < 0) { front += rear; rear = 0; }
  if (front < 0) front = 0;

  // Across each axle, to the right wheel (a left turn, ay > 0, loads the right side). The roll centre carries the
  // sprung mass's share at once, the unsprung mass rides on its own tyres, and the springs, bars and dampers carry
  // what the body's roll gives them.
  const tF = c.trackFront, tR = c.trackRear;
  const invTF = tF > 0 ? 1 / tF : 0, invTR = tR > 0 ? 1 / tR : 0;
  const ms = c.sprungMass;
  let dF = (rollStiffnessFront(c) * s.roll + rollDampingFront(c) * s.rollRate
    + ms * c.b * invL * ay * c.rollCentreFront + c.unsprungFront * ay * c.unsprungHeightFront) * invTF;
  let dR = (rollStiffnessRear(c) * s.roll + rollDampingRear(c) * s.rollRate
    + ms * c.a * invL * ay * c.rollCentreRear + c.unsprungRear * ay * c.unsprungHeightRear) * invTR;

  // An axle can move at most half its load across before its inner wheel leaves the road. The body is stiff in
  // torsion, so the moment that axle cannot hold goes to the other one (a hot hatch lifting its inner rear wheel
  // loads its outer front harder). Whatever neither axle can hold is the car tipping over, which is not modelled.
  const capF = 0.5 * front, capR = 0.5 * rear;
  let spillF = 0, spillR = 0;   // N m
  if (dF > capF) { spillF = (dF - capF) * tF; dF = capF; } else if (dF < -capF) { spillF = (dF + capF) * tF; dF = -capF; }
  if (dR > capR) { spillR = (dR - capR) * tR; dR = capR; } else if (dR < -capR) { spillR = (dR + capR) * tR; dR = -capR; }
  dF += spillR * invTF;
  dR += spillF * invTR;
  if (dF > capF) dF = capF; else if (dF < -capF) dF = -capF;
  if (dR > capR) dR = capR; else if (dR < -capR) dR = -capR;

  // At the cap these are exactly 0 and exactly the whole axle (halving and doubling are exact in binary).
  s.wheelLoad[0] = 0.5 * front - dF;
  s.wheelLoad[1] = 0.5 * front + dF;
  s.wheelLoad[2] = 0.5 * rear - dR;
  s.wheelLoad[3] = 0.5 * rear + dR;
}

/**
 * Advances the sprung body's heave, pitch and roll by h seconds from the substep's accelerations (s.ax, s.ay) and
 * the lift at each axle. Each is a mass on springs and dampers, integrated rate first with the damping taken at the
 * new rate (so a stiff damper cannot overshoot), then the angle.
 */
export function suspensionStep(s: VehicleState, air: AeroOut, h: number): void {
  const c = s.model.chassis;
  const L = c.a + c.b, invL = L > 0 ? 1 / L : 0;
  const ms = c.sprungMass;

  // Pitch (nose down positive): the body's inertia about the ground pitches it against the springs, less the share
  // the anti-dive or anti-squat links hold at once. Braking dives the nose; accelerating squats the tail.
  const anti = antiShare(s, s.ax);
  const pitchForce = -ms * s.ax * c.sprungCgHeight * (1 - anti) - pitchStiffness(c) * s.pitch;
  s.pitchRate = dampedRate(s.pitchRate, pitchForce, pitchDamping(c), c.iyy, h);
  s.pitch += s.pitchRate * h;

  // Roll (right side down positive) about the roll axis, which lies hRoll below the sprung centre of gravity. As the
  // body rolls its weight moves outboard, which adds ms g hRoll roll: the springs and bars must beat it to stand.
  const hRoll = rollArm(c, invL);
  const rollForce = ms * s.ay * hRoll + ms * G * hRoll * s.roll
    - (rollStiffnessFront(c) + rollStiffnessRear(c)) * s.roll;
  s.rollRate = dampedRate(s.rollRate, rollForce, rollDampingFront(c) + rollDampingRear(c), c.ixx, h);
  s.roll += s.rollRate * h;

  // Heave (up positive, 0 at rest): lift raises the body on its four springs, downforce lowers it.
  const heaveForce = air.liftFront + air.liftRear - 2 * (c.springFront + c.springRear) * s.heave;
  s.heaveRate = dampedRate(s.heaveRate, heaveForce, 2 * (c.damperFront + c.damperRear), ms, h);
  s.heave += s.heaveRate * h;
}

/**
 * The steady body roll per unit of lateral acceleration, rad per m/s^2: ms hRoll / (Kf + Kr - ms g hRoll). Times G
 * it is the roll gradient per g that the class table quotes in degrees. Infinity when the springs and bars cannot
 * hold the body up at all.
 */
export function rollGradient(c: ChassisModel): number {
  const L = c.a + c.b;
  const hRoll = rollArm(c, L > 0 ? 1 / L : 0);
  const net = rollStiffnessFront(c) + rollStiffnessRear(c) - c.sprungMass * G * hRoll;
  return net > 0 ? c.sprungMass * hRoll / net : Infinity;
}

// The share of the weight on the front axle, b / L. A model with no wheelbase splits evenly rather than divide by zero.
function frontAxleShare(c: ChassisModel): number {
  const L = c.a + c.b;
  return L > 0 ? c.b / L : 0.5;
}

// The share of the body's pitching moment the links take at once: anti-squat when driving the rear wheels (an
// all-wheel-drive car drives them too), anti-dive under braking, none otherwise. A front-drive car's anti-lift
// geometry is not modelled. Because the moment is ms ax hs times this, the jump at ax = 0 moves nothing.
function antiShare(s: VehicleState, ax: number): number {
  if (ax > 0) return s.model.driveline.layout === 'FWD' ? 0 : s.model.chassis.antiSquat;
  if (ax < 0) return s.model.chassis.antiDive;
  return 0;
}

// Pitch stiffness and damping of the body on its four corners about the centre of gravity, N m/rad and N m s/rad.
function pitchStiffness(c: ChassisModel): number { return 2 * (c.springFront * c.a * c.a + c.springRear * c.b * c.b); }
function pitchDamping(c: ChassisModel): number { return 2 * (c.damperFront * c.a * c.a + c.damperRear * c.b * c.b); }

// Each axle's roll stiffness (its two springs a track apart, and its bar) and roll damping, N m/rad and N m s/rad.
function rollStiffnessFront(c: ChassisModel): number { return 0.5 * c.springFront * c.trackFront * c.trackFront + c.arbFront; }
function rollStiffnessRear(c: ChassisModel): number { return 0.5 * c.springRear * c.trackRear * c.trackRear + c.arbRear; }
function rollDampingFront(c: ChassisModel): number { return 0.5 * c.damperFront * c.trackFront * c.trackFront; }
function rollDampingRear(c: ChassisModel): number { return 0.5 * c.damperRear * c.trackRear * c.trackRear; }

// Height of the sprung centre of gravity above the roll axis, which runs from the front roll centre to the rear one.
function rollArm(c: ChassisModel, invL: number): number {
  return c.sprungCgHeight - (c.rollCentreFront + (c.rollCentreRear - c.rollCentreFront) * c.a * invL);
}

// One semi-implicit step of a rate under a force (spring and drive) and a damper: the damping is taken at the new
// rate, rate' = (rate + h F / I) / (1 + h C / I), so no damper is too stiff for the step. A body with no inertia on
// file does not move rather than divide by zero.
function dampedRate(rate: number, force: number, damping: number, inertia: number, h: number): number {
  if (!(inertia > 0)) return 0;
  return (rate + h * force / inertia) / (1 + h * damping / inertia);
}
