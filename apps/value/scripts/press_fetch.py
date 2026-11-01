"""Step 2 of the press-site job: fetch the pricing pages listed in data/press/<site>/urls.txt
and save each as plain text (data/press/<site>/pages/<name>.txt). One page every 3 seconds;
skips pages already saved; robots.txt was checked when the list was built."""
import html, os, re, time, urllib.request, urllib.error

UA = 'QueenCityMyCarValue/1.0 (price research; https://github.com/lasting-oasis/queen_city_mycarvalue)'
for site in sorted(os.listdir('data/press')):
    path = f'data/press/{site}/urls.txt'
    if not os.path.isfile(path):
        continue
    os.makedirs(f'data/press/{site}/pages', exist_ok=True)
    for url in [u.strip() for u in open(path) if u.strip()]:
        name = re.sub(r'[^a-z0-9\-]+', '-', url.lower().split('://', 1)[1])[-120:].strip('-')
        out = f'data/press/{site}/pages/{name}.txt'
        if os.path.exists(out):
            continue
        time.sleep(3)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
                text = r.read().decode('utf-8', 'replace')
        except Exception as e:
            print('fail', url, e); continue
        text = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', text)
        text = re.sub(r'(?i)</(p|div|tr|li|h\d|table)>|<br\s*/?>', '\n', text)
        text = re.sub(r'(?i)</t[dh]>', ' | ', text)
        text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
        text = '\n'.join(re.sub(r'[ \t]+', ' ', l).strip() for l in text.splitlines())
        text = re.sub(r'\n{3,}', '\n\n', text)
        open(out, 'w').write(url + '\n\n' + text)
        print('saved', url)
