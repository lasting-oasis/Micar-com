// The core may use only arithmetic that every engine computes identically (DESIGN.md rule 3). This scans the sources.
// Rule 3 is an allowlist, so the scan is one: every use of Math must be Math.<one of the allowed members>, read off
// the sources' tokens (comments, strings, template literals and regular expressions skipped as a tokenizer skips
// them, not by cutting lines at '//', which would hide the code after a URL in a string). Aliases, destructuring and
// computed access of Math are refused with it, since the scan could not follow them.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** DESIGN.md rule 3: the only Math members allowed under src/ outside tests. */
const ALLOWED_MATH = new Set(['sqrt', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'imul']);
/** Anything that reads the host's clock, locale or global object (a property read off globalThis can be any of them). */
const HOST = new Set(['Date', 'Intl', 'localeCompare', 'globalThis']);

type Token = { kind: 'name' | 'punct' | 'number'; text: string; line: number };

// Keywords after which a '/' starts a regular expression rather than dividing.
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** The code tokens of a TypeScript source: names, numbers and punctuation, with comments and literals left out. */
function tokens(src: string): Token[] {
  const out: Token[] = [];
  const templates: number[] = [];   // brace depth at which each open template's ${ } closes
  let i = 0, line = 1, depth = 0;
  const regexAllowed = (): boolean => {
    const last = out[out.length - 1];
    if (last === undefined) return true;
    if (last.kind === 'number') return false;
    if (last.kind === 'name') return BEFORE_REGEX.has(last.text);
    return !(last.text === ')' || last.text === ']' || last.text === '}');
  };
  // Skips a string or template body from i (just past its opening quote); returns true if a template's ${ opened.
  const skipQuoted = (quote: string): boolean => {
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '\n') line++;
      if (ch === quote) { i++; return false; }
      if (quote === '`' && ch === '$' && src[i + 1] === '{') { i += 2; return true; }
      i++;
    }
    return false;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (ch === '\'' || ch === '"') { i++; skipQuoted(ch); out.push({ kind: 'number', text: 'string', line }); continue; }
    if (ch === '`') { i++; if (skipQuoted('`')) templates.push(++depth); else out.push({ kind: 'number', text: 'template', line }); continue; }
    if (ch === '}' && templates.length > 0 && templates[templates.length - 1] === depth) {
      templates.pop(); depth--; i++;
      if (skipQuoted('`')) templates.push(++depth); else out.push({ kind: 'number', text: 'template', line });
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true; else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < src.length && /[a-z]/i.test(src[i])) i++;   // flags
      out.push({ kind: 'number', text: 'regex', line });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      out.push({ kind: 'name', text: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j])) { if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '-' || src[j + 1] === '+')) j++; j++; }
      out.push({ kind: 'number', text: src.slice(i, j), line });
      i = j;
      continue;
    }
    // Punctuation, longest first where it matters here: '**=', '**', '?.' and the rest one character at a time.
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const text = three === '**=' ? three : two === '**' || two === '?.' ? two : ch;
    if (text === '{') depth++;
    else if (text === '}') depth--;
    out.push({ kind: 'punct', text, line });
    i += text.length;
  }
  return out;
}

/** Every place a source breaks rule 3, as 'line: what'. */
function violations(src: string): string[] {
  const found: string[] = [];
  const t = tokens(src);
  for (let k = 0; k < t.length; k++) {
    const a = t[k], next = t[k + 1], after = t[k + 2];
    if (a.kind === 'punct' && (a.text === '**' || a.text === '**=')) found.push(`${a.line}: the ${a.text} operator`);
    if (a.kind !== 'name') continue;
    // A property of something else (x.Math, x.Date) is not the global.
    const prev = t[k - 1];
    if (prev !== undefined && prev.kind === 'punct' && (prev.text === '.' || prev.text === '?.') && a.text !== 'localeCompare' && !a.text.startsWith('toLocale')) continue;
    if (a.text === 'Math') {
      if (next === undefined || next.text !== '.' || after === undefined || after.kind !== 'name') found.push(`${a.line}: Math used other than as Math.<member>`);
      else if (!ALLOWED_MATH.has(after.text)) found.push(`${a.line}: Math.${after.text}`);
    } else if (HOST.has(a.text) || a.text.startsWith('toLocale')) {
      found.push(`${a.line}: ${a.text}`);
    } else if (a.text === 'performance' && next !== undefined && (next.text === '.' || next.text === '?.')) {
      found.push(`${a.line}: performance.${after !== undefined ? after.text : ''}`);
    }
  }
  return found;
}

describe('the scan itself', () => {
  it('finds every way of reaching a forbidden function, and passes code that keeps to the rule', () => {
    const bad = [
      'const y = Math.sin(x);', 'Math[\'sin\'](x);', 'const { exp } = Math;', 'const M = Math; M.log(x);',
      'const a = Math.atanh(x) + 1;', 'const b = Math.asinh(x);', 'const c = Math.acosh(x);', 'const f = Math.fround(x);',
      'const url = \'https://example.com\'; const y = Math.exp(x);', 'const t = Date.now();', 'globalThis[\'Da\' + \'te\'].now();',
      'const p = x ** 0.5;', 'x **= 2;', 'const n = (1.5).toLocaleString();', 'a.localeCompare(b);', 'const t = performance.now();',
      'const s = `${Math.pow(2, x)}`;', 'const r = /a\\/b/; const y = Math.log(x);', 'const m = Math?.max(1, 2);',
    ];
    for (const line of bad) expect(violations(line), line).not.toEqual([]);
    const good = [
      'const y = Math.sqrt(x) + Math.abs(x) + Math.min(a, b) + Math.max(a, b) + Math.floor(x) + Math.ceil(x);',
      'const z = Math.round(x) + Math.trunc(x) + Math.sign(x) + Math.imul(a, b);',
      '// Math.sin in a comment', '/* Math.exp(x) ** 2 */ const a = 1;', 'const s = \'Math.pow(2, 3) ** Date\';',
      'const t = `Math.exp ${a * b} **`;', 'const r = /\\d**/g;', 'const performance = a > b;', 'const k = 2 * x * y;',
      'model.engine.Date = 1;', 'const v = 1e-9 * 2;',
    ];
    for (const line of good) expect(violations(line), line).toEqual([]);
  });
});

describe('the core computes the same bits everywhere', () => {
  const files = Object.keys(sources).filter((f) => !f.endsWith('.test.ts')).sort();
  it('finds the sources', () => { expect(files.length).toBeGreaterThan(3); });
  for (const file of files) {
    it(`${file} uses only the allowed Math members, no clock, locale or global object and no ** operator`, () => {
      expect(violations(sources[file]).map((v) => `${file}:${v}`)).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ rule 4: nothing allocated on the step's path */

type Fn = { file: string; name: string; body: Token[] };

/** Every named function declaration in a source (`function name(...) ... { body }`), with its body's tokens. */
function functionsOf(file: string, t: Token[]): Fn[] {
  const out: Fn[] = [];
  const close = (k: number, open: string, shut: string): number => {
    let depth = 0;
    for (let j = k; j < t.length; j++) {
      if (t[j].kind !== 'punct') continue;
      if (t[j].text === open) depth++;
      else if (t[j].text === shut && --depth === 0) return j;
    }
    return t.length - 1;
  };
  for (let k = 0; k + 2 < t.length; k++) {
    if (!(t[k].kind === 'name' && t[k].text === 'function' && t[k + 1].kind === 'name')) continue;
    let j = k + 2;
    if (t[j].text === '<') j = close(j, '<', '>') + 1;   // type parameters
    if (t[j].text !== '(') continue;
    j = close(j, '(', ')') + 1;
    // A return type may hold braces of its own (an object type): a '{' right after ':', '|', '&' or ',' is a type.
    while (j < t.length && !(t[j].text === '{' && !(t[j - 1].text === ':' || t[j - 1].text === '|' || t[j - 1].text === '&' || t[j - 1].text === ','))) {
      if (t[j].text === '{') j = close(j, '{', '}');
      if (t[j].text === ';') break;   // an overload or a declaration without a body
      j++;
    }
    if (j >= t.length || t[j].text !== '{') continue;
    const end = close(j, '{', '}');
    out.push({ file, name: t[k + 1].text, body: t.slice(j + 1, end) });
  }
  return out;
}

/** What in a function body allocates: object and array literals, closures, new, spreads and template strings. */
function allocations(body: Token[]): string[] {
  const found: string[] = [];
  const literalBefore = new Set(['=', '(', ',', '?', 'return', '[', '=>', '||', '&&', '??']);
  for (let k = 0; k < body.length; k++) {
    const a = body[k], prev = body[k - 1];
    const before = prev === undefined ? '' : prev.text;
    if (a.kind === 'punct' && a.text === '{' && literalBefore.has(before)) found.push(`${a.line}: an object literal`);
    else if (a.kind === 'punct' && a.text === '[' && (prev === undefined || (prev.kind === 'punct' && literalBefore.has(before)) || before === 'return')) found.push(`${a.line}: an array literal`);
    else if (a.kind === 'punct' && a.text === '=' && body[k + 1] !== undefined && body[k + 1].text === '>') found.push(`${a.line}: a closure`);
    else if (a.kind === 'name' && (a.text === 'function' || a.text === 'new')) found.push(`${a.line}: ${a.text}`);
    else if (a.kind === 'punct' && a.text === '.' && body[k + 1] !== undefined && body[k + 1].text === '.' && body[k + 2] !== undefined && body[k + 2].text === '.') found.push(`${a.line}: a spread`);
    else if (a.kind === 'number' && a.text === 'template') found.push(`${a.line}: a template string`);
  }
  return found;
}

/** The functions step reaches through plain calls, by name, across every source given (a name declared twice: both). */
function stepPath(files: Record<string, string>): Fn[] {
  const all: Fn[] = [];
  for (const file of Object.keys(files).sort()) all.push(...functionsOf(file, tokens(files[file])));
  const reached = new Set<Fn>(), queue: string[] = ['step', 'stepWith'], seen = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const fn of all) {
      if (fn.name !== name) continue;
      reached.add(fn);
      for (let k = 0; k + 1 < fn.body.length; k++) {
        const a = fn.body[k], prev = fn.body[k - 1];
        if (a.kind === 'name' && fn.body[k + 1].text === '(' && !(prev !== undefined && (prev.text === '.' || prev.text === '?.'))) queue.push(a.text);
      }
    }
  }
  return [...reached];
}

describe('nothing is allocated on the step\'s path (DESIGN.md rule 4)', () => {
  const files: Record<string, string> = {};
  for (const f of Object.keys(sources)) if (!f.endsWith('.test.ts')) files[f] = sources[f];

  it('the scan finds an allocation slipped into a function step reaches, however deep, and passes plain arithmetic', () => {
    const plain = {
      './a.ts': 'export function step(s: S): void { inner(s); s.x = s.y[0] * 2; }\nfunction inner(s: S): { a: number } { const k = s.u > 0 ? s.u : -s.u; return deeper(k); }',
      './b.ts': 'function deeper(k: number): number { const t: number[] = scratch; t[0] = k; return t[0]; }\nfunction unused(): number[] { return [1, 2]; }',
    };
    const names = stepPath(plain).map((f) => f.name).sort();
    expect(names).toEqual(['deeper', 'inner', 'step']);
    for (const fn of stepPath(plain)) expect(allocations(fn.body), fn.name).toEqual([]);
    const junk = ['const junk = { a: [s.u, s.v, s.r], b: () => h };', 'const a = [s.u];', 'const f = function () { return 1; };',
      'const c = new Float64Array(4);', 'const d = { ...s };', 'const e = `${s.u}`;', 'g(x, { y: 1 });', 'return [1];'];
    for (const line of junk) {
      const files2 = { ...plain, './b.ts': `function deeper(k: number): number { ${line} return k; }` };
      const found = stepPath(files2).flatMap((fn) => allocations(fn.body));
      expect(found, line).not.toEqual([]);
    }
  });

  it('every function the step reaches allocates nothing: no literals, closures, new, spreads or template strings', () => {
    const path = stepPath(files);
    const names = path.map((f) => f.name);
    // It does follow the step down: the tyres, the brakes, the systems, the driveline's solver and the body.
    for (const name of ['substep', 'tyreForces', 'brakeTorques', 'autoShift', 'drivelineStep', 'solveCentre', 'moveBody', 'slipStates', 'engineTorque', 'suspensionStep']) {
      expect(names, name).toContain(name);
    }
    const found: string[] = [];
    for (const fn of path) for (const what of allocations(fn.body)) found.push(`${fn.file} ${fn.name}:${what}`);
    expect(found).toEqual([]);
  });
});
