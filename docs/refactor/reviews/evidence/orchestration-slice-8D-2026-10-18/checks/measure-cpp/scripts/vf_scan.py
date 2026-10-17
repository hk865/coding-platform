#!/usr/bin/env python3
"""Verifier's own minimal include-only libclang scan (independent of light_include_scan.py / evaluate_rules.py).

Run only as: python3 -I vf_scan.py --db DB --root SRC --file-list LIST --mode light|bodies|ref --out OUT.ndjson
                 (--indices 1,2,3 | --all) [--override REL=PATH ...] [--tag NAME]
stdlib + ctypes.  Nothing from the project is executed: libclang only lexes/parses.
Edges come from clang_findIncludesInFile (the prototype uses clang_visitChildren); positions are my own
chain keys from clang_getInclusions; rules are computed here per TU (R0 by position and by emission order).
One NDJSON line per TU; TUs already present (same tag) are skipped (resumable).
"""
import argparse, collections, ctypes as C, json, os, re, shlex, sys, time

LIB = '/usr/lib/llvm-18/lib/libclang.so.1'
F_DPP, F_INC, F_SKIP, F_KEEP = 0x01, 0x02, 0x40, 0x200
LEX, USER = 'Lexical or Preprocessor Issue', 'User-Defined Issue'


class CXString(C.Structure):
    _fields_ = [('data', C.c_void_p), ('flags', C.c_uint)]


class Cursor(C.Structure):
    _fields_ = [('kind', C.c_uint), ('xdata', C.c_int), ('data', C.c_void_p * 3)]


class Loc(C.Structure):
    _fields_ = [('p', C.c_void_p * 2), ('i', C.c_uint)]


class Rng(C.Structure):
    _fields_ = [('p', C.c_void_p * 2), ('b', C.c_uint), ('e', C.c_uint)]


RangeVisit = C.CFUNCTYPE(C.c_int, C.c_void_p, Cursor, Rng)


class CRV(C.Structure):
    _fields_ = [('context', C.c_void_p), ('visit', RangeVisit)]


IncVisit = C.CFUNCTYPE(None, C.c_void_p, C.POINTER(Loc), C.c_uint, C.c_void_p)

lib = C.CDLL(LIB)


def b(name, res, *args):
    f = getattr(lib, name); f.restype = res; f.argtypes = list(args); return f


P, U = C.c_void_p, C.c_uint
_cstr = b('clang_getCString', C.c_char_p, CXString)
_dstr = b('clang_disposeString', None, CXString)


def S(x):
    try:
        return (_cstr(x) or b'').decode('utf-8', 'replace')
    finally:
        _dstr(x)


version = S(b('clang_getClangVersion', CXString)())
create_index = b('clang_createIndex', P, C.c_int, C.c_int)
parse = b('clang_parseTranslationUnit2', C.c_int, P, C.c_char_p, C.POINTER(C.c_char_p), C.c_int, P, U, U, C.POINTER(P))
get_inclusions = b('clang_getInclusions', None, P, IncVisit, P)
find_includes = b('clang_findIncludesInFile', C.c_int, P, P, CRV)
included_file = b('clang_getIncludedFile', P, Cursor)
cursor_loc = b('clang_getCursorLocation', Loc, Cursor)
cursor_spelling = b('clang_getCursorSpelling', CXString, Cursor)
exp_loc = b('clang_getExpansionLocation', None, Loc, C.POINTER(P), C.POINTER(U), C.POINTER(U), C.POINTER(U))
file_name = b('clang_getFileName', CXString, P)
ndiag = b('clang_getNumDiagnostics', U, P)
get_diag = b('clang_getDiagnostic', P, P, U)
diag_sev = b('clang_getDiagnosticSeverity', U, P)
diag_text = b('clang_getDiagnosticSpelling', CXString, P)
diag_loc = b('clang_getDiagnosticLocation', Loc, P)
diag_cat = b('clang_getDiagnosticCategoryText', CXString, P)
diag_dispose = b('clang_disposeDiagnostic', None, P)
tu_dispose = b('clang_disposeTranslationUnit', None, P)


def under(p, r):
    return p == r or p.startswith(r + '/')


def filter_args(entry, root, mode):
    d = entry['directory']
    raw = entry.get('arguments') or shlex.split(entry['command'])
    src = os.path.normpath(os.path.join(d, entry['file']))
    args, cls = [], collections.Counter()
    i = 1
    while i < len(raw):
        a = raw[i]
        if a == '-o':
            cls['ignore -o'] += 1; i += 2; continue
        if a == '-c':
            cls['ignore -c'] += 1; i += 1; continue
        opt = None
        for f in ('-isystem', '-iquote', '-idirafter', '-include', '-imacros', '-I', '-D', '-U'):
            if a == f or (f in ('-I', '-D', '-U') and a.startswith(f) and len(a) > len(f)):
                opt = f; break
        if opt:
            if a == opt:
                v = raw[i + 1]; i += 2
            else:
                v = a[len(opt):]; i += 1
            if opt in ('-D', '-U'):
                args += [opt, v]; cls['keep ' + opt] += 1; continue
            p = os.path.normpath(os.path.join(d, v))
            if under(os.path.realpath(p), root) or mode == 'ref':
                args += [opt, p]; cls['keep %s (%s)' % (opt, 'inside' if under(os.path.realpath(p), root) else 'outside')] += 1
            else:
                cls['ignore %s outside root' % opt] += 1
            continue
        if re.fullmatch(r'-std=\S+', a) or re.fullmatch(r'-O[0-3sgz]?', a) or a in ('-fPIC', '-fpic', '-fPIE', '-pthread', '-m64', '-m32'):
            args.append(a); cls['keep ' + a] += 1; i += 1; continue
        if a == '-w' or a.startswith('-W') or a.startswith('-g'):
            cls['ignore ' + a] += 1; i += 1; continue
        if not a.startswith('-'):
            if os.path.normpath(os.path.join(d, a)) == src:
                i += 1; continue
            cls['unknown positional ' + a] += 1; i += 1; continue
        cls['unknown ' + a] += 1; i += 1
    return src, args, cls


def build_vfs(root, file_list, overrides, path):
    tree = {'type': 'directory', 'name': root, 'contents': []}
    dirs = {'': tree}
    n = 0
    for line in open(file_list, encoding='utf-8'):
        rel = line.rstrip('\n').strip('/')
        if not rel:
            continue
        full = os.path.join(root, rel)
        if not os.path.isfile(full) or os.path.getsize(full) > 2 * 1024 * 1024:
            continue
        parent = ''
        for seg in rel.split('/')[:-1]:
            ch = parent + '/' + seg if parent else seg
            if ch not in dirs:
                dirs[ch] = {'type': 'directory', 'name': seg, 'contents': []}
                dirs[parent]['contents'].append(dirs[ch])
            parent = ch
        dirs[parent]['contents'].append({'type': 'file', 'name': rel.split('/')[-1], 'external-contents': overrides.get(rel, full)})
        n += 1
    json.dump({'version': 0, 'case-sensitive': True, 'use-external-names': False, 'fallthrough': False, 'roots': [tree]}, open(path, 'w'))
    return n


INC_RE = re.compile(rb'^\s*#\s*(include_next|include|import)\s*(.)')


def scan(index, entry, k, root, mode, vfs, overrides):
    src, args, cls = filter_args(entry, root, mode)
    row = {'i': k, 'tu': os.path.relpath(src, root) if under(src, root) else src, 'args_kept': args, 'arg_classes': dict(cls)}
    if mode != 'ref' and not under(src, root):
        row['status'] = 'outside_root'; return row
    extra = ['-w', '-ferror-limit=0', '-fno-modules', '-fno-implicit-modules', '-fsyntax-only']
    if mode == 'ref':
        extra += ['-idirafter', '/usr/lib/gcc/x86_64-linux-gnu/13/include']
    else:
        extra += ['-nostdinc', '-nostdinc++', '-ivfsoverlay', vfs]
    opts = F_DPP | F_INC | F_KEEP | (F_SKIP if mode == 'light' else 0)
    full = [x.encode() for x in args + extra]
    argv = (C.c_char_p * len(full))(*full)
    tu = P()
    t0 = time.monotonic()
    code = parse(index, src.encode(), argv, len(full), None, 0, opts, C.byref(tu))
    t1 = time.monotonic()
    row['parse_ms'] = round((t1 - t0) * 1000, 1)
    if code != 0 or not tu.value:
        row['status'] = 'null_tu'; row['code'] = code; return row
    names = {}

    def fn(fp):
        if not fp:
            return None
        if fp not in names:
            raw = S(file_name(fp))
            names[fp] = os.path.realpath(raw) if '..' in raw.split('/') else os.path.normpath(raw)
        return names[fp]

    def el(loc):
        f, l, c, o = P(), U(), U(), U()
        exp_loc(loc, C.byref(f), C.byref(l), C.byref(c), C.byref(o))
        return fn(f.value), l.value, o.value

    def rel(p):
        return os.path.relpath(p, root) if p and under(p, root) else None

    try:
        chains, entries, filemap, order = {}, collections.Counter(), {}, []
        errs = []

        @IncVisit
        def iv(fp, stack, depth, data):
            try:
                name = fn(fp)
                entries[name] += 1
                if name in chains:
                    return
                ch = []
                for j in range(depth - 1, -1, -1):
                    ch.append(el(stack[j])[2])
                if depth and el(stack[depth - 1])[0] != src:
                    ch.insert(0, -1)
                chains[name] = ch
                filemap[name] = fp
                order.append(name)
            except Exception as e:
                errs.append(repr(e))

        get_inclusions(tu, iv, None)
        # directives via clang_findIncludesInFile on every entered file under root
        directives = []
        texts = {}

        def line_text(name, line):
            if name not in texts:
                r = rel(name)
                p = overrides.get(r, name) if r else name
                try:
                    texts[name] = open(p, 'rb').read().split(b'\n')
                except OSError:
                    texts[name] = []
            t = texts[name]
            return t[line - 1] if 0 < line <= len(t) else b''

        @RangeVisit
        def rv(ctx, cur, rng):
            try:
                name, line, off = el(cursor_loc(cur))
                inc = included_file(cur)
                tgt = fn(inc) if inc else None
                m = INC_RE.match(line_text(name, line))
                delim = (m.group(2).decode('latin-1') if m else '?')
                delim = delim if delim in '<"' else 'macro'
                directives.append([rel(name), line, S(cursor_spelling(cur)), delim, (rel(tgt) or ('EXT:' + tgt)) if tgt else None, off])
            except Exception as e:
                errs.append(repr(e))
            return 1

        crv = CRV(None, rv)
        for name in order:
            if rel(name) is not None:
                find_includes(tu, filemap[name], crv)
        # diagnostics
        per_file = {}
        missing = []      # (key, emit, file, line, spelling)
        angled = []
        ext_errs = collections.Counter()
        n_err = 0
        for k2 in range(ndiag(tu)):
            dg = get_diag(tu, k2)
            try:
                sev = diag_sev(dg)
                if sev < 3:
                    continue
                n_err += 1
                name, line, off = el(diag_loc(dg))
                sp = S(diag_text(dg))
                cat = S(diag_cat(dg))
                key = (chains[name] + [off]) if name in chains else None
                if 'file not found' in sp:
                    rec = [key, k2, rel(name) or name, line, sp[:120]]
                    (angled if 'with <angled>' in sp else missing).append(rec)
                    continue
                if sp.startswith('expected "FILENAME"'):
                    missing.append([key, k2, rel(name) or name, line, sp[:120]])
                    continue
                r = rel(name)
                if r is None:
                    ext_errs[cat] += 1
                    continue
                pf = per_file.setdefault(r, {'n': 0, 'lex': 0, 'user': 0, 'first_emit': None, 'min_key': None, 'first': None, 'first_lex': None, 'cats': {}})
                pf['n'] += 1
                pf['cats'][cat] = pf['cats'].get(cat, 0) + 1
                if cat == LEX:
                    pf['lex'] += 1
                    if pf['first_lex'] is None:
                        pf['first_lex'] = '%d %s' % (line, sp[:100])
                if cat == USER:
                    pf['user'] += 1
                    if pf['first_lex'] is None:
                        pf['first_lex'] = '%d #error %s' % (line, sp[:100])
                if pf['first_emit'] is None:
                    pf['first_emit'] = k2
                    pf['first'] = '%d %s [%s]' % (line, sp[:100], cat)
                if key is not None and (pf['min_key'] is None or key < pf['min_key']):
                    pf['min_key'] = key
            finally:
                diag_dispose(dg)
        t2 = time.monotonic()
        # rank (0-based) of the first missing #include among all project directives in preprocessing order (my keys)
        dkeys = sorted((chains[os.path.join(root, d[0])] + [d[5]]) for d in directives
                       if d[0] is not None and os.path.join(root, d[0]) in chains)
        mkeys = [m[0] for m in missing if m[0] is not None]
        if mkeys and dkeys:
            fk = min(mkeys)
            # the diagnostic sits on the file name, after the directive's '#': the missing directive itself is the last key < fk
            row['first_missing_rank'] = sum(1 for x in dkeys if x < fk) - 1
        row['n_directive_keys'] = len(dkeys)
        row.update(status='ok', collect_ms=round((t2 - t1) * 1000, 1), n_errors=n_err,
                   entered=[rel(n) for n in order if rel(n) is not None], entered_ext=sum(1 for n in order if rel(n) is None),
                   multi_entry=sorted(rel(n) for n, c in entries.items() if c > 1 and rel(n)),
                   directives=directives, per_file=per_file, missing=missing[:2000], n_missing=len(missing),
                   angled=angled[:500], n_angled=len(angled), ext_errs=dict(ext_errs), cb_errors=errs[:5])
    finally:
        tu_dispose(tu)
    try:
        row['hwm_kb'] = int([l for l in open('/proc/self/status') if l.startswith('VmHWM')][0].split()[1])
    except Exception:
        pass
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db'); ap.add_argument('--root'); ap.add_argument('--file-list'); ap.add_argument('--mode')
    ap.add_argument('--out'); ap.add_argument('--indices'); ap.add_argument('--all', action='store_true')
    ap.add_argument('--override', action='append', default=[]); ap.add_argument('--tag', default='')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    db = json.load(open(a.db))
    overrides = dict(x.split('=', 1) for x in a.override)
    idx = list(range(len(db))) if a.all else [int(x) for x in a.indices.split(',')]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            try:
                r = json.loads(l)
                if r.get('tag') == a.tag:
                    done.add(r['i'])
            except ValueError:
                pass
    vfs = a.out + '.vfs.json'
    if a.mode != 'ref':
        build_vfs(root, a.file_list, overrides, vfs)
    index = create_index(0, 0)
    out = open(a.out, 'a')
    t0 = time.monotonic()
    for k in idx:
        if k in done:
            continue
        row = scan(index, db[k], k, root, a.mode, vfs, overrides)
        row['tag'] = a.tag; row['mode'] = a.mode
        out.write(json.dumps(row) + '\n'); out.flush()
    sys.stderr.write('libclang %s; %d TUs in %.1f s\n' % (version, len(idx) - len(done), time.monotonic() - t0))


if __name__ == '__main__':
    main()
