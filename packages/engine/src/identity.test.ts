import { describe, expect, it } from 'vitest';
import { isMicarId, micarIdFromBytes, normalizeMicarId } from './identity';
import { BASE32 } from './util';

const make = (bytes: number[]) => {
  const r = micarIdFromBytes(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('the MiCar ID', () => {
  it('is MC- and three groups of four from an alphabet with no look-alike letters', () => {
    const id = make([1, 2, 3, 4, 5, 6, 7]);
    expect(id).toMatch(/^MC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isMicarId(id)).toBe(true);
    expect(make([0, 0, 0, 0, 0, 0, 0])).toBe('MC-0000-0000-0000');
    expect(make([255, 255, 255, 255, 255, 255, 255])).toMatch(/^MC-ZZZZ-ZZZZ-ZZZ/);
  });

  it('is the same for the same bytes, different for different ones, and ignores bytes past the seventh', () => {
    expect(make([9, 8, 7, 6, 5, 4, 3])).toBe(make([9, 8, 7, 6, 5, 4, 3]));
    expect(make([9, 8, 7, 6, 5, 4, 3])).not.toBe(make([9, 8, 7, 6, 5, 4, 5]));
    expect(make([9, 8, 7, 6, 5, 4, 3, 200, 201])).toBe(make([9, 8, 7, 6, 5, 4, 3]));
    expect(make(Array.from(new Uint8Array([9, 8, 7, 6, 5, 4, 3])))).toBe(make([9, 8, 7, 6, 5, 4, 3]));
  });

  it('needs seven real bytes', () => {
    expect(micarIdFromBytes([1, 2, 3, 4, 5, 6]).ok).toBe(false);
    expect(micarIdFromBytes([]).ok).toBe(false);
    expect(micarIdFromBytes([1, 2, 3, 4, 5, 6, 256]).ok).toBe(false);
    expect(micarIdFromBytes([1, 2, 3, 4, 5, 6, -1]).ok).toBe(false);
    expect(micarIdFromBytes([1, 2, 3, 4, 5, 6, 1.5]).ok).toBe(false);
    expect(micarIdFromBytes(null as unknown as number[]).ok).toBe(false);
  });

  it('catches any single wrong character, whatever it is changed to', () => {
    const id = make([12, 34, 56, 78, 90, 123, 231]);
    let tried = 0;
    for (const at of [3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 16]) {
      for (const other of BASE32) {
        if (other === id[at]) continue;
        tried++;
        expect(isMicarId(id.slice(0, at) + other + id.slice(at + 1)), `position ${at} as ${other}`).toBe(false);
      }
    }
    expect(tried).toBe(12 * 31);
  });

  it('refuses anything that is not in canonical form', () => {
    const id = make([12, 34, 56, 78, 90, 123, 231]);
    expect(isMicarId(id.toLowerCase())).toBe(false);
    expect(isMicarId(id.replace(/-/g, ''))).toBe(false);
    expect(isMicarId(`${id} `)).toBe(false);
    expect(isMicarId('')).toBe(false);
    expect(isMicarId(42 as unknown as string)).toBe(false);
    expect(isMicarId('XX-0000-0000-0000')).toBe(false);
  });

  it('forgives how people type one', () => {
    const id = make([12, 34, 56, 78, 90, 123, 231]);
    expect(normalizeMicarId(id)).toBe(id);
    expect(normalizeMicarId(id.toLowerCase())).toBe(id);
    expect(normalizeMicarId(id.replace(/-/g, ''))).toBe(id);
    expect(normalizeMicarId(` ${id.replace(/-/g, ' ')} `)).toBe(id);
    expect(normalizeMicarId('mc-oooo-OOOO-oooo')).toBe('MC-0000-0000-0000');
    expect(normalizeMicarId('MC-0000-0000-000I')).toBeNull(); // I reads as 1, and the check character is then wrong
    expect(normalizeMicarId('MC-0000-0000-0001')).toBeNull();
    expect(normalizeMicarId('not an id')).toBeNull();
    expect(normalizeMicarId(null as unknown as string)).toBeNull();
  });

  it('is not made from a VIN', () => {
    // The only input is bytes. The same VIN parked twice gets two different IDs because the host hands in fresh bytes.
    expect(micarIdFromBytes.length).toBe(1);
  });
});
