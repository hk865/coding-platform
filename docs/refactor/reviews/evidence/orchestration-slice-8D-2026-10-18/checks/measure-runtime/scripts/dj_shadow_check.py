#!/usr/bin/env python3
"""`from X import n` where X/n.py (or X/n/__init__.py) exists AND X/__init__.py itself binds n to something else.

CPython imports the submodule only when X has no attribute n after X/__init__.py ran; draft 4 always points the edge
at the submodule file.  Counts such sites (names bound by def/class/assignment or by importing n from elsewhere).
    cd / && python3 -I dj_shadow_check.py WORKSPACE
"""
import ast, os, sys, warnings
ws = sys.argv[1]
files = {}
for dp, dn, fn in os.walk(ws):
    for f in fn:
        if f.endswith('.py'):
            rel = os.path.relpath(os.path.join(dp, f), ws).replace(os.sep, '/')
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    files[rel] = ast.parse(open(os.path.join(dp, f), 'rb').read().decode('utf-8-sig'))
            except SyntaxError:
                pass
def other_bindings(pkg_dir, tree):
    out = {}
    for st in tree.body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out[st.name] = 'def/class line {}'.format(st.lineno)
        elif isinstance(st, ast.Assign):
            for t in st.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = 'assign line {}'.format(st.lineno)
        elif isinstance(st, ast.ImportFrom):
            for a in st.names:
                bound = a.asname or a.name
                # importing the submodule itself (from . import n / from .n import n?) is not "something else"
                if st.level == 1 and (st.module is None) and a.name == bound:
                    continue
                out[bound] = 'from {}{} import {} line {}'.format('.' * st.level, st.module or '', a.name, st.lineno)
    return out
hits = []
for rel, tree in files.items():
    pkg = rel.rsplit('/', 1)[0] if '/' in rel else ''
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or node.module is None and node.level == 0:
            continue
        if node.level:
            parts = pkg.split('/') if pkg else []
            base = parts[:len(parts) - (node.level - 1)] if node.level > 1 else parts
            x = '/'.join(base + (node.module.split('.') if node.module else []))
        else:
            x = node.module.replace('.', '/')
        init = x + '/__init__.py'
        if init not in files:
            continue
        binds = other_bindings(x, files[init])
        for a in node.names:
            n = a.name
            if (x + '/' + n + '.py' in files or x + '/' + n + '/__init__.py' in files) and n in binds:
                hits.append('{}:{} from {}{} import {} -> X/__init__ binds it: {}'.format(
                    rel, node.lineno, '.' * node.level, node.module or '', n, binds[n]))
print(len(hits))
for h in hits[:20]:
    print(' ', h)
