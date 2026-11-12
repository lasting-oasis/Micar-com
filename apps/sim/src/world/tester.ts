// Tester mode: the owner's way to try any car in the Strip without earning it first. The server grants it to a guest
// who joins with its tester key (world/testerKey.ts checks the key); nothing here can grant it. Safe for the browser.
import type { Car, Player } from '../types';
import { CAR_CATALOG } from '../carCatalog';
import { STAGE_REP, freshStrip } from './data';
import { RENTAL_FLEET } from './rental';

/** What a tester always has on hand, and the REP that opens every stage (every event, every part tier). */
export const TESTER_MONEY = 1_000_000;
export const TESTER_REP = STAGE_REP[STAGE_REP.length - 1];
/** What a refused key is told on the Strip's entry card (a third reason, the wait after too many misses, is worded by the server). */
export const TESTER_REFUSED = 'That key was not accepted.';
export const TESTER_OFF = 'Tester mode is not switched on for this server.';
export const NAME_MAX = 24;

/** "Pool#key": the name to show, and the key typed after the first '#'. The key never becomes part of a name. */
export function splitTesterName(raw: unknown): { name: string; key?: string } {
  const s = typeof raw === 'string' ? raw : '';
  const i = s.indexOf('#');
  if (i < 0) return { name: s.trim().slice(0, NAME_MAX) };
  const key = s.slice(i + 1).trim();
  return { name: s.slice(0, i).trim().slice(0, NAME_MAX), ...(key ? { key } : {}) };
}

/** What the name field may hold as it is typed: a name of up to NAME_MAX characters, as ever, and after a '#' a key
 *  (128 characters at most, with a little slack for a stray space). */
export const KEY_FIELD_MAX = 130;
export function clipTyped(raw: string): string {
  const i = raw.indexOf('#');
  return i < 0 ? raw.slice(0, NAME_MAX) : raw.slice(0, Math.min(i, NAME_MAX)) + raw.slice(i, i + 1 + KEY_FIELD_MAX);
}

export function topUp(player: Player): void {
  if (player.tester && player.money < TESTER_MONEY) player.money = TESTER_MONEY;
}

export function grantTester(player: Player): void {
  player.tester = true;
  const strip = (player.strip ??= freshStrip());
  strip.rep = Math.max(strip.rep, TESTER_REP);
  topUp(player);
}

export type TestCarDef = { make: string; model: string; bodyStyle: string; color: string; fleet?: boolean };
const PAINT = ['#b91c1c', '#1d4ed8', '#f8fafc', '#0f172a', '#64748b', '#ea580c', '#15803d', '#facc15'];
/** Every car a tester may take: the rental fleet, then each model in the world's catalogue. */
export const TEST_CARS: ReadonlyArray<TestCarDef> = [
  ...RENTAL_FLEET.map(f => ({ make: f.make, model: f.model, bodyStyle: f.bodyStyle as string, color: f.color, fleet: true })),
  ...Object.entries(CAR_CATALOG).flatMap(([make, list]) => list.map((m, i) => ({ make, model: m.model, bodyStyle: m.style, color: PAINT[i % PAINT.length] }))),
];
export function testCarDef(make: unknown, model: unknown): TestCarDef | undefined {
  return TEST_CARS.find(c => c.make === make && c.model === model);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Stable for one owner and one model, so the parts fitted to a model are still there when the tester comes back to it. */
const testCarId = (ownerId: string, def: TestCarDef) => `tester-${ownerId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-${slug(def.make)}-${slug(def.model)}`;

/** An owned car (not a rental: it is kept across events and the Garage opens on it), stock and full, worth nothing. */
export function makeTestCar(ownerId: string, def: TestCarDef, now: number): Car {
  return {
    id: testCarId(ownerId, def), make: def.make, model: def.model, year: 2026, bodyStyle: def.bodyStyle, color: def.color,
    condition: 100, bodyCondition: 100, mechanicCondition: 100, mileage: 0, buyPrice: 0,
    ownerId, daysOnLot: 0, titleStatus: 'Clean',
    vin: 'TESTCAR' + String(now % 1e10).padStart(10, '0'), // 17 characters, like a real VIN
    isRegistered: true, fuel: 100, district: 'strip', testCar: true,
  };
}

export function heldTestCar(player: Pick<Player, 'inventory'>): Car | undefined {
  return player.inventory.find(c => !!c?.testCar); // a saved inventory can hold junk entries
}

/** One test car at a time: the new one replaces the old. Part records stay on file under each car's stable id. */
export function setTestCar(player: Player, def: TestCarDef, now: number): Car {
  const car = makeTestCar(player.id, def, now);
  player.inventory = player.inventory.filter(c => !c.testCar);
  player.inventory.push(car);
  return car;
}

export function returnTestCar(player: Player): Car | undefined {
  const car = heldTestCar(player);
  if (car) player.inventory = player.inventory.filter(c => c !== car);
  return car;
}
