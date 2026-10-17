#!/usr/bin/env python3
"""Verifier debug: dump every diagnostic (any severity) located in one file of one TU, light mode, with an optional override.

Run only as: python3 -I vf_diagdump.py DB SRC LIST INDEX FILE_REL [OVERRIDE_PATH] [--bodies]
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vf_scan as V  # the verifier's own module, next to this script

db, src, lst, idx, frel = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3], int(sys.argv[4]), sys.argv[5]
ov = sys.argv[6] if len(sys.argv) > 6 and not sys.argv[6].startswith('--') else None
bodies = '--bodies' in sys.argv
entry = json.load(open(db))[idx]
overrides = {frel: ov} if ov else {}
vfs = '/tmp/vf-diagdump-%d.vfs.json' % os.getpid()
V.build_vfs(src, lst, overrides, vfs)
s, args, cls = V.filter_args(entry, src, 'light')
extra = ['-w', '-ferror-limit=0', '-fno-modules', '-fno-implicit-modules', '-fsyntax-only', '-nostdinc', '-nostdinc++', '-ivfsoverlay', vfs]
full = [x.encode() for x in args + extra]
argv = (V.C.c_char_p * len(full))(*full)
tu = V.P()
idxp = V.create_index(0, 0)
opts = V.F_DPP | V.F_INC | V.F_KEEP | (0 if bodies else V.F_SKIP)
code = V.parse(idxp, s.encode(), argv, len(full), None, 0, opts, V.C.byref(tu))
print('code', code, 'ndiag', V.ndiag(tu))
target = os.path.join(src, frel)
for k in range(V.ndiag(tu)):
    d = V.get_diag(tu, k)
    f, l, c, o = V.P(), V.U(), V.U(), V.U()
    V.exp_loc(V.diag_loc(d), V.C.byref(f), V.C.byref(l), V.C.byref(c), V.C.byref(o))
    name = V.S(V.file_name(f.value)) if f.value else None
    sev = V.diag_sev(d)
    if name and os.path.normpath(name) == target:
        print(k, sev, l.value, V.S(V.diag_cat(d)), '|', V.S(V.diag_text(d))[:120])
    V.diag_dispose(d)
os.remove(vfs)
