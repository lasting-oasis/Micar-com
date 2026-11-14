// Engine sound smoke test: the built AudioWorklet module loads in a real browser and the model makes
// sound there. Run after `vite build`, against a server of dist/ (BASE, default http://localhost:4173/).
// An OfflineAudioContext renders one second through the worklet, so no speakers or gesture are needed.
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173/';
const candidates = readdirSync(new URL('../dist/assets/', import.meta.url)).filter(f => /^engine\.worklet-.*\.js$/.test(f));
if (!candidates.length) { console.error('no engine.worklet chunk in dist/assets: build first'); process.exit(1); }

const facts = {
  engine: { cylinders: 8, layout: 'v', crank: 'cross', displacementL: 5, induction: 'na' },
  exhaust: { layout: 'dual', crossover: 0.25, runnerM: [0.4, 0.4], branchM: [0.7, 0.8], pipeM: 3, pipeDiaMm: 70, muffler: 'chambered', overrunPops: false },
  redline: 7000, basis: { engine: 'derived', exhaust: 'class' },
};
// The same V8 with a turbo, told a boost below zero: once the whistle's phase turned NaN and every sound on the page with it.
const cases = [
  { name: 'V8', facts, params: { rpm: 3000, throttle: 1, load: 1 } },
  { name: 'turbo V8 told boost -0.5', facts: { ...facts, engine: { ...facts.engine, induction: 'turbo' } }, params: { rpm: 3000, throttle: 1, load: 1, boost: -0.5 } },
];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(BASE);
  for (const c of cases) {
    const result = await page.evaluate(async ({ urls, facts, params }) => {
      let lastError = 'no candidate';
      for (const url of urls) {
        try {
          const ctx = new OfflineAudioContext(2, 48000, 48000);
          await ctx.audioWorklet.addModule(url);
          const node = new AudioWorkletNode(ctx, 'micar-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { facts } });
          for (const [k, v] of Object.entries(params)) node.parameters.get(k).value = v;
          node.connect(ctx.destination);
          const t0 = performance.now();
          const buf = await ctx.startRendering();
          const ms = performance.now() - t0;
          const d = buf.getChannelData(0); let peak = 0, bad = 0;
          for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (!(v <= 1)) bad++; if (v > peak) peak = v; }
          return { url, peak, bad, ms };
        } catch (e) { lastError = String(e); }
      }
      return { error: lastError };
    }, { urls: candidates.map(f => new URL('assets/' + f, BASE).href), facts: c.facts, params: c.params });
    console.log(c.name, JSON.stringify(result));
    if (result.error || !(result.peak > 0.01) || result.bad) { console.error(`engine sound smoke FAILED: ${c.name}`); process.exitCode = 1; continue; }
    console.log(`engine sound smoke ok: one second of ${c.name} rendered in ${result.ms.toFixed(0)} ms in Chromium`);
  }
} finally { await browser.close(); }
