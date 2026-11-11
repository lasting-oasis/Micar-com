// Tester mode is off until the server has a usable key. server.ts runs in child processes (as in serverWiring.test.ts):
// one with no TESTER_KEY at all, which is how every deployment starts, and one with a key too short to be safe.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import { TESTER_OFF } from './tester';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHORT = 'short'; // a throwaway value, too short to be taken as a key
type Srv = { child: ChildProcess; dir: string; url: string; out: string; err: string };
const servers: Srv[] = [];
const open: Socket[] = [];

async function start(extra: Record<string, string>): Promise<Srv> {
  const dir = mkdtempSync(path.join(tmpdir(), 'micar-tester-off-'));
  mkdirSync(path.join(dir, 'data'));
  cpSync(path.join(APP, 'public', 'strip', 'tracks'), path.join(dir, 'dist', 'strip', 'tracks'), { recursive: true });
  const child = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), path.join(APP, 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, TMPDIR: tmpdir(), NODE_ENV: 'production', PORT: '0', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const s: Srv = { child, dir, url: '', out: '', err: '' };
  servers.push(s);
  child.stderr!.on('data', (d) => { s.err += d; });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + s.out + s.err)), 60_000);
    child.stdout!.on('data', (d) => {
      s.out += d;
      const m = /Server running on port (\d+)/.exec(s.out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}:\n${s.out}${s.err}`)));
  });
  s.url = `http://127.0.0.1:${port}`;
  return s;
}

let unset: Srv, short: Srv;
beforeAll(async () => { [unset, short] = await Promise.all([start({}), start({ TESTER_KEY: SHORT })]); }, 70_000);

afterAll(async () => {
  for (const s of open) s.close();
  await Promise.all(servers.map(async ({ child, dir }) => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5_000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }));
});

const client = (url: string): Socket => { const s = connect(url, { transports: ['websocket'], forceNew: true }); open.push(s); return s; };
const next = <T = any>(s: Socket, event: string, ms = 10_000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { s.off(event, on); reject(new Error(`no ${event} in ${ms} ms`)); }, ms);
  const on = (d: T) => { clearTimeout(timer); s.off(event, on); resolve(d); };
  s.on(event, on);
});

describe.each([
  ['no TESTER_KEY', () => unset, 'anything-long-enough'],
  ['a TESTER_KEY too short to use', () => short, SHORT + '-padded-out'],
])('tester mode is off with %s', (_label, srv, guess) => {
  it('refuses every key and says it is off, however often it is tried; a guest still gets in, with no tester powers', async () => {
    const s = client(srv().url);
    // more tries than the limit that locks a wrong key out: with tester mode off nothing is counted, so the answer never changes
    for (const msg of [{ mode: 'guest', name: `Pool#${guess}` }, { mode: 'guest', name: 'Pool', testerKey: guess }, ...Array.from({ length: 6 }, () => ({ mode: 'guest', name: 'Pool', testerKey: SHORT + SHORT }))]) {
      const refused = next<any>(s, 'join_refused');
      s.emit('join', msg);
      expect(await refused).toEqual({ why: 'off', reason: TESTER_OFF });
    }
    const init = next<any>(s, 'init');
    s.emit('join', { mode: 'guest', name: 'Pool' });
    const me = (await init).state.players[s.id!];
    expect(me).toMatchObject({ name: 'Pool', guest: true, money: 500 });
    expect(me.tester).toBeUndefined();
    const denied = next<any>(s, 'strip_denied');
    s.emit('test_car', { make: 'Chevy', model: 'Corvette' });
    expect((await denied).reason).toBe('That car is not for rent.');
    s.close();
  });
});

describe('the server says so, quietly', () => {
  it('a key too short to use is reported on the log without the key; nothing reaches stderr', () => {
    expect(short.out).toContain('TESTER_KEY is set but is not 8 to 128 characters long: tester mode stays off');
    expect(unset.out).not.toContain('TESTER_KEY');
    expect(short.err).toBe('');
    expect(unset.err).toBe('');
  });
});
