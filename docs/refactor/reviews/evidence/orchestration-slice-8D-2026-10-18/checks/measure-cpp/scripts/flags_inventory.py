"""Argument inventory of a compile database, classified by the repository adapter's filter.

Usage: python3 -I flags_inventory.py <compile_commands.json> <workspace_root> <out.tsv>

The classification mirrors scripts/cpp-source-query.py compile_unit() (lines ~123-205 at
da633d89): kept / dropped / refused. "refused" means the adapter raises Unsupported, which
refuses the whole database, not just that flag. Path values of kept path options are checked
the way mapped() does: an absolute path outside the workspace refuses too.
"""
import json
import posixpath
import re
import shlex
import sys
from collections import defaultdict

DROP_WITH_VALUE = ['-o', '-MF', '-MT', '-MQ']
DROP_ALONE = ['-c', '-MMD', '-MD', '-MP', '-pipe']
VALUE_OPTS = ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U']
PATH_OPTS = ['-isystem', '-iquote', '-include', '-imacros', '-I']
KEEP_EXACT = ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti',
              '-fms-extensions', '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin',
              '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']
KEEP_RE = [r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', r'--target=[A-Za-z0-9_+.-]+', r'-O[0-3szg]', r'-g(?:[0-3]|dwarf-[2-5])?',
           r'-W(?:no-)?[A-Za-z0-9=-]+']
COMPILER_RE = r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?'


def under(path, root):
    path = posixpath.normpath(path)
    return path == root or path.startswith(root + '/')


def main(argv):
    db_path, root, out = argv[1], posixpath.normpath(argv[2]), argv[3]
    with open(db_path, encoding='utf-8') as fh:
        entries = json.load(fh)
    rows = {}

    def row(key):
        if key not in rows:
            rows[key] = {'occ': 0, 'tus': set(), 'values': defaultdict(int), 'joined': 0, 'separate': 0,
                         'standalone': 0, 'in_ws': set(), 'external': set(), 'relative': set(),
                         'status': set(), 'detail': set()}
        return rows[key]

    for n, entry in enumerate(entries):
        tu = entry['file']
        raw = entry.get('arguments') or shlex.split(entry['command'], posix=True)
        # entry-level checks
        r = row('(entry) directory')
        r['occ'] += 1; r['tus'].add(tu); r['values'][entry['directory']] += 1; r['standalone'] += 1
        if under(entry['directory'], root):
            r['status'].add('kept'); r['in_ws'].add(entry['directory'])
        else:
            r['status'].add('refused'); r['external'].add(entry['directory'])
            r['detail'].add('directory outside the mapped workspace (Compilation directory is outside mapped workspace)')
        r = row('(argv0) compiler')
        r['occ'] += 1; r['tus'].add(tu); r['values'][raw[0]] += 1; r['standalone'] += 1
        name = posixpath.basename(raw[0])
        if re.fullmatch(COMPILER_RE, name):
            r['status'].add('kept')
        else:
            r['status'].add('refused'); r['detail'].add('compiler wrapper not accepted')
        i = 1
        while i < len(raw):
            arg = raw[i]
            if any(t in arg for t in ['\n', '\r', '`', '$(', ';', '&&', '||']) or arg.startswith('@'):
                r = row('(shell syntax/response file)'); r['occ'] += 1; r['tus'].add(tu); r['values'][arg] += 1
                r['standalone'] += 1; r['status'].add('refused'); i += 1; continue
            if arg in DROP_WITH_VALUE:
                r = row(arg); r['occ'] += 1; r['tus'].add(tu); r['separate'] += 1
                if i + 1 < len(raw):
                    r['values'][raw[i + 1]] += 1
                r['status'].add('dropped'); i += 2; continue
            if arg in DROP_ALONE:
                r = row(arg); r['occ'] += 1; r['tus'].add(tu); r['standalone'] += 1; r['status'].add('dropped')
                i += 1; continue
            option = next((f for f in VALUE_OPTS if arg == f or (f in ['-I', '-D', '-U'] and arg.startswith(f))), None)
            if option:
                r = row(option); r['occ'] += 1; r['tus'].add(tu)
                if arg == option:
                    r['separate'] += 1; i += 1
                    value = raw[i] if i < len(raw) else ''
                else:
                    r['joined'] += 1; value = arg[len(option):]
                r['values'][value] += 1
                if option in PATH_OPTS:
                    if value.startswith('/'):
                        if under(value, root):
                            r['in_ws'].add(posixpath.normpath(value)); r['status'].add('kept')
                        else:
                            r['external'].add(posixpath.normpath(value)); r['status'].add('refused')
                            r['detail'].add('external absolute path value (External compilation paths require an explicitly readable in-workspace dependency)')
                    else:
                        r['relative'].add(value); r['status'].add('kept')
                        r['detail'].add('relative value mapped against the compile directory')
                else:
                    r['status'].add('kept')
                i += 1; continue
            if arg in ['-x', '-target', '--target']:
                r = row(arg); r['occ'] += 1; r['tus'].add(tu); r['separate'] += 1
                value = raw[i + 1] if i + 1 < len(raw) else ''
                r['values'][value] += 1
                ok = re.fullmatch(r'[A-Za-z0-9_+.-]+', value) and (arg != '-x' or value in ['c', 'c++'])
                r['status'].add('kept' if ok else 'refused'); i += 2; continue
            if any(re.fullmatch(p, arg) for p in KEEP_RE) or arg in KEEP_EXACT:
                r = row(arg); r['occ'] += 1; r['tus'].add(tu); r['standalone'] += 1; r['status'].add('kept')
                i += 1; continue
            if not arg.startswith('-'):
                full = posixpath.normpath(posixpath.join(entry['directory'], arg))
                if full == posixpath.normpath(posixpath.join(entry['directory'], entry['file'])):
                    r = row('(positional) source file'); r['occ'] += 1; r['tus'].add(tu); r['standalone'] += 1
                    r['status'].add('skipped (the source itself)'); i += 1; continue
                r = row('(positional) other'); r['occ'] += 1; r['tus'].add(tu); r['values'][arg] += 1
                r['standalone'] += 1; r['status'].add('refused'); i += 1; continue
            r = row(arg); r['occ'] += 1; r['tus'].add(tu); r['standalone'] += 1; r['status'].add('refused')
            r['detail'].add('option not in the filter (Unsupported compiler option; configuration was not silently discarded)')
            i += 1

    order = {'(argv0) compiler': 0, '(entry) directory': 1, '(positional) source file': 2}
    total = len(entries)
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\t'.join(['flag', 'form', 'occurrences', 'distinct_values', 'tus', 'tus_of_total',
                            'path_values_in_workspace', 'path_values_external', 'adapter', 'adapter_detail',
                            'value_examples']) + '\n')
        for key in sorted(rows, key=lambda k: (order.get(k, 9), -len(rows[k]['tus']), k)):
            r = rows[key]
            form = []
            if r['joined']:
                form.append('joined:%d' % r['joined'])
            if r['separate']:
                form.append('separate:%d' % r['separate'])
            if r['standalone'] and not form:
                form.append('no value')
            values = sorted(r['values'].items(), key=lambda kv: -kv[1])
            examples = ' | '.join(v for v, _ in values[:4])
            if len(examples) > 300:
                examples = examples[:297] + '...'
            status = '+'.join(sorted(r['status']))
            fh.write('\t'.join([key, ','.join(form), str(r['occ']), str(len(r['values'])), str(len(r['tus'])),
                                '%d/%d' % (len(r['tus']), total), str(len(r['in_ws'])), str(len(r['external'])),
                                status, '; '.join(sorted(r['detail'])), examples]) + '\n')
    print('entries', total, 'rows', len(rows))
    refused = sorted(k for k in rows if 'refused' in rows[k]['status'])
    print('refused keys:', ', '.join(refused))


if __name__ == '__main__':
    main(sys.argv)
