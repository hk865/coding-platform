#!/usr/bin/env python3
"""Prepare the error-injection targets for the SLAM measurement (task c).

Run only as:
  python3 -I inject_prepare.py --db DB --root ROOT --scan SCAN.ndjson --vfs VFS.json --out-dir DIR
          [--main 15] [--headers 15] [--extra-k1b]

Uses the scanner (light_include_scan.py, same folder, imported explicitly) for the argument filter and the
libclang binding.  Nothing in the project is modified: every target gets its own copy of ROOT under
DIR/<id>/ws, one injected error in one file, and a sub-database (only the TUs that reach the target, paths
rewritten from ROOT to the copy).  DIR/manifest.json lists the targets.

Kinds (one error per target):
  K1  unbalanced brace at file scope: a line containing only '}' after the file's last active #include
      (top of the file when it has none);
  K2  garbage tokens inside a function body: ') ] injected garbage tokens ;' right after the '{' of the first
      function definition (by offset) whose body lies in the file (found with libclang, bodies not skipped);
  K3  unterminated #if: a line '#if 1' at the same place as K1 (the rest of the file stays active).
  K1b (supplement, --extra-k1b, same targets as K1): a line containing only '{' (a brace that is never closed).
Selection (deterministic): main files = the TUs sorted by path, positions round(i*N/15); kinds cycle K1,K2,K3.
Headers = project headers reached by at least one TU in light mode, sorted by path; K2 headers are 5 evenly
spaced among the headers that contain a function body, then 10 evenly spaced among the rest of the reached
headers, alternating K1, K3.
"""
import argparse
import ctypes as C
import json
import os
import shutil
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import light_include_scan as L  # noqa: E402  (our own scanner, same folder)

K_COMPOUND = 202
GARBAGE = ' ) ] injected garbage tokens ; '


def spaced(items, n):
    if n >= len(items):
        return list(items)
    return [items[int(round(i * (len(items) - 1) / (n - 1)))] for i in range(n)] if n > 1 else [items[0]]


def function_bodies(cl, index, entry, root, vfs, target):
    """Offsets of '{' of function bodies located in target (absolute path), parsed like light-bodies."""
    filt = L.filter_arguments(entry, root, keep_outside_root=False)
    args = filt['args'] + L.COMMON_EXTRA + ['-nostdinc', '-nostdinc++', '-ivfsoverlay', vfs]
    enc = [a.encode() for a in args]
    argv = (C.c_char_p * len(enc))(*enc)
    tu = C.c_void_p()
    code = cl.parse(index, filt['source'].encode(), argv, len(enc), None, 0, L.MODES['light-bodies']['options'], C.byref(tu))
    if code != 0 or not tu.value:
        return None
    found = []
    names = {}

    def loc(location):
        f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(location, C.byref(f), C.byref(line), C.byref(col), C.byref(off))
        if not f.value:
            return None, line.value, off.value
        if f.value not in names:
            names[f.value] = os.path.normpath(cl.string(cl.file_name(f.value)))
        return names[f.value], line.value, off.value

    @cl.Visitor
    def body_visitor(cursor, parent, data):
        if cursor.kind == K_COMPOUND:
            name, line, off = loc(cl.range_start(cl.cursor_extent(cursor)))
            if name == target:
                found.append((off, line))
            return 0  # first compound child is the body
        return 1

    @cl.Visitor
    def visitor(cursor, parent, data):
        kind = cursor.kind
        if kind in L.FUNC_KINDS and cl.is_definition(cursor):
            name, _, _ = loc(cl.cursor_location(cursor))
            if name == target:
                cl.visit_children(cursor, body_visitor, None)
            return 1
        if kind in L.CONTAINER_KINDS:
            name, _, _ = loc(cl.cursor_location(cursor))
            if name == target:
                return 2
        return 1

    try:
        cl.visit_children(cl.tu_cursor(tu), visitor, None)
    finally:
        cl.dispose_tu(tu)
    return sorted(set(found))


def insert_after_line(data, line_no, text):
    """Insert text as a new line after line line_no (1-based); line_no 0 = before line 1."""
    lines = data.split(b'\n')
    lines.insert(line_no, text)
    return b'\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--root', required=True)
    ap.add_argument('--scan', required=True)
    ap.add_argument('--vfs', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--main', type=int, default=15)
    ap.add_argument('--headers', type=int, default=15)
    ap.add_argument('--extra-k1b', action='store_true')
    ap.add_argument('--libclang', default=L.LIBCLANG_DEFAULT)
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    db = json.load(open(a.db, encoding='utf-8'))
    rows = {}
    for line in open(a.scan, encoding='utf-8'):
        r = json.loads(line)
        if r.get('mode') == 'light' and r.get('status') == 'ok':
            rows[r['tu_index']] = r
    rel = lambda p: os.path.relpath(p, root)
    mains = {rel(r['tu']): k for k, r in rows.items()}
    reachers, last_include = {}, {}
    for k, r in rows.items():
        for p in r['entered_project']:
            reachers.setdefault(rel(p), set()).add(k)
        reachers.setdefault(rel(r['tu']), set()).add(k)
        for x in r['inclusions']:
            f = rel(x['file'])
            last_include[f] = max(last_include.get(f, 0), x['line'])
    headers = sorted(f for f in reachers if f not in mains)
    main_files = sorted(mains)

    cl = L.Clang(a.libclang)
    index = cl.create_index(0, 0)
    bodies = {}
    for f in main_files + headers:
        k = min(reachers[f], key=lambda t: rows[t]['tu'])
        bodies[f] = function_bodies(cl, index, db[k], root, os.path.abspath(a.vfs), os.path.join(root, f))

    chosen_main = spaced(main_files, a.main)
    kinds = ['K1', 'K2', 'K3']
    targets = [(f, kinds[i % 3], 'main') for i, f in enumerate(chosen_main)]
    with_body = [h for h in headers if bodies.get(h)]
    k2_headers = spaced(with_body, a.headers // 3)
    rest = [h for h in headers if h not in k2_headers]
    others = spaced(rest, a.headers - len(k2_headers))
    targets += [(h, 'K2', 'header') for h in k2_headers]
    targets += [(h, ['K1', 'K3'][i % 2], 'header') for i, h in enumerate(others)]
    if a.extra_k1b:
        targets += [(f, 'K1b', role) for f, kind, role in list(targets) if kind == 'K1']

    os.makedirs(a.out_dir, exist_ok=True)
    manifest = []
    for n, (f, kind, role) in enumerate(targets):
        tid = 't%02d-%s' % (n, kind)
        tdir = os.path.join(a.out_dir, tid)
        ws = os.path.join(tdir, 'ws')
        if os.path.exists(tdir):
            shutil.rmtree(tdir)
        shutil.copytree(root, ws, symlinks=True)
        path = os.path.join(ws, f)
        data = open(path, 'rb').read()
        if kind == 'K2':
            if not bodies.get(f):
                manifest.append({'id': tid, 'file': f, 'kind': kind, 'role': role, 'skipped': 'no function body'}); continue
            off, line = bodies[f][0]
            assert data[off:off + 1] == b'{', (f, off, data[off:off + 20])
            new = data[:off + 1] + GARBAGE.encode() + data[off + 1:]
            where = {'line': line, 'offset': off, 'text': GARBAGE.strip()}
        else:
            text = {'K1': b'}', 'K3': b'#if 1', 'K1b': b'{'}[kind]
            after = last_include.get(f, 0)
            new = insert_after_line(data, after, text)
            where = {'after_line': after, 'text': text.decode()}
        open(path, 'wb').write(new)
        sub = []
        tus = sorted(reachers[f], key=lambda t: rows[t]['tu'])
        for k in tus:
            entry = json.loads(json.dumps(db[k]).replace(json.dumps(root)[1:-1], json.dumps(ws)[1:-1]))
            entry['orig_tu_index'] = k
            sub.append(entry)
        json.dump(sub, open(os.path.join(tdir, 'compile_commands.json'), 'w', encoding='utf-8'), indent=1)
        manifest.append({'id': tid, 'file': f, 'kind': kind, 'role': role, 'tus': tus, 'tu_count': len(tus),
                         'where': where, 'ws': ws, 'function_bodies_in_file': len(bodies.get(f) or [])})
    json.dump({'root': root, 'targets': manifest, 'headers_reached': len(headers), 'headers_with_body': len(with_body),
               'main_files': len(main_files)}, open(os.path.join(a.out_dir, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
    for m in manifest:
        print(m['id'], m['role'], m['file'], m.get('tu_count'), m.get('where'), m.get('skipped', ''))
    print('headers reached', len(headers), 'with a function body', len(with_body), 'main files', len(main_files))


if __name__ == '__main__':
    main()
