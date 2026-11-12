// The challenge screens' words and small sums, apart from their React: which line a refusal gets, the link a room is
// sent by, how a race and a car are named, and what a result row says. Pure.
import { EVENTS, EV_NAME } from '../world/data';
import { fmtT } from '../world/hud';
import type { DenyWhy } from '../world/race';
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
