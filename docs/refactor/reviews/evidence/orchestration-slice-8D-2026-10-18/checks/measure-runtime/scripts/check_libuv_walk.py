#!/usr/bin/env python3
"""Checker (libuv): non-git listing with the section-10 rule-1 skip list (.git, node_modules, .venv, venv, __pycache__,
.mypy_cache, .pytest_cache, .tox at any depth; build/dist/out/target are NOT skipped).  Regular files only.
Run only as: python3 -I check_libuv_walk.py ROOT OUT_Z"""
import os
import sys

SKIP = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox'}
root, out = sys.argv[1].rstrip('/'), sys.argv[2]
paths = []
for d, dirs, files in os.walk(root, followlinks=False):
    dirs[:] = [x for x in dirs if x not in SKIP and not os.path.islink(os.path.join(d, x))]
    for f in files:
        full = os.path.join(d, f)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        paths.append(os.path.relpath(full, root))
paths.sort()
with open(out, 'wb') as h:
    h.write(b'\0'.join(p.encode('utf-8', 'surrogateescape') for p in paths) + b'\0')
print(len(paths))
