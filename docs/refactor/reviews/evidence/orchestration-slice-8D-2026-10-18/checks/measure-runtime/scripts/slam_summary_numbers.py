#!/usr/bin/env python3
"""Summary numbers for the SLAM report from runtime-inventory.json (measurement only).

    python3 -I slam_summary_numbers.py RUNTIME_INVENTORY_JSON
"""
import collections
import json
import sys


def pkg(rel):
    return rel.split('/')[2] if rel.startswith('ros2_ws/src/') else '(root)'


def main(path):
    d = json.load(open(path, encoding='utf-8'))
    cov = d['light_scan_coverage_of_runtime_pairs']
    light = {tuple(e) for e in d['light_scan']['cpp_edge_list']} | {tuple(e) for e in d['light_scan']['py_edge_list']}
    light_pkg = {(pkg(a), pkg(b)) for a, b in light if pkg(a) != pkg(b)}
    groups = {'topic': [k for k in cov if k.startswith('topic/')], 'launch': [k for k in cov if k.startswith('launch ')],
              'parameter': [k for k in cov if k.startswith('parameter')], 'tf': [k for k in cov if k.startswith('same TF')]}
    all_pairs = set()
    out = {}
    for g, kinds in groups.items():
        prs = set()
        for k in kinds:
            prs |= {tuple(p) for p in cov[k]['pairs']}
        und = {tuple(sorted(p)) for p in prs}
        all_pairs |= und
        out[g] = {'distinct_file_pairs_undirected': len(und),
                  'with_direct_light_edge': sum(1 for a, b in und if (a, b) in light or (b, a) in light),
                  'cross_package': sum(1 for a, b in und if pkg(a) != pkg(b)),
                  'cross_package_with_light_edge_between_the_packages': sum(
                      1 for a, b in und if pkg(a) != pkg(b) and ((pkg(a), pkg(b)) in light_pkg or (pkg(b), pkg(a)) in light_pkg))}
    out['all'] = {'distinct_file_pairs_undirected': len(all_pairs),
                  'with_direct_light_edge': sum(1 for a, b in all_pairs if (a, b) in light or (b, a) in light),
                  'files_involved': len({f for p in all_pairs for f in p})}
    # package pairs: runtime relations (any kind incl. package.xml / CMake) vs light-scan package edges
    runtime_pkg = collections.defaultdict(set)
    for p in d['package_relations']:
        a, b = p['pair'].split(' -> ')
        for k in p['relations']:
            runtime_pkg[tuple(sorted((a, b)))].add(k.split(' /')[0] if k.startswith('topic') else k)
    for a, b in all_pairs:
        if pkg(a) != pkg(b):
            runtime_pkg[tuple(sorted((pkg(a), pkg(b))))].add('runtime file pair')
    rows = []
    for (a, b), kinds in sorted(runtime_pkg.items()):
        rows.append({'packages': '{} <-> {}'.format(a, b),
                     'light_scan_edges': sum(1 for x, y in light if {pkg(x), pkg(y)} == {a, b}),
                     'relations': sorted(kinds)})
    out['package_pairs'] = rows
    out['package_pairs_total'] = len(rows)
    out['package_pairs_with_light_edge'] = sum(1 for r in rows if r['light_scan_edges'])
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
