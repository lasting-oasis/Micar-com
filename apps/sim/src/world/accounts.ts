import crypto from 'node:crypto';
import type { Player } from '../types';
import { freshStrip } from './data';
import { isRental } from './rental';

export const ALLOWANCE = 1000;
export const MAGIC_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;

export type Identity = { kind: 'google'; sub: string } | { kind: 'email'; email: string };
export type SavedPlayer = Pick<Player, 'name' | 'money' | 'octane' | 'stamps' | 'strip' | 'inventory'>;
export type Account = { id: string; identities: Identity[]; player: SavedPlayer; lastAllowance?: string; createdAt: number };
export type Jwk = { kid: string; n: string; e: string; [k: string]: unknown };

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const mac = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body).digest();

// token = base64url(`${subject}.${expiresAt}`) + '.' + base64url(HMAC-SHA256)
function sign(subject: string, expiresAt: number, secret: string): string {
  const body = b64(`${subject}.${expiresAt}`);
  return `${body}.${b64(mac(body, secret))}`;
}

function open(token: string, now: number, secret: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 2) return undefined;
  const [body, sig] = parts;
  const want = mac(body, secret);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return undefined;
  const text = Buffer.from(body, 'base64url').toString();
  const dot = text.lastIndexOf('.');
  if (dot < 0) return undefined;
  const expiresAt = Number(text.slice(dot + 1));
  if (!Number.isFinite(expiresAt) || now > expiresAt) return undefined;
  return text.slice(0, dot);
}

export function signMagic(email: string, now: number, secret: string): string {
  return sign(email.toLowerCase(), now + MAGIC_TTL_MS, secret);
}
export function verifyMagic(token: string, now: number, secret: string, used: Set<string>): string | undefined {
  if (used.has(token)) return undefined;
  const email = open(token, now, secret);
  if (email === undefined) return undefined;
  used.add(token);
  return email.toLowerCase();
}

export function signSession(accountId: string, now: number, secret: string): string {
  return sign(accountId, now + SESSION_TTL_MS, secret);
}
export function verifySession(token: string, now: number, secret: string): string | undefined {
  return open(token, now, secret);
}

export function verifyGoogle(idToken: string, clientId: string, keys: Jwk[], now: number): { sub: string; email?: string } | undefined {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
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
  return {
    name: player.name, money: player.money, octane: player.octane, stamps: player.stamps, strip: player.strip,
    inventory: player.inventory.filter(c => !isRental(c)),
  };
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

export function bootState<T extends { players: Record<string, unknown>; accounts?: Record<string, Account> }>(state: T): T {
  return { ...state, players: {}, accounts: state.accounts ?? {} };
}
