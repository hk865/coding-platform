#!/usr/bin/env python3
"""Light vs reference: project directive sites present on one side only, and conditional branches (skipped ranges)
that differ, per project file (union over the units that read the file on both sides).

Run only as:  python3 -I uv_branchdiff.py ROOT LIGHT.ndjson REF.ndjson OUT.json
"""
import collections
import json
import os
import re
import sys


def load(path):
    rows = {}
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            if line.strip():
                r = json.loads(line)
                rows[r['tu_index']] = r
    return rows


def main():
    root, lp, rp, outp = os.path.realpath(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
    L, R = load(lp), load(rp)

    def rel(p):
        return os.path.relpath(p, root) if p and (p == root or p.startswith(root + '/')) else None

    def text(f, n):
        try:
            with open(os.path.join(root, f), encoding='utf-8', errors='replace') as handle:
                lines = handle.read().split('\n')
            return lines[n - 1].strip()[:140] if 0 < n <= len(lines) else ''
        except OSError:
            return ''

    sites = {'light': collections.defaultdict(set), 'reference': collections.defaultdict(set)}
    skipped = {'light': collections.Counter(), 'reference': collections.Counter()}
    unit_diffs = collections.Counter()
    unit_examples = collections.defaultdict(list)
    for k in sorted(set(L) & set(R)):
        a, b = L[k], R[k]
        if a.get('status') != 'ok' or b.get('status') != 'ok':
            continue
        for side, row in (('light', a), ('reference', b)):
            for x in row.get('inclusions', []):
                f = rel(x['file'])
                if f:
                    t = x['resolved']
                    sites[side][(f, x['line'])].add(rel(t) if rel(t) else ('EXT' if t else None))
        ra = {(rel(s['file']), s['start_line'], s['end_line']) for s in a.get('skipped_ranges', []) if rel(s['file'])}
        rb = {(rel(s['file']), s['start_line'], s['end_line']) for s in b.get('skipped_ranges', []) if rel(s['file'])}
        for s in ra:
            skipped['light'][s] += 1
        for s in rb:
            skipped['reference'][s] += 1
        for s in ra ^ rb:
            unit_diffs[(s, 'light-only-skipped' if s in ra else 'reference-only-skipped')] += 1
            if len(unit_examples[s]) < 3:
                unit_examples[s].append(a.get('tu_rel'))
    only = {}
    for side, other in (('light', 'reference'), ('reference', 'light')):
        only[side] = sorted('%s:%d %s | %s' % (f, n, sorted(map(str, t)), text(f, n)) for (f, n), t in sites[side].items() if (f, n) not in sites[other])
    # group differing skipped ranges: per (file, start line) -> description
    diffs = []
    for (s, kind), n in sorted(unit_diffs.items()):
        f, start, end = s
        diffs.append({'file': f, 'start': start, 'end': end, 'kind': kind, 'units': n, 'first_line': text(f, start),
                      'example_units': unit_examples[s]})
    # condition lines (start of the skipped range is the #if/#elif/#else line or the line after it)
    out = {'sites_only_light': only['light'], 'sites_only_reference': only['reference'],
           'skipped_range_differences': diffs, 'distinct_ranges_differing': len({(d['file'], d['start'], d['end']) for d in diffs}),
           'files_with_differing_ranges': sorted({d['file'] for d in diffs})}
    with open(outp, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
    print('sites only light:', len(only['light']))
    for s in only['light'][:20]:
        print('  ', s)
    print('sites only reference:', len(only['reference']))
    for s in only['reference'][:20]:
        print('  ', s)
    print('distinct skipped ranges differing:', out['distinct_ranges_differing'], 'files:', out['files_with_differing_ranges'])
    for d in diffs[:60]:
        print('  %(file)s:%(start)d-%(end)d %(kind)s units=%(units)d | %(first_line)s' % d)


if __name__ == '__main__':
    main()
