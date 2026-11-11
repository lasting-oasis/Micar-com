// The vehicle passport: a vehicle's persistent identity and its history.
// A passport holds the MiCar ID, the factory specification, the VIN (private), who has owned the vehicle, and three
// lists that are only ever added to: events, grade snapshots and card editions. No function here edits or deletes an
// entry, and every function returns a new passport and leaves the one it was given untouched.
// This module is the owner's door. Attestations and withdrawals come only from verifiers, through verification.ts.
// Everything read from outside (a form, a stored file, an import) is checked field by field and never trusted.
import { isMicarId } from './identity';
import { EDITION_NAMES } from './labels';
import { parseSpec } from './specs';
import { CERTIFICATION_LEVELS, GRADE_CATEGORIES, MOD_CATEGORIES, OWNER_EVENT_TYPES, RARITY_TIERS, WEAR_SYSTEMS } from './types';
import type {
  AccidentHistory, Attachment, AttachmentKind, Attestation, AttestationScope, CardEdition, CardFinish, CertificationLevel, ConditionBand, EventBase, GradeCategoryKey,
  GradeSnapshot, InstallQuality, MaybeAttributes, ModCategory, ModTier, OwnershipPeriod, Passport, PassportEvent, PassportEventType, PhotoSubject, RarityTier, Result, TitleStatus,
  VehicleSpec, WearSystem,
} from './types';
import { ATTRIBUTE_KEYS } from './types';
import { clipText, dayOf, isIsoDate, isIsoTimestamp, isNumber, timestampKey } from './util';
import { normalizeVin } from './vin';

/* -------------------------------------------------------------------- limits ---- */

export const MAX_ATTACHMENTS = 20;
/** The most entries one passport holds. A lifetime of careful records is a few hundred; a file with more than this is not a passport. */
export const MAX_EVENTS = 5000;
/**
 * Room kept free for what an owner does not write alone: hand-overs, verifiers' attestations and withdrawals. An
 * owner's own entries stop this far short of the limit, so filling a passport can never block a verifier from
 * recording a withdrawal, and a hand-over can never leave a passport too long to be read back.
 */
export const RESERVED_ENTRIES = 500;
/** The most grade snapshots and card editions a passport holds. A card has one edition for each level it has reached. */
export const MAX_SNAPSHOTS = 5000;
export const MAX_EDITIONS = 200;
export const MAX_MILEAGE = 2000000;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_COST = 10000000;
/** The first day anything can be dated: the year of the first car. */
export const FIRST_DAY = '1886-01-01';

const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['photo', 'receipt', 'invoice', 'report', 'title', 'registration', 'dyno', 'other'];
const PHOTO_SUBJECTS: readonly PhotoSubject[] = ['exterior', 'interior', 'engine-bay', 'undercarriage', 'vin-plate', 'odometer', 'damage', 'other'];
const CONDITION_BANDS: readonly ConditionBand[] = ['Excellent', 'Good', 'Fair', 'Poor'];
const ACCIDENTS: readonly AccidentHistory[] = ['None', 'Minor', 'Major'];
const TITLE_STATUSES: readonly TitleStatus[] = ['Clean', 'Rebuilt', 'Salvage'];
const INSTALLS: readonly InstallQuality[] = ['professional', 'owner', 'unknown'];
const SCOPES: readonly AttestationScope[] = ['identity', 'mileage', 'documentation', 'condition', 'originality', 'modification', 'specification', 'one-of-one'];
const FINISHES: readonly CardFinish[] = ['raw', 'standard', 'blue', 'holo', 'rainbow'];
const EVENT_TYPES: readonly PassportEventType[] = ['registered', 'photo', 'maintenance', 'repair', 'mileage', 'inspection', 'modification', 'restoration', 'document', 'declaration', 'transfer', 'attestation', 'void'];

/** What each kind of entry is called. The apps translate these. */
export const EVENT_TYPE_LABELS: Record<PassportEventType, string> = {
  registered: 'Parked', photo: 'Photographs', maintenance: 'Maintenance', repair: 'Repair', mileage: 'Mileage update', inspection: 'Inspection report',
  modification: 'Modification', restoration: 'Restoration', document: 'Document', declaration: 'Owner’s declaration', transfer: 'Ownership transfer',
  attestation: 'Attestation', void: 'Record withdrawn',
};

/** Every reason this module refuses something. The apps translate these. */
export const PASSPORT_REFUSALS = {
  micarId: 'That is not a MiCar ID',
  owner: 'An owner needs an ID',
  timestamp: 'The time is not a timestamp',
  spec: 'The specification could not be read',
  vin: 'A VIN is letters and digits, five to seventeen of them',
  notOwner: 'Only the current owner can write to this passport',
  verifierOnly: 'Only a verifier can record this',
  shape: 'That is not an entry',
  full: 'This passport holds as many entries as a passport can',
  kind: 'That is not a kind of entry',
  id: 'An entry needs an ID of its own',
  date: 'The date is not a real day',
  future: 'The date is in the future',
  tooEarly: 'The date is before the first car',
  mileage: 'The odometer reading must be a whole number of miles',
  mileageNeeded: 'A mileage update needs a reading',
  attachments: 'A file could not be read, or there are more than twenty',
  visibility: 'An entry is private or public',
  field: 'One of the details is not valid',
  empty: 'A declaration has to state something',
  undo: 'That removal does not match a modification that is still fitted',
  sameOwner: 'The vehicle already belongs to that owner',
  beforeOwnership: 'The date is before the current owner had the vehicle',
} as const;

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const among = <T>(list: readonly T[], v: unknown): v is T => list.indexOf(v as T) !== -1;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An id for an entry, a file, a snapshot, an owner or a verifier: 1 to 80 printable characters, exactly as given. */
export function isId(v: unknown, max = 80): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= max && clipText(v, max) === v;
}

/* --------------------------------------------------------------- small readers ---- */

/** What the passport keeps about a file, from anything. Null when it is not that. */
export function checkAttachment(input: unknown): Attachment | null {
  if (!isRecord(input)) return null;
  const { id, kind, mime, size, sha256 } = input;
  if (!isId(id, 40) || !among(ATTACHMENT_KINDS, kind)) return null;
  if (!isNumber(size) || !Number.isInteger(size) || size < 0 || size > MAX_FILE_BYTES) return null;
  if (sha256 !== null && sha256 !== undefined && !(typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256))) return null;
  return { id, kind, name: clipText(input.name, 120), mime: clipText(mime, 80), size, sha256: typeof sha256 === 'string' ? sha256 : null };
}

function readAttachments(input: unknown): Attachment[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) return null;
  const out: Attachment[] = [];
  for (const raw of input) {
    const a = checkAttachment(raw);
    if (!a || out.some((x) => x.id === a.id)) return null;
    out.push(a);
  }
  return out;
}

/** null and undefined read as null; a whole number of miles in range reads as itself; anything else is refused. */
function readMileage(v: unknown): Result<number | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  return isNumber(v) && Number.isInteger(v) && v >= 0 && v <= MAX_MILEAGE ? { ok: true, value: v } : refuse(PASSPORT_REFUSALS.mileage);
}

function readCost(v: unknown): Result<number | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  return isNumber(v) && v >= 0 && v <= MAX_COST ? { ok: true, value: v } : refuse(PASSPORT_REFUSALS.field);
}

/** A choice that may be left unstated: null, or one of the list. */
function readOptional<T>(list: readonly T[], v: unknown): Result<T | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  return among(list, v) ? { ok: true, value: v } : refuse(PASSPORT_REFUSALS.field);
}

/** An attestation from anything, in canonical shape. Null when it is not one. verification.ts decides whether it counts. */
export function checkAttestation(input: unknown): Attestation | null {
  if (!isRecord(input)) return null;
  const { id, verifierId, scope, date, inPerson } = input;
  if (!isId(id, 40) || !isId(verifierId) || !among(SCOPES, scope) || !isIsoDate(date) || date < FIRST_DAY || typeof inPerson !== 'boolean') return null;
  const score = input.conditionScore;
  if (score !== null && score !== undefined && !(isNumber(score) && score >= 0 && score <= 100)) return null;
  let systems: Partial<Record<WearSystem, number>> | null = null;
  if (input.systems !== null && input.systems !== undefined) {
    if (!isRecord(input.systems)) return null;
    systems = {};
    for (const system of WEAR_SYSTEMS) {
      const wear = input.systems[system];
      if (wear === undefined || wear === null) continue;
      if (!isNumber(wear) || wear < 0 || wear > 1) return null;
      systems[system] = wear;
    }
  }
  const mileage = readMileage(input.mileage);
  if (!mileage.ok) return null;
  const listed = input.events === undefined || input.events === null ? [] : input.events;
  if (!Array.isArray(listed) || listed.length > 200) return null;
  const events: string[] = [];
  for (const e of listed) {
    if (!isId(e, 40)) return null;
    if (events.indexOf(e) === -1) events.push(e);
  }
  const subject = input.subject;
  if (subject !== null && subject !== undefined && !(typeof subject === 'string' && /^[0-9a-f]{64}$/.test(subject))) return null;
  const signature = input.signature;
  if (signature !== null && signature !== undefined && !(typeof signature === 'string' && signature.length <= 2000)) return null;
  return {
    id, verifierId, scope, date, inPerson, conditionScore: isNumber(score) ? score : null, systems, mileage: mileage.value, events,
    note: clipText(input.note, 500), subject: typeof subject === 'string' ? subject : null, signature: typeof signature === 'string' ? signature : null,
  };
}

/* ------------------------------------------------------------------ one event ---- */

/**
 * An event from anything, in canonical shape and key order, or the reason it is not one. This checks the event on
 * its own: whether it may join a particular passport (who wrote it, when, what it refers to) is the caller's to judge.
 * `recordedAt` and `by` are taken from `stamp` when given (a new entry) and from the input otherwise (a stored one).
 */
function readEvent(input: unknown, stamp: { recordedAt: string; by: string } | null): Result<PassportEvent> {
  if (!isRecord(input)) return refuse(PASSPORT_REFUSALS.shape);
  const type = input.type;
  if (!among(EVENT_TYPES, type)) return refuse(PASSPORT_REFUSALS.kind);
  if (!isId(input.id, 40)) return refuse(PASSPORT_REFUSALS.id);
  if (!isIsoDate(input.date)) return refuse(PASSPORT_REFUSALS.date);
  if (input.date < FIRST_DAY) return refuse(PASSPORT_REFUSALS.tooEarly);
  const recordedAt = stamp ? stamp.recordedAt : input.recordedAt;
  const by = stamp ? stamp.by : input.by;
  if (!isIsoTimestamp(recordedAt)) return refuse(PASSPORT_REFUSALS.timestamp);
  if (!isId(by)) return refuse(PASSPORT_REFUSALS.owner);
  const mileage = readMileage(input.mileage);
  if (!mileage.ok) return mileage;
  const attachments = readAttachments(input.attachments);
  if (attachments === null) return refuse(PASSPORT_REFUSALS.attachments);
  const visibility = input.visibility === undefined || input.visibility === null ? 'private' : input.visibility;
  if (visibility !== 'private' && visibility !== 'public') return refuse(PASSPORT_REFUSALS.visibility);
  const base: EventBase = {
    id: input.id, date: input.date, recordedAt, by, mileage: mileage.value, title: clipText(input.title, 120), note: clipText(input.note, 2000), attachments, visibility,
  };

  switch (type) {
    case 'registered':
      return { ok: true, value: { ...base, type } };
    case 'photo':
      return among(PHOTO_SUBJECTS, input.subject) ? { ok: true, value: { ...base, type, subject: input.subject } } : refuse(PASSPORT_REFUSALS.field);
    case 'maintenance': {
      const cost = readCost(input.cost);
      return cost.ok ? { ok: true, value: { ...base, type, shop: clipText(input.shop, 120), cost: cost.value } } : cost;
    }
    case 'repair': {
      const cost = readCost(input.cost);
      if (!cost.ok) return cost;
      const system = readOptional(WEAR_SYSTEMS, input.system);
      if (!system.ok) return system;
      if (input.work !== 'repair' && input.work !== 'replacement' && input.work !== 'rebuild') return refuse(PASSPORT_REFUSALS.field);
      return { ok: true, value: { ...base, type, system: system.value, work: input.work, shop: clipText(input.shop, 120), cost: cost.value } };
    }
    case 'mileage':
      return base.mileage === null ? refuse(PASSPORT_REFUSALS.mileageNeeded) : { ok: true, value: { ...base, type } };
    case 'inspection':
      return { ok: true, value: { ...base, type, inspector: clipText(input.inspector, 120) } };
    case 'modification': {
      const { action, category, tier, install, undoes } = input;
      if ((action !== 'install' && action !== 'remove') || !among(MOD_CATEGORIES, category) || (tier !== 1 && tier !== 2 && tier !== 3) || !among(INSTALLS, install)) return refuse(PASSPORT_REFUSALS.field);
      if (action === 'install' ? undoes !== null && undoes !== undefined : !isId(undoes, 40)) return refuse(PASSPORT_REFUSALS.undo);
      return { ok: true, value: { ...base, type, action, category: category as ModCategory, tier: tier as ModTier, install, parts: clipText(input.parts, 200), undoes: action === 'install' ? null : (undoes as string) } };
    }
    case 'restoration':
      return typeof input.oemParts === 'boolean' ? { ok: true, value: { ...base, type, scope: clipText(input.scope, 200), oemParts: input.oemParts } } : refuse(PASSPORT_REFUSALS.field);
    case 'document':
      return input.document === 'title' || input.document === 'registration' || input.document === 'other' ? { ok: true, value: { ...base, type, document: input.document } } : refuse(PASSPORT_REFUSALS.field);
    case 'declaration': {
      const condition = readOptional(CONDITION_BANDS, input.condition);
      const accident = readOptional(ACCIDENTS, input.accident);
      const titleStatus = readOptional(TITLE_STATUSES, input.titleStatus);
      const originality = readOptional(['stock', 'modified'] as const, input.originality);
      if (!condition.ok) return condition;
      if (!accident.ok) return accident;
      if (!titleStatus.ok) return titleStatus;
      if (!originality.ok) return originality;
      if (condition.value === null && accident.value === null && titleStatus.value === null && originality.value === null) return refuse(PASSPORT_REFUSALS.empty);
      return { ok: true, value: { ...base, type, condition: condition.value, accident: accident.value, titleStatus: titleStatus.value, originality: originality.value } };
    }
    case 'transfer':
      return isId(input.from) && isId(input.to) && input.from !== input.to ? { ok: true, value: { ...base, type, from: input.from, to: input.to } } : refuse(PASSPORT_REFUSALS.field);
    case 'attestation': {
      const attestation = checkAttestation(input.attestation);
      return attestation ? { ok: true, value: { ...base, type, attestation } } : refuse(PASSPORT_REFUSALS.field);
    }
    case 'void':
      return isId(input.target, 40) && isId(input.attestationId, 40) ? { ok: true, value: { ...base, type, target: input.target, reason: clipText(input.reason, 300), attestationId: input.attestationId } } : refuse(PASSPORT_REFUSALS.field);
    default:
      return refuse(PASSPORT_REFUSALS.kind);
  }
}

/* ------------------------------------------------------------------- creating ---- */

const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/** A VIN as the passport keeps it: normalised, and either empty or five to seventeen letters and digits. Null when it is neither. */
function readVin(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const vin = normalizeVin(v);
  return vin === '' || /^[0-9A-Z]{5,17}$/.test(vin) ? vin : null;
}

/** A specification through the engine's own parser: the clean copy, or null when any part of it is not valid. */
function readSpec(spec: unknown, thisYear: number): VehicleSpec | null {
  const read = parseSpec(spec, thisYear);
  return read.spec !== null && read.issues.length === 0 ? read.spec : null;
}

/** Gives a vehicle its passport: the identity, the first owner and the first entry. */
export function createPassport(input: { micarId: string; now: string; ownerId: string; spec: VehicleSpec; color?: string; vin?: string; eventId: string }): Result<Passport> {
  if (!isRecord(input)) return refuse(PASSPORT_REFUSALS.shape);
  if (!isMicarId(input.micarId)) return refuse(PASSPORT_REFUSALS.micarId);
  if (!isIsoTimestamp(input.now)) return refuse(PASSPORT_REFUSALS.timestamp);
  if (!isId(input.ownerId)) return refuse(PASSPORT_REFUSALS.owner);
  if (!isId(input.eventId, 40)) return refuse(PASSPORT_REFUSALS.id);
  const spec = readSpec(input.spec, yearOf(input.now));
  if (!spec) return refuse(PASSPORT_REFUSALS.spec);
  const vin = readVin(input.vin);
  if (vin === null) return refuse(PASSPORT_REFUSALS.vin);
  const day = dayOf(input.now);
  return {
    ok: true,
    value: {
      schema: 1, micarId: input.micarId, createdAt: input.now, spec, color: clipText(input.color, 40), vin,
      owners: [{ ownerId: input.ownerId, from: day, to: null }],
      events: [{ id: input.eventId, date: day, recordedAt: input.now, by: input.ownerId, mileage: null, title: EVENT_TYPE_LABELS.registered, note: '', attachments: [], visibility: 'private', type: 'registered' }],
      snapshots: [],
      editions: [],
    },
  };
}

/* ---------------------------------------------------------------------- reading ---- */

/** Who owns the vehicle now. */
export function currentOwner(passport: Passport): string {
  return passport.owners.length > 0 ? passport.owners[passport.owners.length - 1].ownerId : '';
}
/** True when that id has ever owned the vehicle. */
export const everOwned = (passport: Passport, id: string): boolean => passport.owners.some((o) => o.ownerId === id);

/** The events in the order they happened: by day, then by when they were written down, then by id. */
export function timeline(passport: Passport): PassportEvent[] {
  return passport.events.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const wa = timestampKey(a.recordedAt), wb = timestampKey(b.recordedAt);
    if (wa !== wb) return wa < wb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function eventById(passport: Passport, id: string): PassportEvent | null {
  return passport.events.filter((e) => e.id === id)[0] ?? null;
}

/** Every odometer reading on the passport, in timeline order. verification.ts leaves out the ones that do not stand. */
export function mileageReadings(passport: Passport): { date: string; mileage: number; eventId: string }[] {
  const out: { date: string; mileage: number; eventId: string }[] = [];
  for (const e of timeline(passport)) if (e.mileage !== null) out.push({ date: e.date, mileage: e.mileage, eventId: e.id });
  return out;
}

/** The newest reading on or before a day. */
export function latestMileage(passport: Passport, asOf: string): { value: number; date: string; eventId: string } | null {
  let found: { value: number; date: string; eventId: string } | null = null;
  for (const r of mileageReadings(passport)) if (r.date <= asOf) found = { value: r.mileage, date: r.date, eventId: r.eventId };
  return found;
}

/** How many files the passport points at, optionally of certain kinds, optionally only on photo entries of one subject. */
export function attachmentCount(passport: Passport, kinds?: readonly AttachmentKind[], subject?: PhotoSubject): number {
  let n = 0;
  for (const e of passport.events) {
    if (subject !== undefined && !(e.type === 'photo' && e.subject === subject)) continue;
    for (const a of e.attachments) if (!kinds || kinds.indexOf(a.kind) !== -1) n += 1;
  }
  return n;
}

/** What the owner has most recently declared, taking each of the four statements from the newest entry that makes it. */
export function latestDeclaration(passport: Passport, asOf: string): { condition: ConditionBand | null; accident: AccidentHistory | null; titleStatus: TitleStatus | null; originality: 'stock' | 'modified' | null } {
  const out: { condition: ConditionBand | null; accident: AccidentHistory | null; titleStatus: TitleStatus | null; originality: 'stock' | 'modified' | null } = { condition: null, accident: null, titleStatus: null, originality: null };
  for (const e of timeline(passport)) {
    if (e.type !== 'declaration' || e.date > asOf) continue;
    if (e.condition !== null) out.condition = e.condition;
    if (e.accident !== null) out.accident = e.accident;
    if (e.titleStatus !== null) out.titleStatus = e.titleStatus;
    if (e.originality !== null) out.originality = e.originality;
  }
  return out;
}

/* ---------------------------------------------------------------------- writing ---- */

/** Appends one checked event. The only place an event joins a passport. */
export function appendEvent(passport: Passport, event: PassportEvent): Passport {
  return { ...passport, events: [...passport.events, event] };
}

/** True when a file id is already used somewhere on the passport. */
const fileIdTaken = (passport: Passport, id: string): boolean => passport.events.some((e) => e.attachments.some((a) => a.id === id));

/**
 * Writes an entry as the owner. Refused, with the reason and with nothing changed, when the writer is not the current
 * owner, the kind is not one an owner may write (an attestation or a withdrawal comes only from a verifier), the date
 * is not a real day or is in the future, the reading or a file is not valid, the id is taken, or a removal does not
 * match a modification that is still fitted. Text is cleaned and cut to length. Never throws.
 */
export function addEvent(passport: Passport, event: unknown, ctx: { now: string; by: string }): Result<Passport> {
  if (!isRecord(ctx) || !isIsoTimestamp(ctx.now)) return refuse(PASSPORT_REFUSALS.timestamp);
  if (!isId(ctx.by) || ctx.by !== currentOwner(passport)) return refuse(PASSPORT_REFUSALS.notOwner);
  if (!isRecord(event)) return refuse(PASSPORT_REFUSALS.shape);
  if (event.type === 'attestation' || event.type === 'void') return refuse(PASSPORT_REFUSALS.verifierOnly);
  if (!among(OWNER_EVENT_TYPES, event.type)) return refuse(PASSPORT_REFUSALS.kind);
  const read = readEvent(event, { recordedAt: ctx.now, by: ctx.by });
  if (!read.ok) return read;
  let entry = read.value;
  if (passport.events.length >= MAX_EVENTS - RESERVED_ENTRIES) return refuse(PASSPORT_REFUSALS.full);
  if (entry.date > dayOf(ctx.now)) return refuse(PASSPORT_REFUSALS.future);
  if (passport.events.some((e) => e.id === entry.id)) return refuse(PASSPORT_REFUSALS.id);
  if (entry.attachments.some((a) => fileIdTaken(passport, a.id))) return refuse(PASSPORT_REFUSALS.attachments);
  if (entry.type === 'modification' && entry.action === 'remove') {
    const undoes = entry.undoes, category = entry.category, day = entry.date;
    const install = passport.events.filter((e) => e.id === undoes)[0];
    if (!install || install.type !== 'modification' || install.action !== 'install' || install.category !== category || install.date > day) return refuse(PASSPORT_REFUSALS.undo);
    if (passport.events.some((e) => e.type === 'modification' && e.action === 'remove' && e.undoes === undoes)) return refuse(PASSPORT_REFUSALS.undo);
    // A removal describes the modification it undoes: its tier and fitter are the install's, whatever was sent.
    entry = { ...entry, tier: install.tier, install: install.install };
  }
  return { ok: true, value: appendEvent(passport, entry) };
}

/**
 * Hands the vehicle to another owner. The MiCar ID, every event, every snapshot and every edition stay with it; one
 * ownership period closes and the next opens on the same day, with no gap. Only the current owner can do it.
 */
export function transferOwnership(passport: Passport, input: { eventId: string; toOwnerId: string; date: string; attachments?: Attachment[] }, ctx: { now: string; by: string }): Result<Passport> {
  if (!isRecord(ctx) || !isIsoTimestamp(ctx.now)) return refuse(PASSPORT_REFUSALS.timestamp);
  if (!isId(ctx.by) || ctx.by !== currentOwner(passport)) return refuse(PASSPORT_REFUSALS.notOwner);
  if (!isRecord(input) || !isId(input.toOwnerId)) return refuse(PASSPORT_REFUSALS.owner);
  if (input.toOwnerId === ctx.by) return refuse(PASSPORT_REFUSALS.sameOwner);
  const read = readEvent({ id: input.eventId, type: 'transfer', date: input.date, attachments: input.attachments, title: EVENT_TYPE_LABELS.transfer, from: ctx.by, to: input.toOwnerId }, { recordedAt: ctx.now, by: ctx.by });
  if (!read.ok) return read;
  const entry = read.value;
  // A hand-over uses the room kept free for it, and stops at the limit a passport can be read back at.
  if (passport.events.length >= MAX_EVENTS) return refuse(PASSPORT_REFUSALS.full);
  if (entry.date > dayOf(ctx.now)) return refuse(PASSPORT_REFUSALS.future);
  const period = passport.owners[passport.owners.length - 1];
  if (entry.date < period.from) return refuse(PASSPORT_REFUSALS.beforeOwnership);
  if (passport.events.some((e) => e.id === entry.id)) return refuse(PASSPORT_REFUSALS.id);
  if (entry.attachments.some((a) => fileIdTaken(passport, a.id))) return refuse(PASSPORT_REFUSALS.attachments);
  const owners: OwnershipPeriod[] = [...passport.owners.slice(0, -1), { ...period, to: entry.date }, { ownerId: input.toOwnerId, from: entry.date, to: null }];
  return { ok: true, value: { ...appendEvent(passport, entry), owners } };
}

/** Replaces the factory specification (the owner corrected or completed it). No entry is touched and the identity of the passport does not change. */
export function updateSpec(passport: Passport, spec: VehicleSpec, ctx: { by: string }): Result<Passport> {
  if (!isRecord(ctx) || ctx.by !== currentOwner(passport)) return refuse(PASSPORT_REFUSALS.notOwner);
  const clean = readSpec(spec, yearOf(passport.createdAt));
  return clean ? { ok: true, value: { ...passport, spec: clean } } : refuse(PASSPORT_REFUSALS.spec);
}

/** Sets or clears the VIN. Only the current owner can. */
export function updateVin(passport: Passport, vin: string, ctx: { by: string }): Result<Passport> {
  if (!isRecord(ctx) || ctx.by !== currentOwner(passport)) return refuse(PASSPORT_REFUSALS.notOwner);
  const clean = readVin(vin);
  return clean === null ? refuse(PASSPORT_REFUSALS.vin) : { ok: true, value: { ...passport, vin: clean } };
}

/** Adds a grade snapshot to the history. Earlier snapshots are never touched. A history that is full is left as it is. */
export const appendSnapshot = (passport: Passport, snapshot: GradeSnapshot): Passport =>
  (passport.snapshots.length >= MAX_SNAPSHOTS ? passport : { ...passport, snapshots: [...passport.snapshots, snapshot] });
/** Adds a card edition. Earlier editions are never touched. A list that is full is left as it is. */
export const appendEdition = (passport: Passport, edition: CardEdition): Passport =>
  (passport.editions.length >= MAX_EDITIONS ? passport : { ...passport, editions: [...passport.editions, edition] });

/* ---------------------------------------------------------- storing and loading ---- */

export const serializePassport = (passport: Passport): string => JSON.stringify(passport);

const isScore = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= 100;

function readSnapshot(input: unknown): GradeSnapshot | null {
  if (!isRecord(input)) return null;
  const { id, at, asOf, formula, overall, grade10, tier, level, events } = input;
  if (!isId(id, 40) || !isIsoTimestamp(at) || !isIsoDate(asOf) || typeof formula !== 'string' || formula.length > 40) return null;
  if (!isScore(overall) || !isNumber(grade10) || grade10 < 1 || grade10 > 10 || !isNumber(tier) || !Number.isInteger(tier) || tier < 1 || tier > 10) return null;
  if (!among(CERTIFICATION_LEVELS, level) || !isNumber(events) || !Number.isInteger(events) || events < 0 || !isRecord(input.categories)) return null;
  const categories = {} as Record<GradeCategoryKey, number>;
  for (const k of GRADE_CATEGORIES) {
    const score = input.categories[k];
    if (!isScore(score)) return null;
    categories[k] = score;
  }
  return { id, at, asOf, reason: clipText(input.reason, 120), formula, overall, grade10, tier, categories, level: level as CertificationLevel, events };
}

function readEdition(input: unknown, position: number): CardEdition | null {
  if (!isRecord(input)) return null;
  const { number: no, issuedAt, level, rarity, finish, grade10, powerRating } = input;
  // Editions are numbered in the order they were printed: a file cannot skip ahead.
  if (no !== position || !isIsoTimestamp(issuedAt)) return null;
  if (!among(CERTIFICATION_LEVELS, level) || !among(RARITY_TIERS, rarity) || !among(FINISHES, finish)) return null;
  if (grade10 !== null && !(isNumber(grade10) && grade10 >= 1 && grade10 <= 10)) return null;
  if (powerRating !== null && !(isNumber(powerRating) && powerRating >= 0 && powerRating <= 1000)) return null;
  if (!isRecord(input.attributes)) return null;
  const attributes = {} as MaybeAttributes;
  for (const k of ATTRIBUTE_KEYS) {
    const v = input.attributes[k];
    if (v !== null && !(isNumber(v) && v >= 0 && v <= 1000)) return null;
    attributes[k] = v as number | null;
  }
  return {
    // A stored edition is given the name of its level, whatever the file called it.
    number: position, name: EDITION_NAMES[level as CertificationLevel], issuedAt, level: level as CertificationLevel, rarity: rarity as RarityTier, finish: finish as CardFinish,
    grade10: grade10 as number | null, powerRating: powerRating as number | null, attributes, reason: clipText(input.reason, 120),
  };
}

function readOwners(input: unknown): OwnershipPeriod[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 500) return null;
  const out: OwnershipPeriod[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw: unknown = input[i];
    if (!isRecord(raw) || !isId(raw.ownerId) || !isIsoDate(raw.from)) return null;
    const last = i === input.length - 1;
    // Every period but the last is closed, each starts the day the one before it ended, and none runs backwards.
    if (last ? raw.to !== null : !isIsoDate(raw.to) || raw.to < raw.from) return null;
    if (i > 0 && out[i - 1].to !== raw.from) return null;
    out.push({ ownerId: raw.ownerId, from: raw.from, to: last ? null : (raw.to as string) });
  }
  return out;
}

/**
 * Reads a stored or imported passport (an object, or the text serializePassport wrote), field by field, with the same
 * checks a new entry goes through. An event that fails is dropped and counted; anything else that fails refuses the
 * whole passport. The result is built from scratch and shares nothing with the input. Never throws.
 */
export function parsePassport(input: unknown): Result<{ passport: Passport; dropped: number }> {
  let data: unknown = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { return refuse(PASSPORT_REFUSALS.shape); }
  }
  if (!isRecord(data) || data.schema !== 1) return refuse(PASSPORT_REFUSALS.shape);
  if (typeof data.micarId !== 'string' || !isMicarId(data.micarId)) return refuse(PASSPORT_REFUSALS.micarId);
  if (!isIsoTimestamp(data.createdAt)) return refuse(PASSPORT_REFUSALS.timestamp);
  const spec = readSpec(data.spec, yearOf(data.createdAt));
  if (!spec) return refuse(PASSPORT_REFUSALS.spec);
  const vin = readVin(data.vin);
  if (vin === null) return refuse(PASSPORT_REFUSALS.vin);
  const owners = readOwners(data.owners);
  if (!owners) return refuse(PASSPORT_REFUSALS.owner);
  if (!Array.isArray(data.events) || !Array.isArray(data.snapshots) || !Array.isArray(data.editions)) return refuse(PASSPORT_REFUSALS.shape);
  // A file far larger than any passport is refused before any of it is read.
  if (data.events.length > MAX_EVENTS || data.snapshots.length > MAX_SNAPSHOTS || data.editions.length > MAX_EDITIONS) return refuse(PASSPORT_REFUSALS.full);

  const events: PassportEvent[] = [];
  const seen: Record<string, true> = {};
  let dropped = 0;
  for (const raw of data.events) {
    const read = readEvent(raw, null);
    if (read.ok && seen[`#${read.value.id}`] !== true) { seen[`#${read.value.id}`] = true; events.push(read.value); }
    else dropped += 1;
  }
  const snapshots: GradeSnapshot[] = [];
  for (const raw of data.snapshots) {
    const snap = readSnapshot(raw);
    if (!snap) return refuse(PASSPORT_REFUSALS.shape);
    snapshots.push(snap);
  }
  const editions: CardEdition[] = [];
  for (const raw of data.editions) {
    const edition = readEdition(raw, editions.length + 1);
    if (!edition) return refuse(PASSPORT_REFUSALS.shape);
    editions.push(edition);
  }
  return { ok: true, value: { passport: { schema: 1, micarId: data.micarId, createdAt: data.createdAt, spec, color: clipText(data.color, 40), vin, owners, events, snapshots, editions }, dropped } };
}
