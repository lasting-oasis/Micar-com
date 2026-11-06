import crypto from 'node:crypto';
import type { Player } from '../types';
import { freshStrip } from './data';
import { isRental } from './rental';

export const ALLOWANCE = 1000;
export const MAGIC_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;

export type Identity = { kind: 'google'; sub: string; email?: string } | { kind: 'email'; email: string };
export type SavedPlayer = Pick<Player, 'name' | 'money' | 'octane' | 'stamps' | 'strip' | 'inventory'>;
export type Account = { id: string; identities: Identity[]; player: SavedPlayer; lastAllowance?: string; createdAt: number };
export type Jwk = { kid: string; n: string; e: string; [k: string]: unknown };

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const mac = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest();

// token = base64url(`${subject}.${expiresAt}`) + '.' + base64url(HMAC-SHA256)
function sign(domain: 'm' | 's', subject: string, expiresAt: number, secret: string): string {
  const body = b64(`${domain}:${subject}.${expiresAt}`);
  return `${body}.${b64(mac(body, secret))}`;
}

function open(domain: 'm' | 's', token: string, now: number, secret: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [body, sig] = parts;
  const want = mac(body, secret);
  if (b64(want) !== sig) return undefined; // reject non-canonical encodings of a valid signature
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return undefined;
  const full = Buffer.from(body, 'base64url').toString();
  if (!full.startsWith(`${domain}:`)) return undefined;
  const text = full.slice(2);
  const dot = text.lastIndexOf('.');
  if (dot < 0) return undefined;
  const expiresAt = Number(text.slice(dot + 1));
  if (!Number.isFinite(expiresAt) || now > expiresAt) return undefined;
  return text.slice(0, dot);
}

export function signMagic(email: string, now: number, secret: string): string {
  return sign('m', email.toLowerCase(), now + MAGIC_TTL_MS, secret);
}
export function verifyMagic(token: string, now: number, secret: string, used: Set<string>): string | undefined {
  if (used.has(token)) return undefined;
  const email = open('m', token, now, secret);
  if (email === undefined) return undefined;
  used.add(token);
  return email.toLowerCase();
}

export function signSession(accountId: string, now: number, secret: string): string {
  return sign('s', accountId, now + SESSION_TTL_MS, secret);
}
export function verifySession(token: string, now: number, secret: string): string | undefined {
  return open('s', token, now, secret);
}

export function verifyGoogle(idToken: string, clientId: string, keys: Jwk[], now: number): { sub: string; email?: string } | undefined {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'RS256') return undefined;
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return undefined;
    const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return undefined;
    const c = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (c.aud !== clientId) return undefined;
    if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') return undefined;
    if (typeof c.exp !== 'number' || !(c.exp > now / 1000)) return undefined;
    if (typeof c.sub !== 'string' || !c.sub) return undefined;
    return typeof c.email === 'string' ? { sub: c.sub, email: c.email } : { sub: c.sub };
  } catch {
    return undefined;
  }
}

export function identityKey(id: Identity): string {
  return id.kind === 'google' ? `google:${id.sub}` : `email:${id.email}`;
}

export function findAccount(accounts: Record<string, Account>, id: Identity): Account | undefined {
  const k = identityKey(id);
  return Object.values(accounts).find(a => a.identities.some(i => identityKey(i) === k));
}

export function saveRecord(player: Player): SavedPlayer {
  // no rental, and no part record of a rental, outlives the session
  const rentalIds = new Set(player.inventory.filter(c => isRental(c)).map(c => c.id));
  const strip = player.strip && {
    ...player.strip,
    cars: Object.fromEntries(Object.entries(player.strip.cars ?? {}).filter(([id]) => !rentalIds.has(id) && !id.startsWith('rental-'))),
  };
  return structuredClone({
    name: player.name, money: player.money, octane: player.octane, stamps: player.stamps, strip,
    inventory: player.inventory.filter(c => !isRental(c)),
  });
}

export function linkGuest(accounts: Record<string, Account>, id: Identity, guest: Player, now: number): { account: Account; replaced: boolean } {
  const existing = findAccount(accounts, id);
  if (existing) return { account: existing, replaced: true };
  const rand = Array.from({ length: 4 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  const account: Account = { id: 'acct-' + now.toString(36) + '-' + rand, identities: [id], player: saveRecord(guest), createdAt: now };
  accounts[account.id] = account;
  return { account, replaced: false };
}

export function applyRecord(player: Player, rec: SavedPlayer): void {
  player.name = rec.name;
  player.money = rec.money;
  player.octane = rec.octane;
  player.stamps = rec.stamps;
  player.strip = rec.strip ?? freshStrip();
  player.inventory = rec.inventory;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function claimAllowance(account: Account, now: number): { ok: true; amount: number } | { ok: false; reason: 'Allowance already collected today' } {
  const day = utcDay(now);
  if (account.lastAllowance === day) return { ok: false, reason: 'Allowance already collected today' };
  account.lastAllowance = day;
  account.player.money += ALLOWANCE;
  return { ok: true, amount: ALLOWANCE };
}

export function attachAccount(accountId: string, live: Iterable<Player>): { ok: true } | { ok: false; reason: 'already signed in' } {
  for (const p of live) if (p.accountId === accountId) return { ok: false, reason: 'already signed in' };
  return { ok: true };
}

/** The id of the live player holding `accountId`, if any (excluding `exceptId`). */
export function liveHolder(accountId: string, players: Record<string, Player>, exceptId?: string): string | undefined {
  return Object.keys(players).find(id => id !== exceptId && players[id].accountId === accountId);
}

export function bootState<T extends { players: Record<string, unknown>; accounts?: Record<string, Account> }>(state: T): T {
  return { ...state, players: {}, accounts: state.accounts ?? {} };
}

// --- Email sign-in rate limits: every send costs a real email ------------------
export const LINK_WINDOW_MS = 3600_000;
export const LINK_GLOBAL_PER_WINDOW = 30;
export const LINK_IP_PER_WINDOW = 3;
export const LINK_BUSY = 'Email sign-in is busy — try Google or try again later';
export const LINK_IP_BUSY = 'Too many sign-in emails from here — try Google or try again later';
export type SendLog = { all: number[]; byIp: Map<string, number[]> };
export const newSendLog = (): SendLog => ({ all: [], byIp: new Map() });

/** Drops sends older than the rolling window. */
export function pruneSendLog(log: SendLog, now: number): void {
  log.all = log.all.filter(t => now - t < LINK_WINDOW_MS);
  for (const [ip, ts] of log.byIp) {
    const keep = ts.filter(t => now - t < LINK_WINDOW_MS);
    if (keep.length) log.byIp.set(ip, keep); else log.byIp.delete(ip);
  }
}

/** One more email from `ip`, if the rolling hour allows it (30 in all, 3 per address); counted only when allowed. */
export function allowSend(log: SendLog, ip: string, now: number): { ok: true } | { ok: false; reason: typeof LINK_BUSY | typeof LINK_IP_BUSY } {
  pruneSendLog(log, now);
  if (log.all.length >= LINK_GLOBAL_PER_WINDOW) return { ok: false, reason: LINK_BUSY };
  const mine = log.byIp.get(ip) ?? [];
  if (mine.length >= LINK_IP_PER_WINDOW) return { ok: false, reason: LINK_IP_BUSY };
  log.all.push(now);
  mine.push(now);
  log.byIp.set(ip, mine);
  return { ok: true };
}

/** The client's address: the first hop of x-forwarded-for (Render's proxy sets it), else the socket's own. */
export function clientIp(headers: Record<string, unknown>, address: string | undefined): string {
  const fwd = headers['x-forwarded-for'];
  // the LAST hop: the one the hosting proxy (Render) appends, which a client cannot forge; earlier hops are client-supplied
  const hops = (Array.isArray(fwd) ? fwd.join(',') : typeof fwd === 'string' ? fwd : '').split(',').map(h => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || address || 'unknown';
}
