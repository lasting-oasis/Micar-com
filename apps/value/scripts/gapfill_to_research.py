"""Turn verified Searlo gap-fill prices (two sites agree within 1.5%) into sticker files.
Single-source prices are left out: on 27 known cars, 8 were more than 10% off.
Writes data/research/stickers-search/<make-model>.json, one base-price row per year."""
import collections, json, os, re

OUT = 'data/research/stickers-search'
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(f'{OUT}/{f}')
body = {(e['make'], e['model']): e['body'] for e in json.load(open('src/data/epa-lineup.json'))}
by = collections.defaultdict(list)
for line in open('data/search/gapfill.jsonl'):
    r = json.loads(line)
    if r.get('control') or r['status'] != 'verified' or not r['msrp']:
        continue
    by[(r['make'], r['model'])].append(r)
for (make, model), rows in by.items():
    years = [{'year': r['year'], 'destination': None,
              'trims': [{'trim': 'Base (starting price)', 'msrp': r['msrp'], 'config': '',
                         'note': 'Starting price from Google results; trim breakdown not on file.'}],
              'source': 'https://www.google.com/search?q=' + r['query'].replace(' ', '+'), 'source_type': 'secondary',
              'note': 'Starting MSRP found by search; two independent sites agreed within 1.5% ('
                      + ', '.join(sorted(r['sources'])[:3]) + ').'}
             for r in sorted(rows, key=lambda r: r['year'])]
    doc = {'make': make, 'model': model, 'body': body.get((make, model), 'Sedan'),
           'note': 'Starting prices from search, used where no trim-level price list was found.', 'years': years, 'gaps': []}
    fn = re.sub(r'[^a-z0-9]+', '-', f'{make} {model}'.lower()).strip('-')
    json.dump(doc, open(f'{OUT}/{fn}.json', 'w'), indent=0)
print(len(by), 'models,', sum(len(v) for v in by.values()), 'model-years')
