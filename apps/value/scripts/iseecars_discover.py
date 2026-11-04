"""Find every iSeeCars price page without guessing names, from three free sources:
  1. iSeeCars' own sitemap (robots.txt allows /sitemap)      -> data/iseecars/sitemap-urls.txt
  2. The Wayback Machine's CDX index of archived copies        -> data/iseecars/wayback.tsv (url, timestamp)
  3. Common Crawl's index (latest crawls)                      -> data/iseecars/commoncrawl.jsonl (url, warc file, offset, length)
Archived copies can be read later without touching iSeeCars at all. Writes data/iseecars/discover-summary.json."""
import gzip, json, re, time, urllib.parse, urllib.request, urllib.error, collections

UA = 'QueenCityMyCarValue/1.0 (price research; https://github.com/lasting-oasis/queen_city_mycarvalue)'
PRICE = re.compile(r'/car/(\d{4})-([a-z0-9_\-]+)-price/?$')
summary = {}

def get(url, tries=3, timeout=120):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                if url.endswith('.gz') or data[:2] == b'\x1f\x8b':
                    data = gzip.decompress(data)
                return r.status, data.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and i < tries - 1:
                time.sleep(20 * (i + 1)); continue
            return e.code, ''
        except Exception as e:
            if i < tries - 1: time.sleep(10); continue
            return 0, str(e)
    return 0, ''

def by_year(urls):
    c = collections.Counter()
    for u in urls:
        m = PRICE.search(u)
        if m: c[int(m.group(1))] += 1
    return dict(sorted(c.items()))

# 1. Sitemap
site = 'https://www.iseecars.com'
found, seen, queue, n = set(), set(), [], 0
for cand in ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/', '/sitemaps.xml', '/sitemap.xml.gz']:
    code, xml = get(site + cand); time.sleep(2)
    summary[f'sitemap{cand}'] = code
    if code == 200 and '<' in xml:
        queue.append((site + cand, xml)); break
while queue and n < 150:
    url, xml = queue.pop(0)
    if url in seen: continue
    seen.add(url); n += 1
    for loc in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml):
        if PRICE.search(loc): found.add(loc)
        elif re.search(r'sitemap|\.xml(\.gz)?$', loc, re.I) and loc not in seen:
            time.sleep(2); c, x = get(loc)
            if c == 200: queue.append((loc, x))
open('data/iseecars/sitemap-urls.txt', 'w').write('\n'.join(sorted(found)) + ('\n' if found else ''))
summary['sitemap_files_read'] = n; summary['sitemap_price_urls'] = len(found); summary['sitemap_by_year'] = by_year(found)
print('sitemap', summary['sitemap_price_urls'], summary['sitemap_by_year'])

# 2. Wayback CDX
q = urllib.parse.urlencode({'url': 'www.iseecars.com/car/*', 'output': 'json', 'fl': 'original,timestamp,statuscode',
                            'filter': 'statuscode:200', 'collapse': 'urlkey', 'limit': 300000})
code, body = get('https://web.archive.org/cdx/search/cdx?' + q, timeout=300)
wb = {}
if code == 200 and body.strip():
    rows = json.loads(body)[1:]
    for u, ts, st in rows:
        if PRICE.search(u): wb[u] = max(ts, wb.get(u, ''))
open('data/iseecars/wayback.tsv', 'w').write(''.join(f'{u}\t{ts}\n' for u, ts in sorted(wb.items())))
summary['wayback_status'] = code; summary['wayback_price_urls'] = len(wb); summary['wayback_by_year'] = by_year(wb)
print('wayback', code, len(wb), summary['wayback_by_year'])

# 3. Common Crawl index, latest 6 crawls
code, body = get('https://index.commoncrawl.org/collinfo.json')
crawls = [c['id'] for c in json.loads(body)][:6] if code == 200 else []
cc = {}
for cid in crawls:
    time.sleep(5)
    q = urllib.parse.urlencode({'url': 'www.iseecars.com/car/*', 'output': 'json', 'filter': '=status:200'})
    c, body = get(f'https://index.commoncrawl.org/{cid}-index?{q}', timeout=300)
    k = 0
    for line in body.splitlines():
        try: r = json.loads(line)
        except Exception: continue
        if PRICE.search(r.get('url', '')) and r['url'] not in cc:
            cc[r['url']] = {'crawl': cid, 'filename': r['filename'], 'offset': int(r['offset']), 'length': int(r['length'])}; k += 1
    summary[f'cc_{cid}'] = {'status': c, 'new_price_urls': k}
    print('commoncrawl', cid, c, k)
open('data/iseecars/commoncrawl.jsonl', 'w').write(''.join(json.dumps({'url': u, **v}) + '\n' for u, v in sorted(cc.items())))
summary['cc_price_urls'] = len(cc); summary['cc_by_year'] = by_year(cc)
allu = set(found) | set(wb) | set(cc)
summary['any_source_price_urls'] = len(allu); summary['any_by_year'] = by_year(allu)
json.dump(summary, open('data/iseecars/discover-summary.json', 'w'), indent=1)
print(json.dumps(summary['any_by_year']))
