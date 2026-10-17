#!/usr/bin/env python3
"""Checker (ros2-demos): compare prototype runs (measured vs the checker's reruns) and recompute timing stats.

Run only as: python3 -I check_ros2-demos_proto.py SRC NDJSON [NDJSON ...]
For each ndjson: status counts, distinct-main units, (file,line,resolved) inclusion triples over all units,
diagnostics of project files, and per-unit elapsed_ms over units kept after dedupe (first per main file).
"""
import collections
import json
import os
import statistics
import sys


def load(path, src):
    st = collections.Counter()
    trip = set()
    unres = set()
    ms = []
    seen_main = set()
    diags = collections.Counter()
    peak = 0
    for line in open(path):
        o = json.loads(line)
        st[o.get('status')] += 1
        if 'inclusions' not in o:
            continue
        main = o['tu']
        first = main not in seen_main
        seen_main.add(main)
        if first and o.get('elapsed_ms') is not None:
            ms.append(o['elapsed_ms'])
        peak = max(peak, o.get('peak_rss_kb') or 0)
        for inc in o['inclusions']:
            r = inc.get('resolved')
            key = (os.path.relpath(inc['file'], src), inc['line'])
            if r:
                trip.add(key + (os.path.relpath(r, src),))
            else:
                unres.add(key + (inc.get('delim'), inc.get('spelled')))
        for d in o.get('diagnostics') or []:
            if isinstance(d, dict):
                f = d.get('file') or ''
                if f.startswith(src + '/'):
                    diags[(d.get('severity'), d.get('category'))] += 1
    return st, trip, unres, ms, len(seen_main), diags, peak


def main():
    src = sys.argv[1]
    runs = {}
    for p in sys.argv[2:]:
        runs[p] = load(p, src)
        st, trip, unres, ms, units, diags, peak = runs[p]
        ms_s = sorted(ms)
        print(os.path.basename(p), dict(st), 'units', units, 'edge triples', len(trip), 'unresolved sites', len(unres),
              'ms n=%d sum=%.0f p50=%.2f max=%.2f' % (len(ms), sum(ms), statistics.median(ms_s), max(ms_s)) if ms else 'no ms',
              'project diags', dict(diags), 'peak_rss_kb', peak)
    paths = list(runs)
    base = runs[paths[0]]
    for p in paths[1:]:
        r = runs[p]
        print('vs', os.path.basename(paths[0]), '->', os.path.basename(p), 'edges equal:', r[1] == base[1],
              'unresolved equal:', r[2] == base[2])


if __name__ == '__main__':
    main()
