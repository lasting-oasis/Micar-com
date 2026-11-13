// No two modules in one folder may differ only in the case of their names (CardStats.tsx beside cardStats.ts). On a
// case-insensitive disk (Windows, macOS by default) an import of './CardStats' finds whichever comes first, so the type
// check, the build and the tests failed there while Linux was fine. Checked across every app's and package's src.
import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const MODULE = /\.(m?[jt]sx?)$/;

function clashes(dir: string, out: string[]): void {
  const names = readdirSync(dir);
  const byStem = new Map<string, Set<string>>();
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && !n.startsWith('.')) clashes(p, out); continue; }
    if (!MODULE.test(n) || /\.d\.ts$/.test(n)) continue;
    const stem = n.replace(MODULE, '');                       // cardStats.test and CardStats.test clash too
    const key = stem.toLowerCase();
    if (!byStem.has(key)) byStem.set(key, new Set());
    byStem.get(key)!.add(stem);
  }
  for (const stems of byStem.values()) if (stems.size > 1) out.push(dir.slice(ROOT.length + 1).replace(/\\/g, '/') + ': ' + [...stems].sort().join(' / '));
}

function srcDirs(): string[] {
  const out: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const n of readdirSync(join(ROOT, group))) {
      const src = join(ROOT, group, n, 'src');
      try { if (statSync(src).isDirectory()) out.push(src); } catch { /* no src */ }
    }
  }
  return out;
}

describe('module names', () => {
  it('finds the apps and packages to check', () => {
    expect(srcDirs().length).toBeGreaterThan(3);
  });
  it('no two modules in a folder differ only in case, so imports resolve the same on every disk', () => {
    const out: string[] = [];
    for (const d of srcDirs()) clashes(d, out);
    expect(out).toEqual([]);
  });
});
