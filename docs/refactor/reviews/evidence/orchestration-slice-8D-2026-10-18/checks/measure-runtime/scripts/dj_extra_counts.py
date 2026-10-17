#!/usr/bin/env python3
"""Small extra counts for the Django report (reads our JSON outputs and two text files of the workspace).

    cd / && python3 -I dj_extra_counts.py WORKSPACE SCAN_ROOT.json SCAN_TESTSROOT.json
"""
import ast, collections, json, os, sys, warnings
ws, s1, s2 = sys.argv[1:4]
a = json.load(open(s1, encoding='utf-8'))
b = json.load(open(s2, encoding='utf-8'))
edges = a['edges']
print('edges', len(edges), 'to __init__.py', sum(1 for e in edges if e[1].endswith('/__init__.py')),
      'django-internal to __init__', sum(1 for e in edges if e[0].startswith('django/') and e[1].startswith('django/') and e[1].endswith('/__init__.py')),
      'django-internal', sum(1 for e in edges if e[0].startswith('django/') and e[1].startswith('django/')))
scope = lambda p: 'django' if p.startswith('django/') else 'tests' if p.startswith('tests/') else 'other'
for name, scan in (('root', a), ('tests-root', b)):
    dy = scan['dynamic']
    lit = [s for s in dy['sites'] if not (s['reason'] or '').startswith('动态：')]
    pkg_nonlit = [s for s in dy['sites'] if (s['reason'] or '').startswith('动态：')]
    print(name, 'literal-name sites', len(lit), 'resolved', sum(1 for s in lit if s['to']),
          'by scope', dict(collections.Counter(scope(s['from']) for s in lit)),
          'package-not-literal', len(pkg_nonlit), 'nonLiteral', len(dy['nonLiteral']),
          'nonLiteral by scope', dict(collections.Counter(scope(s['from']) for s in dy['nonLiteral'])))
    st, se = {(e[0], e[1]) for e in scan['edges']}, None
    pairs = {(s['from'], s['to']) for s in lit if s['to']}
    print('   literal pairs', len(pairs), 'not edges', len(pairs - st), sorted(pairs - st))
# import_string calls by scope, literal/non-literal
cnt = collections.Counter()
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    for dirpath, dirnames, filenames in os.walk(ws):
        for fn in filenames:
            if not fn.endswith('.py'):
                continue
            p = os.path.relpath(os.path.join(dirpath, fn), ws).replace(os.sep, '/')
            try:
                tree = ast.parse(open(os.path.join(dirpath, fn), 'rb').read().decode('utf-8-sig'))
            except SyntaxError:
                continue
            for n in ast.walk(tree):
                if isinstance(n, ast.Call):
                    f = n.func
                    nm = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
                    if nm == 'import_string':
                        x = n.args[0] if n.args else None
                        cnt[(scope(p), 'literal' if isinstance(x, ast.Constant) else 'nonliteral')] += 1
print('import_string calls', dict(cnt))
ep = os.path.join(ws, 'Django.egg-info', 'entry_points.txt')
print('entry_points.txt:', open(ep).read() if os.path.exists(ep) else 'none')
