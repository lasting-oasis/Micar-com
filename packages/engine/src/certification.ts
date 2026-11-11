// Certification levels: Registered, Documented, Verified, Certified. Each maps onto a state the product already has:
// a parked raw card; a slabbed card on a self-reported trail with evidence attached; a card an independent party has
// checked; a card whose vehicle an inspector has examined in person. A level is held only when its own requirements
// and every lower level's are met, and the result lists every requirement so a page can show what unlocks the next.
// Nothing here can be bought, and nothing an owner uploads satisfies a Verified or Certified requirement.
import { catalogueMatch } from './database';
import type { GradeFacts } from './grading';
import { GRADE_WEIGHTS, OWNER_CEILING, gradeFacts, verificationScore } from './grading';
import { LEVEL_LABELS, LEVEL_SUMMARIES } from './labels';
import type { CertificationLevel, CertificationResult, GradeCategoryKey, GradeReport, Passport, Requirement, VerifierRegistry } from './types';
import { CERTIFICATION_LEVELS, GRADE_CATEGORIES } from './types';
import { dayOf, monthsBetween, round1 } from './util';

export { LEVEL_LABELS, LEVEL_SUMMARIES };

/** The label of every requirement, by id. The apps translate these. */
export const REQUIREMENT_LABELS: Record<string, string> = {
  'reg.vehicle': 'Year, make and model on record',
  'reg.owner': 'An owner on record',
  'doc.vin': 'A well-formed VIN with no discrepancy',
  'doc.records': 'Three documented records',
  'doc.photos': 'Four exterior photographs',
  'doc.mileage': 'A mileage reading',
  'doc.clean': 'No odometer rollback and no withdrawn record',
  'doc.scores': 'Identity at least 40 and Documentation at least 30',
  'ver.identity': 'Identity verified by an independent party',
  'ver.second': 'Mileage or records verified by an independent party',
  'ver.score': 'Verification at least 40',
  'cert.inspection': 'An in-person condition inspection in the last 12 months',
  'cert.originality': 'Originality verified by an independent party',
  'cert.records': 'Records verified by an independent party',
  'cert.scores': 'Every category at least 60 and Verification at least 85',
};

/** Records needed to leave RAW: the same three entries that have always put a card in the case. */
export const RECORDS_FOR_DOCUMENTED = 3;
export const EXTERIOR_PHOTOS_FOR_DOCUMENTED = 4;

/** A card is in its case from Documented up. */
export const isSlabbed = (level: CertificationLevel): boolean => level !== 'registered';

/**
 * The inspection Certified asks for: one made in person, with a score, that counts in full and is less than twelve
 * months old. Any such inspection will do. A later check made from photographs does not take it away.
 */
export function hasInPersonInspection(facts: GradeFacts): boolean {
  return facts.attestations.some((s) => s.attestation.scope === 'condition' && s.attestation.inPerson && s.attestation.conditionScore !== null && s.weight === 1
    && monthsBetween(s.attestation.date, facts.asOf) < 12);
}

const of = (n: number, needed: number) => `${Math.min(n, needed)} of ${needed}`;
const yesNo = (met: boolean) => (met ? 'Met' : 'Not yet');

function requirementsOf(passport: Passport, report: GradeReport, facts: GradeFacts): Requirement[] {
  const id = passport.spec.identity;
  const c = report.categories;
  const has = (scope: string) => facts.attestations.some((s) => s.attestation.scope === scope);
  const vinOk = facts.vin.present && (facts.vin.checkDigitValid || facts.vin.pre1981) && !report.discrepancies.some((d) => d.id === 'vin-check-digit' || d.id === 'vin-year-mismatch');
  const clean = !report.discrepancies.some((d) => d.id === 'odometer-rollback' || d.id === 'voided-record');
  const inspected = hasInPersonInspection(facts);
  const lowest = Math.min(...GRADE_CATEGORIES.map((k) => c[k].score));

  const req = (rid: string, level: CertificationLevel, met: boolean, detail: string): Requirement => ({ id: rid, level, label: REQUIREMENT_LABELS[rid], met, detail });
  return [
    req('reg.vehicle', 'registered', id.year > 0 && id.make !== '' && id.model !== '', `${id.year} ${id.make} ${id.model}`.trim()),
    req('reg.owner', 'registered', passport.owners.length > 0, yesNo(passport.owners.length > 0)),

    req('doc.vin', 'documented', vinOk, !facts.vin.present ? 'No VIN entered' : vinOk ? 'Met' : 'The VIN has a discrepancy'),
    req('doc.records', 'documented', facts.records.length >= RECORDS_FOR_DOCUMENTED, of(facts.records.length, RECORDS_FOR_DOCUMENTED)),
    req('doc.photos', 'documented', facts.photos.exterior >= EXTERIOR_PHOTOS_FOR_DOCUMENTED, of(facts.photos.exterior, EXTERIOR_PHOTOS_FOR_DOCUMENTED)),
    req('doc.mileage', 'documented', facts.readings.length >= 1, of(facts.readings.length, 1)),
    req('doc.clean', 'documented', clean, yesNo(clean)),
    req('doc.scores', 'documented', c.identity.score >= 40 && c.documentation.score >= 30, `Identity ${c.identity.score}, Documentation ${c.documentation.score}`),

    req('ver.identity', 'verified', has('identity'), yesNo(has('identity'))),
    req('ver.second', 'verified', has('mileage') || has('documentation'), yesNo(has('mileage') || has('documentation'))),
    req('ver.score', 'verified', c.verification.score >= 40, `Verification ${c.verification.score}`),

    req('cert.inspection', 'certified', inspected, yesNo(inspected)),
    req('cert.originality', 'certified', has('originality'), yesNo(has('originality'))),
    req('cert.records', 'certified', has('documentation'), yesNo(has('documentation'))),
    req('cert.scores', 'certified', lowest >= 60 && c.verification.score >= 85, `Lowest category ${lowest}, Verification ${c.verification.score}`),
  ];
}

/**
 * The certification level a passport holds on one day, with every requirement of every level.
 * Pass the report made for the same day; the facts are gathered again unless the caller hands them in.
 */
export function certify(passport: Passport, report: GradeReport, registry: VerifierRegistry, asOf: string, facts: GradeFacts = gradeFacts(passport, registry, dayOf(asOf))): CertificationResult {
  const requirements = requirementsOf(passport, report, facts);
  let level: CertificationLevel = 'registered';
  for (const candidate of CERTIFICATION_LEVELS) {
    if (requirements.filter((r) => r.level === candidate).every((r) => r.met)) level = candidate;
    else break;
  }
  const at = CERTIFICATION_LEVELS.indexOf(level);
  // A passport that fails even Registered is reported as registered, with the unmet requirement showing.
  const failsFirst = requirements.some((r) => r.level === 'registered' && !r.met);
  const next = failsFirst ? 'registered' : at + 1 < CERTIFICATION_LEVELS.length ? CERTIFICATION_LEVELS[at + 1] : null;
  return { level, requirements, next, missing: next === null ? [] : requirements.filter((r) => r.level === next && !r.met) };
}

/* ------------------------------------------------------------------- the ceiling ---- */

/**
 * The most a passport's grade and level could have been on a day, going only by what independent verifiers had
 * attested by then. With no attestation that is Documented and what an owner can reach alone. A grade snapshot or a
 * card edition is a stored copy of a past result, and a file can say anything: one that claims more than this is not
 * something the passport's own record supports.
 */
export type GradeCeiling = {
  level: CertificationLevel;
  categories: Record<GradeCategoryKey, number>;
  overall: number;
  /** True when a One-of-One card could have been printed: a one-of-one attestation, or a build of exactly one that counts. */
  oneOfOne: boolean;
};

export function gradeCeiling(passport: Passport, registry: VerifierRegistry, asOf: string, facts: GradeFacts = gradeFacts(passport, registry, dayOf(asOf))): GradeCeiling {
  const has = (scope: string) => facts.attestations.some((s) => s.attestation.scope === scope);
  const verification = verificationScore(facts);
  let inspection = 0;
  for (const s of facts.attestations) if (s.attestation.scope === 'condition' && s.attestation.conditionScore !== null) inspection = Math.max(inspection, s.weight);
  const categories: Record<GradeCategoryKey, number> = {
    identity: has('identity') ? 100 : OWNER_CEILING.identity,
    documentation: OWNER_CEILING.documentation,
    // A fresh inspection can score to 100; one past its first year is capped at 85.
    condition: inspection === 1 ? 100 : inspection > 0 ? 85 : OWNER_CEILING.condition,
    originality: has('originality') ? 100 : OWNER_CEILING.originality,
    verification,
  };
  let sum = 0;
  for (const k of GRADE_CATEGORIES) sum += categories[k] * GRADE_WEIGHTS[k];
  let level: CertificationLevel = 'documented';
  if (has('identity') && (has('mileage') || has('documentation')) && verification >= 40) level = 'verified';
  if (level === 'verified' && hasInPersonInspection(facts) && has('originality') && has('documentation') && verification >= 85) level = 'certified';
  const units = passport.spec.productionUnits;
  const oneOfOne = has('one-of-one') || (units !== null && units.value === 1 && (has('specification') || catalogueMatch(passport.spec) !== null));
  return { level, categories, overall: round1(sum), oneOfOne };
}
