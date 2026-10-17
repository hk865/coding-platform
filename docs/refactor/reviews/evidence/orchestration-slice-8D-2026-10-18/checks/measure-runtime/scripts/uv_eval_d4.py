#!/usr/bin/env python3
"""Apply slice-8 spec DRAFT 4 section 11.4 / 11.5 rules to the patched prototype's NDJSON, and compare with the true
compile (prototype 'reference' mode = libclang WITH system headers, and GCC 13 'gcc -E -H').

Run only as:
  python3 -I uv_eval_d4.py --db DB --root ROOT --claimed CLAIMED.txt --vfs VFS.txt --light LIGHT.ndjson
          [--reference REF.ndjson] [--gcc GCC.ndjson] --out OUT.json --text OUT.txt [--label NAME]

Draft 4 rules implemented here (prototype rows are per database entry; the rules are applied afterwards):
  * units: entries deduplicated on (main file, filtered arguments), first kept; entries whose main file is not an
    observed (claimed) file are dropped and counted for the note '<n> 个编译单元的主文件不在观测的文件里'.
  * arguments: the prototype's table; any 'unknown' argument fails the unit's main file (不认识的编译参数：<arg>).
  * a unit that did not finish: main file failed (超时 / 分析进程崩溃 / libclang 解析不了（code n）).
  * angled / typo fallback: the directive is unresolved with reason 尖括号引用只能按引号规则找到 / 拼写纠正后才找到;
    a file whose every entry in the unit passes through such a directive (include stack) is not read by the unit
    and its directives are not recorded.
  * #include MACRO with the macro undefined (expected "FILENAME" or <FILENAME>): unresolved, reason include 后面跟宏.
  * R2lex: an Error/Fatal diagnostic located in the file, category 'Lexical or Preprocessor Issue', not one of the
    four include-resolution diagnostics -> the file fails in this unit (预处理出错：<message[:200]>); its edges and
    unresolved references from this unit are dropped.
  * merge: parsed if any unit read it without failing it; failed if every unit that read it failed it (reason of the
    unit whose main file sorts first, then the lower number); skipped 没有编译单元包含它 / 有编译单元没有做完.
    Edges deduplicated on (from, to); an unresolved (from, specifier) is dropped when that pair has an edge in any unit.
"""
import argparse
import collections
import importlib.util
import json
import os
import re
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('uvscan', os.path.join(HERE, 'uv_light_include_scan.py'))
uvscan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uvscan)

LEX = 'Lexical or Preprocessor Issue'
RESOLUTION = {'missing', 'angled_recovered', 'typo_recovered', 'macro_unexpanded'}
FALLBACK_REASON = {'angled_recovered': '尖括号引用只能按引号规则找到', 'typo_recovered': '拼写纠正后才找到'}
NOTE_AFFECTS = {'macros', 'language', 'include-paths'}


def pct(values, q):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


def load_rows(path):
    rows = {}
    if not path:
        return rows
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if 'tu_index' in row:
                rows[row['tu_index']] = row
    return rows


class Source:
    def __init__(self, root):
        self.root, self.cache = root, {}

    def lines(self, rel):
        if rel not in self.cache:
            try:
                with open(os.path.join(self.root, rel), encoding='utf-8', errors='replace') as handle:
                    self.cache[rel] = handle.read().split('\n')
            except OSError:
                self.cache[rel] = []
        return self.cache[rel]

    def line(self, rel, n):
        lines = self.lines(rel)
        return lines[n - 1] if 0 < n <= len(lines) else ''


def directory_of(path):
    return path.rsplit('/', 1)[0] if '/' in path else '.'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--root', required=True)
    ap.add_argument('--claimed', required=True)
    ap.add_argument('--vfs', required=True)
    ap.add_argument('--light', required=True)
    ap.add_argument('--reference')
    ap.add_argument('--gcc')
    ap.add_argument('--out', required=True)
    ap.add_argument('--text', required=True)
    ap.add_argument('--label', default='')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    src = Source(root)
    claimed = [l.strip() for l in open(a.claimed, encoding='utf-8') if l.strip()]
    claimed_set = set(claimed)
    vfs_set = {l.strip() for l in open(a.vfs, encoding='utf-8') if l.strip()}
    with open(a.db, encoding='utf-8') as handle:
        db = json.load(handle)
    light = load_rows(a.light)
    reference = load_rows(a.reference)
    gcc = load_rows(a.gcc)
    T = []  # text report

    def rel(path):
        if path and (path == root or path.startswith(root + '/')):
            return os.path.relpath(path, root)
        return None

    # ---- 1. units (draft 4 11.4 numbering) and notes from the database ----
    seen, units, dup_entries, not_observed = {}, [], [], []
    outside_dirs, unreadable_forced, note_flags, unknown_by_entry = set(), set(), set(), {}
    for k, entry in enumerate(db):
        filt = uvscan.filter_arguments(entry, root, keep_outside_root=False)
        main_rel = rel(filt['source']) if filt['source'] else None
        for item in filt['dropped']:
            if item['table'] == 'outside-root':
                path = uvscan.norm_join(entry['directory'], item['values'][0])
                (unreadable_forced if item['flag'] in ('-include', '-imacros') else outside_dirs).add(path)
            elif item['affects'] in NOTE_AFFECTS:
                note_flags.add(item['flag'].split('=')[0] if item['affects'] == 'include-paths' else item['flag'])
        if main_rel is None or main_rel not in claimed_set:
            not_observed.append(k)
            continue
        key = (main_rel, tuple(filt['args']))
        if key in seen:
            dup_entries.append((k, seen[key]))
            continue
        seen[key] = k
        units.append({'unit': len(units), 'entry': k, 'main': main_rel, 'unknown': filt['unknown']})
    notes = ['近似：只读工作区里 git 不忽略的头文件']
    if note_flags:
        notes.append('忽略的编译参数：' + '、'.join(sorted(note_flags)))
    if outside_dirs:
        notes.append('忽略了 %d 个工作区外的查找目录' % len(outside_dirs))
    if unreadable_forced:
        notes.append('忽略了 %d 个读不到的强制包含文件' % len(unreadable_forced))
    if not_observed:
        notes.append('%d 个编译单元的主文件不在观测的文件里' % len(not_observed))
    notes = sorted(set(notes))
    T.append('== %s: database entries %d; units after dedupe %d; duplicates dropped %d; main not observed %d'
             % (a.label, len(db), len(units), len(dup_entries), len(not_observed)))
    T.append('   notes: %s' % notes)

    # ---- 2. per unit, draft 4 rules on the light rows ----
    per_unit = []
    raw_light_directives = collections.defaultdict(set)   # (file, line) -> {target rel | None | 'EXT:' }
    fallback_directives = []
    macro_unexpanded_sites = []
    failure_examples = []
    timing = []
    unit_status = collections.Counter()
    for u in units:
        row = light.get(u['entry'])
        res = {'unit': u['unit'], 'main': u['main'], 'files': {}, 'edges': set(), 'unresolved': set(), 'done': True}
        if u['unknown']:
            flag = u['unknown'][0]['flag']
            res['files'][u['main']] = ('failed', '不认识的编译参数：' + flag.split('=')[0])
            unit_status['args_rejected'] += 1
            per_unit.append(res)
            continue
        if row is None or row.get('status') != 'ok':
            status = row.get('status') if row else 'missing_row'
            reason = {'timeout': '超时', 'crash': '分析进程崩溃'}.get(status, 'libclang 解析不了（code %s）' % (row or {}).get('error_code'))
            res['files'][u['main']] = ('failed', reason)
            res['done'] = status not in ('timeout', 'crash')
            unit_status[status] += 1
            per_unit.append(res)
            continue
        unit_status['ok'] += 1
        if 'elapsed_ms' in row:
            timing.append(row['elapsed_ms'])
        diags = [d for d in row.get('diagnostics', []) if d['severity'] >= 3]
        fb_locs = {}
        for d in diags:
            if d.get('file_not_found') in FALLBACK_REASON and rel(d.get('file')):
                fb_locs[(rel(d['file']), d['line'])] = d['file_not_found']
        # files read normally in this unit
        entries = collections.defaultdict(list)
        for e in row.get('inclusion_entries', []):
            f = rel(e['file'])
            if f:
                entries[f].append([(rel(s[0]), s[1]) for s in e['stack']])
        read = {u['main']}
        fallback_only = set()
        for f, stacks in entries.items():
            if any(not any(loc in fb_locs for loc in stack) for stack in stacks):
                read.add(f)
            else:
                fallback_only.add(f)
        # R2lex failures
        failed = {}
        for d in diags:
            f = rel(d.get('file'))
            if f and f in read and d.get('file_not_found') is None and d['category'] == LEX:
                failed.setdefault(f, '预处理出错：' + d['spelling'][:200])
                failure_examples.append({'unit_main': u['main'], 'file': f, 'line': d['line'], 'message': d['spelling'][:200]})
        for f in read:
            res['files'][f] = ('failed', failed[f]) if f in failed else ('parsed', None)
        # directives
        for x in row.get('inclusions', []):
            f = rel(x['file'])
            if f is None:
                continue
            target = rel(x['resolved']) if x['resolved'] else None
            raw_light_directives[(f, x['line'])].add(target if (target or not x['resolved']) else 'EXT:' + x['resolved'])
            if f not in read or f in failed:
                continue
            spec = ('<%s>' % x['spelled']) if x['delim'] == '<' else ('"%s"' % x['spelled']) if x['delim'] == '"' else x['spelled']
            kind = fb_locs.get((f, x['line']))
            if kind:
                res['unresolved'].add((f, spec, FALLBACK_REASON[kind]))
                fallback_directives.append({'unit_main': u['main'], 'from': f, 'line': x['line'], 'spec': spec, 'clang_target': target, 'kind': kind})
            elif target is not None and target in vfs_set:
                res['edges'].add((f, target, spec, x['line']))
            elif x['resolved'] is None:
                res['unresolved'].add((f, spec, None))
            else:
                res['unresolved'].add((f, spec, None))  # resolved outside the frozen material (cannot happen with the VFS)
        for d in diags:
            f = rel(d.get('file'))
            if f and d.get('file_not_found') == 'macro_unexpanded' and f in read and f not in failed:
                text = src.line(f, d['line'])
                m = re.match(r'\s*#\s*include\s*(.*)$', text)
                spec = (m.group(1).strip() if m else text.strip())
                res['unresolved'].add((f, spec, 'include 后面跟宏'))
                macro_unexpanded_sites.append({'from': f, 'line': d['line'], 'spec': spec})
        res['fallback_only'] = sorted(fallback_only)
        per_unit.append(res)

    # ---- 3. merge ----
    reach = collections.defaultdict(list)  # file -> [(main, unit, status, reason)]
    all_done = all(r['done'] for r in per_unit)
    for r in per_unit:
        for f, (status, reason) in r['files'].items():
            reach[f].append((r['main'], r['unit'], status, reason))
    file_status = {}
    for f in sorted(set(claimed) | set(reach)):
        visits = reach.get(f)
        if not visits:
            file_status[f] = ('skipped', '没有编译单元包含它' if all_done else '有编译单元没有做完')
        elif any(v[2] == 'parsed' for v in visits):
            file_status[f] = ('parsed', None)
        else:
            first = sorted(visits, key=lambda v: (v[0], v[1]))[0]
            file_status[f] = ('failed', first[3])
    edges_by_pair = collections.defaultdict(set)
    edge_triples = set()
    for r in per_unit:
        for (f, t, spec, line) in r['edges']:
            edges_by_pair[(f, t)].add(spec)
            edge_triples.add((f, line, t))
    edge_specs = {(f, spec) for r in per_unit for (f, t, spec, line) in r['edges']}
    unresolved = {}
    for r in per_unit:
        for (f, spec, reason) in r['unresolved']:
            if (f, spec) in edge_specs:
                continue
            old = unresolved.get((f, spec), 'unset')
            if old == 'unset' or (old is None and reason is not None) or (reason is not None and old is not None and reason < old):
                unresolved[(f, spec)] = reason
    claimed_status = collections.Counter(file_status[f][0] for f in claimed)
    status_reasons = collections.Counter((s, r) for f, (s, r) in file_status.items() if f in claimed_set and s != 'parsed')
    unresolved_reasons = collections.Counter(v for v in unresolved.values())
    T.append('   units: %s' % dict(unit_status))
    T.append('   claimed %d: %s; non-parsed by reason: %s' % (len(claimed), dict(claimed_status), dict(status_reasons)))
    T.append('   edges %d (directive triples %d); unresolved %d by reason %s' % (len(edges_by_pair), len(edge_triples), len(unresolved), dict(unresolved_reasons)))
    T.append('   failed files (every one inspected below): %s' % sorted(f for f, (s, _) in file_status.items() if s == 'failed'))
    T.append('   failure diagnostics (unit, file:line message): %s' % failure_examples[:20])
    T.append('   fallback directives: %d (distinct %d) %s' % (len(fallback_directives), len({(x['from'], x['line']) for x in fallback_directives}),
                                                         sorted({(x['from'], x['line'], x['spec'], x['clang_target']) for x in fallback_directives})))
    fb_only = collections.Counter(f for r in per_unit for f in r.get('fallback_only', []))
    T.append('   files entered only through a fallback in some unit: %s' % dict(fb_only))
    T.append('   macro-unexpanded sites: %s' % macro_unexpanded_sites[:10])
    if timing:
        T.append('   per-unit elapsed ms (units kept): n=%d sum=%.0f p50=%s p95=%s max=%s' % (len(timing), sum(timing), pct(timing, .5), pct(timing, .95), max(timing)))
    unresolved_by_spec = collections.Counter(spec for (f, spec) in unresolved)
    project_like_unresolved = sorted({(f, spec) for (f, spec), reason in unresolved.items() if spec.startswith('"')})
    T.append('   unresolved specifiers top: %s' % unresolved_by_spec.most_common(25))
    T.append('   unresolved quoted specifiers (project-looking): %d %s' % (len(project_like_unresolved), project_like_unresolved[:40]))

    out = {'label': a.label, 'db_entries': len(db), 'units': len(units), 'duplicates_dropped': len(dup_entries),
           'main_not_observed': len(not_observed), 'notes': notes, 'unit_status': dict(unit_status),
           'claimed': len(claimed), 'claimed_status': dict(claimed_status),
           'non_parsed_by_reason': {'%s|%s' % k: v for k, v in status_reasons.items()},
           'edges': len(edges_by_pair), 'edge_list': sorted(edges_by_pair), 'directive_triples': len(edge_triples),
           'unresolved': len(unresolved), 'unresolved_by_reason': {str(k): v for k, v in unresolved_reasons.items()},
           'unresolved_list': sorted([f, s, r] for (f, s), r in unresolved.items()),
           'failed_files': {f: r for f, (s, r) in file_status.items() if s == 'failed'},
           'failure_examples': failure_examples, 'fallback_directives': fallback_directives,
           'fallback_only_files': dict(fb_only), 'macro_unexpanded_sites': macro_unexpanded_sites,
           'timing_ms': {'n': len(timing), 'sum': round(sum(timing), 1), 'p50': pct(timing, .5), 'p95': pct(timing, .95), 'max': max(timing) if timing else None},
           'skipped_files': sorted(f for f in claimed if file_status[f][0] == 'skipped')}

    # ---- 4. comparison with the true compile ----
    if reference:
        ref_dirs = collections.defaultdict(set)
        ref_triples, ref_pairs, ref_skipped = set(), set(), collections.defaultdict(list)
        ref_read = {}
        ref_errors_project = collections.Counter()
        for u in units:
            row = reference.get(u['entry'])
            if not row or row.get('status') != 'ok':
                continue
            ref_read[u['unit']] = {rel(p) for p in row.get('entered_project', []) if rel(p)} | {u['main']}
            for d in row.get('diagnostics', []):
                if d['severity'] >= 3 and rel(d.get('file')):
                    ref_errors_project[(d.get('category'), d.get('file_not_found'))] += 1
            for x in row.get('inclusions', []):
                f = rel(x['file'])
                if f is None:
                    continue
                t = rel(x['resolved']) if x['resolved'] else None
                ref_dirs[(f, x['line'])].add(t if (t or not x['resolved']) else 'EXT:' + os.path.basename(os.path.dirname(x['resolved'])) + '/' + os.path.basename(x['resolved']))
                if t:
                    ref_triples.add((f, x['line'], t))
                    ref_pairs.add((f, t))
            for s in row.get('skipped_ranges', []):
                f = rel(s['file'])
                if f:
                    ref_skipped[f].append((s['start_line'], s['end_line']))
        light_skipped = collections.defaultdict(list)
        for u in units:
            row = light.get(u['entry'])
            for s in (row or {}).get('skipped_ranges', []):
                f = rel(s['file'])
                if f:
                    light_skipped[f].append((s['start_line'], s['end_line']))

        def why(triple, other_dirs, other_skipped, other_reached):
            f, line, t = triple
            targets = other_dirs.get((f, line))
            if targets is not None:
                if None in targets:
                    return 'other side: unresolved'
                if any(isinstance(x, str) and x.startswith('EXT:') for x in targets):
                    return 'other side: resolved outside the project (%s)' % sorted(targets)
                return 'other side: another project file %s' % sorted(targets)
            if f not in other_reached:
                return 'includer not read on the other side'
            if any(s <= line <= e for s, e in other_skipped.get(f, ())):
                return 'inactive conditional branch on the other side'
            return 'other'
        light_reached = {f for f, (s, _) in file_status.items() if s != 'skipped'}
        ref_reached = set().union(*ref_read.values()) if ref_read else set()
        only_light = sorted(edge_triples - ref_triples)
        only_ref = sorted(ref_triples - edge_triples)
        ol = {'%s:%d -> %s' % t: why(t, ref_dirs, ref_skipped, ref_reached) for t in only_light}
        orf = {'%s:%d -> %s' % t: why(t, raw_light_directives, light_skipped, light_reached) for t in only_ref}
        # directive sites whose resolution differs (any project directive seen on either side)
        all_sites = set(raw_light_directives) | set(ref_dirs)
        differing_sites = []
        for site in sorted(all_sites):
            lt = {x for x in raw_light_directives.get(site, set()) if x and not str(x).startswith('EXT:')}
            rt = {x for x in ref_dirs.get(site, set()) if x and not str(x).startswith('EXT:')}
            if lt != rt:
                differing_sites.append({'site': '%s:%d' % site, 'light': sorted(map(str, raw_light_directives.get(site, set()))),
                                        'reference': sorted(map(str, ref_dirs.get(site, set()))), 'text': src.line(site[0], site[1]).strip()[:120]})
        # files whose outgoing project edges differ
        def out_edges(pairs):
            d = collections.defaultdict(set)
            for f, t in pairs:
                d[f].add(t)
            return d
        le, re_ = out_edges(edges_by_pair), out_edges(ref_pairs)
        files_differ = sorted(f for f in (set(le) | set(re_)) if le.get(f, set()) != re_.get(f, set()))
        # per-unit read sets
        unit_read_diff = []
        for r in per_unit:
            lr = {f for f, (s, _) in r['files'].items()}
            rr = ref_read.get(r['unit'])
            if rr is not None and lr != rr:
                unit_read_diff.append({'main': r['main'], 'light_only': sorted(lr - rr), 'reference_only': sorted(rr - lr)})
        out['reference'] = {'edges': len(ref_pairs), 'directive_triples': len(ref_triples), 'project_directive_sites': len(ref_dirs),
                            'light_directive_sites': len(raw_light_directives),
                            'triples_only_light': ol, 'triples_only_reference': orf,
                            'triples_only_light_by_why': dict(collections.Counter(v.split(' [')[0].split(' (')[0] for v in ol.values())),
                            'triples_only_reference_by_why': dict(collections.Counter(v.split(' (')[0] for v in orf.values())),
                            'edge_pairs_only_light': sorted(set(edges_by_pair) - ref_pairs), 'edge_pairs_only_reference': sorted(ref_pairs - set(edges_by_pair)),
                            'differing_sites': differing_sites, 'files_whose_edges_differ': files_differ,
                            'units_read_set_differs': unit_read_diff, 'reference_files_read': len(ref_reached),
                            'reference_project_errors': {'%s|%s' % k: v for k, v in ref_errors_project.items()}}
        T.append('== vs reference (libclang WITH system headers): edges %d vs light %d; triples %d vs %d' % (len(ref_pairs), len(edges_by_pair), len(ref_triples), len(edge_triples)))
        T.append('   project directive sites: light %d, reference %d; sites whose project target differs: %d' % (len(raw_light_directives), len(ref_dirs), len(differing_sites)))
        for x in differing_sites[:40]:
            T.append('     %s  light=%s  ref=%s  | %s' % (x['site'], x['light'], x['reference'], x['text']))
        T.append('   triples only in light: %d %s' % (len(ol), dict(collections.Counter(ol.values()))))
        T.append('   triples only in reference: %d %s' % (len(orf), dict(collections.Counter(orf.values()))))
        T.append('   edge pairs only light: %s' % sorted(set(edges_by_pair) - ref_pairs))
        T.append('   edge pairs only reference: %s' % sorted(ref_pairs - set(edges_by_pair)))
        T.append('   files whose outgoing edges differ: %d %s' % (len(files_differ), files_differ))
        T.append('   units whose read set differs: %d %s' % (len(unit_read_diff), unit_read_diff[:10]))
        T.append('   reference: project-file error diagnostics %s' % dict(ref_errors_project))
    if gcc:
        g_read, g_pairs, g_ms = {}, set(), []
        for u in units:
            row = gcc.get(u['entry'])
            if row and row.get('status') == 'ok':
                g_read[u['unit']] = set(row['project_read'])
                g_pairs |= {tuple(p) for p in row['pairs']}
                g_ms.append(row['ms'])
        unit_diff_gcc = []
        for r in per_unit:
            lr = {f for f in r['files']}
            gr = g_read.get(r['unit'])
            if gr is not None and lr != gr:
                unit_diff_gcc.append({'main': r['main'], 'light_only': sorted(lr - gr), 'gcc_only': sorted(gr - lr)})
        g_reached = set().union(*g_read.values()) if g_read else set()
        out['gcc'] = {'units_compared': len(g_read), 'units_read_set_differs': unit_diff_gcc,
                      'files_read_union': len(g_reached), 'light_files_read_union': len(light_reached),
                      'files_only_light': sorted(light_reached - g_reached), 'files_only_gcc': sorted(g_reached - light_reached),
                      'pairs_lower_bound': len(g_pairs), 'light_pairs_missing_from_gcc_tree': sorted(set(edges_by_pair) - g_pairs),
                      'gcc_pairs_missing_from_light': sorted(g_pairs - set(edges_by_pair)),
                      'ms': {'sum': round(sum(g_ms), 1), 'p50': pct(g_ms, .5), 'max': max(g_ms) if g_ms else None}}
        T.append('== vs gcc -E -H (GCC 13, real flags, system headers): units compared %d; units whose set of project files read differs: %d'
                 % (len(g_read), len(unit_diff_gcc)))
        for x in unit_diff_gcc[:15]:
            T.append('     %s' % x)
        T.append('   union of files read: gcc %d, light %d; only light %s; only gcc %s' % (len(g_reached), len(light_reached), sorted(light_reached - g_reached), sorted(g_reached - light_reached)))
        T.append('   gcc -H pairs (lower bound) %d; light pairs not in gcc tree %d %s; gcc pairs not in light %s'
                 % (len(g_pairs), len(set(edges_by_pair) - g_pairs), sorted(set(edges_by_pair) - g_pairs)[:30], sorted(g_pairs - set(edges_by_pair))))

    # ---- 5. files never compiled here: what their own #include lines would add ----
    skipped = out['skipped_files']
    inc_re = re.compile(r'^\s*#\s*include\s*(["<])([^">]+)[">]')
    lost, lost_unres = [], []
    light_pairs = set(edges_by_pair)
    light_dir_pairs = {(directory_of(f), directory_of(t)) for f, t in light_pairs}
    search = ['include', 'src']
    for f in skipped:
        for n, text in enumerate(src.lines(f), start=1):
            m = inc_re.match(text)
            if not m:
                continue
            delim, name = m.groups()
            cands = ([os.path.normpath(os.path.join(directory_of(f), name))] if delim == '"' else []) + [os.path.normpath(os.path.join(s, name)) for s in search]
            target = next((c for c in cands if c in vfs_set), None)
            if target:
                lost.append({'from': f, 'line': n, 'to': target, 'pair_in_light': (f, target) in light_pairs,
                             'dir_pair_in_light': (directory_of(f), directory_of(target)) in light_dir_pairs, 'target_status': file_status.get(target, ('?',))[0]})
            elif delim == '"':
                lost_unres.append({'from': f, 'line': n, 'spec': '"%s"' % name})
    by_dir = collections.Counter(directory_of(f) for f in skipped)
    lost_pairs = {(x['from'], x['to']) for x in lost}
    lost_dir_pairs = {(directory_of(x['from']), directory_of(x['to'])) for x in lost}
    new_dir_pairs = sorted(p for p in lost_dir_pairs if p not in light_dir_pairs)
    out['never_compiled'] = {'files': len(skipped), 'by_dir': dict(by_dir), 'textual_include_lines': len(lost) + len(lost_unres),
                             'textual_edges_to_material': len(lost_pairs), 'textual_unresolved_quoted': len(lost_unres),
                             'textual_edges_targets_parsed_elsewhere': sum(1 for x in lost if x['target_status'] == 'parsed'),
                             'dir_pairs_not_in_light': new_dir_pairs, 'examples': lost[:30], 'unresolved_examples': lost_unres[:20]}
    T.append('== never compiled here (skipped 没有编译单元包含它): %d files by dir %s' % (len(skipped), dict(sorted(by_dir.items()))))
    T.append('   their own #include lines resolving (textually, no conditionals) to material files: %d pairs; to files parsed elsewhere: %d; unresolved quoted %d'
             % (len(lost_pairs), out['never_compiled']['textual_edges_targets_parsed_elsewhere'], len(lost_unres)))
    T.append('   directory pairs these would add that light does not already have: %s' % new_dir_pairs)
    with open(a.out, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False, default=list)
    with open(a.text, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(T) + '\n')
    print('\n'.join(T))


if __name__ == '__main__':
    main()
