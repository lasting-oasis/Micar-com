// Who hears whose position, how often, and in how few bytes (docs/superpowers/specs/2026-11-14-world-data-diet-design.md).
// Pure: the server's relay (server.ts) and the page's reader (store.ts) both use it, and its tests run it on a fake clock.
import { GATE_RETURN } from '../scene/world/gateSpot';
import { WORLD_PER_M } from './units';

/** A position as the page keeps it for each player (store.ts playerPositions): the town position, and in the Strip the
 *  gate spot (district 'strip') with the Strip pose in stripPosition. World units. */
export type Pose = { x: number; y?: number; z: number; rotation?: number };
export type NetPos = Pose & { district?: 'town' | 'strip'; stripPosition?: Pose };

/** The relay ticks every 100 ms, as before. */
export const TICK_MS = 100;
/** The 20 nearest players in your district within 200 m: every tick. Within 400 m: every 500 ms. The rest of your
 *  district: every second. Other districts: every 5 seconds. */
export const NEAR_COUNT = 20, NEAR_M = 200, MID_M = 400;
export const MID_MS = 500, FAR_MS = 1000, AWAY_MS = 5000;
/** A player who has not moved for this long is sent once more, reliably. */
export const QUIET_MS = 300;
/** The Strip's circuits sit on an 8 km grid around the hub; each district of the Strip is one square of it. */
export const GRID_M = 8000;
/** A send is due when its period has run, less half a tick (timers are not exact). */
const SLACK_MS = TICK_MS / 2;

// x and z in tenths of a world unit, y in hundredths, heading in hundredths of a radian
const XZ = 10, Y = 100, R = 100;

/** What the server relays for one player (as player_positions did): its stored position, with its Strip pose when it is
 *  in the Strip and has one. undefined when it has no position yet. */
export function relayed(world: NetPos | undefined, strip: NetPos | undefined): NetPos | undefined {
  if (!world) return undefined;
  return strip && world.district === 'strip' ? { ...world, stripPosition: strip } : world;
}

const wrap = (r: number) => {
  const a = r % (2 * Math.PI);
  return a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a;
};
const q = (v: number | undefined, scale: number) => Math.round((Number.isFinite(v) ? (v as number) : 0) * scale) || 0;

/** One player as whole numbers: n * 4 + kind, then kind 0 (town) x, y, z, heading; kind 1 (Strip pose) x, z, heading;
 *  kind 2 (in the Strip, no pose yet) x, y, z, heading. */
export function encodeEntry(n: number, p: NetPos): number[] {
  const h = (r: number | undefined) => q(wrap(Number.isFinite(r) ? (r as number) : 0), R);
  if (p.district === 'strip' && p.stripPosition) {
    const s = p.stripPosition;
    return [n * 4 + 1, q(s.x, XZ), q(s.z, XZ), h(s.rotation)];
  }
  return [n * 4 + (p.district === 'strip' ? 2 : 0), q(p.x, XZ), q(p.y, Y), q(p.z, XZ), h(p.rotation)];
}

/** A pos message back into the objects the page keeps, by player id. Entries for unknown players are skipped; anything
 *  malformed ends the reading there. Never throws. */
export function decodePositions(flat: unknown, idOf: (n: number) => string | undefined): Record<string, NetPos> {
  const out: Record<string, NetPos> = {};
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i < flat.length;) {
    const head = flat[i];
    if (!Number.isSafeInteger(head) || head < 0) break;
    const kind = head % 4, n = (head - kind) / 4, len = kind === 1 ? 3 : 4;
    if (kind === 3) break;
    const f = flat.slice(i + 1, i + 1 + len) as unknown[];
    if (f.length < len || !f.every(v => typeof v === 'number' && Number.isFinite(v))) break;
    i += 1 + len;
    const id = idOf(n);
    if (id === undefined) continue;
    const v = f as number[];
    out[id] = kind === 1
      ? { x: GATE_RETURN.x, y: 0, z: GATE_RETURN.z, rotation: GATE_RETURN.rotY, district: 'strip', stripPosition: { x: v[0] / XZ, y: 0, z: v[1] / XZ, rotation: v[2] / R } }
      : { x: v[0] / XZ, y: v[1] / Y, z: v[2] / XZ, rotation: v[3] / R, district: kind === 0 ? 'town' : 'strip' };
  }
  return out;
}

const samePose = (a: Pose | undefined, b: Pose | undefined) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.rotation === b.rotation);
/** Whether two kept positions are the same (a reliable copy after a stop repeats the last one). */
const samePos = (a: NetPos | undefined, b: NetPos) => !!a && samePose(a, b) && a.district === b.district && samePose(a.stripPosition, b.stripPosition);

/** The page's side: a pos message merged into the positions it keeps, by the short number on each player's record (`n`).
 *  The same object back when the message changed nothing (no player it knows, or only positions it already has). */
export function mergePositions(kept: Record<string, NetPos>, flat: unknown, players: Record<string, { n?: number }> | undefined): Record<string, NetPos> {
  const ids = new Map<number, string>();
  for (const id in players ?? {}) { const n = players![id]?.n; if (typeof n === 'number') ids.set(n, id); }
  const got = decodePositions(flat, n => ids.get(n));
  const changed = Object.keys(got).filter(id => !samePos(kept[id], got[id]));
  if (!changed.length) return kept;
  const next = { ...kept };
  for (const id of changed) next[id] = got[id];
  return next;
}

/** The positions kept for players still in the state; the same object back when none has gone. */
export function keepOnly(kept: Record<string, NetPos>, players: Record<string, unknown> | undefined): Record<string, NetPos> {
  const gone = Object.keys(kept).filter(id => !players?.[id]);
  if (!gone.length) return kept;
  const next = { ...kept };
  for (const id of gone) delete next[id];
  return next;
}

/** Where a player is drawn, in world units: its Strip pose in the Strip, else its stored position. */
const placeOf = (p: NetPos): Pose => (p.district === 'strip' && p.stripPosition) || p;

/** The town, or the Strip's 8 km grid square ('strip:0,0' is the hub). A missing district is the town, as the page reads it. */
export function districtOf(p: NetPos): string {
  if (p.district !== 'strip') return 'town';
  const s = placeOf(p), cell = GRID_M * WORLD_PER_M;
  return `strip:${Math.round(s.x / cell) || 0},${Math.round(s.z / cell) || 0}`;
}

/** How often (ms) a recipient hears a player: by whether they share a district, the player's rank among the recipient's
 *  district by distance (0 = nearest), and its distance in metres. */
export function periodMs(sameDistrict: boolean, rank: number, distM: number): number {
  if (!sameDistrict) return AWAY_MS;
  if (rank < NEAR_COUNT && distM <= NEAR_M) return TICK_MS;
  return distM <= MID_M ? MID_MS : FAR_MS;
}

type Rec = { n: number; entry: number[]; key: string; ver: number; changedAt: number; district: string; xm: number; zm: number };
type Sent = { ver: number; at: number; sure: boolean; district: string };
export type Outgoing = { moving: number[]; sure: number[] };

/** The server's side: what each recipient is due this tick. `moving` may be dropped on a backed-up connection (the next
 *  one is coming); `sure` must arrive: first contact, a change of district, and a player's last position once it stops. */
export class PositionRelay {
  private recs = new Map<string, Rec>();
  /** recipient -> player -> the last send */
  private sent = new Map<string, Map<string, Sent>>();

  tick(now: number, players: ReadonlyMap<string, { n: number; pos: NetPos }>, recipients: Iterable<string>): Map<string, Outgoing> {
    for (const [id, { n, pos }] of players) {
      const entry = encodeEntry(n, pos), key = entry.join(','), r = this.recs.get(id);
      if (r && r.key === key) continue;
      const at = placeOf(pos), next = { n, entry, key, ver: (r?.ver ?? 0) + 1, changedAt: now, district: districtOf(pos), xm: at.x / WORLD_PER_M, zm: at.z / WORLD_PER_M };
      this.recs.set(id, next);
    }
    for (const id of this.recs.keys()) if (!players.has(id)) this.recs.delete(id);

    const out = new Map<string, Outgoing>();
    for (const rid of recipients) {
      let sentTo = this.sent.get(rid);
      if (!sentTo) this.sent.set(rid, sentTo = new Map());
      for (const id of sentTo.keys()) if (!this.recs.has(id)) sentTo.delete(id);
      const me = this.recs.get(rid);
      // the recipient's district, nearest first
      const rank = new Map<string, { k: number; d: number }>();
      if (me) {
        const same: { id: string; d: number }[] = [];
        for (const [id, r] of this.recs) if (id !== rid && r.district === me.district) same.push({ id, d: Math.hypot(r.xm - me.xm, r.zm - me.zm) });
        same.sort((a, b) => a.d - b.d);
        same.forEach((s, k) => rank.set(s.id, { k, d: s.d }));
      }
      const moving: number[] = [], sure: number[] = [];
      for (const [id, r] of this.recs) {
        if (id === rid) continue;
        const s = sentTo.get(id), quiet = now - r.changedAt >= QUIET_MS;
        let how: 'moving' | 'sure' | null = null;
        if (!s || s.district !== r.district) how = 'sure';
        else if (s.ver !== r.ver) {
          if (quiet) how = 'sure';
          else {
            const at = rank.get(id);
            if (now - s.at >= periodMs(!!at, at?.k ?? 0, at?.d ?? 0) - SLACK_MS) how = 'moving';
          }
        } else if (!s.sure && quiet) how = 'sure';
        if (!how) continue;
        (how === 'sure' ? sure : moving).push(...r.entry);
        sentTo.set(id, { ver: r.ver, at: now, sure: how === 'sure', district: r.district });
      }
      if (moving.length || sure.length) out.set(rid, { moving, sure });
    }
    return out;
  }

  /** A connection is gone: nobody hears of it again, and it is sent nothing. */
  forget(id: string): void {
    this.recs.delete(id);
    this.sent.delete(id);
    for (const sentTo of this.sent.values()) sentTo.delete(id);
  }

  /** A page starts again from nothing (a new init): the next tick sends it everyone, reliably. */
  forgetRecipient(id: string): void {
    this.sent.delete(id);
  }
}
