import { describe, it, expect } from 'vitest';
import { RENTAL_PRICE, GUEST_STAKE, RENTAL_FLEET, canRent, rent, returnRental, heldRental, isVisitor } from './rental';
const player = (money: number) => ({ id: 'p1', money, inventory: [] as any[], octane: 0, stamps: [] } as any);
describe('rental', () => {
  it('costs $500 and a guest starts with exactly one rental', () => { expect(RENTAL_PRICE).toBe(500); expect(GUEST_STAKE).toBe(RENTAL_PRICE); expect(RENTAL_FLEET.map(f => f.key)).toEqual(['hatchback', 'coupe', 'sports']); });
  it('refuses at $499 and when a rental is already held', () => {
    expect(canRent(player(499))).toEqual({ ok: false, reason: 'Not enough money' });
    const p = player(1000); rent(p, 'coupe', 1000);
    expect(canRent(p)).toEqual({ ok: false, reason: 'You already have a rental' });
  });
  it('debits exactly $500 and adds a stock rental car in the Strip', () => {
    const p = player(500); const car = rent(p, 'sports', 1700000000000);
    expect(p.money).toBe(0); expect(p.inventory).toHaveLength(1);
    expect(car).toMatchObject({ rental: true, bodyStyle: 'sports', district: 'strip', ownerId: 'p1', buyPrice: 0, fuel: 100 });
    expect(heldRental(p)).toBe(car);
  });
  it('return removes the rental and keeps winnings', () => {
    const p = player(500); rent(p, 'hatchback', 1); p.money += 1800;
    expect(returnRental(p)?.rental).toBe(true); expect(p.inventory).toHaveLength(0); expect(p.money).toBe(1800);
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
});
