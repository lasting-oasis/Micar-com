"""Ask Gemini (with Google Search grounding) for each car's base MSRP.

Input:  a JSON list of {year, make, model, ...} (default data/gemini/test-cars.json)
Output: data/gemini/results.jsonl with the answer, the cited sources and, for test
        cars, the expected price and the percent difference.
Key:    GEMINI_API_KEY. Spaced ~7 s apart to stay within free-tier per-minute limits.
"""
import json, os, re, sys, time, urllib.request, urllib.error

KEY = os.environ['GEMINI_API_KEY']
MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash')
URL = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}'
IN = sys.argv[1] if len(sys.argv) > 1 else 'data/gemini/test-cars.json'
OUT = 'data/gemini/results.jsonl'
PROMPT = ('Look up the official US base MSRP of the {year} {make} {model} when new: the cheapest trim, '
          'excluding the destination charge. Answer on one line exactly as: '
          'MSRP: $<number> | TRIM: <base trim name> | DESTINATION: $<number or unknown>')

def ask(car):
    body = json.dumps({'contents': [{'parts': [{'text': PROMPT.format(**car)}]}],
                       'tools': [{'google_search': {}}],
                       'generationConfig': {'temperature': 0}}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code == 429 and attempt < 2:
                time.sleep(60); continue
            return {'error': e.code, 'message': msg}
        except Exception as e:
            return {'error': 0, 'message': str(e)[:300]}

out = open(OUT, 'w')
fails = 0
for car in json.load(open(IN)):
    res = ask(car)
    fails = fails + 1 if res.get('error') else 0
    text = ''.join(p.get('text', '') for c in res.get('candidates', []) for p in c.get('content', {}).get('parts', []))
    m = re.search(r'MSRP:\s*\$?([\d,]+)', text)
    got = int(m.group(1).replace(',', '')) if m else None
    srcs = [c.get('web', {}).get('uri') for c in res.get('candidates', [{}])[0].get('groundingMetadata', {}).get('groundingChunks', [])] if res.get('candidates') else []
    titles = [c.get('web', {}).get('title') for c in res.get('candidates', [{}])[0].get('groundingMetadata', {}).get('groundingChunks', [])] if res.get('candidates') else []
    row = {**car, 'answer': text.strip()[:300], 'msrp': got, 'sources': titles[:5], 'error': res.get('error'), 'message': res.get('message')}
    if car.get('expected') and got:
        row['diff_pct'] = round(100 * (got - car['expected']) / car['expected'], 1)
    out.write(json.dumps(row) + '\n'); out.flush()
    print(car['year'], car['make'], car['model'], '->', got, row.get('diff_pct'), res.get('error') or '')
    if fails >= 3:
        print('stopping: 3 errors in a row'); break
    time.sleep(7)
