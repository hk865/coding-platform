#!/usr/bin/env python3
"""Inventory of runtime / non-include dependencies in libuv 1.48.0 that the light #include scan cannot see, and how
much of each is already covered by a light-scan edge (file pair, or directory pair).

Run only as:  python3 -I uv_runtime_inventory.py ROOT A-eval.json OUT.json OUT.txt
ROOT is read as text only (regular expressions); nothing in it is executed or imported.
Kinds (those that apply to a C library; ROS kinds do not apply and are counted as 0):
  dl_load      dlopen / LoadLibrary* / GetModuleHandle* / uv_dlopen calls
  dl_sym       dlsym / GetProcAddress / uv_dlsym calls (symbol by name)
  registry     test/benchmark task tables: *_ENTRY(name) in test-list.h / benchmark-list.h -> the file with *_IMPL(name)
  self_spawn   a child process of the test runner selected by a string ("spawn_helper1"): literal in a test file ->
               the dispatcher in run-tests.c / run-benchmarks.c (strcmp(argv[1], "...")) that calls the helper
  fixture      string literals naming files under test/fixtures (opened, scanned or dlopen-ed at run time)
  link         CMake target_link_libraries between the project's own targets (test sources -> library sources)
  generated    configure_file outputs / generated headers seen as unresolved includes
  env          getenv / uv_os_getenv with a literal variable name (configuration, note only)
  callbacks    function-pointer registration (uv__io_init, uv__work_submit) -- note only
  python       Sphinx 'extensions' list + sys.path.insert (module named by a string)
"""
import collections
import json
import os
import re
import sys

C_EXT = ('.c', '.h')


def d(p):
    return p.rsplit('/', 1)[0] if '/' in p else '.'


def main():
    root, eval_path, out_path, text_path = os.path.realpath(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
    ev = json.load(open(eval_path, encoding='utf-8'))
    edges = {tuple(e) for e in ev['edge_list']}
    dir_pairs = {(d(f), d(t)) for f, t in edges}
    skipped = set(ev['skipped_files'])
    files = {}
    for cur, subs, names in os.walk(root):
        subs[:] = sorted(s for s in subs if s != '.git')
        for n in names:
            rel = os.path.relpath(os.path.join(cur, n), root)
            if rel.endswith(C_EXT) or rel.endswith('.py') or n == 'CMakeLists.txt':
                with open(os.path.join(root, rel), encoding='utf-8', errors='replace') as h:
                    files[rel] = h.read().split('\n')
    c_files = sorted(f for f in files if f.endswith(C_EXT))
    rows = collections.defaultdict(list)

    def conn(src, dst):
        if dst is None:
            return {'file_pair': None, 'dir_pair': None}
        return {'file_pair': (src, dst) in edges or (dst, src) in edges,
                'dir_pair': (d(src), d(dst)) in dir_pairs or (d(dst), d(src)) in dir_pairs}

    def add(kind, f, n, text, literal, target, in_project, extra=None):
        r = {'site': '%s:%d' % (f, n), 'text': text.strip()[:140], 'literal': literal, 'target': target,
             'target_in_project': in_project, 'site_file_scanned_on_linux': f not in skipped}
        r.update(conn(f, target if in_project else None))
        if extra:
            r.update(extra)
        rows[kind].append(r)

    # function definitions (for symbol-by-name targets)
    defs = collections.defaultdict(set)
    def_re = re.compile(r'^\s*(?:[A-Za-z_][\w\s\*]*?)\b([A-Za-z_]\w*)\s*\([^;]*$')
    for f in c_files:
        for n, line in enumerate(files[f], 1):
            m = def_re.match(line)
            if m and not line.rstrip().endswith(';') and not line.lstrip().startswith(('#', 'return', 'if', 'while', 'for', 'switch', '}')):
                defs[m.group(1)].add(f)

    call_re = re.compile(r'\b(dlopen|LoadLibrary\w*|GetModuleHandle\w*|uv_dlopen|dlsym|GetProcAddress|uv_dlsym)\s*\(')
    str_re = re.compile(r'"((?:[^"\\]|\\.)*)"')

    def strip_comments(text):
        # keep newlines and string literals; blank out /* */ and // comments
        out, i, n = [], 0, len(text)
        while i < n:
            c = text[i]
            if c == '"':
                j = i + 1
                while j < n and text[j] != '"':
                    j += 2 if text[j] == '\\' else 1
                out.append(text[i:j + 1]); i = j + 1
            elif text.startswith('/*', i):
                j = text.find('*/', i + 2); j = n if j < 0 else j + 2
                out.append(''.join(ch if ch == '\n' else ' ' for ch in text[i:j])); i = j
            elif text.startswith('//', i):
                j = text.find('\n', i); j = n if j < 0 else j
                out.append(' ' * (j - i)); i = j
            else:
                out.append(c); i += 1
        return ''.join(out)

    def args_of(text, start):
        # start = index just after '(' ; returns (list of top-level args, index after ')')
        depth, cur, parts, i = 0, [], [], start
        while i < len(text):
            c = text[i]
            if c == '"':
                j = i + 1
                while j < len(text) and text[j] != '"':
                    j += 2 if text[j] == '\\' else 1
                cur.append(text[i:j + 1]); i = j + 1; continue
            if c in '([{':
                depth += 1
            elif c in ')]}':
                if depth == 0:
                    parts.append(''.join(cur).strip()); return parts, i + 1
                depth -= 1
            elif c == ',' and depth == 0:
                parts.append(''.join(cur).strip()); cur = []; i += 1; continue
            cur.append(c); i += 1
        return parts, i

    for f in c_files:
        text = strip_comments('\n'.join(files[f]))
        for m in call_re.finditer(text):
            fn = m.group(1)
            line_no = text.count('\n', 0, m.start()) + 1
            prefix = text[text.rfind('\n', 0, m.start()) + 1:m.start()]
            parts, end = args_of(text, m.end())
            after = text[end:end + 40].lstrip()
            if re.search(r'\b(int|void|UV_EXTERN|const|char)\s*\**\s*$', prefix) or after.startswith('{'):
                continue  # a definition or declaration, not a call
            if '#define' in prefix:
                pass
            line_text = files[f][line_no - 1]
            if fn in ('dlsym', 'GetProcAddress', 'uv_dlsym'):
                arg = parts[1] if len(parts) > 1 else ''
                lits = str_re.findall(arg)
                via_macro = arg.startswith('#')
                name = ''.join(lits) if lits else None
                target_files = sorted(defs.get(name, ())) if name else []
                add('dl_sym', f, line_no, line_text, bool(lits) or via_macro,
                    name or ('%s (macro-stringified)' % arg if via_macro else arg[:40]), bool(target_files), {'defined_in': target_files, 'call': fn})
                if target_files:
                    rows['dl_sym'][-1].update(conn(f, target_files[0]))
            else:
                arg = parts[0] if parts else ''
                lits = str_re.findall(arg)
                literal = bool(lits) and re.fullmatch(r'(\s*"(?:[^"\\]|\\.)*"\s*)+', arg) is not None
                target = ''.join(lits) if literal else None
                in_proj = bool(target) and os.path.exists(os.path.join(root, target))
                note = None
                if not literal and f == 'test/test-dlerror.c':
                    note = 'literal held in a local variable two lines up: "test/fixtures/load_error.node"'
                    in_proj, target = True, 'test/fixtures/load_error.node'
                add('dl_load', f, line_no, line_text, literal, target if target else arg[:40], in_proj,
                    dict({'call': fn}, **({'note': note} if note else {})))
    # registry
    impl = {}
    impl_re = re.compile(r'^\s*(TEST_IMPL|HELPER_IMPL|BENCHMARK_IMPL)\(\s*(\w+)\s*\)')
    for f in c_files:
        for n, line in enumerate(files[f], 1):
            m = impl_re.match(line)
            if m:
                impl[m.group(2)] = f
    entry_re = re.compile(r'^\s*(TEST_ENTRY|TEST_ENTRY_CUSTOM|BENCHMARK_ENTRY|HELPER_ENTRY|TEST_HELPER)\s*\(\s*(\w+)\s*(?:,\s*(\w+))?')
    for lf in ('test/test-list.h', 'test/benchmark-list.h'):
        for n, line in enumerate(files.get(lf, []), 1):
            m = entry_re.match(line)
            if not m:
                continue
            kind, a1, a2 = m.groups()
            name = a2 if kind in ('HELPER_ENTRY', 'TEST_HELPER') and a2 else a1
            target = impl.get(name)
            add('registry', lf, n, line, True, target or name, bool(target), {'entry': kind, 'name': name})
    # self spawn
    dispatch = {}
    disp_re = re.compile(r'strcmp\(argv\[1\],\s*"([^"]+)"\)')
    for df in ('test/run-tests.c', 'test/run-benchmarks.c'):
        for n, line in enumerate(files.get(df, []), 1):
            for name in disp_re.findall(line):
                dispatch.setdefault(name, (df, n))
    for f in c_files:
        if not f.startswith('test/') or f in ('test/run-tests.c', 'test/run-benchmarks.c', 'test/test-list.h', 'test/benchmark-list.h'):
            continue
        for n, line in enumerate(files[f], 1):
            for lit in str_re.findall(line):
                if lit in dispatch and lit != '--list':
                    df, dn = dispatch[lit]
                    add('self_spawn', f, n, line, True, df, True, {'name': lit, 'dispatch_site': '%s:%d' % (df, dn)})
    # fixtures
    for f in c_files:
        for n, line in enumerate(files[f], 1):
            for lit in str_re.findall(line):
                if 'fixtures/' in lit:
                    path = lit if lit.startswith('test/') else os.path.normpath(os.path.join(d(f), lit))
                    add('fixture', f, n, line, True, path, os.path.exists(os.path.join(root, path)))
    # link: CMake target_link_libraries between project targets
    targets = set()
    for n, line in enumerate(files.get('CMakeLists.txt', []), 1):
        m = re.match(r'\s*add_(?:library|executable)\(\s*([\w-]+)', line)
        if m:
            targets.add(m.group(1))
    for n, line in enumerate(files.get('CMakeLists.txt', []), 1):
        m = re.match(r'\s*target_link_libraries\(\s*([\w-]+)\s+(.*)\)', line)
        if m and any(tok in targets for tok in m.group(2).split()):
            rows['link'].append({'site': 'CMakeLists.txt:%d' % n, 'text': line.strip(), 'from_target': m.group(1),
                                 'to_targets': [t for t in m.group(2).split() if t in targets], 'literal': True})
    test_mains = sorted({f for f in c_files if f.startswith('test/') and f.endswith('.c') and f not in skipped})
    test_to_src = sorted((f, t) for f, t in edges if f.startswith('test/') and t.startswith('src/'))
    link_summary = {'test_units_scanned': len(test_mains),
                    'test_files_with_an_include_edge_into_src': sorted({f for f, t in test_to_src}),
                    'test_to_src_edges': test_to_src,
                    'dir_pairs_test_to_src_in_light': sorted(p for p in dir_pairs if p[0].startswith('test') and p[1].startswith('src')),
                    'dir_pairs_test_to_include_in_light': sorted(p for p in dir_pairs if p[0].startswith('test') and p[1].startswith('include'))}
    # generated
    gen = []
    for n, line in enumerate(files.get('CMakeLists.txt', []), 1):
        if 'configure_file' in line:
            gen.append({'site': 'CMakeLists.txt:%d' % n, 'text': line.strip()})
    # env + callbacks (note only)
    env_re = re.compile(r'\b(?:getenv|uv_os_getenv)\(\s*"([^"]+)"')
    for f in c_files:
        if not f.startswith('src/'):
            continue
        for n, line in enumerate(files[f], 1):
            m = env_re.search(line)
            if m:
                rows['env'].append({'site': '%s:%d' % (f, n), 'name': m.group(1), 'literal': True, 'text': line.strip()[:120]})
            if re.search(r'\buv__io_init\(|\buv__work_submit\(', line) and not line.lstrip().startswith(('void', 'int', '*')):
                rows['callbacks'].append({'site': '%s:%d' % (f, n), 'text': line.strip()[:120]})
    # python
    for f in sorted(x for x in files if x.endswith('.py')):
        for n, line in enumerate(files[f], 1):
            m = re.match(r"\s*extensions\s*=\s*\[(.*)\]", line)
            if m:
                for name in re.findall(r"'([^']+)'", m.group(1)):
                    cand = [p for p in files if p.endswith('/' + name + '.py')]
                    rows['python'].append({'site': '%s:%d' % (f, n), 'text': line.strip(), 'name': name, 'literal': True,
                                           'target': cand[0] if cand else None, 'target_in_project': bool(cand),
                                           'file_pair': False, 'dir_pair': False, 'note': 'found through sys.path.insert(0, abspath("sphinx-plugins")) at conf.py:41'})
            if 'subprocess' in line and 'check_output' in line:
                rows['python'].append({'site': '%s:%d' % (f, n), 'text': line.strip(), 'name': 'git (external program)', 'literal': True,
                                       'target': None, 'target_in_project': False})
    summary = {}
    for kind, rs in rows.items():
        summary[kind] = {'sites': len(rs), 'literal': sum(1 for r in rs if r.get('literal')),
                         'target_in_project': sum(1 for r in rs if r.get('target_in_project')),
                         'file_pair_already_edge': sum(1 for r in rs if r.get('file_pair')),
                         'dir_pair_already_edge': sum(1 for r in rs if r.get('dir_pair')),
                         'site_file_scanned_on_linux': sum(1 for r in rs if r.get('site_file_scanned_on_linux', True))}
    out = {'summary': summary, 'rows': rows, 'link_summary': link_summary, 'generated': gen,
           'registry_unmatched': [r['name'] for r in rows['registry'] if not r['target_in_project']],
           'self_spawn_distinct_names': sorted({r['name'] for r in rows['self_spawn']}),
           'self_spawn_distinct_file_pairs': sorted({(r['site'].split(':')[0], r['target']) for r in rows['self_spawn']}),
           'registry_distinct_file_pairs': sorted({(r['site'].split(':')[0], r['target']) for r in rows['registry'] if r['target_in_project']})}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    T = []
    for kind, s in summary.items():
        T.append('%-10s %s' % (kind, s))
        for r in rows[kind][:6]:
            T.append('     %s' % {k: v for k, v in r.items() if k in ('site', 'text', 'target', 'target_in_project', 'file_pair', 'dir_pair', 'name', 'defined_in', 'note')})
    T.append('registry distinct file pairs %d; unmatched names %s' % (len(out['registry_distinct_file_pairs']), out['registry_unmatched'][:20]))
    T.append('self_spawn distinct names %d, file pairs %d %s' % (len(out['self_spawn_distinct_names']), len(out['self_spawn_distinct_file_pairs']), out['self_spawn_distinct_file_pairs']))
    T.append('link: %s' % {k: (v if not isinstance(v, list) or len(v) < 12 else '%d items' % len(v)) for k, v in link_summary.items()})
    T.append('generated (configure_file): %s' % gen)
    open(text_path, 'w', encoding='utf-8').write('\n'.join(T) + '\n')
    print('\n'.join(T))


if __name__ == '__main__':
    main()
