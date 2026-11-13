// The <noscript> summary in index.html is what a reader without JavaScript sees on the root page. The app's stylesheet
// still loads without JavaScript and sets dark text on a dark background (about 1.1:1), so the summary carries its own
// colours, inline, and they must read: WCAG AA wants 4.5:1 for body text; this asks for 7:1 (AAA).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';

const hex = (s: string) => { const m = s.match(/#([0-9a-f]{6})\b/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const styleOf = (tag: string) => noscript.match(new RegExp(`<${tag}\\b[^>]*style="([^"]*)"`))?.[1] ?? '';
const prop = (style: string, name: string) => style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1] ?? '';

describe('the root page without JavaScript', () => {
  it('has a summary with a heading and the links to /cars/ and llms.txt', () => {
    expect(noscript).toMatch(/<h1\b/);
    expect(noscript).toContain('/Micar-com/cars/');
    expect(noscript).toContain('/Micar-com/llms.txt');
  });

  it('gives the summary its own text and background colours, readable at 7:1 or more', () => {
    const box = styleOf('div');
    const fg = hex(prop(box, 'color')), bg = hex(prop(box, 'background(?:-color)?'));
    expect(fg, 'the summary box sets a text colour').not.toBeNull();
    expect(bg, 'the summary box sets a background colour').not.toBeNull();
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(7);
  });

  it('colours its links too, readable on the same background', () => {
    const bg = hex(prop(styleOf('div'), 'background(?:-color)?'))!;
    const links = [...noscript.matchAll(/<a\b[^>]*style="([^"]*)"/g)].map((m) => hex(prop(m[1], 'color')));
    expect(links.length).toBe((noscript.match(/<a\b/g) ?? []).length);
    for (const c of links) { expect(c).not.toBeNull(); expect(contrast(c!, bg)).toBeGreaterThanOrEqual(7); }
  });
});
