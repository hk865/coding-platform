#!/usr/bin/env python3
"""Verifier: compare own sample scan (vf_scan.py) with the measurement agent's raw NDJSON, per TU.

Run only as: python3 -I vf_compare.py ROOT MINE.ndjson THEIRS.ndjson [MINE_REF.ndjson THEIRS_REF.ndjson]
Rules are computed here from raw diagnostics (not with evaluate_rules.py).
"""
import collections, json, os, re, statistics, sys

root, mine_p, theirs_p = sys.argv[1], sys.argv[2], sys.argv[3]
LEX, USER = 'Lexical or Preprocessor Issue', 'User-Defined Issue'


def rel(p):
    return os.path.relpath(p, root) if p and (p == root or p.startswith(root + '/')) else None


def load_mine(p):
    return {r['i']: r for r in map(json.loads, open(p))}


def load_theirs(p, want):
    out = {}
    rx = re.compile(r'"tu_index": (\d+)')
    with open(p) as h:
        for line in h:
            m = rx.search(line[:300])
            if m and int(m.group(1)) in want:
                r = json.loads(line)
                out[r['tu_index']] = r
    return out


def mine_rules(r):
    """per-file verdicts for one TU from my scan."""
    fails = {x: set() for x in ('R0pos', 'R0emit', 'R0pos+angled', 'R1', 'R2', 'R2lex')}
    mk = [m[0] for m in r['missing'] if m[0] is not None]
    me = [m[1] for m in r['missing']]
    # unresolved directives (target None) that produced no diagnostic would also count; collect their keys? (not needed: every
    # unresolved directive in this setup has a 'file not found' diagnostic)
    first_key, first_emit = (min(mk) if mk else None), (min(me) if me else None)
    ak = [a[0] for a in r['angled'] if a[0] is not None]
    first_key_a = min(mk + ak) if (mk + ak) else None
    for f, pf in r['per_file'].items():
        fails['R1'].add(f)
        if pf['lex'] or pf['user']:
            fails['R2'].add(f)
        if pf['lex']:
            fails['R2lex'].add(f)
        if pf['min_key'] is not None and (first_key is None or pf['min_key'] < first_key):
            fails['R0pos'].add(f)
        if pf['min_key'] is not None and (first_key_a is None or pf['min_key'] < first_key_a):
            fails['R0pos+angled'].add(f)
        if first_emit is None or pf['first_emit'] < first_emit:
            fails['R0emit'].add(f)
    return fails


def their_rules(r):
    fails = {x: set() for x in ('R0pos', 'R1', 'R2', 'R2lex')}
    diags = [d for d in r.get('diagnostics', []) if d['severity'] >= 3]
    unres = [u['pos'] for u in r.get('unresolved_positions', []) if u.get('pos') is not None]
    fk = min(unres) if unres else None
    for d in diags:
        if d.get('file_not_found'):
            continue
        f = rel(d['file'])
        if not f:
            continue
        fails['R1'].add(f)
        if d['category'] in (LEX, USER):
            fails['R2'].add(f)
        if d['category'] == LEX:
            fails['R2lex'].add(f)
        if d.get('pos') is not None and (fk is None or d['pos'] < fk):
            fails['R0pos'].add(f)
    return fails


def my_edges(r):
    return {(d[0], d[1], d[4]) for d in r.get('directives', []) if d[0]}


def their_edges(r):
    out = set()
    for x in r.get('inclusions', []):
        f = rel(x['file'])
        if not f:
            continue
        t = x['resolved']
        out.add((f, x['line'], (rel(t) or 'EXT:' + t) if t else None))
    return out


mine = load_mine(mine_p)
theirs = load_theirs(theirs_p, set(mine))
report = {'tus': len(mine), 'per_tu': []}
agg = collections.Counter()
first_missing_rank = []
for i in sorted(mine):
    m, t = mine[i], theirs.get(i)
    row = {'i': i, 'tu': m['tu'], 'mine': m['status'], 'theirs': t['status'] if t else None}
    if m['status'] == 'ok' and t and t['status'] == 'ok':
        me, te = my_edges(m), their_edges(t)
        row['edges_mine'] = len(me); row['edges_theirs'] = len(te)
        row['edges_only_mine'] = sorted(map(str, me - te))[:5]; row['edges_only_theirs'] = sorted(map(str, te - me))[:5]
        agg['edge_triples_mine'] += len(me); agg['edge_triples_theirs'] += len(te)
        agg['edge_triples_diff'] += len(me ^ te)
        agg['proj_edges_mine'] += sum(1 for e in me if e[2] and not e[2].startswith('EXT:'))
        agg['unresolved_mine'] += sum(1 for e in me if e[2] is None)
        mr, tr = mine_rules(m), their_rules(t)
        for k in ('R0pos', 'R1', 'R2', 'R2lex'):
            if mr[k] != tr[k]:
                row.setdefault('rule_disagree', {})[k] = [sorted(mr[k] - tr[k])[:3], sorted(tr[k] - mr[k])[:3]]
            agg['fails_' + k] += len(mr[k])
        for k in ('R0emit', 'R0pos+angled'):
            agg['fails_' + k] += len(mr[k])
            if mr[k] != mr['R0pos']:
                row.setdefault('r0_variant_diff', {})[k] = sorted(mr[k] ^ mr['R0pos'])[:5]
        row['fail_counts'] = {k: len(v) for k, v in mr.items()}
        row['files_reached'] = len(set(m['entered']))
        agg['files_reached'] += len(set(m['entered']))
        row['n_errors'] = m['n_errors']; row['n_missing'] = m['n_missing']; row['n_angled'] = m['n_angled']
        row['multi_entry'] = m['multi_entry'][:5]
        # rank of first missing include among all project directives in preprocessing order (my keys)
        if m['missing']:
            fm = min((x for x in m['missing'] if x[0] is not None), key=lambda x: x[0], default=None)
            row['first_missing'] = fm[2:5] if fm else None
            # directive keys: chain of file + offset
            row['first_missing_emit_rank'] = min(x[1] for x in m['missing'])
            # count directives (any file) strictly before the first missing by key
        errors_before = [f for f, pf in m['per_file'].items() if pf['min_key'] is not None and m['missing'] and fm and pf['min_key'] < fm[0]]
        row['files_with_error_before_first_missing'] = errors_before[:5]
        row['parse_ms'] = m['parse_ms']; row['collect_ms'] = m['collect_ms']
        row['parse_ms_theirs'] = t.get('parse_ms')
    report['per_tu'].append(row)
report['agg'] = dict(agg)
pm = [mine[i]['parse_ms'] + mine[i].get('collect_ms', 0) for i in mine if mine[i]['status'] == 'ok']
if pm:
    report['ms_mine'] = {'p50': statistics.median(pm), 'max': max(pm), 'sum': round(sum(pm), 1)}
if len(sys.argv) > 5:
    mref = load_mine(sys.argv[4]); tref = load_theirs(sys.argv[5], set(mref))
    rr = []
    for i in sorted(mref):
        m, t = mref[i], tref.get(i)
        x = {'i': i, 'tu': m['tu'], 'status': m['status'], 'n_errors': m.get('n_errors'), 'proj_err_files': len(m.get('per_file', {})),
             'ext_errs': m.get('ext_errs'), 'entered_ext': m.get('entered_ext'), 'n_missing': m.get('n_missing'), 'n_angled': m.get('n_angled')}
        if t and m['status'] == 'ok':
            me, te = my_edges(m), their_edges(t)
            x['edge_diff_vs_theirs'] = len(me ^ te)
            ml = mine.get(i)
            if ml and ml['status'] == 'ok':
                le = {e for e in my_edges(ml) if e[2] and not e[2].startswith('EXT:')}
                re_ = {e for e in me if e[2] and not e[2].startswith('EXT:')}
                x['light_vs_ref_project_edges'] = [len(le), len(re_), len(le - re_), len(re_ - le)]
                x['only_light'] = sorted(map(str, le - re_))[:4]; x['only_ref'] = sorted(map(str, re_ - le))[:4]
                # system headers: where did <string>/<stdio.h> etc resolve in ref?
                sys_t = [e for e in me if e[2] and e[2].startswith('EXT:/usr')]
                x['ref_sys_edges'] = len(sys_t)
                x['ref_sys_example'] = sorted(map(str, sys_t))[:2]
        rr.append(x)
    report['ref'] = rr
json.dump(report, sys.stdout, indent=1)
