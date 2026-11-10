// Spanish coverage for the Garage. The site's own test (src/i18n.test.ts) finds every literal passed to t() and tx();
// this one covers what that scan cannot see: labels that reach t() through a table, here or in @micar/engine.
import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_SCOPE_LABELS, ATTRIBUTE_BLURBS, ATTRIBUTE_LABELS, BASIS_LABELS, BODY_CLASS_LABELS, DISCREPANCY_DETAILS, EDITION_NAMES, EVENT_TYPE_LABELS, EVIDENCE_LABELS,
  EXCLUSION_REASONS, GRADE_CAP_REASONS, GRADE_CATEGORY_LABELS, GRADE_ITEM_LABELS, LEVEL_LABELS, LEVEL_SUMMARIES, MODS, MOD_REFUSALS, MOD_TIER_NAMES, PASSPORT_REFUSALS,
  QUALITY_LABELS, RACE_MODE_RULES, RARITY_FACTOR_LABELS, RARITY_LABELS, REQUIREMENT_LABELS, SCARCITY_UNBACKED, SETUP_REFUSALS, SOURCE_KIND_LABELS, SPEC_FIELD_LABELS, TIER_NAMES,
  VERIFICATION_REFUSALS, WEAR_SYSTEM_LABELS,
} from '@micar/engine';
import { ES } from '../i18n-es';
import { ATTRIBUTE_SHORT, GRADE_CATEGORY_NAMES, GRADE_CATEGORY_SHORT, MOD_SHORT } from './CollectibleCard';
import { GARAGE_ES, GARAGE_PARTS } from './es';
import { INSTALL_LABELS, UPKEEP_LABELS } from './ModsPanel';
import { VIN_NOTES } from './Park';
import { DOCUMENT_LABELS, FILE_REFUSALS, PHOTO_SUBJECT_LABELS, WORK_LABELS } from './PassportPanel';
import { CHOICE_LABELS, SPEC_GROUPS } from './SpecForm';
import { STORE_REFUSALS } from './store';
import { SNAPSHOT_REASONS, TABS } from './words';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
/** A list of phrases as a table, so it can sit beside the others. */
const listed = (phrases: readonly string[]): Record<string, string> => Object.fromEntries(phrases.filter((p) => p !== '').map((p) => [p, p]));
const column = <T>(table: Record<string, T>, pick: (row: T) => string): Record<string, string> => Object.fromEntries(Object.entries(table).map(([k, row]) => [k, pick(row)]));

/** Every table whose values are shown through t(). Add a table here when a component starts translating it. */
export const TABLES: Record<string, Record<string, string>> = {
  ATTRIBUTE_LABELS, ATTRIBUTE_BLURBS, BASIS_LABELS, QUALITY_LABELS, EVIDENCE_LABELS, LEVEL_LABELS, LEVEL_SUMMARIES, RARITY_LABELS, BODY_CLASS_LABELS,
  ATTRIBUTE_SHORT, GRADE_CATEGORY_NAMES, GRADE_CATEGORY_SHORT, MOD_SHORT,
  // The specification sheet.
  SPEC_FIELD_LABELS, SOURCE_KIND_LABELS, CHOICE_LABELS, SPEC_GROUPS: listed(SPEC_GROUPS.map((g) => g.title)),
  // The grade, the certification ladder and rarity.
  GRADE_ITEM_LABELS, GRADE_CATEGORY_LABELS, GRADE_CAP_REASONS: listed(Object.values(GRADE_CAP_REASONS)), DISCREPANCY_DETAILS, TIER_NAMES: listed(TIER_NAMES), REQUIREMENT_LABELS,
  RARITY_FACTOR_LABELS, EDITION_NAMES, SCARCITY: listed([SCARCITY_UNBACKED]),
  // Modifications and wear.
  MOD_NAMES: column(MODS, (m) => m.name), MOD_SUMMARIES: column(MODS, (m) => m.summary), MOD_TIER_NAMES: listed(MOD_TIER_NAMES), MOD_REFUSALS, WEAR_SYSTEM_LABELS, INSTALL_LABELS, UPKEEP_LABELS,
  // The passport and what it refuses.
  EVENT_TYPE_LABELS, PASSPORT_REFUSALS, VERIFICATION_REFUSALS, ATTESTATION_SCOPE_LABELS, PHOTO_SUBJECT_LABELS, WORK_LABELS, DOCUMENT_LABELS, FILE_REFUSALS,
  STORE_REFUSALS: listed(STORE_REFUSALS), VIN_NOTES: listed(VIN_NOTES), SNAPSHOT_REASONS,
  // Races.
  RACE_MODE_NAMES: column(RACE_MODE_RULES, (m) => m.name), RACE_MODE_BLURBS: column(RACE_MODE_RULES, (m) => m.blurb), SETUP_REFUSALS,
  EXCLUSION_REASONS: listed([EXCLUSION_REASONS.ranked, EXCLUSION_REASONS.untrusted, EXCLUSION_REASONS.twice, ...Object.values(EXCLUSION_REASONS.missing)]),
  // The page itself.
  TABS: listed(TABS),
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
