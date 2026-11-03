// A car on the lot, as a dealer describes it for a window sticker. The whole record
// travels inside the QR code's URL (no server), so keys are short and the feature
// list is stored as numbers into FEATURES. Append to FEATURES; never reorder it.
import { BODY_STYLES, REGIONS, type Region } from '../engine/data';
import { findModel } from '../engine/models';
import { prefillMsrp } from '../engine/prefill';
import { stickerFor } from '../engine/stickers';
import { defaults, parse, type FormState } from '../urlState';
import type { Inputs } from '../engine/valuation';

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
};

export const DEFAULT_WARRANTY = 'Sold as described on the Buyers Guide displayed with this vehicle.';

export function emptyRecord(now = new Date()): CarRecord {
  const year = now.getFullYear() - 4;
  return {
    year, make: 'Honda', model: 'Civic', modelText: '', trim: 'EX', body: 'Sedan', mileage: 48000, price: 19500, msrp: null,
    exterior: '', interior: '', vin: '', stock: '', condition: 'Good', title: 'Clean', accident: 'None',
    features: [0, 8, 10, 22], notes: '', warranty: DEFAULT_WARRANTY,
    dealer: { name: '', phone: '', address: '', web: '' }, region: 'Southeast', zip: '',
    showValue: true, showForecast: true,
  };
}

export const displayModel = (r: CarRecord) => r.model || r.modelText || r.body;
export const carName = (r: CarRecord) => `${r.year} ${r.make} ${displayModel(r)}${r.trim ? ` ${r.trim}` : ''}`;

// ---- URL encoding -----------------------------------------------------------------------

type Wire = Record<string, unknown>;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback;
};

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Compact, URL-safe text that holds the whole record (typically 300-500 characters). */
export function encodeRecord(r: CarRecord): string {
  const w: Wire = { v: 1, y: r.year, mk: r.make, md: r.model, t: r.trim, b: r.body, mi: r.mileage, p: r.price };
  if (!r.model && r.modelText) w.mt = r.modelText;
  if (r.msrp) w.ms = r.msrp;
  for (const [k, v] of [['xc', r.exterior], ['ic', r.interior], ['vin', r.vin], ['st', r.stock], ['n', r.notes], ['z', r.zip]] as const) if (v) w[k] = v;
  if (r.condition !== 'Good') w.cn = r.condition;
  if (r.title !== 'Clean') w.tt = r.title;
  if (r.accident !== 'None') w.ac = r.accident;
  if (r.region !== 'Southeast') w.r = r.region;
  if (r.features.length) w.f = [...r.features].sort((a, b) => a - b);
  if (r.warranty !== DEFAULT_WARRANTY) w.w = r.warranty;
  const d: Wire = {};
  for (const [k, v] of [['n', r.dealer.name], ['ph', r.dealer.phone], ['a', r.dealer.address], ['u', r.dealer.web]] as const) if (v) d[k] = v;
  if (Object.keys(d).length) w.d = d;
  if (!r.showValue) w.hv = 1;
  if (!r.showForecast) w.hf = 1;
  return toBase64Url(new TextEncoder().encode(JSON.stringify(w)));
}

/** Rebuild a record from the URL text; every field is checked and clipped. Returns null if unreadable. */
export function decodeRecord(code: string): CarRecord | null {
  let w: Wire;
  try { w = JSON.parse(new TextDecoder().decode(fromBase64Url(code.trim()))); } catch { return null; }
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
    showValue: !w.hv, showForecast: !w.hf,
  };
}

// ---- Routes -----------------------------------------------------------------------------

function siteRoot(): string {
  try { return `${window.location.origin}${window.location.pathname}`; } catch { return ''; }
}
export const carPageUrl = (code: string) => `${siteRoot()}#/car/${code}`;
export const stickerPageUrl = (code?: string) => `${siteRoot()}#/sticker${code ? `/${code}` : ''}`;
export const calculatorUrl = () => siteRoot();

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
