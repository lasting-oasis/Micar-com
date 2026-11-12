import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { LINK_BUSY, LINK_IP_BUSY, LINK_WINDOW_MS, allowSend, clientIp, newSendLog, ALLOWANCE, signMagic, verifyMagic, signSession, verifySession, verifyGoogle, linkGuest, claimAllowance, saveRecord, applyRecord, attachAccount, liveHolder, identityKey, bootState, utcDay } from './accounts';
import { lend } from './rental';
const S = 'test-secret';
const guest = (money = 1350) => ({ id: 's1', name: 'Pool', money, octane: 40, stamps: ['strip:first-win'], strip: { rep: 150, cars: {}, wins: { dr1: 1 }, best: { dr1: 9.8 } }, inventory: [{ id: 'rental-1', rental: true }, { id: 'own-1' }] } as any);
describe('magic links', () => {
  it('round-trips, lowercases, expires at 15 minutes and is single use', () => {
    const used = new Set<string>(); const t = signMagic('Pool@Example.com', 0, S);
    expect(verifyMagic(t, 14 * 60_000, S, used)).toBe('pool@example.com');
    expect(verifyMagic(t, 14 * 60_000, S, used)).toBeUndefined();          // used
    expect(verifyMagic(signMagic('a@b.c', 0, S), 15 * 60_000 + 1, S, new Set())).toBeUndefined(); // expired
    expect(verifyMagic(signMagic('a@b.c', 0, S) + 'x', 1, S, new Set())).toBeUndefined();         // tampered
    expect(verifyMagic(signMagic('a@b.c', 0, S), 1, 'other', new Set())).toBeUndefined();         // wrong secret
  });
  it('cannot be replayed by altering the last character of a consumed token', () => {
    const used = new Set<string>(); const t = signMagic('a@b.c', 0, S);
    expect(verifyMagic(t, 1, S, used)).toBe('a@b.c');
    // a sibling last char sharing the high 4 bits decodes to the same signature bytes (32 bytes -> 43 chars, last char carries 4 bits)
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = t.slice(-1), base = ALPHA.indexOf(last) & ~3;
    const sibling = ALPHA[base + ((ALPHA.indexOf(last) + 1) & 3)];
    const variant = t.slice(0, -1) + sibling;
    expect(variant).not.toBe(t);
    expect(Buffer.from(variant.split('.')[1], 'base64url').equals(Buffer.from(t.split('.')[1], 'base64url'))).toBe(true);
    expect(verifyMagic(variant, 1, S, used)).toBeUndefined();
    expect(verifyMagic(variant, 1, S, new Set())).toBeUndefined();
  });
  it('keeps magic and session tokens apart', () => {
    expect(verifyMagic(signSession('a@b.c', 0, S), 1, S, new Set())).toBeUndefined();
    expect(verifySession(signMagic('a@b.c', 0, S), 1, S)).toBeUndefined();
  });
});
describe('sessions', () => {
  it('round-trips for 30 days', () => {
    const t = signSession('acct-1', 0, S);
    expect(verifySession(t, 29 * 86_400_000, S)).toBe('acct-1');
    expect(verifySession(t, 30 * 86_400_000 + 1, S)).toBeUndefined();
  });
});
describe('google', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1' };
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (payload: any, kid = 'k1', alg = 'RS256') => { const h = b64({ alg, kid }), p = b64(payload); const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url'); return `${h}.${p}.${sig}`; };
  const good = { iss: 'https://accounts.google.com', aud: 'cid', sub: '123', email: 'p@x.y', exp: 2000 };
  it('accepts a token signed by a known key for our client id', () => expect(verifyGoogle(token(good), 'cid', [jwk], 1_000_000)).toEqual({ sub: '123', email: 'p@x.y' }));
  it('rejects wrong audience, wrong issuer, expiry, unknown key and a bad signature', () => {
    expect(verifyGoogle(token({ ...good, aud: 'other' }), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token({ ...good, iss: 'evil' }), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token(good), 'cid', [jwk], 2_001_000)).toBeUndefined();
    expect(verifyGoogle(token(good, 'k2'), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle((() => { const t = token(good); return t.slice(0, -10) + (t.slice(-10, -9) === 'A' ? 'B' : 'A') + t.slice(-9); })(), 'cid', [jwk], 1_000_000)).toBeUndefined();
    expect(verifyGoogle(token(good, 'k1', 'HS256'), 'cid', [jwk], 1_000_000)).toBeUndefined();
  });
});
describe('linking and the allowance', () => {
  it('creates an account from a guest with the rental stripped', () => {
    const accounts: any = {}; const r = linkGuest(accounts, { kind: 'email', email: 'p@x.y' }, guest(), 1000);
    expect(r.replaced).toBe(false); expect(Object.keys(accounts)).toEqual([r.account.id]);
    expect(r.account.player).toEqual({ name: 'Pool', money: 1350, octane: 40, stamps: ['strip:first-win'], strip: guest().strip, inventory: [{ id: 'own-1' }] });
  });
  it('loads an existing account instead and flags the replacement', () => {
    const accounts: any = {}; const a = linkGuest(accounts, { kind: 'google', sub: '9' }, guest(100), 1).account;
    const r = linkGuest(accounts, { kind: 'google', sub: '9' }, guest(5000), 2);
    expect(r).toEqual({ account: a, replaced: true }); expect(a.player.money).toBe(100);
  });
  it('pays $1,000 once per UTC day — 23:59 and 00:01 are two days', () => {
    const a = linkGuest({}, { kind: 'email', email: 'p@x.y' }, guest(0), 1).account;
    const t1 = Date.UTC(2026, 10, 6, 23, 59), t2 = Date.UTC(2026, 10, 7, 0, 1);
    expect(claimAllowance(a, t1)).toEqual({ ok: true, amount: ALLOWANCE }); expect(a.player.money).toBe(1000); expect(a.lastAllowance).toBe('2026-11-06');
    expect(claimAllowance(a, t1 + 30_000)).toEqual({ ok: false, reason: 'Allowance already collected today' });
    expect(claimAllowance(a, t2).ok).toBe(true); expect(a.player.money).toBe(2000); expect(utcDay(t2)).toBe('2026-11-07');
  });
  it('saveRecord drops rentals; a live account cannot attach twice; boot keeps accounts and drops players', () => {
    expect(saveRecord(guest()).inventory).toEqual([{ id: 'own-1' }]);
    const live = guest(), rec = saveRecord(live); live.stamps.push('x'); live.strip.rep = 999; live.inventory[1].id = 'changed';
    expect(rec.stamps).toEqual(['strip:first-win']); expect(rec.strip?.rep).toBe(150); expect(rec.inventory).toEqual([{ id: 'own-1' }]);
    expect(attachAccount('acct-1', [{ accountId: 'acct-1' } as any])).toEqual({ ok: false, reason: 'already signed in' });
    expect(attachAccount('acct-1', [])).toEqual({ ok: true });
    const st = bootState({ players: { a: 1 }, accounts: { x: { id: 'x' } as any } });
    expect(st.players).toEqual({}); expect(Object.keys(st.accounts)).toEqual(['x']);
    expect(bootState({ players: {} } as any).accounts).toEqual({});
  });
});

describe('live holders and identity keys', () => {
  it('finds the other live socket holding an account', () => {
    const players = { a: { accountId: 'x' }, b: { accountId: 'y' }, c: {} } as any;
    expect(liveHolder('x', players)).toBe('a');
    expect(liveHolder('x', players, 'a')).toBeUndefined();
    expect(liveHolder('z', players)).toBeUndefined();
  });
  it('keys a google identity by sub, ignoring email', () => {
    expect(identityKey({ kind: 'google', sub: '42', email: 'a@b.c' })).toBe(identityKey({ kind: 'google', sub: '42' }));
    expect(identityKey({ kind: 'google', sub: '42', email: 'a@b.c' })).toBe('google:42');
  });
});

describe('saved records and email limits', () => {
  it('saveRecord keeps the bay orders when there are some and writes no orders key when there are none; applyRecord defaults them', () => {
    const none = guest(); expect('orders' in saveRecord(none)).toBe(false); expect('orders' in saveRecord({ ...none, orders: [] })).toBe(false);
    const orders = [{ id: 'wo-1', carId: 'own-1', car: 'x', door: 'garage', day: 1, lines: [], total: 0, stages: [] }];
    const rec = saveRecord({ ...none, orders }); expect(rec.orders).toEqual(orders); expect(rec.orders).not.toBe(orders);
    const p = guest(); applyRecord(p, saveRecord(none)); expect(p.orders).toEqual([]);
    applyRecord(p, rec); expect(p.orders).toEqual(orders);
  });
  it('applyRecord keeps only well-formed orders, at most 30', () => {
    const wo = (n: number) => ({ id: 'wo-' + n, carId: 'own-1', car: 'x', door: 'garage', day: 1, lines: [], total: 0, stages: [] });
    const load = (orders: unknown) => { const p = guest(); applyRecord(p, { ...saveRecord(guest()), orders } as any); return p.orders; };
    expect(load('x')).toEqual([]); expect(load({ a: 1 })).toEqual([]);
    expect(load([null, 5, { id: 'bad' }, wo(1)])).toEqual([wo(1)]);
    expect(load(Array.from({ length: 40 }, (_, i) => wo(i)))).toEqual(Array.from({ length: 30 }, (_, i) => wo(i)));
  });
  it('saveRecord drops the part records of rentals', () => {
    const g = guest();
    g.strip.cars = { 'rental-1': { cfg: {}, owned: ['a'] }, 'rental-9-old': { cfg: {}, owned: [] }, 'own-1': { cfg: {}, owned: ['b'] } };
    expect(Object.keys(saveRecord(g).strip!.cars)).toEqual(['own-1']);
    expect(Object.keys(g.strip.cars)).toHaveLength(3); // the live record is untouched
  });
  it('a car lent for a challenge is never saved, nor its part record', () => {
    const g = guest(); const car = lend(g, 'ronin', '#ffd23f', 5);
    g.strip.cars[car.id] = { cfg: {}, owned: ['a'] };
    const rec = saveRecord(g);
    expect(rec.inventory.map((c: any) => c.id)).toEqual(['own-1']);
    expect(Object.keys(rec.strip!.cars)).toEqual([]);
    expect(g.inventory).toContain(car); // the live player still holds it
  });
  it('email sends: 3 per address and 30 in all per rolling hour, counted only when allowed', () => {
    const log = newSendLog();
    for (let i = 0; i < 3; i++) expect(allowSend(log, 'ip-a', i)).toEqual({ ok: true });
    expect(allowSend(log, 'ip-a', 10)).toEqual({ ok: false, reason: LINK_IP_BUSY });
    expect(allowSend(log, 'ip-a', LINK_WINDOW_MS)).toEqual({ ok: true }); // the first send has aged out
    const all = newSendLog();
    for (let i = 0; i < 30; i++) expect(allowSend(all, `ip-${i}`, 100)).toEqual({ ok: true });
    expect(allowSend(all, 'ip-new', 200)).toEqual({ ok: false, reason: LINK_BUSY });
    expect(all.all).toHaveLength(30);
    expect(allowSend(all, 'ip-new', 100 + LINK_WINDOW_MS)).toEqual({ ok: true });
    expect(all.byIp.size).toBe(1);
  });
  it('the client address is the first forwarded hop, else the socket address', () => {
    expect(clientIp({ 'x-forwarded-for': 'forged, 1.2.3.4' }, '10.0.0.1')).toBe('1.2.3.4'); // the proxy-appended hop, never the client's
    expect(clientIp({ 'x-forwarded-for': ['5.6.7.8'] }, 'x')).toBe('5.6.7.8');
    expect(clientIp({}, '::1')).toBe('::1');
    expect(clientIp({}, undefined)).toBe('unknown');
  });
});
