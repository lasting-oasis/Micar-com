import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { DenyWhy, RoomView } from '../world/race';
import { CH_KEYS, cardOf, carLabel, denyKey, newsOf, quickRows, raceLabel, rowsOf, shareUrl, startsInSeconds, waitingText } from './challengeCopy';

const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('quick race: its words and its countdown', () => {
  it('the quick race lines are among the challenge lines, so each is in English and in Spanish', () => {
    for (const key of ['strip.ch.quick', 'strip.ch.quickTitle', 'strip.ch.waiting', 'strip.ch.startsIn', 'strip.ch.quickNote']) expect(CH_KEYS).toContain(key);
    expect(t('en', 'strip.ch.quick')).toBe('Quick race');
    expect(t('es', 'strip.ch.quickTitle')).toBe('Elija un circuito'); // usted
  });
  it('the countdown is in whole seconds, rounded up, and never below zero', () => {
    expect(startsInSeconds(31_000, 1_000)).toBe(30);
    expect(startsInSeconds(31_000, 1_001)).toBe(30); // 29.999 s left reads 30
    expect(startsInSeconds(31_000, 30_001)).toBe(1);
    expect(startsInSeconds(31_000, 31_000)).toBe(0);
    expect(startsInSeconds(31_000, 45_000)).toBe(0); // the server's tick is a second: it can be late, never negative
  });
  it('the circuits: the open ones first, in the Races menu order, then the locked ones by the stage that opens them', () => {
    const atOne = quickRows(1);
    expect(atOne.map(r => r.track)).toEqual(['monaco', 'interlagos', 'laguna', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'bathurst', 'cota', 'spa']);
    expect(atOne.filter(r => !r.locked).map(r => r.eventId)).toEqual(['harbour_gp', 'lagoons_sprint', 'drylagoon_x']);
    expect(atOne.find(r => r.track === 'spa')).toEqual({ track: 'spa', eventId: 'ardennes_gp', stage: 5, locked: true });
    // all open: the Races menu's own order
    expect(quickRows(5).map(r => r.track)).toEqual(['spa', 'monza', 'silverstone', 'suzuka', 'nurburgring', 'monaco', 'interlagos', 'cota', 'laguna', 'bathurst']);
    expect(quickRows(5).every(r => !r.locked)).toBe(true);
  });
  it('"{n} waiting" says how many, in either language', () => {
    expect(waitingText('en', 3)).toBe('3 waiting');
    expect(waitingText('es', 0)).toBe('0 esperando');
  });
});

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
    const all: DenyWhy[] = ['gone', 'full', 'busy', 'slow', 'holding', 'host', 'few', 'state', 'pick', 'size', 'idle'];
    for (const why of all) expect(CH_KEYS, why).toContain(denyKey(why));
    expect(t('en', denyKey('idle'))).toBe('You are out of the quick race: your page did not load it in time.');
    expect(t('es', denyKey('idle'))).toBe('Quedó fuera de la carrera rápida: su página no la cargó a tiempo.');
    expect(t('en', denyKey('size'))).toBe('That grid is smaller than the room, or too big for this race.');
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

describe("a challenge's results card and its news of the other racers, from the room", () => {
  const words = { dnf: 'DNF', racing: 'Racing' };
  const member = (id: string, state: string, time: number | null = null, score = 0, why: string | null = null) => ({ id, name: id.toUpperCase(), slot: 0, state, time, score, why });
  const row = (id: string, pos: number, time: number | null, why: string | null = null, score = 0) => ({ id, name: id.toUpperCase(), pos, time, score, why });
  const room = (over: Record<string, unknown>) => ({ code: 'K7M2QX', eventId: 'royal_drag', car: 'ronin', hostId: 'a', phase: 'racing', raceNo: 2,
    members: [], goAt: 0, closesAt: null, last: null, note: null, ...over }) as unknown as RoomView;

  it('while the race is on: those home first by time, then those still racing, then those who are out; no winner yet', () => {
    const r = room({ members: [member('a', 'racing'), member('b', 'finished', 14.2), member('c', 'dnf', null, 0, 'quit'), member('d', 'finished', 13.9), member('e', 'waiting')] });
    expect(cardOf(r, 2, 'b', words)).toEqual({ title: 'place', place: 2, of: 4, eventId: 'royal_drag', pending: true,
      rows: [{ name: 'D', me: false, txt: '13.90' }, { name: 'B', me: true, txt: '14.20' }, { name: 'A', me: false, txt: 'Racing' }, { name: 'C', me: false, txt: 'DNF' }] });
    expect(cardOf(r, 2, 'd', words)).toMatchObject({ title: 'place', place: 1, of: 4, pending: true }); // first home is not "won" until the race has closed
    expect(cardOf(r, 2, 'c', words)).toMatchObject({ title: 'out', pending: true });
    expect(cardOf(r, 2, 'e', words)).toMatchObject({ title: 'out', place: 0, pending: true }); // not in this race at all
    expect(r.members.map(m => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']); // the room itself is not reordered
  });
  it('once the room has closed this race: its result, and who won', () => {
    const last = { raceNo: 2, eventId: 'royal_drag', rows: [row('d', 1, 13.9), row('b', 2, 14.2), row('a', 3, null, 'timeout'), row('c', 4, null, 'quit')] };
    const r = room({ phase: 'open', eventId: 'harbour_gp', members: ['a', 'b', 'c', 'd'].map(id => member(id, 'waiting')), last }); // the host has already picked another race
    expect(cardOf(r, 2, 'd', words)).toEqual({ title: 'won', place: 1, of: 4, eventId: 'royal_drag', pending: false,
      rows: [{ name: 'D', me: true, txt: '13.90' }, { name: 'B', me: false, txt: '14.20' }, { name: 'A', me: false, txt: 'DNF' }, { name: 'C', me: false, txt: 'DNF' }] });
    expect(cardOf(r, 2, 'b', words)).toMatchObject({ title: 'place', place: 2, of: 4, pending: false });
    expect(cardOf(r, 2, 'a', words)).toMatchObject({ title: 'out', pending: false });
    expect(cardOf(r, 2, 'zz', words)).toMatchObject({ title: 'out', place: 0, pending: false });
  });
  it("the room's last result is another race's until this one closes", () => {
    const last = { raceNo: 1, eventId: 'royal_drag', rows: [row('a', 1, 15), row('b', 2, 16)] };
    const r = room({ members: [member('a', 'racing'), member('b', 'finished', 14.2)], last });
    expect(cardOf(r, 2, 'b', words)).toMatchObject({ title: 'place', place: 1, of: 2, pending: true, rows: [{ name: 'B', me: true, txt: '14.20' }, { name: 'A', me: false, txt: 'Racing' }] });
  });
  it('a drift is ranked by score, and shows it', () => {
    const r = room({ eventId: 'harbour_drift', members: [member('a', 'finished', 40, 900), member('b', 'finished', 44, 3400), member('c', 'racing')] });
    expect(raceLabel('harbour_drift')).not.toBe(''); // a drift the Strip has
    expect(cardOf(r, 2, 'a', words)).toMatchObject({ title: 'place', place: 2, of: 3, rows: [{ name: 'B', me: false, txt: '3,400' }, { name: 'A', me: true, txt: '900' }, { name: 'C', me: false, txt: 'Racing' }] });
  });
  it('news of another racer: home with a time, out of the race, or nothing yet', () => {
    const r = room({ members: [member('a', 'racing'), member('b', 'finished', 14.2), member('c', 'dnf', null, 0, 'quit'), member('d', 'waiting'), member('e', 'loading'), member('f', 'ready')] });
    expect(newsOf(r, 2, 'a')).toBeNull();
    expect(newsOf(r, 2, 'e')).toBeNull(); expect(newsOf(r, 2, 'f')).toBeNull();
    expect(newsOf(r, 2, 'b')).toEqual({ time: 14.2 });
    expect(newsOf(r, 2, 'c')).toEqual({ time: null });
    expect(newsOf(r, 2, 'd')).toEqual({ time: null });  // left behind at the start
    expect(newsOf(r, 2, 'gone')).toEqual({ time: null }); // left the room
    // the race closed: the result decides, whatever the members now say (all are back to waiting)
    const last = { raceNo: 2, eventId: 'royal_drag', rows: [row('b', 1, 14.2), row('a', 2, 15.5), row('c', 3, null, 'quit'), row('x', 4, 13, 'left')] };
    const done = room({ phase: 'open', members: ['a', 'b', 'c', 'd'].map(id => member(id, 'waiting')), last });
    expect(newsOf(done, 2, 'a')).toEqual({ time: 15.5 });
    expect(newsOf(done, 2, 'c')).toEqual({ time: null });
    expect(newsOf(done, 2, 'x')).toEqual({ time: null }); // a time on a row that is out does not count
    expect(newsOf(done, 2, 'd')).toEqual({ time: null });
    expect(newsOf(done, 3, 'a')).toEqual({ time: null }); // another race's result says nothing of this one: a waiting member is out of it
  });
});

