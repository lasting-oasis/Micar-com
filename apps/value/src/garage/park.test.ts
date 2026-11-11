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

describe('what the form says about an odometer reading before it is written', () => {
  it('says nothing about an ordinary reading, or when there is nothing to compare with', async () => {
    const { ODOMETER_NOTES, odometerNote } = await import('./PassportPanel');
    expect(odometerNote('51000', 50000)).toBe('');
    expect(odometerNote('50000', 50000)).toBe('');
    expect(odometerNote('', 50000)).toBe('');
    expect(odometerNote('500000', null)).toBe('');
    expect(odometerNote('abc', 50000)).toBe('');
    // A slipped digit, and a reading below the highest on the log.
    expect(odometerNote('500000', 50000)).toBe(ODOMETER_NOTES[1]);
    expect(odometerNote('80001', 50000)).toBe(ODOMETER_NOTES[1]);
    expect(odometerNote('80000', 50000)).toBe('');
    expect(odometerNote('49999', 50000)).toBe(ODOMETER_NOTES[0]);
  });
});
