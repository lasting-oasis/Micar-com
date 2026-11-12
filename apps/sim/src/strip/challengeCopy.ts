// The challenge screens' words and small sums, apart from their React: which line a refusal gets, the link a room is
// sent by, how a race and a car are named, and what a result row says. Pure.
import { EVENTS, EV_NAME } from '../world/data';
import { fmtT } from '../world/hud';
import type { DenyWhy, RoomView } from '../world/race';
import { RENTAL_FLEET } from '../world/rental';

/** Every line the challenge screens show: each is in i18n.tsx, in English and in Spanish. */
export const CH_KEYS: readonly string[] = [
  'strip.ch.button', 'strip.ch.title', 'strip.ch.pickRace', 'strip.ch.pickCar', 'strip.ch.getLink', 'strip.ch.back',
  'strip.ch.room', 'strip.ch.link', 'strip.ch.share', 'strip.ch.copy', 'strip.ch.copied', 'strip.ch.shareText',
  'strip.ch.host', 'strip.ch.you', 'strip.ch.start', 'strip.ch.needTwo', 'strip.ch.waitingHost', 'strip.ch.change', 'strip.ch.save', 'strip.ch.leave',
  'strip.ch.loading', 'strip.ch.getReady', 'strip.ch.inProgress', 'strip.ch.missed', 'strip.ch.calledOff',
  'strip.ch.last', 'strip.ch.dnf', 'strip.ch.racing', 'strip.ch.waitOthers', 'strip.ch.won', 'strip.ch.place', 'strip.ch.out',
  'strip.ch.invited', 'strip.ch.invitedPlain', 'strip.ch.join',
  'strip.ch.gone', 'strip.ch.full', 'strip.ch.onlyHost', 'strip.ch.busy', 'strip.ch.holding', 'strip.ch.pick', 'strip.ch.notNow',
];

const DENY: Record<DenyWhy, string> = {
  gone: 'strip.ch.gone', full: 'strip.ch.full', host: 'strip.ch.onlyHost', busy: 'strip.ch.busy', slow: 'strip.ch.busy',
  holding: 'strip.ch.holding', pick: 'strip.ch.pick', few: 'strip.ch.needTwo', state: 'strip.ch.notNow',
};
/** The line for a refusal; a reason this page does not know is still a no. */
export const denyKey = (why: DenyWhy): string => DENY[why] ?? DENY.state;

/** The link a room is sent by: the Strip's entry card, with the room in the address. */
export const shareUrl = (origin: string, code: string): string => `${origin}/strip?race=${code}`;

/** A race as the Strip's prompts name it ('Drag: Royal Park Quarter'); '' for an id that is not a race. */
export function raceLabel(eventId: string): string {
  const ev = EVENTS.find(e => e.id === eventId);
  return ev ? `${EV_NAME[ev.type]}: ${ev.name}` : '';
}
/** A fleet car by its name ('Ronin GT'); '' for a key that is not one. */
export function carLabel(key: string): string {
  const f = RENTAL_FLEET.find(c => c.key === key);
  return f ? `${f.make} ${f.model}` : '';
}

export type CardRow = { name: string; me: boolean; txt: string };
/** Result rows for a card: a time (a drift: the score), or that the racer is out, or still racing. */
export function rowsOf(rows: readonly { id: string; name: string; time: number | null; score: number; why: string | null }[], meId: string, drift: boolean, words: { dnf: string; racing: string }): CardRow[] {
  return rows.map(r => ({
    name: r.name, me: r.id === meId,
    txt: r.why ? words.dnf : r.time == null ? words.racing : drift ? Math.round(r.score).toLocaleString('en-US') : fmtT(r.time),
  }));
}

/** What a challenge's results card shows, for the race `raceNo` as the player `me` drove it: the room's result once it
 *  has closed that race; until then those home first (by time; a drift by score), then those still racing, then those
 *  who are out. `title`: this player won, has a place (`place` of `of`), or is out. Nobody has won until the race closes. */
export type ChallengeCard = { title: 'won' | 'place' | 'out'; place: number; of: number; eventId: string; rows: CardRow[]; pending: boolean };
export function cardOf(room: Pick<RoomView, 'eventId' | 'members' | 'last'>, raceNo: number, me: string, words: { dnf: string; racing: string }): ChallengeCard {
  const closed = room.last && room.last.raceNo === raceNo ? room.last : null;
  const eventId = closed ? closed.eventId : room.eventId, drift = EVENTS.find(e => e.id === eventId)?.type === 'drift';
  const rank = (m: { state: string }) => (m.state === 'finished' ? 0 : m.state === 'racing' ? 1 : 2);
  const rows = closed ? closed.rows
    : room.members.filter(m => m.state === 'racing' || m.state === 'finished' || m.state === 'dnf')
      .sort((p, q) => rank(p) - rank(q) || (drift ? q.score - p.score : (p.time ?? 0) - (q.time ?? 0)));
  const at = rows.findIndex(r => r.id === me), mine = rows[at];
  const out = !mine || !!mine.why, place = at + 1;
  return { title: out ? 'out' : closed && place === 1 ? 'won' : 'place', place, of: rows.length, eventId, rows: rowsOf(rows, me, drift, words), pending: !closed };
}

/** What the room says of the racer `pid` in the race `raceNo`: home in `time` seconds; out of it (`time` null: quit, left,
 *  left behind at the start); or, null, still racing. Once the room has closed that race its result decides. */
export function newsOf(room: Pick<RoomView, 'members' | 'last'>, raceNo: number, pid: string): { time: number | null } | null {
  const row = room.last && room.last.raceNo === raceNo ? room.last.rows.find(r => r.id === pid) : undefined;
  if (row) return { time: row.why ? null : row.time };
  const m = room.members.find(x => x.id === pid);
  if (m?.state === 'finished') return { time: m.time };
  if (!m || m.state === 'waiting' || m.state === 'dnf') return { time: null };
  return null;
}
