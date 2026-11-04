// Real-world performance figures for every model the game can generate, used by the
// driving physics (acceleration, top speed, braking, handling) and shown on car cards.
// Figures are for a common US trim of the 2013–2024 model years the auction sells.

export type CarSpec = {
  engine: string;        // e.g. "2.5L I4"
  hp: number;
  weightLb: number;      // curb weight
  zeroToSixty: number;   // seconds
  topSpeedMph: number;   // governed / rated top speed
  drive: 'FWD' | 'RWD' | 'AWD' | '4WD';
};

const S = (engine: string, hp: number, weightLb: number, zeroToSixty: number, topSpeedMph: number, drive: CarSpec['drive']): CarSpec =>
  ({ engine, hp, weightLb, zeroToSixty, topSpeedMph, drive });

const MODEL_SPECS: Record<string, CarSpec> = {
  // Toyota
  'Toyota Camry':     S('2.5L I4', 203, 3340, 7.6, 135, 'FWD'),
  'Toyota Corolla':   S('1.8L I4', 139, 2900, 9.8, 115, 'FWD'),
  'Toyota RAV4':      S('2.5L I4', 203, 3450, 8.1, 120, 'AWD'),
  'Toyota Tacoma':    S('3.5L V6', 278, 4400, 7.5, 112, '4WD'),
  'Toyota Tundra':    S('5.7L V8', 381, 5500, 6.3, 112, '4WD'),
  'Toyota Prius':     S('1.8L I4 Hybrid', 121, 3050, 10.0, 112, 'FWD'),
  'Toyota Sienna':    S('3.5L V6', 296, 4500, 7.4, 115, 'FWD'),
  'Toyota Supra':     S('3.0L Turbo I6', 382, 3400, 3.9, 155, 'RWD'),
  // Ford
  'Ford F-150':       S('2.7L EcoBoost V6', 325, 4700, 6.2, 107, '4WD'),
  'Ford Ranger':      S('2.3L EcoBoost I4', 270, 4150, 6.9, 112, '4WD'),
  'Ford Mustang':     S('5.0L V8', 460, 3800, 4.3, 155, 'RWD'),
  'Ford Explorer':    S('2.3L EcoBoost I4', 300, 4350, 7.0, 120, 'AWD'),
  'Ford Escape':      S('1.5L EcoBoost I3', 181, 3300, 8.7, 115, 'FWD'),
  'Ford Focus':       S('2.0L I4', 160, 2950, 8.4, 125, 'FWD'),
  'Ford Fusion':      S('2.5L I4', 175, 3450, 8.6, 125, 'FWD'),
  // Honda
  'Honda Civic':      S('2.0L I4', 158, 2900, 8.2, 125, 'FWD'),
  'Honda Accord':     S('1.5L Turbo I4', 192, 3150, 7.3, 125, 'FWD'),
  'Honda CR-V':       S('1.5L Turbo I4', 190, 3450, 8.0, 120, 'AWD'),
  'Honda Pilot':      S('3.5L V6', 280, 4300, 7.0, 112, 'AWD'),
  'Honda Odyssey':    S('3.5L V6', 280, 4500, 7.2, 115, 'FWD'),
  'Honda Fit':        S('1.5L I4', 130, 2600, 9.0, 115, 'FWD'),
  'Honda Ridgeline':  S('3.5L V6', 280, 4450, 6.9, 112, 'AWD'),
  // Chevrolet
  'Chevy Silverado':  S('5.3L V8', 355, 4900, 6.4, 105, '4WD'),
  'Chevy Colorado':   S('3.6L V6', 308, 4300, 6.6, 112, '4WD'),
  'Chevy Camaro':     S('6.2L V8', 455, 3700, 4.0, 165, 'RWD'),
  'Chevy Corvette':   S('6.2L V8', 490, 3550, 3.0, 184, 'RWD'),
  'Chevy Equinox':    S('1.5L Turbo I4', 170, 3300, 9.2, 115, 'FWD'),
  'Chevy Tahoe':      S('5.3L V8', 355, 5600, 7.0, 112, '4WD'),
  'Chevy Malibu':     S('1.5L Turbo I4', 160, 3150, 8.3, 120, 'FWD'),
  // BMW
  'BMW 3 Series':     S('2.0L Turbo I4', 255, 3550, 5.4, 130, 'RWD'),
  'BMW 5 Series':     S('2.0L Turbo I4', 248, 3800, 6.0, 130, 'RWD'),
  'BMW X5':           S('3.0L Turbo I6', 335, 4900, 5.3, 130, 'AWD'),
  'BMW X3':           S('2.0L Turbo I4', 248, 4100, 6.0, 130, 'AWD'),
  'BMW M4':           S('3.0L Twin-Turbo I6', 473, 3800, 3.8, 155, 'RWD'),
  'BMW 4 Series':     S('2.0L Turbo I4', 255, 3650, 5.5, 130, 'RWD'),
  'BMW Z4':           S('2.0L Turbo I4', 255, 3300, 5.2, 155, 'RWD'),
  // Speedway rental race car: tuned to match the original game handling, which the
  // CPU racers' pace was balanced against.
  'Speedway Rental GT': S('Race-tuned V8', 640, 3100, 2.4, 190, 'RWD'),
};

// Old, tired cars of a body style (junkyard "Scrap Shell"s and anything unknown).
const STYLE_SPECS: Record<string, CarSpec> = {
  sedan:     S('2.4L I4', 150, 3200, 9.5, 112, 'FWD'),
  coupe:     S('3.0L V6', 210, 3300, 7.8, 125, 'RWD'),
  hatchback: S('1.6L I4', 110, 2600, 10.5, 108, 'FWD'),
  suv:       S('4.0L V6', 210, 4300, 9.8, 108, '4WD'),
  truck:     S('4.6L V8', 230, 4600, 9.0, 100, '4WD'),
  van:       S('3.4L V6', 185, 4200, 10.5, 105, 'FWD'),
  sports:    S('3.8L V6', 300, 3400, 5.8, 150, 'RWD'),
};

const MAKE_ALIASES: Record<string, string> = { Chevrolet: 'Chevy' };

export function getCarSpec(car: { make?: string; model?: string; bodyStyle?: string }, fallbackStyle = 'sedan'): CarSpec {
  const make = MAKE_ALIASES[car.make || ''] || car.make || '';
  return MODEL_SPECS[`${make} ${car.model}`] || STYLE_SPECS[car.bodyStyle || fallbackStyle] || STYLE_SPECS.sedan;
}

/** "2.5L I4 · 203 hp · 0–60 7.6s" */
export const specLine = (s: CarSpec) => `${s.engine} · ${s.hp} hp · 0–60 ${s.zeroToSixty.toFixed(1)}s`;

// ---- Mapping real figures onto the game's driving model ----------------------------
// The game keeps its original acceleration curve, dv/dt = A·(1 − 0.55·v/Vmax) up to Vmax,
// but A and Vmax now come from each car's specs. The Rental GT reproduces the original
// tuning exactly (A = 145, Vmax = 200), so race balance against the CPU cars is unchanged.
export const UNITS_PER_MPH = 200 / 190;   // speed in game units per mph
const TIME_SCALE = 0.2;                   // game seconds per real second for 0–60 (the world is arcade-scaled)
const TAPER = 0.55;

export type DriveTuning = {
  maxV: number;        // top speed, game units/s
  accel: number;       // launch acceleration A, units/s²
  brake: number;       // braking deceleration, units/s²
  coast: number;       // rolling + aero drag when off the throttle, units/s²
  turn: number;        // steering rate multiplier (1 = original)
  reverseMax: number;
};

export function driveTuning(spec: CarSpec, bodyStyle: string | undefined, mechanicCondition = 100): DriveTuning {
  const m = Math.max(0, Math.min(100, mechanicCondition)) / 100;
  // A worn engine loses power (up to 40% of its pull, 10% of its top speed)
  const maxV = spec.topSpeedMph * UNITS_PER_MPH * (0.9 + 0.1 * m);
  const v60 = 60 * UNITS_PER_MPH;
  const T = spec.zeroToSixty * TIME_SCALE;
  // time to v60 under dv/dt = A(1 − k v) is −ln(1 − k v60)/(A k), with k = TAPER/maxV
  const k = TAPER / maxV;
  const accel = (-Math.log(1 - Math.min(0.95, k * v60)) / (k * T)) * (0.6 + 0.4 * m);

  const style = bodyStyle || 'sedan';
  const heavy = Math.max(0, (spec.weightLb - 3200) / 2400); // 0 for a compact car, ~1 for a full-size SUV
  // Braking ~0.95 g for a light sports car down to ~0.75 g for a 5,600 lb truck; the Rental GT = original 240
  const brakeG = Math.max(0.7, 1.05 - 0.00005 * spec.weightLb + (style === 'sports' || style === 'coupe' ? 0.05 : 0));
  const brake = 240 * (brakeG / 0.945);
  const bluff = style === 'van' || style === 'truck' || style === 'suv';
  const coast = 40 * (bluff ? 1.15 : 1) * (1 + 0.15 * heavy);
  const styleTurn: Record<string, number> = { sports: 1, coupe: 0.98, sedan: 0.94, hatchback: 0.96, suv: 0.85, truck: 0.8, van: 0.78 };
  const turn = (styleTurn[style] ?? 0.92) * (1 - 0.08 * heavy);
  return { maxV, accel, brake, coast, turn, reverseMax: style === 'sports' || style === 'coupe' ? 55 : 45 };
}
