#!/usr/bin/env python3
"""Checker (libuv): light scan (my own evaluation, check_libuv_eval.py) against the GCC -dI truth (check_libuv_gcc.py).
Run only as: python3 -I check_libuv_compare.py EVAL_JSON GCC_JSON OUT_JSON"""
import collections
import json
import os
import sys


def main():
    ev, gc, out = (json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3])
    status = ev['status']
    claimed = set(status)
    light_edges = {tuple(x) for x in ev['edges']}
    light_sites = {tuple(x) for x in ev['edge_sites']}
    light_dsites = {tuple(x) for x in ev['directive_sites']}
    light_unres = {(a, b): r for a, b, r in ev['unresolved']}
    light_reads = {int(k): set(v) for k, v in ev['reads'].items()}
    # material = claimed + include-only; the GCC side only needs "is the target a project file in the material":
    # include-only files are extension-less / .def; libuv's GCC targets are all claimed (checked below)
    t_edges, t_sites, t_dsites, t_unres, t_spec_edge = set(), set(), set(), set(), set()
    targets_not_claimed = collections.Counter()
    read_diff = []
    site_targets = collections.defaultdict(set)
    for u in gc['units']:
        for d in u['directives']:
            if d['file'] not in claimed:
                continue
            spec = (d['delim'] + d['name'] + ('>' if d['delim'] == '<' else '"'))
            t_dsites.add((d['file'], d['line']))
            site_targets[(d['file'], d['line'])].add(d['target'] or 'EXT')
            if d['target'] is not None:
                if d['target'] not in claimed:
                    targets_not_claimed[d['target']] += 1
                t_edges.add((d['file'], d['target']))
                t_sites.add((d['file'], d['line'], d['target']))
                t_spec_edge.add((d['file'], spec))
            else:
                t_unres.add((d['file'], spec))
        tr = set(u['read']) & claimed
        lr = light_reads.get(u['db_index'])
        if lr is None:
            read_diff.append((u['db_index'], u['main'], 'no light unit'))
        elif lr != tr:
            read_diff.append((u['db_index'], u['main'], sorted(lr - tr), sorted(tr - lr)))
    t_unres -= t_spec_edge
    light_site_targets = collections.defaultdict(set)
    for f, l, t in light_sites:
        light_site_targets[(f, l)].add(t)
    lu = set(light_unres)
    res = {
        'gcc_units': len(gc['units']), 'gcc_rc_nonzero': sum(1 for u in gc['units'] if u['rc'] != 0),
        'gcc_resolver_checks': gc['resolver_checks'], 'gcc_resolver_mismatch': len(gc['resolver_mismatch']),
        'gcc_wall_s': gc['wall_s'],
        'edges_light': len(light_edges), 'edges_gcc': len(t_edges),
        'edges_only_light': sorted(light_edges - t_edges), 'edges_only_gcc': sorted(t_edges - light_edges),
        'edge_sites_light': len(light_sites), 'edge_sites_gcc': len(t_sites),
        'edge_sites_only_light': sorted(light_sites - t_sites), 'edge_sites_only_gcc': sorted(t_sites - light_sites),
        'project_directive_sites_light': len(light_dsites), 'project_directive_sites_gcc': len(t_dsites),
        'dsites_only_light': sorted(light_dsites - t_dsites), 'dsites_only_gcc': sorted(t_dsites - light_dsites),
        'gcc_sites_with_project_target_and_light_differs': sorted(
            [list(k) + [sorted(v), sorted(light_site_targets.get(k, []))] for k, v in site_targets.items()
             if (v - {'EXT'}) != light_site_targets.get(k, set())]),
        'unresolved_light': len(lu), 'unresolved_gcc_external': len(t_unres),
        'unresolved_only_light': sorted(lu - t_unres), 'unresolved_only_gcc': sorted(t_unres - lu),
        'gcc_targets_not_claimed': dict(targets_not_claimed),
        'units_read_set_differs': len(read_diff), 'read_diff_examples': read_diff[:10],
        'files_read_union_gcc': len({f for u in gc['units'] for f in u['read']} & claimed),
        'files_read_union_light': len({f for s in light_reads.values() for f in s}),
    }
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps(res, indent=1)[:5000])


if __name__ == '__main__':
    main()
