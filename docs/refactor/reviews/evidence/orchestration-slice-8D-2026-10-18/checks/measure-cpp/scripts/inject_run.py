#!/usr/bin/env python3
"""Run the scanner over every injection target (resumable; stops dispatching after --budget seconds).

Run only as: python3 -I inject_run.py --dir DIR --modes light,light-bodies [--budget 480] [--timeout 20]
For each target in DIR/manifest.json and each mode: light_include_scan.py --db DIR/<id>/compile_commands.json
--root DIR/<id>/ws --mode MODE --out DIR/<id>/scan.ndjson (the scanner itself skips TUs already recorded).
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def available_mb():
    with open('/proc/meminfo') as handle:
        for line in handle:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    return 0


def done_count(path, mode):
    if not os.path.exists(path):
        return 0
    n = 0
    for line in open(path, encoding='utf-8'):
        try:
            if json.loads(line).get('mode') == mode:
                n += 1
        except ValueError:
            pass
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--modes', default='light,light-bodies')
    ap.add_argument('--budget', type=float, default=480)
    ap.add_argument('--timeout', type=float, default=20)
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.dir, 'manifest.json'), encoding='utf-8'))
    started = time.monotonic()
    remaining = 0
    for t in manifest['targets']:
        if t.get('skipped'):
            continue
        tdir = os.path.join(a.dir, t['id'])
        out = os.path.join(tdir, 'scan.ndjson')
        for mode in a.modes.split(','):
            if done_count(out, mode) >= t['tu_count']:
                continue
            left = a.budget - (time.monotonic() - started)
            if left < a.timeout + 5:
                remaining += 1
                continue
            if available_mb() <= 2000:
                print('ABORT: available <= 2000 MB'); sys.exit(5)
            cmd = [sys.executable, '-I', os.path.join(HERE, 'light_include_scan.py'), '--db', os.path.join(tdir, 'compile_commands.json'),
                   '--root', t['ws'], '--mode', mode, '--out', out, '--timeout', str(a.timeout), '--budget-seconds', str(max(1, left - a.timeout - 5))]
            res = subprocess.run(cmd, capture_output=True, text=True)
            summary = res.stdout.strip().split('\n')[-1] if res.stdout.strip() else res.stderr[-300:]
            print(t['id'], mode, summary[:160])
            if done_count(out, mode) < t['tu_count']:
                remaining += 1
    print(json.dumps({'remaining_target_modes': remaining, 'elapsed_s': round(time.monotonic() - started, 1)}))


if __name__ == '__main__':
    main()
