#!/usr/bin/env python3
"""Build the A-20 / A-21 / X fixtures and check light_import_scan.py against the hand-written expectations.

    python3 -I pyproto_check.py FIXTURE_DIR RAW_OUT_DIR

FIXTURE_DIR must not exist yet (the wrapper removes its own previous copy).  Each case gets its own workspace.
The scanner runs as a separate `python3 -I` process with cwd '/', like the measurement agents will run it.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)  # -I drops the script directory from sys.path; the case table lives next to this file
from pyproto_cases import CASES  # noqa: E402

SCANNER = os.path.join(HERE, 'light_import_scan.py')


def slug(name):
    return ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in name)[:60]


def write_case(root, files):
    for rel, content in files.items():
        path = os.path.join(root, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as handle:
            handle.write(content if isinstance(content, bytes) else content.encode('utf-8'))


def compare(expect, got):
    problems = []
    for key, want in expect.items():
        if key == 'edges':
            have = sorted((e[0], e[1]) for e in got['edges'])
            if sorted(want) != have or len(got['edges']) != len(want):
                problems.append('edges: want {} got {}; missing {} extra {}'.format(
                    len(want), len(have), sorted(set(want) - set(have)), sorted(set(have) - set(want))))
        elif key == 'unresolved':
            have = sorted((u['from'], u['specifier'], u['reason']) for u in got['unresolved'])
            norm = lambda items: sorted(items, key=lambda x: (x[0], x[1], x[2] or ''))  # noqa: E731
            if norm(want) != norm(have):
                problems.append('unresolved: want {} got {}; missing {} extra {}'.format(
                    len(want), len(have), sorted(set(want) - set(have), key=str), sorted(set(have) - set(want), key=str)))
        elif key in ('failed', 'skipped'):
            have = sorted(got[key], key=lambda x: x['path'])
            if sorted(want, key=lambda x: x['path']) != have:
                problems.append('{}: want {} got {}'.format(key, want, have))
        elif key == 'dynamic':
            dyn = got.get('dynamic') or {}
            for sub, value in want.items():
                if sub == 'sites':
                    have = [(s['from'], s['line'], s['to'], s['reason']) for s in dyn.get('sites', [])]
                    if sorted(value, key=str) != sorted(have, key=str):
                        problems.append('dynamic.sites: want {} got {}'.format(value, have))
                elif dyn.get(sub) != value:
                    problems.append('dynamic.{}: want {!r} got {!r}'.format(sub, value, dyn.get(sub)))
        else:
            if got.get(key) != want:
                problems.append('{}: want {!r} got {!r}'.format(key, want, got.get(key)))
    return problems


def main(fixture_dir, raw_dir):
    if os.path.exists(fixture_dir):
        sys.exit('fixture dir exists; remove it first: ' + fixture_dir)
    os.makedirs(fixture_dir)
    os.makedirs(raw_dir, exist_ok=True)
    failures = 0
    lines = []
    for index, case in enumerate(CASES):
        root = os.path.join(fixture_dir, '{:02d}-{}'.format(index, slug(case['name'])))
        os.makedirs(root)
        write_case(root, case['files'])
        cmd = [sys.executable, '-I', SCANNER, root] + case.get('args', [])
        run = subprocess.run(cmd, cwd='/', capture_output=True, text=True, timeout=120)
        if run.returncode != 0:
            failures += 1
            lines.append('FAIL {} (exit {}): {}'.format(case['name'], run.returncode, run.stderr.strip()[-400:]))
            continue
        got = json.loads(run.stdout)
        with open(os.path.join(raw_dir, os.path.basename(root) + '.json'), 'w', encoding='utf-8') as handle:
            json.dump(got, handle, ensure_ascii=False, indent=1)
        problems = compare(case['expect'], got)
        status = 'PASS' if not problems else 'FAIL'
        failures += bool(problems)
        lines.append('{} {}{}'.format(status, case['name'], ' [' + case['source'] + ']' if case.get('source') else ''))
        lines.append('     files={} parsed={} status={} reason={} edges={} unresolved={} notes={}'.format(
            got['files'], got['parsed'], got['edgesStatus'], got['reason'], len(got['edges']), len(got['unresolved']),
            got['notes']))
        for problem in problems:
            lines.append('     - ' + problem)
    lines.append('')
    lines.append('{} cases, {} failed (python {})'.format(len(CASES), failures, sys.version.split()[0]))
    print('\n'.join(lines))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
