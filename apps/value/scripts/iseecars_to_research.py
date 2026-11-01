"""Turn the collected iSeeCars price rows into sticker files the site can use.

Reads data/iseecars/prices.jsonl (live site) and prices-wayback.jsonl (archived copies),
maps each iSeeCars page to a model the site offers (src/data/epa-lineup.json), and writes
one file per model to data/research/stickers-iseecars/ in the same format as the hand
researched files in data/research/stickers/. build-data.ts merges the two: researched
years win, iSeeCars fills the rest.

Matching: an iSeeCars page slug matches a site model when their names match after
removing punctuation (cr__v = CR-V, is_350 = IS 350). A model with an exact page also
takes its hybrid / plug-in variants. A model with no exact page (Lexus IS) takes every
page that starts with its name (is_250, is_350, is_f), with the sub-model name added
to each trim. A few models are mapped by hand in ALIAS.
"""
import collections, json, os, re

LINEUP = json.load(open('src/data/epa-lineup.json'))
OUT = 'data/research/stickers-iseecars'
Y0, Y1 = 2010, 2026
VARIANTS = {'hybrid', 'plug__in', 'plug__in_hybrid', 'prime', 'energi', 'phev', 'hybrid_plug__in'}
ALIAS = {
    'Ram|1500': ['1500', 'ram_pickup_1500'], 'Ram|2500': ['2500', 'ram_pickup_2500'],
    'Ford|F-250 Super Duty': ['super_duty_f__250'], 'Chevrolet|Silverado 2500HD': ['silverado_2500hd'],
    'Mazda|Mazda3': ['mazda3', 'mazdaspeed3'], 'Porsche|718 Cayman / Boxster': ['718_boxster', '718_cayman', 'boxster', 'cayman'],
    'Kia|Forte / K4': ['forte', 'forte_koup', 'forte5', 'k4'], 'Toyota|GR86': ['86', 'gr86'],
    'Mercedes-Benz|GLA': ['gla__class'], 'Mercedes-Benz|GLB': ['glb'], 'Mercedes-Benz|GLC': ['glc__class'],
    'Mercedes-Benz|GLE': ['gle__class'], 'Mercedes-Benz|GLS': ['gls'], 'Mercedes-Benz|A-Class': ['a__class'],
    'Land Rover|Range Rover Evoque': ['range_rover_evoque', 'evoque'], 'Mini|Cooper': ['cooper', 'hardtop', 'cooper_hardtop'],
    'Chevrolet|Bolt EV': ['bolt_ev'], 'Subaru|Impreza': ['impreza', 'impreza_wrx'], 'Volkswagen|Golf GTI': ['golf', 'gti', 'golf_gti'],
    'Cadillac|Escalade': ['escalade', 'escalade_esv'], 'GMC|Yukon': ['yukon', 'yukon_xl'], 'Hyundai|Genesis': ['genesis', 'genesis_coupe'],
    'Mitsubishi|Lancer': ['lancer', 'lancer_sportback', 'lancer_evolution'], 'Nissan|Murano': ['murano', 'murano_crosscabriolet'],
    'BMW|M': ['m3', 'm5', 'm6', 'm2', 'm4', 'm8'], 'Honda|Crosstour': ['crosstour', 'accord_crosstour'], 'Hyundai|Elantra': ['elantra', 'elantra_touring', 'elantra_gt'],
}
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
MAKE_SLUG = {norm(e['make']): e['make'] for e in LINEUP}

def split_make(slug):
    for ms in sorted(MAKE_SLUG, key=len, reverse=True):
        head = slug.split('-', 1)[0]
        if norm(head) == ms:
            return MAKE_SLUG[ms], slug.split('-', 1)[1]
    return None, None

# Collect rows by (year, make, model slug)
pages = collections.defaultdict(list)
for path in ['data/iseecars/prices.jsonl', 'data/iseecars/prices-wayback.jsonl']:
    if not os.path.exists(path): continue
    for line in open(path):
        r = json.loads(line)
        if not (Y0 <= r['year'] <= Y1): continue
        make, mslug = split_make(r['slug'][5:])
        if not make: continue
        pages[(r['year'], make, mslug)].append(r)
slugs_by_make = collections.defaultdict(set)
for (_, make, mslug) in pages: slugs_by_make[make].add(mslug)

def pretty(rem):
    return ' '.join(t.upper() if (len(t) <= 3 or any(c.isdigit() for c in t)) else t.title() for t in rem.replace('__', '-').split('_') if t)

def slugs_for(make, model):
    key = f'{make}|{model}'
    if key in ALIAS:
        return {s: (pretty(s) if len(ALIAS[key]) > 1 and s != ALIAS[key][0] else '') for s in ALIAS[key] if s in slugs_by_make[make]}
    nm = norm(model); out = {}
    exact = [s for s in slugs_by_make[make] if norm(s) == nm]
    if exact:
        out[exact[0]] = ''
        for s in slugs_by_make[make]:
            if s.startswith(exact[0] + '_') and s[len(exact[0]) + 1:] in VARIANTS:
                out[s] = pretty(s[len(exact[0]) + 1:])
        return out
    for s in slugs_by_make[make]:
        if norm(s).startswith(nm) and (s[len(nm):len(nm) + 1] in ('_',) or norm(s) == nm):
            out[s] = f"{model} {pretty(s[len(nm) + 1:])}".strip()
    return out

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(f'{OUT}/{f}')
written = 0; unmatched_pages = set(pages)
for e in LINEUP:
    make, model = e['make'], e['model']
    sl = slugs_for(make, model)
    if not sl: continue
    years = {}
    for (y, mk, ms), rows in pages.items():
        if mk != make or ms not in sl: continue
        unmatched_pages.discard((y, mk, ms))
        prefix = sl[ms]
        yr = years.setdefault(y, {'year': y, 'trims': [], 'dest': [], 'sources': [], 'snap': set()})
        seen = set()
        for r in rows:
            name = f"{prefix} {r['style']}".strip()
            if (name, r['msrp']) in seen: continue
            seen.add((name, r['msrp']))
            yr['trims'].append({'trim': name, 'msrp': r['msrp'], 'config': '', 'note': ''})
            if r.get('destination'): yr['dest'].append(r['destination'])
        yr['sources'].append(f"https://www.iseecars.com/car/{y}-{norm(make) if '-' not in make else make.lower().replace('-', '__').replace(' ', '_')}-{ms}-price")
        if r.get('source') == 'wayback': yr['snap'].add(r.get('snapshot', '')[:8])
    out_years = []
    for y in sorted(years):
        yr = years[y]
        trims = sorted(yr['trims'], key=lambda t: t['msrp'])
        dest = collections.Counter(yr['dest']).most_common(1)[0][0] if yr['dest'] else None
        snap = sorted(d for d in yr['snap'] if d)
        note = ('iSeeCars price table' + (f", archived copy (Wayback Machine snapshot {snap[0][:4]}-{snap[0][4:6]}-{snap[0][6:]})" if snap else ', read from iseecars.com') +
                '. MSRP and destination are separate columns, so MSRP excludes destination. Styles are listed cheapest first.')
        out_years.append({'year': y, 'destination': dest, 'trims': trims, 'source': yr['sources'][0], 'source_type': 'secondary', 'note': note})
    if not out_years: continue
    doc = {'make': make, 'model': model, 'body': e['body'], 'note': f"Trim-level MSRPs from iSeeCars price pages ({', '.join(sorted(sl))}).", 'years': out_years, 'gaps': []}
    fn = re.sub(r'[^a-z0-9]+', '-', f'{make} {model}'.lower()).strip('-')
    if os.path.exists(f'{OUT}/{fn}.json'): fn += '-' + re.sub(r'[^a-z0-9]', '', model.lower())
    json.dump(doc, open(f'{OUT}/{fn}.json', 'w'), indent=0)
    written += 1
print(f'{written} model files; {len(pages) - len(unmatched_pages)} pages used, {len(unmatched_pages)} iSeeCars pages matched no site model')
um = collections.Counter(f'{mk} {ms}' for (_, mk, ms) in unmatched_pages)
print('unmatched (most pages):', um.most_common(40))
