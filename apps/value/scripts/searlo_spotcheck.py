"""Spot-check iSeeCars prices against Google results (Searlo API, key SEARCH_API_KEY).

Picks N random model-years from data/iseecars/prices.jsonl, searches "<year> <make> <model> MSRP",
and pulls dollar amounts from snippets on independent sites (iSeeCars itself excluded). A car
"matches" when a snippet shows iSeeCars' base price within $50, or any of its trim prices.
Output: data/search/spotcheck.jsonl and a summary line per car. 1 credit per search."""
import json, os, random, re, time, urllib.parse, urllib.request, collections

KEY = os.environ['SEARCH_API_KEY']
N = int(os.environ.get('N', 100))
pages = collections.defaultdict(list)
for l in open('data/iseecars/prices.jsonl'):
    r = json.loads(l); pages[(r['year'], r['make'], r['slug'])].append(r['msrp'])
random.seed(11)
pick = random.sample(sorted(pages), min(N, len(pages)))
out = open('data/search/spotcheck.jsonl', 'w')
for (y, make, slug) in pick:
    model = re.sub(r'^\d{4}-', '', slug)
    model = model.split('-', 1)[1] if model.lower().startswith(make.lower().split()[0].lower()) else model
    if make == 'Mercedes-Benz': model = slug.split('-', 3)[3]
    name = model.replace('_', ' ').upper() if len(model) <= 4 else model.replace('_', ' ').title()
    q = f'{y} {make} {name} MSRP'
    url = 'https://api.searlo.tech/api/v1/search/web?' + urllib.parse.urlencode({'q': q, 'limit': 10})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'x-api-key': KEY, 'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'}), timeout=40) as r:
            res = json.load(r)
    except Exception as e:
        res = {'error': str(e)}
    prices = pages[(y, make, slug)]; base = min(prices)
    hits = []
    for o in res.get('organic', []):
        if 'iseecars' in (o.get('domain') or ''): continue
        text = f"{o.get('snippet') or ''} {o.get('description') or ''}"
        for m in re.findall(r'\$(\d{1,3},\d{3})', text):
            v = int(m.replace(',', ''))
            if v > 8000: hits.append((o.get('domain'), v))
    base_match = any(abs(v - base) <= 50 for _, v in hits)
    trim_match = any(v in prices for _, v in hits)
    near = min((abs(v - base) / base for _, v in hits), default=None)
    row = {'year': y, 'make': make, 'slug': slug, 'query': q, 'iseecars_base': base, 'iseecars_trims': sorted(prices),
           'snippet_prices': hits[:12], 'base_match': base_match, 'trim_match': trim_match,
           'closest_pct': round(100 * near, 1) if near is not None else None, 'error': res.get('error')}
    out.write(json.dumps(row) + '\n'); out.flush()
    print(q, '| base', base, '| base_match', base_match, '| any trim', trim_match, '| closest %', row['closest_pct'])
    time.sleep(1)
