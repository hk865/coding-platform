#!/usr/bin/env python3
"""Small extra checks on my light run.  Run only as: python3 -I verify_misc.py MY_LIGHT.json"""
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_analyze as V  # noqa: E402  (my own analysis module, same folder)

run = json.load(open(sys.argv[1]))
root = run['root']
V.ROOT[0] = root
keys = list(run['tus'])
status, reach, fails = V.aggregate(run, keys)
print('R1 parsed:', sorted(os.path.relpath(f, root) for f in status if status[f]['R1'] == 'parsed'))
print('avg project files entered per TU: %.2f' % (sum(len(run['tus'][k]['entered']) for k in keys) / len(keys)))
first_lines = []
for k in keys:
    tu = run['tus'][k]
    miss = [d for d in tu['diags'] if not d.get('ext') and d['fnf'] == 'missing' and d['key'] is not None]
    d = min(miss, key=lambda x: x['key'])
    first_lines.append((os.path.relpath(tu['src'], root).split('/')[-1], os.path.relpath(d['file'], root).split('/')[-1], d['line'], d['sp'][:40]))
print('first missing include per TU:', first_lines)
