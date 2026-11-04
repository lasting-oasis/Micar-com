"""Turn dist-single/index.html into a page fragment for Claude Artifacts."""
import re, sys
s = open('dist-single/index.html').read()
head = re.search(r'<head>(.*)</head>', s, re.S).group(1)
body = re.search(r'<body>(.*)</body>', s, re.S).group(1)
head = re.sub(r'<meta charset[^>]*>|<meta name="viewport"[^>]*>|<link rel="icon"[^>]*>', '', head)
title = re.search(r'<title>.*?</title>', head).group(0)
out = sys.argv[1] if len(sys.argv) > 1 else 'dist-single/artifact.html'
open(out, 'w').write(title + '\n<meta name="claude:viewport-fit-sides" content="cover">\n' + head.replace(title, '') + body)
