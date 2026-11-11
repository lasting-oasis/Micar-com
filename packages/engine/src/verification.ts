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
import { canonicalJson, clipText, dayOf, isIsoTimestamp, monthsApart, monthsBetween, monthsOf, sha256Text, timestampKey } from './util';
import type { MonthCount } from './util';

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

/** Lookups over a passport's entries, built once by whoever asks about many of them. */
type Lookup = {
  /** The first entry with each id, under `#<id>`. */
  byId: Record<string, PassportEvent>;
  /** The first entry carrying each attestation, under `#<attestation id>`. */
  byAttestation: Record<string, AttestationEvent>;
  /** subjectFingerprint, worked out once per scope. */
  subject: (scope: AttestationScope) => string | null;
};

function lookupOf(passport: Passport): Lookup {
  const byId: Record<string, PassportEvent> = {};
  const byAttestation: Record<string, AttestationEvent> = {};
  for (const e of passport.events) {
    if (byId[`#${e.id}`] === undefined) byId[`#${e.id}`] = e;
    if (e.type === 'attestation' && byAttestation[`#${e.attestation.id}`] === undefined) byAttestation[`#${e.attestation.id}`] = e;
  }
  const subjects: Record<string, string | null> = {};
  const subject = (scope: AttestationScope): string | null => {
    const key = `#${scope}`;
    if (!(key in subjects)) subjects[key] = subjectFingerprint(passport, scope);
    return subjects[key];
  };
  return { byId, byAttestation, subject };
}

type Entry = { by: string; date: string; mileage: number | null };

/** The first checks: who made the attestation, and whether the entry that carries it is the attestation's own. */
function judgeMaker(passport: Passport, entry: Entry, a: Attestation, registry: VerifierRegistry): { verifier: Verifier; refused: null } | { verifier: null; refused: Verdict } {
  const verifier = findVerifier(registry, a.verifierId);
  const refused = (reason: string) => ({ verifier: null, refused: no(reason) });
  if (!verifier) return refused(VERIFICATION_REFUSALS.unknown);
  if (verifier.active !== true) return refused(VERIFICATION_REFUSALS.inactive);
  if (!Array.isArray(verifier.scopes) || verifier.scopes.indexOf(a.scope) === -1) return refused(VERIFICATION_REFUSALS.scope);
  if (everOwned(passport, a.verifierId)) return refused(VERIFICATION_REFUSALS.owner);
  if (entry.by !== a.verifierId) return refused(VERIFICATION_REFUSALS.author);
  if (entry.date !== a.date || entry.mileage !== readingOf(a)) return refused(VERIFICATION_REFUSALS.shape);
  if (lacksDetail(a)) return refused(VERIFICATION_REFUSALS.detail);
  return { verifier, refused: null };
}

/** The checks on what the attestation is bound to: the part of the passport it speaks for, and its signature. */
function judgeBinding(passport: Passport, a: Attestation, registry: VerifierRegistry, verifier: Verifier, subject: Lookup['subject']): Verdict | null {
  if (a.subject !== subject(a.scope)) return no(VERIFICATION_REFUSALS.changed);
  const check = registry ? registry.checkSignature : undefined;
  if (typeof check === 'function') {
    let good = false;
    if (a.signature !== null) {
      try { good = check(attestationPayload(passport, a), a.signature, verifier) === true; } catch { good = false; }
    }
    if (!good) return no(VERIFICATION_REFUSALS.signature);
  }
  return null;
}

/** What an attestation of a scope counts for at an age in months: nothing once it is out of date, a condition inspection by half after its first year, anything else in full. */
function weightAtAge(scope: AttestationScope, age: number): number {
  const limit = ATTESTATION_VALID_MONTHS[scope];
  if (limit !== null && age >= limit) return 0;
  return scope === 'condition' && age >= CONDITION_FULL_MONTHS ? 0.5 : 1;
}

/** Its age on a day. */
function judgeAge(a: Attestation, day: string): Verdict {
  const weight = weightAtAge(a.scope, monthsBetween(a.date, day));
  return weight === 0 ? no(VERIFICATION_REFUSALS.lapsed) : { valid: true, weight, reason: '' };
}

/**
 * Whether one attestation stands on a day, leaving withdrawals aside. `entry` is the passport entry that carries it:
 * its author, day and reading must be the attestation's own, so nothing can be claimed by dressing the entry up.
 * The checks run in a fixed order and the first that fails is the reason given; its age is the last of them.
 * Only two of them turn on the day: an attestation dated after it, and one too old on it. The rest (judgeMaker,
 * judgeBinding) are the same on every day, which attestationsOver relies on.
 */
function judge(passport: Passport, entry: Entry, a: Attestation, registry: VerifierRegistry, day: string, subject: Lookup['subject'] = (scope) => subjectFingerprint(passport, scope)): Verdict {
  const maker = judgeMaker(passport, entry, a, registry);
  if (maker.refused !== null) return maker.refused;
  if (a.date > day) return no(VERIFICATION_REFUSALS.future);
  const binding = judgeBinding(passport, a, registry, maker.verifier, subject);
  if (binding !== null) return binding;
  // Age is judged last. "Out of date" is then only ever said of an attestation that is good in every other way, and
  // only such a one stays on the record after it lapses: a forgery gains nothing by being dated a long time ago.
  return judgeAge(a, day);
}

/** True when a withdrawal of an attestation is its own verifier's, and that verifier is still registered. Nothing in it turns on the day. */
function withdraws(e: Extract<PassportEvent, { type: 'void' }>, target: PassportEvent, authority: AttestationEvent, registry: VerifierRegistry): boolean {
  const verifier = findVerifier(registry, e.by);
  return authority.id === target.id && verifier !== null && verifier.active === true;
}

/**
 * The ids of what verifiers have withdrawn, as of a day, in the order the withdrawals were written.
 * An attestation is taken back only by its own verifier. A record is withdrawn by a verifier whose records
 * attestation counted on the day of the withdrawal and had not itself been taken back; the withdrawal then stands
 * for good, whatever later becomes of that attestation, unless the verifier leaves the registry.
 */
function standingVoids(passport: Passport, registry: VerifierRegistry, day: string, lookup: Lookup = lookupOf(passport)): string[] {
  const out: string[] = [];
  const taken: Record<string, true> = {};
  for (const e of passport.events) {
    if (e.type !== 'void' || e.date > day || taken[`#${e.target}`] === true) continue;
    const target = lookup.byId[`#${e.target}`];
    if (!target || target.type === 'registered' || target.type === 'transfer' || target.type === 'void') continue;
    const authority = lookup.byAttestation[`#${e.attestationId}`];
    if (!authority || authority.attestation.verifierId !== e.by) continue;
    if (target.type === 'attestation') {
      if (withdraws(e, target, authority, registry)) { out.push(e.target); taken[`#${e.target}`] = true; }
      continue;
    }
    if (authority.attestation.scope !== 'documentation' || taken[`#${authority.id}`] === true) continue;
    if (judge(passport, authority, authority.attestation, registry, e.date, lookup.subject).valid) { out.push(e.target); taken[`#${e.target}`] = true; }
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
  /**
   * Lookups over the attestations that count, so a question about one entry does not read every attestation:
   * `counting` holds `#<entry id>` for each; `names` holds `<scope>#<record id>` for every record a documentation
   * or modification attestation names; `readings` holds the attested odometer readings under `#<day>`. `byId`
   * holds every entry that stands under `#<id>`.
   */
  index: { counting: Record<string, true>; names: Record<string, true>; readings: Record<string, number[]>; byId: Record<string, PassportEvent> };
};

/**
 * Works out a passport's standing on a day. Every query below takes the passport, the registry and the day, and
 * accepts a standing already worked out for them as a last argument, so a caller asking several things (or a host
 * whose signature check is slow) does the work once.
 */
export function standingOf(passport: Passport, registry: VerifierRegistry, asOf: string): Standing {
  const day = dayOf(asOf);
  const lookup = lookupOf(passport);
  const ordered = timeline(passport);
  const voided = standingVoids(passport, registry, day, lookup);
  const gone: Record<string, true> = {};
  for (const id of voided) gone[`#${id}`] = true;
  const statuses: AttestationStatus[] = [];
  for (const e of ordered) {
    if (e.type !== 'attestation') continue;
    const verdict = judge(passport, e, e.attestation, registry, day, lookup.subject);
    statuses.push({ eventId: e.id, attestation: e.attestation, ...(verdict.valid && gone[`#${e.id}`] === true ? no(VERIFICATION_REFUSALS.withdrawn) : verdict) });
  }
  const attestations = statuses.filter((s) => s.valid && s.weight > 0);
  const lapsed = statuses.filter((s) => !s.valid && s.reason === VERIFICATION_REFUSALS.lapsed).map((s) => s.eventId);
  const index: Standing['index'] = { counting: {}, names: {}, readings: {}, byId: {} };
  const stands: Record<string, true> = {};
  for (const id of lapsed) stands[`#${id}`] = true;
  for (const s of attestations) {
    const a = s.attestation;
    stands[`#${s.eventId}`] = true;
    index.counting[`#${s.eventId}`] = true;
    if (a.scope === 'documentation' || a.scope === 'modification') for (const id of a.events) index.names[`${a.scope}#${id}`] = true;
    if (a.scope === 'mileage' && a.mileage !== null) {
      const on = `#${a.date}`;
      if (index.readings[on] === undefined) index.readings[on] = [];
      index.readings[on].push(a.mileage);
    }
  }
  const events = ordered.filter((e) => e.date <= day && e.type !== 'void' && gone[`#${e.id}`] !== true && (e.type !== 'attestation' || stands[`#${e.id}`] === true));
  for (const e of events) if (index.byId[`#${e.id}`] === undefined) index.byId[`#${e.id}`] = e;
  return { day, statuses, attestations, voided, lapsed, events, index };
}

/**
 * The attestations that count on each of many days of one passport. standingOf works a whole standing out for one
 * day. The stored history asks about a day for every snapshot and edition a file holds, thousands of them, and
 * reads only which attestations counted then. So everything about an attestation that does not turn on the day
 * (who made it, what it is bound to, its signature, whether its verifier took it back and from when) is worked out
 * here once, and a day costs only a look at the attestations that could ever count.
 * `on(day).attestations()` is exactly `standingOf(passport, registry, day).attestations`. `on(day).key` is the same
 * for two days exactly when the same attestations count on both with the same weights.
 * Asked about a moment (a timestamp) instead of a day, it answers for that moment of the day: an attestation its
 * verifier took back at three in the afternoon still counted at nine that morning, so a grade kept at nine is not
 * judged by a withdrawal that had not happened yet.
 */
export function attestationsOver(passport: Passport, registry: VerifierRegistry): (asOf: string) => { key: string; attestations: () => AttestationStatus[] } {
  const lookup = lookupOf(passport);
  // When each attestation was taken back, by its own verifier: the time the withdrawal was written down, when that
  // was on the day it is dated; otherwise the start of the day it is dated. As text, a day sorts before every time
  // of that day, so the earliest of several is simply the least.
  const withdrawn: Record<string, string> = {};
  for (const e of passport.events) {
    if (e.type !== 'void') continue;
    const target = lookup.byId[`#${e.target}`];
    const authority = lookup.byAttestation[`#${e.attestationId}`];
    if (!target || target.type !== 'attestation' || !authority || authority.attestation.verifierId !== e.by || !withdraws(e, target, authority, registry)) continue;
    const key = `#${target.id}`;
    const moment = dayOf(e.recordedAt) === e.date ? timestampKey(e.recordedAt) : e.date;
    if (withdrawn[key] === undefined || moment < withdrawn[key]) withdrawn[key] = moment;
  }
  // The attestations that are good in every way that does not turn on the day, in timeline order.
  const sound: { event: AttestationEvent; from: string; made: MonthCount; until: string | null }[] = [];
  for (const e of timeline(passport)) {
    if (e.type !== 'attestation') continue;
    const maker = judgeMaker(passport, e, e.attestation, registry);
    if (maker.refused !== null || judgeBinding(passport, e.attestation, registry, maker.verifier, lookup.subject) !== null) continue;
    sound.push({ event: e, from: e.attestation.date, made: monthsOf(e.attestation.date), until: withdrawn[`#${e.id}`] ?? null });
  }
  return (asOf) => {
    const day = dayOf(asOf);
    const now = monthsOf(day);
    // Everything withdrawn up to here counts as withdrawn: up to the moment asked about, or to the end of the day.
    const upTo = isIsoTimestamp(asOf) ? timestampKey(asOf) : `${day}~`;
    // One character for each attestation that could count: not counting, counting in full, counting by half.
    const weights: number[] = [];
    let key = '';
    for (const s of sound) {
      const weight = s.from > day || (s.until !== null && s.until <= upTo) ? 0 : weightAtAge(s.event.attestation.scope, monthsApart(s.made, now));
      weights.push(weight);
      key += weight === 0 ? '0' : weight === 1 ? '1' : 'h';
    }
    const attestations = (): AttestationStatus[] => {
      const out: AttestationStatus[] = [];
      for (let i = 0; i < sound.length; i++) if (weights[i] > 0) out.push({ eventId: sound[i].event.id, attestation: sound[i].event.attestation, valid: true, weight: weights[i], reason: '' });
      return out;
    };
    return { key, attestations };
  };
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
  if (event.type === 'attestation') return standing.index.counting[`#${event.id}`] === true ? 'verified' : 'documented';
  // A records attestation speaks for any record it names; a modification attestation only for a modification.
  if (standing.index.names[`documentation#${event.id}`] === true || (event.type === 'modification' && standing.index.names[`modification#${event.id}`] === true)) return 'verified';
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
  for (const attested of standing.index.readings[`#${event.date}`] ?? []) if (Math.abs(event.mileage - attested) <= MILEAGE_TOLERANCE) return 'verified';
  return record;
}

/**
 * How much stands behind one entry on a day: verified only through an attestation that counts and names it;
 * documented when the entry has a file; declared otherwise. An entry that was withdrawn, is dated later than the
 * day, or is not on the passport is declared: it has no standing.
 */
export function eventEvidence(passport: Passport, eventId: string, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): EvidenceLevel {
  const event = standing.index.byId[`#${eventId}`];
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
  /** True when a day has a reading lower than one of an earlier day (see mileageLog for the one pair that is not held to it). */
  rollback: boolean;
  /** The highest reading that stands. An odometer does not run backwards, so wear is counted from here. Null with no reading. */
  current: { value: number; evidence: EvidenceLevel; date: string; eventId: string } | null;
  /**
   * The readings that gave way, each with the reading that stands in its place: the last of that day's corrections.
   * An entry whose reading was put right is still on the passport, and anything that counts from its odometer
   * figure (a replacement's wear, say) should count from the figure that stands.
   */
  putRight: { eventId: string; standing: { eventId: string; mileage: number } }[];
};

const evidenceRank = (level: EvidenceLevel): number => EVIDENCE_ORDER.indexOf(level);

/**
 * The mileage log. Every reading that stands is on it, with one exception: a reading gives way to the next one its
 * writer wrote for the same day, when both were written down on the same day with nothing from a later day written
 * in between. That is a slipped digit put right by the person who made it, while it is fresh, and it leaves no mark.
 * Nothing else is ever replaced:
 *   - an entry written on a later day cannot rewrite an old reading, whatever day it is dated. Both stand;
 *   - nor can an entry written after others of a later day, whatever day its own timestamp names. A passport keeps
 *     its entries in the order they were written, and that order is read here beside the timestamps: setting a
 *     device's clock back to the day of an old reading does not put a new entry next to it;
 *   - one owner's reading is never replaced by another's: on the day a car changes hands both of theirs stand;
 *   - a verifier's own reading is never displaced, whether its attestation still counts or has lapsed;
 *   - nor is a reading on a record a verifier confirmed (while the attestation counts, and after it lapses), or one
 *     that an attestation of the same day bears out.
 * A rollback is a reading lower than one of an earlier day. Wear is counted from the highest reading that stands, so
 * no entry an owner adds can lower it, and none can clear a rollback once the day it was written on is over.
 * One pair is not a rollback though the dates make it look like one: a higher reading that was written after the
 * lower one, on the very day it is dated. Written later and dated "today", it was read off the odometer after the
 * lower one, whatever the two dates say. Two owners' calendars can be a day apart (a buyer west of the seller logs
 * a reading "today" that the seller's entry already calls yesterday), and a clock can simply be wrong. A higher
 * reading that is back-dated gets no such allowance: an old receipt found later that shows more miles than a newer
 * reading is exactly how a rollback comes to light.
 */
export function mileageLog(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): MileageLog {
  type Read = { event: PassportEvent; evidence: EvidenceLevel; at: number; settled: boolean };
  // The order the passport was written in. `laterBefore[i]` is the place of the nearest entry before entry i that
  // was written on a later day than entry i says it was, or -1 when there is none.
  const place: Record<string, number> = {};
  const laterBefore: number[] = [];
  const open: number[] = [];
  const writtenOn = passport.events.map((e) => dayOf(e.recordedAt));
  for (let i = 0; i < writtenOn.length; i++) {
    while (open.length > 0 && writtenOn[open[open.length - 1]] <= writtenOn[i]) open.pop();
    laterBefore.push(open.length > 0 ? open[open.length - 1] : -1);
    open.push(i);
    place[`#${passport.events[i].id}`] = i;
  }
  // The records a verifier has stood behind, by an attestation that counts or has only lapsed. What was confirmed
  // happened: its reading stays where it is after the attestation ages out, as an inspector's own reading does.
  const confirmed: Record<string, true> = {};
  for (const e of standing.events) {
    if (e.type !== 'attestation' || (e.attestation.scope !== 'documentation' && e.attestation.scope !== 'modification')) continue;
    for (const id of e.attestation.events) confirmed[`${e.attestation.scope}#${id}`] = true;
  }
  const read: Read[] = [];
  for (const e of standing.events) {
    if (e.mileage === null) continue;
    const evidence = readingEvidence(e, standing);
    const settled = e.type === 'attestation' || evidence === 'verified' || confirmed[`documentation#${e.id}`] === true || (e.type === 'modification' && confirmed[`modification#${e.id}`] === true);
    read.push({ event: e, evidence, at: place[`#${e.id}`] ?? -1, settled });
  }
  // The readings put right. Going back through the order of writing, each reading meets the next one the same writer
  // wrote for the same day on the same day. It gives way to it unless a verifier has had anything to do with it, or
  // an entry written on a later day lies between the two.
  // Under `#<id>` of each reading that gave way: the reading that stands in its place, at the end of the day's corrections.
  const gaveWay: Record<string, Read> = {};
  const nextOf: Record<string, Read> = {};
  for (const r of read.slice().sort((a, b) => b.at - a.at)) {
    const key = `${r.event.date} ${dayOf(r.event.recordedAt)} ${r.event.by}`;
    const next = nextOf[key];
    if (next !== undefined && !r.settled && r.at >= 0 && laterBefore[next.at] < r.at) gaveWay[`#${r.event.id}`] = gaveWay[`#${next.event.id}`] ?? next;
    nextOf[key] = r;
  }
  const milesOf = (r: Read): number => r.event.mileage as number;
  const putRight: MileageLog['putRight'] = [];
  for (const r of read) {
    const standing = gaveWay[`#${r.event.id}`];
    if (standing !== undefined) putRight.push({ eventId: r.event.id, standing: { eventId: standing.event.id, mileage: milesOf(standing) } });
  }

  // What a reading is held against: the highest reading of any earlier day, leaving out those written after it on
  // the day they are dated. `dated` is the highest back-dated reading of the earlier days. `written` holds the
  // highest reading written on its own day, by place in the order of writing (a tree of running maxima), so that a
  // reading is held only against the ones written before it.
  const size = passport.events.length;
  const written: number[] = [];
  for (let i = 0; i <= size; i++) written.push(-1);
  const raise = (place: number, miles: number): void => { for (let i = place + 1; i <= size; i += i & -i) if (written[i] < miles) written[i] = miles; };
  const highestBefore = (place: number): number => { let best = -1; for (let i = place; i > 0; i -= i & -i) if (written[i] > best) best = written[i]; return best; };
  let dated = -1;
  let today: Read[] = []; // the readings of the day being read: they count against later days only
  const readings: MileageLog['readings'] = [];
  const days: MileageLog['days'] = [];
  let rollback = false;
  let current: MileageLog['current'] = null;
  for (const k of read) {
    if (gaveWay[`#${k.event.id}`] !== undefined) continue;
    const miles = milesOf(k);
    const reading = { date: k.event.date, mileage: miles, eventId: k.event.id, evidence: k.evidence };
    readings.push(reading);
    const last = days.length > 0 ? days[days.length - 1] : null;
    if (last === null || last.date !== k.event.date) {
      for (const earlier of today) {
        if (earlier.at >= 0 && dayOf(earlier.event.recordedAt) === earlier.event.date) raise(earlier.at, milesOf(earlier));
        else if (milesOf(earlier) > dated) dated = milesOf(earlier);
      }
      today = [];
      days.push(reading);
    } else if (miles >= last.mileage) days[days.length - 1] = reading;
    if (miles < dated || miles < highestBefore(k.at)) rollback = true;
    today.push(k);
    // On a tie the better-evidenced reading speaks for the figure: an owner repeating an inspector's number does not weaken it.
    if (current === null || miles > current.value || (miles === current.value && evidenceRank(k.evidence) >= evidenceRank(current.evidence))) {
      current = { value: miles, evidence: k.evidence, date: k.event.date, eventId: k.event.id };
    }
  }
  return { readings, days, rollback, current, putRight };
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
  const removed: Record<string, true> = {};
  // The newest maintenance record that counts as upkeep: one less than twelve months old. It keeps up every
  // modification fitted before it.
  let upkeep = '';
  for (const e of standing.events) {
    if (e.type === 'modification' && e.action === 'remove' && e.undoes !== null && counts.removal(e)) removed[`#${e.undoes}`] = true;
    if (e.type === 'maintenance' && e.date > upkeep && monthsBetween(e.date, standing.day) < 12 && counts.upkeep(e)) upkeep = e.date;
  }
  const out: ActiveModification[] = [];
  for (const e of standing.events) {
    if (e.type !== 'modification' || e.action !== 'install' || removed[`#${e.id}`] === true || !counts.install(e)) continue;
    const kept = upkeep > e.date;
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
 * that stands (mileageLog), so an entry that winds the odometer back never lowers the wear counted from it. A
 * replacement's odometer figure is the one that stands for its record on the log.
 */
export function conditionInputs(passport: Passport, registry: VerifierRegistry, asOf: string, standing: Standing = standingOf(passport, registry, asOf)): ConditionInputs {
  const log = mileageLog(passport, registry, asOf, standing);
  const mileage: ConditionInputs['mileage'] = log.current === null ? null : { value: log.current.value, evidence: log.current.evidence };
  const replacements: ConditionInputs['replacements'] = [];
  const inspections: ConditionInputs['inspections'] = [];
  const declared: { accident: ConditionInputs['accident']; titleStatus: ConditionInputs['titleStatus'] } = { accident: null, titleStatus: null };
  // A replacement is counted from the odometer figure on its record. When that figure was a slip put right the same
  // day, the record is counted from the figure that stands in its place: the log and the wear then tell one story.
  const stands: Record<string, number> = {};
  for (const c of log.putRight) stands[`#${c.eventId}`] = c.standing.mileage;
  for (const e of standing.events) {
    if (e.type === 'repair' && e.system !== null && (e.work === 'replacement' || e.work === 'rebuild')) {
      replacements.push({ system: e.system, date: e.date, mileage: e.mileage === null ? null : stands[`#${e.id}`] ?? e.mileage, evidence: recordEvidence(e, standing) });
    }
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
