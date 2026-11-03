import { describe, expect, it } from 'vitest';
import { decodeRecord, emptyRecord, encodeRecord, recordInputs, recordMsrp, type CarRecord } from './record';
import { snapshot } from './value';

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
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(600);
    const back = decodeRecord(code)!;
    expect(back).toEqual({ ...car, features: [0, 8, 14, 22] });
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
    const typed = recordInputs({ ...car, make: 'Other', model: '', msrp: 30000 }, now)!;
    expect(typed.msrp).toBe(30000);
    expect(recordInputs({ ...car, make: 'Other', model: '', msrp: null }, now)).toBeNull();
  });
});
