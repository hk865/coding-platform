#!/usr/bin/env python3
"""ros2/demos: roll the inventory up to file / directory / package level against the light-scan edges.

Run only as:  python3 -I r2_summarize.py RESULTS_DIR OUT.json
Reads RESULTS_DIR/runtime-inventory.json, light-eval-ref.json, py-ws.json, py-pkg-*.json, packages.json.
"""
import collections
import glob
import json
import os
import sys


def d(path):
    return path.rsplit('/', 1)[0] if '/' in path else '.'


def main():
    R, out_path = sys.argv[1], sys.argv[2]
    inv = json.load(open(os.path.join(R, 'runtime-inventory.json'), encoding='utf-8'))
    light = json.load(open(os.path.join(R, 'light-eval-ref.json'), encoding='utf-8'))
    pyws = json.load(open(os.path.join(R, 'py-ws.json'), encoding='utf-8'))
    packages = json.load(open(os.path.join(R, 'packages.json'), encoding='utf-8'))
    src = pyws['workspace']
    edges = [tuple(e) for e in light['edge_list']] + [(e[0], e[1]) for e in pyws['edges']]
    for path in glob.glob(os.path.join(R, 'py-pkg-*.json')):
        p = json.load(open(path, encoding='utf-8'))
        base = os.path.relpath(p['workspace'], src)
        edges += [(base + '/' + e[0], base + '/' + e[1]) for e in p['edges']]
    pdirs = sorted(packages.items(), key=lambda kv: -len(kv[1]))

    def pkg(f):
        return next((n for n, pd in pdirs if f == pd or f.startswith(pd + '/')), None)
    file_e = {frozenset(e) for e in edges}
    dir_e = {frozenset((d(a), d(b))) for a, b in edges}
    pkg_e = {frozenset((pkg(a), pkg(b))) for a, b in edges}

    def levels(a, b):
        return {'file_edge': frozenset((a, b)) in file_e,
                'same_dir': d(a) == d(b), 'dir_edge': d(a) != d(b) and frozenset((d(a), d(b))) in dir_e,
                'same_package': pkg(a) == pkg(b), 'package_edge': pkg(a) != pkg(b) and frozenset((pkg(a), pkg(b))) in pkg_e}

    def roll(pairs):
        c = collections.Counter()
        for a, b in pairs:
            lv = levels(a, b)
            c['pairs'] += 1
            for k, v in lv.items():
                c[k] += int(v)
            c['connected_at_dir_level'] += int(lv['same_dir'] or lv['dir_edge'])
            c['connected_at_package_level'] += int(lv['same_package'] or lv['package_edge'])
        return dict(c)

    res = {'edge_counts': {'file_pairs': len(file_e), 'dir_pairs_excl_same': sum(1 for x in dir_e if len(x) == 2),
                           'package_pairs_excl_same': sum(1 for x in pkg_e if len(x) == 2)}}
    # communication file pairs (by name), launch-confirmed subset
    comm_pairs = [tuple(k.split(' <-> ')) for k in inv['file_pairs']]
    res['comm_file_pairs'] = roll(comm_pairs)
    res['comm_launch_confirmed'] = roll([tuple(k.split(' <-> ')) for k in inv['launch_confirmed_pairs']])
    # cross-language part
    res['comm_cross_language'] = roll([p for p in comm_pairs if p[0].endswith('.py') != p[1].endswith('.py')])
    # launch -> target
    lt = [(r['file'], t) for r in inv['launch'] if r.get('targets') for t in r['targets']]
    res['launch_to_target'] = roll(lt)
    res['launch_files'] = len({r['file'] for r in inv['launch']})
    # entry points
    res['entry_points'] = roll([(e['file'], e['target_file']) for e in inv['entry_points'] if e['target_file']])
    # generated interfaces
    res['generated_interface_includes'] = roll([(g['from'], g['interface_file']) for g in inv['generated_interface_includes'] if g['interface_file']])
    gi = inv['generated_interface_includes']
    res['generated_interface_includes']['distinct_interface_files'] = len({g['interface_file'] for g in gi})
    res['generated_interface_includes']['distinct_from_files'] = len({g['from'] for g in gi})
    # cmake own-target links: from-source -> to-source pairs
    own = [r for r in inv['cmake_links'] if not r.get('cross_package') and r.get('own')]
    res['cmake_own_links'] = {'links': len(own), 'include_connected': sum(1 for r in own if r['include_connected'])}
    res['cmake_own_links_file_level'] = roll([(a, b) for r in own if not r['include_connected'] for a in r['from_sources'] for b in r['to_sources']])
    # declared package deps
    res['declared_package_deps'] = {'pairs': len(inv['declared_package_deps']),
                                    'with_edge': sum(1 for x in inv['declared_package_deps'] if x['edge_between_packages'])}
    # component registrations: is any light edge pointing into the registering file?
    indeg = collections.Counter(b for a, b in edges)
    regs = inv['runtime_sites'].get('RCLCPP_COMPONENTS_REGISTER_NODE', [])
    res['component_registrations'] = {'sites': len(regs), 'files': len({r['file'] for r in regs}),
                                      'files_with_incoming_edge': sum(1 for f in {r['file'] for r in regs} if indeg[f])}
    with open(out_path, 'w', encoding='utf-8') as handle:
        json.dump(res, handle, indent=1)
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
