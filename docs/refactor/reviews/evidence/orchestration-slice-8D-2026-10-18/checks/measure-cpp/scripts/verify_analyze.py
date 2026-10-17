#!/usr/bin/env python3
"""Analysis for the adversarial re-check (own rule evaluation; does not import evaluate_rules.py).

Run only as: python3 -I verify_analyze.py --vdir RESULTS/slam-verify --their RESULTS/slam/scan.ndjson --inject RESULTS/slam/inject
                 --root COPY
"""
import argparse
import collections
import json
import os
import re

LEX, USER = 'Lexical or Preprocessor Issue', 'User-Defined Issue'
RULES = ['R0', 'R0emit', 'R0lit', 'R1', 'R2', 'R2lex', 'R3']


def under(p, root):
    return bool(p) and (p == root or p.startswith(root + '/'))


def tu_fails(tu, root):
    """{rule: set(abs file)} for one ok TU.  R0 = position order (include-chain key), R0emit = diagnostic emission order,
    R0lit = R0 without excluding the file-not-found diagnostic itself."""
    out = {r: set() for r in RULES}
    if tu['status'] != 'ok':
        for r in RULES:
            out[r].add(tu['src'])
        return out
    diags = [d for d in tu['diags'] if not d.get('ext')]
    chains = tu['chains']
    unres_keys = [d['key'] for d in diags if d['fnf'] in ('missing', 'macro') and d['key'] is not None]
    unres_keys += [chains[x[0]] + [x[2]] for x in tu['dirs'] if x[4] is None and x[0] in chains]
    first = min(unres_keys) if unres_keys else None
    diag_keys = [d['key'] for d in diags if d['fnf'] in ('missing', 'macro') and d['key'] is not None]
    first_diag = min(diag_keys) if diag_keys else None
    first_emit = min((d['emit'] for d in diags if d['fnf'] in ('missing', 'macro')), default=None)
    for d in diags:
        f = d['file']
        if not under(f, ROOT[0]):
            continue
        earlier_pos = first is not None and d['key'] is not None and first < d['key']
        earlier_emit = first_emit is not None and first_emit < d['emit']
        if d['fnf']:
            # literal reading: the file-not-found diagnostic is itself an error; only a strictly earlier one excuses it
            if not (first_diag is not None and d['key'] is not None and first_diag < d['key']):
                out['R0lit'].add(f)
            continue
        out['R1'].add(f)
        if d['cat'] in (LEX, USER):
            out['R2'].add(f)
        if d['cat'] == LEX:
            out['R2lex'].add(f)
        if not earlier_pos:
            out['R0'].add(f)
        if not (first_diag is not None and d['key'] is not None and first_diag < d['key']):
            out['R0lit'].add(f)
        if not earlier_emit:
            out['R0emit'].add(f)
    return out


ROOT = [None]


def aggregate(run, keys):
    """file -> {rule: 'failed'|'parsed'} over the TUs in keys, plus reach counts."""
    reach = collections.defaultdict(set)
    fails = {}
    for k in keys:
        tu = run['tus'][k]
        fails[k] = tu_fails(tu, run['root'])
        files = set(tu.get('entered') or []) | {tu['src']}
        for f in files:
            if under(f, run['root']):
                reach[f].add(k)
    status = {}
    for f, ks in reach.items():
        status[f] = {r: ('failed' if all(f in fails[k][r] for k in ks) else 'parsed') for r in RULES}
    return status, reach, fails


def rel(p, root):
    return os.path.relpath(p, root)


def pct(vals, q):
    s = sorted(vals)
    if not s:
        return None
    i = max(0, min(len(s) - 1, int(round(q / 100.0 * len(s) + 0.5)) - 1))
    return s[i]


def edges_of(run, keys):
    root = run['root']
    edges, directives = set(), {}
    for k in keys:
        tu = run['tus'][k]
        if tu['status'] != 'ok':
            continue
        for f, line, off, spelled, inc in tu['dirs']:
            res = 'project' if under(inc, root) else ('external' if inc else None)
            directives[(rel(f, root), line)] = (res, spelled, rel(inc, root) if res == 'project' else inc)
            if res == 'project':
                edges.add((rel(f, root), rel(inc, root)))
    return edges, directives


def their_edges(path, mode, origs, root):
    edges = set()
    for line in open(path):
        r = json.loads(line)
        if r.get('mode') != mode or r.get('status') != 'ok' or r['tu_index'] not in origs:
            continue
        for x in r['inclusions']:
            if x['resolved'] and under(x['resolved'], root):
                edges.add((rel(x['file'], root), rel(x['resolved'], root)))
    return edges


def coverage(run, keys, status_files):
    """Lines of each reached project file still before the TU's first unresolved include (min over TUs for headers)."""
    root = run['root']
    texts = {}
    best = {}
    for k in keys:
        tu = run['tus'][k]
        diags = [d for d in tu['diags'] if not d.get('ext')]
        chains = tu['chains']
        unres = [d['key'] for d in diags if d['fnf'] in ('missing', 'macro') and d['key'] is not None]
        unres += [chains[x[0]] + [x[2]] for x in tu['dirs'] if x[4] is None and x[0] in chains]
        first = min(unres) if unres else None
        for f in set(tu['entered']) | {tu['src']}:
            if not under(f, root) or f not in chains:
                continue
            if f not in texts:
                data = open(f, 'rb').read()
                starts = [0] + [i + 1 for i, b in enumerate(data) if b == 10 and i + 1 < len(data)]
                texts[f] = starts
            starts = texts[f]
            c = chains[f]
            n = len(starts) if first is None else sum(1 for s in starts if c + [s] < first)
            best[f] = n if f not in best else min(best[f], n)
    total = sum(len(texts[f]) for f in best)
    covered = sum(best.values())
    zero = sum(1 for f in best if best[f] == 0)
    return covered, total, zero, len(best)


def summarize(name, run, keys, their_path, their_mode, lines):
    root = run['root']
    status, reach, fails = aggregate(run, keys)
    mains = {run['tus'][k]['src'] for k in keys}
    lines.append('== %s: %d TUs, reached %d files (%d main + %d headers)' % (name, len(keys), len(status), len(mains & set(status)),
                                                                            len(set(status) - mains)))
    for r in RULES:
        fm = sum(1 for f in status if f in mains and status[f][r] == 'failed')
        fh = sum(1 for f in status if f not in mains and status[f][r] == 'failed')
        lines.append('   %-6s failed: %d main + %d headers = %d' % (r, fm, fh, fm + fh))
    edges, directives = edges_of(run, keys)
    res = collections.Counter(v[0] for v in directives.values())
    lines.append('   directives (file:line dedupe): %d  %s ; in-project edges %d' % (len(directives), dict(res), len(edges)))
    if their_path:
        origs = {run['tus'][k]['orig'] for k in keys}
        te = their_edges(their_path, their_mode, origs, root)
        lines.append('   their edges same TUs (%s): %d ; equal=%s ; only mine %s ; only theirs %s' % (
            their_mode, len(te), te == edges, sorted(edges - te)[:5], sorted(te - edges)[:5]))
    # file-not-found diagnostics in project files (per TU occurrence)
    fnf = collections.Counter()
    fnf_files, sev, cats = set(), collections.Counter(), collections.Counter()
    err_cats = collections.Counter()
    for k in keys:
        for d in run['tus'][k]['diags']:
            if d.get('ext') or not under(d['file'], root):
                continue
            if d['fnf']:
                fnf[d['fnf']] += 1
                fnf_files.add(d['file'])
                sev[d['sev']] += 1
                cats[d['cat']] += 1
            else:
                err_cats[d['cat']] += 1
    lines.append('   file-not-found in project files: %s sev %s cat %s in %d files; other errors by category %s' % (
        dict(fnf), dict(sev), dict(cats), len(fnf_files), dict(err_cats)))
    cov = coverage(run, keys, status)
    lines.append('   R0 coverage: %d of %d lines (%.1f%%), %d of %d files zero' % (cov[0], cov[1], 100.0 * cov[0] / max(1, cov[1]), cov[2], cov[3]))
    # emission vs position disagreements
    dis = 0
    for k in keys:
        f = fails[k]
        dis += len(f['R0'] ^ f['R0emit'])
    lines.append('   R0 position-vs-emission disagreements (TU,file): %d' % dis)
    pm = [run['tus'][k]['parse_ms'] for k in keys]
    lines.append('   parse_ms p50 %.1f p95 %.1f max %.1f sum %.0f ; hwm %s KB ; external entered avg %.1f' % (
        pct(pm, 50), pct(pm, 95), max(pm), sum(pm), run.get('hwm_kb'),
        sum(run['tus'][k].get('entered_ext', 0) for k in keys) / len(keys)))
    return status, edges, directives


def injection(vdir, inj_dir, tid, base_runs, lines):
    man = json.load(open(os.path.join(inj_dir, 'manifest.json')))
    t = next(x for x in man['targets'] if x['id'] == tid)
    ws = t['ws']
    root0 = man['root']
    # 1. did the injection apply, and only there?
    changed = []
    for cur, sub, fs in os.walk(root0):
        for f in fs:
            p0 = os.path.join(cur, f)
            r = os.path.relpath(p0, root0)
            p1 = os.path.join(ws, r)
            if not os.path.exists(p1) or open(p0, 'rb').read() != open(p1, 'rb').read():
                changed.append(r)
    extra = sum(1 for cur, sub, fs in os.walk(ws) for f in fs) - sum(1 for cur, sub, fs in os.walk(root0) for f in fs)
    a = open(os.path.join(root0, t['file']), 'rb').read().split(b'\n')
    b = open(os.path.join(ws, t['file']), 'rb').read().split(b'\n')
    diff = [(i + 1, b[i].decode('utf-8', 'replace')[:80]) for i in range(len(b)) if i >= len(a) or a[i] != b[i]][:2]
    lines.append('-- %s %s (%s, %d TUs): changed files %s, extra files %d, first changed line(s) %s, len %d->%d' % (
        tid, t['file'], t['kind'], t['tu_count'], changed, extra, diff, len(a), len(b)))
    result = {'kind': t['kind'], 'modes': {}}
    for mode in ('light', 'light-bodies', 'reference-raw'):
        path = os.path.join(vdir, 'inj-%s-%s.json' % (tid, mode))
        if not os.path.exists(path):
            continue
        run = json.load(open(path))
        base = base_runs[mode]
        ROOT[0] = run['root']
        keys = list(run['tus'])
        st_i, _, fails_i = aggregate(run, keys)
        tgt_i = os.path.join(run['root'], t['file'])
        ROOT[0] = base['root']
        bkeys = [str(o) for o in t['tus']]
        st_b, _, _ = aggregate(base, bkeys)
        tgt_b = os.path.join(base['root'], t['file'])
        cells = []
        result['modes'][mode] = {r: (st_b[tgt_b][r], st_i[tgt_i][r]) for r in RULES}
        for r in RULES:
            sb, si = st_b[tgt_b][r], st_i[tgt_i][r]
            cells.append('%s:%s' % (r, ('p' if sb == 'parsed' else 'F') + ('' if sb == si else '>' + ('p' if si == 'parsed' else 'F'))))

        def errs(rn, tgt):
            c = collections.Counter()
            for k, tu in rn['tus'].items():
                for d in tu['diags']:
                    if not d.get('ext') and d['file'] == tgt and not d['fnf']:
                        c[(d['cat'], re.sub(r"'[^']*'", 'X', d['sp'])[:60])] += 1
            return c
        new = errs(run, tgt_i) - errs(base, tgt_b)
        # other files newly failing
        others = [rel(f, run['root']) for f in st_i if f != tgt_i and os.path.join(base['root'], rel(f, run['root'])) in st_b
                  and any(st_i[f][r] == 'failed' and st_b[os.path.join(base['root'], rel(f, run['root']))][r] == 'parsed' for r in ('R1', 'R2'))]
        # where is the first unresolved include relative to the new error (R0 excuse)
        lines.append('   %-13s %s | new errors in target: %s | other files newly failing (R1/R2): %s' % (
            mode, ' '.join(cells), dict(new) if new else 'none', others[:4]))
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vdir', required=True)
    ap.add_argument('--their', required=True)
    ap.add_argument('--inject', required=True)
    ap.add_argument('--targets', default='t00-K1,t01-K2,t02-K3,t05-K3,t12-K1,t15-K2,t20-K1,t21-K3,t29-K3,t30-K1b,t35-K1b')
    a = ap.parse_args()
    lines = []
    runs = {}
    for name, f in [('light', 'light-r1.json'), ('light-bodies', 'light-bodies.json'), ('reference-raw', 'reference-raw.json'),
                    ('colcon-light', 'colcon-light.json')]:
        runs[name] = json.load(open(os.path.join(a.vdir, f)))
    root = runs['light']['root']
    ROOT[0] = root
    order = sorted(runs['light']['tus'], key=lambda k: runs['light']['tus'][k]['src'])
    sample = [order[int(round(i * 22 / 19.0))] for i in range(20)]
    lines.append('sample (sorted-by-path positions round(i*22/19)): %d TUs; left out: %s' % (
        len(set(sample)), [rel(runs['light']['tus'][k]['src'], root) for k in order if k not in sample]))
    res = {}
    for name in ('light', 'light-bodies', 'reference-raw'):
        res[name + '/20'] = summarize(name + ' sample20', runs[name], sample, a.their, name, lines)
        res[name + '/23'] = summarize(name + ' all23', runs[name], order, a.their, name, lines)
    summarize('colcon-light all23', runs['colcon-light'], order, None, None, lines)
    ce, _ = edges_of(runs['colcon-light'], order)
    le = res['light/23'][1]
    lines.append('colcon: edges %d vs light %d; lost %d e.g. %s' % (len(ce), len(le), len(le - ce), sorted(le - ce)[:3]))
    # light vs reference-raw directive differences (all 23)
    dl, dr = res['light/23'][2], res['reference-raw/23'][2]
    kinds = collections.Counter()
    examples = collections.defaultdict(list)
    for key in set(dl) | set(dr):
        a1, b1 = dl.get(key), dr.get(key)
        if a1 is None or b1 is None:
            kind = 'only-light' if b1 is None else 'only-reference'
        elif a1[0] == b1[0] and a1[2] == b1[2]:
            continue
        else:
            kind = '%s->%s' % (a1[0], b1[0])
        kinds[kind] += 1
        if len(examples[kind]) < 3:
            examples[kind].append('%s:%d %s' % (key[0], key[1], (a1 or b1)[1]))
    lines.append('light vs reference-raw directives: %s %s' % (dict(kinds), dict(examples)))
    # unresolved names that match a project path suffix
    allfiles = [rel(os.path.join(c, f), root) for c, s, fs in os.walk(root) for f in fs]
    unres = {v[1] for v in dl.values() if v[0] is None}
    hits = sorted(n for n in unres if any(p == n or p.endswith('/' + n) for p in allfiles))
    lines.append('light unresolved distinct names %d; matching a project path suffix: %s' % (len(unres), hits))
    # includes inside function bodies (light-bodies, reference-raw)
    for name in ('light-bodies', 'reference-raw'):
        n = 0
        for k in order:
            tu = runs[name]['tus'][k]
            for f, line, off, sp, inc in tu['dirs']:
                if any(s <= off <= e for s, e in (tu['funcs'] or {}).get(f, [])):
                    n += 1
        lines.append('%s: directives inside function-definition extents: %d' % (name, n))
    # timing over the three light repetitions
    for name in ('light-r1', 'light-r2', 'light-r3'):
        r = json.load(open(os.path.join(a.vdir, name + '.json')))
        pm = [t['parse_ms'] for t in r['tus'].values()]
        cm = [t.get('collect_ms', 0) for t in r['tus'].values()]
        lines.append('%s: parse p50 %.1f max %.1f sum %.0f; collect sum %.1f; wall %.3f s' % (name, pct(pm, 50), max(pm), sum(pm), sum(cm), r['wall_s']))
    base_runs = {'light': runs['light'], 'light-bodies': runs['light-bodies'], 'reference-raw': runs['reference-raw']}
    # reference-raw: errors outside the project, and file-not-found outside the project (they move R0's "first" earlier)
    ext_err = [sum(1 for d in runs['reference-raw']['tus'][k]['diags'] if d.get('ext')) for k in order]
    ext_fnf = sum(1 for k in order for d in runs['reference-raw']['tus'][k]['diags'] if not d.get('ext') and d['fnf'] and not under(d['file'], root))
    lines.append('reference-raw: TUs with external errors %d (min %d max %d); external file-not-found %d' % (
        sum(1 for x in ext_err if x), min(ext_err), max(ext_err), ext_fnf))
    # colcon-sim: one directive (file:line) resolved in some TUs and unresolved in others
    seen = collections.defaultdict(set)
    for k in order:
        for f, line, off, sp, inc in runs['colcon-light']['tus'][k]['dirs']:
            seen[(f, line)].add('project' if under(inc, root) else ('external' if inc else None))
    lines.append('colcon-sim: directives resolved in some TUs and unresolved in others: %d' % sum(1 for v in seen.values() if len(v) > 1))
    totals = collections.defaultdict(lambda: collections.Counter())
    detail = set(a.targets.split(','))
    man = json.load(open(os.path.join(a.inject, 'manifest.json')))
    for t in man['targets']:
        tid = t['id']
        sink = lines if tid in detail else []
        res_t = injection(a.vdir, a.inject, tid, base_runs, sink)
        for mode, rules in res_t['modes'].items():
            kind = 'K1b' if res_t['kind'] == 'K1b' else 'K123'
            for r, (sb, si) in rules.items():
                totals[(mode, kind, r)]['n'] += 1
                if si == 'failed':
                    totals[(mode, kind, r)]['caught'] += 1
                    totals[(mode, res_t['kind'], r)]['caught'] += 1
                    if sb == 'parsed':
                        totals[(mode, kind, r)]['new'] += 1
    lines.append('ALL TARGETS (caught / newly caught):')
    for mode in ('light', 'light-bodies'):
        for kind in ('K123', 'K1b'):
            lines.append('  %-12s %-4s ' % (mode, kind) + ' '.join('%s %d/%d' % (r, totals[(mode, kind, r)]['caught'], totals[(mode, kind, r)]['new'])
                                                            for r in RULES) + ' (n=%d)' % totals[(mode, kind, 'R0')]['n'])
        lines.append('  %-12s by kind  ' % mode + ' '.join('%s:%s' % (k, '/'.join(str(totals[(mode, k, r)]['caught']) for r in ('R0', 'R1', 'R2', 'R3')))
                                                       for k in ('K1', 'K2', 'K3')) + '  (R0/R1/R2/R3)')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
