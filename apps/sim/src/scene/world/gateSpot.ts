// The gate ring's place in the town, apart from its three.js build (gate.ts) so the server can
// import it: a player in the Strip is at GATE_RETURN as far as the town is concerned.

/** the ring's centre and radius in the town (world units) */
export const GATE = { x: 0, z: 1715, r: 14 };
/** where a car comes back to from the Strip: just short of the ring, facing the town (-Z) */
export const GATE_RETURN = { x: 0, z: GATE.z - 26, rotY: 0 };
