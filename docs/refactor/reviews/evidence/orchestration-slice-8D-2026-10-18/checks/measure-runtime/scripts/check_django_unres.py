#!/usr/bin/env python3
"""Checker: classify the unresolved references of check_django_edges.py output, and draw a stratified sample of
edges and unresolved references with their source lines for a hand check.

    cd / && python3 -I check_django_unres.py WORKSPACE EDGES_ROOT.json EDGES_TESTSROOT.json OUT.json

Reads files only.
"""
import ast
import collections
import json
import os
import random
import sys


def main():
    ws, root_path, troot_path, out_path = sys.argv[1:5]
    a = json.load(open(root_path, encoding='utf-8'))
    b = json.load(open(troot_path, encoding='utf-8'))
    std = set(sys.stdlib_module_names)
    files = set()
    for cur, dirs, fns in os.walk(ws):
        for fn in fns:
            if fn.endswith('.py'):
                files.add(os.path.relpath(os.path.join(cur, fn), ws).replace(os.sep, '/'))
    resolved_with_tests = {(f, s) for f, s, r in b['unresolvedList']}
    cls = collections.Counter()
    by_scope = collections.Counter()
    nonstd_names = collections.Counter()
    project_like = []
    for f, s, r in a['unresolvedList']:
        top = f.split('/')[0]
        if r is not None:
            k = 'reason:' + r
        elif s.startswith('.'):
            k = 'relative-null'
        else:
            first = s.split('.')[0]
            if first in std:
                k = 'stdlib'
            elif (f, s) not in resolved_with_tests:
                k = 'resolves-with-tests-root'
            else:
                # does any project file end with the dotted path?
                tail = s.replace('.', '/')
                cands = sorted(p for p in files if p.endswith('/' + tail + '.py') or p.endswith('/' + tail + '/__init__.py'))
                if cands:
                    k = 'project-file-elsewhere'
                    project_like.append([f, s, cands[:3]])
                else:
                    k = 'not-stdlib-no-project-file'
                    nonstd_names[first] += 1
        cls[k] += 1
        by_scope[(k, top)] += 1
    res = {'classes': dict(cls), 'byScope': {'{} @ {}'.format(*k): v for k, v in sorted(by_scope.items())},
           'notStdlibNoProjectFileNames': dict(nonstd_names.most_common()), 'distinctNames': len(nonstd_names),
           'projectFileElsewhere': project_like}
    # stratified sample: edges by kind of statement, unresolved by class
    rnd = random.Random(20261017)
    texts = {}

    def line_of(path, spec):
        if path not in texts:
            texts[path] = open(os.path.join(ws, path), encoding='utf-8-sig').read()
        src = texts[path]
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(al.name == spec for al in node.names):
                return node.lineno, ast.get_source_segment(src, node)
            if isinstance(node, ast.ImportFrom) and '.' * (node.level or 0) + (node.module or '') == spec:
                return node.lineno, ast.get_source_segment(src, node)
        return None, None

    strata = collections.defaultdict(list)
    for f, t, s in a['edgeList']:
        if s.startswith('.'):
            k = 'relative'
        elif t.endswith('__init__.py'):
            k = 'abs->__init__'
        else:
            k = 'abs->module'
        k += ' ' + f.split('/')[0] + '->' + t.split('/')[0]
        strata[k].append((f, t, s))
    sample_e = []
    keys = sorted(strata)
    per = max(1, 40 // len(keys))
    for k in keys:
        for f, t, s in rnd.sample(strata[k], min(per, len(strata[k]))):
            ln, seg = line_of(f, s)
            sample_e.append({'stratum': k, 'from': f, 'line': ln, 'stmt': (seg or '')[:160], 'to': t})
    ustrata = collections.defaultdict(list)
    for f, s, r in a['unresolvedList']:
        first = s.split('.')[0]
        k = ('reason' if r else 'relative' if s.startswith('.') else 'stdlib' if first in std else 'non-stdlib')
        ustrata[k].append((f, s, r))
    sample_u = []
    quota = {'stdlib': 20, 'non-stdlib': 18, 'reason': 2, 'relative': 2}
    for k, items in sorted(ustrata.items()):
        for f, s, r in rnd.sample(items, min(quota.get(k, 2), len(items))):
            ln, seg = line_of(f, s)
            sample_u.append({'stratum': k, 'from': f, 'line': ln, 'stmt': (seg or '')[:160], 'spec': s, 'reason': r})
    res['edgeStrata'] = {k: len(v) for k, v in strata.items()}
    res['sampleEdges'] = sample_e
    res['sampleUnresolved'] = sample_u
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
