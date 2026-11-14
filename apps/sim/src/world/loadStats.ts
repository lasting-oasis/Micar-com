/* The load test's arithmetic (e2e/load.ts runs the test): what a step is, percentiles, which servers are on this PC, and
   the verdict on one step against the spec's limits ("Capacity: how many racers the $7 instance carries" in
   docs/superpowers/specs/2026-11-13-platform-upgrade-design.md). The limits are proposals: change them there first. Pure. */
import type { Load } from './health';
import { RACE_MIN, ROOM_MAX_LIMIT, ROOMS_PER_ADDRESS } from './race';

/** One step of the test: `rooms` challenge rooms of `size` racers each, all racing at once. */
export type StepSpec = { size: number; rooms: number };

/** "4x1, 16x2": `size` from RACE_MIN to ROOM_MAX_LIMIT (2 to 16), `rooms` from 1 to ROOMS_PER_ADDRESS (20, the rooms one
 *  address may hold at a time). Null if any part is not that. */
export function parseSteps(s: string): StepSpec[] | null {
  const steps: StepSpec[] = [];
  for (const part of s.split(',')) {
    const m = /^(\d+)x(\d+)$/.exec(part.trim());
    if (!m) return null;
    const size = Number(m[1]), rooms = Number(m[2]);
    if (size < RACE_MIN || size > ROOM_MAX_LIMIT || rooms < 1 || rooms > ROOMS_PER_ADDRESS) return null;
    steps.push({ size, rooms });
  }
  return steps;
}

/** The p-th percentile by nearest rank, on a sorted copy; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/** True for a server on this PC: hostname localhost, 127.0.0.1 or [::1], any port. */
export function isLocalBase(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type StepResult = {
  size: number; rooms: number;
  /** every pose sent × (size − 1): each one is passed to everyone else in its room */
  posesExpected: number; posesReceived: number;
  /** receive time − the pose's own send time, on one clock */
  delayMs: { p50: number; p95: number; p99: number };
  /** the median race_time round trip before the step */
  baselineRttMs: number;
  /** the highest of each figure /healthz gave during the race; null when none came */
  server: Load | null;
  /** this program's own event-loop delay, p99, in ms */
  harnessLoopP99Ms: number;
};

/** The spec's limits. On this PC a step "fits the $7 instance" at up to 25% of one core: half of that instance's half
 *  core, leaving room for slower cores and the rest of the World. On the instance itself the limit is 35% (70% of it). */
export const LIMITS = { lostPercent: 1, addedDelayP95Ms: 50, loopDelayP99Ms: 50, harnessLoopP99Ms: 25, cpuLocalPercent: 25, cpuRemotePercent: 35 };

/** Whether a step passed, whether it fits the $7 instance (null: not judged), and every limit it broke. */
export function verdict(r: StepResult, where: 'local' | 'remote'): { pass: boolean; fits7: boolean | null; reasons: string[] } {
  if (r.harnessLoopP99Ms > LIMITS.harnessLoopP99Ms) {
    return { pass: false, fits7: null, reasons: [`this computer was the bottleneck (its own event loop ${r.harnessLoopP99Ms} ms late at p99, over ${LIMITS.harnessLoopP99Ms} ms), so the step says nothing about the server`] };
  }
  if (!r.server) return { pass: false, fits7: null, reasons: ['no load figures from /healthz'] };
  const reasons: string[] = [];
  if (r.posesExpected <= 0) reasons.push('no position was sent, so nothing was measured');
  const lost = r.posesExpected > 0 ? (100 * (r.posesExpected - r.posesReceived)) / r.posesExpected : 0;
  if (lost > LIMITS.lostPercent) reasons.push(`${lost.toFixed(1)}% of positions lost (limit ${LIMITS.lostPercent}%)`);
  const added = r.delayMs.p95 - r.baselineRttMs;
  if (added > LIMITS.addedDelayP95Ms) reasons.push(`positions arrived ${Math.round(added)} ms later than the plain round trip at p95 (limit ${LIMITS.addedDelayP95Ms} ms)`);
  if (r.server.loopDelayP99Ms > LIMITS.loopDelayP99Ms) reasons.push(`the server's event loop was ${r.server.loopDelayP99Ms} ms late at p99 (limit ${LIMITS.loopDelayP99Ms} ms)`);
  const budget = where === 'local' ? LIMITS.cpuLocalPercent : LIMITS.cpuRemotePercent;
  const fits7 = r.server.cpuPercent <= budget;
  if (where === 'remote' && !fits7) reasons.push(`the $7 instance used ${r.server.cpuPercent}% of one core (limit ${budget}%)`);
  return { pass: reasons.length === 0, fits7, reasons };
}
