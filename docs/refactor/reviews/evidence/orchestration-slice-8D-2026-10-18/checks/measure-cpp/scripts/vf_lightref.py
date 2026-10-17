#!/usr/bin/env python3
"""Verifier: project-wide light-A vs reference edge comparison from my own full scans.
Run only as: python3 -I vf_lightref.py FULL_LIGHT.ndjson FULLREF_0.ndjson [FULLREF_1 ...]
"""
import json, sys, collections
def load(paths):
    rows = {}
    for p in paths:
        for l in open(p):
            r = json.loads(l); rows[r['i']] = r
    return rows
L = load([sys.argv[1]]); F = load(sys.argv[2:])
def collect(rows):
    trip, pairs, ext, unres, angled, errs, miss = set(), set(), set(), set(), set(), 0, 0
    for r in rows.values():
        if r['status'] != 'ok':
            continue
        errs += sum(pf['n'] for pf in r['per_file'].values()); miss += r['n_missing']
        for a in r['angled']:
            angled.add((a[2], a[3]))
        for d in r['directives']:
            if d[0] is None:
                continue
            if d[4] is None:
                unres.add((d[0], d[1]))
            elif d[4].startswith('EXT:'):
                ext.add((d[0], d[1]))
            else:
                trip.add((d[0], d[1], d[4])); pairs.add((d[0], d[4]))
    return trip, pairs, ext, unres, angled, errs, miss
lt, lp, le, lu, la, lerr, lmiss = collect(L)
rt, rp, re_, ru, ra, rerr, rmiss = collect(F)
print('light: directive edges', len(lt), 'pairs', len(lp), 'unresolved directives', len(lu))
print('ref:   directive edges', len(rt), 'pairs', len(rp), 'resolved outside root', len(re_), 'unresolved', len(ru), 'project errors', rerr, 'missing diags', rmiss)
ol, orf = lt - rt, rt - lt
ol_ang = {t for t in ol if (t[0], t[1]) in la}
print('only light', len(ol), '(angled-recovered', len(ol_ang), ')  only ref', len(orf))
# of only-ref: directive unresolved in light (target in build dir) vs directive never reached/active in light
orf_unres = {t for t in orf if (t[0], t[1]) in lu}
lsites = {(t[0], t[1]) for t in lt} | lu | le
orf_absent = {t for t in orf if (t[0], t[1]) not in lsites}
print('  only-ref whose directive is unresolved in light:', len(orf_unres), '; whose directive does not occur in light at all:', len(orf_absent))
ol_absent = {t for t in ol - ol_ang if (t[0], t[1]) not in {(x[0], x[1]) for x in rt} | ru | re_}
print('  only-light (non-angled) whose directive does not occur in ref:', len(ol_absent))
print('  examples only-light', sorted(map(str, ol - ol_ang))[:3]); print('  examples only-ref', sorted(map(str, orf_absent))[:3])
