#!/usr/bin/env python3
"""Checker (libuv): copy the small machine summaries of the check into one JSON (no hand-written content).
Run only as: python3 -I check_libuv_collect.py CHECK_DIR OUT_JSON"""
import json
import os
import sys

ck, out = sys.argv[1], sys.argv[2]


def part(name, key='summary'):
    p = os.path.join(ck, name)
    d = json.load(open(p))
    return d[key] if key and key in d else d


res = {
    'db_and_material': part('db.json'),
    'eval_A': part('evalA.json'), 'eval_B': part('evalB.json'), 'eval_C': part('evalC.json'),
    'eval_A_rerun': part('evalA-rerun.json'),
    'light_vs_gcc_dI': part('cmpA.json', None),
    'never_compiled_and_platform': part('neverc.json', None),
    'runtime': part('runtime-check.json'),
}
for k in ('eval_A', 'eval_B', 'eval_C', 'eval_A_rerun'):
    res[k].pop('failure_diagnostics', None)
json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
print('written', out, os.path.getsize(out))
