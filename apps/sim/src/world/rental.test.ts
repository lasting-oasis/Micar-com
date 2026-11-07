import { describe, it, expect } from 'vitest';
import { FLEET_SPECS, FLEET_NAMES, specFor, specCacheSize } from './data';
import { GUEST_STAKE, RENTAL_FLEET, priceOf, canRent, rent, returnRental, heldRental, isVisitor } from './rental';
const player = (money: number) => ({ id: 'p1', money, inventory: [] as any[], octane: 0, stamps: [] } as any);
describe('rental', () => {
  it('is the artifact five cars, priced by the car', () => {
    expect(RENTAL_FLEET.map(f => f.key)).toEqual(['civet', 'kanjo', 'ronin', 'tsubasa', 'brute']);
    expect(priceOf('civet')).toBe(300); expect(priceOf('brute')).toBe(900);
    expect(RENTAL_FLEET.map(f => `${f.make} ${f.model}`)).toEqual(['Civet R', 'Kanjo S', 'Ronin GT', 'Tsubasa R4', 'Brute 440']);
    expect(RENTAL_FLEET.map(f => f.bodyStyle)).toEqual(['hatchback', 'hatchback', 'coupe', 'sedan', 'sports']);
    expect(RENTAL_FLEET.map(f => f.blurb)).toEqual(RENTAL_FLEET.map(f => `strip.car.${f.key}`));
  });
  it('a guest with the stake can afford a $500 car', () => {
    expect(GUEST_STAKE).toBe(500); expect(canRent(player(GUEST_STAKE), 'ronin')).toEqual({ ok: true });
  });
  it('refuses a car you cannot afford, without charging', () => {
    const p = player(500);
    expect(canRent(p, 'brute')).toEqual({ ok: false, reason: 'Not enough money' });
    expect(p.money).toBe(500);
    expect(canRent(p, 'ronin')).toEqual({ ok: true });
  });
  it('with no key checks the cheapest car ($300)', () => {
    expect(canRent(player(299))).toEqual({ ok: false, reason: 'Not enough money' });
    expect(canRent(player(300))).toEqual({ ok: true });
  });
  it('refuses when a rental is already held', () => {
    const p = player(2000); rent(p, 'ronin', 1000);
    expect(canRent(p)).toEqual({ ok: false, reason: 'You already have a rental' });
    expect(canRent(p, 'civet')).toEqual({ ok: false, reason: 'You already have a rental' });
  });
  it('debits the price of the car and adds a stock rental car in the Strip', () => {
    const p = player(500); const car = rent(p, 'ronin', 1700000000000);
    expect(p.money).toBe(0); expect(p.inventory).toHaveLength(1);
    expect(car).toMatchObject({ make: 'Ronin', model: 'GT', rental: true, bodyStyle: 'coupe', district: 'strip', ownerId: 'p1', buyPrice: 0, fuel: 100 });
    expect(heldRental(p)).toBe(car);
    expect(car.vin).toHaveLength(17); expect(car.vin).toBe('RENTAL' + String(1700000000000 % 1e11).padStart(11, '0'));
    expect(rent(player(500), 'ronin', 7).vin).toBe('RENTAL00000000007');
    const q = player(1000); expect(rent(q, 'brute', 1).bodyStyle).toBe('sports'); expect(q.money).toBe(100);
  });
  it('return removes the rental and keeps winnings', () => {
    const p = player(500); rent(p, 'civet', 1); p.money += 1800;
    expect(returnRental(p)?.rental).toBe(true); expect(p.inventory).toHaveLength(0); expect(p.money).toBe(2000);
    expect(returnRental(p)).toBeUndefined();
  });
});

describe('isVisitor', () => {
  it('is a guest or a Strip account holder, never a dealer', () => {
    expect(isVisitor({ guest: true })).toBe(true);
    expect(isVisitor({ guest: false, accountId: 'acct-1' })).toBe(true);
    expect(isVisitor({ guest: false })).toBe(false);
    expect(isVisitor({})).toBe(false);
    expect(isVisitor(undefined)).toBe(false);
  });
  it('FLEET_NAMES mirrors RENTAL_FLEET', () => {
    expect(RENTAL_FLEET.map(f => f.make + ' ' + f.model)).toEqual(Object.keys(FLEET_NAMES));
    expect(RENTAL_FLEET.map(f => f.key)).toEqual(Object.values(FLEET_NAMES));
  });
  it('the game drives the authored fleet specs, ungripped', () => {
    for (const f of RENTAL_FLEET) {
      const s = specFor(rent(player(2000), f.key, Date.now()));
      expect(s).toEqual(FLEET_SPECS[f.key]); expect(s.gripMul).toBeUndefined();
    }
  });
  it('specFor caches per car type', () => {
    const car = { make: 'Honda', model: 'Civic', bodyStyle: 'sedan' };
    const a = specFor(car); const n = specCacheSize();
    const t = performance.now(); const b = specFor(car); const dt = performance.now() - t;
    expect(b).toEqual(a); expect(b).not.toBe(a); expect(specCacheSize()).toBe(n); expect(dt).toBeLessThan(2);
  });
});
