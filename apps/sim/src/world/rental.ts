import type { Car, Player } from '../types';
import { HUB } from './strip/district';

export const GUEST_STAKE = 500;

export type RentalKey = 'civet' | 'kanjo' | 'ronin' | 'tsubasa' | 'brute';

export const RENTAL_FLEET: ReadonlyArray<{ key: RentalKey; make: string; model: string; color: string; bodyStyle: 'hatchback' | 'coupe' | 'sedan' | 'sports'; price: number; blurb: string }> = [
  { key: 'civet', make: 'Civet', model: 'R', color: '#ffd23f', bodyStyle: 'hatchback', price: 300, blurb: 'strip.car.civet' },
  { key: 'kanjo', make: 'Kanjo', model: 'S', color: '#f3f6fb', bodyStyle: 'hatchback', price: 400, blurb: 'strip.car.kanjo' },
  { key: 'ronin', make: 'Ronin', model: 'GT', color: '#2a9df4', bodyStyle: 'coupe', price: 500, blurb: 'strip.car.ronin' },
  { key: 'tsubasa', make: 'Tsubasa', model: 'R4', color: '#e8463c', bodyStyle: 'sedan', price: 700, blurb: 'strip.car.tsubasa' },
  { key: 'brute', make: 'Brute', model: '440', color: '#0c0c0e', bodyStyle: 'sports', price: 900, blurb: 'strip.car.brute' },
];

export function priceOf(key: RentalKey): number {
  return RENTAL_FLEET.find(f => f.key === key)!.price;
}

export const RENTAL_BAY = HUB.rental.bay;
export const RENTAL_CAM = HUB.rental.cam;
export const RENTAL_KIOSK = HUB.rental.kiosk;

export function isRental(car: Car | undefined): boolean {
  return !!car?.rental;
}

/** A Strip visitor: a guest or a Strip account holder (no lot, no dealership): the Strip's UI only, never the town. */
export function isVisitor(player: Pick<Player, 'guest' | 'accountId'> | undefined): boolean {
  return !!player && (!!player.guest || !!player.accountId);
}

export function heldRental(player: Player): Car | undefined {
  return player.inventory.find(c => isRental(c));
}

export function canRent(player: Player, key?: RentalKey): { ok: true } | { ok: false; reason: 'Not enough money' | 'You already have a rental' } {
  if (heldRental(player)) return { ok: false, reason: 'You already have a rental' };
  if (player.money < (key ? priceOf(key) : Math.min(...RENTAL_FLEET.map(f => f.price)))) return { ok: false, reason: 'Not enough money' };
  return { ok: true };
}

/** A stock fleet car in the Strip, in the player's hands: a rental, whoever pays for it. */
function fleetCar(player: Player, key: RentalKey, now: number, vin: string): Car {
  const def = RENTAL_FLEET.find(f => f.key === key)!;
  const car: Car = {
    id: `rental-${now}-${key}`, make: def.make, model: def.model, year: 2026, bodyStyle: def.bodyStyle, color: def.color,
    condition: 100, bodyCondition: 100, mechanicCondition: 100, mileage: 0, buyPrice: 0,
    ownerId: player.id, daysOnLot: 0, titleStatus: 'Clean',
    vin, // 17 characters, like a real VIN
    isRegistered: true, fuel: 100, district: 'strip', rental: true,
  };
  player.inventory.push(car);
  return car;
}

export function rent(player: Player, key: RentalKey, now: number): Car {
  player.money -= priceOf(key);
  return fleetCar(player, key, now, 'RENTAL' + String(now % 1e11).padStart(11, '0'));
}

export function returnRental(player: Player): Car | undefined {
  const car = heldRental(player);
  if (car) player.inventory = player.inventory.filter(c => c !== car);
  return car;
}

/** The fleet car lent for a challenge race (`code`: its room): a rental that costs nothing, in the colour of its grid place. */
export function lend(player: Player, key: RentalKey, code: string, color: string, now: number): Car {
  const car = fleetCar(player, key, now, 'LOAN' + String(now % 1e13).padStart(13, '0'));
  car.color = color; car.loan = code;
  return car;
}

export function heldLoan(player: Pick<Player, 'inventory'>): Car | undefined {
  return player.inventory.find(c => !!c?.loan);
}

/** Takes the lent car back, and its part record with it. */
export function returnLoan(player: Player): Car | undefined {
  const car = heldLoan(player);
  if (!car) return undefined;
  player.inventory = player.inventory.filter(c => c !== car);
  if (player.strip?.cars) delete player.strip.cars[car.id];
  return car;
}
