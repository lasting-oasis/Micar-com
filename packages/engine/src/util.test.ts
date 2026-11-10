import { describe, expect, it } from 'vitest';
import { clamp, clipText, daysBetween, hashString, idFromBytes, interpolate, isIsoDate, isIsoTimestamp, monthsBetween, mulberry32, numberIn, round1, score1000, yearsBetween } from './util';

describe('numbers and text', () => {
  it('keeps a value inside its range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(round1(7.449)).toBe(7.4);
  });

  it('refuses a number outside its range instead of clipping it', () => {
    expect(numberIn(600, 1, 5000)).toBe(600);
    expect(numberIn(0, 1, 5000)).toBeNull();
    expect(numberIn(60000, 1, 5000)).toBeNull();
    expect(numberIn(Number.NaN, 1, 5000)).toBeNull();
    expect(numberIn('600', 1, 5000)).toBeNull();
  });

  it('cleans text from anything', () => {
    expect(clipText('  oil\tchange\n ', 20)).toBe('oil change');
    expect(clipText('abcdef', 3)).toBe('abc');
    expect(clipText(42, 10)).toBe('');
    expect(clipText(null, 10)).toBe('');
  });
});

describe('scoring tables', () => {
  const rising = [[0, 0], [100, 400], [200, 500]] as const;
  const falling = [[2, 1000], [4, 800], [10, 200]] as const;

  it('draws straight lines between anchors and stays flat beyond them', () => {
    expect(interpolate(50, rising)).toBe(200);
    expect(interpolate(150, rising)).toBe(450);
    expect(interpolate(-5, rising)).toBe(0);
    expect(interpolate(999, rising)).toBe(500);
  });

  it('reads a table where less is better', () => {
    expect(interpolate(3, falling)).toBe(900);
    expect(interpolate(1, falling)).toBe(1000);
    expect(interpolate(30, falling)).toBe(200);
  });

  it('never lets a better figure score lower', () => {
    let last = -1;
    for (let x = 0; x <= 250; x += 5) {
      const s = score1000(x, rising);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it('returns whole scores from 0 to 1000', () => {
    expect(score1000(33, rising)).toBe(132);
    expect(score1000(5, [[0, -50], [10, 2000]])).toBe(975);
    expect(score1000(10, [[0, -50], [10, 2000]])).toBe(1000);
    expect(score1000(0, [[0, -50], [10, 2000]])).toBe(0);
    expect(interpolate(1, [])).toBe(0);
  });
});

describe('chance', () => {
  it('gives the same run for the same seed and a different run for another', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const ra = [a(), a(), a()], rb = [b(), b(), b()], rc = [c(), c(), c()];
    expect(ra).toEqual(rb);
    expect(ra).not.toEqual(rc);
    for (const v of ra) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('hashes text to a stable unsigned seed', () => {
    expect(hashString('MC-0000')).toBe(hashString('MC-0000'));
    expect(hashString('MC-0000')).not.toBe(hashString('MC-0001'));
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('drag')).toBeGreaterThanOrEqual(0);
  });
});

describe('dates', () => {
  it('accepts only real days', () => {
    expect(isIsoDate('2026-11-10')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('11/10/2026')).toBe(false);
    expect(isIsoDate(20261110)).toBe(false);
  });

  it('accepts timestamps Date can read', () => {
    expect(isIsoTimestamp('2026-11-10T14:03:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-11-10')).toBe(false);
    expect(isIsoTimestamp('2026-02-30T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('2026-11-10Tnonsense-here')).toBe(false);
  });

  it('counts days, months and years between two days', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01T23:59:00.000Z', '2026-01-02T00:01:00.000Z')).toBe(1);
    expect(monthsBetween('2024-11-10', '2026-11-10')).toBe(24);
    expect(monthsBetween('2024-11-10', '2026-11-09')).toBe(23);
    expect(monthsBetween('2026-11-10', '2026-11-10')).toBe(0);
    expect(yearsBetween('2020-01-01', '2026-01-01')).toBeCloseTo(6, 1);
  });
});

describe('ids', () => {
  it('writes bytes in an alphabet with no look-alike letters', () => {
    const id = idFromBytes([0, 255, 16, 32, 64, 128, 1, 2, 3, 4]);
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    expect(idFromBytes([0, 255, 16, 32, 64, 128, 1, 2, 3, 4])).toBe(id);
    expect(idFromBytes([1])).toHaveLength(2);
    expect(idFromBytes([])).toBe('');
  });
});
