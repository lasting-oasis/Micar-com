"""Read iSeeCars price pages from the Wayback Machine instead of the live site.

data/iseecars/wayback.tsv (from iseecars_discover.py) lists every archived price page with
its latest snapshot. This fetches each wanted page (years in Y0..Y1, newest years first)
from web.archive.org, one every DELAY seconds, parses the price table and appends to
data/iseecars/prices-wayback.jsonl. Resumable via data/iseecars/tried-wayback.json.
Pages the live job already found are skipped. Stops at the time budget or after 5
consecutive failures; the workflow then starts the next run.
"""
import json, os, re, sys, time, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from iseecars_parse import parse  # noqa: E402

Y0, Y1 = int(os.environ.get('Y0', 2010)), int(os.environ.get('Y1', 2026))
DELAY = float(os.environ.get('DELAY', 2.5))
BUDGET = float(os.environ.get('BUDGET_MIN', 100)) * 60
UA = 'QueenCityMyCarValue/1.0 (price research; https://github.com/lasting-oasis/queen_city_mycarvalue)'
OUT, TRIED, FAILDIR = 'data/iseecars/prices-wayback.jsonl', 'data/iseecars/tried-wayback.json', 'data/iseecars/wayback-fail'
PRICE = re.compile(r'/car/(\d{4})-([a-z0-9_\-]+)-price/?$')
MAKES = {m.lower().replace(' ', '_'): m for m in re.findall(r"name: '([^']+)'", open('src/engine/data.ts').read())}

tried = json.load(open(TRIED)) if os.path.exists(TRIED) else {}
live_found = {k for k, v in json.load(open('data/iseecars/tried.json')).items() if v == 'found'} if os.path.exists('data/iseecars/tried.json') else set()
start = time.time()

def make_of(slug):
    for ms in sorted(MAKES, key=len, reverse=True):
        if slug.startswith(ms + '-'):
            return MAKES[ms], slug[len(ms) + 1:]
    return None, None

# Wanted pages: newest years first (2016-2026 is the priority), then older.
wanted = []
for line in open('data/iseecars/wayback.tsv'):
    url, ts = line.rstrip('\n').split('\t')
    m = PRICE.search(url)
    if not m: continue
    year, slug = int(m.group(1)), m.group(2)
    key = f'{year}-{slug}'
    if not (Y0 <= year <= Y1) or key in tried or key in live_found: continue
    make, model = make_of(slug)
    if not make: continue
    wanted.append((0 if year >= 2016 else 1, -year, key, url, ts, year, make, model))
wanted.sort()
print(len(wanted), 'pages wanted')

def fetch(url, ts):
    req = urllib.request.Request(f'https://web.archive.org/web/{ts}id_/{url}', headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        wait = e.headers.get('Retry-After')
        return e.code, wait or ''
    except Exception as e:
        return 0, str(e)

os.makedirs(FAILDIR, exist_ok=True)
out = open(OUT, 'a'); fails = 0; done = 0
def save(): json.dump(tried, open(TRIED, 'w'))
for _, _, key, url, ts, year, make, model in wanted:
    if time.time() - start > BUDGET:
        print('time budget reached'); break
    time.sleep(DELAY)
    code, text = fetch(url, ts)
    if code in (429, 503, 0):
        fails += 1; print('refused', code, key, text[:60])
        if fails >= 5: print('stopping: archive keeps refusing'); break
        time.sleep(60 if code else 20); continue
    fails = 0
    if code == 404:
        tried[key] = 'missing'; continue
    if code != 200:
        print('skip', code, key); continue
    rows = parse(text)
    if rows:
        tried[key] = 'found'; done += 1
        for r in rows:
            out.write(json.dumps({'year': year, 'make': make, 'slug': key, **r, 'source': 'wayback', 'snapshot': ts}) + '\n')
        out.flush()
    else:
        tried[key] = 'notable'
        if len(os.listdir(FAILDIR)) < 8:
            open(f'{FAILDIR}/{key}.html', 'w').write(text[:400000])
        print('no price table', key)
    if done % 25 == 0: save()
save(); out.close()
print('done', done, 'pages this run;', sum(v == 'found' for v in tried.values()), 'found total of', len(tried), 'tried')
