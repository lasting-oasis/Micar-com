/* A challenge race between people: the rules of its room. Who is in and who hosts, the start, the one green light,
   whose time stands, the result. Pure: the clock (`now`, in ms) and the random source are passed in, and nothing here
   touches a socket, a player record or a car. server.ts does the wiring; the page reads a RoomView. */
import { EVENTS, type EventDef } from './data';
import { eventDistance, raceFloor } from './payout';
import { makeCode } from './raceCode';
import { RENTAL_FLEET, type RentalKey } from './rental';
import { raceCapS } from './strip/events';

export { CODE_ALPHABET, CODE_LEN, makeCode, normalizeCode } from './raceCode';

/** A room holds at most this many people (the grid has four places), and a race needs at least two. */
export const RACE_MAX = 4, RACE_MIN = 2;
export const ROOMS_MAX = 100;
/** After Start a browser has this long to sit on the grid; the green light is named this far ahead; once the first car is
 *  home the rest have the window; an empty room keeps its link this long; a race closes this long after its event's cap. */
export const LOAD_TIMEOUT_MS = 30_000, GO_LEAD_MS = 5_000, FINISH_WINDOW_MS = 60_000, EMPTY_TTL_MS = 120_000, CAP_SLACK_MS = 30_000;
/** A browser's own time stands when it is at most this far under the server's figure (a slow connection), and at most
 *  CLAIM_LATE_S over it (two clocks never agree to the millisecond). */
export const CLAIM_TOLERANCE_S = 0.5, CLAIM_LATE_S = 0.1;
/** The lent car's colour, by grid place. */
export const SLOT_COLORS: readonly string[] = ['#ffd23f', '#2a9df4', '#e8463c', '#f3f6fb'];
const SCORE_MAX = 9_999_999;

export type Phase = 'open' | 'loading' | 'racing';
export type MemberState = 'waiting' | 'loading' | 'ready' | 'racing' | 'finished' | 'dnf';
/** Why a racer has no time. */
export type Why = 'quit' | 'failed' | 'left' | 'timeout';
/** Why the server said no. */
export type DenyWhy = 'gone' | 'full' | 'busy' | 'slow' | 'holding' | 'host' | 'few' | 'state' | 'pick';
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
  emptySince: number | null;
};
/** What the members are sent. */
export type RoomView = Pick<Room, 'code' | 'eventId' | 'car' | 'hostId' | 'phase' | 'raceNo' | 'members' | 'goAt' | 'closesAt' | 'last' | 'note'>;
/** What anyone holding the code may read before joining. */
export type Invitation = { host: string; eventId: string; car: RentalKey; count: number; max: number; phase: Phase };
type Ok = { ok: true };
type Denied = { ok: false; why: DenyWhy };
type Choice = { eventId: unknown; car: unknown };

const no = (why: DenyWhy): Denied => ({ ok: false, why });
const OK: Ok = { ok: true };
const find = (room: Room, id: string): Member | undefined => room.members.find(m => m.id === id);
const eventOf = (room: Room): EventDef | undefined => EVENTS.find(e => e.id === room.eventId);
const member = (who: { id: string; name: string }): Member => ({ id: who.id, name: who.name, slot: 0, state: 'waiting', time: null, score: 0, why: null });
const row = (m: Member): ResultRow => ({ id: m.id, name: m.name, pos: 0, time: m.time, score: m.score, why: m.why });
const toWaiting = (m: Member): void => { m.state = 'waiting'; m.time = null; m.score = 0; m.why = null; };
const count = (room: Room, state: MemberState): number => room.members.filter(m => m.state === state).length;

/** A race the host's stage has opened, and a car of the fleet. */
function checkChoice(pick: Choice, stage: number): { ok: true; eventId: string; car: RentalKey } | Denied {
  const ev = EVENTS.find(e => e.id === pick?.eventId), car = RENTAL_FLEET.find(f => f.key === pick?.car);
  if (!ev || ev.stage > stage || !car) return no('pick');
  return { ok: true, eventId: ev.id, car: car.key };
}

export function createRoom(rooms: Map<string, Room>, host: { id: string; name: string }, pick: Choice, stage: number, rand: () => number): { ok: true; room: Room } | Denied {
  if (rooms.size >= ROOMS_MAX) return no('busy');
  const choice = checkChoice(pick, stage);
  if (!choice.ok) return choice;
  let code = makeCode(rand);
  for (let tries = 0; rooms.has(code) && tries < 50; tries++) code = makeCode(rand);
  if (rooms.has(code)) return no('busy');
  const room: Room = {
    code, eventId: choice.eventId, car: choice.car, hostId: host.id, phase: 'open', raceNo: 0, members: [member(host)],
    startedAt: null, goAt: null, closesAt: null, gone: [], last: null, note: null, emptySince: null,
  };
  rooms.set(code, room);
  return { ok: true, room };
}

/** Into the room, in any phase: someone who arrives while a race is on is in the next one. */
export function joinRoom(room: Room, who: { id: string; name: string }): Ok | Denied {
  if (find(room, who.id)) return OK;
  if (room.members.length >= RACE_MAX) return no('full');
  room.members.push(member(who));
  if (!room.hostId) room.hostId = who.id; // the room had emptied out: whoever comes back to it hosts
  room.emptySince = null;
  return OK;
}

export function leaveRoom(room: Room, id: string, now: number): void {
  const i = room.members.findIndex(m => m.id === id);
  if (i < 0) return;
  const [m] = room.members.splice(i, 1);
  // past the green light a racer stays on the result: with the time if they had finished, else as a DNF
  if (room.phase === 'racing' && (m.state === 'racing' || m.state === 'finished' || m.state === 'dnf'))
    room.gone.push(m.state === 'finished' ? row(m) : { ...row(m), time: null, why: m.state === 'dnf' ? m.why : 'left' });
  if (room.hostId === id) room.hostId = room.members[0]?.id ?? '';
  if (room.members.length === 0) room.emptySince = now;
  settle(room, now);
}

export function setRace(room: Room, id: string, pick: Choice, stage: number): Ok | Denied {
  if (id !== room.hostId) return no('host');
  if (room.phase !== 'open') return no('state');
  const choice = checkChoice(pick, stage);
  if (!choice.ok) return choice;
  room.eventId = choice.eventId; room.car = choice.car;
  return OK;
}

/** Everyone in the room is in the race, each on a grid place that moves round by one from race to race. */
export function startRace(room: Room, id: string, now: number): Ok | Denied {
  if (id !== room.hostId) return no('host');
  if (room.phase !== 'open') return no('state');
  const n = room.members.length;
  if (n < RACE_MIN) return no('few');
  room.raceNo++;
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

/** Out of this race, still in the room: before the green light that costs nothing, after it it is a DNF. */
export function quitRace(room: Room, id: string, now: number): void {
  const m = find(room, id);
  if (!m) return;
  if (room.phase === 'loading' && (m.state === 'loading' || m.state === 'ready')) toWaiting(m);
  else if (room.phase === 'racing' && m.state === 'racing') { m.state = 'dnf'; m.why = 'quit'; }
  else return;
  settle(room, now);
}

/** What only the clock decides: the slow are left behind, the finish window closes, a race nobody finishes ends. True when the room changed. */
export function tick(room: Room, now: number): boolean {
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
      close(room);
      return true;
    }
  }
  return false;
}

/** Drops the rooms nobody has been in for EMPTY_TTL_MS; returns their codes. */
export function sweep(rooms: Map<string, Room>, now: number): string[] {
  const dead: string[] = [];
  for (const [code, room] of rooms) if (room.members.length === 0 && room.emptySince !== null && now - room.emptySince >= EMPTY_TTL_MS) dead.push(code);
  for (const code of dead) rooms.delete(code);
  return dead;
}

/** A member in a race that is on holds the lent car: until a DNF, or until the race closes. */
export function holdsLoan(room: Room, id: string): boolean {
  const m = find(room, id);
  return !!m && room.phase !== 'open' && (m.state === 'loading' || m.state === 'ready' || m.state === 'racing' || m.state === 'finished');
}

export function roomView(room: Room): RoomView {
  const { code, eventId, car, hostId, phase, raceNo, members, goAt, closesAt, last, note } = room;
  return { code, eventId, car, hostId, phase, raceNo, members, goAt, closesAt, last, note };
}

export function invitation(room: Room): Invitation {
  return { host: find(room, room.hostId)?.name ?? '', eventId: room.eventId, car: room.car, count: room.members.length, max: RACE_MAX, phase: room.phase };
}

// ---- the phases

/** After any change: a start goes once nobody is still loading, or is called off when too few are left; a race closes when nobody is racing. */
function settle(room: Room, now: number): void {
  if (room.phase === 'loading') {
    const loading = count(room, 'loading'), ready = count(room, 'ready');
    if (loading + ready < RACE_MIN) callOff(room);
    else if (loading === 0) go(room, now);
  } else if (room.phase === 'racing' && count(room, 'racing') === 0) close(room);
}

function go(room: Room, now: number): void {
  for (const m of room.members) if (m.state === 'ready') m.state = 'racing';
  room.phase = 'racing'; room.goAt = now + GO_LEAD_MS;
}

function callOff(room: Room): void {
  room.members.forEach(toWaiting);
  room.phase = 'open'; room.note = 'called-off'; room.startedAt = room.goAt = room.closesAt = null; room.gone = [];
}

/** The result: finishers by time (a drift: by score, time breaking a tie), then everyone without a time. Back to the waiting room. */
function close(room: Room): void {
  const drift = eventOf(room)?.type === 'drift';
  const rows = [...room.members.filter(m => m.state === 'finished' || m.state === 'dnf').map(row), ...room.gone];
  const timed = (r: ResultRow) => r.time !== null && r.why === null;
  const home = rows.filter(timed).sort((p, q) => (drift ? q.score - p.score : 0) || p.time! - q.time!);
  const ranked = [...home, ...rows.filter(r => !timed(r))];
  ranked.forEach((r, i) => { r.pos = i + 1; });
  room.last = { raceNo: room.raceNo, eventId: room.eventId, rows: ranked };
  room.members.forEach(toWaiting);
  room.phase = 'open'; room.startedAt = room.goAt = room.closesAt = null; room.gone = [];
}
