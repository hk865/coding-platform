#!/usr/bin/env python3
"""Verifier: does the agent's reference run really see system headers, and is it error-free outside the project too?

Run only as: python3 -I vf_refcheck.py REF.ndjson [REF2.ndjson]
"""
import collections, json, sys

for p in sys.argv[1:]:
    rows = {}
    for l in open(p):
        r = json.loads(l)
        rows[r['tu_index']] = r
    c = collections.Counter()
    ext_files = collections.Counter(); ext_msgs = collections.Counter(); tus_ext = []
    fnf = 0
    for r in rows.values():
        c[r['status']] += 1
        if r['status'] != 'ok':
            continue
        sev = r.get('severity_counts', {})
        errs = sev.get('3', 0) + sev.get('4', 0)
        proj = sum(1 for d in r.get('diagnostics', []) if d['severity'] >= 3)
        ext = errs - proj
        if ext:
            tus_ext.append((r['tu_rel'] or r['tu'], ext))
            for d in r.get('external_errors', []):
                ext_files[d['file']] += 1; ext_msgs[d['spelling'][:70]] += 1
        fnf += sum(1 for d in r.get('diagnostics', []) + r.get('external_errors', []) if d.get('file_not_found'))
        if r.get('entered_external_count', 0) == 0:
            c['ok_but_no_external_headers'] += 1
    print(p)
    print(' status', dict(c), 'fnf diags', fnf)
    print(' TUs with errors outside project files:', len(tus_ext), 'errors', sum(n for _, n in tus_ext))
    print(' examples', sorted(tus_ext, key=lambda x: -x[1])[:8])
    print(' external error files', ext_files.most_common(8))
    print(' external error msgs', ext_msgs.most_common(8))
