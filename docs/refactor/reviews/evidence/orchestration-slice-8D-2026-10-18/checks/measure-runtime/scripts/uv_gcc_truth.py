#!/usr/bin/env python3
"""Truth per translation unit from the real compiler's preprocessor (GCC 13, with system headers): gcc -E -H.

Run only as:  python3 -I uv_gcc_truth.py DB ROOT OUT.ndjson
  DB    compile_commands.json (entries are data; the compiler named in each entry must be /usr/bin/cc or /usr/bin/c++)
  ROOT  workspace root: files under it are project files
Each entry runs as: <compiler> <its arguments without -o X and -c> -E -H -o /dev/null, cwd = the entry's directory,
env PATH=/usr/bin:/bin LANG=C.  Preprocessing only (no object, no link, nothing from the project is executed).
Output per entry: the -H tree (depth, path) of project files, the set of project files read, the (includer, included)
pairs between project files (includer = the nearest shallower line of the tree; the main file at depth 0) and
the count of system headers read.  -H does not list a header skipped by its include guard (multiple-include
optimisation), so pairs are a lower bound; the set of files read is exact.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import time

LINE_RE = re.compile(r'^(\.+)[ ]([^\n]+)$')
ALLOWED = {'/usr/bin/cc', '/usr/bin/c++', '/usr/bin/gcc', '/usr/bin/g++'}


def main():
    db_path, root, out_path = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3]
    with open(db_path, encoding='utf-8') as handle:
        db = json.load(handle)
    out = open(out_path, 'w', encoding='utf-8')
    started = time.monotonic()
    for k, entry in enumerate(db):
        args = entry['arguments'] if 'arguments' in entry else shlex.split(entry['command'])
        if args[0] not in ALLOWED:
            out.write(json.dumps({'tu_index': k, 'status': 'compiler_not_allowed', 'compiler': args[0]}) + '\n')
            continue
        cmd, i = [args[0]], 1
        while i < len(args):
            if args[i] == '-o':
                i += 2; continue
            if args[i] == '-c':
                i += 1; continue
            cmd.append(args[i]); i += 1
        cmd += ['-E', '-H', '-o', '/dev/null']
        main_file = os.path.normpath(os.path.join(entry['directory'], entry['file']))
        t0 = time.monotonic()
        try:
            proc = subprocess.run(cmd, cwd=entry['directory'], env={'PATH': '/usr/bin:/bin', 'LANG': 'C'},
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
        except subprocess.TimeoutExpired:
            out.write(json.dumps({'tu_index': k, 'status': 'timeout'}) + '\n')
            continue
        ms = round((time.monotonic() - t0) * 1000, 1)
        tree, stack, pairs, system, other = [], [(0, main_file)], set(), 0, []
        for line in proc.stderr.decode('utf-8', 'replace').split('\n'):
            if line.startswith('Multiple include guards may be useful for:'):
                break
            m = LINE_RE.match(line)
            if not m:
                if line.strip():
                    other.append(line[:200])
                continue
            depth, path = len(m.group(1)), m.group(2)
            full = os.path.realpath(os.path.join(entry['directory'], path)) if '..' in path.split('/') else os.path.normpath(os.path.join(entry['directory'], path))
            while stack and stack[-1][0] >= depth:
                stack.pop()
            parent = stack[-1][1] if stack else None
            stack.append((depth, full))
            project = full == root or full.startswith(root + '/')
            if not project:
                system += 1
                continue
            tree.append([depth, os.path.relpath(full, root)])
            if parent and (parent == root or parent.startswith(root + '/')):
                pairs.add((os.path.relpath(parent, root), os.path.relpath(full, root)))
        rel_main = os.path.relpath(main_file, root) if main_file.startswith(root + '/') else None
        out.write(json.dumps({'tu_index': k, 'status': 'ok' if proc.returncode == 0 else 'error', 'returncode': proc.returncode,
                              'tu_rel': rel_main, 'ms': ms, 'project_tree': tree,
                              'project_read': sorted({p for _, p in tree} | ({rel_main} if rel_main else set())),
                              'pairs': sorted(pairs), 'system_headers_read': system, 'stderr_other': other[:20]}) + '\n')
    out.close()
    print(json.dumps({'entries': len(db), 'wall_s': round(time.monotonic() - started, 2)}))


if __name__ == '__main__':
    main()
