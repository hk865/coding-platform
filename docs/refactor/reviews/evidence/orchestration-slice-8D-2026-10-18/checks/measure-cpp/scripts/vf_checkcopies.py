#!/usr/bin/env python3
"""Verifier: do the agent's 50 injected copies differ from the originals by exactly the described edit?
Run only as: python3 -I vf_checkcopies.py SRC INJECT_DIR PLAN.json
"""
import difflib, json, os, sys
src, d, plan = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
bad = 0
for c in plan['cases']:
    orig = open(os.path.join(src, c['file']), 'rb').read().decode('utf-8', 'replace').split('\n')
    copy = open(os.path.join(d, c['id'], os.path.basename(c['file'])), 'rb').read().decode('utf-8', 'replace').split('\n')
    ops = [o for o in difflib.SequenceMatcher(None, orig, copy, autojunk=False).get_opcodes() if o[0] != 'equal']
    desc = [(o[0], o[1] + 1, copy[o[3]:o[4]]) for o in ops]
    ok = len(ops) == 1 and (
        (c['kind'].startswith('brace') and ops[0][0] == 'insert' and copy[ops[0][3]:ops[0][4]] == ['}']) or
        (c['kind'].startswith('if') and ops[0][0] == 'insert' and copy[ops[0][3]:ops[0][4]] == ['#if 1']) or
        (c['kind'] == 'body' and 'garbage' in ''.join(copy[ops[0][3]:ops[0][4]])))
    where = ops[0][1] + 1 if ops else None
    expect = 1 if c['kind'].endswith('-top') else ((c.get('last_include_line') or 0) + 1 if c['kind'] in ('brace', 'if') else None)
    pos_ok = expect is None or where == expect or (not c.get('last_include_line') and where == 1)
    if not ok or not pos_ok:
        bad += 1
        print('CHECK', c['id'], c['kind'], 'at', where, 'expected', expect, desc[:2])
print('cases', len(plan['cases']), 'not as described', bad)
