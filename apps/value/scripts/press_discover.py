"""Step 1 of the press-site job: find manufacturer pricing announcements.

For each newsroom it reads robots.txt, follows the sitemaps it lists (or
/sitemap.xml), and saves every URL that looks like a pricing release for model
years 2010-2026. Pages themselves are fetched in step 2, once the URL patterns
and robots rules have been checked. One request every 2 seconds per site.

Output: data/press/<site>/robots.txt, data/press/<site>/urls.txt, data/press/summary.json
"""
import gzip, json, os, re, time, urllib.request, urllib.error, urllib.robotparser

UA = 'QueenCityMyCarValue/1.0 (price research; https://github.com/lasting-oasis/queen_city_mycarvalue)'
SITES = {
    'honda': 'https://hondanews.com',
    'nissan': 'https://usa.nissannews.com',
    'kia': 'https://www.kiamedia.com',
    'subaru': 'https://media.subaru.com',
    'hyundai': 'https://www.hyundainews.com',
    'stellantis': 'https://media.stellantisnorthamerica.com',
    'mazda': 'https://news.mazdausa.com',
    'toyota': 'https://pressroom.toyota.com',
    'ford': 'https://media.ford.com',
    'gm': 'https://news.gm.com',
}
PRICE = re.compile(r'pric|msrp|sticker', re.I)
YEAR = re.compile(r'20(1\d|2[0-6])')
MAX_REQ = 120

def get(url):
    time.sleep(2)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            if url.endswith('.gz') or data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            return r.status, data.decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)

summary = {}
for name, base in SITES.items():
    d = f'data/press/{name}'; os.makedirs(d, exist_ok=True)
    code, robots = get(base + '/robots.txt')
    open(f'{d}/robots.txt', 'w').write(robots if code == 200 else f'# HTTP {code}\n')
    rp = urllib.robotparser.RobotFileParser(); rp.parse(robots.splitlines() if code == 200 else [])
    queue = re.findall(r'(?im)^sitemap:\s*(\S+)', robots) or [base + '/sitemap.xml']
    seen, urls, n = set(), set(), 0
    while queue and n < MAX_REQ:
        sm = queue.pop(0)
        if sm in seen: continue
        seen.add(sm); n += 1
        c, xml = get(sm)
        if c != 200: continue
        for loc in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml):
            if re.search(r'sitemap|\.xml(\.gz)?$', loc, re.I):
                queue.append(loc)
            elif PRICE.search(loc) and YEAR.search(loc):
                urls.add(loc)
    allowed = sorted(u for u in urls if rp.can_fetch(UA, u))
    open(f'{d}/urls.txt', 'w').write('\n'.join(allowed) + '\n')
    summary[name] = {'robots': code, 'sitemaps_read': n, 'pricing_urls': len(urls), 'allowed': len(allowed)}
    print(name, summary[name])
json.dump(summary, open('data/press/summary.json', 'w'), indent=1)
