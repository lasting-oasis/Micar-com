import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TRACKS } from './strip/district';
import { readTrackSync, setTrackDir } from './strip/districtNode';
import {
  GO_LEAD_MS, claimFinish, createRoom, holdsLoan, invitation, joinRoom, leaveRoom, makeCode, markReady, normalizeCode, quitRace, roomView, setRace,
  startRace, sweep, tick, type Room,
} from './race';

// the floor of a race is its distance over the fastest average speed, so the route lengths must be on hand
beforeAll(() => { setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks')); for (const t of TRACKS) readTrackSync(t.id); });

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const who = (id: string) => ({ id, name: id.toUpperCase() });
const m = (room: Room, id: string) => room.members.find(x => x.id === id)!;
const states = (room: Room) => room.members.map(x => x.state);

/** A waiting room on the Royal Park Quarter (a 402 m drag: its floor is 402 / 50 = 8.04 s) with a (the host), b and c. */
function open3(eventId = 'royal_drag') {
  const rooms = new Map<string, Room>();
  const made = createRoom(rooms, who('a'), { eventId, car: 'ronin' }, 1, () => 0.3);
  if (!made.ok) throw new Error('the room was refused: ' + made.why);
  joinRoom(made.room, who('b')); joinRoom(made.room, who('c'));
  return { rooms, room: made.room };
}
/** The same room past its start: all three racing, the green light at `goAt`. */
function racing3(goAt = 0, eventId = 'royal_drag') {
  const r = open3(eventId), t = goAt - GO_LEAD_MS;
  startRace(r.room, 'a', t);
  for (const id of ['a', 'b', 'c']) markReady(r.room, id, t);
  return r;
}
const finish = (room: Room, id: string, time: unknown, now: number, score: unknown = 0) => claimFinish(room, id, { time, score, failed: false }, now);

describe('room codes', () => {
  it('a code is six characters of the alphabet', () => {
    expect(makeCode(seq(0, .5, .999))).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    expect(makeCode(() => 0)).toBe('AAAAAA');
    expect(makeCode(() => .9999)).toBe('999999');
    expect(makeCode(() => 1)).toBe('999999'); // a source that returns 1 does not run off the end
  });
  it('normalizeCode takes a code as people type it, and nothing else', () => {
    expect(normalizeCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(normalizeCode('K7M2QX')).toBe('K7M2QX');
    for (const bad of ['K7M2Q', 'K7M2QXX', 'K7M2Q0', 'K7M2QI', 'K7M2Q!', '', 42, null, undefined, {}, ['K7M2QX']]) expect(normalizeCode(bad)).toBeNull();
  });
});

describe('making and joining a room', () => {
  it('create refuses what is not open, and the 101st room', () => {
    const rooms = new Map<string, Room>(), rand = () => 0.3;
    expect(createRoom(rooms, who('a'), { eventId: 'nope', car: 'ronin' }, 1, rand)).toEqual({ ok: false, why: 'pick' });
    expect(createRoom(rooms, who('a'), { eventId: 'ardennes_gp', car: 'ronin' }, 1, rand)).toEqual({ ok: false, why: 'pick' }); // it opens at stage 5
    expect(createRoom(rooms, who('a'), { eventId: 'royal_drag', car: 'coupe' }, 1, rand)).toEqual({ ok: false, why: 'pick' });
    expect(createRoom(rooms, who('a'), { eventId: null, car: undefined }, 1, rand)).toEqual({ ok: false, why: 'pick' });
    expect(rooms.size).toBe(0);
    expect(createRoom(rooms, who('a'), { eventId: 'ardennes_gp', car: 'ronin' }, 5, rand).ok).toBe(true);
    const made = createRoom(rooms, who('h'), { eventId: 'royal_drag', car: 'brute' }, 1, seq(.1, .2, .3, .4, .5, .6));
    if (!made.ok) throw new Error('refused');
    expect(rooms.get(made.room.code)).toBe(made.room);
    expect(made.room).toMatchObject({ eventId: 'royal_drag', car: 'brute', hostId: 'h', phase: 'open', raceNo: 0, goAt: null, closesAt: null, last: null, note: null, emptySince: null });
    expect(made.room.members).toEqual([{ id: 'h', name: 'H', slot: 0, state: 'waiting', time: null, score: 0, why: null }]);
    const full = new Map<string, Room>(); for (let i = 0; i < 100; i++) full.set('X' + i, made.room);
    expect(createRoom(full, who('z'), { eventId: 'royal_drag', car: 'ronin' }, 1, rand)).toEqual({ ok: false, why: 'busy' });
    expect(full.size).toBe(100);
  });
  it('one address holds at most twenty rooms at a time, and holds up nobody else', () => {
    const rooms = new Map<string, Room>();
    let seed = 1; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // a different code every time
    const make = (i: number, from?: string) => createRoom(rooms, who('h' + i), { eventId: 'royal_drag', car: 'ronin' }, 1, rand, from);
    for (let i = 0; i < 20; i++) expect(make(i, '203.0.113.9').ok).toBe(true);
    expect(make(20, '203.0.113.9')).toEqual({ ok: false, why: 'busy' });
    expect(rooms.size).toBe(20);
    expect(make(21, '198.51.100.7').ok).toBe(true); // another address
    // a room of the first address empties and goes: there is room for one more from it
    const first = [...rooms.values()][0];
    leaveRoom(first, 'h0', 0); expect(sweep(rooms, 120_000)).toEqual([first.code]);
    expect(make(22, '203.0.113.9').ok).toBe(true);
    expect(make(23, '203.0.113.9')).toEqual({ ok: false, why: 'busy' });
    // a caller that names no address is not rationed (the hundred rooms still are)
    const free = new Map<string, Room>();
    for (let i = 0; i < 30; i++) expect(createRoom(free, who('f' + i), { eventId: 'royal_drag', car: 'ronin' }, 1, rand).ok).toBe(true);
  });
  it('a name is text of at most 24 characters, whatever a browser sent', () => {
    const rooms = new Map<string, Room>();
    const made = createRoom(rooms, { id: 'h', name: { a: 1 } as never }, { eventId: 'royal_drag', car: 'ronin' }, 1, () => 0.3);
    if (!made.ok) throw new Error('refused');
    expect(made.room.members[0].name).toBe('Racer');
    expect(invitation(made.room).host).toBe('Racer');
    joinRoom(made.room, { id: 'j', name: 'x'.repeat(5000) });
    joinRoom(made.room, { id: 'k', name: '  Ana  ' });
    joinRoom(made.room, { id: 'l', name: null as never });
    expect(made.room.members.map(x => x.name)).toEqual(['Racer', 'x'.repeat(24), 'Ana', 'Racer']);
  });
  it('two rooms never share a code', () => {
    const rooms = new Map<string, Room>();
    const rand = seq(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .5, .5, .5, .5, .5, .5); // the second room draws the first one's code, then another
    const one = createRoom(rooms, who('a'), { eventId: 'royal_drag', car: 'ronin' }, 1, rand);
    const two = createRoom(rooms, who('b'), { eventId: 'royal_drag', car: 'ronin' }, 1, rand);
    expect(one.ok && one.room.code).toBe('AAAAAA');
    expect(two.ok && two.room.code).toBe('SSSSSS');
    expect(rooms.size).toBe(2);
  });
  it('join: the fifth is refused, twice is harmless, any phase is open', () => {
    const { room } = open3();
    expect(joinRoom(room, who('b'))).toEqual({ ok: true });
    expect(room.members.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(joinRoom(room, who('d'))).toEqual({ ok: true });
    expect(joinRoom(room, who('e'))).toEqual({ ok: false, why: 'full' });
    expect(room.members).toHaveLength(4);
    const live = racing3().room;
    expect(joinRoom(live, who('d'))).toEqual({ ok: true });
    expect(m(live, 'd').state).toBe('waiting');
    expect(live.phase).toBe('racing');
  });
  it('the host changes the race between races; nobody else can, and never while one is on', () => {
    const { room } = open3();
    expect(setRace(room, 'b', { eventId: 'harbour_gp', car: 'civet' }, 1)).toEqual({ ok: false, why: 'host' });
    expect(setRace(room, 'a', { eventId: 'royal_gp', car: 'civet' }, 1)).toEqual({ ok: false, why: 'pick' }); // stage 2
    expect(setRace(room, 'a', { eventId: 'harbour_gp', car: 'tank' }, 1)).toEqual({ ok: false, why: 'pick' });
    expect(room).toMatchObject({ eventId: 'royal_drag', car: 'ronin' });
    expect(setRace(room, 'a', { eventId: 'harbour_gp', car: 'civet' }, 1)).toEqual({ ok: true });
    expect(room).toMatchObject({ eventId: 'harbour_gp', car: 'civet' });
    startRace(room, 'a', 0);
    expect(setRace(room, 'a', { eventId: 'royal_drag', car: 'ronin' }, 1)).toEqual({ ok: false, why: 'state' });
    expect(room.eventId).toBe('harbour_gp');
  });
});

describe('the start', () => {
  it('start needs the host and two members', () => {
    const { room } = open3();
    expect(startRace(room, 'b', 0)).toEqual({ ok: false, why: 'host' });
    expect(room.phase).toBe('open');
    const rooms = new Map<string, Room>(), alone = createRoom(rooms, who('a'), { eventId: 'royal_drag', car: 'ronin' }, 1, () => 0.3);
    if (!alone.ok) throw new Error('refused');
    expect(startRace(alone.room, 'a', 0)).toEqual({ ok: false, why: 'few' });
    expect(alone.room).toMatchObject({ phase: 'open', raceNo: 0 });
    expect(startRace(room, 'a', 0)).toEqual({ ok: true });
    expect(startRace(room, 'a', 1)).toEqual({ ok: false, why: 'state' });
    expect(room.raceNo).toBe(1);
  });
  it('grid places rotate from race to race', () => {
    const { room } = open3();
    startRace(room, 'a', 0);
    expect(room.raceNo).toBe(1);
    expect(room.members.map(x => x.slot)).toEqual([1, 2, 0]);
    expect(states(room)).toEqual(['loading', 'loading', 'loading']);
    for (const id of ['a', 'b', 'c']) markReady(room, id, 10);
    for (const id of ['a', 'b', 'c']) quitRace(room, id, 9000); // the race is over: back to the waiting room
    expect(room.phase).toBe('open');
    startRace(room, 'a', 20_000);
    expect(room.raceNo).toBe(2);
    expect(room.members.map(x => x.slot)).toEqual([2, 0, 1]);
  });
  it('ready from everyone names the green light five seconds on', () => {
    const { room } = open3();
    startRace(room, 'a', 0);
    joinRoom(room, who('d')); // arrived after the start: in the next race
    expect(markReady(room, 'a', 500)).toEqual({ ok: true });
    expect(markReady(room, 'b', 800)).toEqual({ ok: true });
    expect(room).toMatchObject({ phase: 'loading', goAt: null });
    expect(markReady(room, 'd', 900)).toEqual({ ok: false, why: 'state' });
    expect(markReady(room, 'a', 900)).toEqual({ ok: false, why: 'state' }); // ready already
    expect(markReady(room, 'c', 1000)).toEqual({ ok: true });
    expect(room).toMatchObject({ phase: 'racing', goAt: 6000, closesAt: null });
    expect(states(room)).toEqual(['racing', 'racing', 'racing', 'waiting']);
  });
  it('the slow are dropped at thirty seconds', () => {
    const { room } = open3();
    startRace(room, 'a', 0);
    markReady(room, 'a', 1000); markReady(room, 'b', 1000);
    expect(tick(room, 29_999)).toBe(false);
    expect(room.phase).toBe('loading');
    expect(tick(room, 30_000)).toBe(true);
    expect(states(room)).toEqual(['racing', 'racing', 'waiting']);
    expect(room).toMatchObject({ phase: 'racing', goAt: 35_000 });
    expect(tick(room, 30_001)).toBe(false);
  });
  it('a start with one ready racer is called off', () => {
    const { room } = open3();
    startRace(room, 'a', 0);
    markReady(room, 'a', 1000);
    expect(tick(room, 30_000)).toBe(true);
    expect(room).toMatchObject({ phase: 'open', note: 'called-off', last: null, goAt: null });
    expect(states(room)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(startRace(room, 'a', 40_000)).toEqual({ ok: true });
    expect(room.note).toBeNull();
  });
});

describe('the finish', () => {
  /** a's time after claiming `time` when the server's own clock says 20.3 s */
  const claimed = (time: unknown) => { const { room } = racing3(0); finish(room, 'a', time, 20_300); return m(room, 'a').time; };
  it('the claim stands inside its bounds', () => {
    expect(claimed(20.1)).toBe(20.1);
    expect(claimed(19.9)).toBe(19.9);      // 0.4 s under the server's figure: a slow connection
    expect(claimed(20.35)).toBe(20.35);    // a hair over: the two clocks do not agree to the millisecond
    expect(claimed(19.7)).toBe(20.3);      // 0.6 s under: the server's figure
    expect(claimed(20.5)).toBe(20.3);      // 0.2 s over
    expect(claimed(7.04)).toBe(20.3);
    for (const junk of ['20', NaN, Infinity, -Infinity, null, undefined, {}]) expect(claimed(junk)).toBe(20.3);
    expect(claimed(20.1234567)).toBe(20.123); // to the millisecond
  });
  it('a claim under the floor of the track never stands, even inside the tolerance', () => {
    const { room } = racing3(0);
    expect(finish(room, 'a', 7.94, 8_240)).toEqual({ ok: true }); // the server saw 8.24 s; nobody covers 402 m in 7.94
    expect(m(room, 'a')).toMatchObject({ state: 'finished', time: 8.24 });
  });
  it('a finish before the floor has passed is refused', () => {
    const { room } = racing3(0);
    expect(finish(room, 'a', 20, 7_040)).toEqual({ ok: false, why: 'state' });
    expect(m(room, 'a')).toMatchObject({ state: 'racing', time: null });
    expect(room.closesAt).toBeNull();
    expect(finish(room, 'd', 20, 20_000)).toEqual({ ok: false, why: 'state' }); // not in the room
    const waiting = open3().room;
    expect(finish(waiting, 'a', 20, 20_000)).toEqual({ ok: false, why: 'state' }); // no race is on
  });
  it('the first finish opens a sixty second window, and the window makes DNFs', () => {
    const { room } = racing3(0);
    expect(finish(room, 'a', 20, 20_000)).toEqual({ ok: true });
    expect(room).toMatchObject({ phase: 'racing', closesAt: 80_000 });
    expect(finish(room, 'a', 19.9, 20_050)).toEqual({ ok: false, why: 'state' }); // a finish is claimed once
    expect(tick(room, 79_999)).toBe(false);
    expect(tick(room, 80_000)).toBe(true);
    expect(room).toMatchObject({ phase: 'open', goAt: null, closesAt: null });
    expect(room.last).toEqual({ raceNo: 1, eventId: 'royal_drag', rows: [
      { id: 'a', name: 'A', pos: 1, time: 20, score: 0, why: null },
      { id: 'b', name: 'B', pos: 2, time: null, score: 0, why: 'timeout' },
      { id: 'c', name: 'C', pos: 3, time: null, score: 0, why: 'timeout' },
    ] });
  });
  it('a second finish does not move the window', () => {
    const { room } = racing3(0);
    finish(room, 'a', 20, 20_000); finish(room, 'b', 30, 30_000);
    expect(room.closesAt).toBe(80_000);
  });
  it('a race nobody finishes ends at the cap', () => {
    const { room } = racing3(0);
    // a 402 m race is capped at 600 s; the room allows 30 s more: 630,000 ms after the green light
    expect(tick(room, 629_999)).toBe(false);
    expect(tick(room, 630_000)).toBe(true);
    expect(room.phase).toBe('open');
    expect(room.last!.rows.map(r => [r.id, r.time, r.why])).toEqual([['a', null, 'timeout'], ['b', null, 'timeout'], ['c', null, 'timeout']]);
  });
  it('the last finisher closes the race at once, ranked by time', () => {
    const { room } = racing3(0);
    finish(room, 'b', 21, 21_000); finish(room, 'a', 22.5, 22_500);
    expect(room.phase).toBe('racing');
    finish(room, 'c', 23.25, 23_250);
    expect(room.last!.rows.map(r => [r.id, r.pos, r.time])).toEqual([['b', 1, 21], ['a', 2, 22.5], ['c', 3, 23.25]]);
    expect(room).toMatchObject({ phase: 'open', goAt: null, closesAt: null });
    expect(room.members).toEqual([
      { id: 'a', name: 'A', slot: 1, state: 'waiting', time: null, score: 0, why: null },
      { id: 'b', name: 'B', slot: 2, state: 'waiting', time: null, score: 0, why: null },
      { id: 'c', name: 'C', slot: 0, state: 'waiting', time: null, score: 0, why: null },
    ]);
  });
  it('a drift ranks by score, time breaking a tie', () => {
    const { room } = racing3(0, 'harbour_drift');
    finish(room, 'a', 40, 40_000, 1200); finish(room, 'c', 42, 42_000, 3400); finish(room, 'b', 45, 45_000, 3400);
    expect(room.last!.rows.map(r => [r.id, r.pos, r.score, r.time])).toEqual([['c', 1, 3400, 42], ['b', 2, 3400, 45], ['a', 3, 1200, 40]]);
    const junk = racing3(0, 'harbour_drift').room;
    finish(junk, 'a', 40, 40_000, -5); finish(junk, 'b', 41, 41_000, NaN); finish(junk, 'c', 42, 42_000, 1e12);
    expect(junk.last!.rows.map(r => [r.id, r.score])).toEqual([['c', 9_999_999], ['a', 0], ['b', 0]]);
    const frac = racing3(0, 'harbour_drift').room;
    finish(frac, 'a', 40, 40_000, 1234.6);
    expect(m(frac, 'a').score).toBe(1235);
    const drag = racing3(0).room;
    finish(drag, 'a', 20, 20_000, 500);
    expect(m(drag, 'a').score).toBe(0); // a drag has no score, whatever is claimed
  });
  it('a blown engine is a DNF', () => {
    const { room } = racing3(0);
    expect(claimFinish(room, 'a', { time: null, score: 0, failed: true }, 3_000)).toEqual({ ok: true });
    expect(m(room, 'a')).toMatchObject({ state: 'dnf', why: 'failed', time: null });
    expect(room.closesAt).toBeNull(); // a failure is not a finish: it opens no window
    expect(room.phase).toBe('racing');
  });
});

describe('quitting and leaving', () => {
  it('a quit is a DNF and the others race on', () => {
    const { room } = racing3(0);
    quitRace(room, 'b', 7_000);
    expect(m(room, 'b')).toMatchObject({ state: 'dnf', why: 'quit', time: null });
    expect(room.phase).toBe('racing');
    quitRace(room, 'b', 7_100); quitRace(room, 'nobody', 7_100); // neither changes anything
    expect(states(room)).toEqual(['racing', 'dnf', 'racing']);
    const early = open3().room;
    startRace(early, 'a', 0);
    quitRace(early, 'c', 100);
    expect(m(early, 'c').state).toBe('waiting');
    markReady(early, 'a', 200); markReady(early, 'b', 300);
    expect(early).toMatchObject({ phase: 'racing', goAt: 5300 });
    expect(states(early)).toEqual(['racing', 'racing', 'waiting']);
  });
  it('the host leaving the waiting room hands over', () => {
    const { room } = open3();
    leaveRoom(room, 'a', 0);
    expect(room.hostId).toBe('b');
    expect(room.members.map(x => x.id)).toEqual(['b', 'c']);
    expect(room.emptySince).toBeNull();
    leaveRoom(room, 'nobody', 0);
    expect(room.members).toHaveLength(2);
    expect(startRace(room, 'b', 0)).toEqual({ ok: true }); // the new host can start
  });
  it('a racer who leaves stays on the result as a DNF; a finisher who leaves keeps the time', () => {
    const { room } = racing3(0);
    finish(room, 'a', 20, 20_000);
    leaveRoom(room, 'a', 21_000);
    leaveRoom(room, 'b', 22_000);
    expect(room.phase).toBe('racing');
    expect(room.hostId).toBe('c');
    finish(room, 'c', 25, 25_000);
    expect(room.last!.rows).toEqual([
      { id: 'a', name: 'A', pos: 1, time: 20, score: 0, why: null },
      { id: 'c', name: 'C', pos: 2, time: 25, score: 0, why: null },
      { id: 'b', name: 'B', pos: 3, time: null, score: 0, why: 'left' },
    ]);
    expect(room.members.map(x => x.id)).toEqual(['c']);
    // the next race starts clean: the leavers are not carried into its result
    joinRoom(room, who('d')); startRace(room, 'c', 30_000); markReady(room, 'c', 30_000); markReady(room, 'd', 30_000);
    quitRace(room, 'c', 40_000); quitRace(room, 'd', 40_000);
    expect(room.last!.rows.map(r => r.id)).toEqual(['c', 'd']);
  });
  it('leaving during loading calls the race off when one is left', () => {
    const rooms = new Map<string, Room>(), made = createRoom(rooms, who('a'), { eventId: 'royal_drag', car: 'ronin' }, 1, () => 0.3);
    if (!made.ok) throw new Error('refused');
    const room = made.room; joinRoom(room, who('b'));
    startRace(room, 'a', 0);
    leaveRoom(room, 'b', 100);
    expect(room).toMatchObject({ phase: 'open', note: 'called-off', last: null });
    expect(states(room)).toEqual(['waiting']);
  });
  it('a racer leaving during loading lets the ready ones go', () => {
    const { room } = open3();
    startRace(room, 'a', 0);
    markReady(room, 'a', 100); markReady(room, 'b', 200);
    leaveRoom(room, 'c', 300); // the only one still loading
    expect(room).toMatchObject({ phase: 'racing', goAt: 5300 });
    finish(room, 'a', 20, 25_300); finish(room, 'b', 21, 26_300);
    expect(room.last!.rows.map(r => r.id)).toEqual(['a', 'b']); // c left before the green light: never in this race
  });
  it('everyone leaving mid-race leaves an open, empty room', () => {
    const { room } = racing3(0);
    leaveRoom(room, 'a', 1000); leaveRoom(room, 'b', 2000); leaveRoom(room, 'c', 3000);
    expect(room).toMatchObject({ phase: 'open', members: [], hostId: '', emptySince: 3000, goAt: null });
  });
  it('a join before the two minutes revives an empty room; after, it is swept', () => {
    const { rooms, room } = open3();
    for (const id of ['a', 'b', 'c']) leaveRoom(room, id, 1000);
    expect(room.emptySince).toBe(1000);
    expect(sweep(rooms, 120_999)).toEqual([]);
    expect(joinRoom(room, who('d'))).toEqual({ ok: true });
    expect(room).toMatchObject({ hostId: 'd', emptySince: null });
    expect(sweep(rooms, 999_999)).toEqual([]); // someone is in it
    leaveRoom(room, 'd', 200_000);
    expect(sweep(rooms, 319_999)).toEqual([]);
    expect(sweep(rooms, 320_000)).toEqual([room.code]);
    expect(rooms.has(room.code)).toBe(false);
  });
  it('a room emptied by a dropped connection keeps its link for fifteen minutes', () => {
    // the host shares the link from a phone: the browser goes to sleep behind the messenger and the connection drops
    const rooms = new Map<string, Room>();
    const made = createRoom(rooms, who('a'), { eventId: 'royal_drag', car: 'ronin' }, 1, () => 0.3);
    if (!made.ok) throw new Error('refused');
    const room = made.room;
    leaveRoom(room, 'a', 1000, true);
    expect(sweep(rooms, 1000 + 120_000)).toEqual([]);   // two minutes on, the friend's link still opens
    expect(sweep(rooms, 1000 + 899_999)).toEqual([]);
    expect(invitation(room)).toMatchObject({ host: 'A', count: 0 }); // and still says who is challenging
    expect(joinRoom(room, who('b'))).toEqual({ ok: true }); // the friend comes in first, and hosts until the other is back
    expect(room).toMatchObject({ hostId: 'b', emptySince: null });
    // the last one out decides how long the link lasts: a drop, fifteen minutes; a Leave, two
    leaveRoom(room, 'b', 2_000_000, true);
    expect(sweep(rooms, 2_000_000 + 899_999)).toEqual([]);
    expect(sweep(rooms, 2_000_000 + 900_000)).toEqual([room.code]);
    const again = createRoom(rooms, who('c'), { eventId: 'royal_drag', car: 'ronin' }, 1, () => 0.3);
    if (!again.ok) throw new Error('refused');
    joinRoom(again.room, who('d'));
    leaveRoom(again.room, 'c', 0, true); leaveRoom(again.room, 'd', 5000);
    expect(sweep(rooms, 5000 + 119_999)).toEqual([]);
    expect(sweep(rooms, 5000 + 120_000)).toEqual([again.room.code]);
  });
});

describe('what the server reads off a room', () => {
  it('who holds a lent car', () => {
    const { room } = open3();
    const holders = () => ['a', 'b', 'c', 'd'].filter(id => holdsLoan(room, id));
    expect(holders()).toEqual([]);
    startRace(room, 'a', -5000);
    expect(holders()).toEqual(['a', 'b', 'c']);
    joinRoom(room, who('d'));
    for (const id of ['a', 'b', 'c']) markReady(room, id, -5000);
    quitRace(room, 'b', 7_000);
    expect(holders()).toEqual(['a', 'c']); // a DNF hands the car back at once
    finish(room, 'a', 20, 20_000);
    expect(holders()).toEqual(['a', 'c']); // a finisher keeps it until the race closes
    finish(room, 'c', 21, 21_000);
    expect(holders()).toEqual([]);
  });
  it('the view hides the bookkeeping; the invitation names the host', () => {
    const { room } = open3();
    expect(Object.keys(roomView(room)).sort()).toEqual(['car', 'closesAt', 'code', 'eventId', 'goAt', 'hostId', 'last', 'members', 'note', 'phase', 'raceNo']);
    expect(roomView(room)).toMatchObject({ code: room.code, eventId: 'royal_drag', car: 'ronin', hostId: 'a', phase: 'open', raceNo: 0 });
    expect(invitation(room)).toEqual({ host: 'A', eventId: 'royal_drag', car: 'ronin', count: 3, max: 4, phase: 'open' });
    for (const id of ['a', 'b', 'c']) leaveRoom(room, id, 0);
    // nobody is in it: the link still names the last to host it
    expect(invitation(room)).toEqual({ host: 'C', eventId: 'royal_drag', car: 'ronin', count: 0, max: 4, phase: 'open' });
  });
});
