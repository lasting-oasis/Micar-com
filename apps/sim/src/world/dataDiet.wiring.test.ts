// The data diet, end to end (docs/superpowers/specs/2026-11-14-world-data-diet-design.md): server.ts runs in a child
// process (NODE_ENV=production, a temp data dir, a free port from 3300 to 3399) and socket.io clients talk to it.
// A page that joins with proto: 2 gets `pos`; any other page is served as before. Its own file, apart from
// serverWiring.test.ts, so other lanes' edits there cannot clash with it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { signSession } from './accounts';
import { freshStrip } from './data';
import { decodePositions } from './netPositions';
import { applyPatch } from './stateSync';
import { WORLD_PER_M as W } from './units';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'diet-test-only-secret'; // a throwaway value for this child process, not a real secret
const RICH = 'acct-rich';
let child: ChildProcess;
let dir: string;
let url: string;
let out = '';
const open: Socket[] = [];

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

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'micar-diet-'));
  mkdirSync(path.join(dir, 'data'));
  const tracks = path.join(dir, 'dist', 'strip', 'tracks'); // the track data a deployed dist carries
  mkdirSync(tracks, { recursive: true });
  for (const f of readdirSync(path.join(APP, 'public', 'strip', 'tracks'))) if (f.endsWith('.json')) copyFileSync(path.join(APP, 'public', 'strip', 'tracks', f), path.join(tracks, f));
  // one saved account with what others must never be sent: money, and a car's price and spend
  const car = { id: 'car-rich', make: 'Toyota', model: 'Camry', year: 2019, bodyStyle: 'sedan', condition: 95, bodyCondition: 100, mechanicCondition: 100, mileage: 40000,
    buyPrice: 9000, recon: 1200, color: 'Silver', ownerId: null, daysOnLot: 0, titleStatus: 'Clean', activeRepairs: [] };
  writeFileSync(path.join(dir, 'data', 'gameState.json'), JSON.stringify({ accounts: {
    [RICH]: { id: RICH, identities: [{ kind: 'email', email: 'rich@example.com' }], player: { name: 'Rich', money: 1234, octane: 0, stamps: [], strip: freshStrip(), inventory: [car] }, createdAt: 1 },
  } }));
  const port = await freePort();
  child = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: String(port), MAGIC_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (d) => { out += d; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + out)), 60_000);
    child.stdout!.on('data', (d) => { out += d; if (/Server running on port \d+/.test(out)) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => reject(new Error(`server exited ${code}:\n${out}`)));
  });
  url = `http://127.0.0.1:${port}`;
}, 70_000);

afterAll(async () => {
  for (const s of open) s.close();
  if (child && child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
    await new Promise<void>(resolve => { const t = setTimeout(resolve, 5_000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
  }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const client = (): Socket => { const s = connect(url, { transports: ['websocket'], forceNew: true }); open.push(s); return s; };
const next = <T = any>(s: Socket, event: string, pred: (d: T) => boolean = () => true, ms = 10_000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { s.off(event, on); reject(new Error(`no ${event} in ${ms} ms`)); }, ms);
  const on = (d: T) => { if (!pred(d)) return; clearTimeout(timer); s.off(event, on); resolve(d); };
  s.on(event, on);
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A guest joins; `proto: 2` unless `old`. Resolves to its id and its short number. */
const guest = async (s: Socket, name: string, old = false) => {
  const init = next<any>(s, 'init');
  s.emit('join', { mode: 'guest', name, ...(old ? {} : { proto: 2 }) });
  const i = await init;
  return { id: i.id as string, n: i.state.players[i.id].n as number, init: i };
};
/** Sends a Strip pose at (x, z) metres, as the page does. */
const at = (s: Socket, xm: number, zm: number) => s.emit('sync_player_pos', { x: xm * W, y: 0, z: zm * W, rotation: 0, district: 'strip' });
/** Every `pos` entry `s` receives, decoded with the given short numbers. */
const listen = (s: Socket, names: Map<number, string>) => {
  const seen: Array<{ id: string; x: number; z: number }> = [];
  s.on('pos', (flat: unknown) => { for (const [id, p] of Object.entries(decodePositions(flat, n => names.get(n)))) seen.push({ id, x: p.stripPosition?.x ?? p.x, z: p.stripPosition?.z ?? p.z }); });
  return seen;
};
/** Drives `s` east from (xm, zm) for `ms`, ten positions a second. */
const drive = async (s: Socket, xm: number, zm: number, ms: number) => { for (let t = 0; t < ms; t += 100) { at(s, xm + t / 100, zm); await sleep(100); } };
/** The state a proto: 2 page holds, as the page builds it: its init, then every patch. Counts the old `update`s too. */
const replica = (s: Socket, init: any) => {
  const r = { state: init.state, patches: [] as any[], updates: 0 };
  s.on('patch', (p: any) => { r.patches.push(p); r.state = applyPatch(r.state, p); });
  s.on('update', () => { r.updates++; });
  return r;
};
const rent = (s: Socket) => s.emit('rent_car', { key: 'ronin' });

describe('positions by interest', () => {
  it('gives every player record a short number, different for each connection', async () => {
    const a = client(), b = client();
    const ga = await guest(a, 'NumA'), gb = await guest(b, 'NumB');
    expect(Number.isInteger(ga.n) && ga.n > 0).toBe(true);
    expect(Number.isInteger(gb.n) && gb.n > 0).toBe(true);
    expect(gb.n).not.toBe(ga.n);
    expect(gb.init.state.players[ga.id].n).toBe(ga.n); // another player's record carries its number too
    a.close(); b.close();
  });

  it('a new page gets pos with the other player where it drove, and never player_positions', async () => {
    const a = client(), b = client();
    const ga = await guest(a, 'PosA'), gb = await guest(b, 'PosB');
    let old = 0; a.on('player_positions', () => { old++; });
    const seen = listen(a, new Map([[gb.n, gb.id]]));
    at(a, 0, 0);
    await drive(b, 20, 10, 1000);
    await sleep(500);
    expect(old).toBe(0);
    const last = seen.filter(e => e.id === gb.id).pop();
    expect(last).toBeDefined();
    expect(Math.abs(last!.x - 29 * W)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(last!.z - 10 * W)).toBeLessThanOrEqual(0.05);
    expect(seen.some(e => e.id === ga.id)).toBe(false); // never its own
    a.close(); b.close();
  });

  it('an old page (no proto) still gets player_positions, as before', async () => {
    const l = client(), b = client();
    await guest(l, 'OldPage', true);
    const gb = await guest(b, 'Mover');
    const got = next<any>(l, 'player_positions', p => !!p?.[gb.id]?.stripPosition);
    at(b, 12, 3);
    const p = await got;
    expect(p[gb.id]).toMatchObject({ district: 'strip', stripPosition: { x: 12 * W, z: 3 * W } });
    l.close(); b.close();
  });

  it("decodes a Strip player to what an old page is sent: the gate in the town, the pose in the Strip", async () => {
    const l = client(), nw = client(), g = client();
    await guest(l, 'OldSees', true);
    await guest(nw, 'NewSees');
    const gg = await guest(g, 'Posed');
    let fresh: any;
    nw.on('pos', (flat: unknown) => { const got = decodePositions(flat, k => (k === gg.n ? gg.id : undefined)); if (got[gg.id]?.stripPosition) fresh = got[gg.id]; });
    const old = next<any>(l, 'player_positions', p => !!p?.[gg.id]?.stripPosition);
    g.emit('sync_player_pos', { x: 61.3, y: 0, z: -27.9, rotation: 2.5, district: 'strip' });
    const o = (await old)[gg.id];
    await until(() => !!fresh);
    // the town's part: the server stores the gate spot for anyone with a Strip pose, and the new page rebuilds exactly that
    expect({ x: fresh.x, y: fresh.y, z: fresh.z, rotation: fresh.rotation, district: fresh.district }).toEqual({ x: o.x, y: o.y, z: o.z, rotation: o.rotation, district: o.district });
    // the Strip's part, to the rounding
    expect(Math.abs(fresh.stripPosition.x - o.stripPosition.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(fresh.stripPosition.z - o.stripPosition.z)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(fresh.stripPosition.rotation - o.stripPosition.rotation)).toBeLessThanOrEqual(0.005);
    expect(fresh.stripPosition.y).toBe(o.stripPosition.y);
    l.close(); nw.close(); g.close();
  });

  it('decodes a town position to what an old page is sent', async () => {
    const l = client(), nw = client(), d = client();
    const dealer = async (s: Socket, name: string, old = false) => {
      const init = next<any>(s, 'init');
      s.emit('join', { name, lotScale: 'Small', ...(old ? {} : { proto: 2 }) });
      const i = await init;
      return { id: i.id as string, n: i.state.players[i.id].n as number };
    };
    await dealer(l, 'OldDealer', true);
    await dealer(nw, 'NewDealer');
    const dd = await dealer(d, 'Walker');
    let fresh: any;
    nw.on('pos', (flat: unknown) => { const got = decodePositions(flat, k => (k === dd.n ? dd.id : undefined)); if (got[dd.id]) fresh = got[dd.id]; });
    const old = next<any>(l, 'player_positions', p => p?.[dd.id]?.district === 'town');
    d.emit('sync_player_pos', { x: 123.456, y: 0.37, z: -456.789, rotation: 1.234, district: 'town' });
    const o = (await old)[dd.id];
    await until(() => !!fresh);
    expect(fresh.district).toBe('town'); expect(o.district).toBe('town');
    expect(Math.abs(fresh.x - o.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(fresh.z - o.z)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(fresh.y - o.y)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(fresh.rotation - o.rotation)).toBeLessThanOrEqual(0.005);
    expect(fresh.stripPosition).toBeUndefined(); expect(o.stripPosition).toBeUndefined();
    l.close(); nw.close(); d.close();
  });

  it('a page whose player is made anew without a join (a sign-out) is sent everyone again, still players included', async () => {
    const s = client(), a = client();
    const gs = await guest(s, 'Parked');
    at(s, 4, 4); // and then still
    const signedIn = next<any>(a, 'init');
    a.emit('join', { mode: 'session', session: signSession(RICH, Date.now(), SECRET), proto: 2 });
    expect((await signedIn).account?.id).toBe(RICH);
    await sleep(800); // a has had s's last position by now
    let after = false; const seen: string[] = [];
    a.on('pos', (flat: unknown) => { if (after) seen.push(...Object.keys(decodePositions(flat, k => (k === gs.n ? gs.id : undefined)))); });
    const again = next<any>(a, 'init');
    a.emit('sign_out', {});
    expect((await again).account).toBeUndefined(); // a guest again, from a fresh init and no join
    after = true;
    await sleep(500);
    expect(seen).toContain(gs.id);
    s.close(); a.close();
  });

  it('hears a near player every tick and a player on another circuit rarely', async () => {
    const a = client(), b = client(), c = client();
    await guest(a, 'Here');
    const gb = await guest(b, 'Near'), gc = await guest(c, 'Away');
    const seen = listen(a, new Map([[gb.n, gb.id], [gc.n, gc.id]]));
    at(a, 0, 0);
    await sleep(300);
    seen.length = 0;
    await Promise.all([drive(b, 50, 0, 3000), drive(c, 8000, 0, 3000)]);
    const nb = seen.filter(e => e.id === gb.id).length, nc = seen.filter(e => e.id === gc.id).length;
    expect(nb).toBeGreaterThanOrEqual(20); // about 30
    expect(nc).toBeLessThanOrEqual(2); // first contact, and perhaps one at the 5-second rate
    a.close(); b.close(); c.close();
  });

  it('a page that joins again on the same socket is sent everyone again; a player who leaves is never sent', async () => {
    const a = client(), b = client(), c = client();
    await guest(a, 'Again');
    const gb = await guest(b, 'Still'), gc = await guest(c, 'Leaver');
    at(b, 5, 5); at(c, 6, 6);
    await sleep(800); // both are still now, and a has had their last positions
    const seen = listen(a, new Map([[gb.n, gb.id], [gc.n, gc.id]]));
    c.close();
    await sleep(300);
    await guest(a, 'AgainAgain'); // a new init on the same socket
    await sleep(400);
    expect(seen.some(e => e.id === gb.id)).toBe(true); // b, standing still, came again
    expect(seen.some(e => e.id === gc.id)).toBe(false); // c had gone
    a.close(); b.close();
  });
});

const until = async (ok: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const rentalOf = (state: any, id: string) => state.players[id]?.inventory?.find((c: any) => c?.rental);
const TUNE = { turbo: 0, nitrous: 0, aero: 1, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 };

describe('patches instead of full copies', () => {
  it('a new page gets patches, never update, and ends where a fresh copy starts', async () => {
    const a = client(), b = client(), c = client();
    const ga = await guest(a, 'PatchA'), r = replica(a, ga.init);
    const gb = await guest(b, 'PatchB');
    rent(b);
    await until(() => !!rentalOf(r.state, gb.id));
    await sleep(300);
    expect(r.updates).toBe(0);
    const fresh = (await guest(c, 'Fresh')).init.state;
    expect(r.state.players[gb.id]).toEqual(fresh.players[gb.id]);
    for (const key of ['market', 'junkyard', 'economy', 'fractionalMarket', 'day', 'hostId']) expect(r.state[key]).toEqual(fresh[key]);
    a.close(); b.close(); c.close();
  });

  it("a join sends the others the newcomer's record, not the state", async () => {
    const a = client(), c = client();
    const ga = await guest(a, 'Sitter'), r = replica(a, ga.init);
    const gc = await guest(c, 'Newcomer');
    await until(() => !!r.state.players[gc.id]);
    const p = r.patches.find(x => x.players?.[gc.id]);
    expect(Object.keys(p.players)).toEqual([gc.id]);
    expect(JSON.stringify(p).length).toBeLessThan(2048);
    a.close(); c.close();
  });

  it('a refused action sends the player who tried its own record back, unchanged', async () => {
    const g = client();
    const gg = await guest(g, 'Refused'), r = replica(g, gg.init);
    rent(g);
    await until(() => !!rentalOf(r.state, gg.id));
    const money = r.state.players[gg.id].money, before = r.patches.length;
    const denied = next<any>(g, 'strip_denied');
    g.emit('strip_buy_part', { carId: rentalOf(r.state, gg.id).id, key: 'perf.engine', v: 1, price: 1 });
    expect((await denied).reason).toBeTruthy();
    await until(() => r.patches.slice(before).some(p => p.players?.[gg.id]));
    expect(r.patches.slice(before).find(p => p.players?.[gg.id]).players[gg.id].money).toBe(money);
    g.close();
  });

  it("never sends another player's money, account or what a car cost", async () => {
    const a = client(), rich = client();
    const ga = await guest(a, 'Nosy'), r = replica(a, ga.init);
    const init = next<any>(rich, 'init');
    rich.emit('join', { mode: 'session', session: signSession(RICH, Date.now(), SECRET), proto: 2 });
    const ri = await init;
    expect(ri.state.players[ri.id]).toMatchObject({ money: 1234, inventory: [{ id: 'car-rich', recon: 1200, buyPrice: 9000 }] }); // its own record, whole
    await until(() => !!r.state.players[ri.id]);
    rent(rich);
    await until(() => !!rentalOf(r.state, ri.id));
    const seen = r.patches.filter(p => p.players?.[ri.id]).map(p => p.players[ri.id]);
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.money).toBe(0); expect(p.accountId).toBeUndefined();
      for (const car of p.inventory) { expect(car.recon ?? 0).toBe(0); expect(car.buyPrice ?? 0).toBe(0); }
    }
    expect(JSON.stringify(r.patches)).not.toContain(RICH);
    a.close(); rich.close();
  });

  it("a driver's fuel and position reach nobody else when someone else acts", async () => {
    const a = client(), b = client(), c = client();
    const ga = await guest(a, 'Watch'), r = replica(a, ga.init);
    const gb = await guest(b, 'Driver'), gc = await guest(c, 'Actor');
    rent(b); rent(c);
    await until(() => !!rentalOf(r.state, gb.id) && !!rentalOf(r.state, gc.id));
    b.emit('consume_fuel', { carId: rentalOf(r.state, gb.id).id, fuel: 80 });
    at(b, 30, 30);
    await sleep(300);
    const before = r.patches.length;
    c.emit('strip_tune', { carId: rentalOf(r.state, gc.id).id, tune: TUNE }); // refused (a rental stays stock), and the state goes out again
    await sleep(500);
    expect(r.patches.slice(before).some(p => p.players?.[gb.id])).toBe(false);
    a.close(); b.close(); c.close();
  });

  it("a page's own fuel and position come back to it only with its own action, and current", async () => {
    const g = client();
    const gg = await guest(g, 'Reporter'), r = replica(g, gg.init);
    rent(g);
    await until(() => !!rentalOf(r.state, gg.id));
    const carId = rentalOf(r.state, gg.id).id;
    await sleep(300);
    const before = r.patches.length;
    g.emit('consume_fuel', { carId, fuel: 64 });
    at(g, 12, 7);
    await sleep(500);
    expect(r.patches.slice(before).some(p => p.players?.[gg.id])).toBe(false); // nothing the page does not have already
    g.emit('strip_tune', { carId, tune: TUNE }); // its own action (refused): its record comes back, whole
    await until(() => r.patches.slice(before).some(p => p.players?.[gg.id]));
    expect(rentalOf(r.state, gg.id).fuel).toBe(64);
    g.close();
  });

  it('a player who leaves is in gone, once', async () => {
    const a = client(), b = client();
    const ga = await guest(a, 'Stayer'), r = replica(a, ga.init);
    const gb = await guest(b, 'Goer');
    await until(() => !!r.state.players[gb.id]);
    b.close();
    await until(() => !r.state.players[gb.id]);
    await sleep(300);
    expect(r.patches.filter(p => p.gone?.includes(gb.id))).toHaveLength(1);
    a.close();
  });

  it('a page that joins again on the same socket gets a full copy, and patches from there', async () => {
    const a = client(), b = client();
    const first = await guest(a, 'Twice');
    const gb = await guest(b, 'Other');
    const again = await guest(a, 'TwiceAgain');
    expect(again.id).toBe(first.id);
    expect(again.init.state.players[gb.id]).toBeDefined();
    const r = replica(a, again.init);
    rent(b);
    await until(() => !!rentalOf(r.state, gb.id));
    expect(r.state.players[again.id].name).toBe('TwiceAgain');
    a.close(); b.close();
  });

  it('an old page (no proto) still gets update with every player, and no patch', async () => {
    const l = client(), b = client();
    const li = await guest(l, 'OldState', true);
    let patches = 0; l.on('patch', () => { patches++; });
    const upd = next<any>(l, 'update', u => Object.values<any>(u.players).some(p => p.name === 'NewForOld'));
    const gb = await guest(b, 'NewForOld');
    const u = await upd;
    expect(u.players[li.id]).toBeDefined(); expect(u.players[gb.id].money).toBe(0);
    rent(b);
    await next<any>(l, 'update', x => !!rentalOf(x, gb.id));
    expect(patches).toBe(0);
    l.close(); b.close();
  });
});
