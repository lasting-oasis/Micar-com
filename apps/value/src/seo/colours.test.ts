// The car pages' colours, from the real brand tokens (the page tests stub the CSS): every pair of text and ground the
// pages' stylesheet uses must read. Text and links at 7:1 or more (WCAG AAA); secondary text and the yellow button at
// 4.5:1 or more (AA). A browser check of the rendered colours on every built page is in the PR's evidence.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexPageHtml, modelPageHtml, buildModelPages, type Sticker } from './pages';
import stickers from '../data/stickers.json';

const tokens = readFileSync(fileURLToPath(new URL('../../../../packages/brand/src/tokens.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const m = tokens.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`no --${name} in tokens.css`);
  return m[1];
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const pages = buildModelPages(stickers as unknown as Sticker[]);
const css = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
const rule = (sheet: string, sel: string) => sheet.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';
const varOf = (decl: string, prop: string) => decl.match(new RegExp(`(?:^|;)${prop}:var\\(--([a-z-]+)\\)`))?.[1];

describe('the car pages read in the brand colours', () => {
  const env = { css: tokens, footer: '' };
  for (const [name, html] of [['a model page', modelPageHtml(pages[0], env)], ['the index', indexPageHtml(pages, env)]] as const) {
    it(`${name}: body text, headings and links on the page ground`, () => {
      const sheet = css(html);
      const body = rule(sheet, 'body');
      const ground = varOf(body, 'background'), ink = varOf(body, 'color'), link = varOf(rule(sheet, 'a'), 'color');
      expect([ground, ink, link]).toEqual(['mc-night', 'mc-ink', 'mc-paint']);
      expect(contrast(token(ink!), token(ground!))).toBeGreaterThanOrEqual(7);
      expect(contrast(token(link!), token(ground!))).toBeGreaterThanOrEqual(7);
    });
    it(`${name}: secondary text (crumbs, notes, table heads) and the yellow button`, () => {
      const sheet = css(html);
      const ground = token('mc-night');
      expect(varOf(rule(sheet, '.crumbs,.muted'), 'color')).toBe('mc-haze');
      expect(varOf(rule(sheet, 'th'), 'color')).toBe('mc-haze');
      expect(contrast(token('mc-haze'), ground)).toBeGreaterThanOrEqual(4.5);
      const cta = rule(sheet, '.cta');
      expect([varOf(cta, 'background'), varOf(cta, 'color')]).toEqual(['mc-paint', 'mc-night']);
      expect(contrast(token('mc-night'), token('mc-paint'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
