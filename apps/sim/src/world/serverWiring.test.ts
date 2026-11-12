// The socket wiring, end to end: server.ts runs in a child process (PORT=0, NODE_ENV=production, a temp data dir with one
// saved account) and socket.io clients talk to it. Covers what the pure modules cannot: the visitor gate, the rental
// refusals, the host handoff, the reset on re-join and the missing-account notice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { signMagic, signSession } from './accounts';
import { EVENTS, freshStrip, stageOf } from './data';
import { partPrice } from './payout';
import { RENTAL_DENIED, STRIP_LIMIT, VISITOR_DENIED } from './stripFlow';
import { SLOT_COLORS, type RoomView } from './race';
import { TESTER_MONEY, TESTER_REFUSED, TESTER_REP } from './tester';
import { ATTEMPTS_PER_IP } from './testerKey';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'wiring-test-only-secret'; // a throwaway value for this child process, not a real secret
const ACCOUNT = 'acct-wiring';
const BAY = 'acct-bay';
const JUNK = 'acct-junk';
const CASH = 'acct-cash';
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
  const bayCar = { id: 'car-bay', make: 'Toyota', model: 'Camry', year: 2019, bodyStyle: 'sedan', condition: 95, bodyCondition: 100, mechanicCondition: 90, mileage: 40000, buyPrice: 9000, color: 'Silver', ownerId: null, daysOnLot: 0, titleStatus: 'Clean',
    activeRepairs: [{ id: 'f1', name: 'Worn Brake Pads', partName: 'Brake Pad Set', type: 'mechanic', cost: 250, conditionImpact: 10 }] };
  const hailCar = { ...bayCar, id: 'car-hail', bodyCondition: 60, mechanicCondition: 100, condition: 80, activeRepairs: [] };
  const bay = { name: 'Bay', money: 5000, octane: 0, stamps: [], strip: freshStrip(), inventory: [bayCar, hailCar] };
  const junk = { name: 'Junk', money: 100, octane: 0, stamps: [], strip: freshStrip(), inventory: [null, 'x', { ...hailCar, id: 'car-junk-ok' }] };
  const cash = { name: 'Cash', money: 900, octane: 0, stamps: [], strip: freshStrip(), inventory: [{ ...bayCar, id: 'car-cash', condition: 100, bodyCondition: 100, mechanicCondition: 100, activeRepairs: [] }] };
  // The auction's one car, saved so the dealer test does not depend on the random market: two faults on two different parts.
  const auctionCar = { ...bayCar, id: 'car-auction', condition: 90, bodyCondition: 100, mechanicCondition: 80, buyPrice: 3000, activeRepairs: [
    { id: 'a1', name: 'Worn Brake Pads', partName: 'Brake Pad Set', type: 'mechanic', cost: 250, conditionImpact: 10 },
    { id: 'a2', name: 'Bad Alternator', partName: 'Alternator', type: 'mechanic', cost: 300, conditionImpact: 10 }] };
  writeFileSync(path.join(dir, 'data', 'gameState.json'), JSON.stringify({ market: [auctionCar], accounts: {
    [JUNK]: { id: JUNK, identities: [{ kind: 'email', email: 'junk@example.com' }], player: junk, createdAt: 1 },
    [CASH]: { id: CASH, identities: [{ kind: 'email', email: 'cash@example.com' }], player: cash, createdAt: 1 },
    [ACCOUNT]: { id: ACCOUNT, identities: [{ kind: 'email', email: 'saved@example.com' }], player: saved, createdAt: 1 },
    [BAY]: { id: BAY, identities: [{ kind: 'email', email: 'bay@example.com' }], player: bay, createdAt: 1 },
  } }));
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

  const mineAfter = (s: Socket, id: string, pred: (p: any) => boolean = () => true) => next<any>(s, 'update', u => !!u.players[id] && pred(u.players[id])).then(u => u.players[id]);

  it('an order for a part over a fault is priced by the server, charged once, and recorded; what is wrong is refused', async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(BAY, Date.now(), SECRET) }), id = si.id;
    const hail = si.state.players[id].inventory.find((c: any) => c.id === 'car-hail');   // a saved car that lost condition with no fault has faults for it on joining
    expect(hail.activeRepairs.every((f: any) => f.type === 'body')).toBe(true); expect(hail.activeRepairs.reduce((n: number, f: any) => n + f.conditionImpact, 0)).toBe(40);
    const lines = [{ kind: 'install', key: 'perf.brakes', v: 1 }, { kind: 'install', key: 'tint', v: 1 }];
    const res = next<any>(s, 'bay_result'), upd = mineAfter(s, id, p => p.orders?.length === 1);
    s.emit('bay_order', { carId: 'car-bay', door: 'garage', lines, quote: 1200 });
    const { order } = await res, p = await upd, car = p.inventory.find((c: any) => c.id === 'car-bay');
    expect(order.total).toBe(1200); expect(order.lines.map((l: any) => l.outcome)).toEqual(['done', 'done']);
    expect(order.stages.length).toBeGreaterThan(0); expect(p.orders[0].stages).toEqual([]);   // the reply carries the stages; the stored order does not
    expect(p.money).toBe(3800); expect(car.activeRepairs).toEqual([]); expect(car.mechanicCondition).toBe(100); expect(car.recon).toBe(1200);
    expect(p.strip.cars['car-bay'].cfg.perf.brakes).toBe(1); expect(p.strip.cars['car-bay'].cfg.tint).toBe(1); expect(p.orders[0].id).toBe(order.id);
    const refuse = async (msg: object) => { const d = next<any>(s, 'strip_denied'), u = mineAfter(s, id); s.emit('bay_order', msg); const reason = (await d).reason; expect((await u).money).toBe(3800); return reason; };
    expect(await refuse({ carId: 'car-bay', door: 'garage', lines, quote: 1200 })).toBe('Already fitted.');                          // the second tap
    const one = [{ kind: 'install', key: 'spoiler', v: 1 }];
    expect(await refuse({ carId: 'car-bay', door: 'garage', lines: one, quote: 1 })).toBe('The price changed. Try again.');
    expect(await refuse({ carId: 'car-bay', door: 'garage', lines: 'x', quote: 0 })).toBe('That order is not valid.');
    expect(await refuse({ carId: 'car-bay', door: 'garage', lines: [], quote: 0 })).toBe('That order is not valid.');
    expect(await refuse({ carId: 'car-bay', door: 'the roof', lines: one, quote: 900 })).toBe('That order is not valid.');
    expect(await refuse({ carId: 'someone-elses', door: 'garage', lines: one, quote: 900 })).toBe('That order is not valid.');
    expect(await refuse({ carId: 'car-bay', door: 'garage', lines: Array.from({ length: 25 }, () => one[0]), quote: 0 })).toBe('Too many lines.');
    await close(s);
  }, 30_000);
  it("nobody is sent another player's orders or what they spent on a car", async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(BAY, Date.now(), SECRET) }), bid = si.id;
    const own = si.state.players[bid];
    expect(own.orders.length).toBeGreaterThan(0); expect(own.inventory.find((c: any) => c.id === 'car-bay').recon).toBe(1200);
    const hidden = (p: any) => { expect(p.orders ?? []).toEqual([]); for (const c of p.inventory) expect(c.recon ?? 0).toBe(0); };
    const d = client(), di = await join(d, { name: 'NosyDealer', lotScale: 'Small' });
    hidden(di.state.players[bid]);
    const upd = next<any>(d, 'update', u => !!u.players[bid]); d.emit('buy_part', { partName: 'Brake Pad Set' });
    hidden((await upd).players[bid]);
    await close(s, d);
  });
  it('a junk entry in a saved inventory cannot block a join', async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(JUNK, Date.now(), SECRET) });
    const car = si.state.players[si.id].inventory.find((c: any) => c && c.id === 'car-junk-ok');
    expect(car.activeRepairs.reduce((n: number, f: any) => n + f.conditionImpact, 0)).toBe(40);
    await close(s);
  });
  it('an order dearer than the cash is refused; one that takes the last dollar goes through', async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(CASH, Date.now(), SECRET) }), id = si.id;
    const d = next<any>(s, 'strip_denied'), u = mineAfter(s, id);
    s.emit('bay_order', { carId: 'car-cash', door: 'garage', lines: [{ kind: 'install', key: 'spoiler', v: 1 }, { kind: 'install', key: 'tint', v: 1 }], quote: 1200 });
    expect((await d).reason).toBe('Not enough cash for this order.'); expect((await u).money).toBe(900);
    const r = next<any>(s, 'bay_result'), u2 = mineAfter(s, id, p => p.orders?.length === 1);
    s.emit('bay_order', { carId: 'car-cash', door: 'garage', lines: [{ kind: 'install', key: 'spoiler', v: 1 }], quote: 900 });
    expect((await r).order.total).toBe(900); expect((await u2).money).toBe(0);
    await close(s);
  });
  it("a dealer's mixed order: stock makes one repair free and the Master Mechanic takes 20% off the other", async () => {
    const d = client(), di = await join(d, { name: 'BayDealer', lotScale: 'Small' }), id = di.id;
    const auction = di.state.market.find((c: any) => c.id === 'car-auction');
    const [first, second] = auction.activeRepairs;
    expect(first.partName).not.toBe(second.partName);
    let p = await (() => { const u = mineAfter(d, id, x => x.inventory.some((c: any) => c.id === 'car-auction')); d.emit('buy_car', { carId: 'car-auction', useFinancing: false }); return u; })();
    p = await (() => { const u = mineAfter(d, id, x => x.employees?.mechanic === true); d.emit('toggle_employee', { role: 'mechanic' }); return u; })();
    p = await (() => { const u = mineAfter(d, id, x => x.partsInventory[first.partName] === 1); d.emit('buy_part', { partName: first.partName }); return u; })();
    const spoiler = partPrice('spoiler', 1, 1) as { ok: true; price: number };
    const quote = Math.floor(second.cost * 0.8) + spoiler.price;
    const lines = [{ kind: 'repair', repairId: first.id }, { kind: 'repair', repairId: second.id }, { kind: 'install', key: 'spoiler', v: 1 }];
    const r = next<any>(d, 'bay_result'), u = mineAfter(d, id, x => x.orders?.length === 1);
    d.emit('bay_order', { carId: 'car-auction', door: 'dealership', lines, quote });
    const { order } = await r; p = await u;
    expect(order.lines.map((l: any) => l.outcome)).toEqual(['done', 'done', 'done']);
    expect(order.total).toBe(quote); expect(order.lines.map((l: any) => l.price)).toEqual([0, Math.floor(second.cost * 0.8), spoiler.price]);
    expect(p.partsInventory[first.partName]).toBe(0);
    expect(p.inventory.find((c: any) => c.id === 'car-auction').activeRepairs).toEqual([]);
    await close(d);
  }, 30_000);
  it('a rental takes no order', async () => {
    const g = client(), gi = await join(g, { mode: 'guest', name: 'BayGuest' }), rental = await rentOne(g, gi.id);
    const d = next<any>(g, 'strip_denied'); g.emit('bay_order', { carId: rental.id, door: 'garage', lines: [{ kind: 'install', key: 'spoiler', v: 1 }], quote: 900 });
    expect((await d).reason).toBe(RENTAL_DENIED); await close(g);
  });
  it('buy_part is priced by the server', async () => {
    const d = client(), di = await join(d, { name: 'PartsDealer', lotScale: 'Small' }), m0 = di.state.players[di.id].money;
    const u1 = mineAfter(d, di.id, p => p.partsInventory['Brake Pad Set'] === 1); d.emit('buy_part', { partName: 'Brake Pad Set', cost: -50000 }); expect((await u1).money).toBe(m0 - 187);
    d.emit('buy_part', { partName: 'Gold Bar', cost: 1 });
    const u2 = mineAfter(d, di.id, p => p.partsInventory['Brake Pad Set'] === 2); d.emit('buy_part', { partName: 'Worn Brake Pads' }); const p = await u2;   // a page loaded before the deploy sends the fault's name
    expect(p.money).toBe(m0 - 374); expect(p.partsInventory['Gold Bar']).toBeUndefined(); expect(p.partsInventory['Worn Brake Pads']).toBeUndefined(); await close(d);
  });
  it('the Parts tab stocks a part under the name a repair looks for', () => {
    const app = readFileSync(path.join(APP, 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('partsInventory?.[p.partName]'); expect(app).toContain('buyPart(p.partName)');
    expect(app).not.toContain('partsInventory?.[p.name]'); expect(app).not.toContain('buyPart(p.name');
  });
  it('repair_engine is gone', () => { expect(readFileSync(path.join(APP, 'server.ts'), 'utf8')).not.toContain('repair_engine'); });

  /** The event named by each `--- HANDLER ERROR ---` entry the server has logged (the entry spans lines). */
  const handlerErrors = () => [...out.matchAll(/--- HANDLER ERROR --- \{\s*event: '([^']+)'/g)].map(m => m[1]);
  it('a part key named after a built-in is refused, by the old message and by an order', async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(BAY, Date.now(), SECRET) });
    let d = next<any>(s, 'strip_denied'); s.emit('strip_buy_part', { carId: 'car-bay', key: 'constructor', v: 1, price: 0 }); expect((await d).reason).toBe('Unknown part.');
    d = next<any>(s, 'strip_denied'); s.emit('bay_order', { carId: 'car-bay', door: 'garage', lines: [{ kind: 'install', key: '__proto__', v: 1 }], quote: 0 }); expect((await d).reason).toBe('Unknown part.');
    expect(si.id).toBeTruthy(); await close(s);
  });
  it('a malformed message stops nobody', async () => {
    const g = client(); await join(g, { mode: 'guest', name: 'Malformed' });
    const d = client(), di = await join(d, { name: 'MalformedDealer', lotScale: 'Small' });
    g.emit('rent_car', null); g.emit('strip_buy_part', null);
    const nulled = next<any>(d, 'strip_denied');
    d.emit('perform_specific_repair'); d.emit('buy_part'); d.emit('bay_order', null);
    expect((await nulled).reason).toBe('That order is not valid.');
    const denied = next<any>(g, 'strip_denied', x => x.reason === 'That car is not for rent.'); g.emit('rent_car', { key: 'no-such-car' }); await denied;
    const upd = mineAfter(d, di.id, p => p.partsInventory['Brake Pad Set'] === 1); d.emit('buy_part', { partName: 'Brake Pad Set' }); await upd;
    await new Promise(r => setTimeout(r, 500));
    const errs = handlerErrors();
    for (const e of ['rent_car', 'strip_buy_part', 'perform_specific_repair']) expect(errs).toContain(e);
    for (const e of ['buy_part', 'bay_order']) expect(errs).not.toContain(e);
    await close(g, d);
  }, 30_000);

  // ---- challenge races: a room, a link, lent cars, one green light (race.ts has the rules; this is the wiring)
  const roomSeen = (s: Socket, pred: (r: RoomView) => boolean = () => true) => next<RoomView>(s, 'race_room', pred, 15_000);
  const raceDenied = (s: Socket) => next<{ why: string }>(s, 'race_denied');
  const guest = async (name: string) => { const s = client(); const i = await join(s, { mode: 'guest', name }); return { s, id: i.id as string }; };
  const lookup = async (code: string) => { const r = await fetch(`${url}/api/race/${code}`); return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() as any }; };
  const makeRoom = (host: { s: Socket }, eventId = 'royal_drag', car = 'ronin') => { const r = roomSeen(host.s); host.s.emit('race_create', { eventId, car }); return r; };
  const joinRoomAs = (who: { s: Socket }, code: string) => { const r = roomSeen(who.s); who.s.emit('race_join', { code }); return r; };
  const loanOf = (p: any) => p.inventory.find((c: any) => c.loan);

  it('three guests race a challenge from a link: lent cars, one green light, a result, and no money moved', async () => {
    const a = await guest('Ana'), b = await guest('Bo'), c = await guest('Cy'), outsider = await guest('Out');
    const overheard: string[] = []; outsider.s.onAny((...all: unknown[]) => { overheard.push(JSON.stringify(all)); }); // everything someone outside the room is sent
    const made = await makeRoom(a), code = made.code;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    expect(made).toMatchObject({ eventId: 'royal_drag', car: 'ronin', hostId: a.id, phase: 'open', raceNo: 0, goAt: null, last: null });
    expect(made.members.map(m => [m.id, m.name, m.state])).toEqual([[a.id, 'Ana', 'waiting']]);
    // what the link shows before anyone joins
    const inv = await lookup(code);
    expect(inv.status).toBe(200); expect(inv.cache).toBe('no-store');
    expect(inv.body).toEqual({ ok: true, host: 'Ana', eventId: 'royal_drag', car: 'ronin', count: 1, max: 4, phase: 'open' });
    for (const bad of ['zzzzzz', 'nope']) { const r = await lookup(bad); expect(r.status).toBe(404); expect(r.body).toEqual({ ok: false }); }
    // the others come in by the code as people type it, and every member is told
    const two = roomSeen(a.s, r => r.members.length === 2);
    expect((await joinRoomAs(b, code.toLowerCase())).members).toHaveLength(2);
    await two;
    const three = roomSeen(a.s, r => r.members.length === 3);
    expect((await joinRoomAs(c, ` ${code.slice(0, 3)}-${code.slice(3)} `)).members.map(m => m.name)).toEqual(['Ana', 'Bo', 'Cy']);
    await three;
    // only the host starts
    const notHost = raceDenied(b.s); b.s.emit('race_start'); expect((await notHost).why).toBe('host');
    // Start: everyone is loading, and each is lent the car in the colour of a different grid place
    const loading = [a, b, c].map(p => roomSeen(p.s, r => r.phase === 'loading'));
    const lent = [a, b, c].map(p => mineAfter(p.s, p.id, me => !!loanOf(me)));
    a.s.emit('race_start');
    const view = (await Promise.all(loading))[0];
    expect(view.raceNo).toBe(1);
    expect(view.members.map(m => m.state)).toEqual(['loading', 'loading', 'loading']);
    expect(view.members.map(m => m.slot).sort()).toEqual([0, 1, 2]);
    const cars = (await Promise.all(lent)).map(loanOf);
    for (const car of cars) expect(car).toMatchObject({ rental: true, loan: true, make: 'Ronin', model: 'GT' });
    for (const [i, p] of [a, b, c].entries()) expect(cars[i].color).toBe(SLOT_COLORS[view.members.find(m => m.id === p.id)!.slot]);
    expect(new Set(cars.map(x => x.color)).size).toBe(3);
    // a paid event cannot be entered in a lent car
    const noEvent = next<any>(a.s, 'strip_denied'); a.s.emit('enter_event', { eventId: 'royal_drag' }); expect((await noEvent).reason).toBe('Finish the challenge first.');
    // everyone ready: one green light for all, five seconds on
    const going = [a, b, c].map(p => roomSeen(p.s, r => r.phase === 'racing'));
    const t0 = Date.now();
    for (const p of [a, b, c]) p.s.emit('race_ready');
    const go = (await Promise.all(going))[0], goAt = go.goAt!;
    expect(goAt).toBeGreaterThanOrEqual(t0 + 5000 - 50); expect(goAt).toBeLessThanOrEqual(Date.now() + 5000 + 50);
    expect(go.members.map(m => m.state)).toEqual(['racing', 'racing', 'racing']);
    // a pose goes to the other racers under its sender's id: not back to the sender, and to nobody outside the room
    const atA = next<any[]>(a.s, 'race_pose'), atC = next<any[]>(c.s, 'race_pose'), outside = quiet(outsider.s, 'race_pose', 400), echo = quiet(b.s, 'race_pose', 400);
    b.s.emit('race_pose', [goAt, 1, 2, 0.5, 30, 100, 0]);
    expect(await atA).toEqual([b.id, goAt, 1, 2, 0.5, 30, 100, 0]); expect(await atC).toEqual([b.id, goAt, 1, 2, 0.5, 30, 100, 0]);
    expect(await outside).toBe(true); expect(await echo).toBe(true);
    // in a live race: junk is not passed on, a wild pose is cut down to the Strip's size and the server's own time, and a burst is thinned
    const heard: any[][] = [], hear = (pose: any[]) => { heard.push(pose); };
    a.s.on('race_pose', hear);
    await new Promise(r => setTimeout(r, 80)); // past the 40 ms that space a racer's poses
    for (const junk of [null, 'x', 42, {}, [NaN, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6, 7, 8], ['a', 1, 2, 3, 4, 5, 6], [Infinity, 1, 2, 3, 4, 5, 6]]) b.s.emit('race_pose', junk);
    b.s.emit('race_pose', [1e300, 1e300, -1e300, 1e300, 1e300, 1e300, 1e300]);
    // twelve more, 5 ms apart (each its own packet, so nothing but the server's own spacing thins them)
    const t1 = Date.now();
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 5)); b.s.emit('race_pose', [goAt, i, 2, 0.5, 30, 100, 0]); }
    const spent = Date.now() - t1;
    await new Promise(r => setTimeout(r, 300));
    a.s.off('race_pose', hear);
    expect(heard.length).toBeGreaterThanOrEqual(1);
    expect(heard.length).toBeLessThanOrEqual(2 + Math.floor(spent / 40)); // one in 40 ms goes on, however fast they come
    const [from, wildT, ...wild] = heard[0];
    expect(from).toBe(b.id);
    expect(wild).toEqual([STRIP_LIMIT, -STRIP_LIMIT, 1000, 200, STRIP_LIMIT, 9_999_999]);
    expect(Math.abs(wildT - Date.now())).toBeLessThan(5000); // a time nowhere near the server's is replaced by the server's
    // a finish before any car could be home is refused
    const tooSoon = raceDenied(a.s); a.s.emit('race_finish', { time: 1, score: 0, failed: false }); expect((await tooSoon).why).toBe('state');
    // c quits: a DNF, whose car goes back at once while the others keep theirs
    const quitSeen = roomSeen(a.s, r => r.members.find(m => m.id === c.id)?.state === 'dnf');
    const cBack = mineAfter(c.s, c.id, me => !loanOf(me)), aKeeps = mineAfter(a.s, a.id);
    c.s.emit('race_quit');
    expect((await quitSeen).members.map(m => [m.name, m.state, m.why])).toEqual([['Ana', 'racing', null], ['Bo', 'racing', null], ['Cy', 'dnf', 'quit']]);
    expect((await cBack).inventory).toEqual([]);
    expect(loanOf(await aKeeps)).toBeTruthy();
    // once the quarter mile's floor has passed (402 m at 50 m/s: 8.04 s after the green light) a finish is taken
    await new Promise(r => setTimeout(r, Math.max(0, goAt + 8_150 - Date.now())));
    const aHome = roomSeen(a.s, r => r.members.find(m => m.id === a.id)?.state === 'finished');
    const claim = (Date.now() - goAt) / 1000;
    a.s.emit('race_finish', { time: claim, score: 0, failed: false });
    const home = await aHome;
    expect(home.members.find(m => m.id === a.id)!.time).toBeCloseTo(claim, 2); // its own time stands: it agrees with the server's clock
    expect(home.phase).toBe('racing');
    expect(home.closesAt).toBeGreaterThan(Date.now() + 55_000); // the others have a minute
    // b claims a time nobody could drive and gets the server's figure; with nobody left racing the race closes
    const closed = [a, b, c].map(p => roomSeen(p.s, r => r.phase === 'open' && !!r.last));
    const back = [a, b, c].map(p => mineAfter(p.s, p.id, me => !loanOf(me)));
    const bSent = (Date.now() - goAt) / 1000;
    b.s.emit('race_finish', { time: 1, score: 0, failed: false });
    const done = (await Promise.all(closed))[0];
    expect(done.last!.raceNo).toBe(1);
    expect(done.last!.rows.map(r => [r.name, r.pos, r.why])).toEqual([['Ana', 1, null], ['Bo', 2, null], ['Cy', 3, 'quit']]);
    const bTime = done.last!.rows[1].time!;
    expect(bTime).toBeGreaterThanOrEqual(bSent - 0.01); expect(bTime).toBeLessThan(bSent + 0.5);
    expect(done.members.map(m => m.state)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(done.goAt).toBeNull(); expect(done.closesAt).toBeNull();
    // the cars are back and nothing was won or lost
    for (const me of await Promise.all(back)) {
      expect(me.inventory).toEqual([]); expect(me.money).toBe(500); expect(me.octane).toBe(0); expect(me.stamps).toEqual([]);
      expect(me.strip).toMatchObject({ rep: 0, wins: {}, best: {}, cars: {} });
    }
    // the code is the key to the room: nobody outside it was ever sent it
    expect(overheard.length).toBeGreaterThan(5);
    expect(overheard.join('\n')).not.toContain(code);
    await close(a.s, b.s, c.s, outsider.s);
  }, 60_000);

  it('the host leaving hands the room on, and an empty room can be joined again by its code', async () => {
    const h = await guest('Hal'), m = await guest('Mo');
    const code = (await makeRoom(h)).code;
    await joinRoomAs(m, code);
    const handed = roomSeen(m.s, r => r.hostId === m.id);
    h.s.close();
    expect((await handed).members.map(x => x.name)).toEqual(['Mo']);
    m.s.emit('race_leave');
    await new Promise(r => setTimeout(r, 300));
    expect((await lookup(code)).body).toEqual({ ok: true, host: 'Mo', eventId: 'royal_drag', car: 'ronin', count: 0, max: 4, phase: 'open' }); // nobody is in: the link still names the last to host
    // whoever comes back to it by the code hosts it
    const n = await guest('Nia'), back = await joinRoomAs(n, code);
    expect(back.hostId).toBe(n.id); expect(back.members.map(x => x.name)).toEqual(['Nia']);
    // one room at a time: making another leaves this one
    const other = await makeRoom(n, 'harbour_gp', 'civet');
    expect(other.code).not.toBe(code);
    expect((await lookup(code)).body.count).toBe(0);
    await close(m.s, n.s);
  }, 30_000);

  it('a racer who drops stays on the result as a DNF, and the room carries on under a new host', async () => {
    const x = await guest('Xi'), y = await guest('Yo');
    const code = (await makeRoom(x)).code;
    await joinRoomAs(y, code);
    const loading = [x, y].map(p => roomSeen(p.s, r => r.phase === 'loading'));
    x.s.emit('race_start');
    await Promise.all(loading);
    const going = roomSeen(y.s, r => r.phase === 'racing');
    x.s.emit('race_ready'); y.s.emit('race_ready');
    await going;
    const alone = roomSeen(y.s, r => r.members.length === 1);
    x.s.close(); // the host's connection drops after the start
    expect(await alone).toMatchObject({ hostId: y.id, phase: 'racing' });
    const over = roomSeen(y.s, r => r.phase === 'open' && !!r.last), carBack = mineAfter(y.s, y.id, me => !loanOf(me));
    y.s.emit('race_quit');
    expect((await over).last!.rows.map(r => [r.name, r.time, r.why])).toEqual([['Yo', null, 'quit'], ['Xi', null, 'left']]);
    expect((await carBack).money).toBe(500);
    await close(y.s);
  }, 30_000);

  it('the refusals: few, full, gone, pick, host, holding, slow; and no renting from inside a room', async () => {
    const g = await Promise.all(['R1', 'R2', 'R3', 'R4', 'R5'].map(guest));
    const code = (await makeRoom(g[0])).code;
    let d = raceDenied(g[0].s); g[0].s.emit('race_start'); expect((await d).why).toBe('few');
    for (const p of g.slice(1, 4)) await joinRoomAs(p, code);
    d = raceDenied(g[4].s); g[4].s.emit('race_join', { code }); expect((await d).why).toBe('full');
    d = raceDenied(g[4].s); g[4].s.emit('race_join', { code: 'ZZZZZZ' }); expect((await d).why).toBe('gone');
    d = raceDenied(g[4].s); g[4].s.emit('race_join', { code: 'not a code' }); expect((await d).why).toBe('gone');
    d = raceDenied(g[4].s); g[4].s.emit('race_create', { eventId: 'ardennes_gp', car: 'ronin' }); expect((await d).why).toBe('pick'); // a new guest is at stage 1; it opens at 5
    d = raceDenied(g[1].s); g[1].s.emit('race_set', { eventId: 'harbour_gp', car: 'civet' }); expect((await d).why).toBe('host');
    // the host changes the race, and everyone is told
    const changed = roomSeen(g[3].s, r => r.eventId === 'harbour_gp');
    g[0].s.emit('race_set', { eventId: 'harbour_gp', car: 'civet' });
    expect(await changed).toMatchObject({ eventId: 'harbour_gp', car: 'civet' });
    // no car from the counter while in a room
    const noRent = next<any>(g[1].s, 'strip_denied'); g[1].s.emit('rent_car', { key: 'civet' }); expect((await noRent).reason).toBe('Leave the challenge first.');
    // and no room while holding a car from the counter
    await rentOne(g[4].s, g[4].id);
    d = raceDenied(g[4].s); g[4].s.emit('race_create', { eventId: 'royal_drag', car: 'ronin' }); expect((await d).why).toBe('holding');
    d = raceDenied(g[4].s); g[4].s.emit('race_join', { code }); expect((await d).why).toBe('holding');
    // rooms are not made in a burst; the refusal leaves the first room alone
    const solo = await guest('Burst'), first = (await makeRoom(solo)).code;
    d = raceDenied(solo.s); solo.s.emit('race_create', { eventId: 'royal_drag', car: 'ronin' }); expect((await d).why).toBe('slow');
    expect((await lookup(first)).body.count).toBe(1);
    // a tester takes no car while in a room, and with a car in hand joins none
    const tt = client(), ti = await join(tt, { mode: 'guest', name: 'RoomTester', testerKey: TESTER });
    await joinRoomAs({ s: tt }, first);
    const noTest = next<any>(tt, 'strip_denied'); tt.emit('test_car', { make: 'Ford', model: 'Mustang' }); expect((await noTest).reason).toBe('Leave the challenge first.');
    tt.emit('race_leave'); await new Promise(r => setTimeout(r, 200));
    const gotCar = mineAfter(tt, ti.id, me => me.inventory.some((c: any) => c.testCar)); tt.emit('test_car', { make: 'Ford', model: 'Mustang' }); await gotCar;
    d = raceDenied(tt); tt.emit('race_join', { code: first }); expect((await d).why).toBe('holding');
    await close(solo.s, tt, ...g.map(p => p.s));
  }, 30_000);

  it('junk on every race message stops nobody', async () => {
    const g = await guest('Junk');
    let turnedAway = false; g.s.on('strip_denied', (d: any) => { if (d?.reason === VISITOR_DENIED) turnedAway = true; });
    for (const ev of ['race_time', 'race_create', 'race_join', 'race_set', 'race_start', 'race_ready', 'race_pose', 'race_finish', 'race_quit', 'race_leave'])
      for (const junk of [null, 'x', 42, {}, [], undefined]) g.s.emit(ev, junk);
    for (const pose of [[NaN, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6, 7, 8], ['a', 1, 2, 3, 4, 5, 6], [Infinity, 1, 2, 3, 4, 5, 6]]) g.s.emit('race_pose', pose);
    await new Promise(r => setTimeout(r, 400));
    // the clock still answers, and the same socket still makes a room
    const ts = await new Promise<number>(res => g.s.emit('race_time', (t: number) => res(t)));
    expect(Math.abs(ts - Date.now())).toBeLessThan(2000);
    expect((await makeRoom(g)).members).toHaveLength(1);
    expect(turnedAway).toBe(false); // every one of them is open to a visitor
    await close(g.s);
  }, 30_000);

  it('a sign-in that swaps the run, a sign-out and a session taken over elsewhere each leave the room, and the page can come back', async () => {
    const h = await guest('RoomHost'), code = (await makeRoom(h)).code;
    // 1. a guest in the room signs in to a saved account: the saved player was never in the room
    const g = await guest('Signer');
    await joinRoomAs(g, code);
    let gone = roomSeen(h.s, r => r.members.length === 1);
    const linked = next<any>(g.s, 'account_linked');
    g.s.emit('link_account', { magic: signMagic('saved@example.com', Date.now(), SECRET) });
    expect((await linked).replaced).toBe(true); // what the page goes by to join again (store: raceHandlers.onLinked)
    expect((await gone).members.map(m => m.name)).toEqual(['RoomHost']);
    const back = await joinRoomAs(g, code);
    expect(back.members.map(m => [m.id, m.name])).toEqual([[h.id, 'RoomHost'], [g.id, 'Saved']]);
    // 2. signing out makes a guest of the socket again (a new init: the page joins again from it) and takes it out of the room
    gone = roomSeen(h.s, r => r.members.length === 1);
    const again = next<any>(g.s, 'init');
    g.s.emit('sign_out');
    await gone; await again;
    expect((await lookup(code)).body.count).toBe(1);
    await close(g.s);
    // 3. the same account opened in a second tab takes the session: the first tab's place in the room goes
    const t1 = client(); await join(t1, { mode: 'session', session: signSession(ACCOUNT, Date.now(), SECRET) });
    expect((await joinRoomAs({ s: t1 }, code)).members).toHaveLength(2);
    gone = roomSeen(h.s, r => r.members.length === 1);
    const t2 = client(); await join(t2, { mode: 'session', session: signSession(ACCOUNT, Date.now(), SECRET) });
    await gone;
    await close(h.s, t1, t2);
  }, 30_000);

  it('one address holds twenty rooms at a time and no more; another address still gets its own', async () => {
    // the address is the last hop of X-Forwarded-For (the hosting proxy's), as for sign-in mail and the tester key
    const guestFrom = async (addr: string, name: string) => {
      const s = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { 'x-forwarded-for': addr } }); open.push(s);
      return { s, id: (await join(s, { mode: 'guest', name })).id as string };
    };
    const flood = await Promise.all(Array.from({ length: 21 }, (_, i) => guestFrom('203.0.113.50', 'Flood' + i)));
    for (const p of flood.slice(0, 20)) expect((await makeRoom(p)).members).toHaveLength(1);
    const d = raceDenied(flood[20].s); flood[20].s.emit('race_create', { eventId: 'royal_drag', car: 'ronin' }); expect((await d).why).toBe('busy');
    const honest = await guestFrom('198.51.100.7', 'Honest');
    expect((await makeRoom(honest)).members).toHaveLength(1);
    await close(honest.s, ...flood.map(p => p.s));
  }, 30_000);

  it('a junk entry in a saved inventory stops no challenge being made or joined', async () => {
    const s = client(), si = await join(s, { mode: 'session', session: signSession(JUNK, Date.now(), SECRET) });
    expect((await makeRoom({ s })).members.map(m => m.id)).toEqual([si.id]);
    const h = await guest('JunkHost'), code = (await makeRoom(h)).code;
    expect((await joinRoomAs({ s }, code)).members.map(m => m.name)).toEqual(['JunkHost', 'Junk']);
    await close(s, h.s);
  }, 40_000);

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

  it('the server wrote nothing to stderr, and the only handler errors it logged are the three the malformed-message test sent', () => {
    expect(err).toBe('');
    const errs = handlerErrors().sort();
    expect(errs).toEqual(['perform_specific_repair', 'rent_car', 'strip_buy_part']);
    expect(out.split('--- HANDLER ERROR ---').length - 1).toBe(errs.length);
  });
});
