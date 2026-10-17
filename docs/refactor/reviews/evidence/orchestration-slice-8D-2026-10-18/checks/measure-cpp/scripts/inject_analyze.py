#!/usr/bin/env python3
"""Analyse the injection runs (task c): which rules mark the injected file failed, per mode.

Run only as: python3 -I inject_analyze.py --dir DIR --scan BASELINE.ndjson --out OUT.json [--text OUT.txt]
Baseline = the same TUs (orig_tu_index) of the same mode from the unmodified scan.  Rules come from
evaluate_rules.py (same folder, imported explicitly) plus one exploratory rule:
  R4  error located in F whose category is Lexical/Preprocessor, User-Defined or "Parse Issue" (not include-resolution).
"""
import argparse
import collections
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate_rules as E  # noqa: E402

LEX, USER, PARSE = E.LEX, E.USER, 'Parse Issue'
RULES = E.RULES + ['R4']


class Result(E.ModeResult):
    """ModeResult with the extra rule R4."""

    def tu_fails(self, row):
        out = super().tu_fails(row)
        out['R4'] = {}
        for d in row.get('diagnostics', []):
            f = self.rel(d.get('file'))
            if d['severity'] >= 3 and f and d.get('file_not_found') not in E.RESOLUTION and d['category'] in (LEX, USER, PARSE):
                out['R4'].setdefault(f, '%s:%d %s [%s]' % (f, d['line'], d['spelling'][:120], d['category']))
        return out

    def add(self, row):
        saved = E.RULES
        E.RULES = RULES
        try:
            super().add(row)
        finally:
            E.RULES = saved

    def statuses_all(self):
        result = {r: {} for r in RULES}
        for f, entry in self.reach.items():
            for r in RULES:
                result[r][f] = 'skipped' if entry['tus'] == 0 else 'failed' if entry['fail'][r] >= entry['tus'] else 'parsed'
        return result


def load_rows(path, mode, key='tu_index'):
    rows = {}
    if not os.path.exists(path):
        return rows
    for line in open(path, encoding='utf-8'):
        r = json.loads(line)
        if r.get('mode') == mode:
            rows[r[key]] = r
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--scan', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--text')
    ap.add_argument('--modes', default='light,light-bodies,reference-raw')
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.dir, 'manifest.json'), encoding='utf-8'))
    root = manifest['root']
    modes = a.modes.split(',')
    base_all = {m: load_rows(a.scan, m) for m in modes}
    out, text = [], []
    agg = collections.defaultdict(lambda: collections.Counter())
    for t in manifest['targets']:
        if t.get('skipped'):
            continue
        tdir = os.path.join(a.dir, t['id'])
        sub = json.load(open(os.path.join(tdir, 'compile_commands.json'), encoding='utf-8'))
        orig = [e['orig_tu_index'] for e in sub]
        rec = {'id': t['id'], 'kind': t['kind'], 'role': t['role'], 'file': t['file'], 'tus': len(orig), 'where': t['where'], 'modes': {}}
        for m in modes:
            inj_rows = load_rows(os.path.join(tdir, 'scan.ndjson'), m)
            if len(inj_rows) < len(orig):
                rec['modes'][m] = {'incomplete': '%d/%d TUs' % (len(inj_rows), len(orig))}
                continue
            base_rows = {k: base_all[m][k] for k in orig if k in base_all[m]}
            inj = Result(m, inj_rows, os.path.realpath(t['ws']))
            base = Result(m, base_rows, root)
            si, sb = inj.statuses_all(), base.statuses_all()
            per_rule = {}
            for r in RULES:
                b, i = sb[r].get(t['file'], 'skipped'), si[r].get(t['file'], 'skipped')
                newly_other = sorted(f for f, s in si[r].items() if f != t['file'] and s == 'failed' and sb[r].get(f) != 'failed')
                per_rule[r] = {'baseline': b, 'injected': i, 'other_files_newly_failed': newly_other}
                agg[(m, t['kind'], t['role'], r)]['targets'] += 1
                agg[(m, t['kind'], t['role'], r)]['detected'] += i == 'failed'
                agg[(m, t['kind'], t['role'], r)]['newly'] += (i == 'failed' and b != 'failed')
                agg[(m, t['kind'], t['role'], r)]['base_failed'] += b == 'failed'
                agg[(m, t['kind'], t['role'], r)]['collateral_targets'] += bool(newly_other)
            # new diagnostics: (file, line, text) present after injection, not before (positions shift; compare text+file)
            def diag_set(rows, rr):
                c = collections.Counter()
                for row in rows.values():
                    for d in row.get('diagnostics', []):
                        if d['severity'] >= 3 and d.get('file_not_found') is None:
                            c[(rr(d['file']), d['category'], d['spelling'][:100])] += 1
                return c
            new = diag_set(inj_rows, inj.rel) - diag_set(base_rows, base.rel)
            in_target = [k for k in new if k[0] == t['file']]
            elsewhere = [k for k in new if k[0] != t['file']]
            # R0 excuse: first unresolved include of each TU (by key) and whether the target's new error comes after it
            excused = []
            for k, row in inj_rows.items():
                keys = [u['pos'] for u in row.get('unresolved_positions', []) if u.get('pos')]
                keys += [x['pos'] for x in row.get('inclusions', []) if x['resolved'] is None and x.get('pos')]
                first = min(keys) if keys else None
                firstrow = None
                if first is not None:
                    firstrow = next(((inj.rel(u['file']), u['line']) for u in row.get('unresolved_positions', []) if u.get('pos') == first), None)
                    if firstrow is None:
                        firstrow = next(((inj.rel(x['file']), x['line'], x['spelled']) for x in row.get('inclusions', []) if x.get('pos') == first), None)
                excused.append(firstrow)
            rec['modes'][m] = {'rules': per_rule, 'new_errors_in_target': [list(k) for k in in_target][:6],
                               'new_errors_in_target_count': sum(new[k] for k in in_target),
                               'new_errors_elsewhere': [list(k) for k in elsewhere][:6], 'new_errors_elsewhere_count': sum(new[k] for k in elsewhere),
                               'first_unresolved_include_per_tu': excused[:3]}
        out.append(rec)
    summary = []
    for (m, kind, role, r), c in sorted(agg.items()):
        summary.append({'mode': m, 'kind': kind, 'role': role, 'rule': r, **dict(c)})
    json.dump({'targets': out, 'summary': summary}, open(a.out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    abbreviation = {'parsed': 'p', 'failed': 'F', 'skipped': 's'}
    text.append('cell per mode = R0/R1/R2/R2lex/R3/R4 injected status (baseline->injected when they differ, lower-case p = parsed)')
    for rec in out:
        cells = []
        for m in modes:
            mm = rec['modes'].get(m, {})
            if 'rules' not in mm:
                cells.append(mm.get('incomplete', '-')); continue
            parts = []
            for r in RULES:
                b, i = mm['rules'][r]['baseline'], mm['rules'][r]['injected']
                parts.append(abbreviation[i] if b == i else '%s>%s' % (abbreviation[b], abbreviation[i]))
            cells.append(' '.join(parts))
        text.append('%s %-6s %s (%d TU) | %s' % (rec['id'], rec['role'], rec['file'].split('/')[-1], rec['tus'], ' | '.join(cells)))
        for m in modes:
            mm = rec['modes'].get(m, {})
            if 'rules' in mm:
                text.append('     %s: new errors in target %d %s; elsewhere %d %s; first unresolved %s' % (
                    m, mm['new_errors_in_target_count'], mm['new_errors_in_target'][:2], mm['new_errors_elsewhere_count'],
                    mm['new_errors_elsewhere'][:2], mm['first_unresolved_include_per_tu'][:1]))
    text.append('')
    text.append('summary: mode kind role rule -> detected (failed after) / newly (parsed before) / baseline already failed / targets with collateral / targets')
    for s in summary:
        text.append('  %-13s %-3s %-6s %-5s %2d / %2d / %2d / %2d / %2d' % (s['mode'], s['kind'], s['role'], s['rule'], s['detected'], s['newly'],
                                                                     s['base_failed'], s['collateral_targets'], s['targets']))
    if a.text:
        open(a.text, 'w', encoding='utf-8').write('\n'.join(text) + '\n')
    print('\n'.join(text))


if __name__ == '__main__':
    main()
