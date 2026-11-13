"""Dealer asking prices for every model on the value page, from Searlo's vehicle listings endpoint
(GET /api/v1/vehicles/listings, key SEARCH_API_KEY; 1 credit per search plus 1 per dealer page read).

MODE=probe  a few calls, printing only the response's shape (field names, types, counts), the market
            summary and the credit balance, so the format can be checked before spending real credits.
MODE=fill   one search per model in data/searlo/models.json (hand-set models first, then newest first),
            each in one of a set of large metros, a second metro when the first finds fewer than 8 cars.
            Appends to data/searlo/listings.jsonl and skips what is already there, so it resumes.
            Stops at BUDGET credits spent, at MAX_MINUTES, or after 5 failures in a row.

Kept per listing: year, trim, price, mileage, condition and the dealer's city and state. Never kept or
printed: VINs, dealer names, street addresses, phone numbers or links (the repo and its logs are public)."""
import concurrent.futures, datetime, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request

BASE = 'https://api.searlo.tech/api/v1'
KEY = os.environ.get('SEARCH_API_KEY', '').strip()
MODE = os.environ.get('MODE', 'probe')
BUDGET = int(os.environ.get('BUDGET', '6000'))
MAX_MINUTES = float(os.environ.get('MAX_MINUTES', '300'))
WORKERS = int(os.environ.get('WORKERS', '3'))
OUT = 'data/searlo/listings.jsonl'
METROS = ['Dallas, TX', 'Atlanta, GA', 'Phoenix, AZ', 'Chicago, IL', 'Charlotte, NC', 'Houston, TX', 'Denver, CO', 'Orlando, FL']
SECRET = re.compile(r'vin|dealer|address|street|phone|url|link|href|email|website|seller|name|zip|postal|lat|lon|geo|image|photo|id$', re.I)

if not KEY:
    sys.exit('SEARCH_API_KEY is not set: add it under the repo Settings > Secrets and variables > Actions.')


def get(path, params=None, tries=4):
    """GET a JSON endpoint. Returns (status, body, seconds). Retries 429 (after Retry-After), AT_CAPACITY and 5xx."""
    url = f'{BASE}{path}' + ('?' + urllib.parse.urlencode(params) if params else '')
    req = urllib.request.Request(url, headers={'x-api-key': KEY, 'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'})
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
            code = json.dumps(body)[:200]
            if e.code == 429 or 'AT_CAPACITY' in code or e.code >= 500:
                wait = float(e.headers.get('Retry-After') or 0) or 15 * (attempt + 1)
                time.sleep(min(wait, 120))
                continue
            return e.code, body, time.time() - t0
        except Exception as e:  # timeouts, resets
            if attempt == tries - 1:
                return 0, {'error': str(e)[:200]}, time.time() - t0
            time.sleep(10 * (attempt + 1))
    return 0, {'error': 'gave up after retries'}, 0


def shape(v, depth=0):
    """The structure of a response with every value that could name a dealer or a car hidden."""
    if depth > 4:
        return '...'
    if isinstance(v, dict):
        return {k: (f'<{type(x).__name__}{" len " + str(len(x)) if isinstance(x, (str, list)) else ""}>' if SECRET.search(k) and not isinstance(x, (dict, list)) else shape(x, depth + 1)) for k, x in v.items()}
    if isinstance(v, list):
        return [f'{len(v)} items', shape(v[0], depth + 1)] if v else []
    return v


def balance():
    s, b, _ = get('/credit/balance')
    if s != 200:
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


def norm(x):
    return re.sub(r'[^a-z0-9]+', '', str(x or '').lower())


def belongs(l, m, siblings):
    """The listing is this model, not a sibling the search also matched (a Civic Type R in a Civic search):
    of this make's models, the one with the longest name the listing's model and trim start with must be this one."""
    if norm(l.get('make')) and norm(l.get('make')) != norm(m['make']):
        return False
    text = norm(l.get('model')) + norm(l.get('trim'))
    names = [n for n in siblings if text.startswith(norm(n))]
    if not names:
        # a shorter dealer name for the same car ("Dakota" for our "Dakota Pickup") counts; nothing else does
        lm = norm(l.get('model'))
        return text.startswith(norm(m['query'])) or (len(lm) >= 3 and norm(m['query']).startswith(lm)) or not lm
    return max(names, key=lambda n: len(norm(n))) == m['query']


def clean(l, years):
    """One listing reduced to what the calibration needs, or None when it is not a usable asking price."""
    if not isinstance(l, dict):
        return None
    price = num(pick(l, 'price', 'list_price', 'listPrice', 'asking_price', 'askingPrice', 'sale_price'))
    miles = num(pick(l, 'mileage', 'miles', 'odometer'))
    year = num(pick(l, 'year', 'model_year', 'modelYear'))
    if not price or not year or price < 1500 or price > 400000:
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
    s = body.get('market_summary') or body.get('summary') or body.get('market') if isinstance(body, dict) else None
    if not isinstance(s, dict):
        return None
    return {k: v for k, v in s.items() if isinstance(v, (int, float, str, dict)) and not SECRET.search(k)}


def check_key():
    """Stop at once, loudly, when Searlo refuses the key: nothing else can work and the run should show as failed."""
    s, b, _ = get('/credit/balance')
    if s in (401, 403):
        sys.exit(f'Searlo refused the key (HTTP {s}: {b.get("code") if isinstance(b, dict) else b}). Put the current key from the '
                 'Searlo dashboard in the repo secret SEARCH_API_KEY (Settings > Secrets and variables > Actions), then run again.')


def probe():
    print('balance before:', balance())
    for params in ({'make': 'Honda', 'model': 'Civic', 'location': 'Atlanta, GA'}, {'make': 'Toyota', 'model': 'Camry'}):
        s, b, secs = get('/vehicles/listings', params)
        cars = find_listings(b)
        print(f'\n--- {params}: HTTP {s} in {secs:.1f}s, {len(cars)} cars')
        print(json.dumps(shape(b), indent=1)[:4000])
        kept = [c for c in (clean(x, []) for x in cars) if c]
        print(f'usable: {len(kept)}; years {sorted({c["year"] for c in kept})}; cities {sorted({c["location"] for c in kept})[:8]}')
        print('first three, as kept:', json.dumps(kept[:3]))
        print('summary:', json.dumps(summary_of(b) if isinstance(b, dict) else None))
    print('\nbalance after:', balance())


def fill():
    models = json.load(open('data/searlo/models.json'))
    siblings = {}
    for m in models:
        siblings.setdefault(m['make'], []).append(m['query'])
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            r = json.loads(line)
            done.add((r['make'], r['model'], r['city']))
    start, b0 = time.time(), balance()
    print(f'{len(models)} models, {len(done)} searches already on file, balance {b0}, budget {BUDGET}')
    lock, out = threading.Lock(), open(OUT, 'a')
    state = {'fails': 0, 'spent': 0, 'searches': 0, 'stop': ''}

    def search(m, city):
        s, b, secs = get('/vehicles/listings', {'make': m['make'], 'model': m['query'], 'location': city})
        cars = find_listings(b) if s == 200 else []
        kept = [c for c in (clean(x, set(m['years'])) for x in cars if belongs(x, m, siblings[m['make']])) if c]
        row = {'make': m['make'], 'model': m['model'], 'query': m['query'], 'city': city, 'fetched': datetime.date.today().isoformat(),
               'status': s, 'found': len(cars), 'summary': summary_of(b) if s == 200 and isinstance(b, dict) else None, 'listings': kept}
        if s != 200:
            row['error'] = json.dumps(b)[:160]
        with lock:
            out.write(json.dumps(row) + '\n'); out.flush()
            state['searches'] += 1
            state['fails'] = state['fails'] + 1 if s not in (200, 400, 404) else 0
        return s, len(kept), secs

    def one(m, i):
        if state['stop']:
            return
        cities = [METROS[i % len(METROS)], METROS[(i + 3) % len(METROS)]]
        for j, city in enumerate(cities):
            if (m['make'], m['model'], city) in done:
                continue
            s, n, secs = search(m, city)
            print(f'{m["make"]} {m["model"]} @ {city}: HTTP {s}, {n} usable, {secs:.0f}s', flush=True)
            if s != 200 or n >= 8 or (m['years'] and m['years'][-1] < 2012):
                break  # enough, an error, or too old to be worth a second city

    with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
        futures = []
        for i, m in enumerate(models):
            futures.append(pool.submit(one, m, i))
            # every 30 models: check the clock, the credits spent and the failures before queueing more
            if i % 30 == 29:
                concurrent.futures.wait(futures)
                futures = []
                b = balance()
                if b is not None and b0 is not None:
                    state['spent'] = b0 - b
                print(f'[{i + 1}/{len(models)}] {state["searches"]} searches, spent {state["spent"]}, {(time.time() - start) / 60:.0f} min', flush=True)
                if state['spent'] >= BUDGET: state['stop'] = f'budget of {BUDGET} credits reached'
                elif (time.time() - start) / 60 >= MAX_MINUTES: state['stop'] = 'time limit reached; run again to resume'
                elif state['fails'] >= 5: state['stop'] = '5 failures in a row'
                if state['stop']:
                    break
        concurrent.futures.wait(futures)
    b = balance()
    print(f'done: {state["searches"]} searches, balance {b} (spent {None if b is None or b0 is None else b0 - b}). {state["stop"]}')


check_key()
probe() if MODE == 'probe' else fill()
