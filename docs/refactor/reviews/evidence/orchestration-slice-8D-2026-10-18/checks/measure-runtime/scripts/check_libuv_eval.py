#!/usr/bin/env python3
"""Checker (libuv): my own reading of the prototype's raw NDJSON under draft 5 section 11.4 rules.

Independent of uv_eval_d4.py: own dedupe of the database, own material list (from my own git listing), own
fallback / failure / merge rules written from the spec text.

Run only as:
  python3 -I check_libuv_eval.py LIGHT_NDJSON DB_JSON SRC_ROOT NOT_IGNORED_Z OUT_JSON
"""
import collections
import json
import os
import shlex
import sys

CPP = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}


def ext_of(path):
    base = path.rsplit('/', 1)[-1]
    dot = base.rfind('.')
    return base[dot:].lower() if dot > 0 else ''


def material(root, listing):
    with open(listing, 'rb') as h:
        paths = sorted(p.decode('utf-8', 'surrogateescape') for p in h.read().split(b'\0') if p)
    claimed, include_only = set(), set()
    for p in paths:
        full = os.path.join(root, p)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        data = open(full, 'rb').read()
        if len(data) > 2 * 1024 * 1024 or b'\0' in data:
            continue
        e = ext_of(p)
        name = p.rsplit('/', 1)[-1]
        if e in CPP:
            claimed.add(p)
        elif e == '.def' or '.' not in name:
            include_only.add(p)
    return claimed, include_only


def kept_units(db):
    seen, kept = set(), []
    for i, e in enumerate(db):
        args = e['arguments'] if 'arguments' in e else shlex.split(e['command'])
        filt, skip = [], False
        for a in args[1:]:
            if skip:
                skip = False
                continue
            if a == '-o':
                skip = True
                continue
            if a == '-c' or a == e['file']:
                continue
            filt.append(a)
        key = (e['file'], tuple(filt))
        if key not in seen:
            seen.add(key)
            kept.append(i)
    return kept


def is_ref_diag(sp):
    return ('file not found' in sp) or ('expected "FILENAME" or <FILENAME>' in sp)


def main():
    light_path, db_path, root, listing, out = sys.argv[1:6]
    root = root.rstrip('/')
    db = json.load(open(db_path))
    kept = set(kept_units(db))
    claimed, include_only = material(root, listing)
    mat = claimed | include_only

    def rel(p):
        if p is None:
            return None
        p = os.path.normpath(p)
        return p[len(root) + 1:] if p.startswith(root + '/') else None

    stats = collections.Counter()
    diag_cat_all = collections.Counter()      # over all 445 records, project-file diagnostics, by category
    diag_ref_all = collections.Counter()
    records_with_nonref_error = 0
    statuses = collections.Counter()
    edges = set()
    edge_sites = set()            # (from, line, to)
    unres = collections.defaultdict(set)   # (from, specifier) -> reasons
    has_edge_spec = set()         # (from, specifier) with an edge somewhere
    read_ok = collections.defaultdict(int)    # file -> units where read and not failed
    read_fail = collections.defaultdict(list)  # file -> [(unit main, reason)]
    fail_diags = []
    fallback_sites = collections.Counter()
    typo_sites = collections.Counter()
    macro_sites = collections.Counter()
    directive_sites = set()       # (from, line) of project directives counted (kept units, read instances)
    per_unit_ms = []
    per_unit_reads = {}
    with open(light_path) as h:
        for line in h:
            o = json.loads(line)
            i = o['tu_index']
            # --- diagnostics census over all records (as the report counts them)
            nonref_err = False
            for d in o.get('diagnostics', []):
                f = rel(d.get('file'))
                if f is None or f not in claimed:
                    continue
                if d['severity'] < 3:
                    continue
                sp = d['spelling']
                if is_ref_diag(sp):
                    diag_ref_all['angled_fallback' if 'with <angled> include' in sp else
                                 ('typo' if 'did you mean' in sp else 'not_found')] += 1
                else:
                    diag_cat_all[d['category']] += 1
                    nonref_err = True
            records_with_nonref_error += nonref_err
            if i not in kept:
                stats['records_dropped_by_dedupe'] += 1
                continue
            statuses[o['status']] += 1
            if o['status'] != 'ok':
                read_fail[rel(o['tu'])].append((rel(o['tu']), 'unit:' + o['status']))
                continue
            per_unit_ms.append(o['elapsed_ms'])
            # fallback / typo diagnostics (positions)
            fb_pos, fb_line, typo_line = set(), set(), set()
            for d in o.get('diagnostics', []):
                sp = d['spelling']
                if 'file not found with <angled> include' in sp:
                    fb_pos.add(tuple(d['pos']))
                    fb_line.add((d['file'], d['line']))
                elif 'did you mean' in sp and 'file not found' in sp:
                    typo_line.add((d['file'], d['line']))
            # files entered only through a fallback (any frame of the stack is a fallback directive line)
            entered_ok = set()
            for en in o.get('inclusion_entries', []):
                f = rel(en['file'])
                if f is None:
                    continue
                if any((fr[0], fr[1]) in fb_line or (fr[0], fr[1]) in typo_line for fr in en['stack']):
                    continue
                entered_ok.add(f)
            mainf = rel(o['tu'])
            entered_ok.add(mainf)
            # file failure in this unit: preprocessor-category error in that file, not a reference diagnostic
            failed_here = {}
            for d in o.get('diagnostics', []):
                f = rel(d.get('file'))
                if f is None or f not in claimed or d['severity'] < 3:
                    continue
                if d['category'] != 'Lexical or Preprocessor Issue' or is_ref_diag(d['spelling']):
                    continue
                failed_here.setdefault(f, 'preprocess: ' + d['spelling'][:200])
                fail_diags.append((mainf, f, d['line'], d['spelling']))
            reads = set()
            for f in entered_ok:
                if f not in claimed:
                    continue
                reads.add(f)
                if f in failed_here:
                    read_fail[f].append((mainf, failed_here[f]))
                else:
                    read_ok[f] += 1
            per_unit_reads[i] = reads
            for inc in o.get('inclusions', []):
                f = rel(inc['file'])
                if f is None or f not in claimed or f in failed_here or f not in entered_ok:
                    continue
                P = inc['pos']
                # inside an instance entered through a fallback?
                if any(tuple(P[:k]) in fb_pos for k in range(1, len(P))):
                    stats['directives_inside_fallback_instance'] += 1
                    continue
                spec = (inc['delim'] + inc['spelled'] + ('>' if inc['delim'] == '<' else '"')) if not inc.get('via_macro') \
                    else inc['text'].split('include', 1)[1].strip()
                directive_sites.add((f, inc['line']))
                key = (inc['file'], inc['line'])
                if key in fb_line:
                    fallback_sites[(f, inc['line'], spec)] += 1
                    unres[(f, spec)].add('angled-fallback')
                    continue
                if key in typo_line:
                    typo_sites[(f, inc['line'], spec)] += 1
                    unres[(f, spec)].add('typo')
                    continue
                t = rel(inc['resolved'])
                if t is not None and t in mat:
                    edges.add((f, t))
                    edge_sites.add((f, inc['line'], t))
                    has_edge_spec.add((f, spec))
                else:
                    unres[(f, spec)].add(None)
            for d in o.get('diagnostics', []):
                if 'expected "FILENAME" or <FILENAME>' in d['spelling']:
                    f = rel(d['file'])
                    if f in claimed:
                        macro_sites[(f, d['line'])] += 1
    # merge file results
    status = {}
    for f in claimed:
        if read_ok.get(f):
            status[f] = 'parsed'
        elif read_fail.get(f):
            status[f] = 'failed'
        else:
            status[f] = 'skipped'
    unresolved = {}
    for k, rs in unres.items():
        if k in has_edge_spec:
            continue
        nn = sorted(r for r in rs if r is not None)
        unresolved[k] = nn[0] if nn else None
    ur = collections.Counter(unresolved.values())
    spec_top = collections.Counter(k[1] for k in unresolved)
    dirpairs = sorted({(os.path.dirname(a) or '.', os.path.dirname(b) or '.') for a, b in edges})
    ms = sorted(per_unit_ms)

    def pct(q):
        return ms[min(len(ms) - 1, int(q * len(ms)))] if ms else None

    res = {
        'records': sum(1 for _ in open(light_path)),
        'kept_units': len(kept),
        'unit_status': dict(statuses),
        'claimed': len(claimed), 'include_only': len(include_only),
        'file_status': dict(collections.Counter(status.values())),
        'edges': len(edges), 'edge_directive_triples': len(edge_sites),
        'unresolved': len(unresolved), 'unresolved_by_reason': {str(k): v for k, v in ur.items()},
        'unresolved_quoted': sorted([list(k) for k in unresolved if k[1].startswith('"')]),
        'unresolved_specifier_kinds': len({k[1] for k in unresolved}),
        'unresolved_specifiers_top10': spec_top.most_common(10),
        'fallback_sites': [[*k, v] for k, v in fallback_sites.items()],
        'typo_sites': [[*k, v] for k, v in typo_sites.items()],
        'macro_sites': [[*k, v] for k, v in macro_sites.items()],
        'failure_diagnostics': fail_diags[:50], 'failure_diagnostics_count': len(fail_diags),
        'project_diag_by_category_all_records': dict(diag_cat_all),
        'project_ref_diags_all_records': dict(diag_ref_all),
        'records_with_nonref_error': records_with_nonref_error,
        'directive_sites_project': len(directive_sites),
        'dir_pairs': len(dirpairs), 'dir_pairs_list': dirpairs,
        'dir_pairs_excluding_self': len([p for p in dirpairs if p[0] != p[1]]),
        'per_unit_ms': {'n': len(ms), 'sum': round(sum(ms)), 'p50': pct(0.5), 'p95': pct(0.95), 'max': ms[-1] if ms else None},
        'stats': dict(stats),
        'skipped_files_by_dir': dict(collections.Counter(os.path.dirname(f) for f, s in status.items() if s == 'skipped')),
    }
    json.dump({'summary': res, 'edges': sorted(edges), 'edge_sites': sorted(edge_sites),
               'unresolved': sorted([[a, b, r] for (a, b), r in unresolved.items()], key=lambda x: (x[0], x[1])),
               'status': status, 'directive_sites': sorted(directive_sites),
               'reads': {k: sorted(v) for k, v in per_unit_reads.items()}}, open(out, 'w'), indent=0)
    s = dict(res)
    s.pop('dir_pairs_list')
    print(json.dumps(s, ensure_ascii=False, indent=0)[:6000])
    print('dir pairs:', dirpairs)


if __name__ == '__main__':
    main()
