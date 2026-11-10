// What the EPA build scripts share: reading the CSV and matching the EPA's model names to the site's.
// build-epa.ts (which models exist in which years) and build-epa-configs.ts (each model-year's configurations)
// must agree on which EPA row belongs to which model, so the matching lives here once.

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

// EPA make names -> site make names.
export const MAKE_ALIAS: Record<string, string> = { MINI: 'Mini', smart: 'Smart', 'McLaren Automotive': 'McLaren' };

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
// How EPA spells some of our models. Default: our model's words are the first words of the EPA name.
export const MATCH: Record<string, RegExp> = {
  'Mazda|Mazda3': /^(mazda ?)?3( |$)/i,
  'Mazda|CX-5': /^cx-5/i,
  'Toyota|GR86': /^(gr ?)?86/i,
  'Mazda|MX-5 Miata': /^mx-5/i,
  'Chevrolet|Bolt EV': /^bolt(?! euv)/i,
  'Chrysler|300': /(^| )300/i,
  'Chevrolet|Silverado 1500': /^silverado(?!.*(2500|3500|hd))/i,
  'GMC|Sierra 1500': /^sierra(?!.*(2500|3500|hd))/i,
  'Ram|1500': /^(ram )?1500/i,
  'Kia|Forte / K4': /^(forte|k4)/i,
  'Porsche|718 Cayman / Boxster': /^(718 )?(cayman|boxster|spyder|gt4)/i,
  'Mercedes-Benz|GLA': /^(amg )?gla\d*/i,
  'Mercedes-Benz|GLB': /^(amg )?glb\d*/i,
  'Mercedes-Benz|GLC': /^(amg )?glc\d*/i,
  'Mercedes-Benz|GLE': /^(amg )?gle\d*/i,
  'Mercedes-Benz|GLS': /^(amg )?gls\d*/i,
  'Mercedes-Benz|C-Class': /^(amg )?c ?\d{2,3}/i,
  'Mercedes-Benz|E-Class': /^(amg )?e ?\d{2,3}/i,
  'Mercedes-Benz|S-Class': /^(amg )?s ?\d{2,3}/i,
};
export function matches(make: string, ours: string, epaModel: string): boolean {
  const re = MATCH[`${make}|${ours}`];
  if (re) return re.test(epaModel);
  const a = words(ours), b = words(epaModel);
  return a.every((w, i) => b[i] === w);
}
