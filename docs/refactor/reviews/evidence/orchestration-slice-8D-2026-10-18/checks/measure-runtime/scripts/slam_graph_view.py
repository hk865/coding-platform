#!/usr/bin/env python3
"""What the file layer of the architecture observation would show for the SLAM copy (measurement only).

    python3 -I slam_graph_view.py ROOT OLD_SCAN_NDJSON NEW_CPP_LIGHT_NDJSON PY_SCAN_JSON

* compares the include edges of the earlier light run (measure-cpp scan.ndjson, mode light) with this rerun
* counts files by kind, files that have at least one edge, and isolated files per package
"""
import collections
import json
import os
import sys

SRC = 'ros2_ws/src'


def edges_of(path, prefix):
    out = set()
    with open(path, encoding='utf-8') as h:
        for line in h:
            rec = json.loads(line)
            if rec.get('mode') != 'light' or rec.get('status') != 'ok':
                continue
            for inc in rec['inclusions']:
                tgt = inc.get('resolved')
                if inc['file'].startswith(prefix) and tgt and tgt.startswith(prefix):
                    out.add((inc['file'][len(prefix):], tgt[len(prefix):]))
    return out


def kind(rel):
    low = rel.lower()
    for ext, k in (('.launch.py', 'launch.py'), ('.py', 'python'), ('.cpp', 'c/c++'), ('.h', 'c/c++'), ('.hpp', 'c/c++'),
                   ('.yaml', 'yaml'), ('.xacro', 'urdf/sdf'), ('.sdf', 'urdf/sdf'), ('.rviz', 'rviz'), ('.sh', 'shell'),
                   ('cmakelists.txt', 'cmake'), ('.cmake', 'cmake'), ('.cmake.in', 'cmake'), ('package.xml', 'package.xml'),
                   ('.md', 'markdown')):
        if low.endswith(ext):
            return k
    return 'other'


def pkg(rel):
    return rel.split('/')[2] if rel.startswith(SRC + '/') else '(root)'


def main(argv):
    root, old, new, py = argv
    prefix = os.path.abspath(root).rstrip('/') + '/'
    e_old, e_new = edges_of(old, prefix), edges_of(new, prefix)
    with open(py, encoding='utf-8') as h:
        e_py = {(a, b) for a, b, _ in json.load(h)['edges']}
    edges = e_new | e_py
    files = []
    for cur, dirs, names in os.walk(prefix):
        for n in names:
            files.append(os.path.relpath(os.path.join(cur, n), prefix).replace(os.sep, '/'))
    in_edge = {f for e in edges for f in e}
    by_kind = collections.Counter(kind(f) for f in files)
    with_edge = collections.Counter(kind(f) for f in files if f in in_edge)
    by_pkg = collections.defaultdict(lambda: [0, 0])
    for f in files:
        by_pkg[pkg(f)][0] += 1
        by_pkg[pkg(f)][1] += f in in_edge
    out = {'old_light_edges': len(e_old), 'new_light_edges': len(e_new), 'identical': e_old == e_new,
           'only_old': sorted(e_old - e_new), 'only_new': sorted(e_new - e_old), 'python_edges': len(e_py),
           'files': len(files), 'files_with_edge': len(in_edge),
           'by_kind': {k: {'files': by_kind[k], 'with_edge': with_edge.get(k, 0)} for k in sorted(by_kind)},
           'by_package': {k: {'files': v[0], 'with_edge': v[1]} for k, v in sorted(by_pkg.items())},
           'claimed_cpp_without_edge': sorted(f for f in files if kind(f) == 'c/c++' and f not in in_edge)}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
