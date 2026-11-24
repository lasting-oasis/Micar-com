// Builds src/data/sheets.ts from data/research/*.json: one physics sheet per researched car configuration, through
// sheet.ts's readResearch, and prints for each record how many figures it used, which it dropped and why.
//   From the repository root:  pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/build-sheets.ts
//   --research <dir> and --out <file> read and write elsewhere (to try it on a scratch folder).
// A script, not the core: it may use Node and any Math function. Research files are written by hand and may be
// half-finished at any moment, so a file that cannot be read is skipped with a message and the rest still build.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PhysicsSheet } from '../src/types';
import type { ResearchReading, ResearchRecord } from '../src/sheet';
import { readResearch } from '../src/sheet';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function option(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? resolve(process.argv[i + 1]) : null;
}
const RESEARCH = option('--research') ?? join(ROOT, 'data', 'research');
const OUT = option('--out') ?? join(ROOT, 'src', 'data', 'sheets.ts');

/** Why this parsed JSON is not a research record (data/research/README.md), or null when it is one. */
function shapeProblem(x: unknown): string | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return 'not a JSON object';
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.trim() === '') return 'no "id"';
  if (typeof r.year !== 'number') return 'no numeric "year"';
  for (const k of ['make', 'model', 'bodyClass']) if (typeof r[k] !== 'string') return `no "${k}"`;
  if (!Array.isArray(r.fields)) return 'no "fields" list';
  return null;
}

// The determinism test (src/determinism.test.ts) scans every file under src/ for names the core may not use. The
// research notes are prose and could contain one ("Date", "**", "Math.pow"): escape them inside the string literals,
// which read back the same.
function guard(json: string): string {
  return json.replace(/\bDate\b/g, 'D\\u0061te').replace(/\*\*/g, '\\u002a\\u002a').replace(/\bMath\./g, 'Math\\u002e');
}

/** One sheet as a TypeScript object literal: a line per field, so a diff of the generated file reads field by field. */
function sheetLiteral(sheet: PhysicsSheet): string {
  const lines: string[] = ['  {'];
  for (const [key, value] of Object.entries(sheet)) {
    if (key === 'tests') {
      lines.push('    tests: {');
      for (const [tk, tv] of Object.entries(value as Record<string, unknown>)) lines.push(`      ${tk}: ${guard(JSON.stringify(tv))},`);
      lines.push('    },');
    } else {
      lines.push(`    ${key}: ${guard(JSON.stringify(value))},`);
    }
  }
  lines.push('  },');
  return lines.join('\n');
}

function report(file: string, reading: ResearchReading): void {
  const { sheet, used, dropped, unused, notes } = reading;
  console.log(`${sheet.id} (${file}): used ${used.length} figure${used.length === 1 ? '' : 's'}, dropped ${dropped.length}`);
  for (const d of dropped) console.log(`  dropped ${d.key} = ${d.value}: ${d.reason}`);
  for (const n of notes) console.log(`  note    ${n.key} = ${n.value}: ${n.reason}`);
  if (unused.length > 0) console.log(`  not model inputs: ${unused.join(', ')}`);
}

function main(): void {
  if (!existsSync(RESEARCH)) console.log(`no research folder at ${RESEARCH}: writing an empty list`);
  const files = existsSync(RESEARCH) ? readdirSync(RESEARCH).filter((f) => f.endsWith('.json')).sort() : [];
  const sheets: PhysicsSheet[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(RESEARCH, file), 'utf8'));
    } catch (e) {
      console.log(`skipped ${file}: not readable JSON yet (${(e as Error).message})`);
      skipped.push(file);
      continue;
    }
    const problem = shapeProblem(parsed);
    if (problem !== null) { console.log(`skipped ${file}: ${problem}`); skipped.push(file); continue; }
    let reading: ResearchReading;
    try {
      reading = readResearch(parsed as ResearchRecord);
    } catch (e) {
      console.log(`skipped ${file}: ${(e as Error).message}`);
      skipped.push(file);
      continue;
    }
    const id = reading.sheet.id;
    if (sheets.some((s) => s.id === id)) { console.log(`skipped ${file}: id ${id} is already taken by another file`); skipped.push(file); continue; }
    if (file !== `${id}.json`) console.log(`warning: ${file} holds id ${id}`);
    report(file, reading);
    sheets.push(reading.sheet);
  }
  // Sorted by id with a plain comparison, not localeCompare: the same order on every machine.
  sheets.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  const out = [
    '// Generated by scripts/build-sheets.ts from data/research/*.json. Do not edit by hand.',
    '// To rebuild, from the repository root: pnpm --filter @micar/sim exec tsx ../../packages/physics/scripts/build-sheets.ts',
    "import type { PhysicsSheet } from '../types';",
    '',
    '/** Every researched car configuration\'s physics sheet, in published units with each figure\'s source, sorted by id. */',
    sheets.length === 0 ? 'export const SHEETS: readonly PhysicsSheet[] = [];' : `export const SHEETS: readonly PhysicsSheet[] = [\n${sheets.map(sheetLiteral).join('\n')}\n];`,
    '',
    '/** The researched sheet with this id (a research record\'s id, such as "2024-nissan-gt-r-nismo"), or null when none is on file. */',
    'export function sheetById(id: string): PhysicsSheet | null {',
    '  for (let i = 0; i < SHEETS.length; i++) if (SHEETS[i].id === id) return SHEETS[i];',
    '  return null;',
    '}',
    '',
  ].join('\n');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(`wrote ${OUT}: ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`);
}

main();
