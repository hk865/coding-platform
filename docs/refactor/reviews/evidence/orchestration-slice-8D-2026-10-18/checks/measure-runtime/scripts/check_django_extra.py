#!/usr/bin/env python3
"""Checker: a few more independent counts for the Django measurement.

    cd / && python3 -I check_django_extra.py WORKSPACE MY_EDGES_ROOT.json THEIR_SITES.json OUT.json

Reads files only.
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
    ws, edges_path, sites_path, out_path = sys.argv[1:5]
    mine = json.load(open(edges_path, encoding='utf-8'))
    sites = json.load(open(sites_path, encoding='utf-8'))
    edges = {(f, t) for f, t, s in mine['edgeList']}
    claimed, texts, _, _, _ = E.collect(ws)
    trees = {}
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for p, t in texts.items():
            try:
                trees[p] = ast.parse(t)
            except SyntaxError:
                pass
    res = {}
    # receiver: decorator uses versus any mention
    dec, calls, names = 0, 0, 0
    for p, tree in trees.items():
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for d in n.decorator_list:
                    f = d.func if isinstance(d, ast.Call) else d
                    if (isinstance(f, ast.Name) and f.id == 'receiver') or (isinstance(f, ast.Attribute) and f.attr == 'receiver'):
                        dec += 1
            if isinstance(n, ast.Call) and ((isinstance(n.func, ast.Name) and n.func.id == 'receiver')
                                            or (isinstance(n.func, ast.Attribute) and n.func.attr == 'receiver')):
                calls += 1
    text_at = sum(len(re.findall(r'^\s*@receiver\b', t, re.M)) for t in texts.values())
    text_any = sum(len(re.findall(r'\breceiver\(', t)) for t in texts.values())
    res['receiver'] = {'decoratorNodes': dec, 'callNodes(incl. decorators with args)': calls,
                       'textLinesStartingAt@receiver': text_at, 'textReceiverParen': text_any}
    # migrations with a broad file filter: dependencies / run_before / replaces, separately
    cnt = collections.Counter()
    files = 0
    for p, tree in trees.items():
        segs = p.split('/')
        if segs[-1] == '__init__.py' or not any('migrations' in s for s in segs[:-1]):
            continue
        cls = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Migration']
        if not cls:
            continue
        files += 1
        for st in cls[0].body:
            if isinstance(st, ast.Assign) and isinstance(st.targets[0], ast.Name) and isinstance(st.value, (ast.List, ast.Tuple)):
                nm = st.targets[0].id
                if nm in ('dependencies', 'run_before', 'replaces'):
                    for el in st.value.elts:
                        lit = isinstance(el, ast.Tuple) and len(el.elts) == 2 and all(isinstance(x, ast.Constant) for x in el.elts)
                        cnt[nm + (':literal' if lit else ':other')] += 1
                        if lit and el.elts[1].value in ('__first__', '__latest__'):
                            cnt[nm + ':special'] += 1
    res['migrationsBroad'] = {'filesWithMigrationClass': files, 'items': dict(cnt), 'total': sum(v for k, v in cnt.items() if not k.endswith(':special'))}
    # templates: load / extends / include over every text file of the tree
    loads, names, ei = collections.Counter(), collections.Counter(), collections.Counter()
    nfiles = 0
    for cur, dirs, fns in os.walk(ws):
        for fn in fns:
            if not fn.endswith(('.html', '.txt', '.xml')):
                continue
            rel = os.path.relpath(os.path.join(cur, fn), ws).replace(os.sep, '/')
            try:
                t = open(os.path.join(cur, fn), encoding='utf-8').read()
            except (UnicodeDecodeError, OSError):
                continue
            nfiles += 1
            top = rel.split('/')[0]
            for m in re.finditer(r'{%-?\s*load\s+(.+?)\s*-?%}', t):
                loads[top] += 1
                w = m.group(1).split()
                if 'from' in w:
                    w = w[w.index('from') + 1:]
                names[top] += len(w)
            for m in re.finditer(r'{%-?\s*(extends|include)\s+(.+?)\s*-?%}', t):
                ei[top] += 1
    res['templatesWholeTree'] = {'textFiles': nfiles, 'loadSitesByTop': dict(loads), 'loadNamesByTop': dict(names),
                                 'extendsIncludeByTop': dict(ei)}
    # project template settings
    tpl = 'django/conf/project_template/project_name/settings.py-tpl'
    raw = open(os.path.join(ws, tpl), encoding='utf-8').read()
    src = re.sub(r'{{\s*[^}]+\s*}}', 'proj', raw)
    src = re.sub(r'{%[^%]*%}', '', src)
    tree = ast.parse(src)
    lk = E.Lookup(sorted(texts), ['.'])
    dotted = [(n.lineno, n.value) for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
              and re.match(r'^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$', n.value)]
    targets = []
    for ln, v in dotted:
        parts = v.split('.')
        to = None
        for cut in range(0, 3):
            if len(parts) - cut < 1:
                break
            st, node = lk.chain(parts[:len(parts) - cut], lk.roots, True)
            if st == 'ok' and node[0] in ('pkg', 'mod'):
                to = node[1]
                break
        targets.append((ln, v, to))
    res['settingsTpl'] = {'dottedStrings': len(dotted), 'resolvedLoose': sum(1 for x in targets if x[2]),
                          'distinctTargets': len({x[2] for x in targets if x[2]}),
                          'unresolved': [x[:2] for x in targets if not x[2]]}
    # django-only wiring pairs that are new at file+dir level, and the 4 new at component level
    wk = set(sites['wiringKinds'])
    dj_new = sorted({(s['from'], s['to'], s['value'], s['line']) for s in sites['dottedSites']
                     if s['kind'] in wk and s['to'] and s['from'].startswith('django/') and s['to'].startswith('django/')
                     and s['connection'] == 'new'})
    res['djangoNewWiring'] = [list(x) for x in dj_new]
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
