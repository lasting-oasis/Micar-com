// How much data MiCar World sends each player (docs/superpowers/specs/2026-11-14-world-data-diet-design.md).
//
// Starts its own World for each row (server.ts in a child process, a temp data folder, a free port from 3300 to 3399),
// joins fake guests one at a time, standing still, then has them all drive circles, each sending its position ten times
// a second as the real page does. It counts every byte each fake player receives:
//   wire     what its TCP socket read: WebSocket frames and headers included (not TCP/IP or TLS overhead)
//   payload  the socket.io messages, by name, without framing
// and, for smoothness, the time between position updates of each other player: the twenty nearest in the same district
// that are within 200 m (the design's full-rate players), the rest of the district, and other districts.
//
//   cd apps/sim
//   node node_modules/tsx/dist/cli.mjs e2e/data.ts [--online 10,25,50,100] [--layout one,spread] [--mode drive,play]
//        [--seconds 20] [--out data.json]
//
// Modes: `drive` only drives (the owner's measurement). `play` also does what a driver's page does besides: each guest
// rents a car (after the joins, not counted), streams its fuel every 1.5 s as the page does, and once every 30 s, at a
// different moment for each, asks to tune its rental. The server refuses that (a rental stays stock) and, as it does
// after any refusal, sends the state again: so every action anyone takes is counted as it reaches everyone.
//
// Layouts: `one` puts everyone anywhere in the Strip's hub (about 600 by 320 m); `spread` deals players over the hub
// and the ten circuits in turn, each district's players gathered within 150 m of its meeting point (the hub's spawn, a
// circuit's lobby). Guests can only be in the Strip, so the town is not covered.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket as NetSocket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { decodePositions } from '../src/world/netPositions';
import { HUB, TRACKS } from '../src/world/strip/district';
import { WORLD_PER_M as W } from '../src/world/units';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- options
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ONLINE = arg('online', '10,25,50,100').split(',').map(Number).filter(n => n > 0);
const LAYOUTS = arg('layout', 'one,spread').split(',') as Layout[];
const MODES = arg('mode', 'drive').split(',') as Mode[];
const SECONDS = Number(arg('seconds', '20'));
const OUT = arg('out', '');
const JOIN_GAP_MS = 50, SETTLE_MS = 2000, WARMUP_MS = 2000, SEND_MS = 100;
const SPEED_MPS = 20; // a car at 72 km/h
const GATHER_M = 150; // `spread`: circle centres within this of the district's meeting point
const NEAR_M = 200, NEAR_RANK = 20; // the smoothness bucket: the twenty nearest within 200 m, the players the design keeps at full rate
const FUEL_MS = 1500, FUEL_PER_S = 0.09, ACT_MS = 30_000; // play: as the page streams fuel (driver.ts, full throttle); one action each 30 s
const TUNE = { turbo: 0, nitrous: 0, aero: 1, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 };

type Layout = 'one' | 'spread';
type Mode = 'drive' | 'play';

// ---- where players drive: the hub and the ten circuits (metres, offsets applied), and where each one's players meet
type Zone = { id: string; minX: number; minZ: number; maxX: number; maxZ: number; meetX: number; meetZ: number };
const ZONES: Zone[] = [
  { id: 'hub', ...HUB.bounds, meetX: HUB.spawn.x, meetZ: HUB.spawn.z },
  ...TRACKS.map(t => {
    const d = JSON.parse(readFileSync(path.join(APP, 'public', 'strip', 'tracks', t.id + '.json'), 'utf8'));
    const [ox, oz] = d.offset;
    return { id: t.id, minX: d.bounds.minX + ox, minZ: d.bounds.minZ + oz, maxX: d.bounds.maxX + ox, maxZ: d.bounds.maxZ + oz, meetX: d.lobby.x + ox, meetZ: d.lobby.z + oz };
  }),
];

/** A small seeded random number generator, so a row is the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A fake player's circle: where it is (metres) and which way it faces at `t` seconds of driving. */
type Path = { zone: number; cx: number; cz: number; r: number; phase: number; dir: 1 | -1 };
function pathsFor(layout: Layout, n: number): Path[] {
  const rand = rng(n * 7919 + (layout === 'one' ? 1 : 2));
  return Array.from({ length: n }, (_, i) => {
    const zone = layout === 'one' ? 0 : i % ZONES.length, z = ZONES[zone];
    const r = 20 + rand() * 40, m = r + 10;
    let cx: number, cz: number;
    if (layout === 'one') { cx = z.minX + m + rand() * (z.maxX - z.minX - 2 * m); cz = z.minZ + m + rand() * (z.maxZ - z.minZ - 2 * m); }
    else { const a = rand() * Math.PI * 2, d = GATHER_M * Math.sqrt(rand()); cx = z.meetX + d * Math.cos(a); cz = z.meetZ + d * Math.sin(a); }
    return { zone, r, cx, cz, phase: rand() * Math.PI * 2, dir: rand() < 0.5 ? 1 : -1 };
  });
}
function poseAt(p: Path, t: number) {
  const a = p.phase + p.dir * (SPEED_MPS / p.r) * t;
  return { x: p.cx + p.r * Math.cos(a), z: p.cz + p.r * Math.sin(a), h: Math.atan2(-p.dir * Math.sin(a), p.dir * Math.cos(a)) };
}

// ---- the World under test
async function freePort(): Promise<number> {
  for (let port = 3300; port <= 3399; port++) {
    const ok = await new Promise<boolean>(resolve => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(port, '0.0.0.0', () => s.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error('no free port from 3300 to 3399');
}

type World = { child: ChildProcess; dir: string; url: string; log: () => string };
async function startWorld(): Promise<World> {
  const dir = mkdtempSync(path.join(tmpdir(), 'micar-data-'));
  mkdirSync(path.join(dir, 'data'));
  // the track data a deployed dist carries (the server reads every circuit at start)
  const tracks = path.join(dir, 'dist', 'strip', 'tracks');
  mkdirSync(tracks, { recursive: true });
  for (const f of readdirSync(path.join(APP, 'public', 'strip', 'tracks'))) if (f.endsWith('.json')) copyFileSync(path.join(APP, 'public', 'strip', 'tracks', f), path.join(tracks, f));
  const port = await freePort();
  // node with tsx's loader (not tsx's cli, which runs the server in a second process): the child is the World itself
  const loader = pathToFileURL(path.join(APP, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const child = spawn(process.execPath, ['--import', loader, path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', d => { out += d; });
  child.stderr!.on('data', d => { out += d; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the World did not start:\n' + out)), 60_000);
    const check = () => { if (/Server running on port \d+/.test(out)) { clearTimeout(timer); resolve(); } };
    child.stdout!.on('data', check);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`the World exited ${code}:\n${out}`)); });
  });
  return { child, dir, url: `http://127.0.0.1:${port}`, log: () => out };
}
async function stopWorld(w: World) {
  if (w.child.exitCode === null && w.child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(w.child.pid), '/T', '/F'], { stdio: 'ignore' });
    else w.child.kill();
    await new Promise<void>(resolve => { const t = setTimeout(resolve, 5000); w.child.once('exit', () => { clearTimeout(t); resolve(); }); });
  }
  rmSync(w.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
/** The World's CPU time (ms) and memory (MB), read from the OS. */
function serverUsage(pid: number): { cpuMs: number; memMB: number } | null {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${pid}; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"`], { encoding: 'utf8' });
      const [cpu, ws] = r.stdout.trim().split(/\s+/).map(Number);
      return Number.isFinite(cpu) && Number.isFinite(ws) ? { cpuMs: cpu, memMB: ws / 2 ** 20 } : null;
    }
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? NaN);
    return { cpuMs: (Number(stat[11]) + Number(stat[12])) * 10, memMB: rss / 1024 };
  } catch { return null; }
}

// ---- a fake player
type Counts = { wire: number; payload: number; byEvent: Record<string, number> };
type Timer = ReturnType<typeof setInterval>;
type Player = { i: number; path: Path; sock: Socket; id: string; tcp?: NetSocket; payload: number; byEvent: Record<string, number>; timer?: Timer; carId?: string; fuel?: Timer; act?: Timer };

/** The socket.io event a raw packet carries: `2["name",...]` (or `5`, binary, with its attachment count). */
const eventOf = (data: string) => /^[25]\d*-?(?:\/[^,]*,)?\d*\["([^"]+)"/.exec(data)?.[1] ?? (data[0] === '0' ? 'connect' : 'other');

function counts(p: Player): Counts {
  return { wire: p.tcp?.bytesRead ?? 0, payload: p.payload, byEvent: { ...p.byEvent } };
}
function minus(a: Counts, b: Counts): Counts {
  const byEvent: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.byEvent), ...Object.keys(b.byEvent)])) byEvent[k] = (a.byEvent[k] ?? 0) - (b.byEvent[k] ?? 0);
  return { wire: a.wire - b.wire, payload: a.payload - b.payload, byEvent };
}

// ---- smoothness: how long between position updates of each other player, by how near it is
const BIN_MS = 10, BINS = 1000; // 10 ms bins up to 10 s
type Bucket = 'near' | 'district' | 'away';
const hist = (): Record<Bucket, Uint32Array> => ({ near: new Uint32Array(BINS), district: new Uint32Array(BINS), away: new Uint32Array(BINS) });
function quantile(h: Uint32Array, q: number): number | null {
  let total = 0; for (const c of h) total += c;
  if (!total) return null;
  let acc = 0; const want = q * total;
  for (let b = 0; b < h.length; b++) { acc += h[b]; if (acc >= want) return (b + 0.5) * BIN_MS; }
  return h.length * BIN_MS;
}

// Positions as each protocol sends them, decoded to (player id, x, z): the old `player_positions` object, keyed by
// socket id, with the Strip pose in `stripPosition`; and `pos` (proto 2), short numbers for the players.
type Fix = { id: string; x: number; z: number };
type Decoder = (args: unknown[], idOf: (n: number) => string | undefined) => Fix[];
const decoders: Record<string, Decoder> = {
  player_positions: ([positions]) => Object.entries((positions ?? {}) as Record<string, any>).map(([id, p]) => ({ id, x: p?.stripPosition?.x ?? p?.x, z: p?.stripPosition?.z ?? p?.z })),
  pos: ([flat], idOf) => Object.entries(decodePositions(flat, idOf)).map(([id, p]) => ({ id, x: p.stripPosition?.x ?? p.x, z: p.stripPosition?.z ?? p.z })),
};

// ---- one row
type Row = {
  mode: Mode; layout: Layout; online: number; seconds: number;
  join: { wireMB: number; payloadMB: number; byEventMB: Record<string, number>; seconds: number };
  steady: { wireKBps: { mean: number; max: number }; payloadKBps: number; byEventKBps: Record<string, number>; serverMBps: number };
  gapsMs: Record<Bucket, { median: number | null; p95: number | null; samples: number }>;
  server: { cpuPct: number | null; memMB: number | null };
  testLagP99Ms: number;
};

async function runRow(mode: Mode, layout: Layout, online: number): Promise<Row> {
  const world = await startWorld();
  const paths = pathsFor(layout, online);
  const players: Player[] = [];
  const indexOf = new Map<string, number>();
  const idOfN = new Map<number, string>(); // each fake player's short number (proto 2), from its own init
  let moving = false, t0 = 0, measuring = false;
  const gaps = hist();
  // per (receiver, sender): when the sender's position last changed for the receiver, and to what
  const lastT = new Float64Array(online * online).fill(NaN), lastX = new Float64Array(online * online), lastZ = new Float64Array(online * online);
  // per (receiver, sender): the sender's rank among the receiver's district by distance (-1: elsewhere), and the distance (m)
  const rank = new Int32Array(online * online).fill(-1), dist = new Float64Array(online * online).fill(Infinity);
  const tNow = () => (performance.now() - t0) / 1000;

  const rerank = () => {
    const at = paths.map(p => poseAt(p, moving ? tNow() : 0));
    for (let r = 0; r < online; r++) {
      const same: { q: number; d: number }[] = [];
      for (let q = 0; q < online; q++) if (q !== r && paths[q].zone === paths[r].zone) same.push({ q, d: Math.hypot(at[q].x - at[r].x, at[q].z - at[r].z) });
      same.sort((a, b) => a.d - b.d);
      for (let q = 0; q < online; q++) { rank[r * online + q] = -1; dist[r * online + q] = Infinity; }
      same.forEach((s, k) => { rank[r * online + s.q] = k; dist[r * online + s.q] = s.d; });
    }
  };
  const ranker = setInterval(rerank, 500);

  const onFixes = (r: number, fixes: Fix[]) => {
    const now = performance.now();
    for (const f of fixes) {
      const q = indexOf.get(f.id);
      if (q === undefined || q === r || !Number.isFinite(f.x)) continue;
      const key = r * online + q, prevT = lastT[key];
      if (!Number.isNaN(prevT) && lastX[key] === f.x && lastZ[key] === f.z) continue; // not a move
      lastT[key] = now; lastX[key] = f.x; lastZ[key] = f.z;
      if (Number.isNaN(prevT) || !measuring) continue;
      const k = rank[key];
      const b: Bucket = paths[q].zone !== paths[r].zone ? 'away' : k >= 0 && k < NEAR_RANK && dist[key] <= NEAR_M ? 'near' : 'district';
      gaps[b][Math.min(BINS - 1, Math.floor((now - prevT) / BIN_MS))]++;
    }
  };

  const join = async (i: number) => {
    const sock = connect(world.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const p: Player = { i, path: paths[i], sock, id: '', payload: 0, byEvent: {} };
    players.push(p);
    const engine = (sock.io as any).engine;
    engine.on('open', () => { p.tcp = engine.transport?.ws?._socket; });
    let binaryOf = 'other';
    engine.on('packet', (pkt: { type: string; data?: unknown }) => {
      const d = pkt.data;
      let name: string, size: number;
      if (typeof d === 'string') { name = pkt.type === 'message' ? eventOf(d) : pkt.type; size = Buffer.byteLength(d) + 1; if (/^5/.test(d)) binaryOf = name; }
      else if (d && typeof (d as ArrayBuffer).byteLength === 'number') { name = binaryOf; size = (d as ArrayBuffer).byteLength; }
      else { name = pkt.type; size = 1; }
      p.payload += size;
      p.byEvent[name] = (p.byEvent[name] ?? 0) + size;
    });
    sock.on('join_refused', (d: unknown) => console.error('join refused', d));
    // play: the rental's id, from the player's own record in whichever state message brings it
    const mine = (d: any) => { const car = d?.players?.[p.id]?.inventory?.find((c: any) => c?.rental); if (car) p.carId = car.id; };
    sock.on('update', mine); sock.on('patch', mine);
    for (const [event, decode] of Object.entries(decoders)) sock.on(event, (...args: unknown[]) => onFixes(i, decode(args, n => idOfN.get(n))));
    const init = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`player ${i} got no init`)), 20_000);
      sock.once('init', (d: any) => { clearTimeout(timer); resolve(d); });
      sock.once('connect_error', (e: Error) => { clearTimeout(timer); reject(e); });
      sock.emit('join', { mode: 'guest', name: `Fake ${i}`, proto: 2 }); // as the page joins (an older World ignores proto)
    });
    p.id = init.id;
    indexOf.set(p.id, i);
    const n = init.state?.players?.[init.id]?.n;
    if (typeof n === 'number') idOfN.set(n, p.id);
    const send = () => {
      const at = poseAt(p.path, moving ? tNow() : 0);
      sock.emit('sync_player_pos', { x: at.x * W, y: 0, z: at.z * W, rotation: at.h, district: 'strip' });
    };
    send();
    p.timer = setInterval(send, SEND_MS);
  };

  const sumCounts = () => players.map(counts);
  const joinStart = performance.now();
  for (let i = 0; i < online; i++) {
    await join(i);
    await new Promise(r => setTimeout(r, JOIN_GAP_MS));
  }
  await new Promise(r => setTimeout(r, SETTLE_MS));
  const afterJoin = sumCounts();
  const joinSeconds = (performance.now() - joinStart) / 1000;

  if (mode === 'play') { // each guest rents a car (not counted: it is neither a join nor the driving measured)
    for (const p of players) {
      p.sock.emit('rent_car', { key: 'ronin' });
      for (let w = 0; !p.carId && w < 200; w++) await new Promise(r => setTimeout(r, 50));
      if (!p.carId) throw new Error(`player ${p.i} got no rental`);
    }
    await new Promise(r => setTimeout(r, SETTLE_MS));
  }

  t0 = performance.now(); moving = true; rerank();
  if (mode === 'play') for (const p of players) {
    p.fuel = setInterval(() => p.sock.emit('consume_fuel', { carId: p.carId, fuel: Math.round(100 - FUEL_PER_S * tNow()) }), FUEL_MS);
    const act = () => p.sock.emit('strip_tune', { carId: p.carId, tune: TUNE }); // refused: a rental stays stock; the state goes out again
    p.act = setTimeout(() => { act(); p.act = setInterval(act, ACT_MS); }, (p.i * ACT_MS) / online);
  }
  await new Promise(r => setTimeout(r, WARMUP_MS));
  const cpu0 = serverUsage(world.child.pid!), tCpu0 = performance.now();
  const before = sumCounts();
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  measuring = true;
  const start = performance.now();
  await new Promise(r => setTimeout(r, SECONDS * 1000));
  measuring = false;
  const seconds = (performance.now() - start) / 1000;
  const after = sumCounts();
  const cpu1 = serverUsage(world.child.pid!), tCpu1 = performance.now();
  lag.disable();

  clearInterval(ranker);
  for (const p of players) { clearInterval(p.timer); clearInterval(p.fuel); clearInterval(p.act); clearTimeout(p.act); p.sock.close(); }
  await stopWorld(world);

  const MB = 2 ** 20, KB = 1024;
  const joinTotal = afterJoin.reduce<Counts>((a, c) => ({ wire: a.wire + c.wire, payload: a.payload + c.payload, byEvent: Object.fromEntries([...new Set([...Object.keys(a.byEvent), ...Object.keys(c.byEvent)])].map(k => [k, (a.byEvent[k] ?? 0) + (c.byEvent[k] ?? 0)])) }), { wire: 0, payload: 0, byEvent: {} });
  const steady = after.map((c, k) => minus(c, before[k]));
  const wireRates = steady.map(c => c.wire / seconds / KB);
  const byEventKBps: Record<string, number> = {};
  for (const c of steady) for (const [k, v] of Object.entries(c.byEvent)) byEventKBps[k] = (byEventKBps[k] ?? 0) + v / seconds / KB / online;
  const gapStats = (b: Bucket) => ({ median: quantile(gaps[b], 0.5), p95: quantile(gaps[b], 0.95), samples: gaps[b].reduce((a, c) => a + c, 0) });
  return {
    mode, layout, online, seconds,
    join: { wireMB: joinTotal.wire / MB, payloadMB: joinTotal.payload / MB, byEventMB: Object.fromEntries(Object.entries(joinTotal.byEvent).map(([k, v]) => [k, v / MB])), seconds: joinSeconds },
    steady: {
      wireKBps: { mean: wireRates.reduce((a, b) => a + b, 0) / online, max: Math.max(...wireRates) },
      payloadKBps: steady.reduce((a, c) => a + c.payload, 0) / seconds / KB / online,
      byEventKBps,
      serverMBps: steady.reduce((a, c) => a + c.wire, 0) / seconds / MB,
    },
    gapsMs: { near: gapStats('near'), district: gapStats('district'), away: gapStats('away') },
    server: { cpuPct: cpu0 && cpu1 ? ((cpu1.cpuMs - cpu0.cpuMs) / (tCpu1 - tCpu0)) * 100 : null, memMB: cpu1?.memMB ?? null },
    testLagP99Ms: lag.percentile(99) / 1e6,
  };
}

// ---- the table
const f1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : n >= 100 ? n.toFixed(0) : n.toFixed(1));
const POS = new Set(Object.keys(decoders));
function table(rows: Row[]): string {
  const lines = [
    '| Mode | Layout | Online | Each player downloads, KB/s (mean / most) | of which positions | of which state | Server sends, MB/s | Joins: MB in all | Update gap, ms: twenty nearest within 200 m (median / p95) | rest of district | other districts | Server CPU | Server memory, MB |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const r of rows) {
    let pos = 0, state = 0;
    for (const [k, v] of Object.entries(r.steady.byEventKBps)) { if (POS.has(k)) pos += v; else if (k === 'update' || k === 'patch' || k === 'init') state += v; }
    const g = (b: Bucket) => r.gapsMs[b].samples ? `${f1(r.gapsMs[b].median)} / ${f1(r.gapsMs[b].p95)}` : '—';
    lines.push(`| ${r.mode} | ${r.layout === 'one' ? 'all in the hub' : 'spread over 11'} | ${r.online} | ${f1(r.steady.wireKBps.mean)} / ${f1(r.steady.wireKBps.max)} | ${f1(pos)} | ${f1(state)} | ${f1(r.steady.serverMBps)} | ${f1(r.join.wireMB)} | ${g('near')} | ${g('district')} | ${g('away')} | ${r.server.cpuPct === null ? 'n/a' : f1(r.server.cpuPct) + '%'} | ${f1(r.server.memMB)} |`);
  }
  return lines.join('\n');
}

const rows: Row[] = [];
for (const mode of MODES) {
  for (const layout of LAYOUTS) {
    for (const online of ONLINE) {
      process.stderr.write(`${mode} ${layout} ${online}... `);
      const row = await runRow(mode, layout, online);
      rows.push(row);
      process.stderr.write(`${f1(row.steady.wireKBps.mean)} KB/s each, joins ${f1(row.join.wireMB)} MB, test lag p99 ${f1(row.testLagP99Ms)} ms\n`);
      if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 2));
    }
  }
}
console.log(table(rows));
if (OUT) console.log(`\n(full figures in ${OUT})`);
