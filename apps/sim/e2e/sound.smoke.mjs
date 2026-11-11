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
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(BASE);
  const result = await page.evaluate(async ({ urls, facts }) => {
    let lastError = 'no candidate';
    for (const url of urls) {
      try {
        const ctx = new OfflineAudioContext(2, 48000, 48000);
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, 'micar-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { facts } });
        node.parameters.get('rpm').value = 3000; node.parameters.get('throttle').value = 1; node.parameters.get('load').value = 1;
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
  }, { urls: candidates.map(f => new URL('assets/' + f, BASE).href), facts });
  console.log(JSON.stringify(result));
  if (result.error || !(result.peak > 0.01) || result.bad) { console.error('engine sound smoke FAILED'); process.exit(1); }
  console.log(`engine sound smoke ok: one second of V8 rendered in ${result.ms.toFixed(0)} ms in Chromium`);
} finally { await browser.close(); }
