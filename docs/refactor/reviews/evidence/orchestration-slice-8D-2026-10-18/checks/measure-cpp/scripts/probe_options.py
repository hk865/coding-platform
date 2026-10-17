"""Probe: what DetailedPreprocessingRecord alone, +KeepGoing, +Incomplete, +SkipFunctionBodies do with missing headers.
python3 -I probe_options.py LIBCLANG FILE [clang args...]"""
import ctypes as C
import importlib.util
import sys

spec = importlib.util.spec_from_file_location('scan', '/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts/light_include_scan.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)
cl = scan.Clang(sys.argv[1])
index = cl.create_index(0, 0)
variants = [('DPR', 0x01), ('DPR|KeepGoing', 0x201), ('DPR|Incomplete', 0x03), ('DPR|Incomplete|SkipBodies', 0x43),
            ('light = DPR|Incomplete|SkipBodies|KeepGoing', 0x243)]
for label, options in variants:
    tu = C.c_void_p()
    args = [a.encode() for a in sys.argv[3:]]
    argv = (C.c_char_p * len(args))(*args)
    code = cl.parse(index, sys.argv[2].encode(), argv, len(args), None, 0, options, C.byref(tu))
    directives = []

    @cl.Visitor
    def visitor(cursor, parent, data):
        if cursor.kind == 503:
            inc = cl.included_file(cursor)
            f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
            cl.expansion_location(cl.cursor_location(cursor), C.byref(f), C.byref(line), C.byref(col), C.byref(off))
            directives.append('%d:%s%s' % (line.value, cl.string(cl.spelling(cursor)), '' if inc else '(unresolved)'))
        return 1

    cl.visit_children(cl.tu_cursor(tu), visitor, None)
    diags = []
    for k in range(cl.diagnostic_count(tu)):
        d = cl.get_diagnostic(tu, k)
        f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(cl.diagnostic_location(d), C.byref(f), C.byref(line), C.byref(col), C.byref(off))
        diags.append('sev%d L%d %s' % (cl.diagnostic_severity(d), line.value, cl.string(cl.diagnostic_text(d))[:45]))
        cl.dispose_diagnostic(d)
    entered = []

    @cl.InclusionVisitor
    def inc_visitor(included, stack, depth, data):
        entered.append(cl.string(cl.file_name(included)).split('/')[-1])

    cl.get_inclusions(tu, inc_visitor, None)
    print('==', label, 'code', code)
    print('   directives', directives)
    print('   entered   ', entered)
    for d in diags:
        print('   diag', d)
    cl.dispose_tu(tu)
