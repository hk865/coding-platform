#!/usr/bin/env python3
"""Write the VFS file list the production C/C++ capture would freeze (cpp-source-index.ts:7-9, 2 MiB, no NUL).

Run only as:  python3 -I vfs_filelist.py ROOT OUT.txt [--prefix P]...
  ROOT     directory to walk (data only: nothing in it is executed or imported)
  OUT.txt  relative paths (to --rel-to, default ROOT), one per line, sorted
  --rel-to write paths relative to this directory instead of ROOT (it must contain ROOT)
"""
import argparse
import collections
import json
import os
import re

SOURCE_RE = re.compile(r'\.(?:c|cc|cpp|cxx|C|h|hh|hpp|hxx|inc|ipp|inl|tcc|def)$')
IGNORED = {'.git', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime', '.venv', '__pycache__', 'node_modules'}
MAX = 2 * 1024 * 1024


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('out')
    ap.add_argument('--rel-to')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    rel_to = os.path.realpath(a.rel_to) if a.rel_to else root
    stats = collections.Counter()
    out = []
    for current, subdirs, files in os.walk(root):
        subdirs[:] = sorted(d for d in subdirs if d not in IGNORED)
        for name in sorted(files):
            full = os.path.join(current, name)
            if os.path.islink(full) or not os.path.isfile(full):
                stats['not_regular'] += 1
                continue
            extless = '.' not in name
            if not (SOURCE_RE.search(name) or extless):
                stats['other_ext'] += 1
                continue
            size = os.path.getsize(full)
            if size > MAX:
                stats['over_2MiB_extless' if extless else 'over_2MiB_source'] += 1
                continue
            with open(full, 'rb') as handle:
                data = handle.read()
            if b'\0' in data:
                stats['binary_extless' if extless else 'binary_source'] += 1
                continue
            stats['kept_extless' if extless else 'kept_source'] += 1
            stats['kept_bytes'] += size
            out.append(os.path.relpath(full, rel_to))
    out.sort()
    with open(a.out, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(out) + '\n')
    print(json.dumps(dict(stats)))


if __name__ == '__main__':
    main()
