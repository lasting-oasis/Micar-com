/* A challenge room's code: six characters a person can read aloud or type from a screenshot. Kept apart from race.ts,
   with no imports, so the page's router can read a link's code without pulling the race rules in with it. */
export const CODE_LEN = 6;
/** No I, L or O and no 0 or 1: nothing in a code is misread for something else. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(rand: () => number): string {
  const n = CODE_ALPHABET.length;
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) { const k = Math.floor(rand() * n); code += CODE_ALPHABET[k >= 0 && k < n ? k : n - 1]; }
  return code;
}

/** A code as people type it (any case, spaces, a dash), or null when it could not be one. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== CODE_LEN) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
