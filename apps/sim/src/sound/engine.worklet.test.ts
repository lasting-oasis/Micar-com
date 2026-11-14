import { beforeAll, describe, expect, it } from 'vitest';
import type { SoundFacts } from './facts';

// The audio thread's globals, as an AudioWorklet module is given them, so the real processor runs here.
class FakePort { onmessage: ((e: { data: unknown }) => void) | null = null; sent: unknown[] = []; postMessage(m: unknown): void { this.sent.push(m); } }
type Processor = { port: FakePort; process(inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>): boolean };
let Proc: new (options?: { processorOptions?: { facts?: SoundFacts | null } }) => Processor;
const SR = 48000;
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.AudioWorkletProcessor = class { port = new FakePort(); };
  g.registerProcessor = (_name: string, ctor: typeof Proc) => { Proc = ctor; };
  await import('./engine.worklet');
});

const TURBO_V8: SoundFacts = {
  engine: { cylinders: 8, layout: 'v', crank: 'cross', displacementL: 5, induction: 'turbo' },
  exhaust: { layout: 'dual', crossover: 0.25, runnerM: [0.4, 0.4], branchM: [0.7, 0.8], pipeM: 3, pipeDiaMm: 70, muffler: 'chambered', overrunPops: true },
  redline: 7000, basis: { engine: 'derived', exhaust: 'class' },
};
const params = (o: Record<string, number> = {}): Record<string, Float32Array> => {
  const v: Record<string, number> = { rpm: 4000, throttle: 1, load: 1, boost: 0.6, cut: 0, exhaust: 1, intake: 0.5, bay: 0.3, ...o };
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, new Float32Array([x])]));
};
/** Run `blocks` blocks of 128 frames; returns every sample of the left channel. */
function run(p: Processor, blocks: number, o: Record<string, number> = {}): Float32Array {
  const all = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    const out = [[new Float32Array(128), new Float32Array(128)]];
    p.process([], out, params(o));
    all.set(out[0][0], b * 128);
  }
  return all;
}
const finite = (a: Float32Array) => a.every(Number.isFinite);
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

describe('the micar-engine processor', () => {
  it('a block with a sample that is not a number goes out silent, and the engine comes back on the next blocks', () => {
    const p = new Proc({ processorOptions: { facts: TURBO_V8 } });
    run(p, 200);                                   // running
    const bad = run(p, 1, { exhaust: NaN });       // something feeds a NaN in for one block
    expect(finite(bad)).toBe(true);
    expect(rms(bad)).toBe(0);
    const after = run(p, 400);                     // a second of normal driving
    expect(finite(after)).toBe(true);
    expect(rms(after.subarray(200 * 128))).toBeGreaterThan(0.01);
  });
  it('tells the page each time it starts the engine afresh, so ?audiodebug can show it', () => {
    const p = new Proc({ processorOptions: { facts: TURBO_V8 } });
    run(p, 200);
    expect(p.port.sent).toEqual([]);
    run(p, 1, { exhaust: NaN });
    expect(p.port.sent).toEqual([{ resets: 1 }]);
    run(p, 750);                                   // two seconds
    run(p, 1, { exhaust: NaN });
    expect(p.port.sent).toEqual([{ resets: 1 }, { resets: 2 }]);
  });
  it('a fault that does not go away keeps it silent, and it starts afresh at most once a second (each start allocates on the audio thread)', () => {
    const p = new Proc({ processorOptions: { facts: TURBO_V8 } });
    run(p, 200);
    const bad = run(p, 750, { exhaust: NaN });     // two seconds of it
    expect(finite(bad)).toBe(true);
    expect(rms(bad)).toBe(0);
    expect(p.port.sent.length).toBeGreaterThanOrEqual(2);
    expect(p.port.sent.length).toBeLessThanOrEqual(3);
  });
  // A throw out of process() ends the processor for good (WebKit and Chromium), with nothing on the page listening.
  // No car the game builds makes the model throw; these facts do.
  it('a model that throws while rendering goes out silent, the processor lives on, and the page is told', () => {
    const p = new Proc({ processorOptions: { facts: { ...TURBO_V8, engine: { ...TURBO_V8.engine, cylinders: 0 } } } });
    let out: Float32Array = new Float32Array(0);
    expect(() => { out = run(p, 400); }).not.toThrow();
    expect(finite(out)).toBe(true);
    expect(rms(out)).toBe(0);
    expect(p.port.sent.length).toBeGreaterThanOrEqual(1);
  });
  it('facts the model cannot be built from leave the engine silent and the processor alive, and a good car still plays after', () => {
    const bad = { ...TURBO_V8, engine: { ...TURBO_V8.engine, cylinders: Infinity } };
    let p: Processor | null = null;
    expect(() => { p = new Proc({ processorOptions: { facts: bad } }); }).not.toThrow();
    expect(rms(run(p!, 10))).toBe(0);
    expect(() => p!.port.onmessage?.({ data: { facts: bad } })).not.toThrow();
    p!.port.onmessage?.({ data: { facts: TURBO_V8 } });
    expect(rms(run(p!, 400).subarray(200 * 128))).toBeGreaterThan(0.01);
  });
});
