"""Fill sticker gaps with Google results via Searlo (1 credit per search, key SEARCH_API_KEY).

For each model-year in data/search/gaps.json (plus 40 known 'controls' to measure accuracy),
searches "<year> <make> <model> MSRP" and keeps dollar amounts only when the snippet says they
are a new-car price ("MSRP", "starting at", "starts at", "base price", "priced from") and not a
used value ("used", "trade-in", "value", "worth", "listings", "sold for"). A starting price is
'verified' when two different sites agree within 1.5%, 'single' when only one site gives it.
Output: data/search/gapfill.jsonl. Resumable."""
import json, os, re, time, urllib.parse, urllib.request, collections

KEY = os.environ['SEARCH_API_KEY']
OUT = 'data/search/gapfill.jsonl'
NEW = re.compile(r'(msrp|starting at|starts at|start at|base price|priced from|price starts|starting price|sticker)', re.I)
USED = re.compile(r'(used|trade-in|trade in|value|worth|listings?|sold for|for sale|depreciat|private party|average price paid)', re.I)
done = set()
if os.path.exists(OUT):
    for l in open(OUT):
        r = json.loads(l); done.add((r['year'], r['make'], r['model']))
cars = [dict(c, control=True) for c in json.load(open('data/search/gap-controls.json'))]
cars += [{'year': y, 'make': m, 'model': mo} for y, m, mo in json.load(open('data/search/gaps.json'))]
out = open(OUT, 'a'); fails = 0
for car in cars:
    if (car['year'], car['make'], car['model']) in done:
        continue
    q = f"{car['year']} {car['make']} {car['model']} MSRP"
    url = 'https://api.searlo.tech/api/v1/search/web?' + urllib.parse.urlencode({'q': q, 'limit': 10})
    try:
        req = urllib.request.Request(url, headers={'x-api-key': KEY, 'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=40) as r:
            res = json.load(r)
        fails = 0
    except Exception as e:
        fails += 1; print('error', q, e)
        if fails >= 5:
            print('stopping: repeated errors'); break
        time.sleep(10); continue
    found = []  # (domain, price)
    for o in res.get('organic', []):
        dom = (o.get('domain') or '').replace('www.', '')
        text = f"{o.get('title') or ''}. {o.get('snippet') or ''}. {o.get('description') or ''}"
        if str(car['year']) not in text and str(car['year']) not in (o.get('link') or ''):
            continue
        for sent in re.split(r'(?<=[.;!?])\s+|\s·\s', text):
            if not NEW.search(sent) or USED.search(sent):
                continue
            for m in re.finditer(r'\$\s?(\d{1,3}(?:,\d{3})+)', sent):
                v = int(m.group(1).replace(',', ''))
                if 9000 <= v <= 600000:
                    found.append((dom, v))
    by_dom = collections.defaultdict(list)
    for d, v in found:
        by_dom[d].append(v)
    starts = {d: min(vs) for d, vs in by_dom.items()}
    best, status = None, 'none'
    vals = sorted(starts.items(), key=lambda x: x[1])
    for d1, v1 in vals:
        if any(d2 != d1 and abs(v2 - v1) / v1 <= 0.015 for d2, v2 in vals):
            best, status = v1, 'verified'; break
    if best is None and vals:
        best, status = vals[0][1], 'single'
    row = {**car, 'query': q, 'msrp': best, 'status': status, 'sources': starts}
    if car.get('expected') and best:
        row['diff_pct'] = round(100 * (best - car['expected']) / car['expected'], 1)
    out.write(json.dumps(row) + '\n'); out.flush()
    print(q, '->', best, status, row.get('diff_pct', ''))
    time.sleep(0.5)
out.close()
