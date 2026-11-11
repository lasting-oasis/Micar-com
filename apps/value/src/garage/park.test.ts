import { describe, expect, it } from 'vitest';
import { VIN_NOTES, vinNote } from './Park';

const VIN = '1M8GDM9AXKP042788'; // a well-known valid VIN; the K in position 10 is model year 1989 or 2019

describe('what the page says about a VIN as it is typed', () => {
  it('asks for nothing: a VIN is optional and private', () => {
    expect(vinNote('', 2019)).toEqual({ text: VIN_NOTES[0], tone: 'help' });
    expect(vinNote('   ', 2019).tone).toBe('help');
  });

  it('accepts a well-formed VIN for its model year, however it is typed', () => {
    expect(vinNote(VIN, 2019)).toEqual({ text: 'Well formed.', tone: 'ok' });
    expect(vinNote(VIN, 1989).tone).toBe('ok');
    expect(vinNote('1m8gd-m9ax kp042788', 2019).tone).toBe('ok');
  });

  it('warns about a typo, the wrong year and characters a VIN never has', () => {
    expect(vinNote('1M8GDM9AXKP042789', 2019)).toEqual({ text: 'The check digit does not match. Look for a typo.', tone: 'warn' });
    expect(vinNote(VIN, 2024)).toEqual({ text: 'This VIN is coded for another model year.', tone: 'warn' });
    expect(vinNote('1M8GDM9AXKP04278O', 2019).tone).toBe('warn');
  });

  it('takes a short VIN only for a vehicle from before the 17-character standard', () => {
    expect(vinNote('1M8GDM9AXKP04278', 1975)).toEqual({ text: 'Shorter than 17 characters: accepted for a vehicle built before 1981.', tone: 'help' });
    expect(vinNote('1M8GDM9AXKP04278', 2019)).toEqual({ text: 'A vehicle from 1981 or later has a VIN of 17 characters. This one is shorter.', tone: 'warn' });
    expect(vinNote('1M8GDM9AXKP04278', 1981).tone).toBe('warn');
  });

  it('says only things the Spanish table knows', () => {
    const said = [vinNote('', 2019), vinNote(VIN, 2019), vinNote('1M8GDM9AXKP042789', 2019), vinNote(VIN, 2024), vinNote('1M8GDM9AXKP04278O', 2019), vinNote('ABCDE', 1975), vinNote('ABCDE', 2019)].map((n) => n.text);
    for (const text of said) expect(VIN_NOTES as readonly string[]).toContain(text);
    expect(new Set(said).size).toBe(VIN_NOTES.length);
  });
});

describe('when the parking sheet starts again', () => {
  it('starts again for a new trim or body whenever catalogue figures are on the sheet, whichever fill came last', async () => {
    const { NO_FILLS, fillsAfter, startsOver } = await import('./Park');
    const catalogue = fillsAfter(NO_FILLS, 'catalogue');
    expect(startsOver(catalogue, 'trim')).toBe(true);
    expect(startsOver(catalogue, 'body')).toBe(true);
    // The catalogue's figures are still there after an EPA pick is laid over them. The form used to remember only the
    // last fill, so a new trim kept the other trim's figures and the sources named beside them.
    const both = fillsAfter(catalogue, 'epa');
    expect(both).toEqual({ catalogue: true, epa: true });
    for (const change of ['trim', 'body', 'make', 'model', 'year'] as const) expect(startsOver(both, change), change).toBe(true);
  });

  it('keeps the EPA’s figures through a new trim or body, and nothing through a new make, model or year', async () => {
    const { NO_FILLS, fillsAfter, startsOver } = await import('./Park');
    const epa = fillsAfter(NO_FILLS, 'epa');
    // The EPA's record is for the model and the year, whatever the trim.
    expect(startsOver(epa, 'trim')).toBe(false);
    expect(startsOver(epa, 'body')).toBe(false);
    for (const change of ['make', 'model', 'year'] as const) expect(startsOver(epa, change), change).toBe(true);
    // A catalogue fill replaces the whole sheet, the EPA's fields with it.
    expect(fillsAfter(epa, 'catalogue')).toEqual({ catalogue: true, epa: false });
    // A sheet the owner typed alone is theirs whatever the car is called.
    for (const change of ['trim', 'body', 'make', 'model', 'year'] as const) expect(startsOver(NO_FILLS, change), change).toBe(false);
  });
});

describe('what the form says about an odometer reading before it is written', () => {
  const LOG = [{ date: '2024-03-01', mileage: 30000 }, { date: '2026-06-01', mileage: 50000 }];
  const TODAY = '2026-11-10';

  it('says nothing about an ordinary reading, or when there is nothing to compare with', async () => {
    const { odometerNote } = await import('./PassportPanel');
    expect(odometerNote('51000', TODAY, LOG, TODAY)).toBe('');
    expect(odometerNote('50000', TODAY, LOG, TODAY)).toBe('');
    expect(odometerNote('', TODAY, LOG, TODAY)).toBe('');
    expect(odometerNote('abc', TODAY, LOG, TODAY)).toBe('');
    expect(odometerNote('500000', TODAY, [], TODAY)).toBe('');
    expect(odometerNote('80000', TODAY, LOG, TODAY)).toBe('');
  });

  it('says exactly when a rollback would be recorded, going by the day the entry is dated', async () => {
    const { ODOMETER_NOTES, odometerNote } = await import('./PassportPanel');
    // Lower than a reading from an earlier day.
    expect(odometerNote('49999', TODAY, LOG, TODAY)).toBe(ODOMETER_NOTES[0]);
    expect(odometerNote('29000', '2025-01-01', LOG, TODAY)).toBe(ODOMETER_NOTES[0]);
    // An old receipt that shows fewer miles than the car has now is not a rollback, and the form does not say it is.
    expect(odometerNote('40000', '2025-01-01', LOG, TODAY)).toBe('');
    expect(odometerNote('20000', '2023-01-01', LOG, TODAY)).toBe('');
    // A second reading for a day already on the log is compared with the other days, not with its own.
    expect(odometerNote('49000', '2026-06-01', LOG, TODAY)).toBe('');
    expect(odometerNote('29000', '2026-06-01', LOG, TODAY)).toBe(ODOMETER_NOTES[0]);
    // A back-dated reading higher than one from a later day is the same contradiction the other way round.
    expect(odometerNote('60000', '2025-01-01', LOG, TODAY)).toBe(ODOMETER_NOTES[2]);
    expect(odometerNote('31000', '2023-01-01', LOG, TODAY)).toBe(ODOMETER_NOTES[2]);
    // A slipped digit: a long way above everything so far.
    expect(odometerNote('500000', TODAY, LOG, TODAY)).toBe(ODOMETER_NOTES[1]);
    expect(odometerNote('80001', TODAY, LOG, TODAY)).toBe(ODOMETER_NOTES[1]);
  });

  it('does not warn a buyer whose day is behind the seller’s about a reading dated today', async () => {
    const { ODOMETER_NOTES, odometerNote } = await import('./PassportPanel');
    // The seller's last reading is dated the 11th; on the buyer's device it is still the 10th.
    const ahead = [...LOG, { date: '2026-11-11', mileage: 90000 }];
    expect(odometerNote('90012', TODAY, ahead, TODAY)).toBe('');
    // A back-dated one that contradicts it is still warned of, and so is one lower than an earlier day's.
    expect(odometerNote('95000', '2026-11-09', ahead, TODAY)).toBe(ODOMETER_NOTES[2]);
    expect(odometerNote('40000', TODAY, ahead, TODAY)).toBe(ODOMETER_NOTES[0]);
  });

  it('agrees with the engine about every reading it warns of, and every one it lets by', async () => {
    const { ODOMETER_NOTES, odometerNote, readingsInView } = await import('./PassportPanel');
    const { EMPTY_REGISTRY, addEvent, createPassport, micarIdFromBytes, mileageLog, emptySpec } = await import('@micar/engine');
    const micarId = micarIdFromBytes([1, 2, 3, 4, 5, 6, 7, 8]);
    if (!micarId.ok) throw new Error(micarId.reason);
    const made = createPassport({ micarId: micarId.value, now: '2024-01-01T09:00:00.000Z', ownerId: 'owner-one', spec: emptySpec({ year: 2019, make: 'Honda', model: 'Civic', trim: '', bodyClass: 'sedan' }), eventId: 'e0' });
    if (!made.ok) throw new Error(made.reason);
    let n = 0;
    const write = (passport: typeof made.value, date: string, mileage: number, now: string) => {
      const added = addEvent(passport, { id: `e${++n}`, type: 'mileage', date, mileage, title: '', note: '', attachments: [], visibility: 'private' }, { now, by: 'owner-one' });
      if (!added.ok) throw new Error(added.reason);
      return added.value;
    };
    const plain = write(write(made.value, '2024-03-01', 30000, '2024-03-01T09:00:00.000Z'), '2026-06-01', 50000, '2026-06-01T09:00:00.000Z');
    // The same passport after a previous owner, whose calendar was a day ahead, logged a reading dated tomorrow.
    const ahead = write(plain, '2026-11-11', 60000, '2026-11-11T00:30:00.000Z');
    let checked = 0;
    for (const [passport, lastDay] of [[plain, TODAY], [ahead, '2026-11-11']] as const) {
      const readings = readingsInView(passport, TODAY);
      expect(readings.length).toBe(passport === plain ? 2 : 3);
      expect(mileageLog(passport, EMPTY_REGISTRY, lastDay).rollback).toBe(false);
      for (const date of ['2023-01-01', '2024-03-01', '2025-01-01', '2026-06-01', '2026-11-09', TODAY]) {
        for (const miles of [1000, 29999, 30000, 30001, 40000, 49999, 50000, 50001, 59999, 60001, 70000]) {
          const said = odometerNote(String(miles), date, readings, TODAY);
          // Written now, on this device's today; judged once every entry on the passport is in view.
          const after = mileageLog(write(passport, date, miles, `${TODAY}T12:00:00.000Z`), EMPTY_REGISTRY, lastDay);
          expect(said === ODOMETER_NOTES[0] || said === ODOMETER_NOTES[2], `${passport === plain ? 'plain' : 'ahead'} ${date} ${miles}`).toBe(after.rollback);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(132);
  });
});

describe('the page’s clock', () => {
  it('writes the local time to the millisecond, in the one form the engine reads', async () => {
    const { stamp, today } = await import('./ids');
    const { isIsoTimestamp } = await import('@micar/engine');
    const at = new Date(2026, 10, 11, 9, 5, 7, 42);
    expect(stamp(at)).toBe('2026-11-11T09:05:07.042Z');
    expect(isIsoTimestamp(stamp(at))).toBe(true);
    expect(today(at)).toBe('2026-11-11');
    // Two entries written a few milliseconds apart are told apart, so the later one is the later one.
    expect(stamp(new Date(2026, 10, 11, 9, 5, 7, 43)) > stamp(at)).toBe(true);
  });
});
