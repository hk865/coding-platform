#!/usr/bin/env python3
"""Evaluate per-file failure rules over light_include_scan.py NDJSON output.

Run only as:
  python3 -I evaluate_rules.py --root ROOT --out OUT.json [--text OUT.txt] [--exclude-dir D ...]
          [--diff A,B ...] [--truth MODE:RULE] [--expect EXPECTED.json] NDJSON [NDJSON ...]

Rows are grouped by their "mode" field; within a mode the last row per DB index wins.

Rules ("failed" = the file's include edges are not trusted):
  include-resolution diagnostics (never fail a file under R0-R2):
      'missing'           "'x' file not found"
      'angled_recovered'  "'x' file not found with <angled> include; use \"quotes\" instead" (clang then includes it)
      'typo_recovered'    "'x' file not found, did you mean 'y'?"
      'macro_unexpanded'  'expected "FILENAME" or <FILENAME>' (#include MACRO whose macro is undefined here)
  R0     error located in F, not include-resolution, and no unresolved include ('missing' or 'macro_unexpanded'
         diagnostic anywhere in the TU, or a project directive that resolved to nothing) EARLIER in the TU.
         Earlier = smaller preprocessing-order key: the key of (file, offset) is the include chain from the
         main file (offset of each #include on the way, outermost first, as clang_getInclusions reports it for
         the FIRST entry of each file) followed by the offset; keys compare lexicographically.  Files entered
         from -include/predefines get a leading -1.  A diagnostic without a key falls back to emission order.
  R1     error located in F that is not include-resolution.
  R2     error located in F whose category is "Lexical or Preprocessor Issue" or "User-Defined Issue"
         (#error), not include-resolution.     R2lex: "Lexical or Preprocessor Issue" only.
  R3     diagnostics never fail a file.
  Every rule: a TU with status null_tu / crash / timeout / worker_error / args_rejected fails its main file.
  Header rule: parsed if at least one TU reaches it (enters it, or it is the main file) and does not fail it;
  failed if every TU reaching it fails it; skipped if no TU reaches it.
"""
import argparse
import collections
import json
import os
import re
import statistics

RULES = ['R0', 'R1', 'R2', 'R2lex', 'R3']
LEX, USER = 'Lexical or Preprocessor Issue', 'User-Defined Issue'
RESOLUTION = {'missing', 'angled_recovered', 'typo_recovered', 'macro_unexpanded'}
UNRESOLVED_KINDS = {'missing', 'macro_unexpanded'}
EXTS = {'.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.ipp', '.tcc', '.txx', '.inc', '.def'}
FAIL_STATUSES = {'null_tu', 'crash', 'timeout', 'worker_error', 'args_rejected'}


def load(paths):
    modes = collections.defaultdict(dict)
    for path in paths:
        with open(path, 'rb') as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if 'mode' in row and 'tu_index' in row:
                    modes[row['mode']][row['tu_index']] = row
    return modes


def universe(root, excludes, exts):
    files = set()
    for current, subdirs, names in os.walk(root):
        subdirs[:] = [d for d in subdirs if d != '.git' and os.path.join(current, d) not in excludes]
        for name in names:
            if os.path.splitext(name)[1].lower() in exts:
                files.add(os.path.relpath(os.path.join(current, name), root))
    return files


def pct(values, q):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


class ModeResult:
    def __init__(self, mode, rows, root):
        self.mode, self.rows, self.root = mode, rows, root
        self.reach = collections.defaultdict(lambda: {'tus': 0, 'fail': collections.Counter(), 'reason': {}})
        self.edges = set()                 # (from, to) project-internal, deduplicated
        self.directive_targets = collections.defaultdict(set)   # (from, line) -> {to | None | 'EXTERNAL:'+path}
        self.edge_triples = set()          # (from, line, to)
        self.unresolved = {}               # (from, spelled, delim, via_macro) -> count of TUs
        self.external = set()              # (from, spelled) resolved outside the root
        self.skipped = collections.defaultdict(list)            # file -> [(start, end)]
        self.in_body = {}                  # (from, line) -> True/False/'unknown'
        self.status_counts = collections.Counter()
        self.error_categories = collections.Counter()
        self.resolution_kinds = collections.Counter()
        self.dropped_flags = collections.Counter()
        self.unknown_flags = collections.Counter()
        self.affects = collections.Counter()
        self.emission_disagreements = []
        for row in sorted(rows.values(), key=lambda r: (r.get('tu') or '', r['tu_index'])):
            self.add(row)  # path order, so a file's recorded reason comes from the path-first TU (spec 11.4)

    def rel(self, path):
        if path is None:
            return None
        if path == self.root or path.startswith(self.root + '/'):
            return os.path.relpath(path, self.root)
        return None

    @staticmethod
    def flag_key(item):
        flag = item['flag']
        return flag if not item.get('values') else flag + ' <%d value%s>' % (len(item['values']), '' if len(item['values']) == 1 else 's')

    def tu_fails(self, row):
        """{rule: {rel_file: reason}} for one ok TU."""
        diags = [d for d in row.get('diagnostics', []) if d['severity'] >= 3]
        errors = [d for d in diags if d.get('file_not_found') not in RESOLUTION and self.rel(d.get('file'))]
        unresolved = [u for u in row.get('unresolved_positions', [])]
        directive_keys = [x['pos'] for x in row.get('inclusions', []) if x['resolved'] is None and x.get('pos') is not None]
        keys = [u['pos'] for u in unresolved if u.get('pos') is not None] + directive_keys
        first_key = min(keys) if keys else None
        first_emit = min((u['emit'] for u in unresolved), default=None)
        out = {r: {} for r in RULES}
        for d in errors:
            f = self.rel(d['file'])
            reason = '%s:%d %s [%s]' % (f, d['line'], d['spelling'][:120], d['category'])
            out['R1'].setdefault(f, reason)
            if d['category'] in (LEX, USER):
                out['R2'].setdefault(f, reason)
            if d['category'] == LEX:
                out['R2lex'].setdefault(f, reason)
            by_emission = first_emit is not None and first_emit < d['emit']
            if d.get('pos') is not None and first_key is not None:
                earlier_unresolved = first_key < d['pos']   # lexicographic list comparison = preprocessing order
                if earlier_unresolved != by_emission:
                    self.emission_disagreements.append({'tu': row.get('tu_rel'), 'error': reason, 'by_position': earlier_unresolved,
                                                        'by_emission': by_emission})
            else:
                earlier_unresolved = by_emission  # no key on one side: fall back to emission order
            if not earlier_unresolved:
                out['R0'].setdefault(f, reason)
        return out

    def add(self, row):
        status = row.get('status')
        self.status_counts[status] += 1
        for item in row.get('arg_filter', {}).get('dropped', []):
            self.dropped_flags[self.flag_key(item)] += 1
            self.affects[item.get('affects')] += 1
        for item in row.get('arg_filter', {}).get('unknown', []):
            self.unknown_flags[self.flag_key(item) + ' (' + item.get('reason', '') + ')'] += 1
        main = self.rel(row.get('tu'))
        if status != 'ok':
            if status in FAIL_STATUSES and main:
                entry = self.reach[main]
                entry['tus'] += 1
                for r in RULES:
                    entry['fail'][r] += 1
                    entry['reason'].setdefault(r, 'TU ' + status)
            return
        fails = self.tu_fails(row)
        reached = {self.rel(p) for p in row.get('entered_project', [])} | ({main} if main else set())
        reached.discard(None)
        for r in RULES:
            reached |= set(fails[r])
        for f in reached:
            entry = self.reach[f]
            entry['tus'] += 1
            for r in RULES:
                if f in fails[r]:
                    entry['fail'][r] += 1
                    entry['reason'].setdefault(r, fails[r][f])
        for d in row.get('diagnostics', []):
            if d['severity'] >= 3 and self.rel(d.get('file')):
                if d.get('file_not_found'):
                    self.resolution_kinds[d['file_not_found']] += 1
                else:
                    self.error_categories[d['category']] += 1
        for x in row.get('inclusions', []):
            src = self.rel(x['file'])
            if src is None:
                continue
            key = (src, x['line'])
            self.in_body[key] = x.get('in_function_body')
            target = x.get('resolved')
            if target is None:
                self.directive_targets[key].add(None)
                ukey = (src, x['spelled'], x['delim'], x['via_macro'])
                self.unresolved[ukey] = self.unresolved.get(ukey, 0) + 1
            elif self.rel(target) is not None:
                to = self.rel(target)
                self.directive_targets[key].add(to)
                self.edges.add((src, to))
                self.edge_triples.add((src, x['line'], to))
            else:
                self.directive_targets[key].add('EXTERNAL:' + target)
                self.external.add((src, x['spelled']))
        for d in row.get('diagnostics', []):
            if d.get('file_not_found') == 'macro_unexpanded' and self.rel(d.get('file')):
                ukey = (self.rel(d['file']), '(line %d: macro not expanded)' % d['line'], None, True)
                self.unresolved[ukey] = self.unresolved.get(ukey, 0) + 1
        for s in row.get('skipped_ranges', []):
            f = self.rel(s['file'])
            if f:
                self.skipped[f].append((s['start_line'], s['end_line']))

    def statuses(self, files):
        result = {r: {} for r in RULES}
        for f in files | set(self.reach):
            entry = self.reach.get(f)
            for r in RULES:
                if not entry or entry['tus'] == 0:
                    result[r][f] = 'skipped'
                elif entry['fail'][r] >= entry['tus']:
                    result[r][f] = 'failed'
                else:
                    result[r][f] = 'parsed'
        return result

    def timing(self):
        ok = [r for r in self.rows.values() if r.get('status') == 'ok']
        el = [r['elapsed_ms'] for r in self.rows.values() if 'elapsed_ms' in r]
        rss = [r['peak_rss_kb'] for r in ok if r.get('peak_rss_kb')]
        return {'tus': len(self.rows), 'ok': len(ok), 'elapsed_ms_sum': round(sum(el), 1),
                'elapsed_ms_p50': pct(el, .5), 'elapsed_ms_p90': pct(el, .9), 'elapsed_ms_p99': pct(el, .99), 'elapsed_ms_max': max(el) if el else None,
                'parse_ms_sum': round(sum(r.get('parse_ms', 0) for r in ok), 1),
                'visit_ms_sum': round(sum(r.get('visit_ms', 0) for r in ok), 1),
                'peak_rss_kb_p50': pct(rss, .5), 'peak_rss_kb_p90': pct(rss, .9), 'peak_rss_kb_max': max(rss) if rss else None,
                'entered_external_mean': round(statistics.mean([r.get('entered_external_count', 0) for r in ok]), 1) if ok else None}


def conditional_chain(path, line_no):
    """Texts of the open conditional groups (#if/#elif/#else lines) around line_no (1-based)."""
    stack = []
    try:
        with open(path, encoding='utf-8', errors='replace') as handle:
            lines = handle.read().split('\n')
    except OSError:
        return []
    for k, text in enumerate(lines[:line_no - 1], start=1):
        m = re.match(r'\s*#\s*(if|ifdef|ifndef|elif|elifdef|elifndef|else|endif)\b', text)
        if not m:
            continue
        word = m.group(1)
        if word in ('if', 'ifdef', 'ifndef'):
            stack.append([text.strip()])
        elif word == 'endif':
            if stack:
                stack.pop()
        elif stack:
            stack[-1].append(text.strip())
    return [t for group in stack for t in group]


def in_ranges(ranges, line):
    return any(s <= line <= e for s, e in ranges)


def classify(triple, a, b, root):
    """Why is the edge (from, line, to) of mode a missing from mode b?"""
    src, line, to = triple
    targets = b.directive_targets.get((src, line))
    if targets is not None:
        if None in targets:
            return 'missing header (unresolved in other mode)'
        if any(isinstance(t, str) and t.startswith('EXTERNAL:') for t in targets):
            return 'resolved outside the project in other mode'
        return 'resolved to another project file in other mode'
    if not any(src == f for f in b.reach if b.reach[f]['tus']):
        return 'includer not reached in other mode'
    if in_ranges(b.skipped.get(src, []), line):
        chain = conditional_chain(os.path.join(root, src), line)
        return '__has_include' if any('__has_include' in t for t in chain) else 'conditional branch'
    if a.in_body.get((src, line)) is True or b.in_body.get((src, line)) is True:
        return 'inside function body'
    return 'other'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ndjson', nargs='+')
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--text')
    ap.add_argument('--exclude-dir', action='append', default=[])
    ap.add_argument('--diff', action='append', default=[], help='A,B (default: every other mode against reference, and light against light-bodies)')
    ap.add_argument('--truth', default='reference:R1', help='MODE:RULE whose failed set is the comparison truth')
    ap.add_argument('--expect')
    ap.add_argument('--list-limit', type=int, default=50)
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    excludes = {os.path.normpath(os.path.join(root, e)) for e in a.exclude_dir}
    files = universe(root, excludes, EXTS)
    modes = {m: ModeResult(m, rows, root) for m, rows in load(a.ndjson).items()}
    out, text = {'root': root, 'claimed_files': len(files), 'modes': {}, 'diffs': {}, 'truth': {}}, []
    statuses = {}
    lim = a.list_limit
    for m, res in sorted(modes.items()):
        st = res.statuses(files)
        statuses[m] = st
        counts = {r: dict(collections.Counter(st[r].values())) for r in RULES}
        failed = {r: {f: res.reach[f]['reason'].get(r) for f, s in sorted(st[r].items()) if s == 'failed'} for r in RULES}
        edges_nonfailed = {r: sum(1 for (s, t) in res.edges if st[r].get(s) != 'failed') for r in RULES}
        by_name = collections.Counter()
        for (src, spelled, delim, via), n in res.unresolved.items():
            by_name[('<%s>' if delim == '<' else '"%s"' if delim == '"' else '%s (macro)') % spelled] += 1
        out['modes'][m] = {
            'tu_status_counts': dict(res.status_counts), 'timing': res.timing(), 'file_status_counts': counts,
            'failed_files': {r: dict(list(v.items())[:lim]) for r, v in failed.items()},
            'edge_count': len(res.edges), 'edges_from_files_not_failed': edges_nonfailed,
            'edges': sorted(res.edges)[:lim * 20],
            'unresolved_count': len(res.unresolved), 'unresolved_by_name_top': by_name.most_common(lim),
            'unresolved': [{'from': k[0], 'spelled': k[1], 'delim': k[2], 'via_macro': k[3], 'tus': n} for k, n in sorted(res.unresolved.items(), key=str)][:lim * 20],
            'resolved_external_count': len(res.external),
            'error_categories_in_project_files': dict(res.error_categories), 'include_resolution_diagnostics': dict(res.resolution_kinds),
            'arg_dropped_by_tu': dict(res.dropped_flags.most_common()), 'arg_dropped_affects': dict(res.affects),
            'arg_unknown_by_tu': dict(res.unknown_flags.most_common()),
            'r0_position_vs_emission_disagreements': res.emission_disagreements[:lim],
            'in_function_body': {'%s:%d' % k: v for k, v in sorted(res.in_body.items()) if v is not False},
        }
        text.append('== mode %s: TUs %s; claimed files %d' % (m, dict(res.status_counts), len(files)))
        text.append('   timing %s' % json.dumps(res.timing()))
        text.append('   rule   parsed  failed  skipped  edges(from non-failed)')
        for r in RULES:
            c = counts[r]
            text.append('   %-6s %6d  %6d  %7d  %d/%d' % (r, c.get('parsed', 0), c.get('failed', 0), c.get('skipped', 0), edges_nonfailed[r], len(res.edges)))
        text.append('   unresolved %d (top: %s); resolved outside root %d' % (len(res.unresolved), ', '.join('%s x%d' % kv for kv in by_name.most_common(8)), len(res.external)))
        text.append('   error categories in project files: %s; include-resolution diagnostics: %s' % (dict(res.error_categories), dict(res.resolution_kinds)))
        if res.unknown_flags:
            text.append('   unknown args (TUs): %s' % dict(res.unknown_flags.most_common(15)))
        if res.emission_disagreements:
            text.append('   R0 position-vs-emission disagreements: %d (first: %s)' % (len(res.emission_disagreements), res.emission_disagreements[0]))
    pairs = [tuple(p.split(',')) for p in a.diff]
    if not pairs:
        if 'reference' in modes:
            pairs = [(m, 'reference') for m in sorted(modes) if m != 'reference']
        if 'light' in modes and 'light-bodies' in modes:
            pairs.append(('light', 'light-bodies'))
    for x, y in pairs:
        if x not in modes or y not in modes:
            continue
        A, B = modes[x], modes[y]
        a_only = {'%s:%d -> %s' % t: classify(t, A, B, root) for t in sorted(A.edge_triples - B.edge_triples)}
        b_only = {'%s:%d -> %s' % t: classify(t, B, A, root) for t in sorted(B.edge_triples - A.edge_triples)}
        out['diffs']['%s|%s' % (x, y)] = {
            'edges_A': len(A.edges), 'edges_B': len(B.edges),
            'edge_pairs_A_only': len(A.edges - B.edges), 'edge_pairs_B_only': len(B.edges - A.edges),
            'A_only_by_class': dict(collections.Counter(a_only.values())), 'B_only_by_class': dict(collections.Counter(b_only.values())),
            'A_only': dict(list(a_only.items())[:lim * 4]), 'B_only': dict(list(b_only.items())[:lim * 4])}
        text.append('== diff %s vs %s: edges %d vs %d; directive-level only-in-%s %s; only-in-%s %s' % (
            x, y, len(A.edges), len(B.edges), x, dict(collections.Counter(a_only.values())), y, dict(collections.Counter(b_only.values()))))
    tmode, trule = a.truth.split(':')
    if tmode in statuses:
        truth = {f for f, s in statuses[tmode][trule].items() if s == 'failed'}
        for m in sorted(statuses):
            for r in RULES:
                got = {f for f, s in statuses[m][r].items() if s == 'failed'}
                out['truth']['%s:%s' % (m, r)] = {'agree_failed': len(got & truth), 'false_failed': len(got - truth), 'missed_failed': len(truth - got),
                                                  'false_failed_examples': sorted(got - truth)[:lim], 'missed_failed_examples': sorted(truth - got)[:lim]}
        text.append('== against truth %s (failed=%d): mode:rule agree / false-failed / missed' % (a.truth, len(truth)))
        for key, v in out['truth'].items():
            text.append('   %-18s %4d / %4d / %4d' % (key, v['agree_failed'], v['false_failed'], v['missed_failed']))
    if a.expect:
        with open(a.expect, encoding='utf-8') as handle:
            expect = json.load(handle)
        rows, mismatches = [], 0
        emodes = [m for m in expect['modes'] if m in statuses]
        all_files = sorted(files | {f for m in emodes for f in statuses[m]['R0']})
        header = '| file | ' + ' | '.join('%s %s' % (m, '/'.join(RULES)) for m in emodes) + ' |'
        rows.append(header)
        rows.append('|---' * (1 + len(emodes)) + '|')
        abbreviation = {'parsed': 'p', 'failed': 'F', 'skipped': 's'}
        for f in all_files:
            cells = []
            for m in emodes:
                parts = []
                for r in RULES:
                    spec = expect['modes'][m].get(r, {})
                    exp = 'failed' if f in spec.get('failed', []) else 'skipped' if f in spec.get('skipped', []) else 'parsed'
                    got = statuses[m][r].get(f, 'skipped')
                    if exp == got:
                        parts.append(abbreviation[got])
                    else:
                        mismatches += 1
                        parts.append('%s!exp-%s' % (abbreviation[got], abbreviation[exp]))
                cells.append(' '.join(parts))
            rows.append('| %s | %s |' % (f, ' | '.join(cells)))
        checks = []
        for m in emodes:
            e = expect['modes'][m]
            res = modes[m]
            for name, got, exp in [('edges', len(res.edges), e.get('edges')), ('unresolved', len(res.unresolved), e.get('unresolved'))]:
                if exp is not None:
                    checks.append((m, name, exp, got))
            for key, exp in e.get('in_function_body', {}).items():
                src, line = key.rsplit(':', 1)
                checks.append((m, 'in_function_body ' + key, exp, res.in_body.get((src, int(line)))))
        for key, exp in expect.get('diff', {}).items():
            if not all(m in modes for m in key.split('|')):
                continue
            got = out['diffs'].get(key)
            if got is None:
                checks.append(('diff', key, exp, None)); continue
            checks.append(('diff', key + ' A_only', exp['A_only'], got['A_only']))
            checks.append(('diff', key + ' B_only', exp['B_only'], got['B_only']))
        rows.append('')
        rows.append('| where | check | expected | got | ok |')
        rows.append('|---|---|---|---|---|')
        for m, name, exp, got in checks:
            ok = exp == got
            mismatches += 0 if ok else 1
            rows.append('| %s | %s | %s | %s | %s |' % (m, name, json.dumps(exp), json.dumps(got), 'yes' if ok else 'NO'))
        out['expect'] = {'mismatches': mismatches, 'table': rows}
        text.append('== expected vs got (cell = %s; "X!exp-Y" = got X, expected Y): %d mismatches' % ('/'.join(RULES), mismatches))
        text.extend(rows)
    with open(a.out, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False)
    if a.text:
        with open(a.text, 'w', encoding='utf-8') as handle:
            handle.write('\n'.join(text) + '\n')
    print('\n'.join(text))


if __name__ == '__main__':
    main()
