// Spanish coverage for the Garage. The site's own test (src/i18n.test.ts) finds every literal passed to t() and tx();
// this one covers what that scan cannot see: labels that reach t() through a table, here or in @micar/engine.
import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_BLURBS, ATTRIBUTE_LABELS, BASIS_LABELS, BODY_CLASS_LABELS, EVIDENCE_LABELS, LEVEL_LABELS, LEVEL_SUMMARIES, QUALITY_LABELS, RARITY_LABELS } from '@micar/engine';
import { ES } from '../i18n-es';
import { ATTRIBUTE_SHORT, GRADE_CATEGORY_NAMES, GRADE_CATEGORY_SHORT, MOD_SHORT } from './CollectibleCard';
import { GARAGE_ES, GARAGE_PARTS } from './es';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Every table whose values are shown through t(). Add a table here when a component starts translating it. */
export const TABLES: Record<string, Record<string, string>> = {
  ATTRIBUTE_LABELS, ATTRIBUTE_BLURBS, BASIS_LABELS, QUALITY_LABELS, EVIDENCE_LABELS, LEVEL_LABELS, LEVEL_SUMMARIES, RARITY_LABELS, BODY_CLASS_LABELS,
  ATTRIBUTE_SHORT, GRADE_CATEGORY_NAMES, GRADE_CATEGORY_SHORT, MOD_SHORT,
};

describe('Garage Spanish', () => {
  it('has every label that reaches t() through a table', () => {
    const missing: string[] = [];
    for (const [name, table] of Object.entries(TABLES)) {
      for (const label of Object.values(table)) if (!(label in ES)) missing.push(`${name}: ${label}`);
    }
    expect(missing).toEqual([]);
  });

  it('never translates one phrase two ways across its parts', () => {
    const clashes: string[] = [];
    for (const [name, part] of Object.entries(GARAGE_PARTS)) {
      for (const [en, es] of Object.entries(part)) if (GARAGE_ES[en] !== es) clashes.push(`${name}: ${en}`);
    }
    expect(clashes).toEqual([]);
  });

  it('agrees with the rest of the site on any phrase they share', () => {
    // i18n-es.ts spreads the Garage table first, so the site's own entry wins. A difference here means a Garage
    // phrase is being shown with a translation written for another meaning: reword the English or reuse the site's.
    const differs = Object.entries(GARAGE_ES).filter(([en, es]) => ES[en] !== es).map(([en]) => en);
    expect(differs).toEqual([]);
  });

  it('keeps the same placeholders and leaves nothing blank', () => {
    const bad = Object.entries(GARAGE_ES).filter(([en, es]) => es.trim() === '' || placeholders(en) !== placeholders(es)).map(([en]) => en);
    expect(bad).toEqual([]);
  });
});
