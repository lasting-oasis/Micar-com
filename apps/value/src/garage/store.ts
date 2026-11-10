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

export const emptyGarage = (ownerId: string): GarageState => ({ version: 1, ownerId, passports: [] });

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
  return { state: { version: 1, ownerId: data.ownerId, passports }, skipped, persisted };
}

/** Saves the garage. Returns false when the browser would not keep it. */
export function saveGarage(storage: GarageStorage | null, state: GarageState): boolean {
  if (!storage) return false;
  try { storage.setItem(GARAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

/* -------------------------------------------------------------------- reading ---- */

export const findCar = (state: GarageState, micarId: string): Passport | null => state.passports.filter((p) => p.micarId === micarId)[0] ?? null;
/** True while this device's owner still holds the car. After a transfer it stays listed, read-only, until removed. */
export const ownsCar = (state: GarageState, passport: Passport): boolean => currentOwner(passport) === state.ownerId;
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
  const added = addEvent(passport, event, { now: ctx.now, by: state.ownerId });
  if (!added.ok) return added;
  return { ok: true, value: put(state, settle(added.value, ctx.now, ctx.snapshotId, ctx.reason)) };
}

/** Replaces the factory specification (the owner corrected or completed it). Scores follow; no entry is touched. */
export function replaceSpec(state: GarageState, micarId: string, spec: VehicleSpec, ctx: { now: string; snapshotId: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  const updated = updateSpec(passport, spec, { by: state.ownerId });
  if (!updated.ok) return updated;
  return { ok: true, value: put(state, settle(updated.value, ctx.now, ctx.snapshotId, SNAPSHOT_REASONS.spec)) };
}

export function replaceVin(state: GarageState, micarId: string, vin: string, ctx: { now: string; snapshotId: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  const updated = updateVin(passport, vin, { by: state.ownerId });
  if (!updated.ok) return updated;
  return { ok: true, value: put(state, settle(updated.value, ctx.now, ctx.snapshotId, SNAPSHOT_REASONS.vin)) };
}

/** Hands a car to another owner. Its MiCar ID and its whole history go with it; this device can no longer write to it. */
export function transfer(state: GarageState, micarId: string, input: { eventId: string; toOwnerId: string; date: string; attachments: Attachment[] }, ctx: { now: string }): Result<GarageState> {
  const passport = findCar(state, micarId);
  if (!passport) return { ok: false, reason: 'No car with that ID is parked here' };
  if (!OWNER.test(input.toOwnerId)) return { ok: false, reason: 'That is not a Garage ID' };
  if (input.toOwnerId === state.ownerId) return { ok: false, reason: 'That is this garage' };
  const moved = transferOwnership(passport, input, { now: ctx.now, by: state.ownerId });
  if (!moved.ok) return moved;
  return { ok: true, value: put(state, moved.value) };
}

/** Takes a car out of this garage. The files it pointed at are removed by the page. */
export const removeCar = (state: GarageState, micarId: string): GarageState => ({ ...state, passports: state.passports.filter((p) => p.micarId !== micarId) });

/* ----------------------------------------------------------- export and import ---- */

/** The whole garage, or one car, as a file the owner keeps. It holds everything, the VIN included: it is theirs. */
export function exportGarage(state: GarageState, exportedAt: string, only?: string): string {
  const passports = only ? state.passports.filter((p) => p.micarId === only) : state.passports;
  return JSON.stringify({ micarGarage: 1, exportedAt, passports }, null, 1);
}

/** True when `further` is the same passport as `here`, further along: it holds every entry `here` holds, unchanged and in the same place, and more. */
function continues(here: Passport, further: Passport): boolean {
  if (further.events.length <= here.events.length) return false;
  return here.events.every((e, i) => canonicalJson(further.events[i]) === canonicalJson(e));
}

/**
 * Brings cars in from an export. A car already here is replaced only by a copy that continues it: the same entries,
 * untouched, and more after them. A file that tells a different story about a car parked here is left out, so an
 * import can never overwrite a history. Anything that is not a garage export changes nothing.
 */
export function importGarage(state: GarageState, text: string): Result<{ state: GarageState; added: number; updated: number; skipped: number }> {
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
  return { ok: true, value: { state: { ...state, passports }, added, updated, skipped } };
}

/** The reasons an action here can be refused, for translation. Refusals that come from the engine pass through as they are. */
export const STORE_REFUSALS = [
  'That MiCar ID is already parked here', 'No car with that ID is parked here', 'That is not a Garage ID', 'That is this garage', 'That file is not a garage export',
] as const;
