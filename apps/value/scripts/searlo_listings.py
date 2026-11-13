"""Dealer asking prices for every model on the value page, from Searlo's vehicle listings endpoint
(GET /api/v1/vehicles/listings, key SEARCH_API_KEY; 1 credit per search plus 1 per dealer page read).
Vehicle data by Searlo: https://searlo.tech/

MODE=probe  two calls, printing only the response's structure (field names and types; the values of a short
            list of harmless fields), the market summary and the credit balance. Costs about 10 credits.
MODE=fill   one search per model in data/searlo/models.json (hand-set models first, then newest first),
            in a metro chosen from the model's name, and a second metro when the first finds fewer than 8 cars.
            Appends to data/searlo/listings.jsonl and resumes: a model's searches are never repeated, a failed
            search is tried again next run, and a stored first search decides whether the second is needed.
            Never spends more than BUDGET credits (each search reserves the dearest case before it runs),
            stops at MAX_MINUTES, after 5 failures in a row, or at once if the balance cannot be read.

Kept per listing: year, trim, price, mileage, condition (new, used, certified), the dealer's city and state,
and days listed. Kept per search: make, model, the metro, the date, the HTTP status, how many cars were
found, and Searlo's market summary (count; price and mileage min, median, max). Never kept or printed: VINs,
dealer names, websites, street addresses, phone numbers, stock numbers or links (the repo and its logs are
public). Nothing from a single listing is ever printed."""
import concurrent.futures, datetime, email.utils, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request, zlib

BASE = 'https://api.searlo.tech/api/v1'
KEY = os.environ.get('SEARCH_API_KEY', '').strip()
MODE = os.environ.get('MODE', 'probe')
BUDGET = int(os.environ.get('BUDGET', '6000'))
MAX_MINUTES = float(os.environ.get('MAX_MINUTES', '300'))
WORKERS = int(os.environ.get('WORKERS', '3'))
OUT = 'data/searlo/listings.jsonl'
METROS = ['Dallas, TX', 'Atlanta, GA', 'Phoenix, AZ', 'Chicago, IL', 'Charlotte, NC', 'Houston, TX', 'Denver, CO', 'Orlando, FL']
DEAREST = 8  # credits one search can cost (the search plus the dealer pages it reads, rounded up)
# The only fields whose values the probe may print: everything else shows as its type. An allow-list, because a
# list of what to hide always misses a field (a dealer's host, a stock number, a page link).
SAFE = re.compile(r'^(success|code|errorCode|message|year|make|model|trim|condition|currency|mileageUnit|bodyType|'
                  r'count|min|median|max|credits|searches|pages|pagesFetched|status|position)$')


def get(path, params=None, tries=4):
    """GET a JSON endpoint. Returns (status, body, seconds). Retries 429 (after Retry-After), AT_CAPACITY and 5xx;
    after the last try returns the last real status."""
    url = f'{BASE}{path}' + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, headers={'x-api-key': KEY, 'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'})
    last = (0, {'error': 'no answer'}, 0.0)
    for attempt in range(tries):
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.status, json.load(r), time.time() - t0
        except urllib.error.HTTPError as e:
            try:
                body = json.load(e)
            except Exception:
                body = {'error': e.reason}
            last = (e.code, body, time.time() - t0)
            if not (e.code == 429 or 'AT_CAPACITY' in json.dumps(body)[:200] or e.code >= 500):
                return last
            if attempt < tries - 1:
                time.sleep(min(retry_after(e.headers.get('Retry-After')) or 15 * (attempt + 1), 120))
        except Exception as e:  # timeouts, resets
            last = (0, {'error': str(e)[:200]}, time.time() - t0)
            if attempt < tries - 1:
                time.sleep(10 * (attempt + 1))
    return last


def retry_after(v):
    """Seconds to wait from a Retry-After header, given either as seconds or as an HTTP date."""
    if not v:
        return 0
    try:
        return max(0.0, float(v))
    except ValueError:
        try:
            return max(0.0, email.utils.parsedate_to_datetime(v).timestamp() - time.time())
        except (TypeError, ValueError):
            return 0


def shape(v, depth=0, key=''):
    """The structure of a response: field names and types; values only for the harmless fields in SAFE."""
    if depth > 5:
        return '...'
    if isinstance(v, dict):
        return {k: shape(x, depth + 1, k) for k, x in v.items()}
    if isinstance(v, list):
        return [f'{len(v)} items', shape(v[0], depth + 1, key)] if v else []
    if SAFE.match(key) and (not isinstance(v, str) or len(v) < 40):
        return v
    return f'<{type(v).__name__}>'


def balance():
    s, b, _ = get('/credit/balance')
    if s != 200 or not isinstance(b, dict):
        return None
    for k in ('credits', 'balance', 'remaining', 'credit_balance', 'available'):
        if isinstance(b.get(k), (int, float)):
            return b[k]
        if isinstance(b.get('data'), dict) and isinstance(b['data'].get(k), (int, float)):
            return b['data'][k]
    return None


def find_listings(body):
    """The array of cars in a response, wherever the endpoint puts it."""
    if isinstance(body, list):
        return body
    for k in ('listings', 'results', 'vehicles', 'data', 'items', 'cars'):
        v = body.get(k) if isinstance(body, dict) else None
        if isinstance(v, list):
            return v
        if isinstance(v, dict):
            inner = find_listings(v)
            if inner:
                return inner
    return []


def num(x):
    if isinstance(x, (int, float)):
        return x
    if isinstance(x, str):
        d = re.sub(r'[^\d.]', '', x)
        try:
            return float(d) if d else None
        except ValueError:
            return None
    return None


def pick(d, *names):
    for n in names:
        if n in d and d[n] not in (None, ''):
            return d[n]
    return None


def city_of(l):
    """'City, ST' of the dealer, from whichever fields the listing has. Never the street."""
    dealer = l.get('dealer') if isinstance(l.get('dealer'), dict) else {}
    for src in (l, dealer, dealer.get('address') if isinstance(dealer.get('address'), dict) else {}, l.get('location') if isinstance(l.get('location'), dict) else {}):
        c, st = pick(src, 'city'), pick(src, 'state', 'region')
        if c and st:
            return f'{c}, {st}'
    for s in (pick(dealer, 'address'), pick(l, 'location', 'dealer_address', 'address')):
        if isinstance(s, str):
            m = re.search(r'([A-Za-z .\'-]+),\s*([A-Z]{2})\b', s)
            if m:
                return f'{m.group(1).strip().split(",")[-1].strip()}, {m.group(2)}'
    return ''


# ---------- which model a listing is ----------
GENERIC = re.compile(r'(pickup|2wd|4wd|awd|fwd|rwd|cab|van|wagon|chassis)+')


def norm(x):
    return re.sub(r'[^a-z0-9]+', '', str(x or '').lower().replace('&', ' and '))


def names(m):
    """Every name dealers use for a model entry: each part of "Forte / K4" or "Legacy/Outback", and the query."""
    return {norm(p) for p in re.split(r'\s*/\s*', m['model']) if norm(p)} | {norm(m['query'])}


def belongs(l, m, siblings):
    """The listing is this model entry, not a sibling the search also matched. Among this make's entries whose years
    hold the listing's year, it is the one with the longest name equal to the dealer's model, or to the model followed
    by whole words of the trim (a Civic "Type R" is not a Civic Type R unless the trim says so; a CTS "V-Sport" is not a
    CTS-V; a 500 "Lounge" is not a 500 L). A shorter dealer name for the same car ("Dakota" for "Dakota Pickup")
    counts only when what is left is generic. Listings with no make or model belong to nothing."""
    if not isinstance(l, dict) or norm(l.get('make')) != norm(m['make']) or not norm(l.get('model')):
        return False
    model = norm(l.get('model'))
    trim = re.sub(r'\bF[\s-]Sport\b', 'FSport', str(l.get('trim') or ''), flags=re.I)  # Lexus's trim, not the RC F
    words = trim.split()
    y = num(pick(l, 'year', 'model_year', 'modelYear'))
    cands = [s for s in siblings if not s['years'] or (y and int(y) in s['years'])]
    texts = [model] + [model + norm(' '.join(words[:k])) for k in range(1, len(words) + 1)]
    hits = [(len(n), s) for s in cands for n in names(s) if n in texts]
    if hits:
        best = max(h[0] for h in hits)
        return any(s is m for n, s in hits if n == best)
    return any(n.startswith(model) and len(model) >= 2 and GENERIC.fullmatch(n[len(model):] or 'x') for n in names(m))


def clean(l, years):
    """One listing reduced to what the engine check needs, or None when it is not a usable asking price."""
    if not isinstance(l, dict):
        return None
    price = num(pick(l, 'price', 'list_price', 'listPrice', 'asking_price', 'askingPrice', 'sale_price'))
    miles = num(pick(l, 'mileage', 'miles', 'odometer'))
    year = num(pick(l, 'year', 'model_year', 'modelYear'))
    if not price or not year or price < 1500:  # under $1,500 is a monthly payment or a deposit, not a price
        return None
    year = int(year)
    if years and year not in years:
        return None
    cond = str(pick(l, 'condition', 'type', 'inventory_type') or '').lower()
    return {
        'year': year,
        'trim': str(pick(l, 'trim', 'trim_name') or '').strip()[:60],
        'price': int(round(price)),
        'miles': int(round(miles)) if miles is not None else None,
        'condition': 'new' if cond.startswith('new') else 'certified' if 'cert' in cond or 'cpo' in cond else 'used' if cond else '',
        'location': city_of(l),
        'days': l.get('daysListed') if isinstance(l.get('daysListed'), int) else None,
    }


def summary_of(body):
    """Searlo's market summary, reduced to the count and the price and mileage spread: nothing nested is copied."""
    s = body.get('market_summary') or body.get('summary') or body.get('market') if isinstance(body, dict) else None
    if not isinstance(s, dict):
        return None
    out = {'count': s['count']} if isinstance(s.get('count'), (int, float)) else {}
    for k in ('price', 'mileage'):
        if isinstance(s.get(k), dict):
            out[k] = {q: s[k][q] for q in ('min', 'median', 'max') if isinstance(s[k].get(q), (int, float))}
    return out or None


def check_key():
    """Stop at once, loudly, when Searlo refuses the key: nothing else can work and the run should show as failed."""
    s, b, _ = get('/credit/balance')
    if s in (401, 403):
        sys.exit(f'Searlo refused the key (HTTP {s}: {b.get("code") if isinstance(b, dict) else b}). Put the current key from the '
                 'Searlo dashboard in the repo secret SEARCH_API_KEY (Settings > Secrets and variables > Actions), then run again.')


def probe():
    print('balance before:', balance())
    for params in ({'make': 'Honda', 'model': 'Civic', 'location': 'Atlanta, GA'}, {'make': 'Toyota', 'model': 'Camry', 'location': 'Dallas, TX'}):
        s, b, secs = get('/vehicles/listings', params)
        cars = find_listings(b)
        kept = [c for c in (clean(x, []) for x in cars) if c]
        print(f'\n--- {params["make"]} {params["model"]} @ {params["location"]}: HTTP {s} in {secs:.1f}s, {len(cars)} cars, {len(kept)} usable')
        print(json.dumps(shape(b), indent=1)[:4000])
        print('summary:', json.dumps(summary_of(b)))
    print('\nbalance after:', balance())


def first_metro(m):
    """The model's first metro, from its name: the same every run, whatever its place in the list."""
    return METROS[zlib.crc32(f'{m["make"]}|{m["model"]}'.encode()) % len(METROS)]


def fill():
    models = json.load(open('data/searlo/models.json'))
    siblings = {}
    for m in models:
        siblings.setdefault(m['make'], []).append(m)
    done, first_city = {}, {}
    if os.path.exists(OUT):
        for line in open(OUT):
            r = json.loads(line)
            first_city.setdefault((r['make'], r['model']), r['city'])
            if r['status'] in (200, 400, 404):  # a search that failed is tried again on the next run
                done[(r['make'], r['model'], r['city'])] = (r['status'], len(r['listings']))
    start, b0 = time.time(), balance()
    if b0 is None:
        sys.exit('Cannot read the credit balance, so the budget cannot be enforced: not searching.')
    print(f'{len(models)} models, {len(done)} searches already on file, balance {b0}, budget {BUDGET}')
    lock, out = threading.Lock(), open(OUT, 'a')
    state = {'fails': 0, 'spent': 0, 'searches': 0, 'stop': ''}

    def search(m, city):
        with lock:  # reserve the dearest case before spending, so the budget can never be passed
            if state['stop'] or state['spent'] + DEAREST > BUDGET:
                state['stop'] = state['stop'] or f'budget of {BUDGET} credits reached'
                return None
            state['spent'] += DEAREST
        s, b, secs = get('/vehicles/listings', {'make': m['make'], 'model': m['query'], 'location': city})
        cars = find_listings(b) if s == 200 else []
        kept = [c for c in (clean(x, set(m['years'])) for x in cars if isinstance(x, dict) and belongs(x, m, siblings[m['make']])) if c]
        row = {'make': m['make'], 'model': m['model'], 'query': m['query'], 'city': city, 'fetched': datetime.date.today().isoformat(),
               'status': s, 'found': len(cars), 'summary': summary_of(b) if s == 200 else None, 'listings': kept}
        if s != 200:
            row['error'] = str(b.get('code') or b.get('error') or '')[:80] if isinstance(b, dict) else ''
        with lock:
            # settle the reservation with what the response says it cost
            state['spent'] += (b['credits'] if isinstance(b, dict) and isinstance(b.get('credits'), (int, float)) else DEAREST) - DEAREST
            out.write(json.dumps(row) + '\n'); out.flush()
            state['searches'] += 1
            state['fails'] = state['fails'] + 1 if s not in (200, 400, 404) else 0
            if state['fails'] >= 5:
                state['stop'] = '5 failures in a row'
        return s, len(kept), secs

    def one(m):
        if state['stop']:
            return
        c1 = first_city.get((m['make'], m['model'])) or first_metro(m)
        cities = [c1, METROS[(METROS.index(c1) + 3) % len(METROS)]] if c1 in METROS else [c1]
        for city in cities:
            if (m['make'], m['model'], city) in done:
                s, n = done[(m['make'], m['model'], city)]  # decide on the second city from the stored result
            else:
                r = search(m, city)
                if r is None:
                    return
                s, n, secs = r
                print(f'{m["make"]} {m["model"]} @ {city}: HTTP {s}, {n} usable, {secs:.0f}s', flush=True)
            if s != 200 or n >= 8 or (m['years'] and m['years'][-1] < 2012):
                break  # enough, an error, or too old to be worth a second city

    with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
        batch = []
        for i, m in enumerate(models):
            batch.append(pool.submit(one, m))
            if i % 30 == 29 or i == len(models) - 1:
                for f in batch:
                    f.result()  # a worker's exception stops the run instead of losing that model silently
                batch = []
                b = balance()
                with lock:
                    if b is not None:
                        state['spent'] = max(state['spent'], b0 - b)  # the balance can only make the count stricter
                    if (time.time() - start) / 60 >= MAX_MINUTES:
                        state['stop'] = state['stop'] or 'time limit reached; run again to resume'
                print(f'[{i + 1}/{len(models)}] {state["searches"]} searches, spent {state["spent"]}, {(time.time() - start) / 60:.0f} min', flush=True)
                if state['stop']:
                    break
    b = balance()
    print(f'done: {state["searches"]} searches, balance {b} (spent {None if b is None else b0 - b}). {state["stop"]}')


if __name__ == '__main__':
    if not KEY:
        sys.exit('SEARCH_API_KEY is not set: add it under the repo Settings > Secrets and variables > Actions.')
    check_key()
    probe() if MODE == 'probe' else fill()
