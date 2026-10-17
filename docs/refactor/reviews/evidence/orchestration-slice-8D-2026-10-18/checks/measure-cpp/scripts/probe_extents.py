"""Probe: raw libclang file names and function-cursor extents with and without SkipFunctionBodies.
python3 -I probe_extents.py LIBCLANG FILE [clang args...]"""
import ctypes as C
import importlib.util
import sys

spec = importlib.util.spec_from_file_location('scan', '/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts/light_include_scan.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)
cl = scan.Clang(sys.argv[1])
index = cl.create_index(0, 0)
for options in (scan.MODES['light']['options'], scan.MODES['light-bodies']['options']):
    tu = C.c_void_p()
    args = [a.encode() for a in sys.argv[3:]]
    argv = (C.c_char_p * len(args))(*args)
    code = cl.parse(index, sys.argv[2].encode(), argv, len(args), None, 0, options, C.byref(tu))
    print('options', hex(options), 'code', code)
    shown = [0]

    def exp(loc):
        f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(loc, C.byref(f), C.byref(line), C.byref(col), C.byref(off))
        return (cl.string(cl.file_name(f.value)) if f.value else None), line.value, off.value

    @cl.Visitor
    def visitor(cursor, parent, data):
        if cursor.kind in scan.FUNC_KINDS:
            ext = cl.cursor_extent(cursor)
            s, e = exp(cl.range_start(ext)), exp(cl.range_end(ext))
            if s[0] == sys.argv[2]:
                print('  func', cl.string(cl.spelling(cursor)), 'definition', cl.is_definition(cursor), 'extent lines', s[1], '-', e[1])
        if cursor.kind == 503 and shown[0] < 3:
            inc = cl.included_file(cursor)
            print('  include raw name:', cl.string(cl.file_name(inc)) if inc else None)
            shown[0] += 1
        return 1

    cl.visit_children(cl.tu_cursor(tu), visitor, None)
    cl.dispose_tu(tu)
