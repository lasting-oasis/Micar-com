import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';

const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const opts = { serveUrl, browserExecutable: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', chromiumOptions: { disableWebSecurity: true } };
const composition = await selectComposition({ ...opts, id: process.env.COMP || 'explainer' });
const tmp = (process.env.OUTFILE || 'out/explainer.mp4').replace(/.mp4$/, '.rendering.mp4');
let last = -1;
await renderMedia({
  ...opts, composition, codec: 'h264', crf: 18, imageFormat: 'jpeg', jpegQuality: 92, concurrency: 2, audioBitrate: '192k', outputLocation: tmp,
  onProgress: ({ progress, renderedFrames }) => { const pct = Math.floor(progress * 20) * 5; if (pct !== last) { last = pct; console.log(`${pct}% (${renderedFrames} frames) ${new Date().toISOString().slice(11, 19)}`); } },
});
fs.renameSync(tmp, process.env.OUTFILE || 'out/explainer.mp4');
console.log('done');
