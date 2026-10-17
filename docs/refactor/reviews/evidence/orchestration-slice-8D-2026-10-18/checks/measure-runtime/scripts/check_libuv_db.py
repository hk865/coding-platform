#!/usr/bin/env python3
"""Checker (libuv): compile-database and material numbers, re-derived independently.

Run only as:  python3 -I check_libuv_db.py DB_JSON SRC_ROOT NOT_IGNORED_Z OUT_JSON
  DB_JSON        the configured compile_commands.json (data)
  SRC_ROOT       the extracted libuv tree (data; nothing in it is executed or imported)
  NOT_IGNORED_Z  NUL-separated list from MY OWN scratch git dir: git ls-files --others --exclude-standard -z
  OUT_JSON       where to write the numbers
"""
import collections
import json
import os
import shlex
import sys

CPP = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}  # L12 table


def ext_of(path):
    base = path.rsplit('/', 1)[-1]
    dot = base.rfind('.')
    return base[dot:].lower() if dot > 0 else ''


def main():
    db_path, root, listing, out = sys.argv[1:5]
    db = json.load(open(db_path))
    res = {'entries': len(db)}
    files = collections.Counter(e['file'] for e in db)
    res['distinct_files'] = len(files)
    res['multiplicity'] = dict(sorted(collections.Counter(files.values()).items()))
    # dedupe on (main file, filtered args): I filter only -o <x> and -c (output-only), keep everything else
    seen, kept, dropped = set(), [], []
    for i, e in enumerate(db):
        args = e['arguments'] if 'arguments' in e else shlex.split(e['command'])
        filt, skip = [], False
        for a in args[1:]:
            if skip:
                skip = False
                continue
            if a == '-o':
                skip = True
                continue
            if a == '-c' or a == e['file']:
                continue
            filt.append(a)
        key = (e['file'], tuple(filt))
        if key in seen:
            dropped.append(i)
            continue
        seen.add(key)
        kept.append(i)
    res['units_after_dedupe'] = len(kept)
    res['dropped_entries'] = [(i, os.path.relpath(db[i]['file'], root)) for i in dropped]
    # targets per file (from the -o object path: CMakeFiles/<target>.dir/...)
    tgt = collections.defaultdict(set)
    for e in db:
        o = e.get('output') or ''
        t = o.split('/')[1][:-4] if o.startswith('CMakeFiles/') else '?'
        tgt[os.path.relpath(e['file'], root)].add(t)
    res['targets'] = dict(collections.Counter(t for s in tgt.values() for t in s))
    res['main_outside_root'] = sum(1 for e in db if not os.path.abspath(e['file']).startswith(root.rstrip('/') + '/'))
    # material
    with open(listing, 'rb') as h:
        paths = sorted(p.decode('utf-8', 'surrogateescape') for p in h.read().split(b'\0') if p)
    claimed, lines, include_only, other = [], 0, [], 0
    by_ext, by_top = collections.Counter(), collections.Counter()
    for p in paths:
        full = os.path.join(root, p)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        e = ext_of(p)
        if e in CPP:
            data = open(full, 'rb').read()
            if len(data) > 2 * 1024 * 1024 or b'\0' in data:
                continue
            claimed.append(p)
            lines += data.count(b'\n')
            by_ext[e] += 1
            by_top[p.split('/')[0]] += 1
        else:
            other += 1
    res['git_not_ignored'] = len(paths)
    res['claimed'] = len(claimed)
    res['claimed_lines_newlines'] = lines
    res['claimed_by_ext'] = dict(by_ext)
    res['claimed_by_top'] = dict(by_top)
    db_rel = {os.path.relpath(f, root) for f in files}
    res['db_files_not_claimed'] = sorted(db_rel - set(claimed))
    res['claimed_c_not_in_db'] = len([p for p in claimed if ext_of(p) == '.c' and p not in db_rel])
    json.dump({'summary': res, 'claimed': claimed}, open(out, 'w'), indent=1)
    print(json.dumps(res, indent=1, ensure_ascii=False)[:4000])


if __name__ == '__main__':
    main()
