#!/usr/bin/env python3
"""Checker (libuv): print the shape of one record of the prototype's NDJSON (to write my own reader).
Run only as: python3 -I check_libuv_peek.py NDJSON [TU_INDEX]"""
import json
import sys

idx = int(sys.argv[2]) if len(sys.argv) > 2 else 0
with open(sys.argv[1]) as h:
    for i, line in enumerate(h):
        if i != idx:
            continue
        o = json.loads(line)
        for k, v in o.items():
            if isinstance(v, list):
                print(k, 'list', len(v))
                for x in v[:3]:
                    print('   ', json.dumps(x)[:600])
            elif isinstance(v, dict):
                print(k, json.dumps(v)[:600])
            else:
                print(k, repr(v)[:200])
        break
