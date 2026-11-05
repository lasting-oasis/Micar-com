/* What a Strip run pays, and the checks the server makes before paying it.
   Pure (no I/O): the server calls these on its own player records; applyPayout mutates the Player it is given. */
import { CATS, EVENTS, TUNES, TUNE_DEF, freshStrip, prizeFor, stageOf, visualRating, type EventDef, type PartValue } from './data';
import { buildRoute } from './strip/routes';
import type { Tune } from './physics';
import type { Player } from '../types';

export type FinishMsg = { eventId: string; pos: number; time: number | null; score: number; failed: boolean };
export type EventEntry = { eventId: string; startedAt: number; carId?: string };
export type Reward = { cash: number; octane: number; rep: number; stamps: string[] };

/** Nobody averages 90 m/s on the Strip. */
export const MAX_AVG_MS = 90;
/** An entry older than this is abandoned. */
export const ENTRY_TTL_MS = 20 * 60 * 1000;
export const OUTRUN_ID = 'outrun';
/** A won outrun takes well over this long; one is paid at most this often, starting from entering the Strip. */
export const OUTRUN_MIN_MS = 20 * 1000;

/** An outrun pays only from inside the Strip (lastAt is set on entering it), outside an event, and not sooner than OUTRUN_MIN_MS after the last one or the entry. */
export function validateOutrun(lastAt: number | undefined, now: number, hasEntry: boolean): { ok: true } | { ok: false; reason: string } {
  if (lastAt == null) return { ok: false, reason: 'not in the Strip' };
  if (hasEntry) return { ok: false, reason: 'an event is live' };
  if (now - lastAt < OUTRUN_MIN_MS) return { ok: false, reason: 'too soon' };
  return { ok: true };
}

const routeLen = new Map<string, number>();
/** The distance an event covers, in metres: one route length, times the laps on a loop. */
export function eventDistance(ev: EventDef): number {
  let len = routeLen.get(ev.id);
  if (len == null) { len = buildRoute(ev.nodes, !!ev.loop).len; routeLen.set(ev.id, len); }
  return ev.loop ? len * (ev.laps || 1) : len;
}

export function validateFinish(entry: EventEntry | undefined, msg: FinishMsg, now: number): { ok: true; pos: number } | { ok: false; reason: string } {
  if (!entry) return { ok: false, reason: 'no live entry' };
  if (!msg || entry.eventId !== msg.eventId) return { ok: false, reason: 'wrong event' };
  const ev = EVENTS.find(e => e.id === msg.eventId);
  if (!ev) return { ok: false, reason: 'unknown event' };
  if (now - entry.startedAt > ENTRY_TTL_MS) return { ok: false, reason: 'entry expired' };
  const pos = msg.pos;
  if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 1 || pos > 4) return { ok: false, reason: 'bad position' };
  if (!msg.failed) {
    const floor = eventDistance(ev) / MAX_AVG_MS;
    if (typeof msg.time !== 'number' || !Number.isFinite(msg.time) || msg.time < floor) return { ok: false, reason: 'impossible time' };
    if ((now - entry.startedAt) / 1000 < floor) return { ok: false, reason: 'impossible time' };
  }
  return { ok: true, pos };
}

/** The synthetic event an outrun pays as: 800 + 250 per stage above 1, rep 60. */
export function outrunEvent(stage: number): EventDef {
  return { id: OUTRUN_ID, type: 'sprint', name: 'Outrun', nodes: [], prize: 800 + 250 * (Math.max(1, stage) - 1), rep: 60, stage: 1 };
}

/** Fills the Strip fields on a player saved before they existed. */
export function ensureStrip(p: Player): Player {
  const s = p.strip as Partial<NonNullable<Player['strip']>> | undefined;
  if (!s || typeof s !== 'object') p.strip = freshStrip();
  else {
    if (typeof s.rep !== 'number' || !Number.isFinite(s.rep)) s.rep = 0;
    if (!s.cars || typeof s.cars !== 'object') s.cars = {};
    if (!s.wins || typeof s.wins !== 'object') s.wins = {};
    if (!s.best || typeof s.best !== 'object') s.best = {};
  }
  if (typeof p.octane !== 'number' || !Number.isFinite(p.octane)) p.octane = 0;
  if (!Array.isArray(p.stamps)) p.stamps = [];
  return p;
}

export function applyPayout(player: Player, ev: EventDef, pos: number, failed: boolean, opts: { time?: number | null; carId?: string } = {}): Reward {
  ensureStrip(player);
  const rec = player.strip!;
  const stage = stageOf(rec.rep);
  const won = !failed && pos === 1;
  let cash: number, rep: number, octane: number;
  if (ev.id === OUTRUN_ID) {
    cash = won ? ev.prize : 0; rep = won ? ev.rep : 0; octane = Math.round(25 * rep / 100);
  } else {
    const cfg = opts.carId ? rec.cars[opts.carId]?.cfg : undefined;
    const pr = prizeFor(ev, pos, stage, cfg ? visualRating(cfg) : 0, failed);
    cash = pr.cash + pr.styleBonus; rep = pr.rep; octane = pr.octane;
  }
  const stamps: string[] = [];
  if (won) {
    const firstEver = !Object.values(rec.wins).some(n => n > 0);
    if (firstEver) stamps.push('strip:first-win');
    if (ev.id === OUTRUN_ID) stamps.push('strip:outrun');
    else if (ev.type === 'drag') stamps.push('strip:drag');
    else if (ev.type === 'drift') stamps.push('strip:drift');
    rec.wins[ev.id] = (rec.wins[ev.id] || 0) + 1;
  }
  if (!failed && typeof opts.time === 'number' && Number.isFinite(opts.time)) {
    const prev = rec.best[ev.id];
    if (prev == null || opts.time < prev) rec.best[ev.id] = opts.time;
  }
  player.money += cash;
  if (cash && player.balanceSheet) { player.balanceSheet.totalIncome += cash; player.balanceSheet.lastTickIncome += cash; }
  player.octane += octane;
  rec.rep += rep;
  const fresh = stamps.filter(s => !player.stamps.includes(s));
  player.stamps.push(...fresh);
  return { cash, octane, rep, stamps: fresh };
}

/** The catalog price of part key=v, or why it can't be bought at this stage. */
export function partPrice(key: string, v: PartValue, stage: number): { ok: true; price: number } | { ok: false; reason: string } {
  const cat = CATS[key];
  if (!cat) return { ok: false, reason: 'Unknown part.' };
  const it = cat.items.find(i => i.v === v);
  if (!it) return { ok: false, reason: 'Unknown part.' };
  if ((it.stage ?? 1) > stage) return { ok: false, reason: `Needs stage ${it.stage}.` };
  return { ok: true, price: it.p };
}

/** Each slider clamped to -1..1 in 0.1 steps; anything missing or not a number is 0. */
export function clampTune(t: unknown): Tune {
  const src = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
  const out: Tune = { ...TUNE_DEF };
  for (const { k } of TUNES) {
    const n = src[k];
    out[k] = typeof n === 'number' && Number.isFinite(n) ? (Math.round(Math.max(-1, Math.min(1, n)) * 10) / 10 || 0) : 0;
  }
  return out;
}
