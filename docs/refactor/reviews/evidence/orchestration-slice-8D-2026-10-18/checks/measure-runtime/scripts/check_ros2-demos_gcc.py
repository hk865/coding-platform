#!/usr/bin/env python3
"""Checker (ros2-demos): ground truth of which workspace files each unit really reaches, from GCC's preprocessor.

Run only as: python3 -I check_ros2-demos_gcc.py SRC DB_JSON INC_DETAIL_JSON OUT_JSON
For every unit (first entry per distinct source main file) runs the unit's own compiler with its own flags,
minus -c/-o, plus `-M -MG -MF <tmp>` (dependency listing only: preprocess, no object, nothing of the project
is executed), from the unit's build directory (outside the download). Compares the workspace files GCC lists
with the checker's textual walk (check_ros2-demos_inc.py) and records the real path of every non-workspace header.
"""
import json
import os
import shlex
import subprocess
import sys
import tempfile


def deps(path):
    text = open(path).read().replace('\\\n', ' ')
    body = text.split(':', 1)[1]
    return [os.path.normpath(p) for p in shlex.split(body)]


def main():
    src, db_json, detail_json, out = sys.argv[1:5]
    db = json.load(open(db_json))
    det = json.load(open(detail_json))
    mine = det['per_unit_reached']
    res = {'units': 0, 'rc_nonzero': [], 'same': 0, 'differ': [], 'gen_missing': {}, 'external_headers': 0}
    ext = set()
    with tempfile.TemporaryDirectory() as td:
        for u in db['units']:
            args = list(u['args'])
            clean = []
            i = 0
            while i < len(args):
                a = args[i]
                if a == '-o':
                    i += 2
                    continue
                if a == '-c':
                    i += 1
                    continue
                clean.append(a)
                i += 1
            mf = os.path.join(td, 'd.mk')
            cmd = clean + ['-M', '-MG', '-MF', mf]
            p = subprocess.run(cmd, cwd=u['directory'], capture_output=True, text=True, timeout=120)
            res['units'] += 1
            if p.returncode != 0:
                res['rc_nonzero'].append([u['rel'], p.returncode, p.stderr[-400:]])
                continue
            ds = deps(mf)
            wsf = set()
            for d in ds:
                full = os.path.normpath(os.path.join(u['directory'], d))
                if full.startswith(src + '/'):
                    wsf.add(os.path.relpath(full, src))
                elif not os.path.isabs(d) and not os.path.exists(full):
                    res['gen_missing'].setdefault(d, []).append(u['rel'])
                else:
                    ext.add(full)
            m = set(mine[u['rel']])
            if m == wsf:
                res['same'] += 1
            else:
                res['differ'].append([u['rel'], sorted(m - wsf), sorted(wsf - m)])
    res['external_headers'] = len(ext)
    res['external_by_root'] = {}
    for e in ext:
        root = '/'.join(e.split('/')[:4])
        res['external_by_root'][root] = res['external_by_root'].get(root, 0) + 1
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps(res, indent=1)[:4000])


if __name__ == '__main__':
    main()
