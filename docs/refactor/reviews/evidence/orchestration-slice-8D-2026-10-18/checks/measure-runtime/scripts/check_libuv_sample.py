#!/usr/bin/env python3
"""Checker (libuv): a stratified sample for reading by eye - per directory pair up to 3 edges (with the directive's
source line), and 2 unresolved per includer directory (with the directive's source line and whether a file of that
name exists anywhere in the tree).  Deterministic (sorted, evenly spaced).
Run only as: python3 -I check_libuv_sample.py EVAL_JSON SRC_ROOT"""
import collections
import json
import os
import sys

ev, root = json.load(open(sys.argv[1])), sys.argv[2].rstrip('/')
src = {}


def line(f, n):
    if f not in src:
        src[f] = open(os.path.join(root, f), encoding='utf-8', errors='replace').read().split('\n')
    return src[f][n - 1].strip()


by = collections.defaultdict(list)
for f, ln, t in ev['edge_sites']:
    by[(os.path.dirname(f), os.path.dirname(t))].append((f, ln, t))
n = 0
for k in sorted(by):
    xs = sorted(by[k])
    pick = [xs[int(i * len(xs) / 3)] for i in range(min(3, len(xs)))]
    for f, ln, t in dict.fromkeys(pick):
        n += 1
        print('E%02d %-40s -> %-28s | %s' % (n, '%s:%d' % (f, ln), t, line(f, ln)))
# unresolved: the evaluation keeps (from, specifier); find the line from directive_sites by reading the file
allnames = {}
for d, _, fs in os.walk(root):
    for x in fs:
        allnames.setdefault(x, []).append(os.path.relpath(os.path.join(d, x), root))
byd = collections.defaultdict(list)
for f, spec, r in ev['unresolved']:
    byd[os.path.dirname(f)].append((f, spec, r))
m = 0
for d in sorted(byd):
    xs = sorted(byd[d])
    for f, spec, r in dict.fromkeys([xs[0], xs[len(xs) // 2], xs[-1]]):
        m += 1
        name = spec[1:-1]
        lines = [i + 1 for i, s in enumerate(open(os.path.join(root, f), encoding='utf-8', errors='replace').read().split('\n'))
                 if s.lstrip().startswith('#') and 'include' in s and name in s]
        same = allnames.get(os.path.basename(name), [])
        print('U%02d %-34s %-24s reason=%s lines=%s tree-files-with-that-basename=%s' % (m, f, spec, r, lines[:3], same[:2]))
print('edges sampled', n, 'unresolved sampled', m)
