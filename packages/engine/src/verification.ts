// Verification: who may say a claim is true, and what follows from it.
// A claim about a vehicle is declared (the owner says so), documented (the owner attached a file) or verified (an
// independent verifier attested it). Nothing an owner can do alone reaches verified: uploading a photograph or a
// receipt documents a claim and stops there. An attestation counts only when its verifier is in the registry the
// host supplies, is active, is allowed that kind of attestation, and has never owned the vehicle.
// This module is the only way an attestation enters a passport, and the only place that decides whether one counts.
// What the public may be shown of a passport is built in public.ts, from the standing worked out here.
//
// What a passport file can and cannot prove. A passport kept on its owner's device is the owner's to edit, so:
//   - with a signature checker in the registry, every attestation that counts is one its verifier really signed, for
//     this vehicle, saying exactly this, about records that have not been touched since;
//   - without one, the host is vouching for where the passport is kept;
//   - either way a holder can leave things out (a poor inspection, a withdrawal). Only a store the owner cannot
//     write to can prove nothing is missing.
import { EVENT_TYPE_LABELS, MAX_EVENTS, PASSPORT_REFUSALS, appendEvent, checkAttestation, everOwned, isId, timeline } from './passport';
import type {
  ActiveModification, Attestation, AttestationScope, ConditionInputs, EvidenceLevel, Passport, PassportEvent, Result, Verifier,
  VerifierRegistry, WearSystem,
} from './types';
import { EVIDENCE_ORDER, WEAR_SYSTEMS } from './types';
import { canonicalJson, clipText, dayOf, isIsoTimestamp, monthsBetween, sha256Text } from './util';

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
  full: PASSPORT_REFUSALS.full,
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
 * The checks run in a fixed order and the first that fails is the reason given; its age is the last of them.
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
  if (a.subject !== subjectFingerprint(passport, a.scope)) return no(VERIFICATION_REFUSALS.changed);
  const check = registry ? registry.checkSignature : undefined;
  if (typeof check === 'function') {
    let good = false;
    if (a.signature !== null) {
      try { good = check(attestationPayload(passport, a), a.signature, verifier) === true; } catch { good = false; }
    }
    if (!good) return no(VERIFICATION_REFUSALS.signature);
  }
  // Age is judged last. "Out of date" is then only ever said of an attestation that is good in every other way, and
  // only such a one stays on the record after it lapses: a forgery gains nothing by being dated a long time ago.
  const limit = ATTESTATION_VALID_MONTHS[a.scope];
  const age = monthsBetween(a.date, day);
  if (limit !== null && age >= limit) return no(VERIFICATION_REFUSALS.lapsed);
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
  /**
   * The entries of attestations whose only shortfall is age. They verify nothing any more, but what they recorded
   * happened: an inspector's odometer reading stays in the mileage log after its twelve months are up, or a rollback
   * it proved would clear itself with time.
   */
  lapsed: string[];
  /**
   * What stands, in timeline order: dated on or before the day and not withdrawn. An attestation stands when it
   * counts or has only lapsed; one that never counted (an unknown verifier, a bad signature, an owner) does not.
   */
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
  const lapsed = statuses.filter((s) => !s.valid && s.reason === VERIFICATION_REFUSALS.lapsed).map((s) => s.eventId);
  const events = ordered.filter((e) => e.date <= day && e.type !== 'void' && voided.indexOf(e.id) === -1
    && (e.type !== 'attestation' || attestations.some((s) => s.eventId === e.id) || lapsed.indexOf(e.id) !== -1));
  return { day, statuses, attestations, voided, lapsed, events };
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
  if (passport.events.length >= MAX_EVENTS) return refuse(VERIFICATION_REFUSALS.full);
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
  if (passport.events.length >= MAX_EVENTS) return refuse(VERIFICATION_REFUSALS.full);
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
  // An attestation that has lapsed is still a third party's record of what they saw. It no longer verifies.
  if (event.type === 'attestation') return standing.attestations.some((s) => s.eventId === event.id) ? 'verified' : 'documented';
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

/** The odometer as the passport knows it: one reading for each day that has any, whether the log ever runs backwards, and the reading to count wear from. */
export type MileageLog = {
  /** Every reading on the log, in order: all that stand, less the slips put right the day they were written. */
  readings: { date: string; mileage: number; eventId: string; evidence: EvidenceLevel }[];
  /** One reading per day, in order: the highest that stands for the day. */
  days: { date: string; mileage: number; eventId: string; evidence: EvidenceLevel }[];
  /** True when a day has a reading lower than one of an earlier day. */
  rollback: boolean;
  /** The highest reading that stands. An odometer does not run backwards, so wear is counted from here. Null with no reading. */
  current: { value: number; evidence: EvidenceLevel; date: string; eventId: string } | null;
};

const evidenceRank = (level: EvidenceLevel): number => EVIDENCE_ORDER.indexOf(level);

/**
 * The mileage log. Every reading that stands is on it, with one exception: a reading gives way to a later one for the
 * same day when both were written down on the same day. That is a slipped digit put right while the form was still
 * open, and it leaves no mark. Nothing else is ever replaced:
 *   - an entry written on a later day cannot rewrite an old reading, whatever day it is dated. Both stand;
 *   - a verifier's own reading is never displaced, whether its attestation still counts or has lapsed;
 *   - a reading a verifier confirmed gives way only to another verified one.
 * A rollback is a reading lower than one of an earlier day. Wear is counted from the highest reading that stands, so
 * no entry an owner adds can lower it, and none can clear a rollback once the day it was written on is over.
 */
export function mileageLog(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): MileageLog {
  type Kept = { date: string; mileage: number; eventId: string; evidence: EvidenceLevel; written: string; verifier: boolean };
  const kept: Kept[] = [];
  // Timeline order is by day, then by when it was written: readings of one day written on one day sit side by side.
  for (const e of standing.events) {
    if (e.mileage === null) continue;
    const next: Kept = { date: e.date, mileage: e.mileage, eventId: e.id, evidence: readingEvidence(e, standing), written: dayOf(e.recordedAt), verifier: e.type === 'attestation' };
    const last = kept.length > 0 ? kept[kept.length - 1] : null;
    const corrects = last !== null && last.date === next.date && last.written === next.written && !last.verifier
      && (last.evidence !== 'verified' || next.evidence === 'verified');
    if (corrects) kept[kept.length - 1] = next;
    else kept.push(next);
  }
  const readings: MileageLog['readings'] = [];
  const days: MileageLog['days'] = [];
  let rollback = false;
  let current: MileageLog['current'] = null;
  let before = -1; // the highest reading of any earlier day
  let top = -1; // the highest reading so far, this day included
  for (const k of kept) {
    const reading = { date: k.date, mileage: k.mileage, eventId: k.eventId, evidence: k.evidence };
    readings.push(reading);
    const last = days.length > 0 ? days[days.length - 1] : null;
    if (last === null || last.date !== k.date) { before = top; days.push(reading); }
    else if (k.mileage >= last.mileage) days[days.length - 1] = reading;
    if (k.mileage < before) rollback = true;
    if (k.mileage > top) top = k.mileage;
    // On a tie the better-evidenced reading speaks for the figure: an owner repeating an inspector's number does not weaken it.
    if (current === null || k.mileage > current.value || (k.mileage === current.value && evidenceRank(k.evidence) >= evidenceRank(current.evidence))) {
      current = { value: k.mileage, evidence: k.evidence, date: k.date, eventId: k.eventId };
    }
  }
  return { readings, days, rollback, current };
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

/**
 * The modifications fitted on a day, as `counts` reads the record. An install is fitted until a removal that counts
 * undoes it, and its upkeep is documented by a maintenance record that counts, made after it and less than twelve
 * months old.
 */
function fittedModifications(standing: Standing, counts: { install: (e: PassportEvent) => boolean; removal: (e: PassportEvent) => boolean; upkeep: (e: PassportEvent) => boolean }): ActiveModification[] {
  const removed: string[] = [];
  for (const e of standing.events) if (e.type === 'modification' && e.action === 'remove' && e.undoes !== null && counts.removal(e)) removed.push(e.undoes);
  const out: ActiveModification[] = [];
  for (const e of standing.events) {
    if (e.type !== 'modification' || e.action !== 'install' || removed.indexOf(e.id) !== -1 || !counts.install(e)) continue;
    const kept = standing.events.some((m) => m.type === 'maintenance' && counts.upkeep(m) && m.date > e.date && monthsBetween(m.date, standing.day) < 12);
    out.push({
      eventId: e.id, category: e.category, tier: e.tier, install: e.install, evidence: recordEvidence(e, standing), installedOn: e.date, recordedAt: e.recordedAt, installedAtMileage: e.mileage,
      upkeep: kept ? 'documented' : monthsBetween(e.date, standing.day) < 12 ? 'recent' : 'lapsed',
    });
  }
  return out;
}

/** The modifications fitted on a day: installs that stand and that no standing removal undoes, each with its evidence and upkeep. */
export function activeModifications(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ActiveModification[] {
  return fittedModifications(standing, { install: () => true, removal: () => true, upkeep: (m) => m.attachments.length > 0 });
}

/**
 * The modifications ranked play may count: verified inputs and nothing else. An install a verifier confirmed stays
 * fitted until a removal a verifier confirmed, and its upkeep is documented only by a maintenance record a verifier
 * confirmed. A removal the owner declares, or a receipt the owner uploads, changes nothing here, in either direction:
 * taking a verified turbocharger off the list would raise the scores an endurance race is decided on.
 */
export function competitionModifications(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ActiveModification[] {
  const verified = (e: PassportEvent): boolean => recordEvidence(e, standing) === 'verified';
  return fittedModifications(standing, { install: verified, removal: verified, upkeep: verified });
}

/**
 * What the condition engine needs, read from the passport as it stands on a day. The mileage is the highest reading
 * that stands (mileageLog), so an entry that winds the odometer back never lowers the wear counted from it.
 */
export function conditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ConditionInputs {
  const log = mileageLog(passport, registry, asOf, standing);
  const mileage: ConditionInputs['mileage'] = log.current === null ? null : { value: log.current.value, evidence: log.current.evidence };
  const replacements: ConditionInputs['replacements'] = [];
  const inspections: ConditionInputs['inspections'] = [];
  const declared: { accident: ConditionInputs['accident']; titleStatus: ConditionInputs['titleStatus'] } = { accident: null, titleStatus: null };
  for (const e of standing.events) {
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
 * What the condition engine may know for ranked play: verified inputs and nothing else. The highest reading a
 * verifier took, or that stands on a record a verifier confirmed (a reading the owner typed never counts here, even
 * one that agrees with an inspector's), the replacements a verifier confirmed (a receipt alone resets nothing here),
 * and inspectors' readings. Declared accidents and titles are left out. Because nothing an owner writes is in this
 * list, nothing an owner writes can move a ranked score, up or down.
 */
export function competitionConditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ConditionInputs {
  const all = conditionInputs(passport, registry, asOf, standing);
  let mileage: ConditionInputs['mileage'] = null;
  for (const e of standing.events) {
    if (e.mileage !== null && recordEvidence(e, standing) === 'verified' && (mileage === null || e.mileage >= mileage.value)) mileage = { value: e.mileage, evidence: 'verified' };
  }
  return { ...all, mileage, replacements: all.replacements.filter((r) => r.evidence === 'verified'), accident: null, titleStatus: null };
}
