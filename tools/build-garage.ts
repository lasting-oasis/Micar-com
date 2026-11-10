// Builds site/garage/index.html: the page at the Garage's old address (it forwards to #/garage), with the shared footer and the brand CSS inlined.
// Run by build-site.sh from apps/value (pnpm --filter ... exec), so every path is resolved from this file, never from the cwd.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { garagePageHtml } from '../packages/brand/src/footer.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const css = read('packages/brand/src/tokens.css') + '\n' + read('packages/brand/src/footer.css');
const html = garagePageHtml(read('tools/garage-placeholder.html'), css, new Date().getFullYear());

const out = resolve(root, 'site/garage/index.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out}`);
