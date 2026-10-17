#!/usr/bin/env python3
"""cmake-src: targeted look-ups in the NDJSON runs.  Run only as: python3 -I cmsrc_probe.py RUN.ndjson ROOT REF.ndjson"""
import collections
import json
import os
import sys

RES = set(['missing', 'angled_recovered', 'typo_recovered', 'macro_unexpanded'])


def rows(path):
    with open(path, 'rb') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def main():
    run, root, ref = sys.argv[1], sys.argv[2], sys.argv[3]
    rel = lambda p: os.path.relpath(p, root) if p and p.startswith(root + '/') else None  # noqa: E731
    ref_targets = {}
    for r in rows(ref):
        for x in r.get('inclusions', []):
            ref_targets.setdefault((x['file'], x['line']), set()).add(x['resolved'])
    angled = collections.Counter()
    angled_examples = {}
    err_first = []
    for r in rows(run):
        if r.get('status') != 'ok':
            continue
        unres = [u['pos'] for u in r.get('unresolved_positions', []) if u.get('pos') is not None]
        unres += [x['pos'] for x in r.get('inclusions', []) if x['resolved'] is None and x.get('pos') is not None]
        first = min(unres) if unres else None
        errs = [d for d in r.get('diagnostics', []) if d['severity'] >= 3 and d.get('file_not_found') not in RES and rel(d.get('file'))]
        early = [d for d in errs if first is None or d.get('pos') is None or not (first < d['pos'])]
        if early:
            err_first.append({'tu': rel(r['tu']), 'first_unresolved': first, 'n_errors': len(errs), 'early': [
                '%s:%d %s [%s] pos=%s' % (rel(d['file']), d['line'], d['spelling'][:100], d['category'], d.get('pos')) for d in early[:4]]})
        incl = {(x['file'], x['line']): x for x in r.get('inclusions', [])}
        for d in r.get('diagnostics', []):
            if d.get('file_not_found') == 'angled_recovered':
                x = incl.get((d['file'], d['line']))
                key = (rel(d['file']), d['line'], x['spelled'] if x else None, rel(x['resolved']) if x and x['resolved'] else None)
                angled[key] += 1
    print('== TUs with a project error not after the first unresolved include: %d' % len(err_first))
    for e in err_first[:10]:
        print(json.dumps(e))
    print('== angled_recovered sites: %d distinct, %d TU-occurrences' % (len(angled), sum(angled.values())))
    self_edges = sum(1 for k in angled if k[0] == k[3])
    print('   resolved to the includer itself: %d' % self_edges)
    cls = collections.Counter()
    for (src, line, spelled, target), n in sorted(angled.items()):
        refset = ref_targets.get((os.path.join(root, src), line), set())
        refrel = sorted((rel(t) or ('EXTERNAL:' + t if t else 'None')) for t in refset)
        same = target in refrel
        cls['same as reference' if same else ('self' if src == target else 'different from reference')] += 1
        print('   %s:%d <%s> -> %s  (TUs %d; reference: %s)' % (src, line, spelled, target, n, ', '.join(refrel)[:150]))
    print('   classes:', dict(cls))


if __name__ == '__main__':
    main()
