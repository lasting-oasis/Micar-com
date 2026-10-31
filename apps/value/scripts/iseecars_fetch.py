"""Fetch iSeeCars 2010-2014 price pages for every model the EPA list has, politely.

Runs in GitHub Actions (.github/workflows/iseecars.yml). For each EPA make/model/year
it tries page slugs from the most to the least specific name ("x3_xdrive28i", then
"x3") and keeps the first page that has a price table. One request every DELAY
seconds, honest user agent, robots.txt allows /car/. Resumable: state is kept in
data/iseecars/, and the run stops itself before GitHub's 6-hour limit.

Output: data/iseecars/prices.jsonl  (one row per style: year, make, model slug, style, msrp, destination, invoice)
        data/iseecars/tried.json    (slug -> found / missing, so reruns skip them)
"""
import csv, json, os, re, sys, time, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from iseecars_parse import parse  # noqa: E402

YEARS = range(int(os.environ.get('Y0', 2010)), int(os.environ.get('Y1', 2014)) + 1)
DELAY = float(os.environ.get('DELAY', 3))
BUDGET = float(os.environ.get('BUDGET_MIN', 320)) * 60
UA = 'QueenCityMyCarValue/1.0 (price research; https://github.com/lasting-oasis/queen_city_mycarvalue)'
OUT, TRIED = 'data/iseecars/prices.jsonl', 'data/iseecars/tried.json'
MAKE_ALIAS = {'MINI': 'Mini', 'smart': 'Smart', 'McLaren Automotive': 'McLaren'}
DRIVE = re.compile(r'\b(2WD|4WD|AWD|FWD|RWD|4x4|4X4|AWD/4WD|4matic|xDrive|sDrive|quattro)\b', re.I)

site_makes = set(re.findall(r"name: '([^']+)'", open('src/engine/data.ts').read())) - {'Other', 'Sedan'}
tried = json.load(open(TRIED)) if os.path.exists(TRIED) else {}
start = time.time()

def slug(s):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9\-]+', '_', s.lower())).strip('_')

def fetch(url):
    time.sleep(DELAY)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception:
        return 0, ''

# Candidates: (year, make, [name variants, most specific first])
cands = {}
for r in csv.DictReader(open('data/epa/vehicles.csv')):
    y, make = int(r['year']), MAKE_ALIAS.get(r['make'], r['make'])
    if y not in YEARS or make not in site_makes:
        continue
    name = re.sub(r'\s+', ' ', DRIVE.sub('', r['model'])).strip()
    words = name.split(' ')
    variants = [' '.join(words[:k]) for k in range(len(words), 0, -1)] + [r['baseModel']]
    cands.setdefault((y, make), []).append(variants)

make_slugs = {}  # make -> working slug form, learned on first hit
blocked = 0
out = open(OUT, 'a')
for (y, make), lists in sorted(cands.items()):
    forms = [make_slugs[make]] if make in make_slugs else list(dict.fromkeys([slug(make), slug(make).replace('_', '-')]))
    for variants in lists:
        for v in variants:
            hit = False
            for mf in forms:
                key = f'{y}-{mf}-{slug(v)}'
                if key in tried:
                    hit = tried[key] == 'found'
                    if hit: break
                    continue
                if time.time() - start > BUDGET:
                    print('time budget reached; rerun to continue'); out.close(); json.dump(tried, open(TRIED, 'w')); sys.exit(0)
                code, text = fetch(f'https://www.iseecars.com/car/{key}-price')
                if code in (403, 429, 0, 500, 502, 503):
                    # Back off and retry once; stop only if the site keeps refusing.
                    print('refused', code, key, '- backing off'); time.sleep(90)
                    code, text = fetch(f'https://www.iseecars.com/car/{key}-price')
                if code in (403, 429, 0, 500, 502, 503):
                    blocked += 1
                    print('refused again', code, key)
                    if blocked >= 5:
                        print('stopping: site keeps refusing'); out.close(); json.dump(tried, open(TRIED, 'w')); sys.exit(0)
                    continue
                blocked = 0
                rows = parse(text) if code == 200 else []
                # A page for the wrong year or a redirect to a search page has no rows for this year.
                if rows and f'{y} ' in text[:20000]:
                    tried[key] = 'found'
                    make_slugs[make] = mf
                    for row in rows:
                        out.write(json.dumps({'year': y, 'make': make, 'slug': key, **row}) + '\n')
                    out.flush()
                    print('found', key, len(rows))
                    hit = True
                    break
                tried[key] = 'missing'
            if hit:
                break  # stop at the most specific name that has a page
        json.dump(tried, open(TRIED, 'w'))
out.close()
json.dump(tried, open(TRIED, 'w'))
print('done', sum(v == 'found' for v in tried.values()), 'pages found of', len(tried), 'tried')
