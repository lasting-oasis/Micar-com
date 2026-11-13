"""A one-off test of Searlo's VIN tools, so the feedback we send them is measured, not guessed.

Takes about 50 used cars from 10 fresh listing searches, asks GET /api/v1/vehicles/{vin} about each
(price and mileage history, first and last seen, likely_sold) and /vehicles/{vin}/decode about 5,
and writes only totals to data/searlo/vin-test.json: how many VINs it knew, how much history it had,
what each call cost. VINs live only in this process's memory: they are never written or printed.
Key: SEARCH_API_KEY. Cost: roughly 50 for the searches plus whatever the VIN calls cost (measured)."""
import datetime, json, os, re, types

# Reuse searlo_listings.py's GET (with retries), key check and masking, without running its fill.
_src = open(os.path.join(os.path.dirname(__file__), 'searlo_listings.py')).read().rsplit('\ncheck_key()\n', 1)[0]
S = types.SimpleNamespace()
_ns: dict = {}
exec(compile(_src, 'searlo_listings.py', 'exec'), _ns)
S.__dict__.update({k: v for k, v in _ns.items() if not k.startswith('__')})

SEARCHES = [('Honda', 'Civic', 'Atlanta, GA'), ('Toyota', 'Camry', 'Dallas, TX'), ('Ford', 'F-150', 'Phoenix, AZ'),
            ('Chevrolet', 'Equinox', 'Chicago, IL'), ('Toyota', 'RAV4', 'Charlotte, NC'), ('Nissan', 'Rogue', 'Houston, TX'),
            ('Jeep', 'Grand Cherokee', 'Denver, CO'), ('Hyundai', 'Tucson', 'Orlando, FL'), ('Honda', 'CR-V', 'Dallas, TX'),
            ('Subaru', 'Outback', 'Denver, CO')]

S.check_key()
b0 = S.balance()
vins, listed_days = [], []
for make, model, city in SEARCHES:
    s, b, _ = S.get('/vehicles/listings', {'make': make, 'model': model, 'location': city})
    cars = [c for c in S.find_listings(b) if isinstance(c, dict) and re.fullmatch(r'[A-HJ-NPR-Z0-9]{17}', str(c.get('vin') or ''))] if s == 200 else []
    # prefer cars that have been listed a while, which are the ones a history could say something about
    cars.sort(key=lambda c: -(c.get('daysListed') or 0))
    for c in cars[:5]:
        vins.append(c['vin']); listed_days.append(c.get('daysListed') or 0)
    print(f'{make} {model} @ {city}: HTTP {s}, {len(cars)} with a VIN')
b1 = S.balance()

stats = {'asked': len(vins), 'status': {}, 'known': 0, 'with_price_history': 0, 'history_points': [], 'likely_sold': {}, 'first_seen_days_ago': [], 'fields': None, 'credits_reported': []}
today = datetime.datetime.now(datetime.timezone.utc)
for i, vin in enumerate(vins):
    s, b, _ = S.get(f'/vehicles/{vin}')
    stats['status'][str(s)] = stats['status'].get(str(s), 0) + 1
    if s != 200 or not isinstance(b, dict):
        continue
    if stats['fields'] is None:
        stats['fields'] = S.shape(b)  # the response's structure, with the VIN and dealer details masked
    data = b.get('vehicle') or b.get('data') or b
    hist = next((v for k, v in data.items() if isinstance(v, list) and 'hist' in k.lower()), None) if isinstance(data, dict) else None
    stats['known'] += 1
    if hist:
        stats['with_price_history'] += 1; stats['history_points'].append(len(hist))
    sold = data.get('likely_sold', data.get('likelySold')) if isinstance(data, dict) else None
    stats['likely_sold'][str(sold)] = stats['likely_sold'].get(str(sold), 0) + 1
    first = data.get('first_seen') or data.get('firstSeen') or data.get('firstSeenAt') if isinstance(data, dict) else None
    if isinstance(first, str):
        try:
            stats['first_seen_days_ago'].append((today - datetime.datetime.fromisoformat(first.replace('Z', '+00:00'))).days)
        except ValueError:
            pass
    if isinstance(b.get('credits'), (int, float)):
        stats['credits_reported'].append(b['credits'])
b2 = S.balance()

decode = {'status': {}, 'fields': None}
for vin in vins[:5]:
    s, b, _ = S.get(f'/vehicles/{vin}/decode')
    decode['status'][str(s)] = decode['status'].get(str(s), 0) + 1
    if s == 200 and decode['fields'] is None:
        decode['fields'] = S.shape(b)
b3 = S.balance()

spent = lambda a, z: None if a is None or z is None else a - z  # noqa: E731
out = {
    'date': today.date().isoformat(),
    'listing_searches': len(SEARCHES), 'credits_for_searches': spent(b0, b1),
    'vin_lookups': stats['asked'], 'credits_for_vin_lookups': spent(b1, b2), 'credits_for_5_decodes': spent(b2, b3),
    'vin_status': stats['status'], 'vins_known': stats['known'], 'with_price_history': stats['with_price_history'],
    'history_points_median': sorted(stats['history_points'])[len(stats['history_points']) // 2] if stats['history_points'] else 0,
    'likely_sold_values': stats['likely_sold'],
    'first_seen_days_ago_median': sorted(stats['first_seen_days_ago'])[len(stats['first_seen_days_ago']) // 2] if stats['first_seen_days_ago'] else None,
    'days_listed_median_at_search': sorted(listed_days)[len(listed_days) // 2] if listed_days else None,
    'credits_reported_per_vin': sorted(set(stats['credits_reported'])),
    'vin_response_shape': stats['fields'], 'decode_status': decode['status'], 'decode_response_shape': decode['fields'],
}
os.makedirs('data/searlo', exist_ok=True)
json.dump(out, open('data/searlo/vin-test.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if not k.endswith('shape')}, indent=1))
print('VIN response shape:', json.dumps(out['vin_response_shape'], indent=1)[:3000])
print('decode response shape:', json.dumps(out['decode_response_shape'], indent=1)[:1500])
