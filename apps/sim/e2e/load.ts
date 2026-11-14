// The load test: fake racers over the same socket events a browser uses, and the server's own CPU, event-loop delay and
// memory read from /healthz (src/world/health.ts). Lane A, Part 1, Task 5 of docs/superpowers/plans/2026-11-13-trial-lane-a-foundation.md;
// the limits are the spec's ("Capacity", docs/superpowers/specs/2026-11-13-platform-upgrade-design.md) and live in src/world/loadStats.ts.
//
//   pnpm --filter @micar/sim exec tsx e2e/load.ts
//
// Settings, from the environment:
//   BASE            the World to load. Unset: this program starts server.ts itself, in a throwaway folder, with RACE_ROOM_MAX=16.
//   STEPS           "<people per room>x<rooms>", comma-separated (default 4x1,4x4,4x8,4x16,8x1,16x1,16x2,16x3)
//   RACE_SECONDS    how long each race sends positions (default 60)
//   HZ              positions a second from each racer (default 15, about what the Strip sends)
//   CONFIRM_REMOTE  yes: allowed to load a server that is not on this PC. Only when the owner has asked for that run: real
//                   players see the fake ones ("Load test N") at the rental counter, and it spends the server's bandwidth.
//   PORT            the port for the server this program starts (default 0: any free one)
//
// One line per step; every figure also goes to e2e/out/load-<date-time>.json (git-ignored). It stops after the first step
// that fails and names the limit it broke. Exit: 0 when every step that ran passed, 1 when one failed, 2 on an error.
// Race traffic only: a real browser also sends its town position and car state, so read the result as the least the
// server will need.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import type { Load } from '../src/world/health.js';
import { isLocalBase, parseSteps, percentile, verdict, type StepResult, type StepSpec } from '../src/world/loadStats.js';
import type { RoomView } from '../src/world/race.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A circuit, in the rental fleet's first car: its time limit is ten minutes, longer than any step. */
const EVENT = 'harbour_gp', CAR = 'ronin';
/** The event-loop histogram's tick, as in health.ts: how late the loop was is its p99 less this. */
const TICK_MS = 10;
const DEFAULT_STEPS = '4x1,4x4,4x8,4x16,8x1,16x1,16x2,16x3';

class Stop extends Error {} // an error that ends the run with exit 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const oneDecimal = (x: number) => Math.round(x * 10) / 10;

type Racer = { name: string; socket: Socket; id: string; sent: number; got: number; delays: number[] };
type Room = { code: string; members: Racer[]; goAt: number };
type Step = { spec: StepSpec; result?: StepResult; verdict?: ReturnType<typeof verdict>; skipped?: string; pcBusyPercent?: number; healthReads?: number; denied?: Record<string, number> };

function settings() {
  const env = process.env;
  const steps = parseSteps(env.STEPS ?? DEFAULT_STEPS);
  if (!steps) throw new Stop(`STEPS "${env.STEPS}" is not a list like "4x1,16x2" (people per room 2 to 16, rooms 1 to 20)`);
  const raceSeconds = Number(env.RACE_SECONDS ?? 60), hz = Number(env.HZ ?? 15);
  if (!Number.isInteger(raceSeconds) || raceSeconds < 1 || raceSeconds > 540) throw new Stop('RACE_SECONDS must be a whole number from 1 to 540 (a circuit closes ten minutes after its green light)');
  if (!(hz > 0 && hz <= 25)) throw new Stop('HZ must be above 0 and at most 25 (the server passes on one position per racer every 40 ms)');
  const base = env.BASE ? (env.BASE.endsWith('/') ? env.BASE : env.BASE + '/') : null;
  if (base && !isLocalBase(base) && env.CONFIRM_REMOTE !== 'yes') {
    throw new Stop(`BASE ${base} is not on this PC. A load test there is seen by real players (fake ones named "Load test" at the rental counter) and spends the server's bandwidth: run it only when the owner has asked for it, with CONFIRM_REMOTE=yes.`);
  }
  return { steps, raceSeconds, hz, base, port: env.PORT ?? '0' };
}

/** server.ts in a throwaway folder, as serverWiring.test.ts starts it: production mode, no save, rooms of up to 16. */
async function startServer(port: string): Promise<{ base: string; stop: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'micar-load-'));
  mkdirSync(path.join(dir, 'data'));
  cpSync(path.join(APP, 'public', 'strip', 'tracks'), path.join(dir, 'dist', 'strip', 'tracks'), { recursive: true });
  const child = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: port, RACE_ROOM_MAX: '16' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // tsx's cli runs server.ts in a second node: on Windows killing the wrapper leaves that one running, so the whole tree goes
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
    }
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a folder in the temp dir */ }
  };
  let out = '';
  const port0 = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Stop('the server did not start in 60 s:\n' + out)), 60_000);
    child.stdout!.on('data', (d) => {
      out += d;
      const m = /Server running on port (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.stderr!.on('data', (d) => { out += d; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Stop(`the server exited (${code}):\n${out}`)); });
  });
  return { base: `http://127.0.0.1:${port0}/`, stop };
}

/** The next `event` on `s` that passes `pred`; a race_denied while waiting is an error. */
function next<T>(s: Socket, event: string, pred: (d: T) => boolean = () => true, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Stop(`no ${event} within ${ms} ms`)); }, ms);
    const on = (d: T) => { if (!pred(d)) return; off(); resolve(d); };
    const no = (d: { why?: string }) => { off(); reject(new Stop(`the server refused (${d?.why}) while waiting for ${event}`)); };
    const off = () => { clearTimeout(timer); s.off(event, on); s.off('race_denied', no); };
    s.on(event, on);
    if (event !== 'race_denied') s.on('race_denied', no);
  });
}

async function guest(origin: string, name: string, denied: Record<string, number>): Promise<Racer> {
  const socket = connect(origin, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 20_000 });
  const r: Racer = { name, socket, id: '', sent: 0, got: 0, delays: [] };
  // every racer counts the positions it is sent, and how late each is: the sender stamped it on this same clock
  socket.on('race_pose', (msg: unknown) => {
    if (!Array.isArray(msg) || typeof msg[1] !== 'number') return;
    r.got++;
    r.delays.push(Date.now() - msg[1]);
  });
  socket.on('race_denied', (d: { why?: string }) => { const why = String(d?.why); denied[why] = (denied[why] ?? 0) + 1; });
  const failed = new Promise<never>((_, reject) => socket.once('connect_error', (e) => reject(new Stop(`${name} could not connect: ${e.message}`))));
  failed.catch(() => { /* handled by the race below, or too late to matter */ });
  const init = next<{ id: string }>(socket, 'init', () => true, 20_000);
  socket.emit('join', { mode: 'guest', name });
  r.id = (await Promise.race([init, failed])).id;
  return r;
}

const cpuTimes = () => cpus().reduce((a, c) => {
  const t = c.times, busy = t.user + t.nice + t.sys + t.irq;
  return { busy: a.busy + busy, all: a.all + busy + t.idle };
}, { busy: 0, all: 0 });

/** The highest of each figure /healthz gives from `from` to `to`, read every 5 s; once at `to` if the race was too short for
 *  any, and then `late`: that one reading's 10 s window may lie mostly before the green light, so it is not judged. */
async function serverFigures(base: string, from: number, to: number): Promise<{ load: Load | null; reads: number; late: boolean }> {
  let load: Load | null = null, reads = 0;
  const read = async () => {
    try {
      const j = await (await fetch(`${base}healthz`, { signal: AbortSignal.timeout(4000) })).json() as { load?: Load };
      if (!j.load) return;
      reads++;
      load = load ? { cpuPercent: Math.max(load.cpuPercent, j.load.cpuPercent), loopDelayP99Ms: Math.max(load.loopDelayP99Ms, j.load.loopDelayP99Ms), rssMb: Math.max(load.rssMb, j.load.rssMb) } : { ...j.load };
    } catch { /* a missed reading: the step is judged on the others */ }
  };
  if (from <= to) {
    await sleep(from - Date.now());
    while (Date.now() <= to) { await read(); if (Date.now() + 5000 > to) break; await sleep(5000); }
  }
  if (reads) return { load, reads, late: false };
  await sleep(to - Date.now());
  await read();
  return { load, reads, late: true };
}

/** Each racer sends where it is HZ times a second from the green light for RACE_SECONDS, its timer started at a random
 *  point in the first interval: [time, x, z, heading, speed, distance, drift score], round a 300 m circle. */
function drive(r: Racer, goAt: number, seconds: number, hz: number, phase: number): Promise<void> {
  const every = 1000 / hz, end = goAt + seconds * 1000;
  return new Promise((resolve) => {
    setTimeout(() => {
      const timer = setInterval(() => {
        const now = Date.now();
        if (now >= end) { clearInterval(timer); resolve(); return; }
        const t = (now - goAt) / 1000, a = phase + t * 0.2;
        r.socket.emit('race_pose', [now, 300 * Math.cos(a), 300 * Math.sin(a), a + Math.PI / 2, 60, 60 * t, 0]);
        r.sent++;
      }, every);
    }, Math.max(0, goAt - Date.now()) + Math.random() * every);
  });
}

async function runStep(base: string, spec: StepSpec, seconds: number, hz: number, where: 'local' | 'remote', firstName: number): Promise<Step & { roomCodes: string[]; holds?: number }> {
  const origin = new URL(base).origin;
  const denied: Record<string, number> = {};
  const racers: Racer[] = [];
  const rooms: Room[] = [];
  try {
    // everyone joins as a guest, one after another, 25 ms apart
    for (let i = 0; i < spec.size * spec.rooms; i++) { racers.push(await guest(origin, `Load test ${firstName + i}`, denied)); await sleep(25); }
    // one in each room makes it; the rest come in by its code
    for (let k = 0; k < spec.rooms; k++) {
      const members = racers.slice(k * spec.size, (k + 1) * spec.size), host = members[0];
      const made = next<RoomView>(host.socket, 'race_room');
      host.socket.emit('race_create', { eventId: EVENT, car: CAR });
      rooms.push({ code: (await made).code, members, goAt: 0 });
      if (k === 0) {
        const link = await (await fetch(`${base}api/race/${rooms[0].code}`)).json() as { max?: number };
        if (typeof link.max === 'number' && link.max < spec.size) return { spec, skipped: `this server holds ${link.max} per room`, holds: link.max, roomCodes: rooms.map((r) => r.code) };
      }
    }
    await Promise.all(rooms.flatMap((room) => room.members.slice(1).map((m) => {
      const inRoom = next<RoomView>(m.socket, 'race_room', (v) => v.members.some((x) => x.id === m.id));
      m.socket.emit('race_join', { code: room.code });
      return inRoom;
    })));
    // the plain round trip, before the start: ten race_time calls from each room's host
    const rtts: number[] = [];
    await Promise.all(rooms.map(async (room) => {
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await room.members[0].socket.timeout(5000).emitWithAck('race_time');
        rtts.push(performance.now() - t0);
      }
    }));
    const baselineRttMs = oneDecimal(percentile(rtts, 50) ?? 0);
    // the start: everyone says ready on seeing the room load, and everyone learns the one green light
    await Promise.all(rooms.map(async (room) => {
      const green = room.members.map((m) => new Promise<number>((resolve, reject) => {
        let ready = false;
        const timer = setTimeout(() => { m.socket.off('race_room', on); reject(new Stop(`room ${room.code} did not reach its green light in 45 s`)); }, 45_000);
        const on = (v: RoomView) => {
          if (v.phase === 'loading' && !ready && v.members.find((x) => x.id === m.id)?.state === 'loading') { ready = true; m.socket.emit('race_ready'); }
          if (v.phase === 'racing' && v.goAt) { clearTimeout(timer); m.socket.off('race_room', on); resolve(v.goAt); }
        };
        m.socket.on('race_room', on);
      }));
      room.members[0].socket.emit('race_start');
      room.goAt = Math.max(...await Promise.all(green));
    }));
    // the race
    const allGo = Math.max(...rooms.map((r) => r.goAt)), firstEnd = Math.min(...rooms.map((r) => r.goAt)) + seconds * 1000;
    const loop = monitorEventLoopDelay({ resolution: TICK_MS });
    const driving = Promise.all(rooms.flatMap((room) => room.members.map((m, i) => drive(m, room.goAt, seconds, hz, (2 * Math.PI * i) / room.members.length))));
    await sleep(allGo - Date.now());
    loop.enable();
    const cpu0 = cpuTimes();
    const figures = serverFigures(base, allGo + 12_000, firstEnd);
    await driving;
    loop.disable();
    const cpu1 = cpuTimes();
    const { load, reads, late } = await figures;
    await sleep(1000); // what is still on its way
    const delays = racers.flatMap((r) => r.delays);
    const result: StepResult = {
      size: spec.size, rooms: spec.rooms,
      posesExpected: rooms.reduce((n, room) => n + room.members.reduce((s, m) => s + m.sent, 0) * (spec.size - 1), 0),
      posesReceived: racers.reduce((n, r) => n + r.got, 0),
      delayMs: { p50: percentile(delays, 50) ?? 0, p95: percentile(delays, 95) ?? 0, p99: percentile(delays, 99) ?? 0 },
      baselineRttMs,
      server: load,
      ...(late ? { serverLate: true } : {}),
      harnessLoopP99Ms: oneDecimal(Math.max(0, loop.percentile(99) - TICK_MS * 1e6) / 1e6),
    };
    const pcBusyPercent = oneDecimal((100 * (cpu1.busy - cpu0.busy)) / Math.max(1, cpu1.all - cpu0.all));
    return { spec, result, verdict: verdict(result, where), pcBusyPercent, healthReads: reads, denied, roomCodes: rooms.map((r) => r.code) };
  } finally {
    // the end of a step: a finish, a Leave (so an emptied room is kept two minutes, not the fifteen a dropped one is), then close
    for (const r of racers) if (r.socket.connected) r.socket.emit('race_finish', { time: seconds, score: 0, failed: false });
    await sleep(300);
    for (const r of racers) if (r.socket.connected) r.socket.emit('race_leave');
    await sleep(500);
    for (const r of racers) r.socket.close();
  }
}

/** Every room of a step is gone (its link answers 404) before the next: one address may hold only 20 rooms at a time. */
async function roomsGone(base: string, codes: string[]): Promise<void> {
  const until = Date.now() + 6 * 60_000;
  for (let left = codes; left.length; ) {
    if (Date.now() > until) throw new Stop(`rooms ${left.join(', ')} were still there after six minutes`);
    await sleep(5000);
    const still = await Promise.all(left.map(async (c) => ((await fetch(`${base}api/race/${c}`)).status === 404 ? null : c)));
    left = still.filter((c): c is string => c !== null);
  }
}

const ms = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
function line(s: Step): string {
  const head = `${String(s.spec.size * s.spec.rooms).padStart(3)} players, ${s.spec.rooms} × ${s.spec.size}`;
  if (s.skipped || !s.result || !s.verdict) return `${head}: skipped (${s.skipped})`;
  const r = s.result, v = s.verdict, lost = r.posesExpected ? (100 * (r.posesExpected - r.posesReceived)) / r.posesExpected : 0;
  const srv = !r.server ? 'server figures: none'
    : r.serverLate ? `server figures only from after the race, not judged (CPU ${r.server.cpuPercent}%, ${r.server.rssMb} MB)`
    : `server CPU ${r.server.cpuPercent}%, loop p99 ${r.server.loopDelayP99Ms} ms, ${r.server.rssMb} MB`;
  return `${head}: delay p50/p95/p99 ${ms(r.delayMs.p50)}/${ms(r.delayMs.p95)}/${ms(r.delayMs.p99)} ms (round trip ${ms(r.baselineRttMs)} ms), `
    + `lost ${lost.toFixed(2)}%, ${srv}, this program's loop p99 ${r.harnessLoopP99Ms} ms, PC busy ${s.pcBusyPercent}% — `
    + `${v.pass ? 'PASS' : 'FAIL'}, fits $7: ${v.fits7 === null ? 'not judged' : v.fits7 ? 'yes' : 'no'}${v.reasons.length ? ` (${v.reasons.join('; ')})` : ''}`;
}

async function main(): Promise<number> {
  const cfg = settings();
  let server: { base: string; stop: () => void } | null = null;
  process.on('SIGINT', () => { console.log('\nstopped (Ctrl+C)'); server?.stop(); process.exit(2); });
  const startedAt = new Date();
  const steps: Step[] = [];
  const out = path.join(APP, 'e2e', 'out', `load-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
  const save = (exit: number | null) => {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ startedAt: startedAt.toISOString(), base: cfg.base ?? server?.base, where: cfg.base && !isLocalBase(cfg.base) ? 'remote' : 'local',
      settings: { steps: cfg.steps, raceSeconds: cfg.raceSeconds, hz: cfg.hz }, node: process.version, platform: process.platform, cpu: cpus()[0]?.model, cores: cpus().length,
      steps, exit, endedAt: new Date().toISOString() }, null, 2));
  };
  try {
    if (!cfg.base) { server = await startServer(cfg.port); console.log(`started server.ts at ${server.base} (RACE_ROOM_MAX=16)`); }
    const base = cfg.base ?? server!.base, where = cfg.base && !isLocalBase(cfg.base) ? 'remote' : 'local';
    console.log(`load test: ${cfg.steps.map((s) => `${s.size}x${s.rooms}`).join(', ')}; races of ${cfg.raceSeconds} s at ${cfg.hz} positions a second; ${where} (${base})`);
    let holds = Infinity, name = 1, failed = false;
    for (const spec of cfg.steps) {
      if (spec.size > holds) { const s: Step = { spec, skipped: `this server holds ${holds} per room` }; steps.push(s); console.log(line(s)); continue; }
      const s = await runStep(base, spec, cfg.raceSeconds, cfg.hz, where, name);
      name += spec.size * spec.rooms;
      const { roomCodes, holds: h, ...step } = s;
      steps.push(step);
      if (h !== undefined) { holds = h; console.log(`this server holds ${h} per room: set RACE_ROOM_MAX to test bigger rooms`); }
      console.log(line(step));
      save(null);
      if (step.verdict && !step.verdict.pass) { failed = true; console.log(`stopped: this step broke ${step.verdict.reasons.join('; ')}`); break; }
      if (spec !== cfg.steps[cfg.steps.length - 1]) await roomsGone(base, roomCodes);
    }
    const ran = steps.filter((s) => s.result);
    const code = failed ? 1 : 0;
    console.log(`${ran.length} step(s) ran${steps.length > ran.length ? `, ${steps.length - ran.length} skipped` : ''}; results in ${path.relative(process.cwd(), out)}`);
    save(code);
    return code;
  } catch (e) {
    console.error(e instanceof Stop ? `load test stopped: ${e.message}` : e);
    try { save(2); } catch { /* nothing to save */ }
    return 2;
  } finally {
    server?.stop();
  }
}

process.exit(await main());
