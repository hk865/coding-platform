#!/usr/bin/env python3
"""Verifier: aggregate own full scan (vf_scan.py --all) into per-file rule statuses, edges and timing.

Run only as: python3 -I vf_aggregate.py SRC_ROOT VFS_LIST FULL.ndjson
"""
import collections, json, os, re, statistics, sys

root, vfs_list, path = sys.argv[1], sys.argv[2], sys.argv[3]
rows = {}
for l in open(path):
    r = json.loads(l)
    rows[r['i']] = r
RULES = ['R0pos', 'R0emit', 'R0file', 'R1', 'R2', 'R2lex', 'R3']
status = collections.Counter(r['status'] for r in rows.values())
reach = collections.defaultdict(lambda: {'tus': 0, **{k: 0 for k in RULES}})
edges_pairs, edge_dir, unresolved_dir, angled_dir, macro_dir = set(), set(), {}, set(), set()
dir_targets = collections.defaultdict(set)
ranks, tus_err_before, tus_with_missing, tus_with_err = [], [], 0, 0
ms, cats = [], collections.Counter()
for r in rows.values():
    if r['status'] != 'ok':
        continue
    ms.append(r['parse_ms'] + r['collect_ms'])
    mk = [m[0] for m in r['missing'] if m[0] is not None]
    me = [m[1] for m in r['missing']]
    fk, fe = (min(mk) if mk else None), (min(me) if me else None)
    if mk:
        tus_with_missing += 1
    if r.get('first_missing_rank') is not None:
        ranks.append(r['first_missing_rank'])
    if r['per_file']:
        tus_with_err += 1
    fails = {k: set() for k in RULES}
    miss_by_file = {}
    for m in r['missing']:
        if m[0] is not None and (m[2] not in miss_by_file or m[0] < miss_by_file[m[2]]):
            miss_by_file[m[2]] = m[0]
    for f, pf in r['per_file'].items():
        if pf['min_key'] is not None and (f not in miss_by_file or pf['min_key'] < miss_by_file[f]):
            fails.setdefault('R0file', set()).add(f)
        fails['R1'].add(f)
        if pf['lex'] or pf['user']:
            fails['R2'].add(f)
        if pf['lex']:
            fails['R2lex'].add(f)
        if pf['min_key'] is not None and (fk is None or pf['min_key'] < fk):
            fails['R0pos'].add(f)
        if fe is None or pf['first_emit'] < fe:
            fails['R0emit'].add(f)
        for c, n in pf['cats'].items():
            cats[c] += n
    if fails['R0pos'] or fails['R0emit']:
        tus_err_before.append((r['tu'], sorted(fails['R0pos'] | fails['R0emit'])[:3]))
    reached = set(r['entered']) | {r['tu']} | set(r['per_file'])
    for f in reached:
        e = reach[f]; e['tus'] += 1
        for k in RULES:
            if f in fails[k]:
                e[k] += 1
    for d in r['directives']:
        src, line, spelled, delim, tgt = d[0], d[1], d[2], d[3], d[4]
        if src is None:
            continue
        key = (src, line)
        dir_targets[key].add(tgt)
        if tgt is None:
            unresolved_dir.setdefault(key, delim)
        elif not tgt.startswith('EXT:'):
            edges_pairs.add((src, tgt)); edge_dir.add((src, line, tgt))
        if delim == 'macro':
            macro_dir.add(key)
    for a in r['angled']:
        angled_dir.add((a[2], a[3]))
# universe
SRC_RE = re.compile(r'\.(?:c|cc|cpp|cxx|C)$'); HDR_RE = re.compile(r'\.(?:h|hh|hpp|hxx|inc|ipp|inl|tcc|def)$')
files = [l.strip() for l in open(vfs_list) if l.strip()]
mains = {r['tu'] for r in rows.values() if r['status'] == 'ok'}


def kind(f):
    if f in mains:
        return 'main'
    if HDR_RE.search(f):
        return 'header'
    if '.' not in os.path.basename(f):
        return 'extless'
    return 'other-source'


out = {'status': dict(status), 'tus_ok': sum(1 for r in rows.values() if r['status'] == 'ok')}
for k in RULES:
    c = collections.Counter()
    for f, e in reach.items():
        st = 'failed' if e[k] >= e['tus'] else 'parsed'
        c[(kind(f), st)] += 1
    out['status_' + k] = {'%s/%s' % key: v for key, v in sorted(c.items())}
    out['failed_' + k] = sum(v for (kd, st), v in c.items() if st == 'failed')
hdrs = [f for f in files if HDR_RE.search(f)]
out['headers_total'] = len(hdrs)
out['headers_reached'] = sum(1 for f in hdrs if f in reach)
out['headers_skipped'] = len(hdrs) - out['headers_reached']
out['files_reached'] = len(reach)
out['edge_pairs'] = len(edges_pairs); out['edge_directives'] = len(edge_dir)
out['unresolved_directives_any_tu'] = len(unresolved_dir)
out['unresolved_by_delim'] = dict(collections.Counter(unresolved_dir.values()))
out['angled_recovered_directives'] = len(angled_dir)
out['macro_directives'] = len(macro_dir)
out['tus_with_missing'] = tus_with_missing; out['tus_with_project_errors'] = tus_with_err
out['tus_with_error_before_first_missing'] = tus_err_before[:10]; out['n_tus_err_before'] = len(tus_err_before)
if ranks:
    s = sorted(ranks)
    out['first_missing_rank'] = {'n': len(s), 'p50': s[len(s) // 2], 'p90': s[int(len(s) * 0.9)], 'max': s[-1], 'zero': s.count(0),
                                 'hist': dict(collections.Counter(s))}
s = sorted(ms)
out['ms_parse_collect'] = {'p50': s[len(s) // 2], 'p95': s[int(len(s) * .95)], 'p99': s[int(len(s) * .99)], 'max': s[-1], 'sum_s': round(sum(s) / 1000, 1)}
out['error_categories_project'] = dict(cats)
hw = [r.get('hwm_kb', 0) for r in rows.values() if r['status'] == 'ok']
out['hwm_mb_first_last_max'] = [hw[0] // 1024, hw[-1] // 1024, max(hw) // 1024] if hw else None
json.dump(out, sys.stdout, indent=1)
