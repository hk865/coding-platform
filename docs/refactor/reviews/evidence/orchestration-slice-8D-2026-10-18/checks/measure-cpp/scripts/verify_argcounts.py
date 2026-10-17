#!/usr/bin/env python3
"""Occurrence / distinct-value / TU counts for -I, -isystem, -D, -march=native.  Run only as: python3 -I verify_argcounts.py DB ROOT"""
import collections
import json
import os
import sys

db = json.load(open(sys.argv[1]))
root = os.path.realpath(sys.argv[2])
occ, vals, tus = collections.Counter(), collections.defaultdict(set), collections.defaultdict(set)
joined = collections.Counter()
for k, e in enumerate(db):
    raw = e['arguments']
    i = 1
    while i < len(raw):
        a = raw[i]
        for o in ('-isystem', '-I', '-D'):
            if a == o or (o != '-isystem' and a.startswith(o) and a != o):
                v = raw[i + 1] if a == o else a[len(o):]
                joined[(o, a != o)] += 1
                occ[o] += 1
                vals[o].add(v)
                tus[o].add(k)
                if a == o:
                    i += 1
                break
        if a == '-march=native':
            occ[a] += 1
            tus[a].add(k)
        i += 1
inside = sum(1 for v in vals['-isystem'] if os.path.normpath(v).startswith(root + '/'))
for o in ('-I', '-isystem', '-D', '-march=native'):
    print(o, 'occurrences', occ[o], 'distinct', len(vals[o]), 'TUs', len(tus[o]))
print('joined/separate', dict(joined), 'isystem inside root', inside)
