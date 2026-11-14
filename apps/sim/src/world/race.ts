/* A challenge race between people: the rules of its room. Who is in and who hosts, the start, the one green light,
   whose time stands, the result. Pure: the clock (`now`, in ms) and the random source are passed in, and nothing here
   touches a socket, a player record or a car. server.ts does the wiring; the page reads a RoomView. */
import { EVENTS, type EventDef, type EventType } from './data';
import { eventDistance, raceFloor } from './payout';
import { makeCode } from './raceCode';
import { RENTAL_FLEET, type RentalKey } from './rental';
import { raceCapS } from './strip/events';

export { CODE_ALPHABET, CODE_LEN, makeCode, normalizeCode } from './raceCode';

/** A room holds this many on a server whose ceiling is four (RACE_ROOM_MAX unset). With a higher ceiling a room holds
 *  the grid its host picks, or the ceiling when no size is asked (roomSizeFor). A drag always holds four: it has four
 *  lanes. A race needs at least two. */
export const RACE_MAX = 4, RACE_MIN = 2;
/** The most a room may be made to hold: the sixteen places of the grid (strip/grid.ts). */
export const ROOM_MAX_LIMIT = 16;
/** The grids a host picks from, up to the server's ceiling. */
export const GRID_SIZES: readonly number[] = [4, 8, 12, 16];
/**
 * How many a room is made to hold, or null when that is refused: what the host asked for when it is one of GRID_SIZES
 * and no more than the server's `ceiling` (roomMaxFrom). A page that asks for no size (one from before rooms grew, and
 * lane A's load test) gets the ceiling, which is RACE_MAX unless RACE_ROOM_MAX says more. A drag is RACE_MAX, always.
 */
export function roomSizeFor(asked: unknown, ceiling: number, drag: boolean): number | null {
  if (asked === undefined || asked === null) return drag ? RACE_MAX : ceiling;
  if (drag) return asked === RACE_MAX ? RACE_MAX : null;
  return typeof asked === 'number' && GRID_SIZES.includes(asked) && asked <= ceiling ? asked : null;
}
/** How many a room holds: RACE_MAX, unless `env` (RACE_ROOM_MAX), trimmed, is a whole number from RACE_MAX to ROOM_MAX_LIMIT. */
export function roomMaxFrom(env: string | undefined): number {
  const s = (env ?? '').trim();
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  return n >= RACE_MAX && n <= ROOM_MAX_LIMIT ? n : RACE_MAX;
}
export const ROOMS_MAX = 100;
/** The rooms one address may hold at a time: a fifth of them all, so that no one script can take every room. */
export const ROOMS_PER_ADDRESS = 20;
/** After Start a browser has this long to sit on the grid; the green light is named this far ahead; once the first car is
 *  home the rest have the window; a race closes this long after its event's cap. */
export const LOAD_TIMEOUT_MS = 30_000, GO_LEAD_MS = 5_000, FINISH_WINDOW_MS = 60_000, CAP_SLACK_MS = 30_000;
/** An empty room keeps its link this long: two minutes once its last member has left it, fifteen when the last
 *  connection dropped (a phone that went to a messenger to send the link is asleep, not gone). */
export const EMPTY_TTL_MS = 120_000, DROPPED_TTL_MS = 900_000;
/** A name as a room shows it: text of at most this many characters (the Strip's own limit; the town's browsers are not held to it). */
const NAME_MAX = 24;
/** A browser's own time stands when it is at most this far under the server's figure (a slow connection), and at most
 *  CLAIM_LATE_S over it (two clocks never agree to the millisecond). */
export const CLAIM_TOLERANCE_S = 0.5, CLAIM_LATE_S = 0.1;
/** The lent car's colour, by grid place: the first four as a race of four always had them, then twelve more chosen to be
 *  as far as possible from those and from each other (race.test.ts holds every pair at least 20 apart in CIEDE2000), the
 *  most distinct first so that a smaller room gets them; none too dark to read on the HUD's night panel. */
export const SLOT_COLORS: readonly string[] = [
  '#ffd23f', '#2a9df4', '#e8463c', '#f3f6fb',
  '#117744', '#9900dd', '#00ff55', '#886600', '#ff77cc', '#00cccc', '#88aa00', '#994466', '#ee8800', '#ffaa99', '#5566aa', '#aa99ff',
];
const SCORE_MAX = 9_999_999;
/** Quick race (Part 2): every quick room races the Ronin GT, so nobody has to agree on a car. A quick room starts by
 *  itself this long after a second person is in it, or at once when a join fills it; after a race or a call-off it waits
 *  this long again, full or not, and nobody joining or coming back meanwhile ends that wait. */
export const QUICK_CAR: RentalKey = 'ronin', QUICK_WAIT_MS = 30_000;
const QUICK_TYPES: readonly EventType[] = ['circuit', 'streetx', 'sprint'];
/** A circuit's one quick event: its lowest-stage lap race, a circuit race before a street X before a sprint on a tie,
 *  so that everyone who picks a circuit lands in the same room. Undefined for an id that is no circuit. */
export function quickEventOf(track: string): EventDef | undefined {
  const evs = EVENTS.filter(e => e.track === track && QUICK_TYPES.includes(e.type));
  return evs.sort((p, q) => p.stage - q.stage || QUICK_TYPES.indexOf(p.type) - QUICK_TYPES.indexOf(q.type))[0];
}
/** A racer's pose as it travels, [t, x, z, h, v, s, score]: the time to the whole millisecond, the distances to the
 *  centimetre, the heading to the milliradian, the speed to the centimetre a second, the score whole. A full-precision
 *  pose costs 15 to 18 bytes a number; rounded, the relayed message is about 60% of what it was (149 bytes to 92 for
 *  the one the spec measured). The sender rounds, and the server rounds again as it relays (an older page). */
export function roundPose(p: readonly number[]): number[] {
  const r = (n: number, k: number) => Math.round(n * k) / k;
  const [t, x, z, h, v, s, sc] = p;
  return [Math.round(t), r(x, 100), r(z, 100), r(h, 1000), r(v, 100), r(s, 100), Math.round(sc)];
}

export type Phase = 'open' | 'loading' | 'racing';
export type MemberState = 'waiting' | 'loading' | 'ready' | 'racing' | 'finished' | 'dnf';
/** Why a racer has no time. */
export type Why = 'quit' | 'failed' | 'left' | 'timeout';
/** Why the server said no. 'size': a grid the server does not make, or smaller than the room. */
export type DenyWhy = 'gone' | 'full' | 'busy' | 'slow' | 'holding' | 'host' | 'few' | 'state' | 'pick' | 'size' | 'idle';
export type Member = { id: string; name: string; slot: number; state: MemberState; time: number | null; score: number; why: Why | null };
export type ResultRow = { id: string; name: string; pos: number; time: number | null; score: number; why: Why | null };
export type LastRace = { raceNo: number; eventId: string; rows: ResultRow[] };
export type Room = {
  code: string; eventId: string; car: RentalKey; hostId: string; phase: Phase; raceNo: number; members: Member[];
  /** when Start was pressed; the green light (once named); when the finish window ends (once someone has finished) */
  startedAt: number | null; goAt: number | null; closesAt: number | null;
  /** racers who left after the green light: they stay on this race's result */
  gone: ResultRow[];
  last: LastRace | null;
  /** the last start was called off: too few were ready */
  note: 'called-off' | null;
  /** since when nobody is in it, and how long it is kept from then */
  emptySince: number | null; emptyFor: number;
  /** the name of the last member to host it (the link names them while the room waits empty); the address it was made from */
  hostName: string; from: string;
  /** a quick room (Part 2): found by circuit, its race and car fixed, started by itself at `startsAt` (null: not waiting) */
  quick: boolean; startsAt: number | null;
  /** when its last race ended with a result (close); null from the next start. A quick room whose race ended less than
   *  QUICK_WAIT_MS ago keeps its racers (mergeQuick). */
  endedAt: number | null;
  /** the end of the wait a race's end or a call-off began (close, callOff); null from the next start. Until then a join
   *  that fills a quick room does not end that wait (joinRoom), so the result shows. */
  restUntil: number | null;
  /** how many people it holds (roomMaxFrom) */
  max: number;
};
/** What the members are sent. */
export type RoomView = Pick<Room, 'code' | 'eventId' | 'car' | 'hostId' | 'phase' | 'raceNo' | 'members' | 'goAt' | 'closesAt' | 'last' | 'note' | 'max' | 'quick' | 'startsAt' | 'restUntil'>;
/** What anyone holding the code may read before joining. */
export type Invitation = { host: string; eventId: string; car: RentalKey; count: number; max: number; phase: Phase };
type Ok = { ok: true };
type Denied = { ok: false; why: DenyWhy };
type Choice = { eventId: unknown; car: unknown };

const no = (why: DenyWhy): Denied => ({ ok: false, why });
const OK: Ok = { ok: true };
const find = (room: Room, id: string): Member | undefined => room.members.find(m => m.id === id);
const eventOf = (room: Room): EventDef | undefined => EVENTS.find(e => e.id === room.eventId);
const nameOf = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().slice(0, NAME_MAX) : '') || 'Racer';
const member = (who: { id: string; name: string }): Member => ({ id: who.id, name: nameOf(who.name), slot: 0, state: 'waiting', time: null, score: 0, why: null });
const setHost = (room: Room, m: Member | undefined): void => { room.hostId = m?.id ?? ''; if (m) room.hostName = m.name; };
const row = (m: Member): ResultRow => ({ id: m.id, name: m.name, pos: 0, time: m.time, score: m.score, why: m.why });
const toWaiting = (m: Member): void => { m.state = 'waiting'; m.time = null; m.score = 0; m.why = null; };
const count = (room: Room, state: MemberState): number => room.members.filter(m => m.state === state).length;

/** A race the host's stage has opened, and a car of the fleet. */
function checkChoice(pick: Choice, stage: number): { ok: true; eventId: string; car: RentalKey } | Denied {
  const ev = EVENTS.find(e => e.id === pick?.eventId), car = RENTAL_FLEET.find(f => f.key === pick?.car);
  if (!ev || ev.stage > stage || !car) return no('pick');
  return { ok: true, eventId: ev.id, car: car.key };
}

/** A new room, `host` in it. `from`: the address asking (none: no ration by address). `max`: how many it holds.
 *  `quick`: a quick race's room (findQuick finds it; its race and car are fixed; it starts by itself). */
export function createRoom(rooms: Map<string, Room>, host: { id: string; name: string }, pick: Choice, stage: number, rand: () => number, from = '', max = RACE_MAX, quick = false): { ok: true; room: Room } | Denied {
  if (rooms.size >= ROOMS_MAX) return no('busy');
  if (from && [...rooms.values()].filter(r => r.from === from).length >= ROOMS_PER_ADDRESS) return no('busy');
  const choice = checkChoice(pick, stage);
  if (!choice.ok) return choice;
  let code = makeCode(rand);
  for (let tries = 0; rooms.has(code) && tries < 50; tries++) code = makeCode(rand);
  if (rooms.has(code)) return no('busy');
  const first = member(host);
  const room: Room = {
    code, eventId: choice.eventId, car: choice.car, hostId: first.id, phase: 'open', raceNo: 0, members: [first],
    startedAt: null, goAt: null, closesAt: null, gone: [], last: null, note: null, emptySince: null, emptyFor: EMPTY_TTL_MS,
    hostName: first.name, from, max, quick, startsAt: null, endedAt: null, restUntil: null,
  };
  rooms.set(code, room);
  return { ok: true, room };
}

/** Into the room, in any phase: someone who arrives while a race is on is in the next one. In an open quick room the
 *  second to arrive starts its wait (`now`), and the one who fills it ends the wait: it starts at the next tick. */
export function joinRoom(room: Room, who: { id: string; name: string }, now?: number): Ok | Denied {
  if (find(room, who.id)) return OK;
  if (room.members.length >= room.max) return no('full');
  const m = member(who);
  room.members.push(m);
  if (room.quick && room.phase === 'open') room.note = null; // a start called off before they came is not theirs to read
  if (now !== undefined) {
    waitQuick(room, now);
    const resting = room.restUntil !== null && now < room.restUntil; // a race's end or a call-off began this wait: it holds
    if (room.quick && room.phase === 'open' && room.members.length >= room.max && room.members.length >= RACE_MIN && !resting) room.startsAt = now;
  }
  if (!room.hostId) setHost(room, m); // the room had emptied out: whoever comes back to it hosts
  room.emptySince = null;
  return OK;
}

/** Out of the room. `dropped`: the connection went rather than the member leaving (it decides how long an empty room is kept). */
export function leaveRoom(room: Room, id: string, now: number, dropped = false): void {
  const i = room.members.findIndex(m => m.id === id);
  if (i < 0) return;
  const [m] = room.members.splice(i, 1);
  // past the green light a racer stays on the result: with the time if they had finished, else as a DNF
  if (room.phase === 'racing' && (m.state === 'racing' || m.state === 'finished' || m.state === 'dnf'))
    room.gone.push(m.state === 'finished' ? row(m) : { ...row(m), time: null, why: m.state === 'dnf' ? m.why : 'left' });
  if (room.hostId === id) setHost(room, room.members[0]);
  if (room.members.length === 0) { room.emptySince = now; room.emptyFor = dropped ? DROPPED_TTL_MS : EMPTY_TTL_MS; }
  if (room.quick && room.members.length < RACE_MIN) room.startsAt = null; // alone again: no wait
  settle(room, now);
  // a quick room everyone has left forgets its race, after settle, which closes a race its last racer left: whoever the
  // list sends there next starts afresh
  if (room.quick && room.members.length === 0) { room.last = null; room.note = null; room.endedAt = room.restUntil = null; }
}

/** The host's next race, car and grid. No size keeps the room's own (a drag's is four); a size the server does not make
 *  (`ceiling`: roomSizeFor), or one smaller than the room, is refused and changes nothing. */
export function setRace(room: Room, id: string, pick: Choice & { size?: unknown }, stage: number, ceiling = RACE_MAX): Ok | Denied {
  if (id !== room.hostId) return no('host');
  if (room.phase !== 'open' || room.quick) return no('state'); // a quick room's race is its circuit's, fixed
  const choice = checkChoice(pick, stage);
  if (!choice.ok) return choice;
  const drag = EVENTS.find(e => e.id === choice.eventId)?.type === 'drag', asked = pick?.size;
  const size = asked === undefined || asked === null ? (drag ? RACE_MAX : room.max) : roomSizeFor(asked, ceiling, drag);
  if (size === null || size < room.members.length) return no('size');
  room.eventId = choice.eventId; room.car = choice.car; room.max = size;
  return OK;
}

/** Everyone in the room is in the race, each on a grid place that moves round by one from race to race. */
export function startRace(room: Room, id: string, now: number): Ok | Denied {
  if (id !== room.hostId) return no('host');
  if (room.phase !== 'open') return no('state');
  // a quick room's wait after a race or a call-off holds: its first member, a stranger to the others, cannot cut the
  // result short (the owner's call); the room starts by itself when the wait is over
  if (room.quick && room.restUntil !== null && now < room.restUntil) return no('state');
  const n = room.members.length;
  if (n < RACE_MIN) return no('few');
  room.raceNo++; room.startsAt = null; room.endedAt = null; room.restUntil = null;
  room.members.forEach((m, i) => { toWaiting(m); m.state = 'loading'; m.slot = (i + room.raceNo) % n; });
  room.phase = 'loading'; room.startedAt = now; room.goAt = room.closesAt = null; room.gone = []; room.note = null;
  return OK;
}

export function markReady(room: Room, id: string, now: number): Ok | Denied {
  const m = find(room, id);
  if (room.phase !== 'loading' || !m || m.state !== 'loading') return no('state');
  m.state = 'ready';
  settle(room, now);
  return OK;
}

/**
 * A racer's own word on their finish. `time` is seconds from the green light on the racer's clock; the server measured
 * the same span on its own (`now - goAt`). The claim stands when no car could beat it, and it agrees with the server's
 * figure: at most CLAIM_TOLERANCE_S under, CLAIM_LATE_S over. Otherwise the server's figure is the time.
 */
export function claimFinish(room: Room, id: string, claim: { time: unknown; score: unknown; failed: unknown }, now: number): Ok | Denied {
  const m = find(room, id), ev = eventOf(room);
  if (room.phase !== 'racing' || room.goAt === null || !m || m.state !== 'racing' || !ev) return no('state');
  if (claim?.failed) { m.state = 'dnf'; m.why = 'failed'; settle(room, now); return OK; }
  const elapsed = (now - room.goAt) / 1000, floor = raceFloor(ev);
  if (elapsed < floor) return no('state'); // nothing covers the distance that fast: not a finish
  const t = claim?.time;
  const stands = typeof t === 'number' && Number.isFinite(t) && t >= floor && t <= elapsed + CLAIM_LATE_S && elapsed - t <= CLAIM_TOLERANCE_S;
  m.time = Math.round((stands ? t : elapsed) * 1000) / 1000;
  const s = claim?.score;
  m.score = ev.type === 'drift' && typeof s === 'number' && Number.isFinite(s) ? Math.round(Math.min(SCORE_MAX, Math.max(0, s))) : 0;
  m.state = 'finished';
  if (room.closesAt === null) room.closesAt = now + FINISH_WINDOW_MS;
  settle(room, now);
  return OK;
}

/** Out of this race, still in the room: before the green light that costs nothing, after it it is a DNF. True when
 *  the room changed (a quit with nothing to quit changes nothing, and nobody needs telling). */
export function quitRace(room: Room, id: string, now: number): boolean {
  const m = find(room, id);
  if (!m) return false;
  if (room.phase === 'loading' && (m.state === 'loading' || m.state === 'ready')) toWaiting(m);
  else if (room.phase === 'racing' && m.state === 'racing') { m.state = 'dnf'; m.why = 'quit'; }
  else return false;
  settle(room, now);
  return true;
}

/** What only the clock decides: the slow are left behind, the finish window closes, a race nobody finishes ends. True when the room changed. */
export function tick(room: Room, now: number): boolean {
  // a quick room starts by itself at the end of its wait (a join that fills it ends the wait: joinRoom). A room full after
  // a race waits like any other, so its result shows for the whole wait.
  if (room.quick && room.phase === 'open' && room.members.length >= RACE_MIN && room.startsAt !== null && now >= room.startsAt)
    return startRace(room, room.hostId, now).ok;
  if (room.phase === 'loading' && room.startedAt !== null && now - room.startedAt >= LOAD_TIMEOUT_MS) {
    for (const m of room.members) if (m.state === 'loading') toWaiting(m);
    settle(room, now);
    return true;
  }
  if (room.phase === 'racing' && room.goAt !== null) {
    const ev = eventOf(room);
    const cap = room.goAt + (ev ? raceCapS(eventDistance(ev)) * 1000 : 0) + CAP_SLACK_MS;
    if ((room.closesAt !== null && now >= room.closesAt) || now >= cap) {
      for (const m of room.members) if (m.state === 'racing') { m.state = 'dnf'; m.why = 'timeout'; }
      close(room, now);
      return true;
    }
  }
  return false;
}

/** Drops the rooms nobody has been in for as long as they are kept (leaveRoom); returns their codes. */
export function sweep(rooms: Map<string, Room>, now: number): string[] {
  const dead: string[] = [];
  for (const [code, room] of rooms) if (room.members.length === 0 && room.emptySince !== null && now - room.emptySince >= room.emptyFor) dead.push(code);
  for (const code of dead) rooms.delete(code);
  return dead;
}

/** A member in a race that is on holds the lent car: until a DNF, or until the race closes. */
export function holdsLoan(room: Room, id: string): boolean {
  const m = find(room, id);
  return !!m && room.phase !== 'open' && (m.state === 'loading' || m.state === 'ready' || m.state === 'racing' || m.state === 'finished');
}

export function roomView(room: Room): RoomView {
  const { code, eventId, car, hostId, phase, raceNo, members, goAt, closesAt, last, note, max, quick, startsAt, restUntil } = room;
  return { code, eventId, car, hostId, phase, raceNo, members, goAt, closesAt, last, note, max, quick, startsAt, restUntil };
}

export function invitation(room: Room): Invitation {
  return { host: room.hostName, eventId: room.eventId, car: room.car, count: room.members.length, max: room.max, phase: room.phase };
}

// ---- the phases

/** After any change: a start goes once nobody is still loading, or is called off when too few are left; a race closes when nobody is racing. */
function settle(room: Room, now: number): void {
  if (room.phase === 'loading') {
    const loading = count(room, 'loading'), ready = count(room, 'ready');
    if (loading + ready < RACE_MIN) callOff(room, now);
    else if (loading === 0) go(room, now);
  } else if (room.phase === 'racing' && count(room, 'racing') === 0) close(room, now);
}

function go(room: Room, now: number): void {
  for (const m of room.members) if (m.state === 'ready') m.state = 'racing';
  room.phase = 'racing'; room.goAt = now + GO_LEAD_MS;
}

function callOff(room: Room, now: number): void {
  room.members.forEach(toWaiting);
  room.phase = 'open'; room.note = 'called-off'; room.startedAt = room.goAt = room.closesAt = null; room.gone = [];
  room.restUntil = now + QUICK_WAIT_MS;
  waitQuick(room, now);
}

/** An open quick room with two or more in it and no wait yet: its race starts QUICK_WAIT_MS from `now`. */
function waitQuick(room: Room, now: number): void {
  if (room.quick && room.phase === 'open' && room.startsAt === null && room.members.length >= RACE_MIN) room.startsAt = now + QUICK_WAIT_MS;
}

/** The result: finishers by time (a drift: by score, time breaking a tie), then everyone without a time. Back to the waiting room. */
function close(room: Room, now: number): void {
  const drift = eventOf(room)?.type === 'drift';
  const rows = [...room.members.filter(m => m.state === 'finished' || m.state === 'dnf').map(row), ...room.gone];
  const timed = (r: ResultRow) => r.time !== null && r.why === null;
  const home = rows.filter(timed).sort((p, q) => (drift ? q.score - p.score : 0) || p.time! - q.time!);
  const ranked = [...home, ...rows.filter(r => !timed(r))];
  ranked.forEach((r, i) => { r.pos = i + 1; });
  room.last = { raceNo: room.raceNo, eventId: room.eventId, rows: ranked }; room.endedAt = now; room.restUntil = now + QUICK_WAIT_MS;
  room.members.forEach(toWaiting);
  room.phase = 'open'; room.startedAt = room.goAt = room.closesAt = null; room.gone = [];
  waitQuick(room, now);
}

/** How many are in an open quick room, by circuit (GET /api/race/quick; the counter's Quick race list). A circuit with
 *  nobody waiting is left out, an emptied room too. */
export function quickWaiting(rooms: Map<string, Room>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rooms.values()) {
    if (!r.quick || r.phase !== 'open' || r.members.length === 0) continue;
    const track = EVENTS.find(e => e.id === r.eventId)?.track;
    if (track) out[track] = (out[track] ?? 0) + r.members.length;
  }
  return out;
}

/** A quick room's racers still loading when the load time is up. The server takes them out of the room and tells them
 *  why ('idle'): a page in a background tab would otherwise hold up every start, and in a room of two call off every
 *  one. A room made by link keeps them for its next race, as before (tick). */
export function missedLoad(room: Room, now: number): string[] {
  if (!room.quick || room.phase !== 'loading' || room.startedAt === null || now - room.startedAt < LOAD_TIMEOUT_MS) return [];
  return room.members.filter(m => m.state === 'loading').map(m => m.id);
}

/** One quick room filling per circuit, the owner's rules (2026-11-14). A room whose race ended less than QUICK_WAIT_MS
 *  ago is resting: its racers keep their room, their result and their wait, and the circuit's other open quick rooms move
 *  into it; two resting rooms stay apart. Any other open quick room counts like a fresh one: the fuller takes the emptier,
 *  so a racer left alone after a race joins the other room once its wait is over. Only whole rooms move: a room that does
 *  not fit stays together (people waiting to race each other are never split). A move is no join: it does not end the
 *  room's wait (joinRoom). Returns who moved where; the server moves their sockets. */
export function mergeQuick(rooms: Map<string, Room>, now: number): { id: string; from: string; to: string }[] {
  const moves: { id: string; from: string; to: string }[] = [];
  const resting = (r: Room) => r.endedAt !== null && now - r.endedAt < QUICK_WAIT_MS;
  const due = (r: Room) => r.startsAt !== null && now >= r.startsAt; // starts now (the loop's tick starts it first)
  const byEvent = new Map<string, Room[]>();
  for (const r of rooms.values())
    if (r.quick && r.phase === 'open' && r.members.length > 0) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r]);
  for (const list of byEvent.values()) {
    // each move empties a room, so this ends: at most one round per room
    for (let moved = true; moved;) {
      moved = false;
      const live = list.filter(r => r.members.length > 0);
      // into: a resting room first, else the fullest, with space; out of: the emptiest room that fits whole, is not
      // resting, does not start now, and (into a room that is not resting) is no fuller than it
      const into = live.filter(r => r.members.length < r.max).sort((p, q) => Number(resting(q)) - Number(resting(p)) || q.members.length - p.members.length);
      for (const to of into) {
        const from = live.filter(r => r !== to && !resting(r) && !due(r) && r.members.length <= to.max - to.members.length
          && (resting(to) || r.members.length <= to.members.length)).sort((p, q) => p.members.length - q.members.length)[0];
        if (!from) continue;
        for (const m of [...from.members]) {
          leaveRoom(from, m.id, now);
          joinRoom(to, { id: m.id, name: m.name });
          moves.push({ id: m.id, from: from.code, to: to.code });
        }
        waitQuick(to, now);
        moved = true;
        break;
      }
    }
  }
  return moves;
}

/** The quick room filling on `track`: open, with space, the fullest of them (undefined: none, open a new one). */
export function findQuick(rooms: Map<string, Room>, track: string): Room | undefined {
  const ev = quickEventOf(track);
  if (!ev) return undefined;
  let best: Room | undefined;
  for (const r of rooms.values())
    if (r.quick && r.eventId === ev.id && r.phase === 'open' && r.members.length < r.max && (!best || r.members.length > best.members.length)) best = r;
  return best;
}
