// Listen to the engine sound model without the game: renders a short drive for a few engines to WAV
// files. Run from apps/sim:  npx tsx scripts/render-engine-sound.ts [output folder]
// Each clip: idle, a pull to the redline at full throttle, a lift-off, back to idle.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineSound } from '../src/sound/engineSound';
import { soundFactsFor } from '../src/sound/carSound';
import type { SoundFacts } from '../src/sound/facts';

const SR = 48000, out = process.argv[2] || 'engine-sound-clips';
const car = (engine: string, bodyStyle: string, redline: number, change?: (f: SoundFacts) => void): SoundFacts => {
  const f = soundFactsFor({ engine, bodyStyle, redline })!; change?.(f); return f;
};
const CLIPS: Record<string, SoundFacts> = {
  'inline-four-sedan': car('2.0L I4', 'sedan', 6800),
  'turbo-four-hatch': car('2.0L Turbo I4', 'hatchback', 6500),
  'v6-van': car('3.5L V6', 'van', 6500),
  'turbo-inline-six-coupe': car('3.0L Twin-Turbo I6', 'coupe', 7200),
  'cross-plane-v8-coupe': car('5.0L V8', 'coupe', 7400),
  'cross-plane-v8-truck': car('5.3L V8', 'truck', 5800),
  'flat-plane-v8-coupe': car('5.2L V8', 'coupe', 8200, f => { f.engine.crank = 'flat'; }),
  'supercharged-v8-sports': car('6.2L Supercharged V8', 'sports', 6500),
  'flat-four-equal-runners': car('2.5L H4', 'sedan', 6500),
  'flat-four-unequal-runners': car('2.5L H4', 'sedan', 6500, f => { f.exhaust.runnerM = [0.3, 0.75]; }),
};

function wav(L: Float32Array, R: Float32Array): Buffer {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(L[i] * 32767), 44 + i * 4); b.writeInt16LE(Math.round(R[i] * 32767), 46 + i * 4); }
  return b;
}

mkdirSync(out, { recursive: true });
for (const [name, facts] of Object.entries(CLIPS)) {
  const s = new EngineSound(facts, SR), idle = 800, top = facts.redline, seconds = 9;
  const L = new Float32Array(SR * seconds), R = new Float32Array(SR * seconds), q = 128;
  for (let i = 0; i < L.length; i += q) {
    const t = i / SR;
    if (t < 1.5) { s.rpm = idle; s.throttle = 0.08; s.load = 0.05; s.boost = 0; }
    else if (t < 5.5) { const k = (t - 1.5) / 4; s.rpm = idle + (top - idle) * k; s.throttle = 1; s.load = 1; s.boost = Math.min(1, k * 2.5); }
    else if (t < 7.5) { const k = (t - 5.5) / 2; s.rpm = top - (top - 1500) * k; s.throttle = 0; s.load = -0.3; s.boost = 0; }
    else { s.rpm = 1500 - 700 * Math.min(1, (t - 7.5) / 0.6); s.throttle = 0.08; s.load = 0.05; }
    s.render(L.subarray(i, i + q), R.subarray(i, i + q));
  }
  writeFileSync(join(out, `${name}.wav`), wav(L, R));
  console.log(`${name}.wav`);
}
