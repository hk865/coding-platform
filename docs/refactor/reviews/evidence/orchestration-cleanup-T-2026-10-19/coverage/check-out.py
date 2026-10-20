#!/usr/bin/env python3
"""Check the judge outputs (decision 79-4 coverage triage). Run from the copy root.

  python3 -I ./.dsh-ref/check-out.py <name>     one file: dis-NN, skep-NN, tw-NN, vt-dis-NN, tie-skep-NN
  python3 -I ./.dsh-ref/check-out.py --pass2    the pass-2 batches that pass 1 calls for, with their rows
  python3 -I ./.dsh-ref/check-out.py --all      every expected file of both passes: ok / missing / invalid
"""
import json, os, sys
REF = './.dsh-ref'
OUT = os.path.join(REF, 'out')
IDX = json.load(open(os.path.join(REF, 'judge', 'index.json'), encoding='utf-8'))
CLASSES = {'D1', 'D2', 'U', 'F', 'G', 'N', '待定'}
WINNERS = {'codex', 'claude', 'both', 'neither'}
BATCH = {b['name']: b['rows'] for k in ('dis', 'skep', 'tw') for b in IDX[k]}


def load(name):
    p = os.path.join(OUT, name + '.json')
    if not os.path.exists(p):
        return None, 'missing'
    try:
        return json.load(open(p, encoding='utf-8')), None
    except Exception as e:  # noqa: BLE001
        return None, f'not valid JSON: {e}'


def flagged(kind, name):
    """Rows pass 1 sends to pass 2: judge rows with t_reason_wrong, skeptic rows refuted or with a bad proposal."""
    d, err = load(name)
    if err or not isinstance(d, dict) or not isinstance(d.get('rows'), list):
        return None
    if kind == 'dis':
        return [r.get('row') for r in d['rows'] if isinstance(r, dict) and r.get('t_reason_wrong') is True]
    return [r.get('row') for r in d['rows'] if isinstance(r, dict) and (r.get('refuted') is True or r.get('proposal_ok') is False)]


def expected_rows(name):
    if name in BATCH:
        return BATCH[name]
    if name.startswith('vt-dis-'):
        return flagged('dis', name[3:])
    if name.startswith('tie-skep-'):
        return flagged('skep', name[4:])
    return None


def need_str(r, keys, problems, rid):
    for k in keys:
        if not isinstance(r.get(k), str):
            problems.append(f'{rid}: field {k} must be a string')


def check(name):
    want = expected_rows(name)
    if want is None:
        return [f'unknown batch name {name} (or its pass-1 file is missing or invalid)']
    d, err = load(name)
    if err:
        return [err]
    problems = []
    if not isinstance(d, dict) or not isinstance(d.get('rows'), list):
        return ['top level must be an object with a "rows" list']
    seen = []
    for r in d['rows']:
        if not isinstance(r, dict):
            problems.append('a rows entry is not an object'); continue
        rid = r.get('row', '?'); seen.append(rid)
        if r.get('cls') not in CLASSES:
            problems.append(f'{rid}: cls {r.get("cls")!r} is not one of {sorted(CLASSES)}')
        if name.startswith('skep-'):
            for k in ('refuted', 'proposal_ok'):
                if not isinstance(r.get(k), bool): problems.append(f'{rid}: field {k} must be true or false')
            need_str(r, ('evidence', 'proposal_note'), problems, rid)
        elif name.startswith(('tw-', 'vt-')):
            need_str(r, ('note',), problems, rid)
        else:
            if r.get('winner') not in WINNERS: problems.append(f'{rid}: winner {r.get("winner")!r} is not one of {sorted(WINNERS)}')
            if not isinstance(r.get('t_reason_wrong'), bool): problems.append(f'{rid}: field t_reason_wrong must be true or false')
            need_str(r, ('reason', 'proposal', 't_item'), problems, rid)
    if name.startswith(('tw-', 'vt-')):
        if not isinstance(d.get('upheld'), bool): problems.append('field upheld must be true or false')
        need_str(d, ('still_covered_by', 't_reason_check', 'restore', 'spec_basis'), problems, 'top')
    if sorted(seen) != sorted(want):
        miss = sorted(set(want) - set(seen)); extra = sorted(set(seen) - set(want))
        dup = sorted({x for x in seen if seen.count(x) > 1})
        problems.append(f'row ids differ from the batch: missing {miss}, not in the batch {extra}, duplicated {dup}')
    return problems


def pass2():
    res = []
    for b in IDX['dis']:
        f = flagged('dis', b['name'])
        if f: res.append(('vt-' + b['name'], f))
    for b in IDX['skep']:
        f = flagged('skep', b['name'])
        if f: res.append(('tie-' + b['name'], f))
    return res


arg = sys.argv[1] if len(sys.argv) > 1 else '--all'
if arg == '--pass2':
    for n, rows in pass2(): print(n, ' '.join(rows))
    sys.exit(0)
if arg == '--all':
    names = [b['name'] for k in ('dis', 'skep', 'tw') for b in IDX[k]]
    bad = 0
    for n in names + [n for n, _ in pass2()]:
        p = check(n)
        if p: bad += 1; print(n, 'PROBLEM:', p[0], f'(+{len(p) - 1} more)' if len(p) > 1 else '')
    print(f'{len(names)} pass-1 files, {len(pass2())} pass-2 files expected; {bad} with problems')
    sys.exit(1 if bad else 0)
p = check(arg)
print('ok' if not p else '\n'.join(p))
sys.exit(1 if p else 0)
