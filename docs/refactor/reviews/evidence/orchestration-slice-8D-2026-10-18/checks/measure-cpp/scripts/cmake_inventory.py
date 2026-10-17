"""Inventory a compile_commands.json against a source tree and a build tree.

Usage: python3 -I cmake_inventory.py <compile_commands.json> <source_root> <build_root> <out_dir> <flags_tsv>

Reads only; never executes anything from the project. Outputs:
  <out_dir>/summary.json, <out_dir>/includes.ndjson (per-TU include scan),
  <flags_tsv> (argument inventory with the repository adapter's verdicts).
"""
import collections
import json
import os
import posixpath
import re
import shlex
import sys

cc_path, SRC, BLD, OUT, FLAGS_TSV = sys.argv[1:6]
SRC = os.path.realpath(SRC)
BLD = os.path.realpath(BLD)
os.makedirs(OUT, exist_ok=True)
db = json.load(open(cc_path, encoding='utf-8'))

C_EXT = {'.c'}
CXX_EXT = {'.cc', '.cpp', '.cxx', '.c++', '.C'}
HDR_EXT = {'.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.ipp', '.tcc', '.txx', '.inc', '.def'}


def scope(path):
    p = os.path.realpath(path)
    if p == SRC or p.startswith(SRC + '/'):
        return 'src'
    if p == BLD or p.startswith(BLD + '/'):
        return 'build'
    return 'other'


# ---------------------------------------------------------------- tree facts
def walk_tree(root):
    by_ext = collections.Counter()
    bytes_by_ext = collections.Counter()
    for d, dirs, files in os.walk(root):
        for f in files:
            ext = os.path.splitext(f)[1]
            if f.endswith('.h.in') or f.endswith('.hxx.in') or f.endswith('.hpp.in'):
                ext = '.h*.in'
            by_ext[ext] += 1
            try:
                bytes_by_ext[ext] += os.path.getsize(os.path.join(d, f))
            except OSError:
                pass
    return by_ext, bytes_by_ext


src_ext, src_bytes = walk_tree(SRC)
bld_ext, bld_bytes = walk_tree(BLD)

# ---------------------------------------------------------------- adapter simulation
SEP_ADAPTER_DROP = ['-o', '-MF', '-MT', '-MQ']
BARE_ADAPTER_DROP = ['-c', '-MMD', '-MD', '-MP', '-pipe']
ADAPTER_OPTS = ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U']
ADAPTER_BARE_KEEP = ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti',
                     '-fms-extensions', '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin',
                     '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']
COMPILER_RE = re.compile(r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?')


def adapter_verdict(raw, i, source_abs, directory):
    """Return (verdict, consumed, detail) for raw[i] following scripts/cpp-source-query.py compile_unit.

    Path checks use base = the source root (the workspace is the source tree)."""
    arg = raw[i]
    if any(t in arg for t in ['\n', '\r', '`', '$(', ';', '&&', '||']) or arg.startswith('@'):
        return 'reject-shell', 1, ''
    if arg in SEP_ADAPTER_DROP:
        return 'drop', 2, ''
    if arg in BARE_ADAPTER_DROP:
        return 'drop', 1, ''
    option = next((f for f in ADAPTER_OPTS if arg == f or (f in ['-I', '-D', '-U'] and arg.startswith(f))), None)
    if option:
        if arg == option:
            if i + 1 >= len(raw):
                return 'reject-invalid', 1, 'missing value'
            value, consumed = raw[i + 1], 2
        else:
            value, consumed = arg[len(option):], 1
        if option in ['-D', '-U']:
            return 'keep', consumed, ''
        p = value if value.startswith('/') else posixpath.normpath(posixpath.join(directory, value))
        sc = scope(p)
        if sc != 'src':
            return 'reject-path', consumed, sc
        if option in ['-include', '-imacros'] and not os.path.isfile(p):
            return 'reject-path', consumed, 'forced include missing'
        return 'keep', consumed, ''
    if arg in ['-x', '-target', '--target']:
        if i + 1 >= len(raw) or not re.fullmatch(r'[A-Za-z0-9_+.-]+', raw[i + 1]) or (arg == '-x' and raw[i + 1] not in ['c', 'c++']):
            return 'reject-invalid', 2, ''
        return 'keep', 2, ''
    if (re.fullmatch(r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', arg) or re.fullmatch(r'--target=[A-Za-z0-9_+.-]+', arg)
            or re.fullmatch(r'-O[0-3szg]', arg) or re.fullmatch(r'-g(?:[0-3]|dwarf-[2-5])?', arg)
            or re.fullmatch(r'-W(?:no-)?[A-Za-z0-9=-]+', arg)):
        return 'keep', 1, ''
    if arg in ADAPTER_BARE_KEEP:
        return 'keep', 1, ''
    if not arg.startswith('-'):
        p = arg if arg.startswith('/') else posixpath.normpath(posixpath.join(directory, arg))
        if os.path.realpath(p) == os.path.realpath(source_abs):
            return 'drop', 1, 'source'
        return 'reject-unknown', 1, 'positional'
    return 'reject-unknown', 1, ''


# ---------------------------------------------------------------- normaliser
SEPARATE = {'-o', '-MF', '-MT', '-MQ', '-I', '-D', '-U', '-isystem', '-iquote', '-idirafter', '-include', '-imacros',
            '-x', '-target', '-isysroot', '-Xclang', '-arch', '--param', '-Xlinker', '-L', '-iprefix', '-iwithprefix',
            '-MJ', '-Xpreprocessor', '-Xassembler', '-include-pch', '-iwithsysroot'}
JOINED_PREFIX = ['-isystem', '-iquote', '-idirafter', '-I', '-D', '-U', '-L', '-l']
PATH_FLAGS = {'-I', '-isystem', '-iquote', '-idirafter', '-include', '-imacros', '-o', '-MF', '-include-pch'}


def normalise(raw, i, source_abs):
    arg = raw[i]
    if arg in SEPARATE:
        return arg, 'separate:1', (raw[i + 1] if i + 1 < len(raw) else None), 2
    for p in JOINED_PREFIX:
        if arg.startswith(p) and arg != p:
            return p, 'joined', arg[len(p):], 1
    if arg.startswith('-') and '=' in arg:
        k = arg.index('=')
        return arg[:k + 1], 'joined=', arg[k + 1:], 1
    if arg.startswith('-O') and len(arg) <= 3:
        return '-O', 'joined', arg[2:], 1
    if arg.startswith('-'):
        return arg, 'bare', None, 1
    return '(positional)', 'source' if os.path.realpath(arg) == os.path.realpath(source_abs) else 'other', arg, 1


inv = {}
tu_rows = []
compilers = collections.Counter()
lang = collections.Counter()
ext_count = collections.Counter()
tu_level = collections.Counter()
file_seen = collections.Counter()
directories_scope = collections.Counter()
main_bytes = 0
main_files = set()

for entry in db:
    directory = entry['directory']
    file_abs = entry['file'] if entry['file'].startswith('/') else posixpath.normpath(posixpath.join(directory, entry['file']))
    raw = entry.get('arguments') or shlex.split(entry['command'], posix=True)
    compiler = raw[0]
    compilers[compiler] += 1
    ext = os.path.splitext(file_abs)[1]
    ext_count[ext] += 1
    lang['C' if ext in C_EXT else 'C++' if ext in CXX_EXT else 'other:' + ext] += 1
    file_seen[file_abs] += 1
    directories_scope[scope(directory)] += 1
    if file_abs not in main_files:
        main_files.add(file_abs)
        try:
            main_bytes += os.path.getsize(file_abs)
        except OSError:
            pass
    if not COMPILER_RE.fullmatch(posixpath.basename(compiler)):
        tu_level['reject: compiler name'] += 1
    if scope(directory) != 'src':
        tu_level['reject: compilation directory outside source root (' + scope(directory) + ')'] += 1
    if scope(file_abs) != 'src':
        tu_level['reject: source outside source root (' + scope(file_abs) + ')'] += 1
    i = 1
    tu_verdicts = collections.Counter()
    first_reject = None
    search = {'quote': [], 'angle': [], 'forced': []}
    while i < len(raw):
        name, form, value, consumed = normalise(raw, i, file_abs)
        verdict, _, detail = adapter_verdict(raw, i, file_abs, directory)
        tu_verdicts[verdict] += 1
        if verdict.startswith('reject') and first_reject is None:
            first_reject = raw[i] + ((' ' + raw[i + 1]) if consumed == 2 and i + 1 < len(raw) else '') + ((' [' + detail + ']') if detail else '')
        key = (name, form)
        row = inv.setdefault(key, {'tus': set(), 'occ': 0, 'values': collections.Counter(), 'verdicts': collections.Counter(),
                                   'scopes': collections.Counter(), 'compilers': collections.Counter()})
        row['tus'].add(len(tu_rows))
        row['occ'] += 1
        row['compilers'][posixpath.basename(compiler)] += 1
        if value is not None:
            row['values'][value] += 1
        row['verdicts'][verdict + ((':' + detail) if detail and verdict == 'reject-path' else '')] += 1
        if name in PATH_FLAGS and value is not None and name != '(positional)':
            p = value if value.startswith('/') else posixpath.normpath(posixpath.join(directory, value))
            row['scopes'][scope(p)] += 1
            if name in ('-I', '-iquote'):
                search['quote' if name == '-iquote' else 'angle'].append(p)
            elif name in ('-isystem', '-idirafter'):
                search['angle'].append(p)
            elif name in ('-include', '-imacros'):
                search['forced'].append(p)
        i += consumed
    tu_rows.append({'file': file_abs, 'directory': directory, 'compiler': compiler, 'verdicts': dict(tu_verdicts),
                    'first_reject': first_reject, 'search': search})

# ---------------------------------------------------------------- write flags TSV
def adapter_summary(verdicts):
    keys = sorted(verdicts)
    if all(k == 'keep' for k in keys):
        return 'keeps'
    if all(k == 'drop' or k.startswith('drop') for k in keys):
        return 'drops'
    if any(k == 'reject-unknown' for k in keys):
        return 'rejects-unknown'
    if any(k.startswith('reject-path') for k in keys):
        return 'keeps-option-rejects-path' if not any(k == 'reject-unknown' for k in keys) else 'mixed'
    if any(k.startswith('reject') for k in keys):
        return 'rejects-' + '+'.join(k[len('reject-'):] for k in keys if k.startswith('reject'))
    return 'mixed'


with open(FLAGS_TSV, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\t'.join(['flag', 'value_form', 'following_values', 'tus', 'occurrences', 'distinct_values', 'adapter',
                        'adapter_detail', 'path_scope', 'compilers', 'examples']) + '\n')
    for (name, form), row in sorted(inv.items(), key=lambda kv: (-len(kv[1]['tus']), kv[0])):
        following = '1' if form == 'separate:1' else '0'
        examples = [v for v, _ in row['values'].most_common(4)]
        examples = [('<build>' + v[len(BLD):]) if v.startswith(BLD) else ('<src>' + v[len(SRC):]) if v.startswith(SRC) else v for v in examples]
        fh.write('\t'.join([name, form, following, str(len(row['tus'])), str(row['occ']), str(len(row['values'])),
                            adapter_summary(row['verdicts']),
                            ' '.join('%s=%d' % kv for kv in sorted(row['verdicts'].items())),
                            ' '.join('%s=%d' % kv for kv in sorted(row['scopes'].items())),
                            ' '.join('%s=%d' % kv for kv in sorted(row['compilers'].items())),
                            ' | '.join(e[:80] for e in examples)]) + '\n')

# ---------------------------------------------------------------- build-time generated files (build.make rule targets)
build_targets = set()
custom_outputs = set()
for d, dirs, files in os.walk(BLD):
    if 'build.make' in files:
        text = open(os.path.join(d, 'build.make'), encoding='utf-8', errors='replace').read()
        for m in re.finditer(r'^([^#\s%.][^:\n]*?):\s', text, re.M):
            t = m.group(1).strip()
            if re.search(r'\.(o|a|so|o\.d|i|s)$', t) or t.endswith('/build') or t.endswith('/clean') or t.endswith('/depend') or t.endswith('/requires'):
                continue
            build_targets.add(t)
        # custom command outputs: rules followed by a cmake_echo_color "Generating..." or a command block in the build tree
        for m in re.finditer(r'^([^#\s%.][^:\n]*?):[^\n]*\n((?:\t[^\n]*\n)+)', text, re.M):
            t = m.group(1).strip()
            body = m.group(2)
            if re.search(r'\.(o|a|so|i|s)$', t) or t.startswith('bin/') or 'Linking' in body:
                continue
            if 'cmake_echo_color' in body or 'Generating' in body:
                custom_outputs.add(t)


def abs_build(t):
    return t if t.startswith('/') else os.path.normpath(os.path.join(BLD, t))


custom_info = []
for t in sorted(custom_outputs):
    p = abs_build(t)
    custom_info.append({'target': t, 'exists_after_configure': os.path.exists(p), 'scope': scope(p)})
custom_by_base = collections.defaultdict(list)
for c in custom_info:
    custom_by_base[posixpath.basename(c['target'])].append(c)

# ---------------------------------------------------------------- regex include closure per TU (all branches, no system headers)
INC_RE = re.compile(r'^[ \t]*#[ \t]*(include_next|include|import)[ \t]*([<"])([^>"\n]+)[>"]', re.M)
MACRO_INC_RE = re.compile(r'^[ \t]*#[ \t]*(include|include_next|import)[ \t]+([A-Za-z_][A-Za-z0-9_]*)', re.M)
COMMENT_RE = re.compile(r'/\*.*?\*/|//[^\n]*', re.S)
parsed_cache = {}


def directives(path):
    if path not in parsed_cache:
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            parsed_cache[path] = ([], [])
            return parsed_cache[path]
        text = COMMENT_RE.sub(lambda m: '\n' * m.group(0).count('\n'), text)
        parsed_cache[path] = ([(m.group(1), m.group(2), m.group(3).strip()) for m in INC_RE.finditer(text)],
                              [m.group(2) for m in MACRO_INC_RE.finditer(text)])
    return parsed_cache[path]


exists_cache = {}


def isfile(p):
    if p not in exists_cache:
        exists_cache[p] = os.path.isfile(p)
    return exists_cache[p]


build_includes = collections.Counter()      # resolved into build tree (exist after configure)
build_inc_files = set()
unresolved = collections.Counter()
unresolved_class = collections.Counter()
unresolved_examples = collections.defaultdict(set)
macro_includes = collections.Counter()
headers_reached = set()
tus_with_build_inc = 0
tus_with_buildtime_missing = 0
buildtime_missing = collections.Counter()
unresolved_class_distinct = collections.Counter()
unresolved_class_tus = collections.Counter()
files_reached_hist = []
SYSTEM_DIRS = ['/usr/include', '/usr/include/x86_64-linux-gnu', '/usr/include/c++/13', '/usr/include/x86_64-linux-gnu/c++/13',
               '/usr/lib/gcc/x86_64-linux-gnu/13/include', '/usr/local/include']
src_basenames = collections.defaultdict(list)
for d, dirs, files in os.walk(SRC):
    for f in files:
        src_basenames[f].append(os.path.join(d, f))

with open(os.path.join(OUT, 'includes.ndjson'), 'w', encoding='utf-8') as nd:
    for t in tu_rows:
        quote_dirs = t['search']['quote']
        angle_dirs = t['search']['angle']
        seen = set()
        stack = [t['file']] + [p for p in t['search']['forced']]
        tu_build, tu_unres, tu_bt, tu_classes = set(), set(), set(), set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            incs, macros = directives(cur)
            for m in macros:
                macro_includes[m] += 1
            for kind, delim, spelled in incs:
                cands = ([posixpath.dirname(cur)] if delim == '"' else []) + (quote_dirs if delim == '"' else []) + angle_dirs
                hit = None
                for dd in cands:
                    p = posixpath.normpath(posixpath.join(dd, spelled))
                    if isfile(p):
                        hit = p
                        break
                if hit:
                    if scope(hit) == 'build':
                        tu_build.add(hit)
                    if hit != t['file']:
                        headers_reached.add(hit)
                    stack.append(hit)
                else:
                    base = posixpath.basename(spelled)
                    bt = [c for c in custom_by_base.get(base, []) if c['target'].endswith(spelled) or posixpath.basename(c['target']) == base]
                    if bt:
                        cls = 'build-time generated (custom command output)'
                        tu_bt.add(spelled)
                        buildtime_missing[spelled] += 1
                    elif any(isfile(posixpath.join(sd, spelled)) for sd in SYSTEM_DIRS):
                        cls = delim + ' host system header (excluded by -nostdinc)'
                    elif '@' in spelled:
                        cls = delim + ' configure-template placeholder (reached through a .in file under #if 0)'
                    elif any(p.endswith('/' + spelled) for p in src_basenames.get(base, [])):
                        cls = delim + ' spelled path exists elsewhere in source tree (not on this TU search path)'
                    else:
                        cls = delim + ' nowhere on host (other platform / disabled feature / build-only)'
                    if (delim, spelled) not in unresolved:
                        unresolved_class_distinct[cls] += 1
                    unresolved[(delim, spelled)] += 1
                    unresolved_class[cls] += 1
                    tu_classes.add(cls)
                    if len(unresolved_examples[cls]) < 15:
                        unresolved_examples[cls].add(delim + spelled)
                    tu_unres.add(delim + spelled)
        for h in tu_build:
            build_includes[h] += 1
            build_inc_files.add(h)
        tus_with_build_inc += bool(tu_build)
        tus_with_buildtime_missing += bool(tu_bt)
        for cls in tu_classes:
            unresolved_class_tus[cls] += 1
        if not tu_unres:
            unresolved_class_tus['(TU with no unresolved include)'] += 1
        files_reached_hist.append(len(seen))
        nd.write(json.dumps({'file': t['file'], 'files_reached': len(seen), 'build_tree_includes': sorted(tu_build),
                             'unresolved': sorted(tu_unres), 'buildtime_missing': sorted(tu_bt)}) + '\n')

reached_by_scope = collections.Counter(scope(h) for h in headers_reached)
hdr_src = sum(v for k, v in src_ext.items() if k in HDR_EXT)

summary = {
    'tu_count': len(db),
    'distinct_source_files': len(file_seen),
    'sources_listed_more_than_once': {k: v for k, v in file_seen.items() if v > 1},
    'tu_by_language': dict(lang),
    'tu_by_extension': dict(ext_count),
    'compilers': dict(compilers),
    'compilation_directory_scope': dict(directories_scope),
    'tu_main_source_bytes': main_bytes,
    'source_tree_files_by_ext_top': dict(src_ext.most_common(40)),
    'source_tree_bytes_by_ext_top': {k: src_bytes[k] for k, _ in src_ext.most_common(40)},
    'source_tree_c_cxx_bytes': sum(src_bytes[k] for k in C_EXT | CXX_EXT),
    'source_tree_header_files': hdr_src,
    'source_tree_header_bytes': sum(src_bytes[k] for k in HDR_EXT),
    'source_tree_header_by_ext': {k: src_ext[k] for k in HDR_EXT if src_ext[k]},
    'source_tree_header_templates_in': src_ext['.h*.in'],
    'build_tree_header_files_after_configure': {k: bld_ext[k] for k in HDR_EXT if bld_ext[k]},
    'headers_reached_by_regex_scan': dict(reached_by_scope),
    'build_tree_files_included_resolved': len(build_inc_files),
    'build_tree_files_included_top': [[h.replace(BLD, '<build>'), n] for h, n in build_includes.most_common(30)],
    'tus_including_build_tree_files': tus_with_build_inc,
    'custom_command_outputs': len(custom_info),
    'custom_command_outputs_existing_after_configure': sum(c['exists_after_configure'] for c in custom_info),
    'custom_command_outputs_list': [[c['target'], c['exists_after_configure']] for c in custom_info],
    'tus_including_buildtime_generated_missing': tus_with_buildtime_missing,
    'buildtime_generated_includes_missing': dict(buildtime_missing),
    'unresolved_include_classes': dict(unresolved_class),
    'unresolved_include_classes_distinct_spellings': dict(unresolved_class_distinct),
    'unresolved_include_classes_tus': dict(unresolved_class_tus),
    'files_reached_per_tu': {'min': min(files_reached_hist), 'median': sorted(files_reached_hist)[len(files_reached_hist) // 2],
                             'max': max(files_reached_hist)},
    'tu_main_files_in_build_tree': [[f.replace(BLD, '<build>'), os.path.isfile(f)] for f in sorted(main_files) if scope(f) == 'build'],
    'tu_main_files_missing': [f for f in sorted(main_files) if not os.path.isfile(f)],
    'include_dirs_in_build_tree': sorted({p.replace(BLD, '<build>') + (' [exists]' if os.path.isdir(p) else ' [MISSING]')
                                          for r in tu_rows for p in r['search']['angle'] + r['search']['quote'] if scope(p) == 'build'}),
    'include_dirs_outside': sorted({p for r in tu_rows for p in r['search']['angle'] + r['search']['quote'] if scope(p) == 'other'}),
    'forced_includes': sorted({p for r in tu_rows for p in r['search']['forced']}),
    'unresolved_examples': {k: sorted(v) for k, v in unresolved_examples.items()},
    'unresolved_distinct': len(unresolved),
    'macro_includes': dict(macro_includes),
    'adapter_tu_level': dict(tu_level),
    'adapter_db_level': ['reject: more than 512 translation units'] if len(db) > 512 else [],
    'adapter_first_reject_examples': collections.Counter(r['first_reject'].split(' ')[0] if r['first_reject'] else None for r in tu_rows).most_common(15),
    'tus_without_any_arg_reject': sum(1 for r in tu_rows if not r['first_reject']),
}
json.dump(summary, open(os.path.join(OUT, 'summary.json'), 'w', encoding='utf-8'), indent=1)
print(json.dumps({k: summary[k] for k in ['tu_count', 'distinct_source_files', 'tu_by_language', 'tu_by_extension', 'compilers',
                                          'compilation_directory_scope', 'tu_main_source_bytes', 'source_tree_c_cxx_bytes',
                                          'source_tree_header_files', 'source_tree_header_bytes', 'source_tree_header_by_ext',
                                          'source_tree_header_templates_in', 'build_tree_header_files_after_configure',
                                          'headers_reached_by_regex_scan', 'build_tree_files_included_resolved',
                                          'tus_including_build_tree_files', 'custom_command_outputs',
                                          'custom_command_outputs_existing_after_configure', 'custom_command_outputs_list',
                                          'tus_including_buildtime_generated_missing', 'buildtime_generated_includes_missing',
                                          'unresolved_include_classes', 'unresolved_include_classes_distinct_spellings',
                                          'unresolved_include_classes_tus', 'files_reached_per_tu', 'tu_main_files_in_build_tree',
                                          'tu_main_files_missing', 'include_dirs_in_build_tree', 'include_dirs_outside',
                                          'forced_includes', 'unresolved_distinct', 'macro_includes',
                                          'adapter_tu_level', 'adapter_db_level', 'adapter_first_reject_examples',
                                          'tus_without_any_arg_reject']}, indent=1))
