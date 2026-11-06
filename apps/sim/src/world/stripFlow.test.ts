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
