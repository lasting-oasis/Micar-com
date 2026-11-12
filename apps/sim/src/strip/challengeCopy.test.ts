import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { DenyWhy } from '../world/race';
import { CH_KEYS, carLabel, denyKey, raceLabel, rowsOf, shareUrl } from './challengeCopy';

const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('the challenge screens: their words', () => {
  it('every line is written in English and in Spanish, with the same blanks to fill', () => {
    expect(CH_KEYS.length).toBeGreaterThan(30);
    expect(new Set(CH_KEYS).size).toBe(CH_KEYS.length);
    for (const key of CH_KEYS) {
      const en = t('en', key), es = t('es', key);
      expect(en, key).not.toBe(key); expect(es, key).not.toBe(key); // t() answers a missing key with the key itself
      expect(holes(es), key).toEqual(holes(en));
    }
  });
  it('every refusal the server can send has a line', () => {
    const all: DenyWhy[] = ['gone', 'full', 'busy', 'slow', 'holding', 'host', 'few', 'state', 'pick'];
    for (const why of all) expect(CH_KEYS, why).toContain(denyKey(why));
    expect(t('en', denyKey('gone'))).toBe('That challenge has ended.');
    expect(t('en', denyKey('full'))).toBe('That race is full.');
    expect(t('en', denyKey('host'))).toBe('Only the host can do that.');
    expect(t('en', denyKey('holding'))).toBe('Finish what you are driving first.');
    expect(t('en', denyKey('busy'))).toBe('The Strip is busy. Try again in a minute.');
    expect(denyKey('slow')).toBe(denyKey('busy'));
    expect(t('es', denyKey('gone'))).toBe('Ese reto ya terminó.');
    expect(denyKey('something new' as DenyWhy)).toBe(denyKey('state')); // a reason this page does not know is still a no
  });
  it('the link is the Strip entry with the room in it', () => {
    expect(shareUrl('https://micar-sim.onrender.com', 'K7M2QX')).toBe('https://micar-sim.onrender.com/strip?race=K7M2QX');
    expect(shareUrl('http://localhost:3000', 'ABCDEF')).toBe('http://localhost:3000/strip?race=ABCDEF');
  });
  it('a race and a car are named as the Strip names them', () => {
    expect(raceLabel('royal_drag')).toBe('Drag: Royal Park Quarter');
    expect(raceLabel('harbour_gp')).toBe('Circuit: Harbour GP');
    expect(raceLabel('nope')).toBe('');
    expect(carLabel('ronin')).toBe('Ronin GT');
    expect(carLabel('brute')).toBe('Brute 440');
    expect(carLabel('tank')).toBe('');
  });
  it('a row shows a time, or that the racer is out, or still racing', () => {
    const words = { dnf: 'DNF', racing: 'Racing' };
    const rows = [
      { id: 'a', name: 'Ana', time: 21, score: 0, why: null },
      { id: 'b', name: 'Bo', time: 75.5, score: 0, why: null },
      { id: 'c', name: 'Cy', time: null, score: 0, why: 'quit' },
      { id: 'd', name: 'Di', time: null, score: 0, why: null },
    ];
    expect(rowsOf(rows, 'b', false, words)).toEqual([
      { name: 'Ana', me: false, txt: '21.00' }, { name: 'Bo', me: true, txt: '1:15.50' }, { name: 'Cy', me: false, txt: 'DNF' }, { name: 'Di', me: false, txt: 'Racing' },
    ]);
  });
  it('a drift row shows the score, not the time', () => {
    const words = { dnf: 'DNF', racing: 'Racing' };
    expect(rowsOf([{ id: 'a', name: 'Ana', time: 40, score: 3400, why: null }, { id: 'b', name: 'Bo', time: null, score: 900, why: 'failed' }], 'x', true, words))
      .toEqual([{ name: 'Ana', me: false, txt: '3,400' }, { name: 'Bo', me: false, txt: 'DNF' }]);
  });
});
