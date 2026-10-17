#!/usr/bin/env python3
"""Checker (libuv): skipped (inactive) preprocessor ranges, light vs reference (libclang with system headers), from the
two raw NDJSON files; plus the -H run's total time.  Project files only; kept units only.
Run only as: python3 -I check_libuv_skipped.py LIGHT_NDJSON REF_NDJSON GCC_H_NDJSON SRC_ROOT EVAL_JSON"""
import collections
import json
import os
import re
import sys


def load(path, root):
    per = {}
    for line in open(path):
        o = json.loads(line)
        s = set()
        for r in o.get('skipped_ranges', []):
            f = os.path.normpath(r['file'])
            if f.startswith(root + '/'):
                s.add((f[len(root) + 1:], r['start_line'], r['end_line']))
        per[o['tu_index']] = s
    return per


def main():
    light, ref, gch, root, ev = sys.argv[1:6]
    root = root.rstrip('/')
    L, R = load(light, root), load(ref, root)
    claimed = set(json.load(open(ev))['status'])
    only_l, only_r, units_diff = set(), set(), 0
    for i in L:
        a = {x for x in L[i] if x[0] in claimed}
        b = {x for x in R.get(i, set()) if x[0] in claimed}
        if a != b:
            units_diff += 1
        only_l |= a - b
        only_r |= b - a
    files = {x[0] for x in only_l | only_r}
    # group: ranges that overlap in the same file form one group
    groups = 0
    byf = collections.defaultdict(list)
    for x in only_l | only_r:
        byf[x[0]].append((x[1], x[2]))
    inc_groups = []
    for f, rs in byf.items():
        rs.sort()
        cur = None
        src = open(os.path.join(root, f), encoding='utf-8', errors='replace').read().split('\n')
        for s, e in rs:
            if cur is None or s > cur[1]:
                if cur is not None:
                    groups += 1
                    if any(re.match(r'\s*#\s*include', src[k - 1]) for k in range(cur[0], min(cur[1], len(src)) + 1)):
                        inc_groups.append((f, cur))
                cur = [s, e]
            else:
                cur[1] = max(cur[1], e)
        if cur is not None:
            groups += 1
            if any(re.match(r'\s*#\s*include', src[k - 1]) for k in range(cur[0], min(cur[1], len(src)) + 1)):
                inc_groups.append((f, cur))
    ms = [json.loads(line).get('ms', 0) for line in open(gch)]
    print(json.dumps({'ranges_only_light': len(only_l), 'ranges_only_reference': len(only_r),
                      'sum': len(only_l) + len(only_r), 'files': len(files), 'overlap_groups': groups,
                      'groups_containing_include': inc_groups, 'units_with_any_difference': units_diff,
                      'gcc_H_records': len(ms), 'gcc_H_sum_s': round(sum(ms) / 1000, 2)}, indent=1))


if __name__ == '__main__':
    main()
