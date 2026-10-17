#!/usr/bin/env python3
"""Checker (ros2-demos): recount the compile databases straight from the per-package build dirs.

Run only as: python3 -I check_ros2-demos_db.py SRC BUILD OUT_JSON
Reads every BUILD/<pkg>/compile_commands.json (data only), counts entries, where the main file lives
(source tree vs build tree, and which generator produced build-tree files), duplicates by main file,
and inventories every distinct compiler flag name so the checker can see nothing executes plugins.
Writes OUT_JSON with the unit list (first entry per distinct source main file) for the next scripts.
"""
import collections
import glob
import json
import os
import shlex
import sys


def main():
    src, build, out = sys.argv[1], sys.argv[2], sys.argv[3]
    dbs = sorted(glob.glob(os.path.join(build, '*', 'compile_commands.json')))
    entries = []
    per_pkg = {}
    for db in dbs:
        pkg = os.path.basename(os.path.dirname(db))
        rows = json.load(open(db, encoding='utf-8'))
        per_pkg[pkg] = len(rows)
        for r in rows:
            args = r.get('arguments') or shlex.split(r['command'])
            entries.append({'pkg': pkg, 'file': os.path.normpath(os.path.join(r['directory'], r['file'])),
                            'directory': r['directory'], 'args': args})
    where = collections.Counter()
    build_kind = collections.Counter()
    for e in entries:
        f = e['file']
        if f.startswith(src + '/'):
            where['source'] += 1
        elif f.startswith(build + '/'):
            where['build'] += 1
            rest = f[len(build) + 1:]
            if 'rosidl_' in rest:
                build_kind['rosidl'] += 1
            elif '/rclcpp_components/' in rest:
                build_kind['rclcpp_components node_main'] += 1
            else:
                build_kind['other:' + rest] += 1
        else:
            where['other'] += 1
    src_entries = [e for e in entries if e['file'].startswith(src + '/')]
    by_file = collections.defaultdict(list)
    for e in src_entries:
        by_file[e['file']].append(e)
    dupes = {os.path.relpath(f, src): [x['pkg'] for x in v] for f, v in by_file.items() if len(v) > 1}
    # do duplicate entries differ in flags?
    dup_differ = {}
    for f, v in by_file.items():
        if len(v) > 1:
            norm = set(tuple(a for a in x['args'] if not a.startswith('-o') and not a.endswith('.o')) for x in v)
            dup_differ[os.path.relpath(f, src)] = len(norm)
    flagnames = collections.Counter()
    for e in entries:
        for a in e['args'][1:]:
            if a.startswith('-'):
                name = a.split('=', 1)[0]
                if name.startswith('-I') or name.startswith('-D') or name.startswith('-W') or name.startswith('-std'):
                    name = name[:2] if not name.startswith('-std') else '-std'
                flagnames[name] += 1
    compilers = collections.Counter(e['args'][0] for e in entries)
    units = []
    for f in sorted(by_file):
        e = by_file[f][0]
        units.append({'file': f, 'rel': os.path.relpath(f, src), 'directory': e['directory'], 'args': e['args'], 'pkg': e['pkg']})
    res = {'databases': len(dbs), 'per_pkg': per_pkg, 'entries': len(entries), 'where': dict(where),
           'build_kind': dict(build_kind), 'source_entries': len(src_entries),
           'distinct_source_files': len(by_file), 'duplicate_entries_dropped': len(src_entries) - len(by_file),
           'duplicates': dupes, 'duplicate_distinct_flagsets': dup_differ,
           'flag_names': dict(flagnames.most_common()), 'compilers': dict(compilers), 'units': units}
    json.dump(res, open(out, 'w'), indent=1)
    for k, v in res.items():
        if k != 'units':
            print(k, json.dumps(v, ensure_ascii=False))


if __name__ == '__main__':
    main()
