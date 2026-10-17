#!/usr/bin/env python3
"""Which predefined macros does each compile flag change under libclang 18 (task g)?

Run only as: python3 -I probe_macros.py EMPTY_CPP_FILE [flag ...]
Parses an empty C++ file with -x c++ -std=gnu++17 -nostdinc -nostdinc++ (DetailedPreprocessingRecord), collects
the MacroDefinition cursors (the predefined macros), and for each flag prints the macro names it adds or
removes compared with no flag.  Uses the scanner's libclang binding (imported from this folder).
"""
import ctypes as C
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import light_include_scan as L  # noqa: E402

BASE = ['-x', 'c++', '-std=gnu++17', '-nostdinc', '-nostdinc++', '-fsyntax-only', '-w']


def macros(cl, index, path, extra):
    args = BASE + extra
    enc = [a.encode() for a in args]
    argv = (C.c_char_p * len(enc))(*enc)
    tu = C.c_void_p()
    code = cl.parse(index, path.encode(), argv, len(enc), None, 0, L.F_DETAILED_PP | L.F_INCOMPLETE, C.byref(tu))
    if code != 0 or not tu.value:
        return None
    names = set()

    @cl.Visitor
    def visitor(cursor, parent, data):
        if cursor.kind == 501:
            names.add(cl.string(cl.spelling(cursor)))
        return 1

    try:
        cl.visit_children(cl.tu_cursor(tu), visitor, None)
    finally:
        cl.dispose_tu(tu)
    return names


def main():
    path, flags = sys.argv[1], sys.argv[2:]
    cl = L.Clang(L.LIBCLANG_DEFAULT)
    index = cl.create_index(0, 0)
    base = macros(cl, index, path, [])
    out = {'baseline_count': len(base), 'flags': {}}
    for flag in flags:
        got = macros(cl, index, path, flag.split(' '))
        if got is None:
            out['flags'][flag] = 'null TU'
            continue
        out['flags'][flag] = {'added': sorted(got - base), 'removed': sorted(base - got)}
    for flag, v in out['flags'].items():
        if isinstance(v, str):
            print('%-22s %s' % (flag, v))
        else:
            added = v['added'] if len(v['added']) <= 12 else v['added'][:12] + ['... %d in all' % len(v['added'])]
            print('%-22s +%d %s  -%d %s' % (flag, len(v['added']), ' '.join(added), len(v['removed']), ' '.join(v['removed'][:8])))
    print(json.dumps({'baseline_count': out['baseline_count']}))


if __name__ == '__main__':
    main()
