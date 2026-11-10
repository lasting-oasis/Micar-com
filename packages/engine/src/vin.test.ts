import { describe, expect, it } from 'vitest';
import { checkVin, maskVin, normalizeVin, vinMatchesYear } from './vin';

describe('the VIN', () => {
  it('passes real, well-known VINs', () => {
    expect(checkVin('1M8GDM9AXKP042788')).toEqual({ format: 'standard', checkDigit: 'valid', modelYears: [1989, 2019] });
    expect(checkVin('11111111111111111')).toEqual({ format: 'standard', checkDigit: 'valid', modelYears: [2001, 2031] });
    expect(checkVin('5GZCZ43D13S812715').checkDigit).toBe('valid');
    expect(checkVin('JHMCM56557C404453').checkDigit).toBe('valid');
  });

  it('catches a single wrong character', () => {
    expect(checkVin('1M8GDM9AXKP042789').checkDigit).toBe('invalid');
    expect(checkVin('1M8GDM9A1KP042788').checkDigit).toBe('invalid');
    expect(checkVin('2M8GDM9AXKP042788').checkDigit).toBe('invalid');
  });

  it('never accepts I, O or Q, or the wrong length, as a standard VIN', () => {
    expect(checkVin('1M8GDM9AXKP04278I').format).toBe('invalid');
    expect(checkVin('1M8GDM9AXKPO42788').format).toBe('invalid');
    expect(checkVin('1M8GDM9AXKPQ42788').format).toBe('invalid');
    expect(checkVin('1M8GDM9AXKP0427888').format).toBe('invalid');
    expect(checkVin('').format).toBe('invalid');
    expect(checkVin('abc').format).toBe('invalid');
    expect(checkVin('1M8GDM9AX KP04!788').format).toBe('invalid');
  });

  it('takes a shorter number as a pre-1981 VIN, with no check digit and no year', () => {
    expect(checkVin('9F02R123456')).toEqual({ format: 'pre-1981', checkDigit: 'not-applicable', modelYears: [] });
    expect(checkVin('12345')).toEqual({ format: 'pre-1981', checkDigit: 'not-applicable', modelYears: [] });
    expect(checkVin('1234').format).toBe('invalid');
  });

  it('reads the model year on its thirty-year cycle', () => {
    const at = (code: string) => checkVin(`1M8GDM9A0${code}P042788`).modelYears;
    expect(at('A')).toEqual([1980, 2010]);
    expect(at('Y')).toEqual([2000, 2030]);
    expect(at('1')).toEqual([2001, 2031]);
    expect(at('9')).toEqual([2009, 2039]);
    expect(at('R')).toEqual([1994, 2024]);
    // U, Z and 0 are VIN characters but never year codes.
    expect(at('U')).toEqual([]);
    expect(at('Z')).toEqual([]);
    expect(at('0')).toEqual([]);
  });

  it('says whether a VIN agrees with a model year, or that it cannot say', () => {
    expect(vinMatchesYear('1M8GDM9AXKP042788', 2019)).toBe(true);
    expect(vinMatchesYear('1M8GDM9AXKP042788', 1989)).toBe(true);
    expect(vinMatchesYear('1M8GDM9AXKP042788', 2020)).toBe(false);
    expect(vinMatchesYear('9F02R123456', 1969)).toBeNull();
    expect(vinMatchesYear('', 2019)).toBeNull();
    expect(vinMatchesYear('1M8GDM9A0ZP042788', 2019)).toBeNull();
  });

  it('normalises what was typed and masks all but the last four', () => {
    expect(normalizeVin(' 1m8gd-m9ax kp042788 ')).toBe('1M8GDM9AXKP042788');
    expect(normalizeVin(42 as unknown as string)).toBe('');
    expect(maskVin('1M8GDM9AXKP042788')).toBe('•••••••••••••2788');
    expect(maskVin('1m8gdm9axkp042788')).toBe('•••••••••••••2788');
    expect(maskVin('1234')).toBe('••••');
    expect(maskVin('')).toBe('');
  });
});
