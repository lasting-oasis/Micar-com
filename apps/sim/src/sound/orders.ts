// Order analysis for tests and tools: how strong each engine order is in a rendered signal.
// An engine order is a multiple of crank speed: order 2 at 3000 rpm is 100 Hz.

/** Level in dB of one engine order in `x` (a whole number of engine cycles gives exact results). */
export function orderDb(x: Float32Array, sampleRate: number, rpm: number, order: number): number {
  const w = 2 * Math.PI * order * rpm / 60 / sampleRate;
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); }
  return 20 * Math.log10(2 * Math.hypot(re, im) / x.length + 1e-12);
}

export function rmsDb(x: Float32Array): number {
  let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / x.length + 1e-24);
}
