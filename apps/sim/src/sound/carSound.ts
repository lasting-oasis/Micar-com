// From what the game knows about a car today (its engine in words, its body style, its redline, its
// wheelbase) to the facts the sound model needs. The engine facts are read from the text. Nothing in the
// game's car table describes an exhaust, so it is worked out the way an exhaust is sized: the pipe runs
// the length of the car and its bore suits the gas the engine moves. What cannot be worked out (layout,
// muffler type) is a default by engine layout and body style. A sourced value replaces any of these.
import type { EngineFacts, ExhaustFacts, ExhaustLayout, Layout, MufflerKind, SoundFacts } from './facts';

export type CarForSound = { engine: string; bodyStyle?: string; redline: number; /** This car's own axle-to-axle distance in metres. The car table has none yet, so the game passes none and the body style's length is used. */ wheelbaseM?: number };

/** Collector-to-tailpipe length in metres by body style, used only when the wheelbase is not known. */
const PIPE_M: Record<string, number> = { sedan: 3.2, coupe: 3.0, hatchback: 2.8, suv: 3.4, truck: 4.2, van: 3.6, sports: 2.6 };
const LONG_BODIES = new Set(['truck', 'suv', 'van']);
const PAST_WHEELBASE_M = 0.4;  // the pipe starts about half a metre behind the front axle and ends about 0.9 m behind the rear one
const HOT_GAS = 2.2;           // volume of the exhaust gas in the pipe against the cold air drawn in
const BOOSTED = 1.4;           // air a turbo or supercharger adds
const GAS_SPEED = 90;          // m/s: the gas speed a road exhaust is sized for at peak revs

/** Bore in mm of each pipe: the area that carries the engine's gas at its redline at the usual speed. */
function boreMm(e: EngineFacts, redline: number, pipes: number): number {
  const flow = e.displacementL / 1000 * redline / 120 * HOT_GAS * (e.induction === 'na' ? 1 : BOOSTED) / pipes; // m3/s
  return Math.min(102, Math.max(40, Math.sqrt(4 * flow / (Math.PI * GAS_SPEED)) * 1000));
}

function readEngine(text: string): EngineFacts | null {
  if (/electric|motor/i.test(text) && !/\d\s*L\b/i.test(text)) return null;
  const disp = /(\d+(?:\.\d+)?)\s*L\b/i.exec(text);
  const shape = /\b(I|L|V|H|F|W)-?(\d{1,2})\b/i.exec(text) || /\b(flat|boxer|inline|straight)[\s-]?(\d{1,2})\b/i.exec(text);
  if (!disp || !shape) return null;
  const key = shape[1].toLowerCase(), cylinders = Number(shape[2]);
  if (!(cylinders >= 2 && cylinders <= 12)) return null;
  const layout: Layout = key === 'v' || key === 'w' ? 'v' : key === 'h' || key === 'f' || key === 'flat' || key === 'boxer' ? 'flat' : 'inline';
  const induction = /supercharg/i.test(text) ? 'super' : /turbo|ecoboost/i.test(text) ? 'turbo' : 'na';
  // Road-car V8s are cross-plane unless a source says otherwise.
  return { cylinders, layout, crank: layout === 'v' && cylinders === 8 ? 'cross' : null, displacementL: Number(disp[1]), induction };
}

function exhaustFor(e: EngineFacts, style: string, redline: number, wheelbaseM?: number): ExhaustFacts {
  const twoBanks = e.layout !== 'inline';
  let layout: ExhaustLayout = 'single', crossover = 0;
  let branchM: [number, number] = [0.6, 0.6];
  if (twoBanks && !(e.layout === 'flat' && e.cylinders === 4)) {
    if (e.cylinders >= 8 && !LONG_BODIES.has(style) || e.layout === 'flat') { layout = 'dual'; crossover = style === 'sports' ? 0.5 : 0.25; branchM = [0.7, 0.8]; }
    else { layout = 'merge'; branchM = e.cylinders >= 8 ? [0.5, 0.9] : [0.5, 0.8]; } // one bank's pipe has further to go to the join
  }
  const muffler: MufflerKind = style === 'sports' ? 'straight' : 'chambered';
  return {
    layout, crossover, runnerM: [0.4, 0.4], branchM,
    pipeM: wheelbaseM ? wheelbaseM + PAST_WHEELBASE_M : PIPE_M[style] ?? PIPE_M.sedan,
    pipeDiaMm: boreMm(e, redline, layout === 'dual' ? 2 : 1),
    muffler, overrunPops: style === 'sports',
  };
}

/** The sound facts for a car, or null when it has no piston engine the model can voice. */
export function soundFactsFor(car: CarForSound): SoundFacts | null {
  const engine = readEngine(car.engine || '');
  if (!engine) return null;
  const facts: SoundFacts = { engine, exhaust: exhaustFor(engine, car.bodyStyle || 'sedan', car.redline, car.wheelbaseM), redline: car.redline, basis: { engine: 'derived', exhaust: car.wheelbaseM ? 'derived' : 'class' } };
  if (engine.induction === 'super') facts.blowerOrder = 2 * 4 * 2.3; // class: a four-lobe blower geared 2.3 to 1
  return facts;
}
