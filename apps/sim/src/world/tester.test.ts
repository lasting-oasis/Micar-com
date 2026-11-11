import { describe, it, expect } from 'vitest';
import { KEY_FIELD_MAX, NAME_MAX, TESTER_MONEY, TESTER_REP, TEST_CARS, clipTyped, grantTester, heldTestCar, makeTestCar, returnTestCar, setTestCar, splitTesterName, testCarDef, topUp } from './tester';
import { STAGE_REP, stageOf } from './data';
import { RENTAL_FLEET } from './rental';
import { guestPlayer } from './stripFlow';

describe('the tester name', () => {
  it('splits a name from the key typed after the first #, and the key never stays in the name', () => {
    expect(splitTesterName('Pool#open-sesame')).toEqual({ name: 'Pool', key: 'open-sesame' });
    expect(splitTesterName('  Pool  #  open sesame  ')).toEqual({ name: 'Pool', key: 'open sesame' });
    expect(splitTesterName('Pool#a#b')).toEqual({ name: 'Pool', key: 'a#b' });
    expect(splitTesterName('#only-a-key')).toEqual({ name: '', key: 'only-a-key' });
  });
  it('a name without a key is only trimmed and clipped to 24 characters; a bare # carries no key', () => {
    expect(splitTesterName('  Queen City Motors ')).toEqual({ name: 'Queen City Motors' });
    expect(splitTesterName('Pool#')).toEqual({ name: 'Pool' });
    expect(splitTesterName('x'.repeat(40)).name).toHaveLength(24);
    expect(splitTesterName('x'.repeat(40) + '#k')).toEqual({ name: 'x'.repeat(24), key: 'k' });
    expect(splitTesterName(undefined)).toEqual({ name: '' });
    expect(splitTesterName(42)).toEqual({ name: '' });
  });
  it('the name field holds 24 characters of name, as before, and room for a key only after a #', () => {
    expect(clipTyped('Queen City Motors')).toBe('Queen City Motors');
    expect(clipTyped('x'.repeat(40))).toBe('x'.repeat(NAME_MAX));
    expect(clipTyped('Pool#' + 'k'.repeat(128))).toBe('Pool#' + 'k'.repeat(128)); // the longest key fits whole
    expect(clipTyped('Pool#' + 'k'.repeat(500))).toBe('Pool#' + 'k'.repeat(KEY_FIELD_MAX));
    expect(clipTyped('x'.repeat(40) + '#open-sesame')).toBe('x'.repeat(NAME_MAX) + '#open-sesame'); // a long name never pushes the key out
    expect(clipTyped('#only-a-key')).toBe('#only-a-key');
    expect(clipTyped('')).toBe('');
    // clipping what was typed never changes how it is read
    for (const raw of ['Pool#open-sesame', 'x'.repeat(40) + '#open-sesame', '  Pool  #  open sesame  ', 'Pool#a#b', 'Queen City Motors'])
      expect(splitTesterName(clipTyped(raw))).toEqual(splitTesterName(raw));
  });
});

describe('what a tester is given', () => {
  it('money that is never short and the REP that opens every stage', () => {
    const p = guestPlayer('sock-1', 'Pool', 1);
    grantTester(p);
    expect(p.tester).toBe(true);
    expect(p.money).toBe(TESTER_MONEY);
    expect(p.strip!.rep).toBe(TESTER_REP);
    expect(stageOf(p.strip!.rep)).toBe(STAGE_REP.length);
  });
  it('tops up only a tester, and only upward', () => {
    const p = guestPlayer('sock-1', 'Pool', 1); grantTester(p);
    p.money = 12; topUp(p); expect(p.money).toBe(TESTER_MONEY);
    p.money = TESTER_MONEY + 5000; topUp(p); expect(p.money).toBe(TESTER_MONEY + 5000);
    const g = guestPlayer('sock-2', 'Guest', 1); g.money = 12; topUp(g); expect(g.money).toBe(12);
  });
});

describe('test cars', () => {
  it('offers the rental fleet and every model in the world catalogue, each once', () => {
    expect(TEST_CARS.filter(c => c.fleet).map(c => `${c.make} ${c.model}`)).toEqual(RENTAL_FLEET.map(f => `${f.make} ${f.model}`));
    expect(TEST_CARS.length).toBe(RENTAL_FLEET.length + 36);
    expect(new Set(TEST_CARS.map(c => `${c.make}|${c.model}`)).size).toBe(TEST_CARS.length);
    expect(testCarDef('Chevy', 'Corvette')).toMatchObject({ bodyStyle: 'sports' });
    expect(testCarDef('Chevy', 'Nope')).toBeUndefined();
    expect(testCarDef(undefined, null)).toBeUndefined();
  });
  it('a test car is owned, not rented: stock, full, in the Strip, worth nothing, with an id that is stable for its owner and model', () => {
    const def = testCarDef('Ford', 'Mustang')!;
    const car = makeTestCar('sock-abcdef-1', def, 1700000000000);
    expect(car).toMatchObject({ make: 'Ford', model: 'Mustang', bodyStyle: 'sports', testCar: true, district: 'strip', buyPrice: 0, fuel: 100, ownerId: 'sock-abcdef-1', condition: 100 });
    expect(car.rental).toBeUndefined();
    expect(car.vin).toHaveLength(17);
    expect(makeTestCar('sock-abcdef-1', def, 5).id).toBe(car.id);
    expect(makeTestCar('other-socket', def, 5).id).not.toBe(car.id);
    expect(makeTestCar('sock-abcdef-1', testCarDef('BMW', '3 Series')!, 5).id).toMatch(/^tester-[a-z0-9]+-bmw-3-series$/i);
  });
  it('one test car at a time: a new one replaces the old; returning it leaves the garage empty and the build on file', () => {
    const p = guestPlayer('sock-1', 'Pool', 1); grantTester(p);
    const a = setTestCar(p, testCarDef('Chevy', 'Corvette')!, 1);
    p.strip!.cars[a.id] = { cfg: {} as any, tune: {} as any, owned: ['perf.engine=3'] };
    expect(heldTestCar(p)).toBe(a);
    const b = setTestCar(p, testCarDef('Ford', 'Mustang')!, 2);
    expect(p.inventory).toEqual([b]);
    expect(returnTestCar(p)).toBe(b);
    expect(p.inventory).toEqual([]);
    expect(returnTestCar(p)).toBeUndefined();
    expect(p.strip!.cars[a.id].owned).toEqual(['perf.engine=3']); // back in the Corvette later, its parts are still there
  });
  it('leaves any other car alone', () => {
    const p = guestPlayer('sock-1', 'Pool', 1); grantTester(p);
    p.inventory.push({ id: 'rental-1', rental: true } as any);
    setTestCar(p, testCarDef('Honda', 'Civic')!, 1);
    expect(p.inventory.map(c => c.id)).toContain('rental-1');
    returnTestCar(p);
    expect(p.inventory.map(c => c.id)).toEqual(['rental-1']);
  });
});
