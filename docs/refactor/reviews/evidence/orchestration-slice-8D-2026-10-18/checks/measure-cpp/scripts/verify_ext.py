#!/usr/bin/env python3
"""External (non-project) error counts in reference modes: mine vs the measurement's NDJSON.
Run only as: python3 -I verify_ext.py MY_REFERENCE_RAW.json THEIR_SCAN.ndjson"""
import collections
import json
import os
import sys

v = json.load(open(sys.argv[1]))
xs = sorted(sum(1 for d in t['diags'] if d.get('ext')) for t in v['tus'].values())
print('mine reference-raw external errors per TU', xs)
files = collections.Counter()
for t in v['tus'].values():
    for d in t['diags']:
        if d.get('ext'):
            files[os.path.basename(d['file'] or '?')] += 1
print(files.most_common(8))
for mode in ('reference', 'reference-raw'):
    ys = []
    for line in open(sys.argv[2]):
        r = json.loads(line)
        if r.get('mode') == mode and r.get('status') == 'ok':
            ys.append(len(r['external_errors']) + r['cursor_counts'].get('external_errors_not_listed', 0))
    print('theirs', mode, sorted(ys))
