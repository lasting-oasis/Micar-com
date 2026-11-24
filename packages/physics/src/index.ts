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
