#!/usr/bin/env python3
"""cmake-src: analysis of the light-scan NDJSON runs (scenario A: build tree outside the root; B: visible).

Run only as:  python3 -I cmsrc_analyze.py --out OUT.json --text OUT.txt
Streams the NDJSON files under ~/dsh-work/measure-cpp/results/cmake-src/ (one row in memory at a time, rows fed
in TU-path order so a file's recorded reason comes from the path-first TU) and reads the source and build trees as
data.  Uses evaluate_rules.ModeResult (rules R0, R1, R2, R2lex, R3, unchanged) plus one variant computed here:
  R0file  error located in F, not include-resolution, and no unresolved include EARLIER IN F ITSELF (by offset).
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import argparse  # noqa: E402
import collections  # noqa: E402
import functools  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402

import evaluate_rules as E  # noqa: E402

W = os.path.expanduser('~/dsh-work/measure-cpp')
SRC = W + '/downloads/cmake-3.30.5/cmake-3.30.5'
BLD = W + '/build/cmake-3.30.5'
RES = W + '/results/cmake-src'
SRC_REL = os.path.relpath(SRC, W)
BLD_REL = os.path.relpath(BLD, W)
HEADER_EXTS = {'.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.ipp', '.tcc', '.txx', '.inc', '.def'}
SYSTEM_DIRS = ['/usr/include/c++/13', '/usr/include/x86_64-linux-gnu/c++/13', '/usr/include/c++/13/backward',
               '/usr/lib/gcc/x86_64-linux-gnu/13/include', '/usr/include/x86_64-linux-gnu', '/usr/include']
RULES = E.RULES + ['R0file']
HEAVY = ('diagnostics', 'inclusions', 'unresolved_positions', 'skipped_ranges', 'external_errors', 'entered_project')


def pct(values, q):
    return E.pct(values, q)


def norm_text(spelling):
    s = re.sub(r"'[^']*'", "'X'", spelling)
    s = re.sub(r'"[^"]*"', '"X"', s)
    s = re.sub(r'\b\d+\b', 'N', s)
    return s[:110]


class Tree:
    """Where would a spelled include be found on this host?"""
    def __init__(self):
        self.build = collections.defaultdict(list)
        for cur, dirs, files in os.walk(BLD):
            for f in files:
                self.build[f].append(os.path.relpath(os.path.join(cur, f), BLD))
        self.src = collections.defaultdict(list)
        for cur, dirs, files in os.walk(SRC):
            for f in files:
                self.src[f].append(os.path.relpath(os.path.join(cur, f), SRC))

    @functools.lru_cache(maxsize=None)
    def classify(self, spelled):
        if spelled is None:
            return 'macro not expanded'
        if '@' in spelled:
            return 'configure-template placeholder'
        if any(os.path.isfile(os.path.join(d, spelled)) for d in SYSTEM_DIRS):
            return 'host system header'
        base = spelled.split('/')[-1]
        if any(b == spelled or b.endswith('/' + spelled) for b in self.build.get(base, [])):
            return 'build-tree header (configure output)'
        if any(r == spelled or r.endswith('/' + spelled) for r in self.src.get(base, [])):
            return 'source-tree file not on this search path'
        return 'nowhere on host (other platform / disabled feature)'


def stream_rows(path):
    """Rows in (tu path, tu_index) order; the last row per tu_index wins (as evaluate_rules.load)."""
    index = {}
    with open(path, 'rb') as handle:
        offset = 0
        for line in handle:
            m = re.search(rb'"tu_index": (\d+)', line)
            t = re.search(rb'"tu": ("(?:[^"\\]|\\.)*"|null)', line)
            if m:
                index[int(m.group(1))] = (json.loads(t.group(1)) if t else None, offset, len(line))
            offset += len(line)
    order = sorted(index.items(), key=lambda kv: (kv[1][0] or '', kv[0]))
    with open(path, 'rb') as handle:
        for k, (tu, off, n) in order:
            handle.seek(off)
            yield json.loads(handle.read(n))


def r0file_fails(rel, row):
    unresolved_by_file = collections.defaultdict(list)
    for u in row.get('unresolved_positions', []):
        if u.get('file') and u.get('pos'):
            unresolved_by_file[u['file']].append(u['pos'][-1])
    for x in row.get('inclusions', []):
        if x['resolved'] is None:
            unresolved_by_file[x['file']].append(x['offset'])
    out = {}
    for d in row.get('diagnostics', []):
        if d['severity'] < 3 or d.get('file_not_found') in E.RESOLUTION:
            continue
        f = rel(d.get('file'))
        if f and not any(o < d['offset'] for o in unresolved_by_file.get(d['file'], [])):
            out.setdefault(f, '%s:%d %s [%s]' % (f, d['line'], d['spelling'][:120], d['category']))
    return out


class Acc:
    def __init__(self, name, path, root, tree, light):
        self.name, self.root, self.tree, self.light = name, root, tree, light
        self.res = None
        self.r0file = collections.defaultdict(lambda: [0, 0, None])
        self.allerr = collections.Counter()
        self.anat = collections.Counter()
        self.first_class = collections.Counter()
        self.first_spelled = collections.Counter()
        self.first_index = []
        self.sites = {}
        self.macro_unexpanded = set()
        self.dropped = collections.Counter()
        self.unknown = collections.Counter()
        self.tus_w = self.tus_outside_I = 0
        self.mains = set()
        compact = {}
        for row in stream_rows(path):
            if self.res is None:
                self.res = E.ModeResult(row['mode'], {}, root)
            self.res.add(row)
            self.one(row)
            compact[row['tu_index']] = {k: v for k, v in row.items() if k not in HEAVY}
        self.res.rows = compact

    def one(self, row):
        res = self.res
        rel = res.rel
        main = rel(row.get('tu'))
        if main:
            self.mains.add(main)
        af = row.get('arg_filter', {})
        for item in af.get('dropped', []):
            self.dropped[(item['flag'] + (' <outside root>' if item['table'] == 'outside-root' else ''), len(item['values']), item['table'], item['affects'])] += 1
        for item in af.get('unknown', []):
            self.unknown[(item['flag'], item['reason'])] += 1
        if any(i['flag'] == '-w' for i in af.get('dropped', [])):
            self.tus_w += 1
        if any(i['table'] == 'outside-root' for i in af.get('dropped', [])):
            self.tus_outside_I += 1
        if row.get('status') != 'ok':
            if row.get('status') in E.FAIL_STATUSES and main:
                e = self.r0file[main]; e[0] += 1; e[1] += 1; e[2] = e[2] or 'TU ' + row['status']
            return
        fails = r0file_fails(rel, row)
        reached = {rel(p) for p in row.get('entered_project', [])} | ({main} if main else set())
        reached.discard(None)
        reached |= set(fails)
        for f in reached:
            e = self.r0file[f]; e[0] += 1
            if f in fails:
                e[1] += 1; e[2] = e[2] or fails[f]
        errs = []
        for d in row.get('diagnostics', []):
            if d['severity'] >= 3 and not d.get('file_not_found') and rel(d.get('file')):
                self.allerr[norm_text(d['spelling']) + ' [' + d['category'] + ']'] += 1
                errs.append(d)
            if d.get('file_not_found') == 'macro_unexpanded' and rel(d.get('file')):
                self.macro_unexpanded.add((rel(d['file']), d['line']))
        unres = [(u['pos'], u['file'], u['line']) for u in row.get('unresolved_positions', []) if u.get('pos') is not None]
        unres += [(x['pos'], x['file'], x['line']) for x in row.get('inclusions', []) if x['resolved'] is None and x.get('pos') is not None]
        self.anat['ok_tus'] += 1
        if unres:
            self.anat['tus_with_unresolved_include'] += 1
            first = min(unres)
            spelled = next((x['spelled'] for x in row.get('inclusions', []) if x['file'] == first[1] and x['line'] == first[2]), None)
            self.first_class[self.tree.classify(spelled)] += 1
            self.first_spelled[str(spelled)] += 1
            order = [x['pos'] for x in row.get('inclusions', []) if x.get('pos') is not None]
            self.first_index.append(sum(1 for p in order if p < first[0]))
            if first[1] != row.get('tu'):
                self.anat['first_unresolved_in_a_header'] += 1
        else:
            self.anat['tus_without_unresolved_include'] += 1
        if errs:
            self.anat['tus_with_project_errors'] += 1
            if unres and all(d.get('pos') is not None and min(unres)[0] < d['pos'] for d in errs):
                self.anat['tus_with_errors_all_after_first_unresolved'] += 1
            if not unres:
                self.anat['tus_with_errors_and_no_unresolved'] += 1
        for x in row.get('inclusions', []):
            src = rel(x['file'])
            if src is None:
                continue
            s = self.sites.setdefault((src, x['line']), {'targets': set(), 'via_macro': False, 'delim': None, 'spelled': set(), 'in_body': set()})
            tgt = x['resolved']
            s['targets'].add((rel(tgt) or 'EXTERNAL') if tgt else None)
            s['via_macro'] |= bool(x['via_macro'])
            s['delim'] = x['delim']
            s['spelled'].add(x['spelled'])
            s['in_body'].add(str(x.get('in_function_body')))

    def statuses(self, universe):
        st = self.res.statuses(universe)
        st['R0file'] = {}
        self.r0file_reason = {}
        for f in universe | set(self.r0file):
            e = self.r0file.get(f)
            if not e or e[0] == 0:
                st['R0file'][f] = 'skipped'
            elif e[1] >= e[0]:
                st['R0file'][f] = 'failed'; self.r0file_reason[f] = e[2]
            else:
                st['R0file'][f] = 'parsed'
        return st


def categories(universe, mains):
    cat = {}
    for f in universe:
        ext = os.path.splitext(f)[1].lower()
        cat[f] = 'main' if f in mains else 'header' if ext in HEADER_EXTS else 'other-source'
    return cat


def summary(acc, universe):
    res, tree = acc.res, acc.tree
    cat = categories(universe, acc.mains)
    st = acc.statuses(universe)
    out = {'tu_status_counts': dict(res.status_counts)}
    table = {}
    for r in RULES:
        c = collections.Counter((cat.get(f, 'outside-universe'), s) for f, s in st[r].items())
        table[r] = {k: {s: c.get((k, s), 0) for s in ('parsed', 'failed', 'skipped')} for k in ('main', 'header', 'other-source', 'outside-universe')}
    out['file_status'] = table
    fails = {}
    for r in RULES:
        failed = sorted(f for f, s in st[r].items() if s == 'failed')
        texts, example = collections.Counter(), {}
        for f in failed:
            reason = (acc.r0file_reason.get(f) if r == 'R0file' else res.reach[f]['reason'].get(r)) or ''
            m = re.match(r'(\S+?):(\d+) (.*) \[(.*)\]$', reason)
            key = (norm_text(m.group(3)) + ' [' + m.group(4) + ']') if m else reason
            texts[key] += 1
            example.setdefault(key, reason)
        fails[r] = {'failed_main': sum(1 for f in failed if cat.get(f) == 'main'),
                    'failed_header': sum(1 for f in failed if cat.get(f) == 'header'),
                    'failed_other': sum(1 for f in failed if cat.get(f) not in ('main', 'header')),
                    'top_reasons': texts.most_common(10), 'examples': [example[k] for k, _ in texts.most_common(5)],
                    'failed_list_head': failed[:40]}
    out['failures'] = fails
    out['project_error_texts_top'] = acc.allerr.most_common(12)
    out['project_error_total'] = sum(acc.allerr.values())
    fi = acc.first_index
    out['r0_anatomy'] = dict(acc.anat, first_unresolved_class=dict(acc.first_class),
                             first_unresolved_spelled_top=acc.first_spelled.most_common(12),
                             first_unresolved_directive_index={'min': min(fi) if fi else None, 'p50': pct(fi, .5), 'p90': pct(fi, .9),
                                                               'max': max(fi) if fi else None, 'zero': sum(1 for v in fi if v == 0)},
                             position_vs_emission_disagreements=len(res.emission_disagreements),
                             disagreement_examples=res.emission_disagreements[:3])
    sites = acc.sites
    unres_sites = {k: v for k, v in sites.items() if None in v['targets']}
    by_delim, spell, cls_sites, cls_spell = collections.Counter(), collections.defaultdict(set), collections.Counter(), collections.defaultdict(set)
    for k, v in unres_sites.items():
        d = 'macro' if v['via_macro'] else v['delim']
        by_delim[d] += 1
        sp0 = sorted(v['spelled'])[0]
        c = ('via macro: ' if v['via_macro'] else ('%s ' % d)) + tree.classify(sp0)
        cls_sites[c] += 1
        for sp in v['spelled']:
            spell[d].add(sp)
            cls_spell[('via macro: ' if v['via_macro'] else ('%s ' % d)) + tree.classify(sp)].add(sp)
    macro_sites = {k: v for k, v in sites.items() if v['via_macro']}
    in_body = sorted('%s:%d' % k for k, v in sites.items() if 'True' in v['in_body'])
    out['edges'] = {'edge_pairs': len(res.edges), 'edge_triples': len(res.edge_triples), 'directive_sites': len(sites),
                    'sites_resolved_in_project': sum(1 for v in sites.values() if any(t not in (None, 'EXTERNAL') for t in v['targets'])),
                    'sites_resolved_external': sum(1 for v in sites.values() if 'EXTERNAL' in v['targets']),
                    'sites_unresolved_in_some_tu': len(unres_sites), 'unresolved_sites_by_delim': dict(by_delim),
                    'unresolved_distinct_spellings_by_delim': {k: len(v) for k, v in spell.items()},
                    'unresolved_sites_by_class': dict(cls_sites.most_common()),
                    'unresolved_spellings_by_class': {k: len(v) for k, v in sorted(cls_spell.items())},
                    'evaluator_unresolved_keys': len(res.unresolved),
                    'macro_include_sites': len(macro_sites),
                    'macro_include_sites_resolved_somewhere': sum(1 for v in macro_sites.values() if any(t is not None for t in v['targets'])),
                    'macro_include_sites_unresolved_somewhere': sum(1 for v in macro_sites.values() if None in v['targets']),
                    'macro_include_examples': sorted('%s:%d %s' % (k[0], k[1], sorted(v['spelled'])) for k, v in macro_sites.items())[:8],
                    'macro_unexpanded_diagnostic_sites': len(acc.macro_unexpanded),
                    'macro_unexpanded_examples': sorted('%s:%d' % k for k in acc.macro_unexpanded)[:10],
                    'in_function_body_sites': 'unknown (bodies skipped)' if acc.light else len(in_body),
                    'in_function_body_examples': in_body[:25]}
    rows = list(res.rows.values())
    ok = [r for r in rows if r.get('status') == 'ok']
    el = [r['elapsed_ms'] for r in rows if 'elapsed_ms' in r]

    def stats(v):
        return {'n': len(v), 'sum_s': round(sum(v) / 1000, 1), 'mean': round(sum(v) / len(v), 1) if v else None,
                'p50': pct(v, .5), 'p95': pct(v, .95), 'p99': pct(v, .99), 'max': max(v) if v else None}
    rss = [r['peak_rss_kb'] for r in ok if r.get('peak_rss_kb')]
    base = [r['rss_before_kb'] for r in ok if r.get('rss_before_kb')]
    out['timing'] = {'elapsed_ms': stats(el), 'worker_ms': stats([r['worker_ms'] for r in ok if 'worker_ms' in r]),
                     'parse_ms': stats([r['parse_ms'] for r in ok]),
                     'visit_ms_sum_s': round(sum(r.get('visit_ms', 0) for r in ok) / 1000, 2),
                     'peak_rss_mb': {'p50': round(pct(rss, .5) / 1024, 1), 'p95': round(pct(rss, .95) / 1024, 1), 'max': round(max(rss) / 1024, 1)} if rss else None,
                     'rss_before_mb': {'min': round(min(base) / 1024, 1), 'p50': round(pct(base, .5) / 1024, 1), 'max': round(max(base) / 1024, 1)} if base else None,
                     'timeouts': sum(1 for r in rows if r.get('status') == 'timeout'),
                     'crashes': sum(1 for r in rows if r.get('status') == 'crash'),
                     'projected_2000_tus_single_worker_s': round(sum(el) / len(el) * 2000 / 1000, 1) if el else None,
                     'slowest': sorted(((r['elapsed_ms'], r.get('tu_rel') or r.get('tu')) for r in rows if 'elapsed_ms' in r), reverse=True)[:5]}
    out['args'] = {'dropped_occurrences': [[list(k), n] for k, n in acc.dropped.most_common()],
                   'unknown_occurrences': [[list(k), n] for k, n in acc.unknown.most_common()],
                   'tus_with_dropped_w': acc.tus_w, 'tus_with_outside_root_include_path': acc.tus_outside_I}
    return out, st


def map_b(path):
    if path is None:
        return None
    if path.startswith(SRC_REL + '/'):
        return path[len(SRC_REL) + 1:]
    if path.startswith(BLD_REL + '/'):
        return '<build>/' + path[len(BLD_REL) + 1:]
    return '<other>/' + path


def summarize_diff(d_a, d_b, mapper=lambda p: p, limit=6):
    out = {}
    for side, d in (('A_only', d_a), ('B_only', d_b)):
        by = collections.defaultdict(list)
        for t, c in d.items():
            by[c].append('%s:%d -> %s' % (mapper(t[0]), t[1], mapper(t[2])))
        out[side] = {c: {'count': len(v), 'examples': v[:limit]} for c, v in sorted(by.items())}
    return out


def condition_macros(root, triples):
    words = collections.Counter()
    for (src, line, to) in triples:
        ids = set()
        for t in E.conditional_chain(os.path.join(root, src), line):
            body = re.sub(r'^\s*#\s*\w+', '', t)
            body = re.sub(r'/\*.*?\*/|//.*$', '', body)
            for w in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', body):
                if w not in ('defined', '__has_include', '__has_include_next'):
                    ids.add(w)
        for w in ids:
            words[w] += 1
    return words.most_common(25)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--text', required=True)
    a = ap.parse_args()
    tree = Tree()
    univ_a = E.universe(SRC, set(), E.EXTS)
    univ_b = {os.path.relpath(os.path.join(SRC, f), W) for f in univ_a} | {os.path.relpath(os.path.join(BLD, f), W) for f in E.universe(BLD, set(), E.EXTS)}
    result = {'claimed_files_A': len(univ_a), 'claimed_files_B': len(univ_b), 'modes': {}, 'diffs': {}}
    accs, sts = {}, {}
    for name, root, univ, light in (('light-A', SRC, univ_a, True), ('lbodies-A', SRC, univ_a, False), ('ref-A', SRC, univ_a, False),
                                    ('light-B', W, univ_b, True), ('lbodies-B', W, univ_b, False), ('ref-W', W, univ_b, False)):
        path = os.path.join(RES, ('ref-B' if name == 'ref-W' else name) + '.ndjson')
        acc = Acc(name, path, root, tree, light)
        accs[name] = acc
        result['modes'][name], sts[name] = summary(acc, univ)
        print('done', name, flush=True)
    for name in ('light-B', 'lbodies-B', 'ref-W'):
        st = sts[name]
        result['modes'][name]['failed_in_source_tree'] = {r: sum(1 for f, s in st[r].items() if s == 'failed' and f.startswith(SRC_REL + '/')) for r in RULES}
        result['modes'][name]['failed_in_build_tree'] = {r: sum(1 for f, s in st[r].items() if s == 'failed' and f.startswith(BLD_REL + '/')) for r in RULES}
    LA, RA, LB, RW, BA = accs['light-A'].res, accs['ref-A'].res, accs['light-B'].res, accs['ref-W'].res, accs['lbodies-A'].res
    a1 = {t: E.classify(t, LA, RA, SRC) for t in sorted(LA.edge_triples - RA.edge_triples)}
    b1 = {t: E.classify(t, RA, LA, SRC) for t in sorted(RA.edge_triples - LA.edge_triples)}
    a2 = {t: E.classify(t, LB, RW, W) for t in sorted(LB.edge_triples - RW.edge_triples)}
    b2 = {t: E.classify(t, RW, LB, W) for t in sorted(RW.edge_triples - LB.edge_triples)}
    a3 = {t: E.classify(t, BA, LA, SRC) for t in sorted(BA.edge_triples - LA.edge_triples)}
    b3 = {t: E.classify(t, LA, BA, SRC) for t in sorted(LA.edge_triples - BA.edge_triples)}
    result['diffs']['light-A|reference'] = summarize_diff(a1, b1)
    result['diffs']['light-B|reference(root W)'] = summarize_diff(a2, b2, map_b)
    result['diffs']['lbodies-A|light-A'] = summarize_diff(a3, b3)
    b_a_only = {(map_b(t[0]), t[1], map_b(t[2])) for t in a2}
    b_b_only = {(map_b(t[0]), t[1], map_b(t[2])) for t in b2}
    decomp, examples = collections.Counter(), collections.defaultdict(list)
    sysb = {'only-in-light': [], 'only-in-reference': []}
    bldb = {'only-in-light': [], 'only-in-reference': []}
    for side, d, bset in (('only-in-light', a1, b_a_only), ('only-in-reference', b1, b_b_only)):
        for t, c in d.items():
            persists = t in bset
            key = '%s | %s | %s' % (side, 'persists with build tree visible (system headers)' if persists else 'gone with build tree visible (build-tree headers)', c)
            decomp[key] += 1
            if len(examples[key]) < 6:
                examples[key].append('%s:%d -> %s' % t)
            if c in ('conditional branch', '__has_include'):
                (sysb if persists else bldb)[side].append(t)
    result['diffs']['decomposition light-A vs reference'] = {k: {'count': n, 'examples': examples[k]} for k, n in sorted(decomp.items())}
    result['diffs']['condition identifiers, branch differences that persist with build tree visible'] = {k: condition_macros(SRC, v) for k, v in sysb.items()}
    result['diffs']['condition identifiers, branch differences that go away with build tree visible'] = {k: condition_macros(SRC, v) for k, v in bldb.items()}
    result['diffs']['pairs'] = {
        'light-A vs reference': {'light_pairs': len(LA.edges), 'reference_pairs': len(RA.edges), 'pairs_only_light': len(LA.edges - RA.edges),
                                 'pairs_only_reference': len(RA.edges - LA.edges), 'triples_light': len(LA.edge_triples),
                                 'triples_reference': len(RA.edge_triples), 'triples_only_light': len(a1), 'triples_only_reference': len(b1)},
        'light-B vs reference (root W, build tree is project)': {'light_pairs': len(LB.edges), 'reference_pairs': len(RW.edges),
                                                                 'pairs_only_light': len(LB.edges - RW.edges), 'pairs_only_reference': len(RW.edges - LB.edges),
                                                                 'triples_only_light': len(a2), 'triples_only_reference': len(b2)}}
    st, st_ref = sts['light-A']['R3'], sts['ref-A']['R3']
    hdr = lambda f: os.path.splitext(f)[1].lower() in HEADER_EXTS  # noqa: E731
    skipped = [f for f, s in st.items() if s == 'skipped' and hdr(f)]
    result['headers'] = {'claimed_header_files_A': sum(1 for f in univ_a if hdr(f)),
                         'reached_light_A': sum(1 for f, s in st.items() if s != 'skipped' and hdr(f)),
                         'skipped_light_A': len(skipped),
                         'skipped_top_dirs': collections.Counter('/'.join(f.split('/')[:2]) for f in skipped).most_common(12),
                         'reached_reference': sum(1 for f, s in st_ref.items() if s != 'skipped' and hdr(f)),
                         'reached_in_reference_not_light_count': sum(1 for f, s in st_ref.items() if s != 'skipped' and st.get(f) == 'skipped'),
                         'reached_in_reference_not_light': sorted(f for f, s in st_ref.items() if s != 'skipped' and st.get(f) == 'skipped')[:30],
                         'reached_in_light_not_reference_count': sum(1 for f, s in st.items() if s != 'skipped' and st_ref.get(f) == 'skipped'),
                         'reached_in_light_not_reference': sorted(f for f, s in st.items() if s != 'skipped' and st_ref.get(f) == 'skipped')[:30]}
    # reach per file in light-A (for choosing injection targets)
    reach = {f: e['tus'] for f, e in accs['light-A'].res.reach.items() if e['tus']}
    with open(os.path.join(RES, 'reach-light-A.json'), 'w', encoding='utf-8') as handle:
        json.dump(reach, handle)
    with open(a.out, 'w', encoding='utf-8') as handle:
        json.dump(result, handle, indent=1, ensure_ascii=False, default=list)
    lines = []
    for name, m in result['modes'].items():
        lines.append('== %s %s' % (name, m['tu_status_counts']))
        for r in RULES:
            t = m['file_status'][r]
            lines.append('  %-7s main p/F/s %4d/%4d/%4d  header p/F/s %4d/%4d/%4d  other-src p/F/s %4d/%4d/%4d' % (
                r, t['main']['parsed'], t['main']['failed'], t['main']['skipped'], t['header']['parsed'], t['header']['failed'], t['header']['skipped'],
                t['other-source']['parsed'], t['other-source']['failed'], t['other-source']['skipped']))
    with open(a.text, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
