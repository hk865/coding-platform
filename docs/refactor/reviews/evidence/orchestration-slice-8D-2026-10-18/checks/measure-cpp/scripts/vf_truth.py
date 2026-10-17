#!/usr/bin/env python3
"""Verifier: rules against an edge-based truth (does the file's own outgoing directive set differ from the reference?).
Run only as: python3 -I vf_truth.py FULL_LIGHT.ndjson FULLREF_0 [FULLREF_1 ...]   (scenario A, both rooted at SRC)
"""
import collections, json, sys
def load(paths):
    rows = {}
    for p in paths:
        for l in open(p):
            r = json.loads(l); rows[r['i']] = r
    return rows
L = load([sys.argv[1]]); F = load(sys.argv[2:])
def dirs(rows):
    out = collections.defaultdict(set)
    for r in rows.values():
        if r['status'] != 'ok': continue
        for d in r['directives']:
            if d[0]:
                out[d[0]].add((d[1], d[4] if d[4] and not d[4].startswith('EXT:') else ('EXT' if d[4] else None)))
    return out
ld, rd = dirs(L), dirs(F)
# truth A: a reached file is "edges wrong" if its set of project edges differs (ignore unresolved-vs-EXT: system/build)
def proj(s):
    return {x for x in s if x[1] not in (None, 'EXT')}
wrong = {f for f in ld if proj(ld[f]) != proj(rd.get(f, set()))}
RULES = ['R0', 'R1', 'R2', 'R2lex']
reach = collections.Counter(); fail = {k: collections.Counter() for k in RULES}
for r in L.values():
    if r['status'] != 'ok': continue
    mk = [m[0] for m in r['missing'] if m[0] is not None]; fk = min(mk) if mk else None
    for f in set(r['entered']) | {r['tu']}:
        reach[f] += 1
        pf = r['per_file'].get(f)
        if not pf: continue
        fail['R1'][f] += 1
        if pf['lex'] or pf['user']: fail['R2'][f] += 1
        if pf['lex']: fail['R2lex'][f] += 1
        if pf['min_key'] is not None and (fk is None or pf['min_key'] < fk): fail['R0'][f] += 1
print('reached files', len(reach), 'whose own project edges differ from reference', len(wrong & set(reach)))
for k in RULES:
    failed = {f for f in reach if fail[k][f] >= reach[k and f] if False} if False else {f for f in reach if fail[k][f] >= reach[f]}
    tp = len(failed & wrong); fp = len(failed - wrong); fn = len((wrong & set(reach)) - failed)
    print('%-6s failed %4d | of them edges really differ %4d | edges differ but not failed %4d' % (k, len(failed), tp, fn))
r2 = {f for f in reach if fail['R2'][f] >= reach[f]}
print('R2 files with differing edges:', sorted(r2 & wrong))
