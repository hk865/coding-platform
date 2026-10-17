#!/usr/bin/env python3
"""Verifier: recompute the agent's 'position of the first unresolved #include' on its light-B rows, and compare with mine.
Run only as: python3 -I vf_rankB.py THEIRS_light-B.ndjson MINE_fullB-light.ndjson
"""
import json, sys, collections
mine = {}
for l in open(sys.argv[2]):
    r = json.loads(l); mine[r['i']] = r
hist = collections.Counter(); big = []
for l in open(sys.argv[1]):
    r = json.loads(l)
    if r.get('status') != 'ok':
        continue
    unres = [(u['pos'], u['file'], u['line'], 'diag') for u in r.get('unresolved_positions', []) if u.get('pos') is not None]
    unres += [(x['pos'], x['file'], x['line'], 'dir') for x in r.get('inclusions', []) if x['resolved'] is None and x.get('pos') is not None]
    if not unres:
        continue
    first = min(unres)
    order = [x['pos'] for x in r.get('inclusions', []) if x.get('pos') is not None]
    rank = sum(1 for p in order if p < first[0])
    hist[rank] += 1
    if rank > 9:
        m = mine.get(r['tu_index'], {})
        fm = min((x for x in m.get('missing', []) if x[0] is not None), key=lambda x: x[0], default=None)
        dup = collections.Counter(tuple(x['pos']) for x in r.get('inclusions', []) if x.get('pos') is not None)
        big.append((r['tu_index'], r['tu_rel'], rank, first[1][-50:], first[2], first[3], 'mine', m.get('first_missing_rank'), fm[2][-50:] if fm else None, fm[3] if fm else None,
                    'n_incl', len(order), 'dup_pos', sum(v - 1 for v in dup.values())))
s = sorted(hist.elements())
print('their-formula ranks: n', len(s), 'p50', s[len(s)//2], 'p90', s[int(len(s)*.9)], 'max', s[-1])
for b in sorted(big, key=lambda x: -x[2])[:12]:
    print(b)
print('TUs with rank > 9:', len(big))
