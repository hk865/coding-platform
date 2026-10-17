#!/usr/bin/env python3
"""Checker (libuv): files the light scan skipped (never compiled here) - my own textual #include census, and the
platform experiment's extra edges re-derived from its raw output with my own evaluator's results.

Run only as: python3 -I check_libuv_neverc.py SRC_ROOT EVAL_A_JSON OUT_JSON [EVAL_P_JSON ...]
Textual rule (no conditionals): every '#include' line (comments blanked); quoted: the includer's directory, then
include/, then src/ (the database's -I list); angled: include/, then src/.
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_libuv_runtime import strip_c  # noqa: E402  (my own helper, same folder)


def main():
    root, eval_a, out = sys.argv[1:4]
    root = root.rstrip('/')
    ev = json.load(open(eval_a))
    status = ev['status']
    edges = {tuple(e) for e in ev['edges']}
    dpairs = {(os.path.dirname(a), os.path.dirname(b)) for a, b in edges}
    skipped = sorted(f for f, s in status.items() if s == 'skipped')
    lines, pairs, unres_q, unres_a = 0, set(), [], 0
    for f in skipped:
        t = strip_c(open(os.path.join(root, f), encoding='utf-8', errors='replace').read())
        for m in re.finditer(r'(?m)^[ \t]*#[ \t]*include[ \t]*([<"])([^>"\n]+)[>"]', t):
            lines += 1
            delim, nm = m.group(1), m.group(2)
            cands = ([os.path.dirname(f)] if delim == '"' else []) + ['include', 'src']
            tgt = None
            for d in cands:
                q = os.path.normpath(os.path.join(d, nm))
                if q in status or os.path.isfile(os.path.join(root, q)) and q in status:
                    tgt = q
                    break
            if tgt:
                pairs.add((f, tgt))
            elif delim == '"':
                unres_q.append('%s:%d %s' % (f, t.count('\n', 0, m.start()) + 1, nm))
            else:
                unres_a += 1
    to_parsed = [p for p in pairs if status.get(p[1]) == 'parsed']
    new_dp = sorted({(os.path.dirname(a), os.path.dirname(b)) for a, b in pairs} - dpairs)
    res = {'skipped_files': len(skipped), 'include_lines': lines, 'resolved_pairs': len(pairs),
           'pairs_to_files_parsed_elsewhere': len(to_parsed), 'unresolved_quoted': unres_q,
           'unresolved_angled': unres_a, 'new_dir_pairs': len(new_dp), 'new_dir_pairs_list': new_dp,
           'light_dir_pairs': len(dpairs)}
    plat = {}
    union = set()
    for pj in sys.argv[4:]:
        pe = json.load(open(pj))
        pedges = {tuple(e) for e in pe['edges']}
        extra = pedges - edges
        union |= extra
        plat[os.path.basename(pj)] = {'units': pe['summary']['kept_units'], 'unit_status': pe['summary']['unit_status'],
                                      'edges': len(pedges), 'edges_not_in_A': len(extra),
                                      'skipped_files_read': len({f for r in pe['reads'].values() for f in r} & set(skipped)),
                                      'failure_diagnostics': pe['summary']['failure_diagnostics_count'],
                                      'per_unit_ms_sum': pe['summary']['per_unit_ms']['sum']}
    res['platform'] = plat
    res['platform_union_edges_not_in_A'] = len(union)
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps(res, indent=1)[:5000])


if __name__ == '__main__':
    main()
