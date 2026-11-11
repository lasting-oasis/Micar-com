// The Garage's state and the only code that touches localStorage. Everything a page does to a car goes through one
// of these actions, and every action is a thin wrapper over the engine: the rules live in @micar/engine.
// Storage is handed in, so tests pass a fake and the page passes the browser's. Accounts can replace this module
// later without touching the screens: the engine already keys everything by owner id.
//
// Nothing here uploads anything. The passports (and the VINs inside them) stay in this browser.
import {
  EMPTY_REGISTRY, addEvent, assemble, canonicalJson, createPassport, currentOwner, issueEdition, parsePassport, recordSnapshot, transferOwnership, updateSpec, updateVin,
} from '@micar/engine';
import type { Assembly, Attachment, Passport, Result, VehicleSpec, VerifierRegistry } from '@micar/engine';
import { normalizeGarageId } from './ids';
import { SNAPSHOT_REASONS } from './words';

export const GARAGE_KEY = 'micar.garage.v1';
/** Where a saved garage that could not be read is set aside, untouched, instead of being overwritten. */
export const QUARANTINE_KEY = 'micar.garage.unreadable';

/** The site ships with no verifiers: nothing parked here can be called Verified or Certified until one is connected. */
export const REGISTRY: VerifierRegistry = EMPTY_REGISTRY;

export type GarageStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type GarageState = {
  version: 1;
  /** This device's owner id. Until accounts exist it stands in for one: a buyer gives it to a seller to receive a car. */
  ownerId: string;
  /**
   * Garage IDs this browser held before it took up another from a backup. They are never thrown away and they still
   * work: a car whose owner is one of them is this garage's car. A buyer gives an ID out before any car arrives, so
   * an ID that was simply replaced would leave a car on its way to it with no garage able to receive it.
   */
  formerIds: string[];
  passports: Passport[];
};
export type Loaded = {
  state: GarageState;
  /** Saved cars that failed validation and were left out. */
  skipped: number;
  /** False when the browser is not keeping the garage (no storage, or it is blocked). */
  persisted: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const OWNER = /^[A-Za-z0-9-]{4,80}$/;
/** The most former Garage IDs a browser keeps. No more is taken up past it, so none that was kept is ever dropped on reading the garage back. */
export const MAX_FORMER_IDS = 50;

export const emptyGarage = (ownerId: string): GarageState => ({ version: 1, ownerId, formerIds: [], passports: [] });

/** Garage IDs out of anything: the well-formed ones, once each, leaving out `not`. */
function readIds(list: unknown, not: string): string[] {
  const out: string[] = [];
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (out.length >= MAX_FORMER_IDS) break;
    if (typeof raw === 'string' && OWNER.test(raw) && raw !== not && out.indexOf(raw) === -1) out.push(raw);
  }
  return out;
}

/** Every Garage ID this browser answers to: the one it gives out, then the ones it held before. */
export const garageIds = (state: GarageState): string[] => [state.ownerId, ...state.formerIds];

/** Reads cars out of anything shaped like a saved garage. Bad ones are counted, never thrown on. */
function readPassports(list: unknown): { passports: Passport[]; skipped: number } {
  const passports: Passport[] = [];
  let skipped = 0;
  if (!Array.isArray(list)) return { passports, skipped };
  for (const raw of list) {
    const parsed = parsePassport(raw);
    if (parsed.ok && !passports.some((p) => p.micarId === parsed.value.passport.micarId)) passports.push(parsed.value.passport);
    else skipped += 1;
  }
  return { passports, skipped };
}

/** Loads the garage. Never throws: with no storage, or a save it cannot read, it starts empty and says so. */
export function loadGarage(storage: GarageStorage | null, makeOwnerId: () => string): Loaded {
  let text: string | null = null;
  let persisted = storage !== null;
  try { text = storage ? storage.getItem(GARAGE_KEY) : null; } catch { persisted = false; }
  if (text === null) return { state: emptyGarage(makeOwnerId()), skipped: 0, persisted };
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!isRecord(data) || typeof data.ownerId !== 'string' || !OWNER.test(data.ownerId)) {
    // Not a garage this code can read: set it aside rather than write over it.
    try { storage?.setItem(QUARANTINE_KEY, text); } catch { /* storage full or blocked */ }
    return { state: emptyGarage(makeOwnerId()), skipped: 1, persisted };
  }
  const { passports, skipped } = readPassports(data.passports);
  if (skipped > 0) { try { storage?.setItem(QUARANTINE_KEY, text); } catch { /* storage full or blocked */ } }
  return { state: { version: 1, ownerId: data.ownerId, formerIds: readIds(data.formerIds, data.ownerId), passports }, skipped, persisted };
}

/** Saves the garage. Returns false when the browser would not keep it. */
export function saveGarage(storage: GarageStorage | null, state: GarageState): boolean {
  if (!storage) return false;
  try { storage.setItem(GARAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

/* -------------------------------------------------------------------- reading ---- */

export const findCar = (state: GarageState, micarId: string): Passport | null => state.passports.filter((p) => p.micarId === micarId)[0] ?? null;
/** True while this garage still holds the car, under the ID it gives out or one it held before. After a transfer it stays listed, read-only, until removed. */
export const ownsCar = (state: GarageState, passport: Passport): boolean => garageIds(state).indexOf(currentOwner(passport)) !== -1;
/**
 * What this garage is to a car: its owner, a past owner who handed it on, or neither (a passport file brought in
 * from someone else, or a backup opened in a browser that has not taken up the garage it came from).
 */
export function holdingOf(state: GarageState, passport: Passport): 'owner' | 'transferred' | 'other' {
  if (ownsCar(state, passport)) return 'owner';
  const mine = garageIds(state);
  return passport.owners.some((o) => mine.indexOf(o.ownerId) !== -1) ? 'transferred' : 'other';
}
/** The ID this garage writes to a car as: the one that owns it when that is one of this garage's, else the one it gives out (and the engine refuses). */
const writerOf = (state: GarageState, passport: Passport): string => (ownsCar(state, passport) ? currentOwner(passport) : state.ownerId);
/** Everything the engine knows about one car today. */
export const assembleCar = (passport: Passport, today: string): Assembly => assemble(passport, REGISTRY, today);

/* -------------------------------------------------------------------- actions ---- */

const put = (state: GarageState, passport: Passport): GarageState => ({ ...state, passports: state.passports.map((p) => (p.micarId === passport.micarId ? passport : p)) });

/** After any change: keep today's grade in the history and print a new edition if a milestone was reached. */
function settle(passport: Passport, now: string, snapshotId: string, reason: string): Passport {
  return issueEdition(recordSnapshot(passport, REGISTRY, { now, id: snapshotId, reason }), REGISTRY, { now, reason });
}

export type ParkInput = { micarId: string; eventId: string; snapshotId: string; now: string; spec: VehicleSpec; color: string; vin: string };

/** Parks a car: gives it its passport, its first grade snapshot and its first card. */
export function park(state: GarageState, input: ParkInput): Result<GarageState> {
  if (findCar(state, input.micarId)) return { ok: false, reason: 'That MiCar ID is already parked here' };
  const made = createPassport({ micarId: input.micarId, now: input.now, ownerId: state.ownerId, spec: input.spec, color: input.color, vin: input.vin, eventId: input.eventId });
  if (!made.ok) return made;
  return { ok: true, value: { ...state, passports: [...state.passports, settle(made.value, input.now, input.snapshotId, SNAPSHOT_REASONS.parked)] } };
}

/** Writes an entry on a car's passport as this device's owner. */
export function record(state: GarageState, micarId: string, event: unknown, ctx: { now: string; snapshotId: string; reason: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  const added = addEvent(passport, event, { now: ctx.now, by: writerOf(state, passport) });
  if (!added.ok) return added;
  return { ok: true, value: put(state, settle(added.value, ctx.now, ctx.snapshotId, ctx.reason)) };
}

/** Replaces the factory specification (the owner corrected or completed it). Scores follow; no entry is touched. */
export function replaceSpec(state: GarageState, micarId: string, spec: VehicleSpec, ctx: { now: string; snapshotId: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  const updated = updateSpec(passport, spec, { by: writerOf(state, passport) });
  if (!updated.ok) return updated;
  return { ok: true, value: put(state, settle(updated.value, ctx.now, ctx.snapshotId, SNAPSHOT_REASONS.spec)) };
}

export function replaceVin(state: GarageState, micarId: string, vin: string, ctx: { now: string; snapshotId: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  const updated = updateVin(passport, vin, { by: writerOf(state, passport) });
  if (!updated.ok) return updated;
  return { ok: true, value: put(state, settle(updated.value, ctx.now, ctx.snapshotId, SNAPSHOT_REASONS.vin)) };
}

/** Hands a car to another owner. Its MiCar ID and its whole history go with it; this device can no longer write to it. */
export function transfer(state: GarageState, micarId: string, input: { eventId: string; toOwnerId: string; date: string; attachments: Attachment[] }, ctx: { now: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  // A hand-over cannot be undone, so the ID has to be a real one: the right shape, and a check character that agrees.
  const toOwnerId = normalizeGarageId(input.toOwnerId);
  if (toOwnerId === null) return { ok: false, reason: 'That is not a Garage ID' };
  if (garageIds(state).indexOf(toOwnerId) !== -1) return { ok: false, reason: 'That is this garage' };
  const moved = transferOwnership(passport, { ...input, toOwnerId }, { now: ctx.now, by: writerOf(state, passport) });
  if (!moved.ok) return moved;
  return { ok: true, value: put(state, moved.value) };
}

/** Takes a car out of this garage. The files it pointed at are removed by the page (see filesOnlyOf). */
export const removeCar = (state: GarageState, micarId: string): GarageState => ({ ...state, passports: state.passports.filter((p) => p.micarId !== micarId) });

/**
 * The files to delete when a car leaves the garage: the ones its passport names that no other car here names.
 * A passport file comes from someone else and can name any file ID, including the ID of a photograph or receipt
 * that belongs to another car in this garage (IDs travel in every passport file the owner has shared). Deleting by
 * the departing passport's word alone would let such a file take the other car's files with it.
 */
export function filesOnlyOf(state: GarageState, micarId: string): string[] {
  const elsewhere: Record<string, true> = {};
  for (const p of state.passports) {
    if (p.micarId === micarId) continue;
    for (const e of p.events) for (const a of e.attachments) elsewhere[`#${a.id}`] = true;
  }
  const out: string[] = [];
  const seen: Record<string, true> = {};
  const car = findCar(state, micarId);
  if (!car) return out;
  for (const e of car.events) {
    for (const a of e.attachments) {
      if (elsewhere[`#${a.id}`] === true || seen[`#${a.id}`] === true) continue;
      seen[`#${a.id}`] = true;
      out.push(a.id);
    }
  }
  return out;
}

/* ----------------------------------------------------------- export and import ---- */

/**
 * The whole garage, or one car, as a file the owner keeps. It holds everything, the VIN included: it is theirs.
 * The whole-garage file is a backup, so it carries this garage's IDs and can bring the garage back in another
 * browser. A single car's passport file is what a seller sends a buyer, and carries no Garage ID of its own.
 */
export function exportGarage(state: GarageState, exportedAt: string, only?: string): string {
  if (only) return JSON.stringify({ micarGarage: 1, exportedAt, passports: state.passports.filter((p) => p.micarId === only) }, null, 1);
  return JSON.stringify({ micarGarage: 1, exportedAt, ownerId: state.ownerId, formerIds: state.formerIds, passports: state.passports }, null, 1);
}

/** True when `further` is the same passport as `here`, further along: it holds every entry `here` holds, unchanged and in the same place, and more. */
function continues(here: Passport, further: Passport): boolean {
  if (further.events.length <= here.events.length) return false;
  return here.events.every((e, i) => canonicalJson(further.events[i]) === canonicalJson(e));
}

/**
 * The garage a backup file came from, as far as this browser does not answer to it already: the ID that garage
 * gave out, and the IDs it held before that this browser lacks.
 */
export type Restorable = { ownerId: string; formerIds: string[] };

/**
 * Brings cars in from an export. A car already here is replaced only by a copy that continues it: the same entries,
 * untouched, and more after them. A file that tells a different story about a car parked here is left out, so an
 * import can never overwrite a history. Anything that is not a garage export changes nothing.
 *
 * An import never changes this garage's IDs. When the file is a backup that names Garage IDs this browser does not
 * answer to, `restorable` names them, and the page may offer to take them up (takeUpGarage) after asking. It is
 * offered only when one of those IDs is a real Garage ID that still owns a car in the file, and then in two cases:
 *   - the file answers to one of this garage's own IDs. It is this garage's backup, made in a browser that has
 *     since come to answer to more IDs than this one does;
 *   - the file shares no ID with this garage and no car in it belongs to this garage. A file that hands this garage
 *     a car is a seller's file, not a backup.
 */
export function importGarage(state: GarageState, text: string): Result<{ state: GarageState; added: number; updated: number; skipped: number; restorable: Restorable | null }> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'That file is not a garage export' }; }
  if (!isRecord(data) || data.micarGarage !== 1 || !Array.isArray(data.passports)) return { ok: false, reason: 'That file is not a garage export' };
  const read = readPassports(data.passports);
  let passports = state.passports, added = 0, updated = 0, skipped = read.skipped;
  for (const incoming of read.passports) {
    const here = passports.filter((p) => p.micarId === incoming.micarId)[0];
    if (!here) { passports = [...passports, incoming]; added += 1; }
    else if (continues(here, incoming)) { passports = passports.map((p) => (p.micarId === incoming.micarId ? incoming : p)); updated += 1; }
    else skipped += 1;
  }
  let restorable: Restorable | null = null;
  const theirs = typeof data.ownerId === 'string' && normalizeGarageId(data.ownerId) === data.ownerId ? data.ownerId : null;
  if (theirs !== null) {
    const mine = garageIds(state);
    const held = [theirs, ...readIds(data.formerIds, theirs).filter((id) => normalizeGarageId(id) === id)];
    const lacking = held.filter((id) => mine.indexOf(id) === -1);
    const own = lacking.length < held.length;
    const ownsOne = read.passports.some((p) => lacking.indexOf(currentOwner(p)) !== -1);
    const handsOver = read.passports.some((p) => mine.indexOf(currentOwner(p)) !== -1);
    const offer: Restorable = { ownerId: theirs, formerIds: lacking.filter((id) => id !== theirs) };
    // Offered only when taking it up would change something: a browser that answers to as many IDs as it can keep is offered no more.
    if (ownsOne && (own || !handsOver) && takeUpGarage(state, offer) !== state) restorable = offer;
  }
  return { ok: true, value: { state: { ...state, passports }, added, updated, skipped, restorable } };
}

/**
 * Takes up the garage a backup came from. Its ID becomes the one this browser gives out, and the ID it gave out
 * until now is kept among the former ones, where it goes on working. When this browser answers to that ID already,
 * the file is a backup of this very garage: the ID it gives out stays, and only the IDs it lacks are added.
 * Nothing is lost by it. When there is nothing to take up, or no room to keep another ID, the state comes back as
 * it was given: the same object, so a caller can tell.
 */
export function takeUpGarage(state: GarageState, garage: Restorable): GarageState {
  const theirs = normalizeGarageId(garage.ownerId);
  if (theirs === null) return state;
  const ownerId = garageIds(state).indexOf(theirs) !== -1 ? state.ownerId : theirs;
  const formerIds: string[] = [];
  for (const id of [state.ownerId, ...state.formerIds, ...(Array.isArray(garage.formerIds) ? garage.formerIds : [])]) {
    if (typeof id === 'string' && id !== ownerId && OWNER.test(id) && formerIds.indexOf(id) === -1) formerIds.push(id);
  }
  if (formerIds.length > MAX_FORMER_IDS) return state;
  if (ownerId === state.ownerId && formerIds.length === state.formerIds.length) return state;
  return { ...state, ownerId, formerIds };
}

/** The reasons an action here can be refused, for translation. Refusals that come from the engine pass through as they are. */
export const STORE_REFUSALS = [
  'That MiCar ID is already parked here', 'No car with that ID is parked here', 'That is not a Garage ID', 'That is this garage', 'That file is not a garage export',
] as const;
