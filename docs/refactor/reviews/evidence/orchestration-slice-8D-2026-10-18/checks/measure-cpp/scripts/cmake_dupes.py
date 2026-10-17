"""Duplicate TUs (same source listed more than once) and whether their adapter-kept arguments differ.

Usage: python3 -I cmake_dupes.py <compile_commands.json>
"""
import collections
import json
import shlex
import sys

db = json.load(open(sys.argv[1], encoding='utf-8'))
by_file = collections.defaultdict(list)
for e in db:
    raw = e.get('arguments') or shlex.split(e['command'], posix=True)
    kept, i = [], 1
    while i < len(raw):
        a = raw[i]
        if a in ('-o', '-MF', '-MT', '-MQ', '-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U', '-x'):
            if a not in ('-o', '-MF', '-MT', '-MQ'):
                kept += [a, raw[i + 1]]
            i += 2
            continue
        if a.startswith('-') and a != '-c':
            kept.append(a)
        i += 1
    by_file[e['file']].append((e['directory'], e.get('output'), tuple(kept)))
for f, rows in by_file.items():
    if len(rows) > 1:
        variants = len({r[2] for r in rows})
        print(json.dumps({'file': f.split('/cmake-3.30.5/')[-1], 'entries': len(rows), 'distinct_kept_arg_lists': variants,
                          'outputs': [r[1] for r in rows]}))
