// The core may use only arithmetic that every engine computes identically (DESIGN.md rule 3). This scans the sources.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FORBIDDEN = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\bDate\b|\*\*/;

describe('the core computes the same bits everywhere', () => {
  const files = Object.keys(sources).filter((f) => !f.endsWith('.test.ts')).sort();
  it('finds the sources', () => { expect(files.length).toBeGreaterThan(3); });
  for (const file of files) {
    it(`${file} uses no library transcendental, no clock and no ** operator`, () => {
      // comments out (a block comment keeps its line breaks, so line numbers still point at the source)
      const bare = sources[file].replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));
      const code = bare.split('\n').map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 })).filter((l) => FORBIDDEN.test(l.line));
      expect(code.map((l) => `${file}:${l.n}: ${l.line.trim()}`)).toEqual([]);
    });
  }
});
