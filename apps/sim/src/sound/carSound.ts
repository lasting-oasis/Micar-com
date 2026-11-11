// From what the game knows about a car today (its engine in words, its body style, its redline) to the
// facts the sound model needs. The engine facts are read from the text, so they are 'derived'. Nothing
// in the game's car table describes an exhaust yet, so every exhaust value here is a 'class' default by
// engine layout and body style. A sourced value replaces a default; it never needs a new rule.
import type { EngineFacts, ExhaustFacts, ExhaustLayout, Layout, MufflerKind, SoundFacts } from './facts';

export type CarForSound = { engine: string; bodyStyle?: string; redline: number };

/** Collector-to-tailpipe length in metres by body style: a class estimate from typical wheelbases. */
const PIPE_M: Record<string, number> = { sedan: 3.2, coupe: 3.0, hatchback: 2.8, suv: 3.4, truck: 4.2, van: 3.6, sports: 2.6 };
const LONG_BODIES = new Set(['truck', 'suv', 'van']);

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

function classExhaust(e: EngineFacts, style: string): ExhaustFacts {
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
    pipeM: PIPE_M[style] ?? PIPE_M.sedan,
    pipeDiaMm: Math.min(76, Math.max(45, 40 + 8 * e.displacementL)),
    muffler, overrunPops: style === 'sports',
  };
}

/** The sound facts for a car, or null when it has no piston engine the model can voice. */
export function soundFactsFor(car: CarForSound): SoundFacts | null {
  const engine = readEngine(car.engine || '');
  if (!engine) return null;
  const facts: SoundFacts = { engine, exhaust: classExhaust(engine, car.bodyStyle || 'sedan'), redline: car.redline, basis: { engine: 'derived', exhaust: 'class' } };
  if (engine.induction === 'super') facts.blowerOrder = 2 * 4 * 2.3; // class: a four-lobe blower geared 2.3 to 1
  return facts;
}
