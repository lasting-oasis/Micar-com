// The VIN: what a 17-character vehicle identification number can say about itself without looking anything up.
// Position 9 is a check digit worked out from the other sixteen, so a typo almost always shows. Position 10 is the
// model year, on a 30-year cycle. Vehicles built before 1981 carry shorter, unstandardised numbers with neither.
// A VIN is private: the passport keeps it and the public view never shows it.

/** The seventeen-character alphabet: digits and capitals, never I, O or Q. */
const STANDARD = /^[0-9A-HJ-NPR-Z]{17}$/;
/** What a number from before 1981 looks like: five to sixteen letters and digits. */
const EARLY = /^[0-9A-Z]{5,16}$/;

const VALUE: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** Model-year codes in order: A is 1980 and 2010, Y is 2000 and 2030, then 1 to 9 for 2001 to 2009 and 2031 to 2039. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/** A VIN as typed, made comparable: upper case, with spaces and dashes removed. */
export function normalizeVin(input: string): string {
  return typeof input === 'string' ? input.toUpperCase().replace(/[\s-]+/g, '') : '';
}

export type VinCheck = {
  /** standard: 17 valid characters. pre-1981: a shorter number, as older vehicles carry. invalid: neither. */
  format: 'standard' | 'pre-1981' | 'invalid';
  checkDigit: 'valid' | 'invalid' | 'not-applicable';
  /** The model years position 10 can mean. Empty when the VIN cannot say. */
  modelYears: number[];
};

/** The check character a standard VIN should carry in position 9. */
function expectedCheck(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const value = ch >= '0' && ch <= '9' ? Number(ch) : VALUE[ch];
    sum += value * WEIGHTS[i];
  }
  const rest = sum % 11;
  return rest === 10 ? 'X' : String(rest);
}

/** What a VIN says about itself. Never throws: anything that is not a VIN is 'invalid'. */
export function checkVin(vin: string): VinCheck {
  const v = normalizeVin(vin);
  if (STANDARD.test(v)) {
    const at = YEAR_CODES.indexOf(v[9]);
    return { format: 'standard', checkDigit: expectedCheck(v) === v[8] ? 'valid' : 'invalid', modelYears: at === -1 ? [] : [1980 + at, 2010 + at] };
  }
  if (EARLY.test(v)) return { format: 'pre-1981', checkDigit: 'not-applicable', modelYears: [] };
  return { format: 'invalid', checkDigit: 'not-applicable', modelYears: [] };
}

/** True when the VIN is coded for that model year, false when it is coded for another, null when the VIN cannot say. */
export function vinMatchesYear(vin: string, year: number): boolean | null {
  const check = checkVin(vin);
  if (check.format !== 'standard' || check.modelYears.length === 0) return null;
  return check.modelYears.indexOf(year) !== -1;
}

/** A VIN for the owner's own screen: every character but the last four as a dot. */
export function maskVin(vin: string): string {
  const v = normalizeVin(vin);
  const keep = v.length > 4 ? 4 : 0;
  return '•'.repeat(v.length - keep) + v.slice(v.length - keep);
}
