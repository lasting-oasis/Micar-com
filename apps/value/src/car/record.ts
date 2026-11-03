// A car on the lot, as a dealer describes it for a window sticker. The whole record
// travels inside the QR code's URL (no server), so it is packed as bytes and written
// in the QR alphanumeric character set, which a QR code stores in 5.5 bits per
// character instead of 8. Features are stored as a bitmask over FEATURES, and the
// option lists below by position: append to them; never reorder.
import { ACCIDENTS, BODY_STYLES, CONDITIONS, REGIONS, TITLES, type Region } from '../engine/data';
import { findModel } from '../engine/models';
import { prefillMsrp } from '../engine/prefill';
import { stickerFor } from '../engine/stickers';
import { defaults, parse, type FormState } from '../urlState';
import type { Inputs } from '../engine/valuation';
import { t, type Lang } from '../i18n';

export const FEATURES: { id: number; label: string; group: 'Safety & driver aids' | 'Comfort & convenience' | 'Tech & audio' | 'Capability' | 'Condition & history' }[] = [
  { id: 0, label: 'Backup camera', group: 'Safety & driver aids' },
  { id: 1, label: 'Blind-spot monitor', group: 'Safety & driver aids' },
  { id: 2, label: 'Adaptive cruise control', group: 'Safety & driver aids' },
  { id: 3, label: 'Lane-keeping assist', group: 'Safety & driver aids' },
  { id: 4, label: 'Automatic emergency braking', group: 'Safety & driver aids' },
  { id: 5, label: 'Parking sensors', group: 'Safety & driver aids' },
  { id: 6, label: '360° camera', group: 'Safety & driver aids' },
  { id: 7, label: 'LED headlights', group: 'Safety & driver aids' },
  { id: 8, label: 'Apple CarPlay / Android Auto', group: 'Tech & audio' },
  { id: 9, label: 'Navigation', group: 'Tech & audio' },
  { id: 10, label: 'Bluetooth', group: 'Tech & audio' },
  { id: 11, label: 'Premium audio', group: 'Tech & audio' },
  { id: 12, label: 'Wireless charging', group: 'Tech & audio' },
  { id: 13, label: 'Head-up display', group: 'Tech & audio' },
  { id: 14, label: 'Heated seats', group: 'Comfort & convenience' },
  { id: 15, label: 'Ventilated seats', group: 'Comfort & convenience' },
  { id: 16, label: 'Leather seats', group: 'Comfort & convenience' },
  { id: 17, label: 'Power seats', group: 'Comfort & convenience' },
  { id: 18, label: 'Heated steering wheel', group: 'Comfort & convenience' },
  { id: 19, label: 'Sunroof / moonroof', group: 'Comfort & convenience' },
  { id: 20, label: 'Panoramic roof', group: 'Comfort & convenience' },
  { id: 21, label: 'Remote start', group: 'Comfort & convenience' },
  { id: 22, label: 'Keyless entry & push-button start', group: 'Comfort & convenience' },
  { id: 23, label: 'Dual-zone climate control', group: 'Comfort & convenience' },
  { id: 24, label: 'Power liftgate', group: 'Comfort & convenience' },
  { id: 25, label: 'Third-row seating', group: 'Capability' },
  { id: 26, label: 'All-wheel drive / 4WD', group: 'Capability' },
  { id: 27, label: 'Tow package', group: 'Capability' },
  { id: 28, label: 'Roof rack', group: 'Capability' },
  { id: 29, label: 'Bed liner', group: 'Capability' },
  { id: 30, label: 'Running boards', group: 'Capability' },
  { id: 31, label: 'Alloy wheels', group: 'Capability' },
  { id: 32, label: 'One owner', group: 'Condition & history' },
  { id: 33, label: 'No accidents reported', group: 'Condition & history' },
  { id: 34, label: 'Service records available', group: 'Condition & history' },
  { id: 35, label: 'Non-smoker', group: 'Condition & history' },
  { id: 36, label: 'New tires', group: 'Condition & history' },
  { id: 37, label: 'New brakes', group: 'Condition & history' },
  { id: 38, label: 'Remaining factory warranty', group: 'Condition & history' },
  { id: 39, label: 'Spare key included', group: 'Condition & history' },
];
export const FEATURE_GROUPS = ['Safety & driver aids', 'Comfort & convenience', 'Tech & audio', 'Capability', 'Condition & history'] as const;

export type Dealer = { name: string; phone: string; address: string; web: string };
export type CarRecord = {
  year: number; make: string;
  /** Model as listed on the site, or '' when not listed. */
  model: string;
  /** Free-text model name shown when `model` is '' (not listed). */
  modelText: string;
  trim: string; body: string;
  mileage: number; price: number;
  /** Original sticker price typed by the dealer; blank = use the one on file. */
  msrp: number | null;
  exterior: string; interior: string; vin: string; stock: string;
  condition: string; title: string; accident: string;
  features: number[];
  notes: string;
  warranty: string;
  dealer: Dealer;
  region: Region;
  zip: string;
  showValue: boolean;
  showForecast: boolean;
  /** Language the sheet was printed in; the QR opens the car page in it unless the viewer picked one. */
  lang: Lang;
};

export const DEFAULT_WARRANTY = 'Sold as described on the Buyers Guide displayed with this vehicle.';

export function emptyRecord(now = new Date()): CarRecord {
  const year = now.getFullYear() - 4;
  return {
    year, make: 'Honda', model: 'Civic', modelText: '', trim: 'EX', body: 'Sedan', mileage: 48000, price: 19500, msrp: null,
    exterior: '', interior: '', vin: '', stock: '', condition: 'Good', title: 'Clean', accident: 'None',
    features: [0, 8, 10, 22], notes: '', warranty: DEFAULT_WARRANTY,
    dealer: { name: '', phone: '', address: '', web: '' }, region: 'Southeast', zip: '',
    showValue: true, showForecast: true, lang: 'en',
  };
}

export const displayModel = (r: CarRecord) => r.model || r.modelText || t(r.body);
export const carName = (r: CarRecord) => `${r.year} ${r.make} ${displayModel(r)}${r.trim ? ` ${r.trim}` : ''}`;

// ---- URL encoding -----------------------------------------------------------------------

type Wire = Record<string, unknown>;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback;
};

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Version 2 (current): bytes, written with the 43 QR-alphanumeric characters that are safe in
// a URL fragment (no space, no %). Three characters hold two bytes.
const B43 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
const B43_RE = /^[0-9A-Z$*+\-./:]+$/;

function toBase43(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      out += B43[n % 43]; n = Math.floor(n / 43); out += B43[n % 43]; out += B43[Math.floor(n / 43)];
    } else {
      const n = bytes[i];
      out += B43[n % 43] + B43[Math.floor(n / 43)];
    }
  }
  return out;
}
function fromBase43(s: string): Uint8Array | null {
  const vals = [...s].map((c) => B43.indexOf(c));
  if (vals.some((v) => v < 0) || s.length % 3 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += 3) {
    if (i + 2 < vals.length) {
      const n = vals[i] + vals[i + 1] * 43 + vals[i + 2] * 43 * 43;
      if (n > 0xffff) return null;
      out.push(n >> 8, n & 0xff);
    } else {
      const n = vals[i] + vals[i + 1] * 43;
      if (n > 0xff) return null;
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

const F_HIDE_VALUE = 1, F_HIDE_FORECAST = 2, F_MSRP = 4, F_MODEL_TEXT = 8, F_WARRANTY = 16, F_ZIP = 32, F_SPANISH = 64;
const idx = (names: readonly string[], v: string) => Math.max(0, names.indexOf(v));
const BODY_NAMES = BODY_STYLES.map((b) => b.name), COND_NAMES = CONDITIONS.map((c) => c.name), TITLE_NAMES = TITLES.map((t) => t.name), ACC_NAMES = ACCIDENTS.map((a) => a.name);

class Writer {
  bytes: number[] = [];
  u8(n: number) { this.bytes.push(n & 0xff); }
  u24(n: number) { const v = Math.max(0, Math.min(0xffffff, Math.round(n))); this.bytes.push(v >> 16, (v >> 8) & 0xff, v & 0xff); }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    if (b.length < 128) this.u8(b.length); else { this.u8(0x80 | (b.length & 0x7f)); this.u8(b.length >> 7); }
    this.bytes.push(...b);
  }
}
class Reader {
  i = 0;
  b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  get done() { return this.i >= this.b.length; }
  u8() { if (this.i >= this.b.length) throw new Error('short'); return this.b[this.i++]; }
  u24() { return (this.u8() << 16) | (this.u8() << 8) | this.u8(); }
  str() {
    let n = this.u8();
    if (n & 0x80) n = (n & 0x7f) | (this.u8() << 7);
    if (this.i + n > this.b.length) throw new Error('short');
    const s = new TextDecoder().decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }
}

/** Compact, URL-safe text that holds the whole record (typically 200-400 characters). */
export function encodeRecord(r: CarRecord): string {
  const w = new Writer();
  const msrp = r.msrp && r.msrp > 0 ? r.msrp : 0;
  const modelText = !r.model && r.modelText ? r.modelText : '';
  const warranty = r.warranty !== DEFAULT_WARRANTY ? r.warranty : '';
  const zip = /^\d{5}$/.test(r.zip) ? r.zip : '';
  w.u8(2);
  w.u8((r.showValue ? 0 : F_HIDE_VALUE) | (r.showForecast ? 0 : F_HIDE_FORECAST) | (msrp ? F_MSRP : 0) | (modelText ? F_MODEL_TEXT : 0) | (warranty ? F_WARRANTY : 0) | (zip ? F_ZIP : 0) | (r.lang === 'es' ? F_SPANISH : 0));
  w.u8(Math.max(0, Math.min(255, r.year - 1990)));
  w.u8(idx(BODY_NAMES, r.body) | (idx(COND_NAMES, r.condition) << 4));
  w.u8(idx(TITLE_NAMES, r.title) | (idx(ACC_NAMES, r.accident) << 2) | (idx(REGIONS, r.region) << 4));
  w.u24(r.mileage); w.u24(r.price);
  if (msrp) w.u24(msrp);
  const ids = r.features.filter((id) => id >= 0 && id < 2040);
  const nBytes = ids.length ? Math.ceil((Math.max(...ids) + 1) / 8) : 0;
  const mask = new Array<number>(nBytes).fill(0);
  for (const id of ids) mask[id >> 3] |= 1 << (id & 7);
  w.u8(nBytes); for (const m of mask) w.u8(m);
  for (const s of [r.make, r.model, r.trim, r.exterior, r.interior, r.vin, r.stock, r.notes.slice(0, 400), r.dealer.name, r.dealer.phone, r.dealer.address, r.dealer.web]) w.str(s);
  if (modelText) w.str(modelText);
  if (warranty) w.str(warranty.slice(0, 200));
  if (zip) w.u24(Number(zip));
  return toBase43(Uint8Array.from(w.bytes));
}

function decodeV2(bytes: Uint8Array): CarRecord | null {
  try {
    const rd = new Reader(bytes);
    if (rd.u8() !== 2) return null;
    const flags = rd.u8();
    const year = 1990 + rd.u8();
    const bc = rd.u8(), tar = rd.u8();
    const mileage = rd.u24(), price = rd.u24();
    const msrp = flags & F_MSRP ? rd.u24() : 0;
    const nBytes = rd.u8();
    const features: number[] = [];
    for (let i = 0; i < nBytes; i++) { const m = rd.u8(); for (let b = 0; b < 8; b++) if (m & (1 << b)) features.push(i * 8 + b); }
    const [make, model, trim, exterior, interior, vin, stock, notes, dName, dPhone, dAddress, dWeb] = Array.from({ length: 12 }, () => rd.str());
    const modelText = flags & F_MODEL_TEXT ? rd.str() : '';
    const warranty = flags & F_WARRANTY ? rd.str() : '';
    const zip = flags & F_ZIP ? String(rd.u24()).padStart(5, '0') : '';
    if (!make) return null;
    const base = emptyRecord();
    return {
      year: num(year, 1990, new Date().getFullYear() + 1, base.year),
      make: clip(make, 40), model: clip(model, 60), modelText: clip(modelText, 60), trim: clip(trim, 80),
      body: BODY_NAMES[bc & 15] ?? 'Sedan',
      mileage: num(mileage, 0, 600_000, 0), price: num(price, 0, 2_000_000, 0),
      msrp: msrp ? num(msrp, 3000, 1_000_000, 0) || null : null,
      exterior: clip(exterior, 40), interior: clip(interior, 40), vin: clip(vin, 17).toUpperCase(), stock: clip(stock, 20),
      condition: COND_NAMES[bc >> 4] ?? 'Good', title: TITLE_NAMES[tar & 3] ?? 'Clean', accident: ACC_NAMES[(tar >> 2) & 3] ?? 'None',
      features: features.filter((id) => FEATURES.some((f) => f.id === id)),
      notes: clip(notes, 400), warranty: warranty ? clip(warranty, 200) : DEFAULT_WARRANTY,
      dealer: { name: clip(dName, 60), phone: clip(dPhone, 30), address: clip(dAddress, 120), web: clip(dWeb, 80) },
      region: (REGIONS[tar >> 4] as Region | undefined) ?? 'Southeast',
      zip: /^\d{5}$/.test(zip) ? zip : '',
      showValue: !(flags & F_HIDE_VALUE), showForecast: !(flags & F_HIDE_FORECAST),
      lang: flags & F_SPANISH ? 'es' : 'en',
    };
  } catch { return null; }
}

/** Version 1 (sheets printed before Nov 2026): base64url JSON with short keys. Kept so those QR codes still open. */
function decodeV1(code: string): CarRecord | null {
  let w: Wire;
  try { w = JSON.parse(new TextDecoder().decode(fromBase64Url(code))); } catch { return null; }
  if (!w || typeof w !== 'object' || !w.mk) return null;
  const base = emptyRecord();
  const d = (w.d ?? {}) as Wire;
  const body = clip(w.b, 40);
  return {
    year: num(w.y, 1990, new Date().getFullYear() + 1, base.year),
    make: clip(w.mk, 40), model: clip(w.md, 60), modelText: clip(w.mt, 60), trim: clip(w.t, 80),
    body: BODY_STYLES.some((b) => b.name === body) ? body : 'Sedan',
    mileage: num(w.mi, 0, 600_000, 0), price: num(w.p, 0, 2_000_000, 0),
    msrp: w.ms ? num(w.ms, 3000, 1_000_000, 0) || null : null,
    exterior: clip(w.xc, 40), interior: clip(w.ic, 40), vin: clip(w.vin, 17).toUpperCase(), stock: clip(w.st, 20),
    condition: clip(w.cn, 20) || 'Good', title: clip(w.tt, 20) || 'Clean', accident: clip(w.ac, 20) || 'None',
    features: Array.isArray(w.f) ? [...new Set(w.f.map((x) => Number(x)).filter((x) => FEATURES.some((f) => f.id === x)))] : [],
    notes: clip(w.n, 400), warranty: typeof w.w === 'string' ? clip(w.w, 200) : DEFAULT_WARRANTY,
    dealer: { name: clip(d.n, 60), phone: clip(d.ph, 30), address: clip(d.a, 120), web: clip(d.u, 80) },
    region: (REGIONS as readonly string[]).includes(clip(w.r, 20)) ? (clip(w.r, 20) as Region) : 'Southeast',
    zip: /^\d{5}$/.test(clip(w.z, 5)) ? clip(w.z, 5) : '',
    showValue: !w.hv, showForecast: !w.hf, lang: 'en',
  };
}

/** Rebuild a record from the URL text; every field is checked and clipped. Returns null if unreadable. */
export function decodeRecord(code: string): CarRecord | null {
  const c = code.trim();
  if (!c) return null;
  // A scanner app may hand back the fragment percent-encoded or the base43 text lower-cased.
  const up = (() => { try { return decodeURIComponent(c); } catch { return c; } })().toUpperCase();
  if (B43_RE.test(up)) { const bytes = fromBase43(up); const r = bytes && decodeV2(bytes); if (r) return r; }
  return decodeV1(c);
}

// ---- Routes -----------------------------------------------------------------------------

function siteRoot(): string {
  try { return `${window.location.origin}${window.location.pathname}`; } catch { return ''; }
}
export const homeUrl = () => siteRoot();
export const carPageUrl = (code: string) => `${siteRoot()}#/c/${code}`;
export const stickerPageUrl = (code?: string) => `${siteRoot()}#/sticker${code ? `/${code}` : ''}`;
export const calculatorUrl = () => `${siteRoot()}#/value`;

// ---- Engine inputs ----------------------------------------------------------------------

/** The original sticker price used for valuation: the dealer's figure, else the one on file for the trim. */
export function recordMsrp(r: CarRecord): { msrp: number; source: 'dealer' | 'sticker' | 'typical' | 'none'; label: string } {
  if (r.msrp) return { msrp: r.msrp, source: 'dealer', label: 'Entered by the dealer' };
  const p = prefillMsrp(r.make, r.model, r.year, r.trim);
  if (!p) return { msrp: 0, source: 'none', label: '' };
  return { msrp: p.msrp, source: p.source, label: p.label };
}

/** Engine inputs for this car (national market, no local comps), or null when the record can't be valued. */
export function recordInputs(r: CarRecord, now = new Date()): Inputs | null {
  const { msrp } = recordMsrp(r);
  if (!msrp) return null;
  const sticker = stickerFor(r.make, r.model, r.year);
  const trim = sticker ? r.trim : '';
  const form: FormState = {
    ...defaults(now), make: r.make, model: r.model, trim, body: r.body, msrp: String(msrp), year: String(r.year), mileage: String(r.mileage),
    condition: r.condition, title: r.title, accident: r.accident, region: r.region, zip: r.zip, market: 'Auto', listings: '', urgency: 'No rush', comps: '',
  };
  return parse(form, now).inputs;
}

/** Years the EPA lists this model as sold, when known. */
export function soldYears(r: CarRecord): number[] | undefined {
  return findModel(r.make, r.model)?.years;
}
