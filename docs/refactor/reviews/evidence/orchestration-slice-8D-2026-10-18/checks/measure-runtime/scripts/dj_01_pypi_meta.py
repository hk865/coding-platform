#!/usr/bin/env python3
"""Read PyPI's Django JSON (path given as argument), print the newest 5.1.x release and its sdist url/sha256/size."""
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
def key(v):
    parts = v.split('.')
    try:
        return tuple(int(p) for p in parts)
    except ValueError:
        return None
cands = []
for v, files in data['releases'].items():
    k = key(v)
    if k and k[:2] == (5, 1) and files:
        cands.append((k, v))
cands.sort()
print('all 5.1.x final releases:', ' '.join(v for _, v in cands))
v = cands[-1][1]
for f in data['releases'][v]:
    if f['packagetype'] == 'sdist':
        print('VERSION', v)
        print('URL', f['url'])
        print('SHA256', f['digests']['sha256'])
        print('SIZE', f['size'])
        print('FILENAME', f['filename'])
        print('UPLOAD', f.get('upload_time_iso_8601'))
        print('YANKED', f.get('yanked'))
