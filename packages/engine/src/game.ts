// The game engine: card races scored from the seven attributes. Five modes, each weighing the attributes that decide
// that kind of race, so every car has somewhere to win: a supercar takes the drag strip, an economy car the economy
// run, a truck the dirt. Nothing is equalised: the scores are the real ones.
// A race is decided by the entrants and a seed and nothing else, so any result can be replayed. The game reads
// attributes, drivetrain, ground clearance and class. It never reads a grade, a rarity or a market value.
import { ATTRIBUTE_LABELS } from './labels';
import { MOD_REFUSALS, applyModifications, modLabel, resolveModifications } from './modifications';
import { attributesOf, layerOf, scoreSpec } from './normalize';
import type { ActiveModification, AttributeKey, Drivetrain, ModCategory, ModTier, RaceEntrant, RaceMode, RaceResult, RaceRow, Result, StatLayer, StatsBasis, VehicleSpec } from './types';
import { ATTRIBUTE_KEYS, MOD_CATEGORIES, RACE_MODES } from './types';
import { clamp, hashString, mulberry32, round1 } from './util';

export type RaceModeRule = { name: string; blurb: string; weights: Partial<Record<AttributeKey, number>> };

/** What decides each race. The weights of a mode add up to 1. */
export const RACE_MODE_RULES: Record<RaceMode, RaceModeRule> = {
  drag: { name: 'Drag Race', blurb: 'A quarter mile from a standing start.', weights: { acceleration: 0.45, power: 0.35, speed: 0.2 } },
  circuit: { name: 'Circuit Race', blurb: 'Laps of a road course.', weights: { handling: 0.45, acceleration: 0.3, speed: 0.25 } },
  endurance: { name: 'Endurance', blurb: 'Hours at pace. The car that lasts wins.', weights: { reliability: 0.4, durability: 0.35, efficiency: 0.25 } },
  economy: { name: 'Economy Challenge', blurb: 'The longest distance on the least energy.', weights: { efficiency: 0.65, reliability: 0.35 } },
  offroad: { name: 'Off-Road', blurb: 'Dirt, rock and ruts.', weights: { durability: 0.4, handling: 0.3, reliability: 0.3 } },
};

/** The day's luck moves a score by at most this share, up or down. */
export const LUCK_SPREAD = 0.04;

/** Race classes by Power Rating, so like races like. */
export const RACE_CLASSES = [
  { id: 'D', name: 'Class D', min: 0 },
  { id: 'C', name: 'Class C', min: 450 },
  { id: 'B', name: 'Class B', min: 550 },
  { id: 'A', name: 'Class A', min: 650 },
  { id: 'S', name: 'Class S', min: 750 },
  { id: 'X', name: 'Class X', min: 850 },
] as const;
export type RaceClassId = (typeof RACE_CLASSES)[number]['id'];

/** The class a Power Rating races in; null for a vehicle with no rating yet. */
export function raceClassOf(powerRating: number | null): RaceClassId | null {
  if (powerRating === null) return null;
  let out: RaceClassId = 'D';
  for (const c of RACE_CLASSES) if (powerRating >= c.min) out = c.id;
  return out;
}

/**
 * Off-road, the surface favours driven wheels and ground clearance. These are real configuration, not balance.
 * With no drivetrain on file the lowest drivetrain factor is used, and with no ground clearance the lowest clearance
 * factor: a blank is read as the least favourable case, so it is never worth more than the figure.
 */
export const TERRAIN = {
  drivetrain: { '4WD': 1, AWD: 0.9, RWD: 0.72, FWD: 0.68 } as Record<Drivetrain, number>,
  clearance: { base: 0.8, pivotIn: 5, perIn: 0.04, min: 0.8, max: 1.05 },
};

/** The multiplier for surface and configuration: 1 on tarmac, drivetrain times clearance off-road. */
export function terrainFactor(mode: RaceMode, entrant: RaceEntrant): number {
  if (mode !== 'offroad') return 1;
  const d = TERRAIN.drivetrain;
  const drive = entrant.drivetrain === null ? Math.min(d['4WD'], d.AWD, d.RWD, d.FWD) : d[entrant.drivetrain];
  const c = TERRAIN.clearance;
  const clearance = entrant.groundClearanceIn === null ? c.min : clamp(c.base + (entrant.groundClearanceIn - c.pivotIn) * c.perIn, c.min, c.max);
  return Math.round(drive * clearance * 1000) / 1000;
}

/** Every reason an entrant can be left out of a race. The apps translate these. */
export const EXCLUSION_REASONS = {
  ranked: 'Ranked races run on verified stats',
  untrusted: 'Ranked races need a specification from the catalogue or one a verifier attested',
  twice: 'Entered twice',
  missing: {
    power: 'No Power rating', speed: 'No Speed rating', acceleration: 'No Acceleration rating', handling: 'No Handling rating',
    durability: 'No Durability rating', reliability: 'No Reliability rating', efficiency: 'No Efficiency rating',
  } as Record<AttributeKey, string>,
} as const;

/** The day's luck for one entrant in one race: a multiplier within the spread, the same whatever order the entrants are in. */
export function luckOf(seed: number, mode: RaceMode, id: string): number {
  const r = mulberry32(hashString(`${seed}|${mode}|${id}`))();
  return Math.round((1 + (r - 0.5) * 2 * LUCK_SPREAD) * 10000) / 10000;
}

/**
 * Runs one race. Deterministic: the same mode, entrants and seed give the same result in any entrant order.
 * A ranked race takes only entrants running on base or competition stats whose specification is trusted (the
 * catalogue's own, or one a verifier attested): figures an owner typed in cannot win a ranked race.
 */
export function race(mode: RaceMode, entrants: readonly RaceEntrant[], seed: number, options: { ranked?: boolean } = {}): RaceResult {
  const weights = RACE_MODE_RULES[mode].weights;
  const needed = ATTRIBUTE_KEYS.filter((k) => weights[k] !== undefined);
  const rows: RaceRow[] = [];
  const excluded: RaceResult['excluded'] = [];
  const entered: Record<string, number> = {};
  for (const e of entrants) entered[`#${e.id}`] = (entered[`#${e.id}`] ?? 0) + 1;
  // An id entered more than once starts nobody: there is no telling which entry was meant, and choosing by the
  // order they arrived in would make the result depend on it.
  const ordered = entrants.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of ordered) {
    if (entered[`#${e.id}`] > 1) { excluded.push({ id: e.id, name: e.name, reason: EXCLUSION_REASONS.twice }); continue; }
    if (options.ranked && (e.basis === 'vehicle' || e.basis === 'setup')) { excluded.push({ id: e.id, name: e.name, reason: EXCLUSION_REASONS.ranked }); continue; }
    if (options.ranked && e.trusted !== true) { excluded.push({ id: e.id, name: e.name, reason: EXCLUSION_REASONS.untrusted }); continue; }
    const lacking = needed.filter((k) => e.attributes[k] === null);
    if (lacking.length > 0) { excluded.push({ id: e.id, name: e.name, reason: EXCLUSION_REASONS.missing[lacking[0]] }); continue; }
    const contributions: Partial<Record<AttributeKey, number>> = {};
    let raw = 0;
    for (const k of needed) {
      const part = (e.attributes[k] as number) * (weights[k] as number);
      contributions[k] = round1(part);
      raw += part;
    }
    const terrain = terrainFactor(mode, e);
    const luck = luckOf(seed, mode, e.id);
    rows.push({ id: e.id, name: e.name, position: 0, score: round1(raw * terrain * luck), rawScore: round1(raw), terrain, luck, contributions });
  }
  rows.sort((a, b) => b.score - a.score || b.rawScore - a.rawScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rows.forEach((r, i) => { r.position = i + 1; });
  const decided = rows.length >= 2;
  return { mode, seed, rows, winnerId: decided ? rows[0].id : null, margin: decided ? round1(rows[0].score - rows[1].score) : 0, excluded };
}

/** Points for first to sixth place in a series. */
export const SERIES_POINTS: readonly number[] = [10, 6, 4, 3, 2, 1];
export type SeriesResult = { seed: number; races: RaceResult[]; standings: { id: string; name: string; points: number; wins: number; total: number }[]; championId: string | null };

/**
 * A series: every mode once (or the modes given), points by finishing place. The same field, five different tests.
 * Only a race that was decided (two or more starters) awards points, so nobody wins a series on races run alone.
 */
export function series(entrants: readonly RaceEntrant[], seed: number, options: { modes?: readonly RaceMode[]; ranked?: boolean } = {}): SeriesResult {
  const modes = options.modes ?? RACE_MODES;
  const races = modes.map((mode, i) => race(mode, entrants, seed + i, { ranked: options.ranked }));
  const table: Record<string, { id: string; name: string; points: number; wins: number; total: number }> = {};
  for (const r of races) {
    // A race only one car could start was not a race: it awards nothing.
    if (r.winnerId === null) continue;
    for (const row of r.rows) {
      const line = table[row.id] ?? (table[row.id] = { id: row.id, name: row.name, points: 0, wins: 0, total: 0 });
      line.points += row.position <= SERIES_POINTS.length ? SERIES_POINTS[row.position - 1] : 0;
      line.total = round1(line.total + row.score);
      if (r.winnerId === row.id) line.wins += 1;
    }
  }
  const standings = Object.keys(table).map((id) => table[id]).sort((a, b) => b.points - a.points || b.wins - a.wins || b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { seed, races, standings, championId: races.some((r) => r.winnerId !== null) && standings.length > 0 ? standings[0].id : null };
}

/**
 * A race entry from a vehicle's specification and one layer of its stats. Pass `trusted: true` only for a catalogue
 * entry or a passport whose specification a verifier has attested; it is false unless said.
 */
export function entrantFromLayer(input: { id: string; name: string; spec: VehicleSpec; layer: StatLayer; basis: StatsBasis; trusted?: boolean }): RaceEntrant {
  const { spec, layer } = input;
  return {
    id: input.id, name: input.name, attributes: attributesOf(layer.scores), powerRating: layer.powerRating, bodyClass: spec.identity.bodyClass,
    drivetrain: spec.drivetrain ? spec.drivetrain.value : null, groundClearanceIn: spec.groundClearanceIn ? spec.groundClearanceIn.value : null, basis: input.basis,
    trusted: input.trusted === true,
  };
}

/* ---------------------------------------------------------------- setup cards ---- */

/** A modification as a card a player can add to a setup for free play. It is the card face of the one catalogue. */
export type SetupCard = { id: string; category: ModCategory; tier: ModTier; name: string; cost: number };
/** What a setup may cost in total. A card costs its tier: Street 1, Pro 2, Extreme 3. */
export const SETUP_BUDGET = 6;
const TIERS: readonly ModTier[] = [1, 2, 3];
export const SETUP_CARDS: readonly SetupCard[] = MOD_CATEGORIES.reduce<SetupCard[]>((all, category) => all.concat(TIERS.map((tier) => ({ id: `${category}:${tier}`, category, tier, name: modLabel(category, tier), cost: tier }))), []);

export const SETUP_REFUSALS = {
  unknown: 'No such setup card',
  category: 'One card per category',
  budget: 'The setup costs more than the budget',
  electric: 'One of those cards is not for an electric powertrain',
  powertrain: 'One of those cards needs the powertrain on file',
  together: 'Two of those cards cannot be fitted together',
} as const;

const asModification = (card: SetupCard, order: number): ActiveModification => ({
  // Dated in order so that, within a group where only the latest fitment counts, the later card in the setup wins.
  eventId: `setup:${card.id}`, category: card.category, tier: card.tier, install: 'professional', evidence: 'declared',
  installedOn: `2000-01-${order + 1 < 10 ? '0' : ''}${order + 1}`, installedAtMileage: null, upkeep: 'recent',
});

/** Checks a setup: every card exists, one per category, within the budget, and nothing the vehicle cannot take. */
export function checkSetup(spec: VehicleSpec, cardIds: readonly string[]): Result<SetupCard[]> {
  const cards: SetupCard[] = [];
  let cost = 0;
  for (const id of cardIds) {
    const card = SETUP_CARDS.filter((c) => c.id === id)[0];
    if (!card) return { ok: false, reason: SETUP_REFUSALS.unknown };
    if (cards.some((c) => c.category === card.category)) return { ok: false, reason: SETUP_REFUSALS.category };
    cards.push(card);
    cost += card.cost;
  }
  if (cost > SETUP_BUDGET) return { ok: false, reason: SETUP_REFUSALS.budget };
  const { refused } = resolveModifications(spec, cards.map(asModification));
  if (refused.length > 0) {
    const why = refused[0].reason;
    return { ok: false, reason: why === MOD_REFUSALS.notElectric ? SETUP_REFUSALS.electric : why === MOD_REFUSALS.noPowertrain ? SETUP_REFUSALS.powertrain : SETUP_REFUSALS.together };
  }
  return { ok: true, value: cards };
}

/** A free-play entry: the factory specification with a setup of cards applied through the modification engine. */
export function entrantWithSetup(input: { id: string; name: string; spec: VehicleSpec; cardIds: readonly string[]; trusted?: boolean }): Result<RaceEntrant> {
  const checked = checkSetup(input.spec, input.cardIds);
  if (!checked.ok) return checked;
  const modified = applyModifications(input.spec, checked.value.map(asModification));
  const layer = layerOf(scoreSpec(modified.spec, { adjust: modified.adjust, derived: modified.changed }));
  return { ok: true, value: entrantFromLayer({ id: input.id, name: input.name, spec: modified.spec, layer, basis: 'setup', trusted: input.trusted }) };
}

/** Picks rivals for a player from a pool: the same class first, then the nearest by Power Rating, chosen with the seed. */
export function pickRivals(player: RaceEntrant, pool: readonly RaceEntrant[], count: number, seed: number): RaceEntrant[] {
  const others = pool.filter((e) => e.id !== player.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cls = raceClassOf(player.powerRating);
  const same = others.filter((e) => cls !== null && raceClassOf(e.powerRating) === cls);
  const rand = mulberry32((seed ^ hashString(player.id)) >>> 0);
  for (let i = same.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = same[i]; same[i] = same[j]; same[j] = swap;
  }
  const picked = same.slice(0, Math.max(0, count));
  if (picked.length < count) {
    const target = player.powerRating ?? 0;
    const rest = others.filter((e) => picked.indexOf(e) === -1)
      .sort((a, b) => Math.abs((a.powerRating ?? -9999) - target) - Math.abs((b.powerRating ?? -9999) - target) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const e of rest) { if (picked.length >= count) break; picked.push(e); }
  }
  return picked;
}

/** The label for an attribute in a result table. */
export const attributeLabel = (key: AttributeKey): string => ATTRIBUTE_LABELS[key];
