#!/usr/bin/env python3
"""cmake-src: true-failure measurement by fault injection, without touching the tree on disk.

Run only as:  python3 -I cmsrc_inject.py PHASE   (PHASE: select | run | report)
  select  stream light-A.ndjson, choose 15 main files + 15 headers (deterministic stride over sorted paths), find the
          injection positions (body positions with libclang, light-bodies parse of the path-first reaching TU),
          extract baseline rows (light-A, lbodies-A) for the reaching TUs, write inject/plan.json.
  run     for each planned case not yet done: write the injected copy under results/cmake-src/inject/<id>/, run
          cmsrc_inject_scan.py (light and light-bodies) on the reaching TUs with --vfs-override, compact the output.
          Stops starting new cases after --budget seconds (resumable).
  report  rule statuses of each target (baseline vs injected), detection table, inject/report.json + .txt
Kinds: brace (a line '}' after the file's last #include line), body ('= = 42 garbage ;' right after the '{' of the
first function body found in the file), if ('#if 1' line, never closed, after the last #include line).  Extra
variants brace-top / if-top put the same line at line 1.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import argparse  # noqa: E402
import collections  # noqa: E402
import ctypes as C  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402

import cmsrc_inject_scan as L  # noqa: E402
import evaluate_rules as E  # noqa: E402
from cmsrc_analyze import r0file_fails  # noqa: E402

W = os.path.expanduser('~/dsh-work/measure-cpp')
SRC = W + '/downloads/cmake-3.30.5/cmake-3.30.5'
BLD = W + '/build/cmake-3.30.5'
DB = BLD + '/compile_commands.json'
RES = W + '/results/cmake-src'
INJ = RES + '/inject'
LIST = RES + '/vfs-files-A.txt'
SCANNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cmsrc_inject_scan.py')
HEADER_EXTS = {'.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.ipp', '.tcc', '.txx', '.inc', '.def'}
KINDS = ['brace', 'body', 'if']
TEXT = {'brace': b'}\n', 'if': b'#if 1\n', 'body': b'\n= = 42 garbage ;'}
RULES = E.RULES + ['R0file']
K_COMPOUND = 202


def stream(path):
    with open(path, 'rb') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def rel(path):
    return os.path.relpath(path, SRC) if path and path.startswith(SRC + '/') else None


def find_body(cl, index, db, tu_index, target_abs, vfs):
    entry = db[tu_index]
    filt = L.filter_arguments(entry, SRC, keep_outside_root=False)
    args = filt['args'] + L.COMMON_EXTRA + ['-nostdinc', '-nostdinc++', '-ivfsoverlay', vfs]
    enc = [a.encode() for a in args]
    argv = (C.c_char_p * len(enc))(*enc)
    tu = C.c_void_p()
    code = cl.parse(index, filt['source'].encode(), argv, len(enc), None, 0, L.MODES['light-bodies']['options'], C.byref(tu))
    if code != 0 or not tu.value:
        return None
    found = []
    names = {}

    def fname(ptr):
        if not ptr:
            return None
        if ptr not in names:
            names[ptr] = os.path.normpath(cl.string(cl.file_name(ptr)))
        return names[ptr]

    def exp(loc):
        f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(loc, C.byref(f), C.byref(line), C.byref(col), C.byref(off))
        return fname(f.value), line.value, col.value, off.value

    @cl.Visitor
    def child_visitor(cursor, parent, data):
        if cursor.kind == K_COMPOUND:
            s = exp(cl.range_start(cl.cursor_extent(cursor)))
            if s[0] == target_abs:
                found.append(s)
        return 1

    @cl.Visitor
    def visitor(cursor, parent, data):
        if found:
            return 0
        kind = cursor.kind
        if kind in L.FUNC_KINDS:
            if cl.is_definition(cursor) and exp(cl.cursor_location(cursor))[0] == target_abs:
                cl.visit_children(cursor, child_visitor, None)
            return 1
        if kind in L.CONTAINER_KINDS:
            return 2
        return 1

    try:
        cl.visit_children(cl.tu_cursor(tu), visitor, None)
    finally:
        cl.dispose_tu(tu)
    with open(target_abs, 'rb') as handle:
        data = handle.read()
    for f, line, col, off in sorted(found, key=lambda s: s[3]):
        if data[off:off + 1] == b'{':
            return {'line': line, 'offset': off}
    return None


def line_start(data, line):
    """Byte offset of the start of 1-based line; len(data) when past the end."""
    pos = 0
    for _ in range(line - 1):
        nxt = data.find(b'\n', pos)
        if nxt < 0:
            return len(data)
        pos = nxt + 1
    return pos


def compact(row, targets_abs):
    keep = {k: row.get(k) for k in ('mode', 'tu_index', 'tu', 'tu_rel', 'status', 'entered_project', 'unresolved_positions', 'elapsed_ms')}
    keep['inclusions'] = [x for x in row.get('inclusions', []) if x['resolved'] is None or x['file'] in targets_abs]
    keep['diagnostics'] = [d for d in row.get('diagnostics', []) if d.get('file') in targets_abs]
    return keep


def phase_select(a):
    os.makedirs(INJ, exist_ok=True)
    reach = collections.defaultdict(set)
    dlines = collections.defaultdict(set)
    tu_path = {}
    for row in stream(RES + '/light-A.ndjson'):
        if row.get('status') != 'ok':
            continue
        tu_path[row['tu_index']] = row['tu']
        main = rel(row['tu'])
        for p in row.get('entered_project', []) + [row['tu']]:
            r = rel(p)
            if r:
                reach[r].add(row['tu_index'])
        for x in row.get('inclusions', []):
            r = rel(x['file'])
            if r:
                dlines[r].add(x['line'])
        if main:
            reach[main].add(row['tu_index'])
    mains = sorted({rel(p) for p in tu_path.values() if rel(p)})
    headers = sorted(f for f in reach if os.path.splitext(f)[1].lower() in HEADER_EXTS and f not in mains)
    with open(DB, encoding='utf-8') as handle:
        db = json.load(handle)
    vfs = INJ + '/base.vfs.json'
    L.build_vfs(SRC, set(), LIST, 2 * 1024 * 1024, vfs)
    cl = L.Clang(L.LIBCLANG_DEFAULT)
    index = cl.create_index(0, 0)
    plan, chosen = [], set()
    for group, pool, start, stride in (('main', mains, 34, len(mains) // 15), ('header', headers, 30, len(headers) // 15)):
        for k in range(15):
            kind = KINDS[k % 3]
            i = start + stride * k
            tries = []
            while i < len(pool):
                f = pool[i]
                if f in chosen:
                    i += 1; continue
                tus = sorted(reach[f], key=lambda t: (tu_path[t], t))
                case = {'group': group, 'kind': kind, 'file': f, 'pool_index': i, 'tus': tus, 'fan_in': len(tus),
                        'last_include_line': max(dlines[f]) if dlines.get(f) else None}
                if kind == 'body':
                    pos = find_body(cl, index, db, tus[0], os.path.join(SRC, f), vfs)
                    if pos is None:
                        tries.append(f); i += 1; continue
                    case['body'] = pos
                case['skipped_without_body'] = tries
                plan.append(case); chosen.add(f)
                break
    cases = []
    for n, c in enumerate(plan):
        c = dict(c, id='%02d-%s-%s' % (n, c['group'], c['kind']))
        cases.append(c)
        if c['kind'] in ('brace', 'if'):
            cases.append(dict(c, id='%02d-%s-%s-top' % (n, c['group'], c['kind']), kind=c['kind'] + '-top'))
    targets_abs = {os.path.join(SRC, c['file']) for c in cases}
    need = set(t for c in cases for t in c['tus'])
    for name in ('light-A', 'lbodies-A'):
        with open(INJ + '/baseline-%s.ndjson' % name, 'w', encoding='utf-8') as out:
            for row in stream(RES + '/%s.ndjson' % name):
                if row['tu_index'] in need:
                    out.write(json.dumps(compact(row, targets_abs)) + '\n')
    with open(INJ + '/plan.json', 'w', encoding='utf-8') as handle:
        json.dump({'pools': {'main': len(mains), 'header': len(headers)}, 'cases': cases}, handle, indent=1)
    print('cases', len(cases), 'TU runs per mode', sum(len(c['tus']) for c in cases))
    for c in cases:
        print(c['id'], c['file'], 'fan_in', c['fan_in'], 'last_include', c['last_include_line'], c.get('body'), 'skipped', len(c['skipped_without_body']))


def injected_bytes(c, data):
    kind = c['kind']
    if kind == 'body':
        off = c['body']['offset'] + 1
        return data[:off] + TEXT['body'] + data[off:], c['body']['line'] + 1
    base = kind.replace('-top', '')
    if kind.endswith('-top') or not c['last_include_line']:
        return TEXT[base] + data, 1
    line = c['last_include_line'] + 1
    pos = line_start(data, line)
    if pos >= len(data) and not data.endswith(b'\n'):
        return data + b'\n' + TEXT[base], line
    return data[:pos] + TEXT[base] + data[pos:], line


def phase_run(a):
    with open(INJ + '/plan.json', encoding='utf-8') as handle:
        plan = json.load(handle)
    started = time.monotonic()
    for c in plan['cases']:
        d = os.path.join(INJ, c['id'])
        os.makedirs(d, exist_ok=True)
        src_abs = os.path.join(SRC, c['file'])
        with open(src_abs, 'rb') as handle:
            data = handle.read()
        new, inj_line = injected_bytes(c, data)
        copy = os.path.join(d, os.path.basename(c['file']))
        with open(copy, 'wb') as handle:
            handle.write(new)
        with open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8') as handle:
            json.dump({'inj_line': inj_line, 'copy': copy}, handle)
        for mode in ('light', 'light-bodies'):
            final = os.path.join(d, mode + '.compact.ndjson')
            if os.path.exists(final):
                continue
            if time.monotonic() - started > a.budget:
                print('budget reached; rerun to continue'); return
            raw = os.path.join(d, mode + '.raw.ndjson')
            if os.path.exists(raw):
                os.remove(raw)
            cmd = [sys.executable, '-I', SCANNER, '--db', DB, '--root', SRC, '--mode', mode, '--out', raw, '--file-list', LIST,
                   '--timeout', '20', '--jobs', '3', '--vfs-override', '%s=%s' % (c['file'], copy),
                   '--tu-indices', ','.join(str(t) for t in c['tus'])]
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=500)
            summary = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-400:]
            target = {src_abs}
            n = 0
            with open(final + '.tmp', 'w', encoding='utf-8') as out:
                for row in stream(raw):
                    out.write(json.dumps(compact(row, target)) + '\n'); n += 1
            os.replace(final + '.tmp', final)
            os.remove(raw)
            for extra in (raw + '.vfs.json',):
                if os.path.exists(extra):
                    os.remove(extra)
            print(c['id'], mode, 'rows', n, summary[:200], flush=True)
    print('all cases done')


def rule_status(rows, target, mode):
    res = E.ModeResult(mode, {r['tu_index']: r for r in rows}, SRC)
    st = res.statuses({target})
    out = {r: st[r].get(target, 'skipped') for r in E.RULES}
    reasons = {r: res.reach[target]['reason'].get(r) for r in E.RULES if out[r] == 'failed'}
    tus = fails = 0
    for row in rows:
        if row.get('status') != 'ok':
            continue
        f = r0file_fails(res.rel, row)
        reached = {res.rel(p) for p in row.get('entered_project', [])} | {res.rel(row['tu'])} | set(f)
        if target in reached:
            tus += 1; fails += target in f
    out['R0file'] = 'skipped' if tus == 0 else 'failed' if fails >= tus else 'parsed'
    return out, reasons


def new_errors(inj_rows, base_rows, target_abs, inj_line, kind):
    """Errors in the target that the injection added (baseline lines >= inj_line shift by one)."""
    base = {}
    for r in base_rows:
        s = collections.Counter()
        for d in r.get('diagnostics', []):
            if d['file'] == target_abs and d['severity'] >= 3 and not d.get('file_not_found'):
                line = d['line'] + (1 if d['line'] >= inj_line or (kind == 'body' and d['line'] >= inj_line - 1 and False) else 0)
                s[(line, d['spelling'])] += 1
        base[r['tu_index']] = s
    per_tu = {}
    for r in inj_rows:
        if r.get('status') != 'ok':
            continue
        s = collections.Counter()
        for d in r.get('diagnostics', []):
            if d['file'] == target_abs and d['severity'] >= 3 and not d.get('file_not_found'):
                s[(d['line'], d['spelling'], d['category'], tuple(d['pos']) if d.get('pos') else None)] += 1
        b = base.get(r['tu_index'], collections.Counter())
        extra = []
        for (line, spelling, cat, pos), n in s.items():
            if n > b.get((line, spelling), 0):
                extra.append({'line': line, 'spelling': spelling[:100], 'category': cat, 'pos': list(pos) if pos else None})
        unres = [u['pos'] for u in r.get('unresolved_positions', []) if u.get('pos')] + \
                [x['pos'] for x in r.get('inclusions', []) if x['resolved'] is None and x.get('pos')]
        first = min(unres) if unres else None
        per_tu[r['tu_index']] = {'new': sorted(extra, key=lambda e: e['line'])[:3], 'first_unresolved': first,
                                 'excused_by_r0': bool(extra) and all(first is not None and e['pos'] is not None and first < e['pos'] for e in extra)}
    return per_tu


def phase_report(a):
    with open(INJ + '/plan.json', encoding='utf-8') as handle:
        plan = json.load(handle)
    base_rows = {}
    for name, mode in (('light-A', 'light'), ('lbodies-A', 'light-bodies')):
        base_rows[mode] = {r['tu_index']: r for r in stream(INJ + '/baseline-%s.ndjson' % name)}
    report, lines = [], []
    tally = collections.defaultdict(collections.Counter)
    for c in plan['cases']:
        d = os.path.join(INJ, c['id'])
        with open(os.path.join(d, 'meta.json'), encoding='utf-8') as handle:
            meta = json.load(handle)
        target = c['file']
        target_abs = os.path.join(SRC, target)
        entry = {'id': c['id'], 'file': target, 'group': c['group'], 'kind': c['kind'], 'fan_in': c['fan_in'], 'inj_line': meta['inj_line'], 'modes': {}}
        for mode in ('light', 'light-bodies'):
            path = os.path.join(d, mode + '.compact.ndjson')
            if not os.path.exists(path):
                continue
            inj = list(stream(path))
            base = [base_rows[mode][t] for t in c['tus'] if t in base_rows[mode]]
            st_b, _ = rule_status(base, target, mode)
            st_i, reasons = rule_status(inj, target, mode)
            per_tu = new_errors(inj, base, target_abs, meta['inj_line'], c['kind'])
            visible = sum(1 for v in per_tu.values() if v['new'])
            excused = sum(1 for v in per_tu.values() if v['excused_by_r0'])
            first_new = next((v['new'][0] for v in per_tu.values() if v['new']), None)
            det = {}
            for r in RULES:
                if st_i[r] != 'failed':
                    det[r] = 'no'
                elif st_b[r] == 'failed':
                    det[r] = 'already-failed'
                else:
                    det[r] = 'yes'
                tally[(mode, c['kind'].replace('-top', '') + ('-top' if c['kind'].endswith('-top') else ''), c['group'])][(r, det[r])] += 1
                tally[(mode, 'ALL-30' if not c['kind'].endswith('-top') else 'ALL-top', 'all')][(r, det[r])] += 1
            entry['modes'][mode] = {'baseline': st_b, 'injected': st_i, 'detected': det, 'tus_reaching': len(per_tu),
                                    'tus_with_new_error': visible, 'tus_new_error_excused_by_R0': excused,
                                    'first_new_error': first_new, 'injected_fail_reasons': {k: v[:160] for k, v in reasons.items() if v}}
        report.append(entry)
    with open(INJ + '/report.json', 'w', encoding='utf-8') as handle:
        json.dump({'cases': report, 'tally': {'|'.join(k): {'%s:%s' % kk: n for kk, n in v.items()} for k, v in tally.items()}}, handle, indent=1)
    ab = {'yes': 'Y', 'no': '-', 'already-failed': 'a'}
    lines.append('cell = R0 R1 R2 R2lex R3 R0file  (Y detected, - not, a already failed without injection); new = TUs with a new error / reaching; exc = TUs where R0 excuses it')
    for e in report:
        cells = []
        for mode in ('light', 'light-bodies'):
            m = e['modes'].get(mode)
            if not m:
                cells.append('(not run)'); continue
            cells.append('%s new %d/%d exc %d' % (''.join(ab[m['detected'][r]] for r in RULES), m['tus_with_new_error'], m['tus_reaching'], m['tus_new_error_excused_by_R0']))
        fn = (e['modes'].get('light-bodies') or {}).get('first_new_error') or {}
        lines.append('%-22s %-62s fan %4d line %5d | light %-26s | bodies %-26s | %s [%s]' % (
            e['id'], e['file'][:62], e['fan_in'], e['inj_line'], cells[0], cells[1], fn.get('spelling', '')[:60], fn.get('category', '')))
    lines.append('')
    lines.append('tally: mode | kind | group -> rule:detected counts')
    for k in sorted(tally):
        v = tally[k]
        lines.append('%-45s %s' % (' | '.join(k), '  '.join('%s %d/%d/%d' % (r, v.get((r, 'yes'), 0), v.get((r, 'already-failed'), 0), v.get((r, 'no'), 0)) for r in RULES)))
    with open(INJ + '/report.txt', 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('phase', choices=['select', 'run', 'report'])
    ap.add_argument('--budget', type=float, default=480)
    a = ap.parse_args()
    {'select': phase_select, 'run': phase_run, 'report': phase_report}[a.phase](a)


if __name__ == '__main__':
    main()
