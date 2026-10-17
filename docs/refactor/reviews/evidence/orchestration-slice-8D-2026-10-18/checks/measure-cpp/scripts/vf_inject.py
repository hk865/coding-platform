#!/usr/bin/env python3
"""Verifier: own injected-error cases (copies only; the source tree is never written).

Run only as: python3 -I vf_inject.py prepare SRC FULL_LIGHT.ndjson OUTDIR
             python3 -I vf_inject.py report OUTDIR FULL_LIGHT.ndjson BASE_BODIES.ndjson
"""
import json, os, re, sys

INC = re.compile(r'^\s*#\s*include\b')
CASES = [
    # id, file, kind, where   (where: 'top' | 'after_last_include' | ('offset', n) | ('before_line', n) | ('wrap_line', n))
    ('V1-main-brace-top', 'Source/CTest/cmCTestHandlerCommand.cxx', '}', 'top'),
    ('V2-main-body', 'Tests/FindPackageModeMakefileTest/foo.cpp', ' = = 42 garbage ;', ('offset', 28)),
    ('V3-main-brace', 'Utilities/cmcurl/lib/pop3.c', '}', 'after_last_include'),
    ('V4-main-if', 'Utilities/cmzlib/compress.c', '#if 1', 'after_last_include'),
    ('V5-header-brace', 'Source/CTest/cmCTestGIT.h', '}', 'after_last_include'),
    ('V6-header-if', 'Source/cmCurl.h', '#if 1', 'after_last_include'),
    ('V7-header-if-top', 'Utilities/cmjsoncpp/include/json/config.h', '#if 1', 'top'),
    ('V8-header-body', 'Utilities/cmlibuv/src/heap-inl.h', ' = = 42 garbage ;', ('offset', 2316)),
    # probes beyond the agent's three kinds: errors that CAN change edges
    ('P1-header-comment', 'Source/cmCurl.h', '/*', ('before_line', 9)),  # no later '*/' in this file: runs to EOF
    ('P2-header-if0', 'Source/cmCurl.h', '#if 0', 'before_last_include'),
    ('P3-main-glibc', 'Utilities/cmzlib/compress.c', ('#if __GLIBC_PREREQ(2, 17)', '#endif'), 'wrap_last_include'),
]


def prepare(src, full, outdir):
    rows = [json.loads(l) for l in open(full)]
    plan = []
    for cid, f, text, where in CASES:
        data = open(os.path.join(src, f), 'rb').read().decode('utf-8')
        lines = data.split('\n')
        incs = [k for k, l in enumerate(lines) if INC.match(l)]
        info = {'id': cid, 'file': f}
        if where == 'top':
            lines.insert(0, text); info['inserted_line'] = 1
        elif where == 'after_last_include':
            k = incs[-1] + 1; lines.insert(k, text); info['inserted_line'] = k + 1; info['last_include_line'] = incs[-1] + 1
        elif where == 'before_last_include':
            k = incs[-1]; lines.insert(k, text); info['inserted_line'] = k + 1; info['last_include_line'] = incs[-1] + 1
        elif where == 'wrap_last_include':
            k = incs[-1]; lines.insert(k + 1, text[1]); lines.insert(k, text[0]); info['inserted_line'] = k + 1; info['wrapped'] = lines[k + 1]
        elif where[0] == 'before_line':
            k = where[1] - 1; lines.insert(k, text); info['inserted_line'] = k + 1
        else:
            off = where[1]
            assert data[off] == '{', (cid, data[off - 20:off + 20])
            info['context'] = data[max(0, off - 40):off + 1]
            data = data[:off + 1] + text + data[off + 1:]
            lines = data.split('\n'); info['inserted_line'] = data[:off].count('\n') + 1; info['same_line'] = True
        d = os.path.join(outdir, cid); os.makedirs(d, exist_ok=True)
        copy = os.path.join(d, os.path.basename(f))
        open(copy, 'wb').write('\n'.join(lines).encode('utf-8'))
        info['copy'] = copy
        info['tus'] = sorted(r['i'] for r in rows if r['status'] == 'ok' and (r['tu'] == f or f in r['entered']))
        plan.append(info)
    json.dump(plan, open(os.path.join(outdir, 'plan.json'), 'w'), indent=1)
    for p in plan:
        print(p['id'], p['file'], 'line', p['inserted_line'], 'tus', len(p['tus']))
    print('INDICES', ','.join(str(i) for i in sorted({i for p in plan for i in p['tus']})))


def fails_for(row, f):
    if row['status'] != 'ok':
        return {'R0pos': True, 'R0emit': True, 'R1': True, 'R2': True, 'R2lex': True, 'R3': True}
    pf = row['per_file'].get(f)
    mk = [m[0] for m in row['missing'] if m[0] is not None]
    me = [m[1] for m in row['missing']]
    fk, fe = (min(mk) if mk else None), (min(me) if me else None)
    if not pf:
        return {k: False for k in ('R0pos', 'R0emit', 'R1', 'R2', 'R2lex', 'R3')}
    return {'R0pos': pf['min_key'] is not None and (fk is None or pf['min_key'] < fk),
            'R0emit': fe is None or pf['first_emit'] < fe,
            'R1': True, 'R2': bool(pf['lex'] or pf['user']), 'R2lex': bool(pf['lex']), 'R3': False}


def edges_from(row, f, shift_after=None):
    out = set()
    for d in row.get('directives', []):
        if d[0] == f:
            line = d[1]
            if shift_after is not None and line > shift_after:
                line -= 1
            out.add((line, d[4]))
    return out


def report(outdir, full, base_bodies):
    base = {'light': {r['i']: r for r in map(json.loads, open(full))},
            'bodies': {r['i']: r for r in map(json.loads, open(base_bodies))}}
    plan = json.load(open(os.path.join(outdir, 'plan.json')))
    res = []
    for p in plan:
        f = p['file']
        for mode in ('light', 'bodies'):
            inj = {r['i']: r for r in map(json.loads, open(os.path.join(outdir, p['id'], mode + '.ndjson')))}
            tus = p['tus']
            line_rec = {}
            for rule in ('R0pos', 'R0emit', 'R1', 'R2', 'R2lex', 'R3'):
                b_fail = all(fails_for(base[mode][i], f)[rule] for i in tus)
                i_fail = all(fails_for(inj[i], f)[rule] for i in tus)
                line_rec[rule] = 'already' if b_fail else ('DETECTED' if i_fail else 'missed')
            new_err = sum(1 for i in tus if inj[i]['per_file'].get(f, {}).get('n', 0) > base[mode][i]['per_file'].get(f, {}).get('n', 0))
            r0_tus = sum(1 for i in tus if fails_for(inj[i], f)['R0pos'])
            shift = None if p.get('same_line') else p['inserted_line'] + (1 if 'wrapped' in p else 0)
            changed = 0
            for i in tus:
                be = edges_from(base[mode][i], f)
                ie = edges_from(inj[i], f, shift_after=p['inserted_line'] - 1 if shift is not None else None)
                if 'wrapped' in p:  # two lines inserted: one before (shift 1 from inserted_line), one after the include (shift 2)
                    ie = set()
                    for d in inj[i].get('directives', []):
                        if d[0] == f:
                            line = d[1]
                            if line > p['inserted_line'] + 2:
                                line -= 2
                            elif line > p['inserted_line']:
                                line -= 1
                            ie.add((line, d[4]))
                if be != ie:
                    changed += 1
                    if changed == 1:
                        lost = sorted(map(str, be - ie))[:3]; gained = sorted(map(str, ie - be))[:3]
            first = None
            for i in tus:
                pf = inj[i]['per_file'].get(f)
                if pf and pf.get('first_lex'):
                    first = pf['first_lex']; break
            rec = {'id': p['id'], 'mode': mode, 'file': f, 'tus': len(tus), 'rules': line_rec, 'tus_new_error': new_err,
                   'tus_where_R0_fails_file': r0_tus, 'tus_edges_changed': changed, 'first_lex_or_user': first}
            if changed:
                rec['edges_lost_example'] = lost; rec['edges_gained_example'] = gained
            res.append(rec)
    json.dump(res, sys.stdout, indent=0)


if __name__ == '__main__':
    if sys.argv[1] == 'prepare':
        prepare(*sys.argv[2:5])
    else:
        report(*sys.argv[2:5])
