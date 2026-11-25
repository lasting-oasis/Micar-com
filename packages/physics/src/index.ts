// @micar/physics: the public surface. Real figures about a car go in (a PhysicsSheet); resolveModel turns them into a
// model in SI; createVehicle and step drive it; runBench measures it as a magazine would; calibrate and checkSheet fit
// the two things a test may fit and compare the rest with the tests. Everything else in src is how that is done.
// fixtures.ts (a hand-built car for unit tests) is deliberately not exported.

/** Every shared type, and AUTO_GEAR. */
export * from './types';
/** Allocating a state, default controls, an empty telemetry record, flat dry ground. */
export * from './state';
/** The car: making and placing it, the step, telemetry, collisions, the state hash. */
export * from './vehicle';
/** Figures in: sheets from research records, the game's car table and the drawn rental cars. */
export * from './sheet';
/** The class tables: the only place a typical value lives. */
export * from './classes';
/** Sheets to models, with the basis of every parameter. */
export * from './resolve';
/** The parts catalogue and builds: fitting parts and a setup, what each part did, the Garage's builds as real parts. */
export * from './parts';
/** The bench: acceleration, braking, skidpad, top speed and the dyno. */
export * from './bench';
/** Calibration (tyre grip, drag area) and the check against tests. */
export * from './calibrate';
/** The engine: building one from its figures, rebuilding its tables after a part, reading its torque and peaks. */
export { AIR_ENERGY, boostStep, buildEngine, enginePeaks, engineTorque, rebuildTables, targetTorque } from './engine';
/** The figures buildEngine turns into an engine model. */
export type { EngineSpec } from './engine';
/** Physical constants the core uses (standard gravity, sea-level air) and the deterministic arithmetic's constants. */
export { G, HALF_PI, PI, P_AMBIENT, RHO_AIR, TAU, T_AMBIENT } from './math';
/** Every researched car's sheet (generated from data/research) and the one filed under an id, for the game's world cars. */
export { SHEETS, sheetById } from './data/sheets';
/** The bench's drag launch (its launch speeds are bench.ts launchSpeeds): the game's server floors run every legal car with it. */
export { launchDriver } from './drivers';
export type { Driver, LaunchDriver } from './drivers';
/** The slip at which a tyre's driving force and its side force peak at a load: what an assist layer holds a car under. */
export { peakSlipRatio, peakSlipTan } from './tyre';
/** The bench in the card's units, for the card engine's simulated specification (DESIGN.md 12). */
export * from './rating';
/** A circuit's racing line from its centreline and width, finding a car on it, and the proof circuits (DESIGN.md 14). */
export * from './line';
/** A car's envelope measured on the bench, and its limit lap on a racing line (DESIGN.md 14). */
export * from './lap';
/** A seeded driver for a real car on a racing line: its skill, reaction time and precision (DESIGN.md 14). */
export * from './pilot';
