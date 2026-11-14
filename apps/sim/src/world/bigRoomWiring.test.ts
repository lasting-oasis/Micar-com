// Rooms bigger than four, end to end: server.ts runs in a child process (as in serverWiring.test.ts) once with
// RACE_ROOM_MAX=16 and once without, and socket.io clients play the racers. Covers what race.test.ts cannot: the
// ceiling reaching the page through /api/caps, the size a host asks for, sixteen lent cars in sixteen colours, a pose
// reaching fifteen others, a result of sixteen rows, and nothing won.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { EVENTS } from './data';
import { raceFloor } from './payout';
import { SLOT_COLORS, type RoomView } from './race';
import { GUEST_STAKE } from './rental';
import { TRACKS } from './strip/district';
import { readTrackSync, setTrackDir } from './strip/districtNode';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// this process works out the drift's floor (its route length) as the server does, so it needs the track files too
beforeAll(() => { setTrackDir(path.join(APP, 'public', 'strip', 'tracks')); for (const t of TRACKS) readTrackSync(t.id); });

type Server = { url: string; stop(): Promise<void> };
/** server.ts in a temp folder (data/ and the track files a deployed dist carries), on a free port, with `env` added. */
async function startServer(env: Record<string, string>): Promise<Server> {
  const dir = mkdtempSync(path.join(tmpdir(), 'micar-bigroom-'));
  mkdirSync(path.join(dir, 'data'));
  cpSync(path.join(APP, 'public', 'strip', 'tracks'), path.join(dir, 'dist', 'strip', 'tracks'), { recursive: true });
  const child: ChildProcess = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stderr!.on('data', (d) => { err += d; });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + out + err)), 60_000);
    child.stdout!.on('data', (d) => {
      out += d;
      const m = /Server running on port (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}:\n${out}${err}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      // tsx's cli runs server.ts in a second node: on Windows the whole tree goes, or the folder stays held
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill();
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5_000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

/** The racers of one server: guests on sockets, and the waits the tests need. */
function racers(url: () => string) {
  const open: Socket[] = [];
  const next = <T = any>(s: Socket, event: string, pred: (d: T) => boolean = () => true, ms = 20_000) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, on); reject(new Error(`no ${event} in ${ms} ms`)); }, ms);
    const on = (d: T) => { if (!pred(d)) return; clearTimeout(timer); s.off(event, on); resolve(d); };
    s.on(event, on);
  });
  const guest = async (name: string) => {
    const s = connect(url(), { transports: ['websocket'], forceNew: true }); open.push(s);
    const init = next<any>(s, 'init'); s.emit('join', { mode: 'guest', name });
    const got = await init;
    return { s, id: got.id as string, init: got };
  };
  const roomSeen = (s: Socket, pred: (r: RoomView) => boolean = () => true) => next<RoomView>(s, 'race_room', pred);
  const denied = (s: Socket) => next<{ why: string }>(s, 'race_denied');
  const caps = async () => (await fetch(`${url()}/api/caps`)).json() as Promise<Record<string, unknown>>;
  const closeAll = () => { for (const s of open) s.close(); };
  return { next, guest, roomSeen, denied, caps, closeAll };
}

describe('a server whose ceiling is sixteen (RACE_ROOM_MAX=16)', () => {
  let server: Server;
  const r = racers(() => server.url);
  beforeAll(async () => { server = await startServer({ RACE_ROOM_MAX: '16' }); }, 70_000);
  afterAll(async () => { r.closeAll(); await server?.stop(); });

  it('a room of sixteen from start to result, and nothing won', async () => {
    expect((await r.caps()).raceMax).toBe(16);
    const people: { s: Socket; id: string; init: any }[] = [];
    for (let i = 0; i < 17; i++) people.push(await r.guest(`Racer ${i + 1}`));
    const [host, ...rest] = people, fifteen = rest.slice(0, 15), late = rest[15];
    expect(host.init.caps.raceMax).toBe(16); // the page learns the ceiling when it joins, too
    // the host asks for a grid of sixteen on the Harbour Drift (a short open route: its floor is under fourteen seconds)
    const made = r.roomSeen(host.s); host.s.emit('race_create', { eventId: 'harbour_drift', car: 'ronin', size: 16 });
    const room = await made;
    expect(room.max).toBe(16);
    const full = r.roomSeen(host.s, v => v.members.length === 16);
    for (const p of fifteen) p.s.emit('race_join', { code: room.code });
    await full;
    // the seventeenth is turned away, and the room cannot shrink below the sixteen in it or turn into a drag
    const no17 = r.denied(late.s); late.s.emit('race_join', { code: room.code });
    expect((await no17).why).toBe('full');
    const noDrag = r.denied(host.s); host.s.emit('race_set', { eventId: 'royal_drag', car: 'ronin' });
    expect((await noDrag).why).toBe('size');
    const noShrink = r.denied(host.s); host.s.emit('race_set', { eventId: 'harbour_drift', car: 'ronin', size: 8 });
    expect((await noShrink).why).toBe('size');
    // Start: sixteen lent cars in sixteen colours, one per grid place
    const lent = r.next<any>(host.s, 'update', u => people.slice(0, 16).every(p => u.players[p.id]?.inventory?.some((c: any) => c.loan)));
    const loading = r.roomSeen(host.s, v => v.phase === 'loading');
    host.s.emit('race_start');
    const view = await loading, state = await lent;
    expect(view.members.map(m => m.slot).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    const colours = people.slice(0, 16).map(p => state.players[p.id].inventory.find((c: any) => c.loan).color);
    expect(new Set(colours).size).toBe(16);
    for (const p of people.slice(0, 16)) expect(state.players[p.id].inventory.find((c: any) => c.loan).color).toBe(SLOT_COLORS[view.members.find(m => m.id === p.id)!.slot]);
    // everyone on the grid: one green light; a pose from one reaches the other fifteen
    const racing = r.roomSeen(host.s, v => v.phase === 'racing');
    for (const p of people.slice(0, 16)) p.s.emit('race_ready');
    const goAt = (await racing).goAt!;
    const heard = fifteen.map(p => r.next<any[]>(p.s, 'race_pose', pose => pose[0] === host.id));
    host.s.emit('race_pose', [goAt, 1, 2, 0.5, 30, 100, 0]);
    expect((await Promise.all(heard)).map(pose => pose[0])).toEqual(fifteen.map(() => host.id));
    // past the floor everyone finishes, the drift's scores deciding the order; the result has sixteen rows
    const floor = raceFloor(EVENTS.find(e => e.id === 'harbour_drift')!);
    await new Promise(res => setTimeout(res, Math.max(0, goAt + floor * 1000 + 300 - Date.now())));
    // (both waits start before the finishes: the server sends the result and the cars' return in the same moment)
    const closed = r.roomSeen(host.s, v => v.phase === 'open' && !!v.last);
    // (each racer reads itself from its own socket: the others' money is not sent to anyone)
    const back = people.slice(0, 16).map(p => r.next<any>(p.s, 'update', u => !!u.players[p.id] && !u.players[p.id].inventory.some((c: any) => c.loan)).then(u => u.players[p.id]));
    people.slice(0, 16).forEach((p, i) => p.s.emit('race_finish', { time: floor + 1, score: 1000 * (i + 1), failed: false }));
    const done = await closed;
    expect(done.last!.rows).toHaveLength(16);
    expect(done.last!.rows[0].id).toBe(people[15].id); // the highest score wins a drift
    // the cars are back and nobody won or lost anything
    for (const me of await Promise.all(back)) {
      expect(me.inventory).toEqual([]); expect(me.money).toBe(GUEST_STAKE); expect(me.octane).toBe(0); expect(me.stamps).toEqual([]);
      expect(me.strip).toMatchObject({ rep: 0, wins: {}, best: {} });
    }
  }, 90_000);

  it('the host changes the grid while the room is open: 16 to 8 and back again', async () => {
    const host = await r.guest('Resizer');
    const made = r.roomSeen(host.s); host.s.emit('race_create', { eventId: 'harbour_gp', car: 'ronin' });
    expect((await made).max).toBe(16);
    const eight = r.roomSeen(host.s, v => v.max === 8); host.s.emit('race_set', { eventId: 'harbour_gp', car: 'ronin', size: 8 });
    expect((await eight).max).toBe(8);
    const sixteen = r.roomSeen(host.s, v => v.max === 16); host.s.emit('race_set', { eventId: 'harbour_gp', car: 'ronin', size: 16 });
    expect((await sixteen).max).toBe(16);
  }, 30_000);

  it("a pose is relayed in fewer bytes: an older page's long numbers are rounded on the way", async () => {
    const a = await r.guest('Long'), b = await r.guest('Short');
    const made = r.roomSeen(a.s); a.s.emit('race_create', { eventId: 'harbour_drift', car: 'ronin', size: 4 });
    const room = await made;
    const two = r.roomSeen(a.s, v => v.members.length === 2); b.s.emit('race_join', { code: room.code }); await two;
    const racing = r.roomSeen(a.s, v => v.phase === 'racing'); a.s.emit('race_start');
    await r.roomSeen(a.s, v => v.phase === 'loading' || v.phase === 'racing');
    for (const p of [a, b]) p.s.emit('race_ready');
    const goAt = (await racing).goAt!;
    const heard = r.next<any[]>(b.s, 'race_pose', pose => pose[0] === a.id);
    // (the green is five seconds off: a pose stamped four seconds before it is on time by the server's clock, well inside
    // the five seconds of skew it allows; a pose stamped at the green would sit right on that edge)
    a.s.emit('race_pose', [goAt - 4000.4, 16098.616765074097, 8154.863643704915, 0.412083833922235, 17.64717058905482, 158.2285872987045, 0]);
    expect(await heard).toEqual([a.id, goAt - 4000, 16098.62, 8154.86, 0.412, 17.65, 158.23, 0]);
  }, 30_000);

  it('a page that asks for its poses a tick at a time gets them so, and no single ones; one that does not, as before', async () => {
    const [batched, plain, mover] = [await r.guest('Batched'), await r.guest('Plain'), await r.guest('Mover')];
    const made = r.roomSeen(batched.s); batched.s.emit('race_create', { eventId: 'harbour_drift', car: 'ronin', size: 4 });
    const room = await made;
    const three = r.roomSeen(batched.s, v => v.members.length === 3);
    for (const p of [plain, mover]) p.s.emit('race_join', { code: room.code });
    await three;
    const racing = r.roomSeen(batched.s, v => v.phase === 'racing'); batched.s.emit('race_start');
    await r.roomSeen(batched.s, v => v.phase === 'loading' || v.phase === 'racing');
    batched.s.emit('race_ready', { batch: true }); plain.s.emit('race_ready'); mover.s.emit('race_ready');
    const go = await racing, goAt = go.goAt!, slotOf = (id: string) => go.members.find(m => m.id === id)!.slot;
    const singles: unknown[] = [], batches: number[][][] = [];
    batched.s.on('race_pose', p => { singles.push(p); }); batched.s.on('race_poses', b => { batches.push(b); });
    const batch = r.next<number[][]>(batched.s, 'race_poses'), single = r.next<any[]>(plain.s, 'race_pose', p => p[0] === mover.id);
    const own = r.next<any[]>(plain.s, 'race_pose', p => p[0] === batched.id);
    // (the green is five seconds off: a pose stamped four seconds before it is on time, as the server's clock goes)
    batched.s.emit('race_pose', [goAt - 4100, 1, 2, 0.3, 4, 5, 0]); // the batched page's own pose: the others get it, it does not
    mover.s.emit('race_pose', [goAt - 4000.4, 16098.616765074097, 8154.86, 0.41, 17.6, 158.2, 0]);
    expect(await own).toEqual([batched.id, goAt - 4100, 1, 2, 0.3, 4, 5, 0]); // the server took it and relayed it
    expect(await batch).toEqual([[slotOf(mover.id), -4000, 16098.62, 8154.86, 0.41, 17.6, 158.2, 0]]); // its place, its time from the green
    expect(await single).toEqual([mover.id, goAt - 4000, 16098.62, 8154.86, 0.41, 17.6, 158.2, 0]);
    await new Promise(res => setTimeout(res, 300)); // about four ticks with nothing new in them
    expect(batches).toHaveLength(1); // the mover's pose was sent once, not again on every tick
    expect(batches.flat().some(e => e[0] === slotOf(batched.id))).toBe(false); // never this page's own place
    expect(singles).toEqual([]); // and never a single pose
  }, 30_000);

  it("a race started again at once carries none of the last race's poses", async () => {
    const [p, q] = [await r.guest('Again P'), await r.guest('Again Q')];
    const made = r.roomSeen(p.s); p.s.emit('race_create', { eventId: 'harbour_drift', car: 'ronin', size: 4 });
    const room = await made;
    const both = r.roomSeen(p.s, v => v.members.length === 2); q.s.emit('race_join', { code: room.code });
    await both;
    const race = async (batch: boolean) => {
      const racing = r.roomSeen(p.s, v => v.phase === 'racing'); p.s.emit('race_start');
      await r.roomSeen(p.s, v => v.phase === 'loading' || v.phase === 'racing');
      if (batch) p.s.emit('race_ready', { batch: true }); else p.s.emit('race_ready');
      q.s.emit('race_ready');
      return racing;
    };
    const first = await race(false);
    const heard = r.next<any[]>(p.s, 'race_pose', x => x[0] === q.id);
    q.s.emit('race_pose', [first.goAt! - 4000, 1, 2, 0.3, 4, 5, 0]);
    await heard; // the server kept it as q's newest pose
    const closed = r.roomSeen(p.s, v => v.phase === 'open');
    p.s.emit('race_quit'); q.s.emit('race_quit'); // both out: the race closes
    await closed;
    const batches: unknown[] = []; p.s.on('race_poses', b => { batches.push(b); });
    await race(true); // the next race at once, inside the server's one-second sweep; p asks for batches this time
    await new Promise(res => setTimeout(res, 300)); // about four ticks, and nobody has sent a pose in this race
    expect(batches).toEqual([]);
  }, 30_000);

  it("two quick racers on one circuit share a room of the ceiling's size, and its wait begins; a stage-1 guest cannot open the Ardennes", async () => {
    const [a, b, c] = [await r.guest('Quick A'), await r.guest('Quick B'), await r.guest('Quick C')];
    const opened = r.roomSeen(a.s); a.s.emit('race_quick', { track: 'monaco' });
    const room = await opened;
    expect(room).toMatchObject({ quick: true, eventId: 'harbour_gp', car: 'ronin', max: 16, startsAt: null });
    const two = r.roomSeen(b.s, v => v.members.length === 2); b.s.emit('race_quick', { track: 'monaco' });
    const joined = await two;
    expect(joined.code).toBe(room.code);
    // thirty seconds from the second arrival, on the server's clock (this PC's)
    expect(joined.startsAt! - Date.now()).toBeGreaterThan(25_000);
    expect(joined.startsAt! - Date.now()).toBeLessThanOrEqual(30_000);
    const no = r.denied(c.s); c.s.emit('race_quick', { track: 'spa' });
    expect(await no).toEqual({ why: 'pick' }); // the Ardennes GP opens at stage 5; a guest is at stage 1
    const junk = r.denied(c.s); c.s.emit('race_quick', { track: 'nowhere' });
    expect(await junk).toEqual({ why: 'pick' });
  }, 30_000);

  it('/api/race/quick counts who is waiting in each circuit\'s quick room', async () => {
    const counts = async () => (await (await fetch(`${server.url}/api/race/quick`)).json()) as { ok: boolean; waiting: Record<string, number> };
    const before = await counts();
    expect(before.ok).toBe(true);
    const d = await r.guest('Quick D');
    const opened = r.roomSeen(d.s); d.s.emit('race_quick', { track: 'interlagos' });
    expect(await opened).toMatchObject({ quick: true, eventId: 'lagoons_sprint' });
    expect((await counts()).waiting.interlagos ?? 0).toBe((before.waiting.interlagos ?? 0) + 1);
  }, 30_000);

  it('a room asked for with no size: a circuit gets the ceiling, a drag its four lanes', async () => {
    // what a page from before this work sends, and what lane A's load test sends (it races harbour_gp in the Ronin)
    const circuit = await r.guest('No size'), drag = await r.guest('No size drag');
    const madeCircuit = r.roomSeen(circuit.s); circuit.s.emit('race_create', { eventId: 'harbour_gp', car: 'ronin' });
    expect((await madeCircuit).max).toBe(16);
    const madeDrag = r.roomSeen(drag.s); drag.s.emit('race_create', { eventId: 'royal_drag', car: 'ronin' });
    expect((await madeDrag).max).toBe(4);
  }, 30_000);
});

describe('a server without RACE_ROOM_MAX', () => {
  let server: Server;
  const r = racers(() => server.url);
  beforeAll(async () => { server = await startServer({}); }, 70_000);
  afterAll(async () => { r.closeAll(); await server?.stop(); });

  it('makes rooms of four, and says so', async () => {
    expect((await r.caps()).raceMax).toBe(4);
    const a = await r.guest('Ana');
    expect(a.init.caps.raceMax).toBe(4);
    const tooBig = r.denied(a.s); a.s.emit('race_create', { eventId: 'harbour_gp', car: 'ronin', size: 8 });
    expect((await tooBig).why).toBe('size');
    // a refused size costs no room: the next ask is not held back by the three seconds between rooms
    const made = r.roomSeen(a.s); a.s.emit('race_create', { eventId: 'harbour_gp', car: 'ronin' });
    expect((await made).max).toBe(4);
  }, 30_000);
});
