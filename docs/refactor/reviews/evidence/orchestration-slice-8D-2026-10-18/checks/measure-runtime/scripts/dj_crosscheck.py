#!/usr/bin/env python3
"""Independent cross-check of light_import_scan.py output against CPython's own path finder.

Run only as:  cd / && python3 -I dj_crosscheck.py WORKSPACE SCAN.json OUT.json [--roots . [tests ...]]

It never imports or executes anything from WORKSPACE: it uses importlib.machinery.PathFinder.find_spec(name, path)
with an explicit `path` list at every level, which only stats and lists directories (FileFinder) and never runs a
package's __init__.py.  For each Import / ImportFrom in every file the scan parsed, it computes what CPython's finder
would locate with sys.path = ROOTS (+ the stdlib afterwards for the "namespace dir vs stdlib" rule) and compares the
resulting (from, to) edges and (from, specifier, reason-class) unresolved entries with the scan's JSON.

Relative imports: __package__ is derived like the scan does (longest root containing the file), then the absolute
name is resolved through the finder from the roots.  That part is therefore NOT independent of the scan's module
identity rule; the lookup itself is.
"""
import ast
import importlib.machinery
import json
import os
import sys
import warnings

STDLIB = frozenset(sys.stdlib_module_names)


def find(name, path):
    """Look up the LAST segment of `name` in the directories `path`.  Only the tail is passed to the finder: a
    dotted name makes a namespace spec's _NamespacePath look its parent up in sys.modules (KeyError), and FileFinder
    only uses the tail anyway (fullname.rpartition('.')[2])."""
    try:
        return importlib.machinery.PathFinder.find_spec(name.rpartition('.')[2], path)
    except (ImportError, ValueError):
        return None


def locations(spec):
    """Portions of a package; for a namespace spec read _NamespacePath._path without recalculating."""
    locs = spec.submodule_search_locations
    inner = getattr(locs, '_path', None)
    return list(inner) if inner is not None else list(locs)


class CP:
    def __init__(self, ws, roots):
        self.ws = os.path.abspath(ws)
        self.roots = [os.path.join(self.ws, r) if r not in ('.', '') else self.ws for r in roots]
        self.root_rel = ['' if r in ('.', '') else r for r in roots]

    def rel(self, origin):
        return os.path.relpath(origin, self.ws).replace(os.sep, '/')

    def walk(self, dotted):
        """('ok', spec) | ('notpkg', prefix) | ('notfound', None) | ('stdns', None)."""
        segs = dotted.split('.')
        path = self.roots
        spec = None
        for i, seg in enumerate(segs):
            name = '.'.join(segs[:i + 1])
            spec = find(name, path)
            if spec is None:
                return 'notfound', None
            if i == 0 and spec.loader is None and seg in STDLIB:
                # namespace portion in the project vs a stdlib module/package later on sys.path: stdlib wins
                return 'stdns', None
            if i < len(segs) - 1:
                if spec.submodule_search_locations is None:
                    return 'notpkg', name
                path = locations(spec)
        return 'ok', spec

    def module_identity(self, relpath):
        best = None
        for r in self.root_rel:
            if r == '' or relpath.startswith(r + '/'):
                if best is None or len(r) > len(best):
                    best = r
        rest = relpath if not best else relpath[len(best) + 1:]
        parts = rest.split('/')
        stem = parts[-1][:-3]
        if stem == '__init__':
            return parts[:-1], parts[:-1]
        return parts[:-1] + [stem], parts[:-1]

    def outcome_import(self, dotted):
        st, v = self.walk(dotted)
        if st == 'ok':
            if v.loader is None:
                return [('u', 'namespace', dotted)]
            return [('e', self.rel(v.origin), dotted)]
        return [('u', {'notpkg': 'notpkg', 'notfound': 'null', 'stdns': 'stdns'}[st], dotted)]

    def outcome_from(self, relpath, level, module, names):
        spec_text = '.' * level + (module or '')
        if level:
            _, package = self.module_identity(relpath)
            if len(package) < level:
                return [('u', 'beyondtop', spec_text)]
            base = package[:len(package) - (level - 1)]
            absolute = '.'.join(base + ([module] if module else []))
            if not base:
                return [('u', 'beyondtop', spec_text)]
        else:
            absolute = module
        st, x = self.walk(absolute)
        if st != 'ok':
            return [('u', {'notpkg': 'notpkg', 'notfound': 'null', 'stdns': 'stdns'}[st], spec_text)]
        out = []
        for n in names:
            if x.submodule_search_locations is None:
                out.append(('e', self.rel(x.origin), spec_text))
                continue
            if n == '*':
                out.append(('u', 'namespace', spec_text) if x.loader is None else ('e', self.rel(x.origin), spec_text))
                continue
            sub = find(absolute + '.' + n, locations(x))
            if sub is not None and sub.loader is not None:
                out.append(('e', self.rel(sub.origin), spec_text))
            elif sub is not None:
                out.append(('u', 'namespace', spec_text))
            elif x.loader is not None:
                out.append(('e', self.rel(x.origin), spec_text))
            else:
                out.append(('u', 'namespace', spec_text))
        return out


def reason_class(reason):
    if reason is None:
        return 'null'
    if reason.endswith('是模块，不是包'):
        return 'notpkg'
    return {'命名空间目录和标准库重名': 'stdns', '命名空间包，没有文件': 'namespace',
            '相对导入越过了顶层包': 'beyondtop'}.get(reason, 'other:' + reason)


def main():
    ws, scan_path, out_path = sys.argv[1:4]
    roots = sys.argv[sys.argv.index('--roots') + 1:] if '--roots' in sys.argv else ['.']
    scan = json.load(open(scan_path, encoding='utf-8'))
    failed = {f['path'] for f in scan['failed']} | {s['path'] for s in scan['skipped']}
    parsed_files = sorted({e[0] for e in scan['edges']} | {u['from'] for u in scan['unresolved']})
    cp = CP(ws, roots)
    edges, unresolved = {}, {}
    files_seen = 0
    for dirpath, dirnames, filenames in os.walk(cp.ws):
        dirnames[:] = sorted(d for d in dirnames if d not in ('.git', 'node_modules', '.venv', 'venv', '__pycache__',
                                                             '.mypy_cache', '.pytest_cache', '.tox'))
        for fn in filenames:
            if not fn.endswith('.py'):
                continue
            rel = cp.rel(os.path.join(dirpath, fn))
            if rel in failed:
                continue
            with open(os.path.join(dirpath, fn), 'rb') as h:
                src = h.read().decode('utf-8-sig')
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                tree = ast.parse(src)
            files_seen += 1
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    res = []
                    for a in node.names:
                        res += cp.outcome_import(a.name)
                elif isinstance(node, ast.ImportFrom):
                    res = cp.outcome_from(rel, node.level or 0, node.module, [a.name for a in node.names])
                else:
                    continue
                for kind, val, spec in res:
                    if kind == 'e':
                        if val != rel:
                            edges.setdefault((rel, val), spec)
                    else:
                        unresolved.setdefault((rel, spec), set()).add(val)
    s_edges = {(e[0], e[1]) for e in scan['edges']}
    c_edges = set(edges)
    s_unres = {(u['from'], u['specifier'], reason_class(u['reason'])) for u in scan['unresolved']}
    c_unres = set()
    for (f, s), reasons in unresolved.items():
        nn = sorted(r for r in reasons if r != 'null')
        c_unres.add((f, s, nn[0] if nn else 'null'))
    result = {
        'roots': roots, 'filesParsedByCrosscheck': files_seen,
        'edges': {'scan': len(s_edges), 'cpython': len(c_edges), 'both': len(s_edges & c_edges),
                  'onlyScan': sorted(map(list, s_edges - c_edges)), 'onlyCpython': sorted(map(list, c_edges - s_edges))},
        'unresolved': {'scan': len(s_unres), 'cpython': len(c_unres), 'both': len(s_unres & c_unres),
                       'onlyScan': sorted(map(list, s_unres - c_unres)), 'onlyCpython': sorted(map(list, c_unres - s_unres))},
    }
    with open(out_path, 'w', encoding='utf-8') as h:
        json.dump(result, h, ensure_ascii=False, indent=1)
    print('files', files_seen, 'edges scan/cp/both', len(s_edges), len(c_edges), len(s_edges & c_edges),
          'unres scan/cp/both', len(s_unres), len(c_unres), len(s_unres & c_unres))
    print('onlyScan edges', len(s_edges - c_edges), 'onlyCp edges', len(c_edges - s_edges),
          'onlyScan unres', len(s_unres - c_unres), 'onlyCp unres', len(c_unres - s_unres))


if __name__ == '__main__':
    main()
