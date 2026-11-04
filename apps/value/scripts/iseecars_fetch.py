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
# Pages the Wayback Machine has are read by scripts/wayback_fetch.py instead; skip them here.
ARCHIVED = set()
if os.path.exists('data/iseecars/wayback.tsv'):
    for _l in open('data/iseecars/wayback.tsv'):
        _m = re.search(r'/car/(\d{4}-[a-z0-9_\-]+)-price', _l)
        if _m: ARCHIVED.add(_m.group(1))
start = time.time()

def slug(s):
    s = re.sub(r'[^a-z0-9\-]+', '_', s.lower()).strip('_')
    return s.replace('-', '__')

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

# Phase 1: follow links. Every price page links to the same model's price pages
# for every year it exists and to the make's other models, so known models give
# exact page names with no guessing. MODELS keeps, per "make-model" slug, the
# years iSeeCars lists (None until a page for that model has been read).
MODELS_PATH = 'data/iseecars/models.json'
models = json.load(open(MODELS_PATH)) if os.path.exists(MODELS_PATH) else {}
for k, v in tried.items():
    if v == 'found':
        models.setdefault(k[5:], None)

def make_of(mm):
    """(site make name, iSeeCars make slug) for a 'make-model' slug."""
    for m in sorted(site_makes, key=len, reverse=True):
        for f in (slug(m), slug(m).replace('_', '-')):
            if mm.startswith(f + '-'):
                return m, f
    return mm.split('-')[0], mm.split('-')[0]

def harvest(text, mk_model):
    mk = make_of(mk_model)[1]
    years = sorted({int(y) for y in re.findall(r'/car/(\d{4})-' + re.escape(mk_model) + r'-price', text)})
    if years:
        models[mk_model] = years
    for sib in set(re.findall(r'href="/car/(' + re.escape(mk) + r'-[a-z0-9_\-]+?)"', text)):
        if not re.search(r'-(price|specs|interior|colors|dimensions|safety|tire|wheel|reliability|resale|generations)', sib):
            # Sibling links sometimes write spaces as '-' where year pages use '_'
            # (highlander-hybrid vs highlander_hybrid), while names like cr-v keep '-'. Try both.
            model_part = sib[len(mk) + 1:]
            for form in dict.fromkeys([model_part.replace('-', '_'), model_part, model_part.replace('-', '__')]):
                models.setdefault(f'{mk}-{form}', None)

def get_page(key):
    """Fetch key's price page with back-off. Returns (code, text) or None to stop the run."""
    global blocked
    if key in ARCHIVED:
        return (204, '')  # archived copy is read by the Wayback job
    if time.time() - start > BUDGET:
        print('time budget reached; rerun to continue'); return None
    code, text = fetch(f'https://www.iseecars.com/car/{key}-price')
    if code in (403, 429, 0, 500, 502, 503):
        print('refused', code, key, '- backing off'); time.sleep(90)
        code, text = fetch(f'https://www.iseecars.com/car/{key}-price')
    if code in (403, 429, 0, 500, 502, 503):
        blocked += 1
        print('refused again', code, key)
        if blocked >= 5:
            print('stopping: site keeps refusing'); return None
        return (code, '')
    blocked = 0
    return code, text

def save():
    json.dump(tried, open(TRIED, 'w')); json.dump(models, open(MODELS_PATH, 'w'))

def phase1():
    progress = True
    while progress:
        progress = False
        for mm in sorted(models):
            ys = models[mm]
            want = [y for y in YEARS if (ys is None or y in ys) and f'{y}-{mm}' not in tried]
            if ys is None and not want:
                continue
            for y in (want if ys is not None else sorted(want, reverse=True)[:1]):
                key = f'{y}-{mm}'
                res = get_page(key)
                if res is None:
                    return False
                code, text = res
                if code not in (200, 404, 410):
                    continue  # refused or failed: leave it untried for a later run
                rows = parse(text) if code == 200 else []
                if code == 200:
                    harvest(text, mm)
                if rows and f'{y} ' in text[:20000]:
                    tried[key] = 'found'
                    make = make_of(mm)[0]
                    for row in rows:
                        out.write(json.dumps({'year': y, 'make': make, 'slug': key, **row}) + '\n')
                    out.flush(); print('found', key, len(rows))
                else:
                    tried[key] = 'missing'
                    if ys is None:
                        models[mm] = []  # no page for the newest wanted year; let phase 2 guess
                progress = True
                save()
                if ys is None:
                    break  # re-read years list before fetching the rest
    return True

if not phase1():
    out.close(); save(); sys.exit(0)

# Phase 2: guess page names from EPA model names for anything phase 1 didn't reach.
known_models = {mm for mm, ys in models.items() if ys}
for (y, make), lists in sorted(cands.items()):
    forms = [make_slugs[make]] if make in make_slugs else list(dict.fromkeys([slug(make), slug(make).replace('_', '-')]))
    for variants in lists:
        for v in variants:
            hit = False
            for mf in forms:
                key = f'{y}-{mf}-{slug(v)}'
                if f'{mf}-{slug(v)}' in known_models and key not in tried:
                    continue  # phase 1 already knows this model's years
                if key in tried:
                    hit = tried[key] == 'found'
                    if hit: break
                    continue
                res = get_page(key)
                if res is None:
                    out.close(); save(); sys.exit(0)
                code, text = res
                if code not in (200, 404, 410):
                    continue  # refused or failed: leave it untried
                if code == 200:
                    harvest(text, f'{mf}-{slug(v)}')
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
        save()
out.close()
save()
print('done', sum(v == 'found' for v in tried.values()), 'pages found of', len(tried), 'tried')
