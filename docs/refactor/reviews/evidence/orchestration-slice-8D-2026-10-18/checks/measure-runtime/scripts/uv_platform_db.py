#!/usr/bin/env python3
"""Platform experiment: a synthetic compile database for the claimed .c files that no unit reads on Linux, each with
the arguments of a 'nearest' real unit (same top directory), so the light scan can be tried with another target.

Run only as:  python3 -I uv_platform_db.py DB ROOT EVAL.json OUT_DB
  src/**  -> arguments of the uv_a unit of src/unix/core.c (-I include -I src, the libuv defines)
  test/** and docs/** -> arguments of the uv_run_tests_a unit of test/runner.c (-I include)
The file name and output are replaced; nothing else changes.  Targets are chosen by the scanner (--force-target).
"""
import json
import os
import shlex
import sys


def main():
    db_path, root, eval_path, out_path = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3], sys.argv[4]
    db = json.load(open(db_path, encoding='utf-8'))
    skipped = json.load(open(eval_path, encoding='utf-8'))['skipped_files']

    def pick(suffix, marker):
        for e in db:
            if e['file'].endswith(suffix) and marker in e.get('output', ''):
                return e
        raise SystemExit('no template for ' + suffix)
    tmpl = {'src': pick('/src/unix/core.c', 'uv_a.dir'), 'test': pick('/test/runner.c', 'uv_run_tests_a.dir')}
    out = []
    for rel in skipped:
        if not rel.endswith('.c'):
            continue
        t = tmpl['src'] if rel.startswith('src/') else tmpl['test']
        args = shlex.split(t['command'])
        new, i = [], 0
        while i < len(args):
            if args[i] == '-o':
                new += ['-o', 'synthetic.o']; i += 2; continue
            if i == len(args) - 1:
                new.append(os.path.join(root, rel)); i += 1; continue
            new.append(args[i]); i += 1
        out.append({'directory': t['directory'], 'arguments': new, 'file': os.path.join(root, rel)})
    json.dump(out, open(out_path, 'w', encoding='utf-8'), indent=1)
    print(json.dumps({'synthetic_entries': len(out), 'from_src_template': sum(1 for e in out if os.path.relpath(e['file'], root).startswith('src/')),
                      'from_test_template': sum(1 for e in out if not os.path.relpath(e['file'], root).startswith('src/'))}))


if __name__ == '__main__':
    main()
