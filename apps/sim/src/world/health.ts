/* What GET /healthz tells anyone outside: that a deploy happened (bootId changes on every boot), whether this boot found
   the save file on the disk (saveAtBoot), how long ago the World last saved, two counts, which sign-ins are on, and the
   server's own CPU, event-loop delay and memory. Counts, booleans and figures only: never an email address, an account id,
   a token, a secret or a player's name. healthReport and loadFrom are pure; startLoadSampler reads this process. */
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/** What loadOrQuarantine found at boot (persistence.ts); null until the load has finished. */
export type SaveAtBoot = 'loaded' | 'missing' | 'quarantined' | null;
/** The server's own load over the last window: CPU time as a percent of one core, the event loop's 99th-percentile delay
 *  in ms, resident memory in whole MB. */
export type Load = { cpuPercent: number; loopDelayP99Ms: number; rssMb: number };
export type HealthInput = {
  bootedAt: number; now: number; saveAtBoot: SaveAtBoot; savedAt: number | null;
  accounts: number; players: number; caps: { google: boolean; magic: boolean }; load: Load;
};
export type HealthReport = {
  ok: true; bootId: string; upSeconds: number; saveAtBoot: SaveAtBoot; savedSecondsAgo: number | null;
  accounts: number; players: number; signIn: { google: boolean; magic: boolean }; load: Load;
};

/** Whole seconds, never below 0: a clock that steps back reads 0, not a negative age. */
const seconds = (ms: number): number => Math.max(0, Math.floor(ms / 1000));
const oneDecimal = (x: number): number => Math.max(0, Math.round(x * 10) / 10);

export function healthReport(i: HealthInput): HealthReport {
  return {
    ok: true, bootId: i.bootedAt.toString(36), upSeconds: seconds(i.now - i.bootedAt), saveAtBoot: i.saveAtBoot,
    savedSecondsAgo: i.savedAt === null ? null : seconds(i.now - i.savedAt), accounts: i.accounts, players: i.players,
    signIn: { google: i.caps.google, magic: i.caps.magic }, load: i.load,
  };
}

/** CPU time used over a window as a percent of one core (on the $7 instance 50 is flat out: it has half a core); the
 *  loop's p99 delay from nanoseconds to ms; memory from bytes to whole MB. A window of 0 ms gives 0% CPU. */
export function loadFrom(cpuMicros: number, wallMs: number, loopP99Ns: number, rssBytes: number): Load {
  return {
    cpuPercent: wallMs > 0 ? oneDecimal((cpuMicros / 1000 / wallMs) * 100) : 0,
    loopDelayP99Ms: oneDecimal(loopP99Ns / 1e6),
    rssMb: Math.max(0, Math.round(rssBytes / 1048576)),
  };
}

/** The histogram's tick. It records the whole time between two ticks, so how late the loop was is what is over this. */
const TICK_MS = 10;

/** Measures this process in windows of `windowMs` and returns a reader of the latest window's figures (all 0 until the
 *  first window ends). The timer is unref'd: it never keeps the process alive. */
export function startLoadSampler(windowMs = 10_000): () => Load {
  const loop = monitorEventLoopDelay({ resolution: TICK_MS });
  loop.enable();
  let latest: Load = { cpuPercent: 0, loopDelayP99Ms: 0, rssMb: 0 };
  let cpu = process.cpuUsage(), at = performance.now();
  const timer = setInterval(() => {
    const nowCpu = process.cpuUsage(), now = performance.now();
    const late = Math.max(0, loop.percentile(99) - TICK_MS * 1e6);
    latest = loadFrom(nowCpu.user - cpu.user + nowCpu.system - cpu.system, now - at, late, process.memoryUsage().rss);
    cpu = nowCpu; at = now;
    loop.reset();
  }, windowMs);
  timer.unref();
  return () => latest;
}
