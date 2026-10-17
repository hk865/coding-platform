#!/usr/bin/env python3
"""Seeded sample of resolved wiring sites for hand checking, and the full list of django/ wiring pairs.

    cd / && python3 -I dj_wiring_sample.py WORKSPACE INVENTORY-sites.json [--seed N] [--n 30]
"""
import json
import os
import random
import sys

ws, sites_path = sys.argv[1], sys.argv[2]
seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 20261017
n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 30
raw = json.load(open(sites_path, encoding='utf-8'))
wiring = [s for s in raw['dottedSites'] if s['kind'] in raw['wiringKinds'] and s['to']]
rng = random.Random(seed)


def line_of(rel, lineno):
    try:
        with open(os.path.join(ws, *rel.split('/')), 'rb') as h:
            return h.read().decode('utf-8-sig').splitlines()[lineno - 1].strip()[:150]
    except (OSError, IndexError):
        return '?'


print('# random sample of {} resolved wiring sites (of {})'.format(n, len(wiring)))
for i, s in enumerate(rng.sample(wiring, n), 1):
    print('{:2d} {}:{} [{}] {!r} -> {} ({}, {}) | {}'.format(i, s['from'], s['line'], s['kind'][:22], s['value'], s['to'],
                                                            s['how'], s['connection'], line_of(s['from'], s['line'])))
print()
print('# all resolved django/ wiring pairs')
seen = set()
for s in sorted(wiring, key=lambda s: (s['from'], s['line'])):
    if not s['from'].startswith('django/'):
        continue
    key = (s['from'], s['to'])
    if key in seen:
        continue
    seen.add(key)
    print('{}:{} [{}] {!r} -> {} ({})'.format(s['from'], s['line'], s['context'], s['value'], s['to'], s['connection']))
print()
ms = [s for s in raw['modelSites'] if s['to']]
print('# model reference sample (10 of {})'.format(len(ms)))
for s in rng.sample(ms, min(10, len(ms))):
    print('{}:{} {!r} [{}] -> {} ({}) | {}'.format(s['from'], s['line'], s['value'], s['context'], s['to'], s['connection'],
                                                 line_of(s['from'], s['line'])))
