"""List the models this Gemini key can use and try one request on each Flash/Lite model,
with and without Google Search grounding. Writes data/gemini/probe.json."""
import json, os, time, urllib.request, urllib.error
KEY = os.environ['GEMINI_API_KEY']; B = 'https://generativelanguage.googleapis.com/v1beta'
def call(url, body=None):
  try:
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r: return 200, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
  except Exception as e:
    return 0, {'error': {'message': str(e)}}
code, lst = call(f'{B}/models?key={KEY}&pageSize=200')
names = [m['name'] for m in lst.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
cands = [n for n in names if 'flash' in n or 'lite' in n][:8]
out = {'models': names, 'tests': []}
q = {'contents': [{'parts': [{'text': 'Base MSRP of the 2012 Toyota Camry L, excluding destination? One line: MSRP: $<number>'}]}]}
def save():
    json.dump(out, open('data/gemini/probe.json', 'w'), indent=1)
out['list_status'] = code
out['list_error'] = str(lst.get('error'))[:300] if isinstance(lst, dict) else ''
save()
for n in cands:
    for grounded in (False, True):
        body = dict(q, tools=[{'google_search': {}}]) if grounded else q
        c, r = call(f'{B}/{n}:generateContent?key={KEY}', body)
        r = r if isinstance(r, dict) else {}
        err = r.get('error'); err = err if isinstance(err, dict) else {'message': str(err or '')}
        r['error'] = err
        text = ''.join(p.get('text', '') for cand in r.get('candidates', []) for p in cand.get('content', {}).get('parts', []))
        out['tests'].append({'model': n, 'grounded': grounded, 'status': c, 'answer': text[:120], 'error': (r.get('error') or {}).get('message', '')[:160]})
        print(n, grounded, c, text[:60] or (r.get('error') or {}).get('message', '')[:100])
        save()
        time.sleep(5)
save()
