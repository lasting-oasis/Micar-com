// Verification: who may say a claim is true, and what follows from it.
// A claim about a vehicle is declared (the owner says so), documented (the owner attached a file) or verified (an
// independent verifier attested it). Nothing an owner can do alone reaches verified: uploading a photograph or a
// receipt documents a claim and stops there. An attestation counts only when its verifier is in the registry the
// host supplies, is active, is allowed that kind of attestation, and has never owned the vehicle.
// This module is the only way an attestation enters a passport, and the only place that decides whether one counts.
// It also builds the public view, because what the public may be told depends on what has been verified.
//
// What a passport file can and cannot prove. A passport kept on its owner's device is the owner's to edit, so:
//   - with a signature checker in the registry, every attestation that counts is one its verifier really signed, for
//     this vehicle, saying exactly this, about records that have not been touched since;
//   - without one, the host is vouching for where the passport is kept;
//   - either way a holder can leave things out (a poor inspection, a withdrawal). Only a store the owner cannot
//     write to can prove nothing is missing.
import { EVENT_TYPE_LABELS, appendEvent, checkAttestation, currentOwner, everOwned, isId, timeline } from './passport';
import type {
  ActiveModification, AttachmentKind, Attestation, AttestationScope, ConditionInputs, EvidenceLevel, Passport, PassportEvent, PublicEvent, PublicPassport, Result, Verifier,
  VerifierRegistry, WearSystem,
} from './types';
import { WEAR_SYSTEMS } from './types';
import { canonicalJson, clipText, dayOf, isIsoTimestamp, monthOf, monthsBetween, sha256Text } from './util';

/** The registry with nobody in it. With it, nothing can be verified. */
export const EMPTY_REGISTRY: VerifierRegistry = { verifiers: [] };

/** How many months an attestation stays good, by what it attests. Null means it does not lapse. */
export const ATTESTATION_VALID_MONTHS: Record<AttestationScope, number | null> = {
  identity: null, specification: null, 'one-of-one': null, mileage: 12, documentation: 24, originality: 24, modification: 24, condition: 24,
};
/** A condition inspection counts in full for this many months, and at half weight after that until it lapses. */
export const CONDITION_FULL_MONTHS = 12;
/** An owner's reading taken the same day as a mileage attestation is verified when it is within this many miles of the attested figure. */
export const MILEAGE_TOLERANCE = 100;

/** What each kind of attestation is about, in a word or two. The apps translate these. */
export const ATTESTATION_SCOPE_LABELS: Record<AttestationScope, string> = {
  identity: 'Identity', mileage: 'Mileage', documentation: 'Records', condition: 'Condition', originality: 'Originality',
  modification: 'Modifications', specification: 'Specification', 'one-of-one': 'One of one',
};

/** Every reason an attestation is refused or does not count. The apps translate these. */
export const VERIFICATION_REFUSALS = {
  shape: 'That is not an attestation',
  unknown: 'The verifier is not registered',
  inactive: 'The verifier is not active',
  scope: 'The verifier may not attest this',
  owner: 'An owner cannot verify their own vehicle',
  author: 'The attestation was not written by its verifier',
  future: 'The attestation is dated in the future',
  lapsed: 'The attestation is out of date',
  withdrawn: 'The attestation was withdrawn',
  changed: 'What was attested has changed since',
  signature: 'The signature does not check',
  id: 'An attestation needs an ID of its own',
  timestamp: 'The time is not a timestamp',
  detail: 'The attestation is missing what it attests',
  records: 'The attestation names a record that is not on this passport',
  target: 'There is no such record to withdraw',
  authority: 'A record can be withdrawn only by a verifier with a valid records attestation',
  notYours: 'An attestation can be withdrawn only by the verifier who made it',
} as const;

export type AttestationStatus = {
  /** The passport event that carries the attestation. */
  eventId: string;
  attestation: Attestation;
  valid: boolean;
  /** 1 in full, 0.5 for a condition inspection past its first year, 0 when it does not count. */
  weight: number;
  /** Why it does not count; '' when it does. */
  reason: string;
};

type AttestationEvent = Extract<PassportEvent, { type: 'attestation' }>;
type Verdict = { valid: boolean; weight: number; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const no = (reason: string): Verdict => ({ valid: false, weight: 0, reason });
const findVerifier = (registry: VerifierRegistry, id: string): Verifier | null => {
  const list = registry && Array.isArray(registry.verifiers) ? registry.verifiers : [];
  return list.filter((v) => v && v.id === id)[0] ?? null;
};
const attestationEvent = (passport: Passport, attestationId: string): AttestationEvent | null => {
  for (const e of passport.events) if (e.type === 'attestation' && e.attestation.id === attestationId) return e;
  return null;
};

/* ------------------------------------------------------- what an attestation is about ---- */

/**
 * The part of the passport an attestation of this scope speaks for, as text; '' when the scope speaks for none.
 * Identity and one-of-one speak for the VIN and the year, make and model. Specification speaks for the whole
 * factory specification. The others are bound by the records they name, the figure they carry, or their date.
 */
export function attestationSubject(passport: Passport, scope: AttestationScope): string {
  const id = passport.spec.identity;
  if (scope === 'identity' || scope === 'one-of-one') return canonicalJson([passport.vin, id.year, id.make, id.model]);
  if (scope === 'specification') return canonicalJson(passport.spec);
  return '';
}

/**
 * The fingerprint an attestation keeps of its subject: the SHA-256 of the subject's text, or null when the scope has
 * no subject. It is a full-strength hash on purpose: an owner cannot go looking for a different specification, or a
 * different VIN, that happens to share it.
 */
export function subjectFingerprint(passport: Passport, scope: AttestationScope): string | null {
  const subject = attestationSubject(passport, scope);
  return subject === '' ? null : sha256Text(subject);
}

/** The first line of every payload. A change to what is signed changes this. */
export const ATTESTATION_PAYLOAD = 'micar-attestation-v1';

/**
 * The exact text a verifier signs: the vehicle's MiCar ID, everything the attestation says, the part of the passport
 * it speaks for, and every record it names exactly as the passport holds it. A signature over this text cannot be
 * moved to another vehicle, and stops checking the moment the attestation, its subject or a record it confirmed is
 * altered. The stored fingerprint and the signature itself are not part of it.
 */
export function attestationPayload(passport: Passport, attestation: Attestation): string {
  const a = attestation;
  const systems: (readonly [WearSystem, number])[] = [];
  if (a.systems !== null) for (const system of WEAR_SYSTEMS) { const wear = a.systems[system]; if (wear !== undefined) systems.push([system, wear]); }
  const named = a.events.slice().sort().map((id) => {
    const record = passport.events.filter((e) => e.id === id)[0];
    return [id, record ? canonicalJson(record) : null];
  });
  return canonicalJson([
    ATTESTATION_PAYLOAD, passport.micarId, a.id, a.verifierId, a.scope, a.date, a.inPerson, a.conditionScore, a.systems === null ? null : systems, a.mileage, named, a.note,
    attestationSubject(passport, a.scope),
  ]);
}

/** True when an attestation lacks the thing its scope attests: a reading, a score, or the records it confirms. */
const lacksDetail = (a: Attestation): boolean =>
  (a.scope === 'mileage' && a.mileage === null) || (a.scope === 'condition' && a.conditionScore === null) || ((a.scope === 'documentation' || a.scope === 'modification') && a.events.length === 0);

/** The reading an attestation's entry carries: the attested figure for a mileage attestation, none otherwise. */
const readingOf = (a: Attestation): number | null => (a.scope === 'mileage' ? a.mileage : null);

/**
 * Whether one attestation stands on a day, leaving withdrawals aside. `entry` is the passport entry that carries it:
 * its author, day and reading must be the attestation's own, so nothing can be claimed by dressing the entry up.
 */
function judge(passport: Passport, entry: { by: string; date: string; mileage: number | null }, a: Attestation, registry: VerifierRegistry, day: string): Verdict {
  const verifier = findVerifier(registry, a.verifierId);
  if (!verifier) return no(VERIFICATION_REFUSALS.unknown);
  if (verifier.active !== true) return no(VERIFICATION_REFUSALS.inactive);
  if (!Array.isArray(verifier.scopes) || verifier.scopes.indexOf(a.scope) === -1) return no(VERIFICATION_REFUSALS.scope);
  if (everOwned(passport, a.verifierId)) return no(VERIFICATION_REFUSALS.owner);
  if (entry.by !== a.verifierId) return no(VERIFICATION_REFUSALS.author);
  if (entry.date !== a.date || entry.mileage !== readingOf(a)) return no(VERIFICATION_REFUSALS.shape);
  if (lacksDetail(a)) return no(VERIFICATION_REFUSALS.detail);
  if (a.date > day) return no(VERIFICATION_REFUSALS.future);
  const limit = ATTESTATION_VALID_MONTHS[a.scope];
  const age = monthsBetween(a.date, day);
  if (limit !== null && age >= limit) return no(VERIFICATION_REFUSALS.lapsed);
  if (a.subject !== subjectFingerprint(passport, a.scope)) return no(VERIFICATION_REFUSALS.changed);
  const check = registry ? registry.checkSignature : undefined;
  if (typeof check === 'function') {
    let good = false;
    if (a.signature !== null) {
      try { good = check(attestationPayload(passport, a), a.signature, verifier) === true; } catch { good = false; }
    }
    if (!good) return no(VERIFICATION_REFUSALS.signature);
  }
  return { valid: true, weight: a.scope === 'condition' && age >= CONDITION_FULL_MONTHS ? 0.5 : 1, reason: '' };
}

/**
 * The ids of what verifiers have withdrawn, as of a day, in the order the withdrawals were written.
 * An attestation is taken back only by its own verifier. A record is withdrawn by a verifier whose records
 * attestation counted on the day of the withdrawal and had not itself been taken back; the withdrawal then stands
 * for good, whatever later becomes of that attestation, unless the verifier leaves the registry.
 */
function standingVoids(passport: Passport, registry: VerifierRegistry, day: string): string[] {
  const out: string[] = [];
  for (const e of passport.events) {
    if (e.type !== 'void' || e.date > day || out.indexOf(e.target) !== -1) continue;
    const target = passport.events.filter((t) => t.id === e.target)[0];
    if (!target || target.type === 'registered' || target.type === 'transfer' || target.type === 'void') continue;
    const authority = attestationEvent(passport, e.attestationId);
    if (!authority || authority.attestation.verifierId !== e.by) continue;
    if (target.type === 'attestation') {
      const verifier = findVerifier(registry, e.by);
      if (authority.id === target.id && verifier !== null && verifier.active === true) out.push(e.target);
      continue;
    }
    if (authority.attestation.scope !== 'documentation' || out.indexOf(authority.id) !== -1) continue;
    if (judge(passport, authority, authority.attestation, registry, e.date).valid) out.push(e.target);
  }
  return out;
}

/* ------------------------------------------------------------------- standing ---- */

/** Everything about a passport's standing on one day, worked out once and shared by the queries below. */
export type Standing = {
  /** YYYY-MM-DD */
  day: string;
  /** Every attestation on the passport with whether it counts, and why not when it does not. */
  statuses: AttestationStatus[];
  /** The attestations that count. */
  attestations: AttestationStatus[];
  /** The ids of the records and attestations that verifiers have withdrawn. */
  voided: string[];
  /** What stands, in timeline order: dated on or before the day, not withdrawn, and, for an attestation, one that counts. */
  events: PassportEvent[];
};

/**
 * Works out a passport's standing on a day. Every query below takes the passport, the registry and the day, and
 * accepts a standing already worked out for them as a last argument, so a caller asking several things (or a host
 * whose signature check is slow) does the work once.
 */
export function standingOf(passport: Passport, registry: VerifierRegistry, asOf: string): Standing {
  const day = dayOf(asOf);
  const ordered = timeline(passport);
  const voided = standingVoids(passport, registry, day);
  const statuses: AttestationStatus[] = [];
  for (const e of ordered) {
    if (e.type !== 'attestation') continue;
    const verdict = judge(passport, e, e.attestation, registry, day);
    statuses.push({ eventId: e.id, attestation: e.attestation, ...(verdict.valid && voided.indexOf(e.id) !== -1 ? no(VERIFICATION_REFUSALS.withdrawn) : verdict) });
  }
  const attestations = statuses.filter((s) => s.valid && s.weight > 0);
  const events = ordered.filter((e) => e.date <= day && e.type !== 'void' && voided.indexOf(e.id) === -1 && (e.type !== 'attestation' || attestations.some((s) => s.eventId === e.id)));
  return { day, statuses, attestations, voided, events };
}

/** Every attestation on the passport with whether it counts on a day, and why not when it does not. */
export function attestationStatuses(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): AttestationStatus[] {
  return standing.statuses;
}

/** The attestations that count on a day, optionally of one scope. */
export function validAttestations(passport: Passport, registry: VerifierRegistry, asOf: string, scope?: AttestationScope, standing: Standing = standingOf(passport, registry, asOf)): AttestationStatus[] {
  return scope === undefined ? standing.attestations : standing.attestations.filter((s) => s.attestation.scope === scope);
}

/** The ids of the records and attestations verifiers have withdrawn, as of a day. */
export function voidedEventIds(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): string[] {
  return standing.voided;
}

/* --------------------------------------------------------------------- writing ---- */

/**
 * Records a verifier's attestation. This is the only way one enters a passport. Refused, with nothing changed, when
 * it is not an attestation, lacks what its scope attests (a mileage attestation needs the reading, a condition one
 * the score, a records or modifications one the entries it confirms, which must be on the passport), or would not
 * count on the day it is recorded: an unknown or inactive verifier, a scope the verifier may not attest, a verifier
 * who owns or has owned the vehicle, a date in the future, one already lapsed, or a signature the registry's checker
 * does not accept. The engine notes what was attested as it stands now, so a later change to it is noticed.
 */
export function recordAttestation(passport: Passport, attestation: unknown, registry: VerifierRegistry, ctx: { now: string; eventId: string }): Result<Passport> {
  if (!ctx || !isIsoTimestamp(ctx.now)) return refuse(VERIFICATION_REFUSALS.timestamp);
  if (!isId(ctx.eventId, 40) || passport.events.some((e) => e.id === ctx.eventId)) return refuse(VERIFICATION_REFUSALS.id);
  const read = checkAttestation(attestation);
  if (!read) return refuse(VERIFICATION_REFUSALS.shape);
  const a: Attestation = { ...read, subject: subjectFingerprint(passport, read.scope) };
  if (passport.events.some((e) => e.type === 'attestation' && e.attestation.id === a.id)) return refuse(VERIFICATION_REFUSALS.id);
  if (lacksDetail(a)) return refuse(VERIFICATION_REFUSALS.detail);
  for (const id of a.events) {
    const record = passport.events.filter((e) => e.id === id)[0];
    // A records attestation confirms an owner's entries; a modifications one confirms modification entries.
    const fits = record !== undefined && record.type !== 'attestation' && record.type !== 'void' && (a.scope !== 'modification' || record.type === 'modification');
    if (!fits) return refuse(VERIFICATION_REFUSALS.records);
  }
  const entry = { by: a.verifierId, date: a.date, mileage: readingOf(a) };
  const verdict = judge(passport, entry, a, registry, dayOf(ctx.now));
  if (!verdict.valid) return refuse(verdict.reason);
  return {
    ok: true,
    value: appendEvent(passport, {
      id: ctx.eventId, date: entry.date, recordedAt: ctx.now, by: entry.by, mileage: entry.mileage, title: EVENT_TYPE_LABELS.attestation, note: '', attachments: [],
      visibility: 'private', type: 'attestation', attestation: a,
    }),
  };
}

/**
 * Withdraws something from the passport's standing. It stays on the passport and simply no longer counts.
 * A record (a receipt that proved false) is withdrawn by a verifier holding a records attestation that counts today:
 * `attestationId` names it. An attestation made in error is taken back by its own verifier: `attestationId` is its id.
 */
export function voidEvent(passport: Passport, input: { target: string; reason: string; attestationId: string }, registry: VerifierRegistry, ctx: { now: string; eventId: string }): Result<Passport> {
  if (!ctx || !isIsoTimestamp(ctx.now)) return refuse(VERIFICATION_REFUSALS.timestamp);
  if (!isId(ctx.eventId, 40) || passport.events.some((e) => e.id === ctx.eventId)) return refuse(VERIFICATION_REFUSALS.id);
  if (!input || !isId(input.target, 40) || !isId(input.attestationId, 40)) return refuse(VERIFICATION_REFUSALS.shape);
  const target = passport.events.filter((e) => e.id === input.target)[0];
  if (!target || target.type === 'registered' || target.type === 'transfer' || target.type === 'void') return refuse(VERIFICATION_REFUSALS.target);
  const day = dayOf(ctx.now);
  const standing = standingOf(passport, registry, day);
  if (standing.voided.indexOf(target.id) !== -1) return refuse(VERIFICATION_REFUSALS.target);
  const authority = attestationEvent(passport, input.attestationId);
  if (!authority) return refuse(VERIFICATION_REFUSALS.authority);
  const by = authority.attestation.verifierId;
  if (target.type === 'attestation') {
    if (authority.id !== target.id) return refuse(VERIFICATION_REFUSALS.notYours);
    const verifier = findVerifier(registry, by);
    if (!verifier) return refuse(VERIFICATION_REFUSALS.unknown);
    if (verifier.active !== true) return refuse(VERIFICATION_REFUSALS.inactive);
  } else if (!standing.attestations.some((s) => s.eventId === authority.id && s.attestation.scope === 'documentation')) {
    return refuse(VERIFICATION_REFUSALS.authority);
  }
  return {
    ok: true,
    value: appendEvent(passport, {
      id: ctx.eventId, date: day, recordedAt: ctx.now, by, mileage: null, title: EVENT_TYPE_LABELS.void, note: '', attachments: [],
      visibility: 'private', type: 'void', target: input.target, reason: clipText(input.reason, 300), attestationId: input.attestationId,
    }),
  };
}

/* --------------------------------------------------------------------- evidence ---- */

/** How much stands behind an entry as a record: verified only when it is an attestation that counts, or one names it. */
function recordEvidence(event: PassportEvent, standing: Standing): EvidenceLevel {
  if (event.type === 'attestation') return 'verified';
  for (const s of standing.attestations) {
    const a = s.attestation;
    const speaksFor = a.scope === 'documentation' || (a.scope === 'modification' && event.type === 'modification');
    if (speaksFor && a.events.indexOf(event.id) !== -1) return 'verified';
  }
  return event.attachments.length > 0 ? 'documented' : 'declared';
}

/**
 * How much stands behind an entry's odometer reading. A verifier's own reading is verified, and so is the reading of
 * a record a verifier confirmed. An owner's reading is verified only when it was taken the same day as a mileage
 * attestation and agrees with it. An old entry that happens to show a similar figure is not.
 */
function readingEvidence(event: PassportEvent, standing: Standing): EvidenceLevel {
  const record = recordEvidence(event, standing);
  if (record === 'verified' || event.mileage === null) return record;
  for (const s of standing.attestations) {
    const a = s.attestation;
    if (a.scope === 'mileage' && a.mileage !== null && event.date === a.date && Math.abs(event.mileage - a.mileage) <= MILEAGE_TOLERANCE) return 'verified';
  }
  return record;
}

/**
 * How much stands behind one entry on a day: verified only through an attestation that counts and names it;
 * documented when the entry has a file; declared otherwise. An entry that was withdrawn, is dated later than the
 * day, or is not on the passport is declared: it has no standing.
 */
export function eventEvidence(passport: Passport, eventId: string, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): EvidenceLevel {
  const event = standing.events.filter((e) => e.id === eventId)[0];
  return event ? recordEvidence(event, standing) : 'declared';
}

/** The odometer readings that stand on a day, in timeline order, each with how well it is evidenced. */
export function standingReadings(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): { date: string; mileage: number; eventId: string; evidence: EvidenceLevel }[] {
  const out: { date: string; mileage: number; eventId: string; evidence: EvidenceLevel }[] = [];
  for (const e of standing.events) if (e.mileage !== null) out.push({ date: e.date, mileage: e.mileage, eventId: e.id, evidence: readingEvidence(e, standing) });
  return out;
}

const RECORD_TYPES: readonly PassportEvent['type'][] = ['maintenance', 'repair', 'inspection', 'restoration', 'modification', 'document'];

/**
 * The records that count toward the trail: maintenance, repairs, inspections, restorations, modifications and
 * documents that still stand and have a file of their own. The same file attached to several records documents one
 * of them: copies are told apart by fingerprint, and a record whose every file was already counted on an earlier
 * record is left out. A file with no fingerprint cannot be compared, so it counts.
 */
export function documentedRecords(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): PassportEvent[] {
  const seen: Record<string, true> = {};
  const out: PassportEvent[] = [];
  for (const e of standing.events) {
    if (RECORD_TYPES.indexOf(e.type) === -1 || e.attachments.length === 0) continue;
    const own = e.attachments.some((a) => a.sha256 === null || seen[a.sha256] !== true);
    for (const a of e.attachments) if (a.sha256 !== null) seen[a.sha256] = true;
    if (own) out.push(e);
  }
  return out;
}

/** The modifications fitted on a day: installs that stand and that no standing removal undoes, each with its evidence and upkeep. */
export function activeModifications(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ActiveModification[] {
  const removed: string[] = [];
  for (const e of standing.events) if (e.type === 'modification' && e.action === 'remove' && e.undoes !== null) removed.push(e.undoes);
  const out: ActiveModification[] = [];
  for (const e of standing.events) {
    if (e.type !== 'modification' || e.action !== 'install' || removed.indexOf(e.id) !== -1) continue;
    const kept = standing.events.some((m) => m.type === 'maintenance' && m.attachments.length > 0 && m.date > e.date && monthsBetween(m.date, standing.day) < 12);
    out.push({
      eventId: e.id, category: e.category, tier: e.tier, install: e.install, evidence: recordEvidence(e, standing), installedOn: e.date, installedAtMileage: e.mileage,
      upkeep: kept ? 'documented' : monthsBetween(e.date, standing.day) < 12 ? 'recent' : 'lapsed',
    });
  }
  return out;
}

/** What the condition engine needs, read from the passport as it stands on a day. */
export function conditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ConditionInputs {
  let mileage: ConditionInputs['mileage'] = null;
  const replacements: ConditionInputs['replacements'] = [];
  const inspections: ConditionInputs['inspections'] = [];
  const declared: { accident: ConditionInputs['accident']; titleStatus: ConditionInputs['titleStatus'] } = { accident: null, titleStatus: null };
  for (const e of standing.events) {
    if (e.mileage !== null) mileage = { value: e.mileage, evidence: readingEvidence(e, standing) };
    if (e.type === 'repair' && e.system !== null && (e.work === 'replacement' || e.work === 'rebuild')) replacements.push({ system: e.system, date: e.date, mileage: e.mileage, evidence: recordEvidence(e, standing) });
    if (e.type === 'declaration') {
      if (e.accident !== null) declared.accident = e.accident;
      if (e.titleStatus !== null) declared.titleStatus = e.titleStatus;
    }
  }
  for (const s of standing.attestations) {
    const a = s.attestation;
    if (a.scope !== 'condition' || a.systems === null) continue;
    const systems: Partial<Record<WearSystem, number>> = { ...a.systems };
    inspections.push({ date: a.date, systems });
  }
  const spec = passport.spec;
  return { asOf: standing.day, modelYear: spec.identity.year, powertrain: spec.powertrain ? spec.powertrain.value : null, mileage, replacements, inspections, accident: declared.accident, titleStatus: declared.titleStatus };
}

/**
 * What the condition engine may know for ranked play: verified inputs and nothing else. The newest reading a
 * verifier took or confirmed (a later reading the owner typed does not replace it), the replacements a verifier
 * confirmed (a receipt alone resets nothing here), and inspectors' readings. Declared accidents and titles are left
 * out. Because nothing an owner writes is in this list, nothing an owner writes can move a ranked score, up or down.
 */
export function competitionConditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ConditionInputs {
  const all = conditionInputs(passport, registry, asOf, standing);
  let mileage: ConditionInputs['mileage'] = null;
  for (const e of standing.events) if (e.mileage !== null && readingEvidence(e, standing) === 'verified') mileage = { value: e.mileage, evidence: 'verified' };
  return { ...all, mileage, replacements: all.replacements.filter((r) => r.evidence === 'verified'), accident: null, titleStatus: null };
}

/* ------------------------------------------------------------ the public view ---- */

/**
 * What anyone may be shown of a passport. It is the only projection meant to leave the owner's device.
 * Left out entirely: the VIN (only whether one is on file), every owner's id, every file's name, id and fingerprint,
 * every note, cost, shop and inspector, the specification's sources, what an attestation said, and anything withdrawn.
 * Blurred: a day becomes its month (for entries, grade snapshots and card editions alike, so a snapshot cannot give
 * away the day of the entry that caused it), and a reading is rounded down to the thousand. A title is shown only
 * when the owner marked that entry public; otherwise the entry carries the plain name of its kind.
 */
export function publicPassport(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): PublicPassport {
  const events: PublicEvent[] = standing.events.map((e) => {
    const attachments: Partial<Record<AttachmentKind, number>> = {};
    for (const a of e.attachments) attachments[a.kind] = (attachments[a.kind] ?? 0) + 1;
    const own = e.type !== 'attestation' && e.visibility === 'public' && e.title !== '';
    return {
      type: e.type, month: monthOf(e.date), title: own ? e.title : EVENT_TYPE_LABELS[e.type], mileage: e.mileage === null ? null : Math.floor(e.mileage / 1000) * 1000, attachments,
      verified: recordEvidence(e, standing) === 'verified', scope: e.type === 'attestation' ? e.attestation.scope : null,
    };
  });
  const owner = currentOwner(passport);
  const since = passport.owners.filter((o) => o.ownerId === owner && o.to === null)[0];
  const id = passport.spec.identity;
  return {
    micarId: passport.micarId,
    createdMonth: monthOf(passport.createdAt),
    identity: { year: id.year, make: id.make, model: id.model, trim: id.trim, bodyClass: id.bodyClass },
    color: passport.color,
    vinOnFile: passport.vin !== '',
    ownerCount: passport.owners.length,
    currentOwnerSince: since ? monthOf(since.from) : monthOf(passport.createdAt),
    events,
    snapshots: passport.snapshots.map((s) => ({ month: monthOf(s.asOf), formula: s.formula, overall: s.overall, grade10: s.grade10, tier: s.tier, categories: { ...s.categories }, level: s.level })),
    editions: passport.editions.map((e) => ({
      number: e.number, name: e.name, month: monthOf(e.issuedAt), level: e.level, rarity: e.rarity, finish: e.finish, grade10: e.grade10, powerRating: e.powerRating, attributes: { ...e.attributes },
    })),
  };
}
