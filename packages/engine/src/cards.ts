// The card generator. A card is a view of everything else: the vehicle's stats, its grade, its certification level,
// how collectible it is, and which printing this is. assemble() is the one call an app needs for a parked vehicle.
// Rarity is worked out from facts that are not performance (how many were built, age, certification, preservation),
// so a slow car can be Mythic and a fast one Common. A card never carries a price.
import type { GradeCeiling } from './certification';
import { certify, gradeCeiling, isSlabbed } from './certification';
import { assessCondition } from './condition';
import { catalogueMatch } from './database';
import { GRADE_FORMULA, GRADE_WEIGHTS, grade10Of, gradeFacts, gradePassport, snapshotOf, tierOf } from './grading';
import { EDITION_NAMES, RARITY_LABELS } from './labels';
import type { ModRefusal } from './modifications';
import { resolveModifications } from './modifications';
import { attributesOf, baseStats, illustrativeLayer, powerRating, specQuality, weakestQuality } from './normalize';
import { appendEdition, appendSnapshot } from './passport';
import { vehicleStats } from './performance';
import { RULESET } from './rules';
import type {
  ActiveModification, CardAttribute, CardEdition, CardFinish, CatalogueEntry, CertificationLevel, CertificationResult, CollectibleCard, ConditionState,
  ExampleVehicle, GradeReport, GradeSnapshot, Passport, Rarity, RarityFactor, RarityTier, Sourced, StatLayer, VehicleIdentity, VehicleSpec, VehicleStats, VerifierRegistry,
} from './types';
import { ATTRIBUTE_KEYS, CERTIFICATION_LEVELS, GRADE_CATEGORIES, RARITY_TIERS } from './types';
import { clamp, dayOf, round1 } from './util';
import { activeModifications, attestationsOver, competitionConditionInputs, competitionModifications, conditionInputs, standingOf } from './verification';

export { EDITION_NAMES, RARITY_LABELS };

export const RARITY_FACTOR_LABELS: Record<RarityFactor['id'], string> = { scarcity: 'Scarcity', age: 'Age', provenance: 'Provenance', preservation: 'Preservation' };

/** Scarcity points by how many were built, most generous first: up to this many units earns these points. */
export const SCARCITY_STEPS: readonly (readonly [units: number, points: number])[] = [[99, 40], [999, 34], [4999, 27], [19999, 20], [99999, 12], [499999, 5]];
/** Age points by years since the model year, oldest first. */
export const AGE_STEPS: readonly (readonly [years: number, points: number])[] = [[40, 15], [25, 11], [15, 6], [10, 3]];
export const PROVENANCE_POINTS: Record<CertificationLevel, number> = { registered: 0, documented: 10, verified: 20, certified: 30 };
/** The score a tier starts at, lowest first. One-of-One is never reached by score. */
export const RARITY_THRESHOLDS: readonly (readonly [tier: RarityTier, from: number])[] = [['common', 0], ['uncommon', 10], ['rare', 25], ['epic', 40], ['legendary', 55], ['mythic', 70]];

export type RarityInput = {
  /** The build number on file; null when none is. */
  productionUnits: Sourced<number> | null;
  /** True when the build number can be relied on: see buildNumberCounts. A figure that cannot be scores nothing. */
  buildNumberBacked: boolean;
  modelYear: number;
  /** YYYY-MM-DD */
  asOf: string;
  level: CertificationLevel;
  /** The Originality and the Physical condition scores of the grade, 0..100. */
  originality: number;
  condition: number;
  /** True when a valid 'one-of-one' attestation exists. */
  oneOfOneAttested: boolean;
};

/** What the scarcity line says when a build number is on file but nothing stands behind it. */
export const SCARCITY_UNBACKED = 'The build number on file is the owner’s own, so it does not count';

/**
 * Whether a passport's build number counts toward rarity: only when the specification is the catalogue's own, figure
 * for figure, or a verifier attested it. A figure the owner typed in is shown on the sheet and moves nothing, or
 * anyone could type a 1. The source named beside the figure decides nothing here: on a passport an owner holds, that
 * label is part of the file like everything else.
 */
export function buildNumberCounts(spec: VehicleSpec, specificationAttested: boolean): boolean {
  return spec.productionUnits !== null && (specificationAttested || catalogueMatch(spec) !== null);
}

/**
 * How collectible a vehicle is. The input holds no attribute and no rating: performance cannot move rarity.
 * One-of-One is never worked out from the score. It needs a build number of exactly one that counts, or a verifier's
 * one-of-one attestation.
 */
export function rarityOf(input: RarityInput): Rarity {
  const onFile = input.productionUnits ? input.productionUnits.value : null;
  const units = input.buildNumberBacked === true ? onFile : null;
  let scarcity = 0;
  if (units !== null) for (const [upTo, points] of SCARCITY_STEPS) if (units <= upTo) { scarcity = points; break; }
  const years = Math.max(0, Number(input.asOf.slice(0, 4)) - input.modelYear);
  let age = 0;
  for (const [from, points] of AGE_STEPS) if (years >= from) { age = points; break; }
  const provenance = PROVENANCE_POINTS[input.level];
  const preservation = (input.originality >= 90 ? 8 : input.originality >= 80 ? 4 : 0) + (input.condition >= 85 ? 7 : input.condition >= 70 ? 3 : 0);
  const score = scarcity + age + provenance + preservation;
  let tier: RarityTier = 'common';
  for (const [name, from] of RARITY_THRESHOLDS) if (score >= from) tier = name;
  if (units === 1 || input.oneOfOneAttested) tier = 'one-of-one';
  const factor = (id: RarityFactor['id'], points: number, max: number, detail: string): RarityFactor => ({ id, label: RARITY_FACTOR_LABELS[id], points, max, detail });
  return {
    tier, score,
    factors: [
      factor('scarcity', scarcity, 40, units !== null ? `${units} built` : onFile !== null ? SCARCITY_UNBACKED : 'No build number on file'),
      factor('age', age, 15, `${years} years since the model year`),
      factor('provenance', provenance, 30, EDITION_NAMES[input.level]),
      factor('preservation', preservation, 15, `Originality ${Math.round(input.originality)}, condition ${Math.round(input.condition)}`),
    ],
  };
}

/** The slab's finish, by the rule the home page has always used: raw until slabbed, then by tier. Foil follows the grade. */
export function finishOf(grade: { grade10: number; tier: number }, slabbed: boolean): { finish: CardFinish; foil: number } {
  if (!slabbed) return { finish: 'raw', foil: 0 };
  const finish: CardFinish = grade.tier >= 10 ? 'rainbow' : grade.tier >= 9 ? 'holo' : grade.tier >= 7 ? 'blue' : 'standard';
  return { finish, foil: clamp((grade.grade10 - 6) / 4, 0, 1) };
}

const titleOf = (id: VehicleIdentity): string => `${id.year} ${id.make} ${id.model}`.trim();

function attributesFor(shown: StatLayer, base: StatLayer): CardAttribute[] {
  return ATTRIBUTE_KEYS.map((key) => {
    const value = shown.scores[key].value, from = base.scores[key].value;
    return { key, value, base: from, delta: value !== null && from !== null ? value - from : 0, basis: shown.scores[key].basis };
  });
}

/* ------------------------------------------------------------- stored history ---- */

const levelRank = (level: CertificationLevel): number => CERTIFICATION_LEVELS.indexOf(level);
const rarityRank = (tier: RarityTier): number => RARITY_TIERS.indexOf(tier);
/** Room for the rounding a stored score went through. */
const SLACK = 0.051;

/**
 * The ceiling at one moment (a day, or a timestamp for that moment of its day), and the highest rarity a card of a
 * given level could have carried then.
 */
type Ceilings = (at: string) => { grade: GradeCeiling; rarity: (level: CertificationLevel) => RarityTier };

function ceilingsOf(passport: Passport, registry: VerifierRegistry): Ceilings {
  const known: Record<string, { grade: GradeCeiling; rarity: (level: CertificationLevel) => RarityTier }> = {};
  const spec = passport.spec;
  // Which attestations counted is worked out for the whole passport once. A moment's ceiling follows from those and
  // from the year (for the card's age), so it is worked out afresh only when one of the two differs. A file padded
  // with thousands of entries and a snapshot for every day of thirteen years then costs little more to judge than a
  // short one: with no attestation that could ever count, one ceiling a year. Nothing is worked out (and no
  // signature is checked) until a moment is asked about.
  let counted: ReturnType<typeof attestationsOver> | null = null;
  return (at) => {
    if (counted === null) counted = attestationsOver(passport, registry);
    const day = dayOf(at);
    const on = counted(at);
    const key = `${day.slice(0, 4)} ${on.key}`;
    if (known[key]) return known[key];
    const facts = { asOf: day, attestations: on.attestations() };
    const grade = gradeCeiling(passport, registry, day, facts);
    const backed = buildNumberCounts(spec, facts.attestations.some((s) => s.attestation.scope === 'specification'));
    // The scarcity and the age are what they are. Provenance is the card's own level, as far as the ceiling's level
    // goes; preservation is what the ceiling's own originality and condition would earn, not full marks: with no
    // attestation an owner's originality stops at 85 and condition at 75, and so does the rarity they can reach.
    const tiers: Partial<Record<CertificationLevel, RarityTier>> = {};
    const rarity = (level: CertificationLevel): RarityTier => {
      const held = levelRank(level) < levelRank(grade.level) ? level : grade.level;
      const found = tiers[held];
      if (found !== undefined) return found;
      return (tiers[held] = rarityOf({
        productionUnits: spec.productionUnits, buildNumberBacked: backed, modelYear: spec.identity.year, asOf: day, level: held,
        originality: grade.categories.originality, condition: grade.categories.condition, oneOfOneAttested: grade.oneOfOne,
      }).tier);
    };
    return (known[key] = { grade, rarity });
  };
}

/**
 * A stored snapshot is shown when it could be a grade this engine gave: by the formula in use, for the day it was
 * written and no later than today, with numbers that agree with each other (the overall is its categories' weighted
 * sum, the label's number and tier are the overall's), and within what the record supports for that day.
 */
function snapshotSupported(snapshot: GradeSnapshot, at: Ceilings, today: string): boolean {
  if (snapshot.formula !== GRADE_FORMULA || snapshot.asOf > today || dayOf(snapshot.at) !== snapshot.asOf) return false;
  let sum = 0;
  for (const k of GRADE_CATEGORIES) sum += snapshot.categories[k] * GRADE_WEIGHTS[k];
  if (Math.abs(snapshot.overall - round1(sum)) > SLACK || snapshot.grade10 !== grade10Of(snapshot.overall) || snapshot.tier !== tierOf(snapshot.grade10)) return false;
  // Judged as the record stood at the moment it was written (the day is the same: checked above).
  const { grade } = at(snapshot.at);
  if (levelRank(snapshot.level) > levelRank(grade.level) || snapshot.overall > grade.overall + SLACK) return false;
  return GRADE_CATEGORIES.every((k) => snapshot.categories[k] <= grade.categories[k] + SLACK);
}

/**
 * A stored edition is shown when it could be a card this engine printed: dated no later than today, raw exactly when
 * its level is Registered, wearing the finish its grade earns, with a Power Rating that is the mean of its own seven
 * attributes, and within the level, the grade and the rarity (for a card of its own level) that the record supports
 * for the moment it was printed. The attributes themselves are
 * the specification sheet's account on the day of printing: nothing here can check them, so the apps say so and the
 * public view leaves them out.
 */
function editionSupported(edition: CardEdition, at: Ceilings, today: string): boolean {
  const day = dayOf(edition.issuedAt);
  if (day > today) return false;
  const slabbed = isSlabbed(edition.level);
  if ((edition.grade10 !== null) !== slabbed) return false;
  const label = edition.grade10 ?? 1;
  if (edition.finish !== finishOf({ grade10: label, tier: tierOf(label) }, slabbed).finish) return false;
  if (edition.powerRating !== powerRating(edition.attributes)) return false;
  const { grade, rarity } = at(edition.issuedAt);
  if (levelRank(edition.level) > levelRank(grade.level) || rarityRank(edition.rarity) > rarityRank(rarity(edition.level))) return false;
  return edition.grade10 === null || edition.grade10 <= grade10Of(grade.overall) + SLACK;
}

/**
 * The stored history a passport's own record supports, as of a day. A grade snapshot and a card edition are copies of
 * past results, kept so that history is never rewritten; but a passport file is its holder's to edit, and a copy can
 * be written to say anything. So each one is checked against the most the passport could have earned on its day,
 * going only by what independent verifiers had attested by then (gradeCeiling), and against itself: a label that
 * does not follow from its own score, a finish its grade does not earn, or a date that has not happened yet is not
 * something this engine wrote. What fails is left out here, and so from every card, history list and public view.
 * With no verifier registered nothing above Documented, and no Verification score above zero, is ever shown.
 */
export function supportedHistory(passport: Passport, registry: VerifierRegistry, asOf: string): { snapshots: GradeSnapshot[]; editions: CardEdition[]; unsupported: number } {
  const at = ceilingsOf(passport, registry);
  const today = dayOf(asOf);
  const snapshots = passport.snapshots.filter((s) => snapshotSupported(s, at, today));
  const editions = passport.editions.filter((e) => editionSupported(e, at, today));
  return { snapshots, editions, unsupported: passport.snapshots.length - snapshots.length + passport.editions.length - editions.length };
}

/** The newest supported entry of a list, looking from the end, that also passes `wanted`. */
function newest<T>(list: readonly T[], supported: (item: T) => boolean, wanted: (item: T) => boolean = () => true): T | null {
  for (let i = list.length - 1; i >= 0; i--) if (wanted(list[i]) && supported(list[i])) return list[i];
  return null;
}

/* ---------------------------------------------------------------- assembling ---- */

/** Everything known about a parked vehicle on one day, worked out once. */
export type Assembly = {
  asOf: string;
  stats: VehicleStats;
  report: GradeReport;
  certification: CertificationResult;
  rarity: Rarity;
  card: CollectibleCard;
  /** The vehicle's condition from everything on its passport. */
  condition: ConditionState;
  /** Its condition from verified inputs alone: what the competition layer is worn by. */
  competitionCondition: ConditionState;
  modifications: { applied: ActiveModification[]; refused: ModRefusal[] };
  /** True when an independent verifier attested the factory specification as it stands. Ranked play asks for it. */
  specificationAttested: boolean;
  /** True when the specification is the reference catalogue's own, figure for figure. */
  catalogueSpecification: boolean;
};

/** Runs every engine over a passport and builds its card. Pure: the same passport, registry and day give the same assembly. */
export function assemble(passport: Passport, registry: VerifierRegistry, asOf: string): Assembly {
  const day = dayOf(asOf);
  const spec = passport.spec;
  // The passport's standing is worked out once and handed to everything that asks about it.
  const standing = standingOf(passport, registry, day);
  const attested = (scope: string): boolean => standing.attestations.some((s) => s.attestation.scope === scope);
  const fitted = activeModifications(passport, registry, day, standing);
  const modifications = resolveModifications(spec, fitted);
  const condition = assessCondition(conditionInputs(passport, registry, day, standing));
  // Ranked play reads a second state and a second list of modifications, both worked out from verified inputs alone.
  const competitionCondition = assessCondition(competitionConditionInputs(passport, registry, day, standing));
  const stats = vehicleStats({ spec, modifications: fitted, competitionModifications: competitionModifications(passport, registry, day, standing), condition, competitionCondition });

  const facts = gradeFacts(passport, registry, day, standing);
  const report = gradePassport(passport, registry, day, facts);
  const certification = certify(passport, report, registry, day, facts);
  const level = certification.level;
  const slabbed = isSlabbed(level);
  const verifiedSpec = attested('specification');
  const catalogueSpecification = catalogueMatch(spec) !== null;
  const rarity = rarityOf({
    productionUnits: spec.productionUnits, buildNumberBacked: buildNumberCounts(spec, verifiedSpec), modelYear: spec.identity.year, asOf: day, level,
    originality: report.categories.originality.score, condition: report.categories.condition.score,
    oneOfOneAttested: attested('one-of-one'),
  });

  let photoAttachmentId: string | null = null;
  for (const e of facts.events) if (e.type === 'photo' && e.subject === 'exterior' && e.attachments.length > 0) photoAttachmentId = e.attachments[0].id;

  // The card shows the edition printed for the level it holds now. The name is always the level's own: a stored
  // edition is never taken at its word about what it is.
  const at = ceilingsOf(passport, registry);
  const printed = newest(passport.editions, (e) => editionSupported(e, at, day), (e) => e.level === level);
  const edition = printed
    ? { number: printed.number, name: EDITION_NAMES[level], issuedAt: printed.issuedAt }
    : { number: passport.editions.length + 1, name: EDITION_NAMES[level], issuedAt: passport.createdAt };
  const { finish, foil } = finishOf(report, slabbed);
  // On a passport, the sources named beside the figures are the holder's own account unless the whole specification
  // is the catalogue's, figure for figure. So the card never claims better than 'owner' on the labels' say-so.
  const labelled = specQuality(spec);
  const quality = verifiedSpec ? 'verified' : catalogueSpecification ? labelled ?? 'reference' : weakestQuality([labelled, 'owner']) ?? 'owner';

  const card: CollectibleCard = {
    micarId: passport.micarId,
    serial: `${passport.micarId} · E${edition.number}`,
    identity: spec.identity,
    title: titleOf(spec.identity),
    subtitle: spec.identity.trim,
    color: passport.color,
    photoAttachmentId,
    powerRating: stats.vehicle.powerRating,
    provisionalRating: stats.vehicle.provisionalRating,
    attributes: attributesFor(stats.vehicle, stats.base),
    statsBasis: 'vehicle',
    level,
    grade: { overall: report.overall, grade10: report.grade10, tier: report.tier, tierName: report.tierName, slabbed },
    rarity,
    edition,
    mods: modifications.applied.map((m) => ({ category: m.category, tier: m.tier, evidence: m.evidence })),
    finish, foil,
    quality,
    illustrative: false,
    ruleset: RULESET,
  };
  return { asOf: day, stats, report, certification, rarity, card, condition, competitionCondition, modifications, specificationAttested: verifiedSpec, catalogueSpecification };
}

/**
 * Prints the card's edition for the level it holds, the first time it holds it. One edition per level reached:
 * Registration, Documented, Verified, Certified. Earlier editions are never touched, a level lost and regained does
 * not print again, and a card that drops a level shows the edition it was given for the level it is back at.
 * Returns the same passport when the level already has its edition.
 */
export function issueEdition(passport: Passport, registry: VerifierRegistry, ctx: { now: string; reason: string }): Passport {
  const a = assemble(passport, registry, ctx.now);
  const at = ceilingsOf(passport, registry);
  if (newest(passport.editions, (e) => editionSupported(e, at, a.asOf), (e) => e.level === a.certification.level) !== null) return passport;
  const edition: CardEdition = {
    number: passport.editions.length + 1,
    name: EDITION_NAMES[a.certification.level],
    issuedAt: ctx.now,
    level: a.certification.level,
    rarity: a.rarity.tier,
    finish: a.card.finish,
    grade10: a.card.grade.slabbed ? a.report.grade10 : null,
    powerRating: a.stats.vehicle.powerRating,
    attributes: attributesOf(a.stats.vehicle.scores),
    reason: ctx.reason,
  };
  return appendEdition(passport, edition);
}

/**
 * Keeps the grade as it stands today in the passport's history. Appends, never rewrites. Returns the same passport
 * when the overall score, all five categories and the level equal the last snapshot the record supports.
 */
export function recordSnapshot(passport: Passport, registry: VerifierRegistry, ctx: { now: string; id: string; reason: string }): Passport {
  const a = assemble(passport, registry, ctx.now);
  const at = ceilingsOf(passport, registry);
  const last = newest(passport.snapshots, (s) => snapshotSupported(s, at, a.asOf));
  if (last && last.overall === a.report.overall && last.level === a.certification.level && GRADE_CATEGORIES.every((k) => last.categories[k] === a.report.categories[k].score)) return passport;
  return appendSnapshot(passport, snapshotOf(a.report, a.certification.level, { id: ctx.id, at: ctx.now, reason: ctx.reason, events: passport.events.length }));
}

const UNGRADED = { overall: 0, grade10: 1, tier: 1, tierName: 'Parts', slabbed: false } as const;

/** A demonstration card from typed-in placeholder values. It is stamped illustrative and belongs to no one. */
export function exampleCard(example: ExampleVehicle, asOf: string): CollectibleCard {
  const layer = illustrativeLayer(example.attributes);
  return {
    micarId: 'EXAMPLE', serial: 'EXAMPLE · E1', identity: example.identity, title: titleOf(example.identity), subtitle: example.identity.trim, color: '',
    photoAttachmentId: null, powerRating: layer.powerRating, provisionalRating: layer.provisionalRating, attributes: attributesFor(layer, layer), statsBasis: 'base',
    level: 'registered', grade: { ...UNGRADED },
    rarity: { tier: 'common', score: 0, factors: [] },
    edition: { number: 1, name: EDITION_NAMES.registered, issuedAt: `${dayOf(asOf)}T00:00:00.000Z` },
    mods: [], finish: 'raw', foil: 0, quality: 'illustrative', illustrative: true, ruleset: RULESET,
  };
}

/** A house card from a catalogue entry: factory stats only. It has no owner, so it has no grade and no certification beyond the first level. */
export function catalogueCard(entry: CatalogueEntry, asOf: string): CollectibleCard {
  const day = dayOf(asOf);
  const spec = entry.spec;
  const layer = baseStats(spec);
  return {
    micarId: 'HOUSE', serial: `HOUSE · ${entry.id}`, identity: spec.identity, title: titleOf(spec.identity), subtitle: spec.identity.trim, color: '',
    photoAttachmentId: null, powerRating: layer.powerRating, provisionalRating: layer.provisionalRating, attributes: attributesFor(layer, layer), statsBasis: 'base',
    level: 'registered', grade: { ...UNGRADED },
    // A house card's build number is the catalogue's own.
    rarity: rarityOf({ productionUnits: spec.productionUnits, buildNumberBacked: entry.status === 'reference', modelYear: spec.identity.year, asOf: day, level: 'registered', originality: 0, condition: 0, oneOfOneAttested: false }),
    edition: { number: 1, name: EDITION_NAMES.registered, issuedAt: `${entry.asOf}T00:00:00.000Z` },
    mods: [], finish: 'raw', foil: 0, quality: entry.status === 'illustrative' ? 'illustrative' : specQuality(spec) ?? 'reference', illustrative: entry.status === 'illustrative', ruleset: RULESET,
  };
}
