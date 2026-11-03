import { describe, expect, it } from 'vitest';
import { decodeRecord, emptyRecord, encodeRecord, recordInputs, recordMsrp, type CarRecord } from './record';
import { retention, snapshot } from './value';

const car: CarRecord = {
  ...emptyRecord(new Date('2026-11-03')),
  year: 2019, make: 'Honda', model: 'Civic', trim: 'EX', body: 'Sedan', mileage: 48210, price: 19995, msrp: null,
  exterior: 'Aegean Blue', interior: 'Black cloth', vin: '2HGFC2F7XKH123456', stock: 'P1234',
  condition: 'Good', title: 'Clean', accident: 'None', features: [8, 0, 22, 14], notes: 'One owner.',
  dealer: { name: 'Queen City Motors', phone: '(704) 555-0100', address: '123 Main St, Charlotte, NC', web: 'qcmotors.example' },
};

describe('car record', () => {
  it('round-trips through the URL code and stays short enough for a QR code', () => {
    const code = encodeRecord(car);
    expect(code).toMatch(/^[0-9A-Z$*+\-./:]+$/); // QR alphanumeric set, minus space and %
    expect(code.length).toBeLessThan(330);
    const back = decodeRecord(code)!;
    expect(back).toEqual({ ...car, features: [0, 8, 14, 22] });
    // scanner apps may lower-case or percent-encode the fragment
    expect(decodeRecord(code.toLowerCase())).toEqual(back);
    expect(decodeRecord(encodeURIComponent(code))).toEqual(back);
  });

  it('keeps every field through the code, including the optional ones', () => {
    const full: CarRecord = { ...car, model: '', modelText: 'Crosstour', msrp: 27755, warranty: 'Limited 3-month powertrain warranty', zip: '28202',
      condition: 'Fair', title: 'Rebuilt', accident: 'Minor', region: 'West', showValue: false, showForecast: false, features: [0, 39], notes: 'Ñ unicode works, too.' };
    expect(decodeRecord(encodeRecord(full))).toEqual(full);
    // a sheet printed in Spanish opens its car page in Spanish
    expect(decodeRecord(encodeRecord({ ...car, lang: 'es' }))!.lang).toBe('es');
    expect(decodeRecord(encodeRecord(car))!.lang).toBe('en');
  });

  it('still reads the codes on sheets printed before the packed format', () => {
    const v1 = 'eyJ2IjoxLCJ5IjoyMDE5LCJtayI6IkhvbmRhIiwibWQiOiJDaXZpYyIsInQiOiJFWCIsImIiOiJTZWRhbiIsIm1pIjo0ODIxMCwicCI6MTk5OTUsInhjIjoiQWVnZWFuIEJsdWUiLCJpYyI6IkJsYWNrIGNsb3RoIiwidmluIjoiMkhHRkMyRjdYS0gxMjM0NTYiLCJzdCI6IlAxMjM0IiwibiI6Ik9uZSBvd25lciwgc2VydmljZWQgaGVyZSBzaW5jZSBuZXcuIFNlY29uZCBrZXkgYW5kIGFsbC13ZWF0aGVyIG1hdHMgaW5jbHVkZWQuIiwiZiI6WzAsMSwzLDQsOCwxMCwxNCwxOSwyMiwyMywzMiwzMywzNCwzNl0sImQiOnsibiI6IlF1ZWVuIENpdHkgTW90b3JzIiwicGgiOiIoNzA0KSA1NTUtMDEwMCIsImEiOiIxMjMgTWFpbiBTdCwgQ2hhcmxvdHRlLCBOQyAyODIwMiIsInUiOiJxdWVlbmNpdHltb3RvcnMuZXhhbXBsZSJ9fQ';
    const r = decodeRecord(v1)!;
    expect(r).toMatchObject({ year: 2019, make: 'Honda', model: 'Civic', trim: 'EX', mileage: 48210, price: 19995, vin: '2HGFC2F7XKH123456', stock: 'P1234' });
    expect(r.features).toEqual([0, 1, 3, 4, 8, 10, 14, 19, 22, 23, 32, 33, 34, 36]);
    expect(r.dealer.name).toBe('Queen City Motors');
  });

  it('rejects junk and clips oversized fields', () => {
    expect(decodeRecord('not-a-record')).toBeNull();
    expect(decodeRecord('')).toBeNull();
    const long = decodeRecord(encodeRecord({ ...car, notes: 'x'.repeat(2000), features: [0, 999] }))!;
    expect(long.notes.length).toBe(400);
    expect(long.features).toEqual([0]);
  });

  it('values the car from the sticker on file, or from the dealer\'s MSRP', () => {
    const now = new Date('2026-11-03');
    expect(recordMsrp(car)).toMatchObject({ msrp: 23400, source: 'sticker' });
    const snap = snapshot(car, now)!;
    expect(snap.val.privateParty).toBeGreaterThan(10000);
    expect(snap.val.privateParty).toBeLessThan(23400);
    expect(snap.curve).toHaveLength(6);
    expect(['below', 'within', 'above']).toContain(snap.verdict.kind);
    expect(['great', 'good', 'fair', 'above', 'high']).toContain(snap.verdict.tier);
    expect(snapshot({ ...car, price: Math.round(snap.val.dealerRetail * 0.85) }, now)!.verdict).toMatchObject({ tier: 'great', label: 'Great deal', kind: 'below' });
    expect(snapshot({ ...car, price: Math.round(snap.val.dealerRetail * 1.15) }, now)!.verdict).toMatchObject({ tier: 'high', label: 'High price', kind: 'above' });
    expect(snapshot({ ...car, price: 0 }, now)!.verdict.tier).toBe('none');
    const typed = recordInputs({ ...car, make: 'Other', model: '', msrp: 30000 }, now)!;
    expect(typed.msrp).toBe(30000);
    expect(recordInputs({ ...car, make: 'Other', model: '', msrp: null }, now)).toBeNull();
  });

  it('rates how the model holds value against its body style', () => {
    const civic = retention(car);
    expect(civic).toMatchObject({ rated: true, makeLevel: false, body: 'Sedan', modelLabel: '2019 Civic', kind: 'better', calibrated: true });
    expect(civic.own).toBeGreaterThan(civic.typical);
    expect(civic.percentile).toBeGreaterThan(0.8);
    expect(civic.stars).toBeGreaterThanOrEqual(4);
    // an EPA-only model is rated at make level, and says so
    const crosstour = retention({ ...car, model: 'Crosstour', body: 'SUV / Crossover' });
    expect(crosstour).toMatchObject({ rated: true, makeLevel: true, make: 'Honda', body: 'SUV / Crossover' });
    // a car we don't list at all gets only the typical figure
    expect(retention({ ...car, make: 'Other', model: '', modelText: 'Kit car' })).toMatchObject({ rated: false });
    for (const r of [civic, crosstour]) { expect(r.stars).toBeGreaterThanOrEqual(1); expect(r.stars).toBeLessThanOrEqual(5); }
  });
});
