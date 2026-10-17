#!/usr/bin/env python3
"""Checker (libuv): an independent "true compile" include graph from GCC's own preprocessor.

For every kept database entry: the real compiler command with -o/-c removed and `-E -dI -o -` added, run in the
entry's directory (outside the source tree), with the system headers present.  `-dI` makes GCC print every #include
directive it processes in an ACTIVE branch (also the ones whose header is then skipped by the include-guard
optimisation, which `-H` does not show); the line markers give the file and line of each directive and, when the
header is entered, the path GCC opened.  When GCC does not enter the header (guard / #pragma once) I resolve the
name myself with the GCC search order (quoted: the includer's directory, then -iquote, then -I; angled: -I; system
directories come after all of these, so a project file can never be shadowed by them).  Where GCC did enter the
header my resolver is compared with it.  Only preprocessing; nothing is compiled, linked or executed.

Run only as: python3 -I check_libuv_gcc.py DB_JSON SRC_ROOT OUT_JSON
"""
import json
import os
import re
import shlex
import subprocess
import sys
import time

MARK = re.compile(r'^# (\d+) "((?:[^"\\]|\\.)*)"((?: \d+)*)\s*$')
DIRECTIVE = re.compile(r'^#(include|include_next|import) ([<"])(.*)([>"])\s*$')


def main():
    db_path, root, out = sys.argv[1:4]
    root = root.rstrip('/')
    db = json.load(open(db_path))
    seen, units = set(), []
    for i, e in enumerate(db):
        args = e['arguments'] if 'arguments' in e else shlex.split(e['command'])
        filt, skip = [], False
        for a in args[1:]:
            if skip:
                skip = False
                continue
            if a == '-o':
                skip = True
                continue
            if a == '-c' or a == e['file']:
                continue
            filt.append(a)
        key = (e['file'], tuple(filt))
        if key in seen:
            continue
        seen.add(key)
        units.append((i, e, args))

    def rel(p):
        p = os.path.normpath(p)
        return p[len(root) + 1:] if p.startswith(root + '/') else None

    results, resolver_checks, resolver_mismatch, t_all = [], 0, [], time.time()
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C'}
    for i, e, args in units:
        cwd = e['directory']
        cmd, skip = [], False
        idirs, qdirs = [], []
        k = 0
        while k < len(args):
            a = args[k]
            if a == '-o':
                k += 2
                continue
            if a == '-c':
                k += 1
                continue
            if a == '-I' and k + 1 < len(args):
                idirs.append(os.path.normpath(os.path.join(cwd, args[k + 1])))
            elif a.startswith('-I') and len(a) > 2:
                idirs.append(os.path.normpath(os.path.join(cwd, a[2:])))
            elif a == '-iquote' and k + 1 < len(args):
                qdirs.append(os.path.normpath(os.path.join(cwd, args[k + 1])))
            cmd.append(a)
            k += 1
        cmd += ['-E', '-dI', '-o', '-']
        t0 = time.time()
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, errors='replace', timeout=120)
        ms = (time.time() - t0) * 1000
        directives, read, stack, cur, line, pending = [], set(), [], None, 0, None

        def finalize(d, entered):
            nonlocal resolver_checks
            inc_dir = os.path.dirname(d['abs'])
            cands = ([inc_dir] + qdirs + idirs) if d['delim'] == '"' else list(idirs)
            mine = None
            for c in cands:
                q = os.path.normpath(os.path.join(c, d['name']))
                if os.path.isfile(q):
                    mine = q
                    break
            if entered is not None:
                resolver_checks += 1
                ent = os.path.normpath(os.path.join(cwd, entered))
                if (rel(ent) or 'EXT') != ((rel(mine) if mine else None) or 'EXT'):
                    resolver_mismatch.append((e['file'], d['file'], d['line'], d['name'], ent, mine))
                target = rel(ent)
            else:
                target = rel(mine) if mine else None
            d['target'] = target
            d['entered'] = entered is not None
            del d['abs']
            directives.append(d)

        for raw in p.stdout.split('\n'):
            m = MARK.match(raw)
            if m:
                n, fname, flags = int(m.group(1)), m.group(2).replace('\\"', '"').replace('\\\\', '\\'), m.group(3).split()
                if pending is not None:
                    if '1' in flags:
                        finalize(pending, fname)
                        pending = None
                    elif not flags and os.path.normpath(os.path.join(cwd, fname)) == pending['abs']:
                        pass  # GCC re-syncs to the directive's own file before entering the header; keep waiting
                    else:
                        finalize(pending, None)
                        pending = None
                if '1' in flags:
                    stack.append(fname)
                elif '2' in flags:
                    while stack and stack[-1] != fname:
                        stack.pop()
                    if not stack:
                        stack.append(fname)
                else:
                    if stack:
                        stack[-1] = fname
                    else:
                        stack.append(fname)
                cur, line = fname, n
                if not fname.startswith('<'):
                    r = rel(os.path.join(cwd, fname))
                    if r:
                        read.add(r)
                continue
            if pending is not None:
                finalize(pending, None)
                pending = None
            d = DIRECTIVE.match(raw)
            if d and cur and not cur.startswith('<'):
                absf = os.path.normpath(os.path.join(cwd, cur))
                r = rel(absf)
                if r:
                    pending = {'file': r, 'line': line, 'kind': d.group(1), 'delim': d.group(2), 'name': d.group(3), 'abs': absf}
            line += 1
        if pending is not None:
            finalize(pending, None)
        results.append({'db_index': i, 'main': rel(e['file']), 'rc': p.returncode, 'ms': round(ms, 1),
                        'stderr_lines': len([x for x in p.stderr.split('\n') if x.strip()]),
                        'read': sorted(read), 'directives': directives})
    json.dump({'units': results, 'resolver_checks': resolver_checks, 'resolver_mismatch': resolver_mismatch,
               'wall_s': round(time.time() - t_all, 2)}, open(out, 'w'))
    print('units', len(results), 'rc!=0', sum(1 for r in results if r['rc'] != 0),
          'resolver checks', resolver_checks, 'mismatch', len(resolver_mismatch), 'wall_s', round(time.time() - t_all, 2))
    for x in resolver_mismatch[:10]:
        print('  mismatch', x)


if __name__ == '__main__':
    main()
