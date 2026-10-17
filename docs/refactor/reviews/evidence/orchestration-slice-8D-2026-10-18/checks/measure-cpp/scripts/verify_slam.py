#!/usr/bin/env python3
"""Independent re-check of slam-summary.md (adversarial verifier).  stdlib + ctypes only.

Run only as:  python3 -I verify_slam.py scan   --db DB --root ROOT --mode light|light-bodies|reference-raw --out OUT.json [--indices i,j,..]
              python3 -I verify_slam.py args   --db DB --root ROOT
              python3 -I verify_slam.py macros --fixture-dir DIR
              python3 -I verify_slam.py bodyinc --fixture-dir DIR
              python3 -I verify_slam.py conds  --root ROOT

Own code, not light_include_scan.py / evaluate_rules.py: own argument filter, own VFS, clang_getFileLocation (not the
expansion location), own rule evaluation (done in verify_analyze.py).  Nothing from the project is executed.
"""
import argparse
import collections
import ctypes as C
import json
import os
import re
import sys
import time

LIB = '/usr/lib/llvm-18/lib/libclang.so.1'
F_DPP, F_INC, F_SKIP, F_KEEP = 0x01, 0x02, 0x40, 0x200
OPTIONS = {'light': F_DPP | F_INC | F_SKIP | F_KEEP, 'light-bodies': F_DPP | F_INC | F_KEEP,
           'reference-raw': F_DPP | F_INC | F_KEEP}


class CXString(C.Structure):
    _fields_ = [('data', C.c_void_p), ('flags', C.c_uint)]


class Cursor(C.Structure):
    _fields_ = [('kind', C.c_uint), ('xdata', C.c_int), ('data', C.c_void_p * 3)]


class Loc(C.Structure):
    _fields_ = [('p', C.c_void_p * 2), ('i', C.c_uint)]


class Rng(C.Structure):
    _fields_ = [('p', C.c_void_p * 2), ('b', C.c_uint), ('e', C.c_uint)]


lib = C.CDLL(LIB)


def bind(name, res, *args):
    f = getattr(lib, name)
    f.restype, f.argtypes = res, list(args)
    return f


P, U = C.c_void_p, C.c_uint
getCString = bind('clang_getCString', C.c_char_p, CXString)
disposeString = bind('clang_disposeString', None, CXString)


def S(x):
    try:
        return (getCString(x) or b'').decode('utf-8', 'replace')
    finally:
        disposeString(x)


createIndex = bind('clang_createIndex', P, C.c_int, C.c_int)
parse2 = bind('clang_parseTranslationUnit2', C.c_int, P, C.c_char_p, C.POINTER(C.c_char_p), C.c_int, P, U, U, C.POINTER(P))
disposeTU = bind('clang_disposeTranslationUnit', None, P)
tuCursor = bind('clang_getTranslationUnitCursor', Cursor, P)
VISITOR = C.CFUNCTYPE(U, Cursor, Cursor, P)
visitChildren = bind('clang_visitChildren', U, Cursor, VISITOR, P)
cursorLoc = bind('clang_getCursorLocation', Loc, Cursor)
cursorExtent = bind('clang_getCursorExtent', Rng, Cursor)
cursorSpelling = bind('clang_getCursorSpelling', CXString, Cursor)
rangeStart = bind('clang_getRangeStart', Loc, Rng)
rangeEnd = bind('clang_getRangeEnd', Loc, Rng)
fileLoc = bind('clang_getFileLocation', None, Loc, C.POINTER(P), C.POINTER(U), C.POINTER(U), C.POINTER(U))
fileName = bind('clang_getFileName', CXString, P)
includedFile = bind('clang_getIncludedFile', P, Cursor)
INCV = C.CFUNCTYPE(None, P, C.POINTER(Loc), U, P)
getInclusions = bind('clang_getInclusions', None, P, INCV, P)
numDiag = bind('clang_getNumDiagnostics', U, P)
getDiag = bind('clang_getDiagnostic', P, P, U)
diagSev = bind('clang_getDiagnosticSeverity', U, P)
diagSpell = bind('clang_getDiagnosticSpelling', CXString, P)
diagLoc = bind('clang_getDiagnosticLocation', Loc, P)
diagCatText = bind('clang_getDiagnosticCategoryText', CXString, P)
disposeDiag = bind('clang_disposeDiagnostic', None, P)
isDef = bind('clang_isCursorDefinition', U, Cursor)

FUNC = {8, 21, 24, 25, 26, 30}
CONTAINER = {1, 2, 3, 4, 22, 23, 31, 32}


def norm(raw):
    if not raw:
        return None
    if not raw.startswith('/'):
        return raw
    if '..' in raw.split('/'):
        return os.path.realpath(raw)
    return os.path.normpath(raw)


def under(p, root):
    return bool(p) and (p == root or p.startswith(root + '/'))


KEEP0 = {'-pthread', '-fPIC', '-fpic', '-fexceptions', '-fno-exceptions', '-frtti', '-fno-rtti'}
RAW_RE = re.compile(r'^(-fopenmp|-m[A-Za-z0-9=_.-]+|-march=\S+|-fno-math-errno)$')


def my_args(entry, root, keep_outside, raw_flags):
    raw, d = entry['arguments'], entry['directory']
    src = os.path.normpath(os.path.join(d, entry['file']))
    out, dropped, outside = [], [], []
    i = 1
    while i < len(raw):
        a = raw[i]
        if a == '-o':
            i += 2
            continue
        if a == '-c':
            i += 1
            continue
        opt = None
        for o in ('-isystem', '-iquote', '-I', '-D', '-U'):
            if a == o:
                opt, val, i = o, raw[i + 1], i + 2
                break
            if o in ('-I', '-D', '-U') and a.startswith(o):
                opt, val, i = o, a[len(o):], i + 1
                break
        if opt:
            if opt in ('-D', '-U'):
                out += [opt, val]
                continue
            p = os.path.normpath(os.path.join(d, val))
            if under(p, root) or keep_outside:
                out += [opt, p]
            else:
                outside.append([opt, val])
            continue
        if re.fullmatch(r'-std=\S+', a) or re.fullmatch(r'-O[0-3sgz]', a) or a in KEEP0:
            out.append(a)
            i += 1
            continue
        if not a.startswith('-'):
            i += 1
            continue
        if raw_flags and RAW_RE.match(a):
            out.append(a)
            i += 1
            continue
        dropped.append(a)
        i += 1
    return src, out, dropped, outside


def write_vfs(root, path):
    tree = {'type': 'directory', 'name': root, 'contents': []}
    dirs = {'': tree}
    n = 0
    for cur, sub, files in os.walk(root):
        sub[:] = sorted(x for x in sub if x != '.git')
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(cur, f), root)
            parent = ''
            for seg in rel.split('/')[:-1]:
                child = parent + '/' + seg if parent else seg
                if child not in dirs:
                    dirs[child] = {'type': 'directory', 'name': seg, 'contents': []}
                    dirs[parent]['contents'].append(dirs[child])
                parent = child
            dirs[parent]['contents'].append({'type': 'file', 'name': f, 'external-contents': os.path.join(root, rel)})
            n += 1
    with open(path, 'w') as h:
        json.dump({'version': 0, 'case-sensitive': True, 'use-external-names': False, 'fallthrough': False, 'roots': [tree]}, h)
    return n


def hwm_kb():
    with open('/proc/self/status') as h:
        for line in h:
            if line.startswith('VmHWM:'):
                return int(line.split()[1])
    return None


def fnf_kind(sp):
    if sp.startswith('expected "FILENAME" or <FILENAME>'):
        return 'macro'
    if 'file not found' not in sp:
        return None
    if 'with <angled>' in sp or 'did you mean' in sp:
        return 'recovered'
    return 'missing'


def scan_tu(index, src, args, options, root, want_bodies):
    enc = [a.encode() for a in args]
    argv = (C.c_char_p * len(enc))(*enc)
    tu = P()
    t0 = time.monotonic()
    code = parse2(index, src.encode(), argv, len(enc), None, 0, options, C.byref(tu))
    t1 = time.monotonic()
    if code or not tu.value:
        return {'status': 'null_tu', 'code': code, 'parse_ms': round((t1 - t0) * 1000, 2)}
    names, errs = {}, []

    def fname(fp):
        if not fp:
            return None
        if fp not in names:
            names[fp] = norm(S(fileName(fp)))
        return names[fp]

    def floc(loc):
        f, l, c, o = P(), U(), U(), U()
        fileLoc(loc, C.byref(f), C.byref(l), C.byref(c), C.byref(o))
        return fname(f.value), l.value, c.value, o.value

    try:
        chains, includer = {}, {}

        @INCV
        def incv(fp, stack, depth, data):
            try:
                n = fname(fp)
                if n is None or n in chains:
                    return
                chains[n] = [floc(stack[k])[3] for k in range(depth - 1, -1, -1)]
                includer[n] = floc(stack[0])[0] if depth else None
            except Exception as e:
                errs.append(repr(e))

        getInclusions(tu, incv, None)
        dirs, funcs = [], collections.defaultdict(list)

        @VISITOR
        def vis(cur, parent, data):
            try:
                k = cur.kind
                if k == 503:
                    n, l, c, o = floc(cursorLoc(cur))
                    if under(n, root):
                        inc = includedFile(cur)
                        dirs.append([n, l, o, S(cursorSpelling(cur)), fname(inc) if inc else None])
                    return 1
                if 500 <= k <= 502:
                    return 1
                if want_bodies:
                    if k in FUNC:
                        if isDef(cur):
                            ext = cursorExtent(cur)
                            s, e = floc(rangeStart(ext)), floc(rangeEnd(ext))
                            if under(s[0], root) and s[0] == e[0]:
                                funcs[s[0]].append([s[3], e[3]])
                        return 1
                    if k in CONTAINER:
                        return 2
                return 1
            except Exception as e:
                errs.append(repr(e))
                return 1

        visitChildren(tuCursor(tu), vis, None)
        diags = []
        for k in range(numDiag(tu)):
            dg = getDiag(tu, k)
            try:
                sev = diagSev(dg)
                if sev < 3:
                    continue
                n, l, c, o = floc(diagLoc(dg))
                sp = S(diagSpell(dg))
                fk = fnf_kind(sp)
                if not under(n, root) and fk is None:
                    diags.append({'emit': k, 'file': n, 'ext': True})
                    continue
                diags.append({'emit': k, 'file': n, 'line': l, 'off': o, 'sev': sev, 'cat': S(diagCatText(dg)), 'sp': sp[:300],
                              'fnf': fk, 'key': (chains[n] + [o]) if n in chains else None})
            finally:
                disposeDiag(dg)
        t2 = time.monotonic()
        entered = sorted(n for n in chains if under(n, root))
        return {'status': 'ok', 'parse_ms': round((t1 - t0) * 1000, 2), 'collect_ms': round((t2 - t1) * 1000, 2),
                'entered': entered, 'entered_ext': sum(1 for n in chains if not under(n, root)),
                'chains': {n: chains[n] for n in entered}, 'includer': {n: includer[n] for n in entered},
                'dirs': dirs, 'funcs': dict(funcs) if want_bodies else None, 'diags': diags, 'cb_errors': errs[:10]}
    finally:
        disposeTU(tu)


def cmd_scan(a):
    root = os.path.realpath(a.root)
    db = json.load(open(a.db))
    idx = [int(x) for x in a.indices.split(',')] if a.indices else list(range(len(db)))
    extra = ['-w', '-ferror-limit=0', '-fsyntax-only']
    if a.mode in ('light', 'light-bodies'):
        vfs = a.out + '.vfs.json'
        nfiles = write_vfs(root, vfs)
        extra += ['-fno-modules', '-fno-implicit-modules', '-nostdinc', '-nostdinc++', '-ivfsoverlay', vfs]
    else:
        nfiles = None
        extra += ['-idirafter', '/usr/lib/gcc/x86_64-linux-gnu/13/include']
    index = createIndex(0, 0)
    out = {'mode': a.mode, 'root': root, 'db': a.db, 'vfs_files': nfiles, 'extra': extra, 'tus': {}}
    t0 = time.monotonic()
    for k in idx:
        src, args, dropped, outside = my_args(db[k], root, keep_outside=(a.mode == 'reference-raw'), raw_flags=(a.mode == 'reference-raw'))
        r = scan_tu(index, src, args + extra, OPTIONS[a.mode], root, a.mode != 'light')
        r.update(src=src, dropped=sorted(set(dropped)), outside_dropped=len(outside), orig=db[k].get('orig_tu_index', k))
        out['tus'][str(k)] = r
    out['wall_s'] = round(time.monotonic() - t0, 3)
    out['hwm_kb'] = hwm_kb()
    json.dump(out, open(a.out, 'w'))
    st = collections.Counter(r['status'] for r in out['tus'].values())
    print(json.dumps({'mode': a.mode, 'n': len(idx), 'status': dict(st), 'wall_s': out['wall_s'], 'hwm_kb': out['hwm_kb'],
                      'parse_ms_sum': round(sum(r['parse_ms'] for r in out['tus'].values()), 1)}))


# ---- adapter allowlist re-implemented from scripts/cpp-source-query.py compile_unit() (read, not imported) ----
def adapter_unknown(entry, root):
    raw, d = entry['arguments'], entry['directory']
    reasons = []
    physical = os.path.normpath(os.path.join(d, entry['file']))
    rel = os.path.relpath(physical, root)
    base = physical[:-len(rel)].rstrip('/')
    dn = os.path.normpath(d)
    if dn != base and not dn.startswith(base + '/'):
        reasons.append(('directory', 'Compilation directory is outside mapped workspace'))
    unknown, outside = [], set()
    i = 1
    while i < len(raw):
        a = raw[i]
        if a in ['-o', '-MF', '-MT', '-MQ']:
            i += 2
            continue
        if a in ['-c', '-MMD', '-MD', '-MP', '-pipe']:
            i += 1
            continue
        opt = next((f for f in ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U'] if a == f or (f in ['-I', '-D', '-U'] and a.startswith(f))), None)
        if opt:
            if a == opt:
                i += 1
                v = raw[i]
            else:
                v = a[len(opt):]
            if opt not in ['-D', '-U']:
                if v.startswith('/') and not (v == base or v.startswith(base + '/')):
                    outside.add((opt, v))
        elif a in ['-x', '-target', '--target']:
            i += 1
        elif (re.fullmatch(r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', a) or re.fullmatch(r'--target=[A-Za-z0-9_+.-]+', a) or re.fullmatch(r'-O[0-3szg]', a)
              or re.fullmatch(r'-g(?:[0-3]|dwarf-[2-5])?', a) or re.fullmatch(r'-W(?:no-)?[A-Za-z0-9=-]+', a)):
            pass
        elif a in ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti', '-fms-extensions',
                   '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin', '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']:
            pass
        elif not a.startswith('-') and os.path.normpath(os.path.join(d, a)) == physical:
            pass
        else:
            unknown.append(a)
        i += 1
    return reasons, unknown, sorted(outside)


def cmd_args(a):
    root = os.path.realpath(a.root)
    db = json.load(open(a.db))
    per_arg_tus, outside_vals, dir_out = collections.Counter(), collections.Counter(), 0
    per_tu_unknown = 0
    std = collections.Counter()
    for k, e in enumerate(db):
        reasons, unknown, outside = adapter_unknown(e, root)
        dir_out += bool(reasons)
        per_tu_unknown += bool(unknown)
        for x in set(unknown):
            per_arg_tus[x] += 1
        for o in outside:
            outside_vals[o] += 1
        s = [x for x in e['arguments'] if x.startswith('-std=')]
        std[' '.join(dict.fromkeys(s))] += 1
    print(json.dumps({'tus': len(db), 'tus_with_unknown': per_tu_unknown, 'tus_dir_outside': dir_out,
                      'unknown_arg_tu_counts': dict(per_arg_tus.most_common()),
                      'outside_I': sorted({v for (o, v) in outside_vals if o == '-I'}),
                      'outside_isystem_distinct': len({v for (o, v) in outside_vals if o == '-isystem'}),
                      'std_combos': dict(std)}, indent=1))


MACROS = ['__NO_MATH_ERRNO__', '__SSE__', '__SSE2__', '__SSE3__', '__SSSE3__', '__MMX__', '_OPENMP', '__AVX__', '__AVX2__', '__FMA__',
          '__BMI2__', '__OPTIMIZE__', '__NO_INLINE__', '_REENTRANT', '__STRICT_ANSI__', '__PIE__', '__FAST_MATH__', 'linux', 'unix']


def defined_macros(index, path, flags):
    args = ['-x', 'c++', '-nostdinc', '-nostdinc++'] + flags
    enc = [x.encode() for x in args]
    argv = (C.c_char_p * len(enc))(*enc)
    tu = P()
    code = parse2(index, path.encode(), argv, len(enc), None, 0, F_INC | F_KEEP, C.byref(tu))
    if code or not tu.value:
        return None
    found = set()
    try:
        for k in range(numDiag(tu)):
            dg = getDiag(tu, k)
            try:
                m = re.search(r'DEFINED_(\S+)', S(diagSpell(dg)))
                if m:
                    found.add(m.group(1))
            finally:
                disposeDiag(dg)
    finally:
        disposeTU(tu)
    return found


def cmd_macros(a):
    os.makedirs(a.fixture_dir, exist_ok=True)
    path = os.path.join(a.fixture_dir, 'probe.cpp')
    with open(path, 'w') as h:
        for m in MACROS:
            h.write('#ifdef %s\n#error DEFINED_%s\n#endif\n' % (m, m))
    index = createIndex(0, 0)
    base_flags = ['-std=gnu++17']
    base = defined_macros(index, path, base_flags)
    res = {'base': sorted(base)}
    for f in ['-fno-math-errno', '-msse3', '-mssse3', '-mmmx', '-msse', '-msse2', '-fopenmp', '-march=native', '-O3', '-pthread', '-fPIC',
              '-funroll-loops', '-fomit-frame-pointer', '-fno-signed-zeros', '-std=c++17']:
        got = defined_macros(index, path, base_flags + [f])
        res[f] = None if got is None else {'added': sorted(got - base), 'removed': sorted(base - got)}
    print(json.dumps(res, indent=1))


def cmd_bodyinc(a):
    d = a.fixture_dir
    os.makedirs(d, exist_ok=True)
    files = {
        'main.cpp': '#include "a.h"\nint f() {\n#include "b.h"\n  return B_VALUE;\n}\ntemplate <class T> T g() {\n#include "c.h"\n  return T();\n}\n'
                    'struct S { int m() {\n#include "d.h"\n  return 0; } };\nint h() {\n#include <missing_in_body.h>\n  return 0;\n}\n'
                    'int k() {\n#if 1\n  return 0;\n}\n',
        'a.h': 'int a_value;\n', 'b.h': '#define B_VALUE 1\n', 'c.h': '/* c */\n', 'd.h': '/* d */\n'}
    for n, t in files.items():
        with open(os.path.join(d, n), 'w') as h:
            h.write(t)
    index = createIndex(0, 0)
    root = os.path.realpath(d)
    out = {}
    for mode in ('light', 'light-bodies'):
        r = scan_tu(index, os.path.join(root, 'main.cpp'), ['-x', 'c++', '-std=gnu++17', '-w', '-ferror-limit=0', '-nostdinc', '-nostdinc++',
                                                              '-I', root], OPTIONS[mode], root, mode != 'light')
        out[mode] = {'directives': [[os.path.basename(x[0]), x[1], x[3], os.path.basename(x[4]) if x[4] else None] for x in r['dirs']],
                     'entered': [os.path.basename(x) for x in r['entered']],
                     'diags': [[d2.get('line'), d2.get('cat'), d2.get('sp')] for d2 in r['diags']]}
    print(json.dumps(out, indent=1))


COND_RE = re.compile(r'^\s*#\s*(if|ifdef|ifndef|elif|elifdef|elifndef)\b(.*)$')
INC_RE = re.compile(r'^\s*#\s*(include|include_next|import)\b\s*(.)')
EXTS = ('.h', '.hpp', '.hh', '.hxx', '.c', '.cc', '.cpp', '.cxx', '.inl', '.ipp', '.tpp')


def cmd_conds(a):
    root = os.path.realpath(a.root)
    rows, inc_lines, inc_delim, nlines = [], 0, collections.Counter(), 0
    files = 0
    for cur, sub, fs in os.walk(root):
        for f in fs:
            if not f.endswith(EXTS):
                continue
            files += 1
            p = os.path.join(cur, f)
            lines = open(p, encoding='utf-8', errors='replace').read().split('\n')
            nlines += len(lines)
            for i, line in enumerate(lines):
                m = INC_RE.match(line)
                if m:
                    inc_lines += 1
                    inc_delim[m.group(2)] += 1
                m = COND_RE.match(line)
                if not m:
                    continue
                ids = re.findall(r'[A-Za-z_][A-Za-z0-9_]*', m.group(2))
                sysids = [x for x in ids if (x.startswith('__') or re.match(r'_[A-Z]', x) or x in ('linux', 'unix', 'WIN32', 'APPLE', 'defined'))
                          and x != 'defined']
                guard = m.group(1) == 'ifndef' and i + 1 < len(lines) and re.match(r'\s*#\s*define\s+' + re.escape(ids[0] if ids else '@'), lines[i + 1] or '')
                if sysids and not guard:
                    rows.append('%s:%d %s' % (os.path.relpath(p, root), i + 1, line.strip()[:120]))
    print(json.dumps({'cxx_files': files, 'lines': nlines, 'textual_include_lines': inc_lines, 'delims': dict(inc_delim),
                      'conditionals_on_compiler_or_system_macros': rows}, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd')
    ap.add_argument('--db')
    ap.add_argument('--root')
    ap.add_argument('--mode')
    ap.add_argument('--out')
    ap.add_argument('--indices')
    ap.add_argument('--fixture-dir')
    a = ap.parse_args()
    {'scan': cmd_scan, 'args': cmd_args, 'macros': cmd_macros, 'bodyinc': cmd_bodyinc, 'conds': cmd_conds}[a.cmd](a)


if __name__ == '__main__':
    main()
