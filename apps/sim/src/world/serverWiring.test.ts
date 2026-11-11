// The socket wiring, end to end: server.ts runs in a child process (PORT=0, NODE_ENV=production, a temp data dir with one
// saved account) and socket.io clients talk to it. Covers what the pure modules cannot: the visitor gate, the rental
// refusals, the host handoff, the reset on re-join and the missing-account notice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { signMagic, signSession } from './accounts';
import { EVENTS, freshStrip, stageOf } from './data';
import { partPrice } from './payout';
import { RENTAL_DENIED, VISITOR_DENIED } from './stripFlow';
import { TESTER_MONEY, TESTER_REFUSED, TESTER_REP } from './tester';
import { ATTEMPTS_PER_IP } from './testerKey';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'wiring-test-only-secret'; // a throwaway value for this child process, not a real secret
const ACCOUNT = 'acct-wiring';
const TESTER = 'wiring-tester-key'; // a throwaway tester key for this child process, not a real secret
let child: ChildProcess;
let dir: string;
let url: string;
let out = '';
let err = '';
const open: Socket[] = [];
// A local stand-in for Resend: the server's sign-in emails land here (RESEND_API_URL), so a test can read the link.
let mailer: Server;
const mail: Array<{ to: string; text: string }> = [];
const linkFor = (to: string) => { const m = mail.filter(x => x.to === to).pop(); return m ? decodeURIComponent(/#link=(\S+)/.exec(m.text)![1]) : undefined; };

beforeAll(async () => {
  mailer = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { try { const j = JSON.parse(body); mail.push({ to: j.to, text: j.text }); } catch { /* ignored */ } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"fake"}'); });
  });
  await new Promise<void>(r => mailer.listen(0, '127.0.0.1', () => r()));
  const mailUrl = `http://127.0.0.1:${(mailer.address() as AddressInfo).port}/emails`;
  dir = mkdtempSync(path.join(tmpdir(), 'micar-wiring-'));
  mkdirSync(path.join(dir, 'data'));
  cpSync(path.join(APP, 'public', 'strip', 'tracks'), path.join(dir, 'dist', 'strip', 'tracks'), { recursive: true }); // the track data a deployed dist carries
  const saved = { name: 'Saved', money: 1234, octane: 0, stamps: [], strip: freshStrip(), inventory: [] };
  writeFileSync(path.join(dir, 'data', 'gameState.json'), JSON.stringify({ accounts: { [ACCOUNT]: { id: ACCOUNT, identities: [{ kind: 'email', email: 'saved@example.com' }], player: saved, createdAt: 1 } } }));
  child = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: '0', MAGIC_SECRET: SECRET,
      RESEND_API_URL: mailUrl, RESEND_API_KEY: 'fake-key-for-the-local-mailer', MAGIC_FROM: 'test@example.com', TESTER_KEY: TESTER },
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

afterAll(async () => {
  for (const s of open) s.close();
  // tsx's cli spawns a second node that runs server.ts in `dir`. On Windows, killing the wrapper leaves that inner process
  // alive and holding the folder, so the whole tree goes.
  if (child && child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
    // Bounded so a stuck process can never hang the run.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  mailer?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
  s.emit('rent_car', { key: 'ronin' });
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

  it('rent_car refuses an unknown key and an unaffordable car, charging nothing', async () => {
    const g = client();
    const gi = await join(g, { mode: 'guest', name: 'WireRent' });
    const bad = next<any>(g, 'strip_denied');
    g.emit('rent_car', { key: 'coupe' });
    expect((await bad).reason).toBe('That car is not for rent.');
    const poor = next<any>(g, 'strip_denied');
    g.emit('rent_car', { key: 'brute' });
    expect((await poor).reason).toBe('Not enough money');
    const d = client();
    const seen = next<any>(g, 'update');
    await join(d, { name: 'WireRentDealer', lotScale: 'Small' });
    const me = (await seen).players[gi.id];
    expect(me.money).toBe(500); expect(me.inventory.some((c: any) => c.rental)).toBe(false);
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

  it('a link opened in another tab asks the clicker where to sign in; it never signs in the asking tab by itself', async () => {
    const requestLink = async (s: Socket, email: string) => { const sent = next(s, 'link_sent'); s.emit('request_link', { email }); await sent; return linkFor(email)!; };
    // 1. no target: link_choice, nothing linked, the link stays good; then 'here' signs in the clicker
    const req = client(); await join(req, { mode: 'guest', name: 'GameTab' });
    const token = await requestLink(req, 'chooser@example.com');
    const clk = client(); await join(clk, { mode: 'guest', name: 'MailTab' });
    let reqLinked = false; req.on('account_linked', () => { reqLinked = true; });
    const choice = next<any>(clk, 'link_choice');
    clk.emit('link_account', { magic: token });
    expect(await choice).toEqual({ email: 'chooser@example.com', requester: true });
    const here = next<any>(clk, 'account_linked');
    clk.emit('link_account', { magic: token, target: 'here' }); // the same link: the choice step spent nothing
    expect((await here).replaced).toBe(false);
    await new Promise(r => setTimeout(r, 200));
    expect(reqLinked).toBe(false);
    await close(req, clk);
    // 2. 'requester': the asking tab is signed in, the clicker is told to go back to it (with a session to continue here)
    const req2 = client(); await join(req2, { mode: 'guest', name: 'GameTab2' });
    const token2 = await requestLink(req2, 'chooser2@example.com');
    const clk2 = client(); await join(clk2, { mode: 'guest', name: 'MailTab2' });
    const theirs = next<any>(req2, 'account_linked');
    const told = next<any>(clk2, 'account_linked_elsewhere');
    clk2.emit('link_account', { magic: token2, target: 'requester' });
    const a = await theirs, e = await told;
    expect(typeof a.session).toBe('string'); expect(e.session).toBe(a.session);
    await close(req2, clk2);
  }, 30_000);

  // ---- the tester key (TESTER_KEY in the server's environment) ----
  /** True when no `event` reaches `s` within `ms`. */
  const quiet = (s: Socket, event: string, ms = 500) => new Promise<boolean>(resolve => {
    const on = () => { clearTimeout(timer); s.off(event, on); resolve(false); };
    const timer = setTimeout(() => { s.off(event, on); resolve(true); }, ms);
    s.on(event, on);
  });
  const mine = (u: any, id: string) => u.players[id];

  it('the tester key makes a guest a tester: money never short, every stage open, the key never in a name', async () => {
    const watcher = client(); await join(watcher, { mode: 'guest', name: 'Watcher' });
    const sawPool = next<any>(watcher, 'update', u => Object.values<any>(u.players).some(p => p.name === 'Pool'));
    const t = client(); const init = await join(t, { mode: 'guest', name: `Pool#${TESTER}` });
    const me = mine(init.state, init.id);
    expect(me).toMatchObject({ name: 'Pool', guest: true, tester: true, money: TESTER_MONEY });
    expect(me.strip.rep).toBe(TESTER_REP);
    expect(JSON.stringify(init)).not.toContain(TESTER);
    // other players see a guest called Pool: no flag, no money, no key
    const seen = Object.values<any>((await sawPool).players).find(p => p.name === 'Pool');
    expect(seen.tester).toBeUndefined();
    expect(seen.money).toBe(0);
    // the key sent on its own field works the same way
    const t2 = client(); const init2 = await join(t2, { mode: 'guest', name: 'Pool Two', testerKey: TESTER });
    expect(mine(init2.state, init2.id)).toMatchObject({ name: 'Pool Two', tester: true, money: TESTER_MONEY });
    // a wrong key does not join at all: it is refused with the reason, nobody new appears, and the same socket can
    // then join as an ordinary guest
    const g = client();
    let refused = next<any>(g, 'join_refused'); const noInit = quiet(g, 'init');
    g.emit('join', { mode: 'guest', name: 'Pool#not-the-key' });
    expect(await refused).toEqual({ why: 'wrong', reason: TESTER_REFUSED });
    expect(await noInit).toBe(true);
    const init3 = await join(g, { mode: 'guest', name: 'Pool' });
    expect(mine(init3.state, init3.id)).toMatchObject({ name: 'Pool', money: 500 });
    expect(mine(init3.state, init3.id).tester).toBeUndefined();
    expect(Object.values<any>(init3.state.players).filter(p => p.name === 'Pool')).toHaveLength(2); // the tester above and this guest: the refused join left nobody behind
    // a wrong key on a socket that is already in leaves its player as it was
    refused = next<any>(g, 'join_refused');
    g.emit('join', { mode: 'guest', name: 'Other', testerKey: 'still-not-the-key' });
    expect((await refused).why).toBe('wrong');
    const rented = next<any>(g, 'update', u => u.players[init3.id]?.inventory?.some((c: any) => c.rental));
    g.emit('rent_car', { key: 'ronin' });
    expect(mine(await rented, init3.id)).toMatchObject({ name: 'Pool', money: 0 });
    // a short tail after a name is not a try at the key: it joins as a guest, is told nothing, and is never counted
    // as a miss (more of them than the limit, and the right key below still works)
    const mikes: Socket[] = []; let told = 0;
    for (let i = 0; i <= ATTEMPTS_PER_IP; i++) {
      const m = client(); mikes.push(m); m.on('join_refused', () => { told++; });
      const mi = await join(m, { mode: 'guest', name: `Mike#123${i}` });
      expect(mine(mi.state, mi.id)).toMatchObject({ name: 'Mike', money: 500 });
      expect(mine(mi.state, mi.id).tester).toBeUndefined();
    }
    await close(...mikes);
    expect(told).toBe(0);
    // a dealer who types a key after the name is not a tester, and the key is not shown as part of the name
    const d = client(); const init4 = await join(d, { name: `Dealer Pool#${TESTER}`, lotScale: 'Small' });
    expect(mine(init4.state, init4.id).name).toBe('Dealer Pool');
    expect(mine(init4.state, init4.id).tester).toBeUndefined();
    await close(watcher, t, t2, g, d);
  });

  it('a tester takes any car, keeps it across events, tunes it with every part, and swaps it; nobody else can', async () => {
    const t = client(); const init = await join(t, { mode: 'guest', name: 'Pool', testerKey: TESTER });
    const id = init.id;
    // any car on the list, owned for the session (not a rental)
    let upd = next<any>(t, 'update', u => mine(u, id).inventory.length === 1);
    t.emit('test_car', { make: 'Chevy', model: 'Corvette' });
    const car = mine(await upd, id).inventory[0];
    expect(car).toMatchObject({ make: 'Chevy', model: 'Corvette', bodyStyle: 'sports', testCar: true, district: 'strip' });
    expect(car.rental).toBeUndefined();
    // a car that is not on the list is refused
    const notListed = next<any>(t, 'strip_denied');
    t.emit('test_car', { make: 'Chevy', model: 'Nope' });
    expect((await notListed).reason).toBe('That car is not on the list.');
    // the top part tier (stage 3) fits at once: the tester's REP opens every stage, and the money is there
    const q = partPrice('perf.engine', 3, stageOf(TESTER_REP));
    expect(q.ok).toBe(true);
    const price = (q as { ok: true; price: number }).price;
    upd = next<any>(t, 'update', u => mine(u, id).strip?.cars?.[car.id]?.cfg?.perf?.engine === 3);
    t.emit('strip_buy_part', { carId: car.id, key: 'perf.engine', v: 3, price });
    expect(mine(await upd, id).money).toBe(TESTER_MONEY - price);
    // ...and it is never short: the next thing the tester does starts from the full amount again
    upd = next<any>(t, 'update', u => mine(u, id).strip?.cars?.[car.id]?.tune?.aero === 1);
    t.emit('strip_tune', { carId: car.id, tune: { turbo: 0, nitrous: 0, aero: 1, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 } });
    expect(mine(await upd, id).money).toBe(TESTER_MONEY);
    // the highest-stage event opens for a tester, and quitting it does not take the car away (a rental would go back)
    const top = [...EVENTS].sort((a, b) => b.stage - a.stage)[0];
    t.emit('sync_car_pos', { carId: car.id, district: 'strip' });
    const noRefusal = quiet(t, 'strip_denied');
    t.emit('enter_event', { eventId: top.id });
    expect(await noRefusal).toBe(true);
    t.emit('quit_event', { eventId: top.id });
    upd = next<any>(t, 'update', u => mine(u, id).strip?.cars?.[car.id]?.tune?.aero === -1);
    t.emit('strip_tune', { carId: car.id, tune: { turbo: 0, nitrous: 0, aero: -1, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 } });
    expect(mine(await upd, id).inventory.map((c: any) => c.id)).toEqual([car.id]);
    // a test car cannot be turned into money: the visitor gate still stands
    const gated = next<any>(t, 'strip_denied');
    t.emit('take_title_loan', { carId: car.id });
    expect((await gated).reason).toBe(VISITOR_DENIED);
    // a tester session is not saved to an account
    const noAccount = next<any>(t, 'strip_denied');
    t.emit('request_link', { email: 'pool@example.com' });
    expect((await noAccount).reason).toBe('A tester session is not saved to an account');
    expect(linkFor('pool@example.com')).toBeUndefined();
    // another car replaces it; giving it back empties the garage; the first car's parts are still on file
    upd = next<any>(t, 'update', u => mine(u, id).inventory.some((c: any) => c.model === 'Mustang'));
    t.emit('test_car', { make: 'Ford', model: 'Mustang' });
    const after = mine(await upd, id);
    expect(after.inventory.map((c: any) => c.model)).toEqual(['Mustang']);
    expect(after.strip.cars[car.id].cfg.perf.engine).toBe(3);
    upd = next<any>(t, 'update', u => mine(u, id).inventory.length === 0);
    t.emit('test_car_return');
    await upd;
    // an ordinary guest gets no test car, and the same event stays locked for them
    const g = client(); const gi = await join(g, { mode: 'guest', name: 'Plain' });
    const no1 = next<any>(g, 'strip_denied');
    g.emit('test_car', { make: 'Chevy', model: 'Corvette' });
    expect((await no1).reason).toBe('That car is not for rent.');
    if (top.stage > 1) {
      const locked = next<any>(g, 'strip_denied');
      g.emit('enter_event', { eventId: top.id });
      await locked;
    }
    const check = next<any>(g, 'update', u => !!mine(u, gi.id));
    g.emit('rent_car', { key: 'civet' });
    expect(mine(await check, gi.id).inventory.every((c: any) => !c.testCar)).toBe(true);
    await close(t, g);
  });

  it('five wrong keys from one address shut the key out, the right one included (this test must stay the last to use the key)', async () => {
    for (let i = 0; i < ATTEMPTS_PER_IP; i++) {
      const s = client(); const refused = next<any>(s, 'join_refused');
      s.emit('join', { mode: 'guest', name: 'Guess', testerKey: `wrong-key-${i}` });
      expect(await refused).toEqual({ why: 'wrong', reason: TESTER_REFUSED });
      await close(s);
    }
    const s = client(); const refused = next<any>(s, 'join_refused'); const noInit = quiet(s, 'init');
    s.emit('join', { mode: 'guest', name: 'Pool', testerKey: TESTER });
    expect(await refused).toEqual({ why: 'locked', reason: 'Too many wrong keys. Try again in 10 minutes.' });
    expect(await noInit).toBe(true);
    // without the key the same socket still gets in, as an ordinary guest
    const init = await join(s, { mode: 'guest', name: 'Pool' });
    expect(mine(init.state, init.id).tester).toBeUndefined();
    expect(mine(init.state, init.id).money).toBe(500);
    await close(s);
  });

  it('the tester key never reaches the server log', () => { expect(out).not.toContain(TESTER); });

  it('the server wrote nothing to stderr', () => { expect(err).toBe(''); });
});
