#!/usr/bin/env python3
"""Count `from X import n` statements whose X resolves to a namespace package (where drafts 4 and 5 differ).
    cd / && python3 -I dj_ns_from_count.py WORKSPACE
"""
import ast, os, sys, warnings
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import light_import_scan as L  # noqa: E402
ws = sys.argv[1]
paths, _ = L.inventory(ws, None)
mat = {}
for p in paths:
    if L.claimed(p):
        c, r = L.read_like_capture(os.path.join(ws, *p.split('/')))
        if r is None:
            mat[p] = c
res = L.Resolver(sorted(mat), [''])
hits = []
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    for p, c in mat.items():
        try:
            t = ast.parse(c)
        except L.PARSE_FAILURES:
            continue
        for n in ast.walk(t):
            if isinstance(n, ast.ImportFrom):
                if n.level:
                    base = res.relative_base(p, n.level)
                    if base is None:
                        continue
                    if n.module:
                        st, x = res.walk(n.module.split('.'), [base], False, '.' * n.level)
                    else:
                        st, x = 'ok', res.package_dir(base)
                else:
                    st, x = res.walk(n.module.split('.'), [''], True)
                if st == 'ok' and x.kind == 'namespace':
                    hits.append('{}:{} from {}{} import {}'.format(p, n.lineno, '.' * n.level, n.module or '',
                                                                  ', '.join(a.name for a in n.names)))
print(len(hits))
for h in hits[:15]:
    print(' ', h)
