import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TRACKS } from './strip/district';
import { readTrackSync, setTrackDir } from './strip/districtNode';
import {
  GO_LEAD_MS, GRID_SIZES, QUICK_CAR, QUICK_WAIT_MS, SLOT_COLORS, claimFinish, createRoom, findQuick, holdsLoan, invitation, joinRoom, leaveRoom, makeCode, markReady,
  normalizeCode, quickEventOf, quickWaiting, quitRace, roomMaxFrom, roomSizeFor, roomView, roundPose, setRace, startRace, sweep, tick, type Room,
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
    expect(Object.keys(roomView(room)).sort()).toEqual(['car', 'closesAt', 'code', 'eventId', 'goAt', 'hostId', 'last', 'max', 'members', 'note', 'phase', 'quick', 'raceNo', 'startsAt']);
    expect(roomView(room)).toMatchObject({ code: room.code, eventId: 'royal_drag', car: 'ronin', hostId: 'a', phase: 'open', raceNo: 0 });
    expect(invitation(room)).toEqual({ host: 'A', eventId: 'royal_drag', car: 'ronin', count: 3, max: 4, phase: 'open' });
    for (const id of ['a', 'b', 'c']) leaveRoom(room, id, 0);
    // nobody is in it: the link still names the last to host it
    expect(invitation(room)).toEqual({ host: 'C', eventId: 'royal_drag', car: 'ronin', count: 0, max: 4, phase: 'open' });
  });
});

describe('room size for a load test', () => {
  it('reads RACE_ROOM_MAX only as a whole number from 4 to 16', () => {
    expect([undefined, '', '3', '17', '8.5', 'x', '-4'].map(roomMaxFrom)).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(['4', '8', ' 16 '].map(roomMaxFrom)).toEqual([4, 8, 16]);
  });
  it('a room made for sixteen takes sixteen and refuses the seventeenth; a default room still stops at four', () => {
    const rooms = new Map<string, Room>();
    const pick = { eventId: 'royal_drag', car: 'ronin' };
    const big = createRoom(rooms, { id: 'h', name: 'Host' }, pick, 1, Math.random, '', 16);
    if (!big.ok) throw new Error(big.why);
    for (let i = 1; i < 16; i++) expect(joinRoom(big.room, { id: `p${i}`, name: `P${i}` }).ok).toBe(true);
    expect(joinRoom(big.room, { id: 'p16', name: 'P16' })).toEqual({ ok: false, why: 'full' });
    expect(invitation(big.room).max).toBe(16);
    const small = createRoom(rooms, { id: 'h2', name: 'Host' }, pick, 1, Math.random);
    if (!small.ok) throw new Error(small.why);
    for (let i = 1; i < 4; i++) joinRoom(small.room, { id: `q${i}`, name: `Q${i}` });
    expect(joinRoom(small.room, { id: 'q4', name: 'Q4' })).toEqual({ ok: false, why: 'full' });
    expect(invitation(small.room).max).toBe(4);
  });
});

describe('rooms of 4 to 16', () => {
  it('a room is 4, 8, 12 or 16, never over the ceiling; a page that sends no size gets the largest room the server makes', () => {
    expect(GRID_SIZES).toEqual([4, 8, 12, 16]);
    expect([roomSizeFor(8, 16, false), roomSizeFor(16, 16, false), roomSizeFor(12, 12, false), roomSizeFor(4, 4, false)]).toEqual([8, 16, 12, 4]);
    // no size (a page from before this work, or lane A's load test): the server's ceiling, which is 4 unless RACE_ROOM_MAX says more
    expect([roomSizeFor(undefined, 16, false), roomSizeFor(null, 4, false), roomSizeFor(undefined, 10, false)]).toEqual([16, 4, 10]);
    const refused: [unknown, number][] = [[16, 8], [6, 16], ['8', 16], [12, 4], [8.5, 16], [0, 16], [-4, 16], [NaN, 16], [Infinity, 16], [{}, 16]];
    for (const [asked, ceiling] of refused) expect(roomSizeFor(asked, ceiling, false)).toBeNull();
  });
  it('a drag stays four', () => {
    expect([roomSizeFor(undefined, 16, true), roomSizeFor(4, 16, true), roomSizeFor(4, 4, true)]).toEqual([4, 4, 4]);
    expect([roomSizeFor(8, 16, true), roomSizeFor(16, 16, true)]).toEqual([null, null]);
  });
  it('the host changes the size while the room is open, never below who is in it, never over the ceiling', () => {
    const rooms = new Map<string, Room>();
    const made = createRoom(rooms, who('h'), { eventId: 'harbour_gp', car: 'ronin' }, 1, Math.random, '', 16);
    if (!made.ok) throw new Error(made.why);
    const room = made.room;
    for (let i = 1; i < 9; i++) joinRoom(room, who('p' + i)); // nine in all
    const pick = (size: unknown, eventId = 'harbour_gp') => ({ eventId, car: 'ronin', size });
    expect(setRace(room, 'h', pick(8), 1, 16)).toEqual({ ok: false, why: 'size' });
    expect(room.max).toBe(16);
    expect(setRace(room, 'h', pick(12), 1, 16)).toEqual({ ok: true });
    expect(room.max).toBe(12);
    expect(setRace(room, 'p1', pick(16), 1, 16)).toEqual({ ok: false, why: 'host' });
    expect(setRace(room, 'h', pick(16), 1, 8)).toEqual({ ok: false, why: 'size' });
    // no size: the room keeps its own; a drag is four, and nine are in
    expect(setRace(room, 'h', { eventId: 'harbour_gp', car: 'tsubasa' }, 1, 16)).toEqual({ ok: true });
    expect([room.max, room.car]).toEqual([12, 'tsubasa']);
    expect(setRace(room, 'h', { eventId: 'royal_drag', car: 'ronin' }, 1, 16)).toEqual({ ok: false, why: 'size' });
    expect([room.eventId, room.max]).toEqual(['harbour_gp', 12]);
    // with three left, the drag is taken, and the room becomes a room of four
    for (let i = 1; i < 7; i++) leaveRoom(room, 'p' + i, 0);
    expect(setRace(room, 'h', { eventId: 'royal_drag', car: 'ronin' }, 1, 16)).toEqual({ ok: true });
    expect([room.eventId, room.max]).toEqual(['royal_drag', 4]);
  });
  it("the room's size reaches its members", () => {
    const rooms = new Map<string, Room>();
    const made = createRoom(rooms, who('h'), { eventId: 'harbour_gp', car: 'ronin' }, 1, Math.random, '', 12);
    if (!made.ok) throw new Error(made.why);
    expect(roomView(made.room).max).toBe(12);
  });
  it('sixteen colours: the first four are as they were, and no two are alike', () => {
    expect(SLOT_COLORS).toHaveLength(16);
    expect(SLOT_COLORS.slice(0, 4)).toEqual(['#ffd23f', '#2a9df4', '#e8463c', '#f3f6fb']);
    let closest = Infinity;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) closest = Math.min(closest, ciede2000(SLOT_COLORS[i], SLOT_COLORS[j]));
    expect(closest).toBeGreaterThanOrEqual(20);
  });
  it('the colour difference sum agrees with its published test pair', () => {
    // Sharma, Wu and Dalal (2005), pair 1: 2.0425
    expect(de00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
  });
});

/** CIEDE2000 between two sRGB colours written '#rrggbb' (D65). */
function ciede2000(p: string, q: string): number { return de00(lab(p), lab(q)); }
function lab(hex: string): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function de00([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => { const d = Math.atan2(b, a) / rad; return d < 0 ? d + 360 : d; };
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  let dh = 0;
  if (C1p * C2p !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dL = L2 - L1, dC = C2p - C1p, dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (C1p * C2p !== 0) { if (Math.abs(h1 - h2) > 180) hm += h1 + h2 < 360 ? 360 : -360; hm /= 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T, Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

describe('a pose in fewer bytes', () => {
  it('rounds a pose to the centimetre and the milliradian, keeping its shape', () => {
    expect(roundPose([1700000000000.4, 123.456789, -98.765432, 1.23456789, 45.678901, 2345.678901, 1234.6]))
      .toEqual([1700000000000, 123.46, -98.77, 1.235, 45.68, 2345.68, 1235]);
    expect(roundPose([1, 2, 3, 0.5, 30, 100, 0])).toEqual([1, 2, 3, 0.5, 30, 100, 0]); // round numbers stay as they are
  });
  it('the relayed pose the spec measured (149 bytes) is 92 rounded', () => {
    const id = '4tp2k6p2vigOE3cXAAAG', raw = [1794637215464.5, 16098.616765074097, 8154.863643704915, 0.412083833922235, 17.64717058905482, 158.2285872987045, 0];
    const frame = (pose: number[]) => '42' + JSON.stringify(['race_pose', [id, ...pose]]); // socket.io's text frame
    expect(frame(raw).length).toBe(149);
    expect(frame(roundPose(raw)).length).toBe(92);
  });
});

describe('quick rooms: one filling per circuit, starting by themselves', () => {
  /** a quick room on a circuit's quick event, `host` in it, made at `now` */
  const quick = (rooms: Map<string, Room>, track: string, host = 'h', max = 16) => {
    const made = createRoom(rooms, who(host), { eventId: quickEventOf(track)!.id, car: QUICK_CAR }, 9, Math.random, '', max, true);
    if (!made.ok) throw new Error(made.why);
    return made.room;
  };
  it("each circuit has one quick event: its lowest-stage lap race (a circuit race, then a street X, then a sprint)", () => {
    expect(TRACKS.map(t => [t.id, quickEventOf(t.id)?.id])).toEqual([
      ['spa', 'ardennes_gp'], ['monza', 'royal_gp'], ['silverstone', 'airfield_sprint'], ['suzuka', 'figure8_gp'], ['nurburgring', 'eifel_gp'],
      ['monaco', 'harbour_gp'], ['interlagos', 'lagoons_sprint'], ['cota', 'lonestar_gp'], ['laguna', 'drylagoon_x'], ['bathurst', 'mountain_sprint'],
    ]);
    expect(QUICK_CAR).toBe('ronin'); expect(QUICK_WAIT_MS).toBe(30_000);
    expect(quickEventOf('nowhere')).toBeUndefined();
  });
  it('a quick room waits thirty seconds after a second person arrives, then starts by itself', () => {
    const rooms = new Map<string, Room>(), room = quick(rooms, 'monaco');
    expect([room.quick, room.startsAt]).toEqual([true, null]);
    expect(tick(room, 50_000)).toBe(false); // alone: nothing starts
    joinRoom(room, who('b'), 1_000);
    expect(room.startsAt).toBe(31_000);
    expect(roomView(room)).toMatchObject({ quick: true, startsAt: 31_000 });
    expect(tick(room, 30_999)).toBe(false); expect(room.phase).toBe('open');
    expect(tick(room, 31_000)).toBe(true); expect(room.phase).toBe('loading');
    expect(room.startsAt).toBeNull();
  });
  it('a quick room starts as soon as it is full', () => {
    const rooms = new Map<string, Room>(), room = quick(rooms, 'monaco', 'h', 4);
    for (const id of ['b', 'c', 'd']) joinRoom(room, who(id), 1_000);
    expect(tick(room, 1_001)).toBe(true); expect(room.phase).toBe('loading');
  });
  it('leaving below two stops the wait; after a race the next one waits again', () => {
    const rooms = new Map<string, Room>(), room = quick(rooms, 'monaco');
    joinRoom(room, who('b'), 1_000);
    leaveRoom(room, 'b', 2_000);
    expect(room.startsAt).toBeNull();
    expect(tick(room, 40_000)).toBe(false);
    joinRoom(room, who('c'), 50_000); expect(room.startsAt).toBe(80_000);
    tick(room, 80_000); // started
    for (const id of ['h', 'c']) markReady(room, id, 80_100);
    expect(room.phase).toBe('racing');
    for (const id of ['h', 'c']) quitRace(room, id, 90_000); // both out: the race closes
    expect(room.phase).toBe('open');
    expect(room.startsAt).toBe(90_000 + QUICK_WAIT_MS);
  });
  it("a quick room's race and car are fixed", () => {
    const rooms = new Map<string, Room>(), room = quick(rooms, 'monaco');
    expect(setRace(room, 'h', { eventId: 'royal_drag', car: 'ronin' }, 9, 16)).toEqual({ ok: false, why: 'state' });
    expect([room.eventId, room.car]).toEqual(['harbour_gp', 'ronin']);
  });
  it('findQuick takes the fullest open quick room of that circuit, and nothing else', () => {
    const rooms = new Map<string, Room>();
    const a = quick(rooms, 'monaco', 'a'), b = quick(rooms, 'monaco', 'b'), other = quick(rooms, 'spa', 's');
    joinRoom(b, who('b2'), 0);
    const plain = createRoom(rooms, who('p'), { eventId: 'harbour_gp', car: 'ronin' }, 9, Math.random, '', 16);
    expect(plain.ok).toBe(true);
    expect(findQuick(rooms, 'monaco')).toBe(b); // the fuller one; never the room made by link
    for (const id of ['b3', 'b4']) joinRoom(b, who(id), 0);
    b.max = 4; // full now
    expect(findQuick(rooms, 'monaco')).toBe(a);
    a.phase = 'loading';
    expect(findQuick(rooms, 'monaco')).toBeUndefined(); // racing already: a new one is opened
    expect(findQuick(rooms, 'spa')).toBe(other);
    expect(findQuick(rooms, 'nowhere')).toBeUndefined();
  });
  it('quickWaiting counts who is in each open quick room, by circuit, and nothing else', () => {
    const rooms = new Map<string, Room>();
    const a = quick(rooms, 'monaco', 'a'); joinRoom(a, who('a2'), 0);
    quick(rooms, 'spa', 's');
    const off = quick(rooms, 'suzuka', 'r'); joinRoom(off, who('r2'), 0);
    expect(startRace(off, 'r', 0).ok).toBe(true); // on its way to the grid: nobody waits there
    expect(createRoom(rooms, who('p'), { eventId: 'harbour_gp', car: 'ronin' }, 9, Math.random, '', 16).ok).toBe(true); // a room by link
    expect(quickWaiting(rooms)).toEqual({ monaco: 2, spa: 1 });
    expect(quickWaiting(new Map())).toEqual({});
  });
});
