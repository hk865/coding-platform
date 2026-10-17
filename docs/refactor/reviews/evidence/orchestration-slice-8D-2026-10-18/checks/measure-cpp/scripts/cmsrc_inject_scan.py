#!/usr/bin/env python3
"""Light, include-only libclang scan: a measurement prototype for slice-8 spec draft section 11.4.

[cmake-src injection copy, 2026-10-17] Identical to light_include_scan.py as of 15:46 plus two measurement-only
options: --vfs-override REL=PATH (serve an injected copy under a project path, the tree on disk is untouched)
and --tu-indices (run only these DB indices).

Run only as:  python3 -I light_include_scan.py --db DB --root ROOT --mode MODE --out OUT.ndjson [options]
              python3 -I light_include_scan.py --print-arg-table

stdlib + ctypes only.  The libclang 18 C API binding and the argument allowlist are COPIED (not
imported) from the repository adapter scripts/cpp-source-query.py (lines 21-91 and 161-205); the
ignore-and-record table and the reject table below are additions under test.  Project code never
runs: libclang only lexes/parses.  Each translation unit (TU) runs in a worker subprocess
(python3 -I this-file --worker); the parent enforces a per-TU timeout, records hangs and crashes,
restarts the worker and continues with the next TU.  Output: one NDJSON line per TU, appended;
TUs already present for the same mode are skipped (resumable).

Modes
  light         DetailedPreprocessingRecord|Incomplete|SkipFunctionBodies|KeepGoing,
                -w -ferror-limit=0 -nostdinc -nostdinc++, redirect-only VFS of the files under ROOT
                (fallthrough false, like production), include paths outside ROOT dropped and recorded.
  light-bodies  the same without SkipFunctionBodies.
  reference     light-bodies WITHOUT -nostdinc/-nostdinc++ and WITHOUT the VFS: system headers are
                visible and include paths outside ROOT are kept.  libclang-common-18-dev (clang's
                resource headers: stddef.h, stdarg.h ...) is not installed on this machine, so GCC's
                builtin include directory is appended with -idirafter (see --builtin-include).
"""
import argparse
import collections
import ctypes as C
import glob
import json
import os
import re
import select
import shlex
import signal
import subprocess
import sys
import time
from pathlib import PurePosixPath

SCAN_VERSION = 1
LIBCLANG_DEFAULT = '/usr/lib/llvm-18/lib/libclang.so.1'

# CXTranslationUnit_Flags (clang-c/Index.h, LLVM 18)
F_DETAILED_PP = 0x01
F_INCOMPLETE = 0x02
F_SKIP_BODIES = 0x40
F_KEEP_GOING = 0x200

MODES = {
    'light': {'options': F_DETAILED_PP | F_INCOMPLETE | F_SKIP_BODIES | F_KEEP_GOING, 'nostdinc': True, 'vfs': True},
    'light-bodies': {'options': F_DETAILED_PP | F_INCOMPLETE | F_KEEP_GOING, 'nostdinc': True, 'vfs': True},
    'reference': {'options': F_DETAILED_PP | F_INCOMPLETE | F_KEEP_GOING, 'nostdinc': False, 'vfs': False},
    # reference-raw (added for the SLAM measurement): reference plus every ignore-and-record argument passed through
    # unchanged (-fopenmp, -march=native, -m<isa> ...), i.e. the closest libclang gets to the real compile.
    'reference-raw': {'options': F_DETAILED_PP | F_INCOMPLETE | F_KEEP_GOING, 'nostdinc': False, 'vfs': False, 'raw': True},
}
COMMON_EXTRA = ['-w', '-ferror-limit=0', '-fno-modules', '-fno-implicit-modules', '-fsyntax-only']

# Cursor kinds (clang-c/Index.h)
K_INCLUSION_DIRECTIVE = 503
PP_KINDS = (500, 501, 502)
FUNC_KINDS = {8, 21, 24, 25, 26, 30}  # FunctionDecl, CXXMethod, Constructor, Destructor, ConversionFunction, FunctionTemplate
CONTAINER_KINDS = {1, 2, 3, 4, 22, 23, 31, 32}  # Unexposed, Struct, Union, Class, Namespace, LinkageSpec, ClassTemplate, partial spec.

# ---------------------------------------------------------------------------------------------
# Argument filter.  Section A is copied from the repository adapter (allowlist); B and C are the
# ignore-and-record table and the reject table under test.  Every entry: values that follow.
# ---------------------------------------------------------------------------------------------
COMPILER_RE = r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?'
WRAPPERS = {'ccache', 'sccache', 'distcc', 'icecc'}
# A. adapter allowlist (cpp-source-query.py:175-200)
ADAPTER_DROP_SEPARATE = ['-o', '-MF', '-MT', '-MQ']          # 1 value, ignored
ADAPTER_DROP_ZERO = ['-c', '-MMD', '-MD', '-MP', '-pipe']     # 0 values, ignored
KEEP_PATH_OPTIONS = ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U']  # 1 value (joined allowed for -I -D -U)
KEEP_VALUE_OPTIONS = ['-x', '-target', '--target']            # 1 value, validated
KEEP_REGEXES = [r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', r'--target=[A-Za-z0-9_+.-]+', r'-O[0-3szg]',
                r'-g(?:[0-3]|dwarf-[2-5])?', r'-W(?:no-)?[A-Za-z0-9=-]+']
KEEP_ZERO = ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti',
             '-fms-extensions', '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin',
             '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']
# B. ignore and record: (match, spelling, values that follow, what dropping it can change)
#    affects: none = output/codegen/link/diagnostics only; macros = predefined macros differ (can flip #if);
#    include-paths = header search differs; language = parsing rules differ.
DROP_TABLE = [
    ('exact', '-w', 0, 'none'), ('exact', '-pedantic', 0, 'none'), ('exact', '-pedantic-errors', 0, 'none'),
    ('exact', '-Wpedantic', 0, 'none'),
    ('exact', '-M', 0, 'none'), ('exact', '-MM', 0, 'none'), ('exact', '-MG', 0, 'none'), ('exact', '-S', 0, 'none'),
    ('exact', '-E', 0, 'none'), ('exact', '-v', 0, 'none'), ('exact', '-H', 0, 'none'), ('exact', '-save-temps', 0, 'none'),
    ('prefix', '-save-temps=', 0, 'none'),
    ('exact', '-shared', 0, 'none'), ('exact', '-static', 0, 'none'), ('exact', '-rdynamic', 0, 'none'),
    ('exact', '-pie', 0, 'none'), ('exact', '-no-pie', 0, 'none'), ('exact', '-s', 0, 'none'),
    ('exact', '-nostdlib', 0, 'none'), ('exact', '-nostdlib++', 0, 'none'), ('exact', '-nodefaultlibs', 0, 'none'),
    ('exact', '-nostartfiles', 0, 'none'), ('exact', '-static-libgcc', 0, 'none'), ('exact', '-static-libstdc++', 0, 'none'),
    ('exact', '--param', 1, 'none'), ('prefix', '--param=', 0, 'none'),
    ('exact', '-Xlinker', 1, 'none'), ('exact', '-Xassembler', 1, 'none'), ('exact', '-u', 1, 'none'),
    ('exact', '-z', 1, 'none'), ('exact', '-T', 1, 'none'), ('exact', '-L', 1, 'none'), ('prefix', '-L', 0, 'none'),
    ('prefix', '-l', 0, 'none'), ('prefix', '-Wl,', 0, 'none'), ('prefix', '-Wa,', 0, 'none'),
    ('exact', '-dumpdir', 1, 'none'), ('exact', '-dumpbase', 1, 'none'), ('exact', '-dumpbase-ext', 1, 'none'),
    ('exact', '-aux-info', 1, 'none'), ('exact', '-B', 1, 'none'), ('prefix', '-B', 0, 'none'),
    ('prefix', '-fuse-ld=', 0, 'none'), ('prefix', '-rtlib=', 0, 'none'), ('prefix', '-unwindlib=', 0, 'none'),
    ('prefix', '-g', 0, 'none'),               # -ggdb, -gsplit-dwarf, -gz ... (-g -g0-3 -gdwarf-N are kept by A)
    ('prefix', '-O', 0, 'macros'),             # -Ofast defines __FAST_MATH__ (-O0-3/s/z/g are kept by A)
    ('exact', '-ansi', 0, 'macros'),
    ('prefix', '-march=', 0, 'macros'), ('prefix', '-mcpu=', 0, 'macros'), ('prefix', '-mtune=', 0, 'none'),
    ('prefix', '-m', 0, 'macros'),             # -msse2 -mavx2 -mfma -mno-red-zone ... (-m32/-m64 kept by A)
    ('exact', '-arch', 1, 'macros'),
    ('prefix', '-fopenmp', 0, 'macros'), ('prefix', '-fno-openmp', 0, 'macros'),
    ('prefix', '-ffast-math', 0, 'macros'), ('prefix', '-fno-fast-math', 0, 'macros'),
    ('prefix', '-ffinite-math-only', 0, 'macros'), ('prefix', '-fno-finite-math-only', 0, 'macros'),
    ('prefix', '-fsanitize', 0, 'macros'), ('prefix', '-fno-sanitize', 0, 'macros'),
    ('prefix', '-fcoroutines', 0, 'macros'), ('prefix', '-fconcepts', 0, 'macros'), ('prefix', '-fchar8_t', 0, 'macros'),
    ('prefix', '-fno-char8_t', 0, 'macros'), ('prefix', '-faligned-new', 0, 'macros'), ('prefix', '-fno-aligned-new', 0, 'macros'),
    ('prefix', '-fsized-deallocation', 0, 'macros'), ('prefix', '-fno-sized-deallocation', 0, 'macros'),
    ('exact', '-fno-operator-names', 0, 'language'), ('exact', '-fpermissive', 0, 'language'),
    ('exact', '-fno-access-control', 0, 'language'), ('prefix', '-ftemplate-depth', 0, 'language'),
    ('prefix', '-fconstexpr-depth', 0, 'language'), ('prefix', '-fconstexpr-steps', 0, 'language'),
    ('prefix', '-fext-numeric-literals', 0, 'language'), ('prefix', '-fno-gnu-keywords', 0, 'language'),
    ('prefix', '-stdlib=', 0, 'include-paths'), ('prefix', '--gcc-toolchain=', 0, 'include-paths'),
    ('exact', '-gcc-toolchain', 1, 'include-paths'), ('prefix', '--sysroot=', 0, 'include-paths'),
    ('exact', '--sysroot', 1, 'include-paths'), ('exact', '-isysroot', 1, 'include-paths'),
    ('exact', '-idirafter', 1, 'include-paths'), ('exact', '-iprefix', 1, 'include-paths'),
    ('exact', '-iwithprefix', 1, 'include-paths'), ('exact', '-iwithprefixbefore', 1, 'include-paths'),
    ('exact', '-cxx-isystem', 1, 'include-paths'), ('exact', '-iframework', 1, 'include-paths'),
    ('exact', '-F', 1, 'include-paths'), ('prefix', '-F', 0, 'include-paths'),
    ('exact', '-resource-dir', 1, 'include-paths'), ('prefix', '-resource-dir=', 0, 'include-paths'),
] + [('prefix', p, 0, 'none') for p in [
    '-fvisibility', '-ffunction-sections', '-fno-function-sections', '-fdata-sections', '-fno-data-sections',
    '-fstack-protector', '-fno-stack-protector', '-fstack-clash-protection', '-fno-stack-clash-protection',
    '-fcf-protection', '-fomit-frame-pointer', '-fno-omit-frame-pointer', '-fstrict-aliasing', '-fno-strict-aliasing',
    '-fwrapv', '-fno-wrapv', '-ftrapv', '-fstrict-overflow', '-fno-strict-overflow', '-fasynchronous-unwind-tables',
    '-fno-asynchronous-unwind-tables', '-funwind-tables', '-fno-unwind-tables', '-fplt', '-fno-plt',
    '-fsemantic-interposition', '-fno-semantic-interposition', '-fexcess-precision', '-fmath-errno', '-fno-math-errno',
    '-fsigned-zeros', '-fno-signed-zeros', '-ftrapping-math', '-fno-trapping-math', '-funroll-loops', '-fno-unroll-loops',
    '-fgnu-unique', '-fno-gnu-unique', '-fdelete-null-pointer-checks', '-fno-delete-null-pointer-checks',
    '-finline', '-fno-inline', '-fdiagnostics', '-fno-diagnostics', '-fcolor-diagnostics', '-fno-color-diagnostics',
    '-fmessage-length', '-fdebug-prefix-map', '-ffile-prefix-map', '-fmacro-prefix-map', '-fprofile-arcs',
    '-fno-profile-arcs', '-ftest-coverage', '-fcoverage-mapping', '-fprofile-instr-generate', '-fprofile-generate',
    '-fprofile-update', '-flto', '-fno-lto', '-ffat-lto-objects', '-fno-fat-lto-objects', '-fcommon', '-fno-common',
    '-fno-builtin-', '-fbuiltin', '-fthreadsafe-statics', '-fno-threadsafe-statics', '-felide-constructors', '-fno-elide-constructors',
    '-fopenmp-simd', '-fstrict-enums', '-ftree-', '-fno-tree-', '-fipa-', '-fno-ipa-', '-fvar-tracking',
    '-fno-var-tracking', '-fstack-usage', '-fident', '-fno-ident', '-fuse-cxa-atexit', '-fno-use-cxa-atexit',
    '-fpch-preprocess', '-fno-keep-inline-dllexport', '-fdebug-types-section', '-fno-debug-types-section',
    '-fstandalone-debug', '-fno-standalone-debug', '-fno-limit-debug-info', '-fvectorize', '-fno-vectorize',
    '-fslp-vectorize', '-fno-slp-vectorize', '-fprefetch-loop-arrays', '-fno-prefetch-loop-arrays',
    '-fasm', '-fno-asm', '-fpcc-struct-return', '-freg-struct-return', '-fshort-enums',
    '-fno-short-enums', '-fzero-initialized-in-bss', '-fno-zero-initialized-in-bss', '-fjump-tables', '-fno-jump-tables',
    '-fmerge-all-constants', '-fno-merge-all-constants', '-ffp-contract', '-fno-fp-contract', '-ffp-model',
    '-frounding-math', '-fno-rounding-math', '-freciprocal-math', '-fno-reciprocal-math', '-fassociative-math',
    '-fno-associative-math', '-fhonor-nans', '-fno-honor-nans', '-fhonor-infinities', '-fno-honor-infinities',
    '-fexpensive-optimizations', '-fno-expensive-optimizations', '-fgcse', '-fno-gcse',
    '-falign-', '-fno-align-', '-fschedule-insns', '-fno-schedule-insns', '-fpeel-loops', '-fno-peel-loops']]
# C. reject: loads code, reads a configuration or response file, or alters the file system view.
REJECT_TABLE = [
    ('exact', '-Xclang', 1), ('exact', '-Xpreprocessor', 1), ('prefix', '-Wp,', 0), ('prefix', '-fplugin', 0),
    ('prefix', '-fpass-plugin', 0), ('exact', '-load', 1), ('exact', '-ivfsoverlay', 1), ('exact', '--config', 1),
    ('prefix', '--config=', 0), ('prefix', '-specs', 0), ('exact', '-include-pch', 1), ('prefix', '-fmodule-file', 0),
    ('prefix', '-fmodule-map-file', 0), ('prefix', '-fprebuilt-module-path', 0), ('exact', '-Xarch_host', 1),
    ('exact', '-Xopenmp-target', 1), ('prefix', '-fprofile-use', 0), ('prefix', '-fprofile-instr-use', 0),
    ('prefix', '-fsanitize-blacklist', 0), ('prefix', '-fsanitize-ignorelist', 0)]


def match_table(table, arg):
    """Exact spellings first, then the longest matching prefix (so '-gcc-toolchain' is not caught by '-g')."""
    for row in table:
        if row[0] == 'exact' and arg == row[1]:
            return row
    prefixes = [row for row in table if row[0] == 'prefix' and arg.startswith(row[1])]
    return max(prefixes, key=lambda row: len(row[1])) if prefixes else None


def norm_join(directory, value):
    return os.path.normpath(os.path.join(directory, value))


def under(path, root):
    return path == root or path.startswith(root + '/')


def filter_arguments(entry, root, keep_outside_root):
    """Returns {'args', 'source', 'compiler', 'kept', 'dropped', 'unknown'}.  unknown = would fail the TU (spec 11.4)."""
    kept, dropped, unknown = [], [], []
    directory = entry.get('directory') if isinstance(entry.get('directory'), str) else None
    file = entry.get('file') if isinstance(entry.get('file'), str) else None
    raw = entry.get('arguments')
    if raw is None and isinstance(entry.get('command'), str):
        try:
            raw = shlex.split(entry['command'], posix=True)
        except ValueError as error:
            raw = None
            unknown.append({'flag': '(command)', 'values': [], 'reason': 'unparsable command: ' + str(error)})
    if not directory or not file or not isinstance(raw, list) or not raw:
        unknown.append({'flag': '(entry)', 'values': [], 'reason': 'invalid compilation database entry'})
        return {'args': [], 'source': None, 'compiler': None, 'kept': kept, 'dropped': dropped, 'unknown': unknown}
    source = norm_join(directory, file)
    compiler = PurePosixPath(raw[0]).name
    i = 1
    if compiler in WRAPPERS and len(raw) > 1:
        unknown.append({'flag': raw[0], 'values': [], 'reason': 'compiler wrapper (adapter: not executed or inferred)'})
        compiler, i = PurePosixPath(raw[1]).name, 2
    if not re.fullmatch(COMPILER_RE, compiler):
        unknown.append({'flag': compiler, 'values': [], 'reason': 'compiler not on the adapter allowlist'})
    args = []

    def take(n):
        values = raw[i + 1:i + 1 + n]
        return values, i + 1 + n

    while i < len(raw):
        arg = raw[i]
        if any(t in arg for t in ['\n', '\r', '`', '$(', ';', '&&', '||']) or arg.startswith('@'):
            unknown.append({'flag': arg, 'values': [], 'reason': 'shell syntax or response file'}); i += 1; continue
        if arg in ADAPTER_DROP_SEPARATE:
            values, i = take(1)
            dropped.append({'flag': arg, 'values': values, 'affects': 'none', 'table': 'adapter'}); continue
        if arg in ADAPTER_DROP_ZERO:
            dropped.append({'flag': arg, 'values': [], 'affects': 'none', 'table': 'adapter'}); i += 1; continue
        option = next((f for f in KEEP_PATH_OPTIONS if arg == f or (f in ['-I', '-D', '-U'] and arg.startswith(f))), None)
        if option:
            if arg == option:
                if i + 1 >= len(raw):
                    unknown.append({'flag': arg, 'values': [], 'reason': 'missing value'}); i += 1; continue
                value, i = raw[i + 1], i + 2
            else:
                value, i = arg[len(option):], i + 1
            if option in ['-D', '-U']:
                args.extend([option, value]); kept.append(option); continue
            path = norm_join(directory, value)
            inside = under(path, root) or under(os.path.realpath(path), root)
            if option in ['-include', '-imacros'] and inside and not os.path.isfile(path):
                unknown.append({'flag': option, 'values': [value], 'reason': 'forced include missing'}); continue
            if not inside and not keep_outside_root:
                dropped.append({'flag': option, 'values': [value], 'affects': 'macros' if option in ['-include', '-imacros'] else 'include-paths',
                                'table': 'outside-root'})
                continue
            args.extend([option, path]); kept.append(option); continue
        if arg in KEEP_VALUE_OPTIONS:
            if i + 1 >= len(raw) or not re.fullmatch(r'[A-Za-z0-9_+.-]+', raw[i + 1]) or (arg == '-x' and raw[i + 1] not in ['c', 'c++']):
                values, i = take(1)
                unknown.append({'flag': arg, 'values': values, 'reason': 'invalid language/target value'}); continue
            args.extend([arg, raw[i + 1]]); kept.append(arg); i += 2; continue
        if any(re.fullmatch(r, arg) for r in KEEP_REGEXES) or arg in KEEP_ZERO:
            args.append(arg); kept.append(arg); i += 1; continue
        if not arg.startswith('-'):
            if norm_join(directory, arg) != source:
                unknown.append({'flag': arg, 'values': [], 'reason': 'extra positional argument'})
            i += 1; continue
        row = match_table(REJECT_TABLE, arg)
        if row:
            values, i = take(row[2])
            unknown.append({'flag': arg, 'values': values, 'reason': 'rejected: loads code, reads a config or alters the VFS'}); continue
        row = match_table(DROP_TABLE, arg)
        if row:
            values, i = take(row[2])
            dropped.append({'flag': arg, 'values': values, 'affects': row[3], 'table': 'ignore-and-record'}); continue
        unknown.append({'flag': arg, 'values': [], 'reason': 'not in any table'}); i += 1
    return {'args': args, 'source': source, 'compiler': compiler, 'kept': kept, 'dropped': dropped, 'unknown': unknown}


def print_arg_table():
    print('| table | match | spelling | values that follow | outcome | dropping can change |')
    print('|---|---|---|---|---|---|')
    for f in ADAPTER_DROP_SEPARATE:
        print('| adapter | exact | `%s` | 1 | ignore | none |' % f)
    for f in ADAPTER_DROP_ZERO:
        print('| adapter | exact | `%s` | 0 | ignore | none |' % f)
    for f in KEEP_PATH_OPTIONS:
        print('| adapter | %s | `%s` | 1 | keep (paths: inside root only in light modes) | - |' % ('exact or joined' if f in ['-I', '-D', '-U'] else 'exact', f))
    for f in KEEP_VALUE_OPTIONS:
        print('| adapter | exact | `%s` | 1 | keep (value validated) | - |' % f)
    for r in KEEP_REGEXES:
        print('| adapter | regex | `%s` | 0 | keep | - |' % r)
    for f in KEEP_ZERO:
        print('| adapter | exact | `%s` | 0 | keep | - |' % f)
    for kind, spelling, n, affects in DROP_TABLE:
        print('| ignore-and-record | %s | `%s` | %d | ignore | %s |' % (kind, spelling, n, affects))
    for kind, spelling, n in REJECT_TABLE:
        print('| reject | %s | `%s` | %d | TU fails | - |' % (kind, spelling, n))
    print('| (none) | - | anything else | 0 | TU fails (unknown) | - |')


# ---------------------------------------------------------------------------------------------
# Worker: libclang binding (copied from the adapter, plus the calls an include-only pass needs).
# ---------------------------------------------------------------------------------------------
class CXString(C.Structure):
    _fields_ = [('data', C.c_void_p), ('private_flags', C.c_uint)]


class Cursor(C.Structure):
    _fields_ = [('kind', C.c_uint), ('xdata', C.c_int), ('data', C.c_void_p * 3)]


class Location(C.Structure):
    _fields_ = [('ptr_data', C.c_void_p * 2), ('int_data', C.c_uint)]


class Range(C.Structure):
    _fields_ = [('ptr_data', C.c_void_p * 2), ('begin_int_data', C.c_uint), ('end_int_data', C.c_uint)]


class RangeList(C.Structure):
    _fields_ = [('count', C.c_uint), ('ranges', C.POINTER(Range))]


RangeVisitorFn = C.CFUNCTYPE(C.c_int, C.c_void_p, Cursor, Range)


class CursorAndRangeVisitor(C.Structure):
    _fields_ = [('context', C.c_void_p), ('visit', RangeVisitorFn)]


class Clang:
    def __init__(self, lib_path):
        lib = C.CDLL(lib_path)

        def bind(name, result, *args):
            function = getattr(lib, name)
            function.restype, function.argtypes = result, list(args)
            return function

        pointer, uint, char = C.c_void_p, C.c_uint, C.c_char_p
        self.get_string = bind('clang_getCString', char, CXString)
        self.dispose_string = bind('clang_disposeString', None, CXString)
        self.version = self.string(bind('clang_getClangVersion', CXString)())
        if not re.search(r'clang version 18\.', self.version):
            raise RuntimeError('unsupported libclang ' + self.version)
        self.create_index = bind('clang_createIndex', pointer, C.c_int, C.c_int)
        self.parse = bind('clang_parseTranslationUnit2', C.c_int, pointer, char, C.POINTER(char), C.c_int, pointer, uint, uint, C.POINTER(pointer))
        self.tu_cursor = bind('clang_getTranslationUnitCursor', Cursor, pointer)
        self.Visitor = C.CFUNCTYPE(uint, Cursor, Cursor, pointer)
        self.visit_children = bind('clang_visitChildren', uint, Cursor, self.Visitor, pointer)
        self.spelling = bind('clang_getCursorSpelling', CXString, Cursor)
        self.is_definition = bind('clang_isCursorDefinition', uint, Cursor)
        self.cursor_location = bind('clang_getCursorLocation', Location, Cursor)
        self.cursor_extent = bind('clang_getCursorExtent', Range, Cursor)
        self.range_start = bind('clang_getRangeStart', Location, Range)
        self.range_end = bind('clang_getRangeEnd', Location, Range)
        self.expansion_location = bind('clang_getExpansionLocation', None, Location, C.POINTER(pointer), C.POINTER(uint), C.POINTER(uint), C.POINTER(uint))
        self.file_name = bind('clang_getFileName', CXString, pointer)
        self.included_file = bind('clang_getIncludedFile', pointer, Cursor)
        self.InclusionVisitor = C.CFUNCTYPE(None, pointer, C.POINTER(Location), uint, pointer)
        self.get_inclusions = bind('clang_getInclusions', None, pointer, self.InclusionVisitor, pointer)
        self.find_includes = bind('clang_findIncludesInFile', C.c_int, pointer, pointer, CursorAndRangeVisitor)
        self.skipped_ranges = bind('clang_getAllSkippedRanges', C.POINTER(RangeList), pointer)
        self.dispose_ranges = bind('clang_disposeSourceRangeList', None, C.POINTER(RangeList))
        self.diagnostic_count = bind('clang_getNumDiagnostics', uint, pointer)
        self.get_diagnostic = bind('clang_getDiagnostic', pointer, pointer, uint)
        self.diagnostic_severity = bind('clang_getDiagnosticSeverity', uint, pointer)
        self.diagnostic_text = bind('clang_getDiagnosticSpelling', CXString, pointer)
        self.diagnostic_location = bind('clang_getDiagnosticLocation', Location, pointer)
        self.diagnostic_category = bind('clang_getDiagnosticCategory', uint, pointer)
        self.diagnostic_category_text = bind('clang_getDiagnosticCategoryText', CXString, pointer)
        self.diagnostic_option = bind('clang_getDiagnosticOption', CXString, pointer, pointer)
        self.dispose_diagnostic = bind('clang_disposeDiagnostic', None, pointer)
        self.dispose_tu = bind('clang_disposeTranslationUnit', None, pointer)

    def string(self, value):
        try:
            return (self.get_string(value) or b'').decode('utf-8', errors='replace')
        finally:
            self.dispose_string(value)


def proc_status_kb(field):
    try:
        with open('/proc/self/status') as handle:
            for line in handle:
                if line.startswith(field + ':'):
                    return int(line.split()[1])
    except OSError:
        pass
    return None


def reset_peak_rss():
    try:
        with open('/proc/self/clear_refs', 'w') as handle:
            handle.write('5')
        return True
    except OSError:
        return False


FNF_RE = re.compile(r"file not found")
DIRECTIVE_RE = re.compile(rb'\s*#\s*(include_next|include|import)\b[ \t]*(.?)')


def classify_fnf(spelling):
    """Include-resolution diagnostics. None = an ordinary error."""
    if spelling.startswith('expected "FILENAME" or <FILENAME>'):
        return 'macro_unexpanded'   # err_pp_expects_filename: '#include MACRO' whose macro is not defined here
    if not FNF_RE.search(spelling):
        return None
    if 'with <angled>' in spelling:
        return 'angled_recovered'   # err_pp_file_not_found_angled_include_not_fatal: the quoted lookup found it
    if 'did you mean' in spelling:
        return 'typo_recovered'     # err_pp_file_not_found_typo_not_fatal
    return 'missing'


def run_job(cl, index, job):
    inject = job.get('inject')
    if inject == 'hang':
        time.sleep(10 ** 6)
    if inject == 'crash':
        os.kill(os.getpid(), signal.SIGSEGV)
    root = job['root']
    main_name = job['file']
    want_bodies = job['want_bodies']
    rss_before = proc_status_kb('VmRSS')
    reset_ok = reset_peak_rss()
    t0 = time.monotonic()
    tu = C.c_void_p()
    encoded = [a.encode() for a in job['args']]
    argv = (C.c_char_p * len(encoded))(*encoded)
    code = cl.parse(index, main_name.encode(), argv, len(encoded), None, 0, job['options'], C.byref(tu))
    t1 = time.monotonic()
    result = {'parse_ms': round((t1 - t0) * 1000, 1), 'rss_before_kb': rss_before, 'peak_reset': reset_ok}
    if code != 0 or not tu.value:
        result.update(status='null_tu', error_code=code, peak_rss_kb=proc_status_kb('VmHWM'))
        if tu.value:
            cl.dispose_tu(tu)
        return result
    callback_errors = []
    names = {}

    def fname(file_ptr):
        if not file_ptr:
            return None
        name = names.get(file_ptr)
        if name is None:
            raw = cl.string(cl.file_name(file_ptr))
            if not raw.startswith('/'):
                name = raw
            elif '..' in raw.split('/'):
                # libclang's driver reports GCC headers as /../lib/gcc/x86_64-linux-gnu/13/../../../../include/...,
                # valid only through the /lib -> usr/lib symlink; a lexical normpath would give /include/...
                name = os.path.realpath(raw)
            else:
                name = os.path.normpath(raw)
            names[file_ptr] = name
        return name

    def exp(loc):
        f, line, col, off = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(loc, C.byref(f), C.byref(line), C.byref(col), C.byref(off))
        return fname(f.value), line.value, col.value, off.value

    def is_project(name):
        return bool(name) and (name == root or name.startswith(root + '/'))

    try:
        # 1. Entered files and their include chains (preprocessing order key).
        chains, entered, project_files = {}, [], []

        @cl.InclusionVisitor
        def inclusion_visitor(included, stack, depth, data):
            try:
                name = fname(included)
                if name in chains:
                    return
                if is_project(name):
                    project_files.append(included)
                chain = [exp(stack[k])[3] for k in range(depth - 1, -1, -1)]
                if depth and exp(stack[depth - 1])[0] != main_name:
                    chain.insert(0, -1)  # entered from the predefines buffer / command line (-include): before the main file
                chains[name] = chain
                entered.append(name)
            except Exception as error:  # never let an exception cross the C boundary
                callback_errors.append('inclusions: ' + repr(error))

        cl.get_inclusions(tu, inclusion_visitor, None)
        t2 = time.monotonic()

        # 2. Top-level InclusionDirective cursors (+ function-definition extents when wanted).
        raw_directives, extents, counts = [], collections.defaultdict(list), collections.Counter()
        use_find = job.get('directive_source') == 'find'

        def take_directive(cursor):
            name, line, col, off = exp(cl.cursor_location(cursor))
            if not is_project(name):
                counts['external_directives'] += 1
                return
            included = cl.included_file(cursor)
            raw_directives.append((name, line, col, off, cl.string(cl.spelling(cursor)), fname(included) if included else None))

        if use_find:
            # clang_findIncludesInFile: libclang filters the preprocessing record of one file in C++ and calls back
            # only for InclusionDirective cursors (instead of one Python callback per macro definition/expansion).
            @RangeVisitorFn
            def find_visitor(context, cursor, extent):
                try:
                    take_directive(cursor)
                except Exception as error:
                    callback_errors.append('find: ' + repr(error))
                return 1

            find_struct = CursorAndRangeVisitor(None, find_visitor)
            for file_ptr in project_files:
                code_find = cl.find_includes(tu, file_ptr, find_struct)
                if code_find != 0:
                    callback_errors.append('findIncludesInFile returned %d for %s' % (code_find, fname(file_ptr)))

        @cl.Visitor
        def visitor(cursor, parent, data):
            try:
                kind = cursor.kind
                if kind == K_INCLUSION_DIRECTIVE:
                    if not use_find:
                        take_directive(cursor)
                    return 1
                if kind in PP_KINDS:
                    counts['other_pp_cursors'] += 1
                    return 1
                counts['decl_cursors'] += 1
                if not want_bodies:
                    return 1
                if kind in FUNC_KINDS:
                    if cl.is_definition(cursor):
                        ext = cl.cursor_extent(cursor)
                        s, e = exp(cl.range_start(ext)), exp(cl.range_end(ext))
                        if is_project(s[0]) and s[0] == e[0]:
                            extents[s[0]].append((s[3], e[3]))
                    return 1
                if kind in CONTAINER_KINDS and is_project(exp(cl.cursor_location(cursor))[0]):
                    return 2
                return 1
            except Exception as error:
                callback_errors.append('visit: ' + repr(error))
                return 1

        if not use_find or want_bodies:
            cl.visit_children(cl.tu_cursor(tu), visitor, None)
        t3 = time.monotonic()

        texts = {}

        def line_text(name, off, col):
            if name not in texts:
                try:
                    with open(name, 'rb') as handle:
                        texts[name] = handle.read()
                except OSError:
                    texts[name] = b''
            data = texts[name]
            start = max(0, off - (col - 1))
            end = data.find(b'\n', start)
            while end > 0 and data[end - 1:end] == b'\\':
                end = data.find(b'\n', end + 1)
            return data[start:end if end >= 0 else len(data)][:400]

        directives = []
        for name, line, col, off, spelled, resolved in raw_directives:
            text = line_text(name, off, col)
            m = DIRECTIVE_RE.match(text)
            first = m.group(2) if m else b''
            delim = '<' if first == b'<' else '"' if first == b'"' else None
            if want_bodies:
                inside = any(s <= off <= e for s, e in extents.get(name, ()))
            else:
                inside = 'unknown'
            directives.append({'file': name, 'line': line, 'col': col, 'offset': off,
                               'kind': m.group(1).decode() if m else None, 'spelled': spelled, 'delim': delim,
                               'via_macro': bool(m) and delim is None, 'resolved': resolved,
                               'in_function_body': inside,
                               'pos': (chains[name] + [off]) if name in chains else None,
                               'text': text.decode('utf-8', errors='replace')[:200]})

        # 3. Diagnostics (errors and fatals; warnings only counted).
        diagnostics, external_errors, sev_counts = [], [], collections.Counter()
        unresolved_positions = []  # every missing / not-expanded include in the TU, any file (R0's "earlier")
        for k in range(cl.diagnostic_count(tu)):
            diag = cl.get_diagnostic(tu, k)
            try:
                severity = cl.diagnostic_severity(diag)
                sev_counts[str(severity)] += 1
                if severity < 3:
                    continue
                name, line, col, off = exp(cl.diagnostic_location(diag))
                spelling = cl.string(cl.diagnostic_text(diag))
                row = {'emit': k, 'file': name, 'line': line, 'col': col, 'offset': off, 'severity': severity,
                       'category': cl.string(cl.diagnostic_category_text(diag)), 'category_id': cl.diagnostic_category(diag),
                       'option': cl.string(cl.diagnostic_option(diag, None)), 'spelling': spelling[:500],
                       'file_not_found': classify_fnf(spelling),
                       'pos': (chains[name] + [off]) if name in chains else None}
                if row['file_not_found'] in ('missing', 'macro_unexpanded'):
                    unresolved_positions.append({'pos': row['pos'], 'emit': k, 'file': name, 'line': line})
                if name is None or is_project(name):
                    diagnostics.append(row)
                elif len(external_errors) < 20:
                    external_errors.append(row)
                else:
                    counts['external_errors_not_listed'] += 1
            finally:
                cl.dispose_diagnostic(diag)

        # 4. Skipped (inactive) preprocessor ranges in project files.
        skipped = []
        ranges = cl.skipped_ranges(tu)
        if ranges:
            try:
                for k in range(ranges.contents.count):
                    r = ranges.contents.ranges[k]
                    s, e = exp(cl.range_start(r)), exp(cl.range_end(r))
                    if is_project(s[0]):
                        skipped.append({'file': s[0], 'start_line': s[1], 'end_line': e[1]})
            finally:
                cl.dispose_ranges(ranges)
        t4 = time.monotonic()
        project_entered = [n for n in entered if is_project(n)]
        result.update(status='ok', error_code=0, inclusions=directives, diagnostics=diagnostics,
                      external_errors=external_errors, unresolved_positions=unresolved_positions, skipped_ranges=skipped,
                      entered_project=project_entered, entered_external_count=len(entered) - len(project_entered),
                      function_extents={n: len(v) for n, v in extents.items()} if want_bodies else None,
                      severity_counts=dict(sev_counts), cursor_counts=dict(counts), callback_errors=callback_errors[:20],
                      inclusions_ms=round((t2 - t1) * 1000, 1), visit_ms=round((t3 - t2) * 1000, 1),
                      collect_ms=round((t4 - t1) * 1000, 1))
    finally:
        cl.dispose_tu(tu)
    result['peak_rss_kb'] = proc_status_kb('VmHWM')
    result['worker_ms'] = round((time.monotonic() - t0) * 1000, 1)
    return result


def worker_main(lib_path):
    cl = Clang(lib_path)
    index = cl.create_index(0, 0)
    sys.stdout.write(json.dumps({'ready': True, 'version': cl.version, 'pid': os.getpid()}) + '\n')
    sys.stdout.flush()
    for line in sys.stdin:
        job = json.loads(line)
        try:
            result = run_job(cl, index, job)
        except Exception as error:
            result = {'status': 'worker_error', 'error': repr(error)[:500]}
        result['tu_index'] = job['tu_index']
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + '\n')
        sys.stdout.flush()


# ---------------------------------------------------------------------------------------------
# Parent: VFS, jobs, worker pool with per-TU timeout, resumable NDJSON.
# ---------------------------------------------------------------------------------------------
def build_vfs(root, excludes, file_list, max_bytes, path, overrides=None):
    overrides = overrides or {}
    tree = {'type': 'directory', 'name': root, 'contents': []}
    dirs = {'': tree}
    stats = collections.Counter()

    def add(rel):
        full = os.path.join(root, rel)
        try:
            size = os.path.getsize(full)
        except OSError:
            stats['unreadable'] += 1; return
        if size > max_bytes:
            stats['over_size'] += 1; return
        parent = ''
        for seg in rel.split('/')[:-1]:
            child = parent + '/' + seg if parent else seg
            if child not in dirs:
                dirs[child] = {'type': 'directory', 'name': seg, 'contents': []}
                dirs[parent]['contents'].append(dirs[child])
            parent = child
        if rel in overrides:
            full = overrides[rel]
            stats['overridden'] += 1
        dirs[parent]['contents'].append({'type': 'file', 'name': rel.split('/')[-1], 'external-contents': full})
        stats['files'] += 1

    if file_list:
        with open(file_list, encoding='utf-8') as handle:
            for line in handle:
                rel = line.strip().strip('/')
                if rel and not rel.startswith('../') and os.path.isfile(os.path.join(root, rel)):
                    add(rel)
    else:
        for current, subdirs, files in os.walk(root):
            subdirs[:] = sorted(d for d in subdirs if d != '.git' and os.path.join(current, d) not in excludes)
            for f in sorted(files):
                full = os.path.join(current, f)
                if os.path.isfile(full):
                    add(os.path.relpath(full, root))
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump({'version': 0, 'case-sensitive': True, 'use-external-names': False, 'fallthrough': False, 'roots': [tree]}, handle)
    return dict(stats)


def default_builtin_include():
    found = sorted(glob.glob('/usr/lib/gcc/x86_64-linux-gnu/*/include'), key=lambda p: [int(x) if x.isdigit() else 0 for x in p.split('/')[-2].split('.')])
    return found[-1] if found else None


class Slot:
    def __init__(self, number, worker_cmd, stderr_path):
        self.number, self.cmd, self.stderr_path = number, worker_cmd, stderr_path
        self.proc, self.buffer, self.job, self.sent_at, self.count, self.ready_info = None, b'', None, None, 0, None

    def start(self):
        self.stderr = open(self.stderr_path, 'wb')
        self.proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, cwd=os.path.dirname(self.stderr_path))
        self.buffer, self.count = b'', 0
        deadline = time.monotonic() + 30
        while b'\n' not in self.buffer:
            left = deadline - time.monotonic()
            r, _, _ = select.select([self.proc.stdout], [], [], max(0, left))
            if not r:
                self.kill(); raise RuntimeError('worker did not start within 30 s')
            data = os.read(self.proc.stdout.fileno(), 1 << 16)
            if not data:
                raise RuntimeError('worker exited during start: ' + self.stderr_tail())
            self.buffer += data
        line, self.buffer = self.buffer.split(b'\n', 1)
        self.ready_info = json.loads(line)

    def stderr_tail(self):
        try:
            with open(self.stderr_path, 'rb') as handle:
                return handle.read()[-600:].decode('utf-8', errors='replace')
        except OSError:
            return ''

    def kill(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()  # our own child, by pid
        if self.proc:
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        self.stderr.close()

    def send(self, job):
        self.job, self.sent_at = job, time.monotonic()
        self.proc.stdin.write((json.dumps(job) + '\n').encode())
        self.proc.stdin.flush()
        self.count += 1


def load_done(out_path, mode, retry_failed):
    done = set()
    if not os.path.exists(out_path):
        return done
    with open(out_path, 'rb') as handle:
        data = handle.read()
    for line in data.split(b'\n'):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get('mode') == mode and (not retry_failed or row.get('status') == 'ok'):
            done.add(row['tu_index'])
    if data and not data.endswith(b'\n'):
        with open(out_path, 'ab') as handle:
            handle.write(b'\n')
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    ap.add_argument('--print-arg-table', action='store_true', help='print the argument table (markdown) and exit')
    ap.add_argument('--db', help='compile_commands.json')
    ap.add_argument('--root', help='project root: files under it are project files (and form the VFS in light modes)')
    ap.add_argument('--mode', choices=sorted(MODES))
    ap.add_argument('--out', help='NDJSON output (appended; TUs already present for this mode are skipped)')
    ap.add_argument('--from', dest='start', type=int, default=0, help='first DB index (inclusive)')
    ap.add_argument('--to', dest='end', type=int, default=None, help='last DB index (exclusive)')
    ap.add_argument('--timeout', type=float, default=20.0, help='per-TU timeout in seconds (default 20)')
    ap.add_argument('--jobs', type=int, default=1, help='worker processes (default 1)')
    ap.add_argument('--budget-seconds', type=float, default=None, help='stop dispatching new TUs after this many seconds')
    ap.add_argument('--libclang', default=LIBCLANG_DEFAULT)
    ap.add_argument('--exclude-dir', action='append', default=[], help='directory under ROOT left out of the VFS (repeatable)')
    ap.add_argument('--file-list', help='VFS file list (paths relative to ROOT, one per line) instead of walking ROOT')
    ap.add_argument('--max-file-bytes', type=int, default=2 * 1024 * 1024, help='files larger than this are left out of the VFS (L12: 2 MiB)')
    ap.add_argument('--body-extents', choices=['auto', 'on', 'off'], default='auto',
                    help='record function-definition extents to flag includes inside bodies (auto: off in light, on otherwise)')
    ap.add_argument('--directive-source', choices=['visit', 'find'], default='visit',
                    help='visit: top-level clang_visitChildren (spec draft 11.4); find: clang_findIncludesInFile per entered project file')
    ap.add_argument('--strict-args', action='store_true', help='do not parse a TU that has unknown/rejected arguments (status args_rejected)')
    ap.add_argument('--builtin-include', default='auto', help="reference mode: -idirafter dir for compiler builtin headers ('auto' = newest GCC, 'none')")
    ap.add_argument('--recycle', type=int, default=200, help='restart a worker after this many TUs')
    ap.add_argument('--inject', action='append', default=[], help='self-test only: hang=SUBSTRING or crash=SUBSTRING of the TU path')
    ap.add_argument('--retry-failed', action='store_true', help='re-run TUs whose recorded status is not ok')
    ap.add_argument('--vfs-override', action='append', default=[],
                    help='measurement only: REL=PATH serves PATH under the project path REL in the VFS (fault injection without touching ROOT)')
    ap.add_argument('--tu-indices', help='measurement only: comma-separated DB indices to run (inside --from/--to)')
    a = ap.parse_args()
    if a.worker:
        worker_main(a.libclang)
        return
    if a.print_arg_table:
        print_arg_table()
        return
    if not (a.db and a.root and a.mode and a.out):
        ap.error('--db, --root, --mode and --out are required')
    mode = MODES[a.mode]
    root = os.path.realpath(a.root)
    out_path = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(a.db, encoding='utf-8') as handle:
        db = json.load(handle)
    end = len(db) if a.end is None else min(a.end, len(db))
    done = load_done(out_path, a.mode, a.retry_failed)
    want_bodies = (a.body_extents == 'on') or (a.body_extents == 'auto' and a.mode != 'light')
    extra = list(COMMON_EXTRA)
    vfs_stats, builtin = None, None
    if mode['nostdinc']:
        extra += ['-nostdinc', '-nostdinc++']
    if mode['vfs']:
        vfs_path = out_path + '.vfs.json'
        excludes = {os.path.normpath(os.path.join(root, e)) for e in a.exclude_dir}
        overrides = dict(x.split('=', 1) for x in a.vfs_override)
        vfs_stats = build_vfs(root, excludes, a.file_list, a.max_file_bytes, vfs_path, overrides)
        extra += ['-ivfsoverlay', vfs_path]
    else:
        builtin = default_builtin_include() if a.builtin_include == 'auto' else (None if a.builtin_include == 'none' else a.builtin_include)
        if builtin:
            extra += ['-idirafter', builtin]
    injects = [tuple(x.split('=', 1)) for x in a.inject]
    meta = {'scan_version': SCAN_VERSION, 'mode': a.mode, 'options': mode['options'], 'extra_args': extra,
            'body_extents': want_bodies, 'strict_args': a.strict_args, 'directive_source': a.directive_source}

    jobs, immediate = collections.deque(), []
    only = {int(x) for x in a.tu_indices.split(',') if x.strip()} if a.tu_indices else None
    for k in range(a.start, end):
        if k in done or (only is not None and k not in only):
            continue
        entry = db[k]
        filt = filter_arguments(entry, root, keep_outside_root=not mode['vfs'])
        base = {'mode': a.mode, 'tu_index': k, 'tu': filt['source'],
                'tu_rel': os.path.relpath(filt['source'], root) if filt['source'] and under(filt['source'], root) else None,
                'directory': entry.get('directory'), 'compiler': filt['compiler'],
                'arg_filter': {'kept_count': len(filt['kept']), 'kept': sorted(set(filt['kept'])), 'dropped': filt['dropped'], 'unknown': filt['unknown']}}
        if not filt['source']:
            immediate.append(dict(base, status='args_rejected', reason='invalid entry')); continue
        if mode['vfs'] and not under(filt['source'], root) and not under(os.path.realpath(filt['source']), root):
            immediate.append(dict(base, status='outside_root', reason='TU source is not under the project root (not in the VFS)')); continue
        if a.strict_args and filt['unknown']:
            immediate.append(dict(base, status='args_rejected', reason='unknown or rejected arguments')); continue
        inject = next((kind for kind, sub in injects if sub in filt['source']), None)
        tu_args = filt['args']
        if mode.get('raw'):
            tu_args = tu_args + [x for item in filt['dropped'] if item['table'] == 'ignore-and-record' for x in [item['flag']] + item['values']]
        jobs.append((base, {'tu_index': k, 'file': filt['source'], 'args': tu_args + extra, 'options': mode['options'],
                            'root': root, 'want_bodies': want_bodies, 'inject': inject, 'directive_source': a.directive_source}))

    out = open(out_path, 'a', encoding='utf-8')
    status_counts = collections.Counter()

    def emit(row):
        row.update(meta)
        out.write(json.dumps(row, ensure_ascii=False) + '\n')
        out.flush()
        status_counts[row['status']] += 1

    for row in immediate:
        emit(row)
    worker_cmd = [sys.executable, '-I', os.path.abspath(__file__), '--worker', '--libclang', a.libclang]
    slots = [Slot(n, worker_cmd, out_path + '.worker%d.stderr' % n) for n in range(max(1, a.jobs))]
    started = time.monotonic()
    meta_base = {}
    total = len(jobs)
    try:
        while True:
            over_budget = a.budget_seconds is not None and time.monotonic() - started > a.budget_seconds
            for s in slots:
                if s.job is None and jobs and not over_budget:
                    if s.proc is None or s.proc.poll() is not None or s.count >= a.recycle:
                        if s.proc is not None:
                            s.kill()
                        s.start()
                        meta_base['libclang'] = s.ready_info.get('version')
                    base, job = jobs.popleft()
                    s.base = base
                    try:
                        s.send(job)
                    except (BrokenPipeError, OSError):
                        pass  # the worker died; its stdout reaches EOF below and the TU is recorded as a crash
            busy = [s for s in slots if s.job is not None]
            if not busy:
                break
            now = time.monotonic()
            wait = max(0.0, min(s.sent_at + a.timeout - now for s in busy))
            readable, _, _ = select.select([s.proc.stdout for s in busy], [], [], wait)
            for s in busy:
                finished = None
                if s.proc.stdout in readable:
                    data = os.read(s.proc.stdout.fileno(), 1 << 20)
                    if data:
                        s.buffer += data
                        if b'\n' in s.buffer:
                            line, s.buffer = s.buffer.split(b'\n', 1)
                            finished = json.loads(line)
                    else:
                        try:
                            code = s.proc.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            code = None
                        finished = {'status': 'crash', 'exit_code': code,
                                    'signal': signal.Signals(-code).name if code is not None and code < 0 else None,
                                    'stderr_tail': s.stderr_tail()}
                        s.kill(); s.proc = None
                if finished is None and time.monotonic() - s.sent_at > a.timeout:
                    s.kill(); s.proc = None
                    finished = {'status': 'timeout', 'timeout_s': a.timeout}
                if finished is not None:
                    finished.pop('tu_index', None)
                    row = dict(s.base)
                    row.update(finished)
                    row['elapsed_ms'] = round((time.monotonic() - s.sent_at) * 1000, 1)
                    row['libclang'] = meta_base.get('libclang')
                    emit(row)
                    s.job = None
    finally:
        for s in slots:
            if s.proc is not None:
                try:
                    s.proc.stdin.close()
                except OSError:
                    pass
                s.kill()
            try:
                os.remove(s.stderr_path)
            except OSError:
                pass
        out.close()
    summary = {'mode': a.mode, 'db_entries': len(db), 'range': [a.start, end], 'already_done': len(done),
               'scheduled': total, 'not_dispatched': len(jobs), 'status_counts': dict(status_counts),
               'wall_s': round(time.monotonic() - started, 2), 'vfs': vfs_stats, 'builtin_include': builtin, 'extra_args': extra}
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
