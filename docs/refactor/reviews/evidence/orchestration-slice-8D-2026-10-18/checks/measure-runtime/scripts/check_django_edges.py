#!/usr/bin/env python3
"""Checker (independent of the measuring agent's scripts): recompute the light Python import scan of a tree
from the draft-5 section 11.3 rules, then compare with a prototype output JSON.

    cd / && python3 -I check_django_edges.py WORKSPACE PROTOTYPE_SCAN.json OUT.json [ROOT ...]

Only reads files (ast.parse); never imports or runs anything from WORKSPACE.  Roots default to '.'.
Written from the spec text, not from light_import_scan.py.
"""
import ast
import collections
import json
import os
import sys
import time
import warnings

SKIP = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox'}
LIMIT = 2 * 1024 * 1024
STDLIB = set(sys.stdlib_module_names)


def collect(ws):
    """claimed python files -> text (or skip reason)."""
    claimed, texts, skipped, all_files, links = [], {}, {}, 0, 0
    for cur, dirs, files in os.walk(ws):
        dirs[:] = [d for d in dirs if d not in SKIP and not os.path.islink(os.path.join(cur, d))]
        for fn in files:
            full = os.path.join(cur, fn)
            if os.path.islink(full):
                links += 1
                continue
            all_files += 1
            rel = os.path.relpath(full, ws).replace(os.sep, '/')
            if not (fn.lower().endswith('.py') or fn.lower().endswith('.pyi')):
                continue
            claimed.append(rel)
            raw = open(full, 'rb').read()
            if len(raw) > LIMIT:
                skipped[rel] = 'too big'
            elif b'\0' in raw:
                skipped[rel] = 'nul'
            else:
                try:
                    texts[rel] = raw.decode('utf-8-sig')
                except UnicodeDecodeError:
                    skipped[rel] = 'not utf-8'
    return sorted(claimed), texts, skipped, all_files, links


class Lookup:
    def __init__(self, paths, roots):
        self.f = set(paths)
        self.ancestors = set()
        for p in paths:
            bits = p.split('/')
            for k in range(1, len(bits)):
                self.ancestors.add('/'.join(bits[:k]))
        self.roots = ['' if r == '.' else r for r in roots]

    @staticmethod
    def j(d, n):
        return d + '/' + n if d else n

    def one(self, dirs, n):
        """('pkg', file, [dir]) | ('mod', file, None) | ('ns', None, parts) | None"""
        parts = []
        for d in dirs:
            b = self.j(d, n)
            for cand, kind in ((b + '/__init__.py', 'pkg'), (b + '.py', 'mod'), (b + '/__init__.pyi', 'pkg'), (b + '.pyi', 'mod')):
                if cand in self.f:
                    return (kind, cand, [b] if kind == 'pkg' else None)
            if b in self.ancestors:
                parts.append(b)
        return ('ns', None, parts) if parts else None

    def chain(self, segs, start, absolute, prefix=''):
        """-> ('ok', node) or ('bad', reason)"""
        cur = start
        node = None
        first = None
        for i, s in enumerate(segs):
            node = self.one(cur, s)
            if node is None:
                return ('bad', None)
            if node[0] == 'mod' and i + 1 < len(segs):
                return ('bad', prefix + '.'.join(segs[:i + 1]) + ' 是模块，不是包')
            if i == 0:
                first = node
            cur = node[2]
        if absolute and first[0] == 'ns' and segs[0] in STDLIB:
            return ('bad', '命名空间目录和标准库重名')
        return ('ok', node)

    def pkg_of(self, path):
        best = None
        for r in self.roots:
            if r == '' or path.startswith(r + '/'):
                if best is None or len(r) > len(best):
                    best = r
        rel = path[len(best) + 1:] if best else path
        bits = rel.split('/')
        name = bits[-1]
        stem = name.rsplit('.', 1)[0]
        return bits[:-1] if stem == '__init__' else bits[:-1]  # package segments (same both ways)

    def dir_node(self, d):
        for cand in ((d + '/' if d else '') + '__init__.py', (d + '/' if d else '') + '__init__.pyi'):
            if cand in self.f:
                return ('pkg', cand, [d])
        return ('ns', None, [d])


def analyse(lk, path, tree):
    out = []  # (kind, value, spec)
    raw = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                raw += 1
                st, v = lk.chain(a.name.split('.'), lk.roots, True)
                if st == 'bad':
                    out.append(('u', v, a.name))
                elif v[0] == 'ns':
                    out.append(('u', '命名空间包，没有文件', a.name))
                else:
                    out.append(('e', v[1], a.name))
        elif isinstance(node, ast.ImportFrom):
            names = [a.name for a in node.names]
            raw += len(names)
            lvl = node.level or 0
            spec = '.' * lvl + (node.module or '')
            if lvl == 0:
                st, x = lk.chain(node.module.split('.'), lk.roots, True)
            else:
                pkg = lk.pkg_of(path)
                if len(pkg) < lvl:
                    out.append(('u', '相对导入越过了顶层包', spec))
                    continue
                d = path.split('/')[:-1]
                if lvl > 1:
                    d = d[:len(d) - (lvl - 1)]
                base = '/'.join(d)
                if node.module:
                    st, x = lk.chain(node.module.split('.'), [base], False, '.' * lvl)
                else:
                    st, x = 'ok', lk.dir_node(base)
            if st == 'bad':
                out.append(('u', x, spec))
                continue
            for n in names:
                if x[0] == 'mod':
                    out.append(('e', x[1], spec))
                elif n == '*':
                    out.append(('e', x[1], spec) if x[0] == 'pkg' else ('u', '命名空间包，没有文件', spec))
                else:
                    sub = lk.one(x[2], n)
                    if sub is not None and sub[0] in ('mod', 'pkg'):
                        out.append(('e', sub[1], spec))
                    elif sub is not None:
                        out.append(('u', '命名空间包，没有文件', spec))
                    elif x[0] == 'pkg':
                        out.append(('e', x[1], spec))
                    else:
                        out.append(('u', '命名空间包，没有文件', spec))
    return out, raw


def main():
    ws, proto_path, out_path = sys.argv[1:4]
    roots = sys.argv[4:] or ['.']
    t0 = time.perf_counter()
    claimed, texts, skipped, all_files, links = collect(ws)
    lk = Lookup(sorted(texts), roots)
    edges, unres = {}, collections.defaultdict(set)
    failed = {}
    raw_total = 0
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for p in sorted(texts):
            try:
                tree = ast.parse(texts[p], filename=p)
            except (SyntaxError, RecursionError, MemoryError, ValueError) as e:
                failed[p] = '{}: {}'.format(type(e).__name__, e.msg if isinstance(e, SyntaxError) else str(e))[:200] + \
                    ('  @line {}'.format(getattr(e, 'lineno', '?')))
                continue
            found, raw = analyse(lk, p, tree)
            raw_total += raw
            for k, v, s in found:
                if k == 'e':
                    if v != p:
                        edges.setdefault((p, v), s)
                else:
                    unres[(p, s)].add(v)
    unres_list = {}
    for key, rs in unres.items():
        nn = sorted(r for r in rs if r is not None)
        unres_list[key] = nn[0] if nn else None
    secs = time.perf_counter() - t0
    proto = json.load(open(proto_path, encoding='utf-8'))
    pe = {(e[0], e[1]) for e in proto['edges']}
    pu = {(u['from'], u['specifier']): u['reason'] for u in proto['unresolved']}
    mine_e = set(edges)
    both_keys = set(pu) & set(unres_list)
    reason_diff = [[k[0], k[1], pu[k], unres_list[k]] for k in sorted(both_keys) if pu[k] != unres_list[k]]
    top = collections.Counter(p.split('/')[0] if '/' in p else '(root)' for p in claimed)
    edge_scope = collections.Counter()
    for f, t in mine_e:
        edge_scope['{}->{}'.format(f.split('/')[0], t.split('/')[0])] += 1
    overlap = {k for k in unres_list if any(f == k[0] and s == k[1] for (f, t), s in edges.items())}
    by_reason = collections.Counter('null' if r is None else r for r in unres_list.values())
    res = {
        'roots': roots, 'allFiles': all_files, 'symlinks': links, 'claimed': len(claimed), 'claimedByTop': dict(top),
        'skipped': skipped, 'parsed': len(texts) - len(failed), 'failed': failed, 'rawReferences': raw_total,
        'edges': len(mine_e), 'edgesByScope': dict(edge_scope), 'unresolved': len(unres_list),
        'unresolvedByReason': dict(by_reason), 'sameFileSpecifierEdgeAndUnresolved': len(overlap), 'seconds': round(secs, 2),
        'vsPrototype': {
            'prototypeEdges': len(pe), 'prototypeUnresolved': len(pu),
            'edgesOnlyMine': sorted(map(list, mine_e - pe))[:50], 'edgesOnlyPrototype': sorted(map(list, pe - mine_e))[:50],
            'unresolvedOnlyMine': sorted(map(list, set(unres_list) - set(pu)))[:50],
            'unresolvedOnlyPrototype': sorted(map(list, set(pu) - set(unres_list)))[:50],
            'reasonDiffs': reason_diff[:50],
            'prototypeFailed': proto.get('failed'), 'prototypeRaw': proto.get('stats', {}).get('rawReferences'),
        },
    }
    # unresolved specifiers' first segment for classification by the caller
    res['unresolvedList'] = [[f, s, r] for (f, s), r in sorted(unres_list.items())]
    res['edgeList'] = [[f, t, s] for (f, t), s in sorted(edges.items())]
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    show = {k: v for k, v in res.items() if k not in ('unresolvedList', 'edgeList')}
    print(json.dumps(show, ensure_ascii=False, indent=1)[:6000])


if __name__ == '__main__':
    main()
