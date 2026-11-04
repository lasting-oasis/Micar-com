"""Parse an iSeeCars '<year>-<make>-<model>-price' page into style rows.

Usage: python3 -I scripts/iseecars_parse.py page.html [...]  -> JSON lines
Each row: {"page", "style", "invoice", "msrp", "destination"} (dollars, ints).
Works on the current template (table.table3) and on older archived templates:
it uses whichever table has an 'MSRP' column header.
"""
import html, json, re, sys

def money(s):
    s = re.sub(r'[^0-9]', '', s or '')
    return int(s) if s else None

def cells(tr):
    return [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S | re.I)]

def parse(text):
    text = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', text)
    for table in re.findall(r'<table[^>]*>(.*?)</table>', text, re.S | re.I):
        trs = re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S | re.I)
        if not trs:
            continue
        head = [h.lower() for h in cells(trs[0])]
        if not any('msrp' in h for h in head):
            continue
        im = next(i for i, h in enumerate(head) if 'msrp' in h)
        ii = next((i for i, h in enumerate(head) if 'invoice' in h), None)
        idst = next((i for i, h in enumerate(head) if 'destination' in h), None)
        # Name column: 'Style' when present (older pages: image | Trim | Style | ...), else the first column.
        isty = next((i for i, h in enumerate(head) if h == 'style'), None)
        itrim = next((i for i, h in enumerate(head) if h == 'trim'), None)
        iname = isty if isty is not None else (itrim if itrim is not None else 0)
        rows = []
        for tr in trs[1:]:
            c = cells(tr)
            if len(c) <= im or not money(c[im]):
                continue
            name = re.sub(r'\s+', ' ', re.sub(r'\*[^*]*\*', '', c[iname] if iname < len(c) else '')).strip()
            if not name or len(name) > 90:
                continue
            rows.append({'style': name, 'invoice': money(c[ii]) if ii is not None and ii < len(c) else None,
                         'msrp': money(c[im]), 'destination': money(c[idst]) if idst is not None and idst < len(c) else None})
        if rows:
            return rows
    return []

if __name__ == '__main__':
    for path in sys.argv[1:]:
        page = path.rsplit('/', 1)[-1].removesuffix('.html')
        for r in parse(open(path, encoding='utf-8', errors='replace').read()):
            print(json.dumps({"page": page, **r}))
