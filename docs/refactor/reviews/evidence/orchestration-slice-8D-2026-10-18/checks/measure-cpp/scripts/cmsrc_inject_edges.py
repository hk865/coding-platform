#!/usr/bin/env python3
"""cmake-src: do the injected errors change the include edges FROM the target file?  (line-mapped compare)
Run only as: python3 -I cmsrc_inject_edges.py"""
import collections
import json
import os

W = os.path.expanduser('~/dsh-work/measure-cpp')
SRC = W + '/downloads/cmake-3.30.5/cmake-3.30.5'
INJ = W + '/results/cmake-src/inject'


def stream(path):
    with open(path, 'rb') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def edges(rows, target_abs, shift_from=None):
    out = set()
    for r in rows:
        for x in r.get('inclusions', []):
            if x['file'] == target_abs:
                line = x['line'] + (1 if shift_from is not None and x['line'] >= shift_from else 0)
                out.add((line, x['resolved']))
    return out


def main():
    plan = json.load(open(INJ + '/plan.json'))
    base = {m: {r['tu_index']: r for r in stream(INJ + '/baseline-%s.ndjson' % n)} for m, n in (('light', 'light-A'), ('light-bodies', 'lbodies-A'))}
    tally = collections.Counter()
    for c in plan['cases']:
        meta = json.load(open(os.path.join(INJ, c['id'], 'meta.json')))
        t = os.path.join(SRC, c['file'])
        for mode in ('light', 'light-bodies'):
            inj = list(stream(os.path.join(INJ, c['id'], mode + '.compact.ndjson')))
            b = edges([base[mode][k] for k in c['tus'] if k in base[mode]], t, meta['inj_line'])
            i = edges(inj, t)
            same = b == i
            tally[(mode, c['kind'], same)] += 1
            if not same:
                print(c['id'], mode, 'only baseline', sorted(b - i)[:3], 'only injected', sorted(i - b)[:3])
    for k in sorted(tally):
        print(k, tally[k])


if __name__ == '__main__':
    main()
