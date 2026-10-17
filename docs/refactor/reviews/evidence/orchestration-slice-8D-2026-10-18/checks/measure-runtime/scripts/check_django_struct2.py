#!/usr/bin/env python3
"""Checker: (1) file pairs reached only through imports inside functions; (2) which in-degree-zero django/ files a
runtime mechanism explains, with our own reason list.

    cd / && python3 -I check_django_struct2.py WORKSPACE MY_EDGES_ROOT.json THEIR_SITES.json THEIR_INVENTORY.json OUT.json
"""
import ast
import collections
import json
import os
import re
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_django_edges as E  # noqa: E402


def dn(p):
    return p.rsplit('/', 1)[0] if '/' in p else ''


def main():
    ws, edges_path, sites_path, inv_path, out_path = sys.argv[1:6]
    mine = json.load(open(edges_path, encoding='utf-8'))
    sites = json.load(open(sites_path, encoding='utf-8'))
    inv = json.load(open(inv_path, encoding='utf-8'))
    claimed, texts, _, _, _ = E.collect(ws)
    lk = E.Lookup(sorted(texts), ['.'])
    # (1) edges whose every producing statement sits inside a function
    in_func = collections.defaultdict(set)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for p, t in texts.items():
            try:
                tree = ast.parse(t)
            except SyntaxError:
                continue
            par = {}
            for n in ast.walk(tree):
                for c in ast.iter_child_nodes(n):
                    par[c] = n
            for n in ast.walk(tree):
                if isinstance(n, (ast.Import, ast.ImportFrom)):
                    cur, f = par.get(n), False
                    while cur is not None:
                        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                            f = True
                            break
                        cur = par.get(cur)
                    mod = ast.Module(body=[n], type_ignores=[])
                    found, _ = E.analyse(lk, p, mod)
                    for k, v, s in found:
                        if k == 'e' and v != p:
                            in_func[(p, v)].add(f)
    only_func = [k for k, v in in_func.items() if v == {True}]
    any_func = [k for k, v in in_func.items() if True in v]
    res = {'edgesRebuilt': len(in_func), 'pairsWithAnyFunctionLevelImport': len(any_func), 'pairsOnlyViaFunctionLevelImports': len(only_func),
           'onlyFuncDjangoInternal': sum(1 for f, t in only_func if f.startswith('django/') and t.startswith('django/'))}
    # (2) in-degree zero in django/ (django-internal edges) and our own explanation list
    edges = {(f, t) for f, t, s in mine['edgeList']}
    dj = [p for p in texts if p.startswith('django/')]
    indeg = collections.Counter(t for f, t in edges if f.startswith('django/') and t.startswith('django/'))
    zero = sorted(p for p in dj if indeg[p] == 0)
    wk = set(sites['wiringKinds'])
    why = collections.defaultdict(set)
    for s in sites['dottedSites']:
        if s['kind'] in wk and s['to']:
            why[s['to']].add('dotted-' + s['from'].split('/')[0])
    for s in sites['modelSites']:
        if s['to']:
            why[s['to']].add('model-ref')
    for t in inv['templates']['loadTag']['djangoTargets']:
        why[t].add('load-tag')
    for item in inv['projectTemplateSettings']['django/conf/project_template/project_name/settings.py-tpl']['items']:
        m = re.search(r'-> (django/\S+)$', item)
        if m:
            why[m.group(1)].add('settings.py-tpl')
    rules = [('command', lambda p: '/management/commands/' in p and not p.endswith('__init__.py')),
             ('migration', lambda p: '/migrations/' in p and not p.startswith('django/db/migrations/') and not p.endswith('__init__.py')),
             ('locale-formats', lambda p: p.startswith('django/conf/locale/') and p.endswith('/formats.py')),
             ('apps.py', lambda p: p.endswith('/apps.py')),
             ('templatetags', lambda p: '/templatetags/' in p and not p.endswith('__init__.py')),
             ('admin.py', lambda p: p.startswith('django/contrib/') and p.endswith('/admin.py')),
             ('db-base', lambda p: p.startswith('django/db/backends/') and p.endswith('/base.py'))]
    for p in dj:
        for nm, r in rules:
            if r(p):
                why[p].add(nm)
    explained = [p for p in zero if why.get(p)]
    only_tests = [p for p in explained if why[p] <= {'dotted-tests'}]
    unexplained = [p for p in zero if not why.get(p)]
    res['inDegreeZero'] = {'files': len(zero), 'explained': len(explained), 'explainedOnlyByTestStrings': len(only_tests),
                           'unexplained': len(unexplained),
                           'unexplainedInit': sum(1 for p in unexplained if p.endswith('/__init__.py')),
                           'unexplainedOther': [p for p in unexplained if not p.endswith('/__init__.py')]}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
