#!/usr/bin/env python3
"""How much of each project file can R0 still police?  (task b/c support)

Run only as: python3 -I r0_coverage.py --root ROOT --scan SCAN.ndjson [--mode light]
R0 ignores an error when an unresolved include comes earlier in the TU (preprocessing-order key, as in
evaluate_rules.py).  For every TU and every project file F it reaches, the part of F that still counts is the
prefix of F whose keys are smaller than the TU's first unresolved key U:
  U before F starts                     -> nothing of F counts;
  U inside F (or inside a file F includes) -> F up to the #include line that leads to U;
  U after F                             -> all of F.
A header is failed only when every TU reaching it fails it, so its policed prefix is the shortest over its TUs.
Prints, per file, the policed lines and the file's lines, and the totals.
"""
import argparse
import json
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--scan', required=True)
    ap.add_argument('--mode', default='light')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    rows = [json.loads(l) for l in open(a.scan, encoding='utf-8')]
    rows = [r for r in rows if r.get('mode') == a.mode and r.get('status') == 'ok']
    texts = {}

    def line_of(path, off):
        if path not in texts:
            texts[path] = open(path, 'rb').read()
        return texts[path].count(b'\n', 0, off) + 1

    def nlines(path):
        if path not in texts:
            texts[path] = open(path, 'rb').read()
        return texts[path].count(b'\n') + 1

    policed = {}
    for r in rows:
        # exact chain of a file = its own directives' keys minus the last element (clang_getInclusions offsets, which
        # point at the file-name token); a file without directives gets the key of the directive that includes it
        # ('#' offset, same line), which orders the same against keys on other lines.
        exact, approx = {r['tu']: []}, {}
        for x in r['inclusions']:
            if x.get('pos') is not None:
                exact.setdefault(x['file'], x['pos'][:-1])
                if x['resolved']:
                    approx[x['resolved']] = min(approx.get(x['resolved'], x['pos']), x['pos'])
        keys = [u['pos'] for u in r.get('unresolved_positions', []) if u.get('pos')]
        keys += [x['pos'] for x in r['inclusions'] if x['resolved'] is None and x.get('pos')]
        U = min(keys) if keys else None
        for f in set(r['entered_project']) | {r['tu']}:
            total = nlines(f)
            if U is None:
                cut = total
            elif f in exact:
                c = exact[f]
                if U[:len(c)] == c and len(U) > len(c):
                    cut = line_of(f, U[len(c)]) - 1
                else:
                    cut = 0 if U < c else total
            elif f in approx:
                cut = 0 if U < approx[f] else total
            else:
                cut = total  # entered only through an external file (not seen here)
            rel = os.path.relpath(f, root)
            policed[rel] = min(policed.get(rel, total), cut)
    total_lines = sum(nlines(os.path.join(root, f)) for f in policed)
    total_policed = sum(policed.values())
    for f in sorted(policed):
        print('%5d / %5d  %s' % (policed[f], nlines(os.path.join(root, f)), f))
    print(json.dumps({'mode': a.mode, 'files': len(policed), 'lines': total_lines, 'policed_lines': total_policed,
                      'files_fully_unpoliced': sum(1 for v in policed.values() if v == 0),
                      'share_policed': round(total_policed / total_lines, 4) if total_lines else None}))


if __name__ == '__main__':
    main()
