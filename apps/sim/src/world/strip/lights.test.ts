import { describe, expect, it } from 'vitest';
import { lightsLit, soloCountLen, soloHold, usesLights } from './lights';

describe('start lights', () => {
  it('lights come on a second apart then hold', () => {
    expect(lightsLit(5.5, 1)).toBe(0);
    expect(lightsLit(5, 1)).toBe(1);
    expect(lightsLit(4, 1)).toBe(2);
    expect(lightsLit(1, 1)).toBe(5);
    expect(lightsLit(0.3, 1)).toBe(5);
    expect(lightsLit(0, 1)).toBe(0);
    expect(soloCountLen(0.5)).toBeCloseTo(4.9, 9);
    expect(soloHold(() => 1)).toBe(2);
  });

  it('only lap races use them', () => {
    expect((['circuit', 'sprint', 'streetx'] as const).every(usesLights)).toBe(true);
    expect(usesLights('drag')).toBe(false);
    expect(usesLights('drift')).toBe(false);
  });
});
