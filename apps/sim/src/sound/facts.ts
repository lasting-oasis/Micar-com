// The facts the engine sound model is built from. Nothing here is a "sound setting": every field is
// something true about the engine or its exhaust, or a class default that says it is one.

export type Layout = 'inline' | 'v' | 'flat';
export type Crank = 'cross' | 'flat';
export type Induction = 'na' | 'turbo' | 'super';
/** single: every cylinder into one pipe. merge: one pipe per bank joined into one. dual: one pipe per bank to its own tailpipe. */
export type ExhaustLayout = 'single' | 'merge' | 'dual';
export type MufflerKind = 'none' | 'chambered' | 'straight';
export type Basis = 'sourced' | 'derived' | 'class';

export type EngineFacts = {
  cylinders: number;
  layout: Layout;
  /** V8 only; null elsewhere. */
  crank: Crank | null;
  displacementL: number;
  induction: Induction;
  /** Published firing order, cylinder numbers from 1. Without it the layout's usual order is used. */
  firingOrder?: number[];
  /** The bank (0 or 1) of each cylinder number, because makers number differently. */
  bankOf?: number[];
};

export type ExhaustFacts = {
  layout: ExhaustLayout;
  /** dual only: how much the two sides mix. 0 true duals, about 0.25 an H-pipe, 0.5 an X-pipe. */
  crossover: number;
  /** Runner length in metres, one per firing event's cylinder bank: [bank 0, bank 1]. Unequal values are unequal headers. */
  runnerM: [number, number];
  /** Pipe from each bank's collector to the join (merge) or the crossover (dual), in metres. */
  branchM: [number, number];
  /** Pipe from there to the tailpipe, in metres. */
  pipeM: number;
  pipeDiaMm: number;
  muffler: MufflerKind;
  /** True when the car leaves fuel in on lift-off, so the exhaust pops. */
  overrunPops: boolean;
};

export type SoundFacts = {
  engine: EngineFacts;
  exhaust: ExhaustFacts;
  redline: number;
  /** Supercharger lobe events per crank turn: 2 x lobes x drive ratio. */
  blowerOrder?: number;
  /** Where each group of values came from. */
  basis: { engine: Basis; exhaust: Basis };
};
