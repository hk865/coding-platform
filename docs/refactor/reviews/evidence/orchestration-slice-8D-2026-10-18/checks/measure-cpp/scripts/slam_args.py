#!/usr/bin/env python3
"""Argument check of the SLAM compile database (task g).

Run only as: python3 -I slam_args.py DB ROOT OUT.json
1. The repository adapter's filter (scripts/cpp-source-query.py compile_unit(), lines ~123-205 at da633d89),
   re-implemented without raising: per TU, every argument it would refuse ("Unsupported compiler option"),
   every path value it would refuse (outside the workspace), and the directory check.
2. The prototype's tables (light_include_scan.filter_arguments, imported from this folder): per TU what is kept,
   ignored-and-recorded (with values that follow) and unknown.
"""
import collections
import json
import os
import posixpath
import re
import shlex
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import light_include_scan as L  # noqa: E402

KEEP_EXACT = ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti', '-fms-extensions',
              '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin', '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']
KEEP_RE = [r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', r'--target=[A-Za-z0-9_+.-]+', r'-O[0-3szg]', r'-g(?:[0-3]|dwarf-[2-5])?', r'-W(?:no-)?[A-Za-z0-9=-]+']


def adapter_check(entry, root, source_paths):
    refusals = []  # (kind, detail)
    directory, file = entry['directory'], entry['file']
    physical = posixpath.normpath(posixpath.join(directory, file))
    matches = [p for p in source_paths if physical.endswith('/' + p)]
    base = None
    if len(matches) != 1:
        refusals.append(('source', 'Absolute compilation source cannot map uniquely'))
    else:
        base = physical[:-len(matches[0])].rstrip('/')
        d = posixpath.normpath(directory)
        if d != base and not d.startswith(base + '/'):
            refusals.append(('directory', 'Compilation directory is outside mapped workspace'))

    def mapped(value):
        if value.startswith('/'):
            if base is None or (value != base and not value.startswith(base + '/')):
                refusals.append(('external-path', value))
                return
            rel = posixpath.normpath(value[len(base):].strip('/') or '.')
            if rel == '..' or rel.startswith('../'):
                refusals.append(('escaping-path', value))

    raw = entry.get('arguments') or shlex.split(entry['command'], posix=True)
    if len(raw) > 512:
        refusals.append(('argv', 'more than 512 arguments'))
    if not re.fullmatch(r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?', posixpath.basename(raw[0])):
        refusals.append(('compiler', raw[0]))
    i = 1
    while i < len(raw):
        arg = raw[i]
        if any(t in arg for t in ['\n', '\r', '`', '$(', ';', '&&', '||']) or arg.startswith('@'):
            refusals.append(('shell', arg)); i += 1; continue
        if arg in ['-o', '-MF', '-MT', '-MQ']:
            i += 2; continue
        if arg in ['-c', '-MMD', '-MD', '-MP', '-pipe']:
            i += 1; continue
        option = next((f for f in ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U'] if arg == f or (f in ['-I', '-D', '-U'] and arg.startswith(f))), None)
        if option:
            if arg == option:
                i += 1
                value = raw[i] if i < len(raw) else ''
            else:
                value = arg[len(option):]
            if option not in ['-D', '-U']:
                mapped(value)
        elif arg in ['-x', '-target', '--target']:
            i += 1
        elif any(re.fullmatch(r, arg) for r in KEEP_RE) or arg in KEEP_EXACT:
            pass
        elif not arg.startswith('-'):
            pass
        else:
            refusals.append(('unsupported-option', arg))
        i += 1
    return refusals


def main():
    db_path, root, out = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3]
    db = json.load(open(db_path, encoding='utf-8'))
    source_paths = []
    for current, dirs, files in os.walk(root):
        for f in files:
            if re.search(r'\.(c|cc|cpp|cxx|C)$', f):
                source_paths.append(os.path.relpath(os.path.join(current, f), root))
    per_tu, unsupported_tus, kinds_tus = [], collections.Counter(), collections.Counter()
    proto_dropped, proto_kept, proto_unknown = collections.Counter(), collections.Counter(), collections.Counter()
    proto_dropped_values = {}
    for k, entry in enumerate(db):
        refusals = adapter_check(entry, root, source_paths)
        options = sorted({d for kind, d in refusals if kind == 'unsupported-option'})
        for o in options:
            unsupported_tus[o] += 1
        for kind in {kind for kind, _ in refusals}:
            kinds_tus[kind] += 1
        filt = L.filter_arguments(entry, root, keep_outside_root=False)
        for x in set(filt['kept']):
            proto_kept[x] += 1
        for item in filt['dropped']:
            key = (item['flag'], item['table'], item['affects'])
            proto_dropped[key] += 1
            proto_dropped_values[key] = len(item['values'])
        for item in filt['unknown']:
            proto_unknown[item['flag']] += 1
        per_tu.append({'tu': os.path.relpath(os.path.join(entry['directory'], entry['file']), root) if entry['file'].startswith(root) else entry['file'],
                       'argc': len(entry['arguments']), 'unsupported_options': options,
                       'external_paths': sum(1 for kind, _ in refusals if kind == 'external-path'),
                       'directory_refused': any(kind == 'directory' for kind, _ in refusals)})
    fail_draft = [t for t in per_tu if t['unsupported_options']]
    result = {
        'tus': len(db),
        'adapter_refusal_kinds_by_tus': dict(kinds_tus),
        'adapter_unsupported_options_by_tus': dict(unsupported_tus.most_common()),
        'tus_with_unsupported_option': len(fail_draft),
        'tus_without_unsupported_option': [t['tu'] for t in per_tu if not t['unsupported_options']],
        'distinct_unsupported_option_sets': dict(collections.Counter(' '.join(t['unsupported_options']) for t in per_tu)),
        'prototype_kept_by_tus': dict(proto_kept.most_common()),
        'prototype_dropped_occurrences': [{'flag': f, 'table': t, 'affects': a, 'values_that_follow': proto_dropped_values[(f, t, a)], 'occurrences': n}
                                          for (f, t, a), n in proto_dropped.most_common()],
        'prototype_unknown_by_occurrence': dict(proto_unknown),
        'per_tu': per_tu,
    }
    json.dump(result, open(out, 'w', encoding='utf-8'), indent=1)
    print(json.dumps({k: v for k, v in result.items() if k != 'per_tu'}, indent=1))
    for t in per_tu:
        print(t)


if __name__ == '__main__':
    main()
