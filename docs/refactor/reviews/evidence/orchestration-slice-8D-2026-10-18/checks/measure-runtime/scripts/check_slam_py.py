#!/usr/bin/env python3
"""Checker: own Python import resolution for the SLAM copy (independent of light_import_scan.py).

Resolution follows spec draft 5 section 11.3 as I read it (one search root list, CPython order
pkg/__init__.py, mod.py, pkg/__init__.pyi, mod.pyi, namespace portion = ancestor dir of a claimed .py).
Prints counts for: whole copy (root '.'), and each ROS package dir used as the root.
Compares with the measuring agent's py-scan*.json files given as extra args (thing under test).

Usage: python3 -I check_slam_py.py <copy-root> <results-dir-with-py-scan-json> <out.json>
"""
import ast, json, os, sys, collections

copy_root, resdir, outp = sys.argv[1:4]
STD = set(sys.stdlib_module_names)

def walk(root):
    fs = set()
    for dp, dns, fns in os.walk(root):
        for fn in fns:
            fs.add(os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, '/'))
    return fs

def analyse(root):
    files = walk(root)
    py = sorted(f for f in files if f.endswith(('.py', '.pyi')))
    pydirs = set()
    for f in py:
        parts = f.split('/')[:-1]
        for i in range(1, len(parts) + 1):
            pydirs.add('/'.join(parts[:i]))

    def find(dirs, n):
        portions = []
        for d in dirs:
            base = (d + '/' if d else '') + n
            if base + '/__init__.py' in files: return ('pkg', [base], base + '/__init__.py')
            if base + '.py' in files: return ('mod', None, base + '.py')
            if base + '/__init__.pyi' in files: return ('pkg', [base], base + '/__init__.pyi')
            if base + '.pyi' in files: return ('mod', None, base + '.pyi')
            if base in pydirs: portions.append(base)
        if portions: return ('ns', portions, None)
        return None

    def resolve(dotted, start_dirs):
        segs = dotted.split('.')
        cur = None; dirs = start_dirs
        for i, s in enumerate(segs):
            if cur is not None and cur[0] == 'mod':
                return ('unres', '%s 是模块，不是包' % '.'.join(segs[:i]))
            r = find(dirs, s)
            if r is None: return ('unres', None)
            if i == 0 and r[0] == 'ns' and s in STD and start_dirs == ['']:
                return ('unres', '命名空间目录和标准库重名')
            cur = r; dirs = r[1]
        return ('ok', cur)

    raw = 0; stmts = 0; nested = 0; dyn = []
    edges = set(); unres = {}
    for f in py:
        src = open(os.path.join(root, f), 'rb').read()
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                name = fn.attr if isinstance(fn, ast.Attribute) else (fn.id if isinstance(fn, ast.Name) else None)
                if name in ('import_module', '__import__'):
                    dyn.append((f, node.lineno, name))
        top = set(id(n) for n in tree.body)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                stmts += 1; nested += id(node) not in top
                for a in node.names:
                    raw += 1
                    r = resolve(a.name, [''])
                    if r[0] == 'ok':
                        if r[1][0] == 'ns': unres.setdefault((f, a.name), '命名空间包，没有文件')
                        elif r[1][2] != f: edges.add((f, r[1][2]))
                    else:
                        unres.setdefault((f, a.name), r[1])
            elif isinstance(node, ast.ImportFrom):
                stmts += 1; nested += id(node) not in top
                spec = '.' * node.level + (node.module or '')
                if node.level:
                    # no relative imports expected; record
                    for a in node.names: raw += 1
                    unres.setdefault((f, spec), 'RELATIVE-not-modelled')
                    continue
                r = resolve(node.module, [''])
                for a in node.names:
                    raw += 1
                    if r[0] == 'unres':
                        unres.setdefault((f, spec), r[1]); continue
                    kind, dirs, fpath = r[1]
                    if kind == 'mod':
                        if fpath != f: edges.add((f, fpath))
                        continue
                    if a.name == '*':
                        if kind == 'ns': unres.setdefault((f, spec), '命名空间包，没有文件')
                        elif fpath != f: edges.add((f, fpath))
                        continue
                    sub = find(dirs, a.name)
                    if sub is None:
                        if kind == 'pkg':
                            if fpath != f: edges.add((f, fpath))
                        else:
                            unres.setdefault((f, spec), '命名空间包，没有文件')
                    elif sub[0] == 'ns':
                        unres.setdefault((f, spec), '命名空间包，没有文件')
                    elif sub[2] != f:
                        edges.add((f, sub[2]))
    reasons = collections.Counter(str(v) for v in unres.values())
    std = sum(1 for (f, s) in unres if s.split('.')[0] in STD)
    return {
        'root': root, 'all_files': len(files), 'py_files': len(py), 'import_statements': stmts,
        'raw_refs_names': raw, 'nested_imports': nested, 'dynamic_import_calls': dyn,
        'edges': sorted(edges), 'unresolved_count': len(unres), 'unresolved_reasons': dict(reasons),
        'unresolved_stdlib': std, 'unresolved_other': len(unres) - std,
        'unresolved_non_null': sorted('%s | %s | %s' % (f, s, r) for (f, s), r in unres.items() if r is not None),
        '_unres': sorted('%s|%s' % k for k in unres),
    }

def theirs(path):
    try:
        d = json.load(open(path))
    except Exception as e:
        return {'error': str(e)}
    u = d.get('unresolved') or []
    return {'files': d.get('files'), 'parsed': d.get('parsed'), 'roots': d.get('roots'), 'edges': len(d.get('edges') or []),
            'unresolved': len(u), 'reasons': dict(collections.Counter(str(x.get('reason')) for x in u)),
            '_unres': sorted('%s|%s' % (x['from'], x['specifier']) for x in u)}

res = {}
res['whole'] = analyse(copy_root)
t = theirs(os.path.join(resdir, 'py-scan.json'))
res['whole_cmp'] = {'theirs': {k: v for k, v in t.items() if k != '_unres'},
                    'only_mine': sorted(set(res['whole']['_unres']) - set(t.get('_unres', []))),
                    'only_theirs': sorted(set(t.get('_unres', [])) - set(res['whole']['_unres']))}
src = os.path.join(copy_root, 'ros2_ws', 'src')
for p in sorted(os.listdir(src)):
    a = analyse(os.path.join(src, p))
    if a['py_files'] == 0: continue
    t = theirs(os.path.join(resdir, 'py-scan-pkg-%s.json' % p))
    pref = ''
    res['pkg-' + p] = {k: v for k, v in a.items() if k not in ('_unres',)}
    res['pkg-' + p + '-cmp'] = {'theirs': {k: v for k, v in t.items() if k != '_unres'},
                                 'only_mine': sorted(set(a['_unres']) - set(t.get('_unres', []))),
                                 'only_theirs': sorted(set(t.get('_unres', [])) - set(a['_unres']))}
res['whole'].pop('_unres')
json.dump(res, open(outp, 'w'), indent=1, ensure_ascii=False)
for k, v in res.items():
    if isinstance(v, dict) and 'edges' in v and isinstance(v['edges'], list):
        v = dict(v); v['edges'] = len(v['edges'])
    print(k, json.dumps(v, ensure_ascii=False)[:1500])
