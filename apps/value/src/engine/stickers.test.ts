import { describe, expect, it } from 'vitest';
import { prefillMsrp } from './prefill';
import { STICKERS, findStickerTrim, stickerFor, stickerMsrp, stickerTrim, type StickerYear } from './stickers';

describe('stickerTrim after the findStickerTrim split', () => {
  // the implementation before the split, verbatim: the calculator's behaviour must not change
  const before = (y: StickerYear, trim: string) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const want = norm(trim);
    return (want && y.trims.find((t) => norm(t.trim) === want)) || y.trims.find((t) => want && norm(t.trim).startsWith(want)) || y.trims[0];
  };
  it('picks the same row as before for every year on file and every kind of trim input', () => {
    let checked = 0;
    for (const set of STICKERS) for (const y of set.years) {
      const inputs = ['', ' ', '-', 'zz-not-a-trim', '?', ...y.trims.flatMap((t) => [t.trim, t.trim.toUpperCase(), t.trim.toLowerCase(), t.trim.replace(/[^A-Za-z0-9]/g, ''), t.trim.slice(0, 1), t.trim.slice(0, 3), ` ${t.trim} `])];
      for (const s of inputs) { expect(stickerTrim(y, s), `${set.make} ${set.model} ${y.year} "${s}"`).toBe(before(y, s)); checked++; }
    }
    expect(checked).toBeGreaterThan(100_000);
  });
  it('findStickerTrim is stickerTrim without the base-trim fallback', () => {
    for (const set of STICKERS) for (const y of set.years) {
      for (const s of ['', 'zz-not-a-trim', ...y.trims.map((t) => t.trim)]) {
        const f = findStickerTrim(y, s);
        if (f) expect(f).toBe(stickerTrim(y, s));
        else expect(stickerTrim(y, s)).toBe(y.trims[0]);
      }
    }
  });
});

describe('stickers', () => {
  it('covers every Civic year from 2010 with the base trim first', () => {
    const civic = STICKERS.find((s) => s.model === 'Civic')!;
    const years = civic.years.map((y) => y.year);
    expect(years.slice(0, 3)).toEqual([2010, 2011, 2012]); // iSeeCars-derived years
    expect(years.filter((y) => y >= 2016)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]); // researched years
    for (const y of civic.years) {
      if (y.year >= 2016) expect(y.trims[0].trim).toBe('LX');
      else expect(y.trims[0].trim).toMatch(/^(DX|LX) 2dr Coupe/); // iSeeCars lists every body style; the coupe is cheapest
      for (let i = 1; i < y.trims.length; i++) expect(y.trims[i].msrp).toBeGreaterThanOrEqual(y.trims[i - 1].msrp);
    }
  });

  it('prefills the real sticker when one exists, else the typical estimate', () => {
    expect(prefillMsrp('Honda', 'Civic', 2019, 'Touring')).toMatchObject({ msrp: 27300, source: 'sticker' });
    expect(prefillMsrp('Honda', 'Civic', 2019, '')).toMatchObject({ msrp: 20250, source: 'sticker' });
    expect(prefillMsrp('Honda', 'Civic', 2012, '')).toMatchObject({ msrp: 15755, source: 'sticker' }); // DX coupe (cheapest style), from iSeeCars
    expect(prefillMsrp('Honda', 'Civic', 2012, 'DX 4dr Sedan 5M')).toMatchObject({ msrp: 15955, source: 'sticker' });
    expect(prefillMsrp('Lexus', 'IS', 2013, 'IS 350 4dr Sedan')).toMatchObject({ msrp: 40320, source: 'sticker' });
    expect(prefillMsrp('Honda', 'Civic', 2009, '')?.source).toBe('typical');
    expect(prefillMsrp('Toyota', 'Camry', 2022, 'SE')).toMatchObject({ msrp: 27385, source: 'sticker' });
    expect(prefillMsrp('Lexus', 'RX', 2022, '')?.source).toBe('sticker'); // filled from the archived iSeeCars page
    expect(prefillMsrp('Toyota', 'Nope', 2022, '')).toBeNull();
    expect(stickerMsrp(stickerFor('Honda', 'Civic', 2016)!.year, 'ex-l')).toBe(23700);
  });
});
