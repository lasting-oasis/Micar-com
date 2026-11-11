// The tester key: one secret the server reads from its environment (TESTER_KEY) and never sends, stores or logs.
// Server only (node:crypto). With no key configured tester mode is off and nothing here lets anyone in.
import { createHash, timingSafeEqual } from 'node:crypto';
import { TESTER_OFF, TESTER_REFUSED } from './tester';

export const TESTER_KEY_MIN = 8, TESTER_KEY_MAX = 128;
/** Misses allowed from one address in ten minutes, and from everywhere in an hour, before the key stops being looked at. */
export const ATTEMPTS_PER_IP = 5, ATTEMPT_WINDOW_MS = 10 * 60_000;
export const ATTEMPTS_GLOBAL = 30, GLOBAL_WINDOW_MS = 60 * 60_000;

/** The key to check against, or null when tester mode is off: unset, blank, or too short or too long to be a safe key. */
export function configuredTesterKey(env: string | undefined): string | null {
  const k = (env ?? '').trim();
  return k.length >= TESTER_KEY_MIN && k.length <= TESTER_KEY_MAX ? k : null;
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
/** Exact match, compared in constant time on digests (so neither the length nor a shared prefix shows in the timing). */
export function testerKeyMatches(candidate: unknown, configured: string | null): boolean {
  if (!configured || typeof candidate !== 'string' || candidate.length > TESTER_KEY_MAX + 2) return false;
  return timingSafeEqual(digest(candidate.trim()), digest(configured));
}

export type AttemptLog = { byIp: Map<string, number[]>; all: number[] };
export const newAttemptLog = (): AttemptLog => ({ byIp: new Map(), all: [] });

function prune(log: AttemptLog, now: number): void {
  log.all = log.all.filter(t => now - t < GLOBAL_WINDOW_MS);
  for (const [ip, ts] of log.byIp) {
    const keep = ts.filter(t => now - t < ATTEMPT_WINDOW_MS);
    if (keep.length) log.byIp.set(ip, keep); else log.byIp.delete(ip);
  }
}

/** Whether what came with a join is a try at the key at all. Anything shorter than a key can be is not: a name with a
 *  short tail ("Mike#1234") joins as an ordinary guest, is not refused, and is not counted as a miss. */
export const isKeyAttempt = (k: unknown): k is string => typeof k === 'string' && k.trim().length >= TESTER_KEY_MIN;

export type KeyVerdict = { ok: true } | { ok: false; why: 'off' } | { ok: false; why: 'wrong' } | { ok: false; why: 'locked'; retryMs: number };
export type KeyRefusal = Exclude<KeyVerdict, { ok: true }>;

/** One try at the key from one address. A miss is counted; past either limit the key is not even looked at (so the
 *  right key is refused too, until the window passes, and a try made while locked is not counted); the right key
 *  forgets that address's own misses. A refusal says why, and when locked, how long until one more try opens. */
export function checkTesterKey(candidate: unknown, configured: string | null, log: AttemptLog, ip: string, now: number): KeyVerdict {
  if (!configured) return { ok: false, why: 'off' };
  prune(log, now);
  const mine = log.byIp.get(ip) ?? [];
  const waits: number[] = [];
  if (mine.length >= ATTEMPTS_PER_IP) waits.push(mine[0] + ATTEMPT_WINDOW_MS - now);
  if (log.all.length >= ATTEMPTS_GLOBAL) waits.push(log.all[0] + GLOBAL_WINDOW_MS - now);
  if (waits.length) return { ok: false, why: 'locked', retryMs: Math.max(...waits) };
  if (testerKeyMatches(candidate, configured)) { log.byIp.delete(ip); return { ok: true }; }
  mine.push(now); log.byIp.set(ip, mine); log.all.push(now);
  return { ok: false, why: 'wrong' };
}

/** The line a refused tester reads. It never repeats what was typed. */
export function refusalText(v: KeyRefusal): string {
  if (v.why === 'off') return TESTER_OFF;
  if (v.why === 'wrong') return TESTER_REFUSED;
  const min = Math.max(1, Math.ceil(v.retryMs / 60_000));
  return `Too many wrong keys. Try again in ${min} minute${min === 1 ? '' : 's'}.`;
}
