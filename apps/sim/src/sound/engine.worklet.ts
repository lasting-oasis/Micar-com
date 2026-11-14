// The AudioWorklet shell around the engine sound model. It runs on the audio thread: the model is built
// when a car arrives by message, and process() only copies six numbers in and renders.
import { EngineSound } from './engineSound';
import type { SoundFacts } from './facts';

// The few names an AudioWorklet module is given, which the DOM type library leaves out.
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; }

const PARAMS = ['rpm', 'throttle', 'load', 'boost', 'cut', 'exhaust', 'intake', 'bay'] as const;

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMS.map(name => ({ name, defaultValue: name === 'exhaust' ? 1 : name === 'intake' ? 0.5 : name === 'bay' ? 0.3 : 0, automationRate: 'k-rate' }));
  }
  private model: EngineSound | null = null;
  private facts: SoundFacts | null = null;
  private resets = 0; private frames = 0; private resetAt = -Infinity;
  constructor(options?: { processorOptions?: { facts?: SoundFacts | null } }) {
    super();
    this.setCar(options?.processorOptions?.facts ?? null);
    this.port.onmessage = (e: MessageEvent<{ facts: SoundFacts | null }>) => this.setCar(e.data.facts);
  }
  private setCar(facts: SoundFacts | null): void { this.facts = facts; this.model = facts ? new EngineSound(facts, sampleRate) : null; }
  process(_inputs: Float32Array[][], outputs: Float32Array[][], p: Record<string, Float32Array>): boolean {
    const m = this.model, out = outputs[0];
    if (!m || !out || !out[0]) return true;
    m.rpm = p.rpm[0]; m.throttle = p.throttle[0]; m.load = p.load[0]; m.boost = p.boost[0]; m.cut = p.cut[0];
    m.exhaustGain = p.exhaust[0]; m.intakeGain = p.intake[0]; m.bayGain = p.bay[0];
    const L = out[0], R = out[1] || L;
    m.render(L, R, L.length);
    // A sample that is not a number stays in the model's filters for good, and in the shared output it can
    // silence every sound on the page. Send silence instead, and start the engine afresh: at most once a
    // second, because a new model allocates on this thread.
    this.frames += L.length;
    for (let i = 0; i < L.length; i++) {
      if (L[i] - L[i] !== 0 || R[i] - R[i] !== 0) {
        L.fill(0); R.fill(0);
        if (this.frames - this.resetAt >= sampleRate) { this.resetAt = this.frames; this.setCar(this.facts); this.port.postMessage({ resets: ++this.resets }); }
        break;
      }
    }
    return true;
  }
}
registerProcessor('micar-engine', EngineProcessor);
