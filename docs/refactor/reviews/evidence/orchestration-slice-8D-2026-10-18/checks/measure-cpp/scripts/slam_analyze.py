#!/usr/bin/env python3
"""Numbers for the SLAM measurement summary (tasks a, b, d, e, f).

Run only as: python3 -I slam_analyze.py --root ROOT --scan SCAN.ndjson --out OUT.json [--reps F ...] [--find F]
             [--jobs3 F] [--colcon F]
Imports evaluate_rules.py and inject_analyze.py from this folder (explicitly) for the rules R0-R4.
"""
import argparse
import collections
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate_rules as E  # noqa: E402
import inject_analyze as IA  # noqa: E402

SRC_EXTS = {'.c', '.cc', '.cpp', '.cxx', '.c++'}


def load(path):
    modes = collections.defaultdict(dict)
    for line in open(path, encoding='utf-8'):
        r = json.loads(line)
        modes[r['mode']][r['tu_index']] = r
    return modes


def pct(values, q):
    if not values:
        return None
    values = sorted(values)
    # nearest-rank percentile: the smallest value with at least q of the values at or below it
    k = max(0, min(len(values) - 1, int(-(-q * len(values) // 1)) - 1))
    return values[k]


def stats(values):
    return {'n': len(values), 'sum': round(sum(values), 1), 'mean': round(sum(values) / len(values), 2) if values else None,
            'p50': pct(values, .5), 'p95': pct(values, .95), 'p99': pct(values, .99), 'max': max(values) if values else None}


def normalise(text):
    return re.sub(r"'[^']*'", "'X'", text)


def chain_text(path, line):
    return E.conditional_chain(path, line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--scan', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--reps', nargs='*', default=[])
    ap.add_argument('--find', nargs='*', default=[])
    ap.add_argument('--jobs3')
    ap.add_argument('--colcon')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    universe = E.universe(root, set(), E.EXTS)
    mains_u = {f for f in universe if os.path.splitext(f)[1] in SRC_EXTS}
    headers_u = universe - mains_u
    modes = load(a.scan)
    out = {'claimed': {'all': len(universe), 'sources': len(mains_u), 'headers': len(headers_u)}, 'modes': {}}
    results = {}
    for m, rows in sorted(modes.items()):
        res = IA.Result(m, rows, root)
        results[m] = res
        st = res.statuses_all()
        tu_mains = {res.rel(r['tu']) for r in rows.values()}
        rule_counts, failed_lists, reasons_top = {}, {}, {}
        for r in IA.RULES:
            c = collections.Counter()
            for f in universe | set(st[r]):
                s = st[r].get(f, 'skipped')
                c[('main' if f in tu_mains else 'source-no-TU' if f in mains_u else 'header', s)] += 1
            rule_counts[r] = {'%s %s' % k: v for k, v in sorted(c.items())}
            failed = sorted(f for f, s in st[r].items() if s == 'failed')
            failed_lists[r] = [{'file': f, 'reason': res.reach[f]['reason'].get(r)} for f in failed]
        # diagnostics behind the failures: every error located in a project file that counts for the rule
        texts = {r: collections.Counter() for r in ['R1', 'R4']}
        cats = collections.Counter()
        per_file_first = {}
        for row in sorted(rows.values(), key=lambda x: x.get('tu') or ''):
            for d in row.get('diagnostics', []):
                f = res.rel(d.get('file'))
                if d['severity'] < 3 or not f or d.get('file_not_found') in E.RESOLUTION:
                    continue
                cats[d['category']] += 1
                texts['R1'][normalise(d['spelling'])] += 1
                if d['category'] in (E.LEX, E.USER, 'Parse Issue'):
                    texts['R4'][normalise(d['spelling'])] += 1
        for r in texts:
            reasons_top[r] = texts[r].most_common(15)
        # first-reason text per failed file (path-first TU), normalised
        first_reason = {r: collections.Counter(normalise(x['reason'].split(' ', 1)[1].rsplit(' [', 1)[0]) for x in failed_lists[r]
                                               if x['reason'] and ' ' in x['reason']).most_common(10) for r in IA.RULES}
        # edges, directives, unresolved
        directives = {}
        for row in rows.values():
            for x in row.get('inclusions', []):
                f = res.rel(x['file'])
                if f:
                    key = (f, x['line'])
                    directives.setdefault(key, {'spelled': x['spelled'], 'delim': x['delim'], 'via_macro': x['via_macro'], 'targets': set(),
                                                'in_body': set()})
                    t = x['resolved']
                    directives[key]['targets'].add('UNRESOLVED' if t is None else (res.rel(t) or 'EXTERNAL'))
                    directives[key]['in_body'].add(str(x.get('in_function_body')))
        unresolved_dirs = {k: v for k, v in directives.items() if 'UNRESOLVED' in v['targets']}
        by_delim = collections.Counter(v['delim'] or 'macro' for v in unresolved_dirs.values())
        unresolved_names = collections.Counter((v['delim'] or '?', v['spelled']) for v in unresolved_dirs.values())
        project_suffix_hits = sorted({v['spelled'] for v in unresolved_dirs.values()
                                      if any(u.endswith('/' + v['spelled']) for u in universe)})
        macro_unexpanded = sum(1 for row in rows.values() for d in row.get('diagnostics', []) if d.get('file_not_found') == 'macro_unexpanded')
        el = [r['elapsed_ms'] for r in rows.values() if 'elapsed_ms' in r]
        ok = [r for r in rows.values() if r.get('status') == 'ok']
        out['modes'][m] = {
            'tu_status': dict(collections.Counter(r.get('status') for r in rows.values())),
            'file_status_by_rule': rule_counts,
            'failed_files': failed_lists,
            'top_error_texts_in_project_files': reasons_top,
            'first_reason_of_failed_files': first_reason,
            'error_categories_in_project_files': dict(cats),
            'edges': len(res.edges), 'edges_from_files_not_failed': {r: sum(1 for (s, t) in res.edges if st[r].get(s) != 'failed') for r in IA.RULES},
            'directives_in_project_files': len(directives),
            'directives_resolved_in_project': sum(1 for v in directives.values() if any(t not in ('UNRESOLVED', 'EXTERNAL') for t in v['targets'])),
            'directives_resolved_external': sum(1 for v in directives.values() if 'EXTERNAL' in v['targets']),
            'directives_unresolved': len(unresolved_dirs), 'unresolved_by_delim': dict(by_delim),
            'unresolved_distinct_names': len(unresolved_names),
            'unresolved_names_top': [['%s%s' % (d, n), c] for (d, n), c in unresolved_names.most_common(12)],
            'unresolved_names_matching_a_project_file_suffix': project_suffix_hits,
            'directives_via_macro': sum(1 for v in directives.values() if v['via_macro']),
            'macro_unexpanded_diagnostics': macro_unexpanded,
            'directives_in_function_body': dict(collections.Counter(','.join(sorted(v['in_body'])) for v in directives.values())),
            'timing_elapsed_ms': stats(el),
            'timing_parse_ms': stats([r['parse_ms'] for r in ok]),
            'timing_visit_ms': stats([r['visit_ms'] for r in ok if 'visit_ms' in r]),
            'peak_rss_kb_max': max((r.get('peak_rss_kb') or 0) for r in ok) if ok else None,
            'rss_before_kb_min': min((r.get('rss_before_kb') or 0) for r in ok) if ok else None,
            'entered_external_mean': round(sum(r.get('entered_external_count', 0) for r in ok) / len(ok), 1) if ok else None,
            'entered_project_mean': round(sum(len(r.get('entered_project', [])) for r in ok) / len(ok), 1) if ok else None,
            'external_errors_listed_max': max(len(r.get('external_errors', [])) for r in ok) if ok else None,
        }
        out['modes'][m]['_directives'] = directives
    # headers reached by no TU (light) and the reached ones
    light = results['light']
    reached = {f for f, e in light.reach.items() if e['tus']}
    out['headers_never_reached'] = sorted(headers_u - reached)
    out['sources_without_TU'] = sorted(mains_u - reached)
    # directive-level differences between modes (all targets, not only project edges)
    diffs = {}
    for x, y in [('light', 'reference-raw'), ('light', 'reference'), ('reference', 'reference-raw'), ('light', 'light-bodies')]:
        if x not in out['modes'] or y not in out['modes']:
            continue
        dx, dy = out['modes'][x]['_directives'], out['modes'][y]['_directives']
        only = {}
        for side, A, B in [('only_' + x, dx, dy), ('only_' + y, dy, dx)]:
            rows = []
            for k in sorted(set(A) - set(B)):
                chain = chain_text(os.path.join(root, k[0]), k[1])
                why = '__has_include' if any('__has_include' in c for c in chain) else ('conditional: ' + ' / '.join(chain)) if chain else 'other'
                rows.append({'at': '%s:%d' % k, 'spelled': A[k]['spelled'], 'targets': sorted(A[k]['targets']), 'why': why})
            only[side] = rows
        changed = []
        for k in sorted(set(dx) & set(dy)):
            if dx[k]['targets'] != dy[k]['targets']:
                changed.append({'at': '%s:%d' % k, 'spelled': dx[k]['spelled'], x: sorted(dx[k]['targets']), y: sorted(dy[k]['targets'])})
        changed_kinds = collections.Counter('%s -> %s' % ('/'.join(sorted({t if t in ('UNRESOLVED', 'EXTERNAL') else 'PROJECT' for t in c[x]})),
                                                         '/'.join(sorted({t if t in ('UNRESOLVED', 'EXTERNAL') else 'PROJECT' for t in c[y]})))
                                            for c in changed)
        ex, ey = results[x].edge_triples, results[y].edge_triples
        diffs['%s|%s' % (x, y)] = {'project_edge_triples_only_A': sorted('%s:%d -> %s' % t for t in ex - ey),
                                   'project_edge_triples_only_B': sorted('%s:%d -> %s' % t for t in ey - ex),
                                   'directives_only_A': only['only_' + x], 'directives_only_B': only['only_' + y],
                                   'same_directive_different_target_kinds': dict(changed_kinds),
                                   'same_directive_project_target_changed': [c for c in changed if any(t not in ('UNRESOLVED', 'EXTERNAL') for t in c[x] + c[y])]}
    out['directive_diffs'] = diffs
    for m in out['modes']:
        del out['modes'][m]['_directives']
    # timing repetitions, find variant, 3 workers, colcon simulation
    reps = collections.defaultdict(list)
    for path in a.reps + a.find:
        tag = 'find' if path in a.find else 'visit'
        for m, rows in load(path).items():
            reps['%s/%s' % (m, tag)].append({'elapsed': [r['elapsed_ms'] for r in rows.values()], 'visit': [r.get('visit_ms', 0) for r in rows.values()],
                                             'parse': [r.get('parse_ms', 0) for r in rows.values()],
                                             'peak': max(r.get('peak_rss_kb') or 0 for r in rows.values())})
    out['repetitions'] = {k: {'runs': len(v), 'elapsed_sum_ms': [round(sum(x['elapsed']), 1) for x in v],
                              'elapsed_all': stats([e for x in v for e in x['elapsed']]),
                              'visit_sum_ms': [round(sum(x['visit']), 1) for x in v], 'parse_sum_ms': [round(sum(x['parse']), 1) for x in v],
                              'peak_rss_kb': [x['peak'] for x in v]} for k, v in sorted(reps.items())}
    if a.jobs3 and os.path.exists(a.jobs3):
        j = load(a.jobs3)
        out['jobs3'] = {m: {'elapsed_sum_ms': round(sum(r['elapsed_ms'] for r in rows.values()), 1),
                            'peak_rss_kb_max': max(r.get('peak_rss_kb') or 0 for r in rows.values()),
                            'status': dict(collections.Counter(r['status'] for r in rows.values()))} for m, rows in j.items()}
    if a.colcon and os.path.exists(a.colcon):
        c = load(a.colcon)
        for m, rows in c.items():
            res = IA.Result(m, rows, root)
            base = results[m]
            lost = sorted('%s:%d -> %s' % t for t in base.edge_triples - res.edge_triples)
            gained = sorted('%s:%d -> %s' % t for t in res.edge_triples - base.edge_triples)
            st = res.statuses_all()
            out['colcon_sim_' + m] = {'edges': len(res.edges), 'edges_baseline': len(base.edges), 'edge_triples_lost': lost,
                                      'edge_pairs_lost': len(base.edges - res.edges), 'edge_triples_gained': gained,
                                      'headers_skipped': sorted(f for f in headers_u if st['R3'].get(f, 'skipped') == 'skipped'),
                                      'unresolved_directives': sum(1 for row in rows.values() for x in row.get('inclusions', []) if x['resolved'] is None)}
    json.dump(out, open(a.out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False, default=sorted)
    print(json.dumps(out, indent=1, ensure_ascii=False, default=sorted)[:200000])


if __name__ == '__main__':
    main()
