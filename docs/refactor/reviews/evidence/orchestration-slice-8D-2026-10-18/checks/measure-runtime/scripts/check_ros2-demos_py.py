#!/usr/bin/env python3
"""Checker (ros2-demos): an independent Python import resolver (CPython rules as written in draft §11.3).

Run only as: python3 -I check_ros2-demos_py.py WORKSPACE GIT_LIST_Z PROTO_JSON OUT_JSON [ROOT ...]
  WORKSPACE   directory treated as the workspace (data only; nothing is imported or executed)
  GIT_LIST_Z  NUL-separated paths (relative to WORKSPACE) of files git does not ignore
  PROTO_JSON  the prototype's output for the same workspace (only read, for comparison)
  ROOT        search roots relative to WORKSPACE (default '.')
Parses each .py/.pyi with ast, collects every Import/ImportFrom, resolves, and compares (from,to) edges and
(from,specifier) unresolved with the prototype. Also classifies each unresolved top-level name by where the
real interpreter would find it (stdlib names, /opt/ros/jazzy site-packages, /usr/lib/python3/dist-packages).
"""
import ast
import collections
import json
import os
import sys

ROS_SP = '/opt/ros/jazzy/lib/python3.12/site-packages'
DIST = ['/usr/lib/python3/dist-packages', '/usr/local/lib/python3.12/dist-packages']


def main():
    ws, gz, proto_path, out = sys.argv[1:5]
    roots = sys.argv[5:] or ['.']
    files = sorted(p.decode() for p in open(gz, 'rb').read().split(b'\0') if p)
    files = [f for f in files if f.endswith('.py') or f.endswith('.pyi')]
    fileset = set(files)
    anc = set()
    for f in files:
        d = os.path.dirname(f)
        while d:
            anc.add(d)
            d = os.path.dirname(d)

    def j(d, n):
        return n if d in ('', '.') else d + '/' + n

    def find(n, dirs):
        parts = []
        for d in dirs:
            if j(j(d, n), '__init__.py') in fileset:
                return ('pkg', [j(d, n)], j(j(d, n), '__init__.py'))
            if j(d, n + '.py') in fileset:
                return ('mod', None, j(d, n + '.py'))
            if j(j(d, n), '__init__.pyi') in fileset:
                return ('pkg', [j(d, n)], j(j(d, n), '__init__.pyi'))
            if j(d, n + '.pyi') in fileset:
                return ('mod', None, j(d, n + '.pyi'))
            if j(d, n) in anc:
                parts.append(j(d, n))
        if parts:
            return ('ns', parts, None)
        return None

    def resolve_dotted(segs, start_dirs, first_is_top):
        cur = None
        dirs = start_dirs
        for i, s in enumerate(segs):
            if cur is not None and cur[0] == 'mod':
                return ('err', '%s 是模块，不是包' % '.'.join(segs[:i]))
            r = find(s, dirs)
            if r is None:
                return ('err', None)
            if i == 0 and first_is_top and r[0] == 'ns' and s in sys.stdlib_module_names:
                return ('err', '命名空间目录和标准库重名')
            cur = r
            dirs = r[1] if r[0] != 'mod' else []
        return ('ok', cur)

    def modname(f):
        best = None
        for r in roots:
            rr = '' if r in ('.', '') else r.rstrip('/') + '/'
            if f.startswith(rr) and (best is None or len(rr) > len(best)):
                best = rr
        if best is None:
            return None
        rel = f[len(best):]
        rel = rel.rsplit('.', 1)[0]
        segs = rel.split('/')
        if segs[-1] == '__init__':
            segs = segs[:-1]
        return segs

    edges, unres = set(), {}
    raw = 0
    per_stmt = collections.Counter()
    failed = []
    dyn = []

    def add_un(f, spec, reason):
        k = (f, spec)
        if k in unres:
            old = unres[k]
            cands = [x for x in (old, reason) if x is not None]
            unres[k] = sorted(cands)[0] if cands else None
        else:
            unres[k] = reason

    def add_edge(f, t):
        if f != t:
            edges.add((f, t))

    for f in files:
        try:
            tree = ast.parse(open(os.path.join(ws, f), 'rb').read(), filename=f)
        except Exception as e:  # noqa
            failed.append((f, type(e).__name__))
            continue
        is_init = os.path.basename(f).startswith('__init__.')
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else None
                if name in ('import_module', '__import__'):
                    dyn.append((f, node.lineno, name, isinstance(node.args[0], ast.Constant) if node.args else None))
            if isinstance(node, ast.Import):
                per_stmt['import'] += 1
                for a in node.names:
                    raw += 1
                    segs = a.name.split('.')
                    r = resolve_dotted(segs, roots, True)
                    if r[0] == 'err':
                        add_un(f, a.name, r[1])
                    elif r[1][0] == 'ns':
                        add_un(f, a.name, '命名空间包，没有文件')
                    else:
                        add_edge(f, r[1][2])
            elif isinstance(node, ast.ImportFrom):
                per_stmt['from'] += 1
                lvl = node.level
                modsegs = node.module.split('.') if node.module else []
                spec = '.' * lvl + (node.module or '')
                if lvl == 0:
                    if modsegs:
                        X = resolve_dotted(modsegs, roots, True)
                    else:
                        X = ('err', None)
                else:
                    ms = modname(f)
                    pkg = ms if is_init else (ms[:-1] if ms else None)
                    if pkg is None or len(pkg) < lvl:
                        for a in node.names:
                            raw += 1
                        add_un(f, spec, '相对导入越过了顶层包')
                        continue
                    start = os.path.dirname(f)
                    for _ in range(lvl - 1):
                        start = os.path.dirname(start)
                    if modsegs:
                        X = resolve_dotted(modsegs, [start if start else '.'], False)
                    else:
                        initp = j(start, '__init__.py')
                        if initp in fileset:
                            X = ('ok', ('pkg', [start], initp))
                        elif j(start, '__init__.pyi') in fileset:
                            X = ('ok', ('pkg', [start], j(start, '__init__.pyi')))
                        else:
                            X = ('ok', ('ns', [start if start else '.'], None))
                for a in node.names:
                    raw += 1
                    if X[0] == 'err':
                        add_un(f, spec, X[1])
                        continue
                    kind, dirs, xf = X[1]
                    if a.name == '*':
                        if kind == 'ns':
                            add_un(f, spec, '命名空间包，没有文件')
                        else:
                            add_edge(f, xf)
                        continue
                    if kind == 'mod':
                        add_edge(f, xf)
                        continue
                    r = find(a.name, dirs)
                    if r is None:
                        if kind == 'pkg':
                            add_edge(f, xf)
                        else:
                            add_un(f, spec, '命名空间包，没有文件')
                    elif r[0] == 'ns':
                        add_un(f, spec, '命名空间包，没有文件')
                    else:
                        add_edge(f, r[2])
    # classification of unresolved
    def top_class(spec):
        if spec.startswith('.'):
            return 'relative'
        top = spec.split('.')[0]
        if top in sys.stdlib_module_names:
            return 'stdlib'
        if os.path.exists(os.path.join(ROS_SP, top)) or os.path.exists(os.path.join(ROS_SP, top + '.py')):
            return 'ROS site-packages'
        for d in DIST:
            if os.path.exists(os.path.join(d, top)) or os.path.exists(os.path.join(d, top + '.py')):
                return 'dist-packages'
        return 'not installed here'
    ucls = collections.Counter(top_class(s) for (_, s) in unres)
    proto = json.load(open(proto_path))
    pe = set((e['from'], e['to']) if isinstance(e, dict) else tuple(e[:2]) for e in proto['edges'])
    pu = {(u['from'], u['specifier']): u['reason'] for u in proto['unresolved']}
    mu = set(unres)
    res = {'workspace': ws, 'roots': roots, 'files': len(files), 'failed': failed, 'raw_names': raw, 'statements': dict(per_stmt),
           'edges': len(edges), 'edge_list': sorted(edges), 'unresolved': len(unres),
           'unresolved_reasons': dict(collections.Counter(str(v) for v in unres.values())),
           'unresolved_by_where_installed': dict(ucls),
           'non_null_reasons': sorted([k[0], k[1], v] for k, v in unres.items() if v),
           'dynamic_import_calls': dyn,
           'proto_edges': len(pe), 'proto_unresolved': len(pu),
           'edges_only_mine': sorted(edges - pe), 'edges_only_proto': sorted(pe - edges),
           'unres_only_mine': sorted(mu - set(pu)), 'unres_only_proto': sorted(set(pu) - mu),
           'reason_differs': sorted([k[0], k[1], unres[k], pu[k]] for k in mu & set(pu) if unres[k] != pu[k])}
    json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
    for k, v in res.items():
        s = json.dumps(v, ensure_ascii=False)
        print(k, s if len(s) < 900 else s[:900] + ' ...')


if __name__ == '__main__':
    main()
