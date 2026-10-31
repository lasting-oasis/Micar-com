"""Parse an iSeeCars '<year>-<make>-<model>-price' page into style rows.

Usage: python3 -I scripts/iseecars_parse.py page.html [...]  -> JSON lines
Each row: {"page", "style", "invoice", "msrp", "destination"} (dollars, ints).
"""
import html, json, re, sys

def money(s):
    s = re.sub(r'[^0-9]', '', s)
    return int(s) if s else None

def parse(text):
    m = re.search(r'<table class="table3">(.*?)</table>', text, re.S)
    if not m:
        return []
    rows = []
    for tr in re.findall(r'<tr>(.*?)</tr>', m.group(1), re.S):
        cells = [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells) >= 4 and money(cells[2]):
            rows.append({"style": re.sub(r'\s+', ' ', cells[0]), "invoice": money(cells[1]), "msrp": money(cells[2]), "destination": money(cells[3])})
    return rows

if __name__ == '__main__':
    for path in sys.argv[1:]:
        page = path.rsplit('/', 1)[-1].removesuffix('.html')
        for r in parse(open(path, encoding='utf-8', errors='replace').read()):
            print(json.dumps({"page": page, **r}))
