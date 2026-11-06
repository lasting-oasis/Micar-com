import { describe, it, expect } from 'vitest';
import { closeEvent, guestPlayer, quitEvent } from './stripFlow';
import { rent } from './rental';
describe('stripFlow', () => {
  it('a guest has $500, no lot, and stands at the rental bay in the Strip', () => {
    const g = guestPlayer('abcd1234', '', 5);
    expect(g).toMatchObject({ money: 500, guest: true, name: 'Guest_abcd', inventory: [], octane: 0, stamps: [] });
    expect(g.worldPosition).toMatchObject({ district: 'strip', x: 1350, z: 1350 });
  });
  it('closing an event in a rental returns it; in an owned car it does not', () => {
    const g = guestPlayer('p', 'P', 1); const car = rent(g, 'coupe', 2); g.money += 1800;
    expect(closeEvent(g, car.id)).toEqual({ returned: car }); expect(g.inventory).toEqual([]); expect(g.money).toBe(1800);
    g.inventory.push({ id: 'own' } as any);
    expect(closeEvent(g, 'own')).toEqual({ returned: undefined }); expect(g.inventory).toHaveLength(1);
  });
  it('returning a rental drops its part record; no car is a no-op', () => {
    const g = guestPlayer('p', 'P', 1); const car = rent(g, 'sports', 3);
    g.strip!.cars[car.id] = { cfg: {}, owned: ['x'] } as any; g.strip!.cars['own'] = { cfg: {}, owned: [] } as any;
    expect(closeEvent(g, undefined)).toEqual({ returned: undefined }); expect(g.inventory).toHaveLength(1);
    expect(closeEvent(g, car.id)).toEqual({ returned: car });
    expect(g.strip!.cars[car.id]).toBeUndefined(); expect(g.strip!.cars['own']).toBeDefined();
  });
  it('quitting returns the rental, restarting keeps it for the next entry', () => {
    const g = guestPlayer('p', 'P', 1); const car = rent(g, 'hatchback', 4);
    expect(quitEvent(g, car.id, true)).toEqual({ returned: undefined }); expect(g.inventory).toEqual([car]);
    expect(quitEvent(g, car.id, false)).toEqual({ returned: car }); expect(g.inventory).toEqual([]);
  });
});

import { VISITOR_EVENTS, hostIsVacant, isUntouchedGuest, linkTarget, pickHost } from './stripFlow';
describe('visitor rules', () => {
  it('a visitor may send only the Strip events', () => {
    expect([...VISITOR_EVENTS].sort()).toEqual([
      'chat_message', 'claim_allowance', 'consume_fuel', 'enter_event', 'finish_event', 'finish_outrun', 'join', 'link_account',
      'quit_event', 'refuel', 'rent_car', 'request_link', 'sign_out', 'strip_buy_part', 'strip_equip', 'strip_tune',
      'sync_car_pos', 'sync_player_pos',
    ]);
    for (const e of ['take_title_loan', 'fractionalize_car', 'liquidate_vehicle', 'buy_car', 'end_day', 'scrap_car', 'finalize_deal', 'buy_shares'])
      expect(VISITOR_EVENTS.has(e)).toBe(false);
  });
  it('the host is the first dealer, never a visitor; a dealer claims a vacant or visitor host', () => {
    const players = { g: { guest: true }, a: { accountId: 'x' }, d1: {}, d2: {} } as any;
    expect(pickHost(players)).toBe('d1');
    expect(pickHost(players, 'd1')).toBe('d2');
    expect(pickHost({ g: { guest: true }, a: { accountId: 'x' } } as any)).toBeNull();
    expect(hostIsVacant(null, players)).toBe(true);
    expect(hostIsVacant('gone', players)).toBe(true);
    expect(hostIsVacant('g', players)).toBe(true);
    expect(hostIsVacant('a', players)).toBe(true);
    expect(hostIsVacant('d2', players)).toBe(false);
  });
  it('an untouched guest has the stake and nothing else', () => {
    const g = guestPlayer('p', 'P', 1);
    expect(isUntouchedGuest(g)).toBe(true);
    expect(isUntouchedGuest({ ...g, money: 499 })).toBe(false);
    expect(isUntouchedGuest({ ...g, stamps: ['s'] })).toBe(false);
    expect(isUntouchedGuest({ ...g, octane: 5 })).toBe(false);
    expect(isUntouchedGuest({ ...g, strip: { ...g.strip!, rep: 10 } })).toBe(false);
    expect(isUntouchedGuest({ ...g, guest: false })).toBe(false);
    const r = guestPlayer('p', 'P', 1); rent(r, 'coupe', 2); r.money = 500;
    expect(isUntouchedGuest(r)).toBe(false);
  });
  it('a magic link signs in the guest that asked for it while that tab is still a connected guest', () => {
    const req = (o: Partial<{ socketId: string; connected: boolean; guest: boolean }> = {}) => ({ socketId: 'req', connected: true, guest: true, ...o });
    expect(linkTarget(req(), 'click')).toBe('requester');
    expect(linkTarget(req({ connected: false }), 'click')).toBe('clicker');
    expect(linkTarget(req({ guest: false }), 'click')).toBe('clicker');
    expect(linkTarget(req({ socketId: 'click' }), 'click')).toBe('clicker');
    expect(linkTarget(undefined, 'click')).toBe('clicker');
  });
});
