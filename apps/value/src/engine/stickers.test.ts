import { describe, expect, it } from 'vitest';
import { prefillMsrp } from './prefill';
import { STICKERS, stickerFor, stickerMsrp } from './stickers';

describe('stickers', () => {
  it('covers every Civic year from 2016 with the base trim first', () => {
    const civic = STICKERS.find((s) => s.model === 'Civic')!;
    expect(civic.years.map((y) => y.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    for (const y of civic.years) {
      expect(y.trims[0].trim).toBe('LX');
      for (let i = 1; i < y.trims.length; i++) expect(y.trims[i].msrp).toBeGreaterThan(y.trims[i - 1].msrp);
    }
  });

  it('prefills the real sticker when one exists, else the typical estimate', () => {
    expect(prefillMsrp('Honda', 'Civic', 2019, 'Touring')).toMatchObject({ msrp: 27300, source: 'sticker' });
    expect(prefillMsrp('Honda', 'Civic', 2019, '')).toMatchObject({ msrp: 20250, source: 'sticker' });
    expect(prefillMsrp('Honda', 'Civic', 2012, '')?.source).toBe('typical');
    expect(prefillMsrp('Toyota', 'Camry', 2022, 'SE')?.source).toBe('typical');
    expect(prefillMsrp('Toyota', 'Nope', 2022, '')).toBeNull();
    expect(stickerMsrp(stickerFor('Honda', 'Civic', 2016)!.year, 'ex-l')).toBe(23700);
  });
});
