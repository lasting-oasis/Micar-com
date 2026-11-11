import { describe, expect, it } from 'vitest';
import { bankIntervals, checkFiring, firingTable } from './firing';
import type { EngineFacts } from './facts';

const eng = (o: Partial<EngineFacts>): EngineFacts => ({ cylinders: 4, layout: 'inline', crank: null, displacementL: 2, induction: 'na', ...o });
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe('firingTable', () => {
  it('spaces an inline-four evenly, 180 degrees apart, into one bank', () => {
    const t = firingTable(eng({}));
    expect(t.map(e => e.angle)).toEqual([0, 180, 360, 540]);
    expect(new Set(t.map(e => e.bank)).size).toBe(1);
  });
  it('gives each bank of a cross-plane V8 the 90-180-180-270 pattern', () => {
    const t = firingTable(eng({ cylinders: 8, layout: 'v', crank: 'cross' }));
    expect(sorted(bankIntervals(t, 0))).toEqual([90, 180, 180, 270]);
    expect(sorted(bankIntervals(t, 1))).toEqual([90, 180, 180, 270]);
  });
  it('gives each bank of a flat-plane V8 four even 180 degree gaps', () => {
    const t = firingTable(eng({ cylinders: 8, layout: 'v', crank: 'flat' }));
    expect(bankIntervals(t, 0)).toEqual([180, 180, 180, 180]);
  });
  it('fires a flat-four right, right, left, left', () => {
    expect(firingTable(eng({ layout: 'flat' })).map(e => e.bank)).toEqual([0, 0, 1, 1]);
  });
  it('alternates the banks of a V6 so each bank fires every 240 degrees', () => {
    const t = firingTable(eng({ cylinders: 6, layout: 'v' }));
    expect(bankIntervals(t, 0)).toEqual([240, 240, 240]);
  });
  it('follows a published firing order and its cylinder numbering', () => {
    // Ford Coyote: 1-5-4-8-6-3-7-2, cylinders 1-4 on the right bank, 5-8 on the left
    const t = firingTable(eng({ cylinders: 8, layout: 'v', crank: 'cross', firingOrder: [1, 5, 4, 8, 6, 3, 7, 2], bankOf: [0, 0, 0, 0, 1, 1, 1, 1] }));
    expect(t.map(e => e.bank)).toEqual([0, 1, 0, 1, 1, 0, 1, 0]);
  });
});

describe('checkFiring', () => {
  const ford = [0, 0, 0, 0, 1, 1, 1, 1];
  it('accepts real cross-plane orders', () => {
    expect(checkFiring(eng({ cylinders: 8, layout: 'v', crank: 'cross', firingOrder: [1, 5, 4, 8, 6, 3, 7, 2], bankOf: ford }))).toBeNull();
    expect(checkFiring(eng({ cylinders: 8, layout: 'v', crank: 'cross', firingOrder: [1, 8, 7, 2, 6, 5, 4, 3], bankOf: [0, 1, 0, 1, 0, 1, 0, 1] }))).toBeNull();
  });
  it('rejects the flat-plane order 1-5-4-8-3-7-2-6 on a cross-plane crank', () => {
    expect(checkFiring(eng({ cylinders: 8, layout: 'v', crank: 'cross', firingOrder: [1, 5, 4, 8, 3, 7, 2, 6], bankOf: ford }))).toMatch(/cross-plane/);
  });
  it('accepts that order on a flat-plane crank', () => {
    expect(checkFiring(eng({ cylinders: 8, layout: 'v', crank: 'flat', firingOrder: [1, 5, 4, 8, 3, 7, 2, 6], bankOf: ford }))).toBeNull();
  });
  it('rejects an order that does not name every cylinder once', () => {
    expect(checkFiring(eng({ firingOrder: [1, 3, 3, 2] }))).toMatch(/every cylinder/);
  });
});
