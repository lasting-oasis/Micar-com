// The socket wiring, end to end: server.ts runs in a child process (PORT=0, NODE_ENV=production, a temp data dir with one
// saved account) and socket.io clients talk to it. Covers what the pure modules cannot: the visitor gate, the rental
// refusals, the host handoff, the reset on re-join and the missing-account notice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { signMagic, signSession } from './accounts';
import { freshStrip } from './data';
import { RENTAL_DENIED, VISITOR_DENIED } from './stripFlow';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'wiring-test-only-secret'; // a throwaway value for this child process, not a real secret
const ACCOUNT = 'acct-wiring';
let child: ChildProcess;
let dir: string;
let url: string;
let out = '';
let err = '';
const open: Socket[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'micar-wiring-'));
  mkdirSync(path.join(dir, 'data'));
  const saved = { name: 'Saved', money: 1234, octane: 0, stamps: [], strip: freshStrip(), inventory: [] };
  writeFileSync(path.join(dir, 'data', 'gameState.json'), JSON.stringify({ accounts: { [ACCOUNT]: { id: ACCOUNT, identities: [{ kind: 'email', email: 'saved@example.com' }], player: saved, createdAt: 1 } } }));
  child = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: '0', MAGIC_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  url = `http://127.0.0.1:${port}`;
}, 70_000);

afterAll(() => {
  for (const s of open) s.close();
  child?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const client = (): Socket => { const s = connect(url, { transports: ['websocket'], forceNew: true }); open.push(s); return s; };
/** The next `event` on `s` whose payload passes `pred`. */
const next = <T = any>(s: Socket, event: string, pred: (d: T) => boolean = () => true, ms = 10_000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { s.off(event, on); reject(new Error(`no ${event} in ${ms} ms`)); }, ms);
  const on = (d: T) => { if (!pred(d)) return; clearTimeout(timer); s.off(event, on); resolve(d); };
  s.on(event, on);
});
const join = async (s: Socket, msg: object) => { const init = next<any>(s, 'init'); s.emit('join', msg); return init; };
const close = async (...ss: Socket[]) => { for (const s of ss) s.close(); await new Promise(r => setTimeout(r, 200)); };
const rentOne = async (s: Socket, id: string) => {
  const upd = next<any>(s, 'update', u => u.players[id]?.inventory?.some((c: any) => c.rental));
  s.emit('rent_car', { key: 'hatchback' });
  return (await upd).players[id].inventory.find((c: any) => c.rental);
};

describe('server wiring', () => {
  it("a guest's dealer events are refused and change nothing; nobody can monetise a rental", async () => {
    const g = client();
    const gi = await join(g, { mode: 'guest', name: 'WireGuest' });
    expect(gi.state.players[gi.id].money).toBe(500);
    const rental = await rentOne(g, gi.id);
    for (const [event, payload] of [['take_title_loan', { carId: rental.id }], ['fractionalize_car', { carId: rental.id, shares: 1000 }], ['buy_car', { carId: 'x', useFinancing: true }], ['end_day', undefined]] as const) {
      const denied = next<any>(g, 'strip_denied');
      g.emit(event, payload);
      expect((await denied).reason).toBe(VISITOR_DENIED);
    }
    // a dealer joining broadcasts the state: the guest's money and rental are as they were
    const d = client();
    const seen = next<any>(g, 'update');
    const di = await join(d, { name: 'WireDealer', lotScale: 'Small' });
    const after = (await seen).players[gi.id];
    expect(after.money).toBe(0);
    expect(after.inventory.map((c: any) => c.id)).toEqual([rental.id]);
    expect(after.floorPlanDebt).toBe(0);
    // a dealer who rents can't borrow against, fractionalize or tune it either
    const dr = await rentOne(d, di.id);
    for (const [event, payload] of [['take_title_loan', { carId: dr.id }], ['fractionalize_car', { carId: dr.id, shares: 1000 }], ['scrap_car', dr.id], ['strip_tune', { carId: dr.id, tune: {} }]] as const) {
      const denied = next<any>(d, 'strip_denied');
      d.emit(event, payload);
      expect((await denied).reason).toBe(RENTAL_DENIED);
    }
    const check = next<any>(d, 'update');
    d.emit('strip_equip', { carId: dr.id, key: 'x', v: 1 }); // equip: refused, then broadcast
    const me = (await check).players[di.id];
    expect(me.money).toBe(25000 - 500); expect(me.floorPlanDebt).toBe(0);
    expect(me.inventory.map((c: any) => c.id)).toContain(dr.id);
    await close(g, d);
  }, 30_000);

  it('the host is always a dealer: a visitor never inherits it, and the next dealer claims it', async () => {
    const d1 = client();
    const i1 = await join(d1, { name: 'HostOne', lotScale: 'Small' });
    expect(i1.state.hostId).toBe(i1.id);
    const g = client();
    const gi = await join(g, { mode: 'guest', name: 'HostGuest' });
    expect(gi.state.hostId).toBe(i1.id);
    const handed = next<any>(g, 'update', u => !u.players[i1.id]);
    d1.close();
    expect((await handed).hostId).toBeNull();
    const d2 = client();
    const i2 = await join(d2, { name: 'HostTwo', lotScale: 'Small' });
    expect(i2.state.hostId).toBe(i2.id);
    // the host re-joining as a guest hands the day on (to nobody here), and the next dealer takes it
    const back = await join(d2, { mode: 'guest', name: 'NowGuest' });
    expect(back.state.hostId).toBeNull();
    const d3 = client();
    const i3 = await join(d3, { name: 'HostThree', lotScale: 'Small' });
    expect(i3.state.hostId).toBe(i3.id);
    await close(g, d2, d3);
  }, 30_000);

  it("a re-join on the same socket drops the old run's event entry: no payout for it", async () => {
    const g = client();
    const gi = await join(g, { mode: 'guest', name: 'Rejoiner' });
    const rental = await rentOne(g, gi.id);
    g.emit('sync_car_pos', { carId: rental.id, district: 'strip' });
    g.emit('enter_event', { eventId: 'dr1' });
    await new Promise(r => setTimeout(r, 200));
    const si = await join(g, { mode: 'session', session: signSession(ACCOUNT, Date.now(), SECRET) });
    expect(si.account?.id).toBe(ACCOUNT);
    expect(si.state.players[si.id].money).toBe(1234);
    const denied = next<any>(g, 'strip_denied');
    let paid = false; g.on('event_result', () => { paid = true; });
    g.emit('finish_event', { eventId: 'dr1', pos: 1, time: 60, score: 0, failed: false });
    expect((await denied).reason).toMatch(/could not be verified/);
    await new Promise(r => setTimeout(r, 200));
    expect(paid).toBe(false);
    expect(out).toContain(`finish_event refused: ${gi.id} no live entry`); // refused for the reset, not the clock
    await close(g);
  }, 30_000);

  it('a good session for an account this server lost joins as a guest, with a notice', async () => {
    const g = client();
    const denied = next<any>(g, 'strip_denied');
    const gi = await join(g, { mode: 'session', session: signSession('acct-gone', Date.now(), SECRET) });
    expect(gi.account).toBeUndefined();
    expect(gi.state.players[gi.id].guest).toBe(true);
    expect((await denied).reason).toBe('Your saved account was not found on this server');
    await close(g);
  }, 30_000);

  it('a magic link signs an untouched guest straight in; a guest with a run is asked first; a dealer cannot ask for one', async () => {
    const fresh = client();
    await join(fresh, { mode: 'guest', name: 'Fresh' });
    const linked = next<any>(fresh, 'account_linked');
    fresh.emit('link_account', { magic: signMagic('saved@example.com', Date.now(), SECRET) });
    const l = await linked;
    expect(l.account.id).toBe(ACCOUNT); expect(l.replaced).toBe(true); expect(typeof l.session).toBe('string');
    await close(fresh);
    const played = client();
    const pi = await join(played, { mode: 'guest', name: 'Played' });
    await rentOne(played, pi.id); // $500 spent: there is a run to lose
    const asked = next<any>(played, 'account_replace_prompt');
    played.emit('link_account', { magic: signMagic('saved@example.com', Date.now(), SECRET) });
    expect((await asked).money).toBe(0);
    const d = client();
    await join(d, { name: 'MailDealer', lotScale: 'Small' });
    const denied = next<any>(d, 'strip_denied');
    d.emit('request_link', { email: 'dealer@example.com' });
    expect((await denied).reason).toBe('Accounts are made from the Strip for now');
    await close(played, d);
  }, 30_000);

  it('the server wrote nothing to stderr', () => { expect(err).toBe(''); });
});
