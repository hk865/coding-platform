#!/usr/bin/env python3
"""Verifier: project-wide light-B vs reference (both from my own scans), on absolute paths; project = W.
Run only as: python3 -I vf_lightrefB.py W SRC FULLB_LIGHT.ndjson FULLREF_0 [FULLREF_1 ...]
"""
import json, os, sys
W, SRC = sys.argv[1], sys.argv[2]
def ab(root, p):
    if p is None: return None
    if p.startswith('EXT:'): return p[4:]
    return os.path.normpath(os.path.join(root, p))
def collect(paths, root):
    trip, angled = set(), set()
    for p in paths:
        for l in open(p):
            r = json.loads(l)
            if r['status'] != 'ok': continue
            for a in r.get('angled', []):
                angled.add((ab(root, a[2]), a[3]))
            for d in r['directives']:
                s, t = ab(root, d[0]), ab(root, d[4])
                if s and t and t.startswith(W + '/') and s.startswith(W + '/'):
                    trip.add((s, d[1], t))
    return trip, angled
lb, la = collect([sys.argv[3]], W)
rf, _ = collect(sys.argv[4:], SRC)
ol, orf = lb - rf, rf - lb
ang = {t for t in ol if (t[0], t[1]) in la}
print('light-B directive edges', len(lb), 'ref', len(rf), 'only light', len(ol), '(angled sites', len(ang), ') only ref', len(orf))
for t in sorted(ol - ang): print('  only light, not angled:', os.path.relpath(t[0], W), t[1], '->', os.path.relpath(t[2], W))
for t in sorted(orf)[:5]: print('  only ref:', os.path.relpath(t[0], W), t[1], '->', os.path.relpath(t[2], W))
