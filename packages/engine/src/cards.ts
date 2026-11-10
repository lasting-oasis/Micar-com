// The card generator. A card is a view of everything else: the vehicle's stats, its grade, its certification level,
// how collectible it is, and which printing this is. assemble() is the one call an app needs for a parked vehicle.
// Rarity is worked out from facts that are not performance (how many were built, age, certification, preservation),
// so a slow car can be Mythic and a fast one Common. A card never carries a price.
import { certify, isSlabbed } from './certification';
import { assessCondition } from './condition';
import { gradeFacts, gradePassport, snapshotOf } from './grading';
import { RARITY_LABELS } from './labels';
import type { ModRefusal } from './modifications';
import { resolveModifications } from './modifications';
import { attributesOf, baseStats, illustrativeLayer, qualityOf, specQuality } from './normalize';
import { appendEdition, appendSnapshot } from './passport';
import { vehicleStats } from './performance';
import { RULESET } from './rules';
import type {
  ActiveModification, CardAttribute, CardEdition, CardFinish, CatalogueEntry, CertificationLevel, CertificationResult, CollectibleCard, ConditionState,
  ExampleVehicle, GradeReport, Passport, Rarity, RarityFactor, RarityTier, Sourced, StatLayer, VehicleIdentity, VehicleStats, VerifierRegistry,
} from './types';
import { ATTRIBUTE_KEYS, GRADE_CATEGORIES } from './types';
import { clamp, dayOf } from './util';
import { activeModifications, conditionInputs, standingOf } from './verification';

export { RARITY_LABELS };

/** Each certification level prints its own edition of the card. */
export const EDITION_NAMES: Record<CertificationLevel, string> = {
  registered: 'Registration Edition', documented: 'Documented Edition', verified: 'Verified Edition', certified: 'Certified Edition',
};

export const RARITY_FACTOR_LABELS: Record<RarityFactor['id'], string> = { scarcity: 'Scarcity', age: 'Age', provenance: 'Provenance', preservation: 'Preservation' };

/** Scarcity points by how many were built, most generous first: up to this many units earns these points. */
export const SCARCITY_STEPS: readonly (readonly [units: number, points: number])[] = [[99, 40], [999, 34], [4999, 27], [19999, 20], [99999, 12], [499999, 5]];
/** Age points by years since the model year, oldest first. */
export const AGE_STEPS: readonly (readonly [years: number, points: number])[] = [[40, 15], [25, 11], [15, 6], [10, 3]];
export const PROVENANCE_POINTS: Record<CertificationLevel, number> = { registered: 0, documented: 10, verified: 20, certified: 30 };
/** The score a tier starts at, lowest first. One-of-One is never reached by score. */
export const RARITY_THRESHOLDS: readonly (readonly [tier: RarityTier, from: number])[] = [['common', 0], ['uncommon', 10], ['rare', 25], ['epic', 40], ['legendary', 55], ['mythic', 70]];

export type RarityInput = {
  /** The build number on file, with its source; null when none is. */
  productionUnits: Sourced<number> | null;
  /** True when an independent verifier attested the specification the build number is part of. */
  specificationAttested?: boolean;
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
 * Whether a build number counts toward rarity: when it came from a published source or a verifier attested the
 * specification. A figure the owner typed in is shown on the sheet and moves nothing, or anyone could type a 1.
 */
export function buildNumberCounts(productionUnits: Sourced<number> | null, specificationAttested = false): boolean {
  if (productionUnits === null) return false;
  if (specificationAttested) return true;
  const quality = qualityOf(productionUnits.source.kind);
  return quality === 'reference' || quality === 'sourced';
}

/**
 * How collectible a vehicle is. The input holds no attribute and no rating: performance cannot move rarity.
 * One-of-One is never worked out from the score. It needs a build number of exactly one that counts, or a verifier's
 * one-of-one attestation.
 */
export function rarityOf(input: RarityInput): Rarity {
  const onFile = input.productionUnits ? input.productionUnits.value : null;
  const units = buildNumberCounts(input.productionUnits, input.specificationAttested === true) ? onFile : null;
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

/** Everything known about a parked vehicle on one day, worked out once. */
export type Assembly = {
  asOf: string;
  stats: VehicleStats;
  report: GradeReport;
  certification: CertificationResult;
  rarity: Rarity;
  card: CollectibleCard;
  condition: ConditionState;
  modifications: { applied: ActiveModification[]; refused: ModRefusal[] };
  /** True when an independent verifier attested the factory specification as it stands. Ranked play asks for it. */
  specificationAttested: boolean;
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
  const stats = vehicleStats({ spec, modifications: fitted, condition });

  const facts = gradeFacts(passport, registry, day, standing);
  const report = gradePassport(passport, registry, day, facts);
  const certification = certify(passport, report, registry, day, facts);
  const level = certification.level;
  const slabbed = isSlabbed(level);
  const verifiedSpec = attested('specification');
  const rarity = rarityOf({
    productionUnits: spec.productionUnits, specificationAttested: verifiedSpec, modelYear: spec.identity.year, asOf: day, level,
    originality: report.categories.originality.score, condition: report.categories.condition.score,
    oneOfOneAttested: attested('one-of-one'),
  });

  let photoAttachmentId: string | null = null;
  for (const e of facts.events) if (e.type === 'photo' && e.subject === 'exterior' && e.attachments.length > 0) photoAttachmentId = e.attachments[0].id;

  const last = passport.editions.length > 0 ? passport.editions[passport.editions.length - 1] : null;
  const edition = last ? { number: last.number, name: last.name, issuedAt: last.issuedAt } : { number: 1, name: EDITION_NAMES[level], issuedAt: passport.createdAt };
  const { finish, foil } = finishOf(report, slabbed);

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
    quality: verifiedSpec ? 'verified' : specQuality(spec) ?? 'owner',
    illustrative: false,
    ruleset: RULESET,
  };
  return { asOf: day, stats, report, certification, rarity, card, condition, modifications, specificationAttested: verifiedSpec };
}

/**
 * Prints a new edition of the card when the vehicle has none yet, or its certification level or its rarity tier has
 * changed since the last one. Earlier editions are never touched. Returns the same passport when nothing changed.
 */
export function issueEdition(passport: Passport, registry: VerifierRegistry, ctx: { now: string; reason: string }): Passport {
  const a = assemble(passport, registry, ctx.now);
  const last = passport.editions.length > 0 ? passport.editions[passport.editions.length - 1] : null;
  if (last && last.level === a.certification.level && last.rarity === a.rarity.tier) return passport;
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
 * when the overall score, all five categories and the level equal the last snapshot's.
 */
export function recordSnapshot(passport: Passport, registry: VerifierRegistry, ctx: { now: string; id: string; reason: string }): Passport {
  const a = assemble(passport, registry, ctx.now);
  const last = passport.snapshots.length > 0 ? passport.snapshots[passport.snapshots.length - 1] : null;
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
    rarity: rarityOf({ productionUnits: spec.productionUnits, modelYear: spec.identity.year, asOf: day, level: 'registered', originality: 0, condition: 0, oneOfOneAttested: false }),
    edition: { number: 1, name: EDITION_NAMES.registered, issuedAt: `${entry.asOf}T00:00:00.000Z` },
    mods: [], finish: 'raw', foil: 0, quality: entry.status === 'illustrative' ? 'illustrative' : specQuality(spec) ?? 'reference', illustrative: entry.status === 'illustrative', ruleset: RULESET,
  };
}
