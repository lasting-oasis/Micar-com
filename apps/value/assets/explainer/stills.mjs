// Bundle once, then draw stills at the busiest moment of each scene.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';

const frames = Object.fromEntries(process.argv.slice(2).map((a) => { const [n, f] = a.split('='); return [n, Number(f)]; }));
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const opts = { serveUrl, browserExecutable: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', chromiumOptions: { disableWebSecurity: true } };
const composition = await selectComposition({ ...opts, id: process.env.COMP || 'explainer' });
for (const [name, frame] of Object.entries(frames)) {
  await renderStill({ ...opts, composition, frame, output: `out/${process.env.OUT || 'stills'}/${name}.jpg`, imageFormat: 'jpeg', jpegQuality: 90 });
  console.log(name, frame);
}
