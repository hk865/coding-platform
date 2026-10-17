#!/usr/bin/env python3
"""Checker (libuv): my own inventory of run-time / non-#include dependencies, and how much of it the light-scan graph
already carries.  Written independently of uv_runtime_inventory.py (own patterns, own comment stripping, own
target resolution).  Reads files as text only.

Run only as: python3 -I check_libuv_runtime.py SRC_ROOT NOT_IGNORED_Z EVAL_JSON OUT_JSON
  EVAL_JSON = my own evaluation of the light scan (check_libuv_eval.py), for edges and file status.
"""
import collections
import json
import os
import re
import sys

CPP = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}


def ext_of(p):
    b = p.rsplit('/', 1)[-1]
    d = b.rfind('.')
    return b[d:].lower() if d > 0 else ''


def strip_c(t):
    """Blank out comments (keep newlines and string/char literals)."""
    out, i, n = [], 0, len(t)
    while i < n:
        c = t[i]
        if c == '/' and i + 1 < n and t[i + 1] == '*':
            j = t.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in t[i:j]))
            i = j
        elif c == '/' and i + 1 < n and t[i + 1] == '/':
            j = t.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c in '"\'':
            j = i + 1
            while j < n and t[j] != c:
                if t[j] == '\\':
                    j += 1
                if j < n and t[j] == '\n':
                    break
                j += 1
            out.append(t[i:j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def line_at(t, off):
    return t.count('\n', 0, off) + 1


def args_after(t, off):
    """Split the call arguments starting at t[off] == '(' (top level commas)."""
    depth, cur, args, i = 0, [], [], off
    while i < len(t):
        c = t[i]
        if c in '"\'':
            j = i + 1
            while j < len(t) and t[j] != c:
                j += 2 if t[j] == '\\' else 1
            cur.append(t[i:j + 1])
            i = j + 1
            continue
        if c == '(':
            depth += 1
            if depth == 1:
                i += 1
                continue
        elif c == ')':
            depth -= 1
            if depth == 0:
                args.append(''.join(cur).strip())
                return args
        elif c == ',' and depth == 1:
            args.append(''.join(cur).strip())
            cur = []
            i += 1
            continue
        cur.append(c)
        i += 1
    return args


LIT = re.compile(r'^L?"((?:[^"\\]|\\.)*)"(\s*L?"((?:[^"\\]|\\.)*)")*$', re.S)


def literal_value(a):
    a = a.strip()
    if not LIT.match(a):
        return None
    return ''.join(re.findall(r'"((?:[^"\\]|\\.)*)"', a))


def main():
    root, listing, eval_json, out = sys.argv[1:5]
    root = root.rstrip('/')
    with open(listing, 'rb') as h:
        paths = sorted(p.decode() for p in h.read().split(b'\0') if p)
    ev = json.load(open(eval_json))
    status = ev['status']
    edges = {tuple(e) for e in ev['edges']}
    und = edges | {(b, a) for a, b in edges}
    dpairs = {(os.path.dirname(a), os.path.dirname(b)) for a, b in edges}
    udpairs = dpairs | {(b, a) for a, b in dpairs}
    claimed = [p for p in paths if ext_of(p) in CPP]
    text, raw = {}, {}
    for p in claimed:
        raw[p] = open(os.path.join(root, p), encoding='utf-8', errors='replace').read()
        text[p] = strip_c(raw[p])
    allset = set(paths)
    sites = collections.defaultdict(list)

    def judge(kind, site_file, line, txt, literal, target, extra=None):
        rec = {'site': '%s:%d' % (site_file, line), 'text': txt.strip()[:160], 'literal': literal, 'target': target,
               'target_in_project': bool(target and target in allset or (target and os.path.isdir(os.path.join(root, target))))}
        if rec['target_in_project']:
            rec['file_pair_edge_directed'] = (site_file, target) in edges
            rec['file_pair_edge_any_direction'] = (site_file, target) in und
            dp = (os.path.dirname(site_file), os.path.dirname(target))
            rec['dir_pair'] = list(dp)
            rec['dir_pair_edge_directed'] = dp in dpairs
            rec['dir_pair_edge_any_direction'] = dp in udpairs
            rec['site_status'] = status.get(site_file, 'not-claimed')
            rec['target_status'] = status.get(target, 'not-claimed')
        if extra:
            rec.update(extra)
        sites[kind].append(rec)

    # ---- 1/2: dynamic loading
    RE_LOAD = re.compile(r'\b(uv_dlopen|dlopen|LoadLibrary(?:Ex)?[AW]?)\s*(?=\()')
    RE_SYM = re.compile(r'\b(uv_dlsym|dlsym|GetProcAddress)\s*(?=\()')
    DECL = re.compile(r'(\b(int|void|char|HMODULE|HANDLE|FARPROC|UV_EXTERN|static|extern)\s*\**\s*$)|^\s*#\s*define')
    defs = collections.defaultdict(set)
    for p in claimed:
        for m in re.finditer(r'(?m)^[A-Za-z_][\w \t\*]*?\b([A-Za-z_]\w*)\s*\([^;{)]*\)\s*\{', text[p]):
            defs[m.group(1)].add(p)
    for kind, rx, argn in (('dl_load', RE_LOAD, 0), ('dl_sym', RE_SYM, 1)):
        for p in claimed:
            t = text[p]
            for m in rx.finditer(t):
                ls = t.rfind('\n', 0, m.start()) + 1
                prefix = t[ls:m.start()]
                ln = line_at(t, m.start())
                if DECL.search(prefix) or prefix.lstrip().startswith('#'):
                    sites[kind + '_decl_or_def'].append('%s:%d' % (p, ln))
                    continue
                a = args_after(t, m.end())
                arg = a[argn] if len(a) > argn else ''
                val = literal_value(arg)
                how = 'literal' if val is not None else 'expr'
                if val is None and re.fullmatch(r'[A-Za-z_]\w*', arg):
                    # one local hop: <ident> = "..."  or  <ident>[] = "..." earlier in the same file
                    mm = list(re.finditer(r'\b%s\s*(\[\s*\])?\s*=\s*("(?:[^"\\]|\\.)*")' % re.escape(arg), t[:m.start()]))
                    if mm:
                        val = literal_value(mm[-1].group(2))
                        how = 'variable-from-literal'
                target = None
                if kind == 'dl_load' and val:
                    target = val if val in allset else None
                if kind == 'dl_sym' and val:
                    cands = sorted(defs.get(val, set()))
                    target = cands[0] if len(cands) == 1 else None
                judge(kind, p, ln, raw[p].split('\n')[ln - 1], how if val is not None else 'expr', target,
                      {'arg': arg[:80], 'value': val})
    # ---- 3: test/benchmark registries
    impl = {}
    for p in claimed:
        if not p.startswith('test/'):
            continue
        t = text[p]
        for m in re.finditer(r'\b(TEST|BENCHMARK|HELPER)_IMPL\s*\(\s*(\w+)\s*\)', t):
            nm = m.group(2)
            if '##' in t[m.start():m.start() + 200].split(')', 1)[0]:
                continue
            impl[(m.group(1), nm)] = p
        # token-pasted names inside #define X(...) ... X(a, b) lines
        for m in re.finditer(r'#\s*define\s+(\w+)\s*\(([^)]*)\)((?:[^\n]*\\\n)*[^\n]*)', t):
            mname, params, body = m.group(1), [x.strip() for x in m.group(2).split(',')], m.group(3)
            for im in re.finditer(r'\b(TEST|BENCHMARK|HELPER)_IMPL\s*\(\s*([\w# ]+?)\s*\)', body):
                tmpl = im.group(2).replace(' ', '')
                for call in re.finditer(r'(?m)^\s*%s\s*\(([^)]*)\)' % mname, t[m.end():]):
                    vals = [x.strip() for x in call.group(1).split(',')]
                    nm = tmpl
                    for k, v in zip(params, vals):
                        nm = re.sub(r'\b%s\b' % re.escape(k), v, nm)
                    impl[(im.group(1), nm.replace('##', ''))] = p
    reg_files = ['test/test-list.h', 'test/benchmark-list.h']
    unmatched = []
    for p in reg_files:
        t = text[p]
        for m in re.finditer(r'\b(TEST_ENTRY_CUSTOM|TEST_ENTRY|TEST_HELPER|BENCHMARK_ENTRY|BENCHMARK_HELPER)\s*(?=\()', t):
            a = args_after(t, m.end())
            macro = m.group(1)
            ln = line_at(t, m.start())
            if macro in ('TEST_ENTRY', 'TEST_ENTRY_CUSTOM'):
                key = ('TEST', a[0])
            elif macro == 'BENCHMARK_ENTRY':
                key = ('BENCHMARK', a[0])
            else:
                key = ('HELPER', a[1])
            target = impl.get(key)
            if target is None:
                unmatched.append((macro, key[1], '%s:%d' % (p, ln)))
            judge('registry', p, ln, raw[p].split('\n')[ln - 1], 'literal', target, {'macro': macro, 'name': key[1]})
    # ---- 4: the test binary spawning itself with a helper name (dispatch in run-tests.c / run-benchmarks.c)
    names = {}
    for runner in ('test/run-tests.c', 'test/run-benchmarks.c'):
        for m in re.finditer(r'strcmp\s*\(\s*argv\s*\[\s*1\s*\]\s*,\s*"([^"]+)"\s*\)', text[runner]):
            if not m.group(1).startswith('-'):
                names[m.group(1)] = runner
    for p in claimed:
        if not p.startswith('test/') or p in ('test/run-tests.c', 'test/run-benchmarks.c'):
            continue
        t = text[p]
        for m in re.finditer(r'"([^"\\\n]+)"', t):
            if m.group(1) in names:
                ln = line_at(t, m.start())
                judge('self_spawn', p, ln, raw[p].split('\n')[ln - 1], 'literal', names[m.group(1)], {'name': m.group(1)})
    # ---- 5: data files named by literal paths
    for p in claimed:
        t = text[p]
        for m in re.finditer(r'"((?:[^"\\\n])*fixtures(?:/[^"\\\n]*)?)"', t):
            ln = line_at(t, m.start())
            v = m.group(1)
            judge('fixture', p, ln, raw[p].split('\n')[ln - 1], 'literal', v.rstrip('/'),
                  {'is_dir': os.path.isdir(os.path.join(root, v))})
    # ---- 6: CMake link dependencies between the project's own targets
    cm = open(os.path.join(root, 'CMakeLists.txt'), encoding='utf-8').read()
    cm_nc = re.sub(r'#[^\n]*', lambda x: ' ' * len(x.group(0)), cm)
    targets = set(re.findall(r'\badd_(?:library|executable)\s*\(\s*([\w-]+)', cm_nc))
    link_sites, link_pairs = [], set()
    for m in re.finditer(r'\btarget_link_libraries\s*\(([^)]*)\)', cm_nc):
        toks = m.group(1).split()
        ln = line_at(cm_nc, m.start())
        own = [x for x in toks[1:] if x in targets]
        link_sites.append({'site': 'CMakeLists.txt:%d' % ln, 'target': toks[0], 'own_deps': own,
                           'other': [x for x in toks[1:] if x not in targets]})
        for d in own:
            link_pairs.add((toks[0], d))
    # sources per target from the database are in check_libuv_db.json; here: which dirs feed which target
    # ---- 7: configure_file outputs and quoted includes that do not exist anywhere (generated headers)
    conf = [{'site': 'CMakeLists.txt:%d' % line_at(cm_nc, m.start()), 'text': m.group(0)}
            for m in re.finditer(r'\bconfigure_file\s*\([^)]*\)', cm_nc)]
    missing_quoted = []
    for p in claimed:
        for m in re.finditer(r'(?m)^[ \t]*#[ \t]*include[ \t]*"([^"]+)"', text[p]):
            nm = m.group(1)
            found = any(os.path.isfile(os.path.normpath(os.path.join(root, d, nm)))
                        for d in (os.path.dirname(p), 'include', 'src', 'test'))
            if not found:
                missing_quoted.append(('%s:%d' % (p, line_at(text[p], m.start())), nm))
    # ---- 8: callback registries (note only): internal I/O watcher and work-queue registrations
    cb = []
    for p in claimed:
        t = text[p]
        for m in re.finditer(r'\b(uv__io_init|uv__work_submit)\s*\(', t):
            ls = t.rfind('\n', 0, m.start()) + 1
            if DECL.search(t[ls:m.start()]) or t[ls:m.start()].lstrip().startswith('#'):
                continue
            cb.append('%s:%d' % (p, line_at(t, m.start())))
    # ---- 9: environment variables read by literal name
    env = []
    for p in claimed:
        t = text[p]
        for m in re.finditer(r'\b(getenv|secure_getenv|uv_os_getenv|GetEnvironmentVariable[AW]?|_wgetenv)\s*\(\s*(L?"[^"]*")', t):
            env.append(('%s:%d' % (p, line_at(t, m.start())), m.group(1), m.group(2)))
    # ---- 10: Python files
    py = []
    for p in paths:
        if not p.endswith('.py'):
            continue
        t = open(os.path.join(root, p), encoding='utf-8', errors='replace').read()
        for k, rx in (('importlib', r'importlib\.import_module|__import__\s*\('), ('sphinx_extensions', r'^\s*extensions\s*='),
                      ('sys_path', r'sys\.path\.(insert|append)'), ('subprocess', r'\bsubprocess\.\w+\s*\(')):
            for m in re.finditer(rx, t, re.M):
                ln = line_at(t, m.start())
                py.append({'site': '%s:%d' % (p, ln), 'kind': k, 'text': t.split('\n')[ln - 1].strip()[:120]})

    def summary(kind):
        s = sites.get(kind, [])
        inproj = [x for x in s if x['target_in_project']]
        return {
            'sites': len(s),
            'literal_or_one_hop': sum(1 for x in s if x['literal'] in ('literal', 'variable-from-literal')),
            'pure_literal': sum(1 for x in s if x['literal'] == 'literal'),
            'target_in_project': len(inproj),
            'file_pair_edge_directed': sum(1 for x in inproj if x['file_pair_edge_directed']),
            'file_pair_edge_any': sum(1 for x in inproj if x['file_pair_edge_any_direction']),
            'dir_pair_edge_directed': sum(1 for x in inproj if x['dir_pair_edge_directed']),
            'dir_pair_edge_any': sum(1 for x in inproj if x['dir_pair_edge_any_direction']),
            'distinct_file_pairs': len({(x['site'].rsplit(':', 1)[0], x['target']) for x in inproj}),
            'distinct_targets': len({x['target'] for x in inproj}),
            'new_dir_pairs_directed': sorted({tuple(x['dir_pair']) for x in inproj if not x['dir_pair_edge_directed']}),
            'new_dir_pairs_any_direction': sorted({tuple(x['dir_pair']) for x in inproj if not x['dir_pair_edge_any_direction']}),
            'sites_in_skipped_files': sum(1 for x in inproj if x['site_status'] == 'skipped'),
        }
    res = {k: summary(k) for k in ('dl_load', 'dl_sym', 'registry', 'self_spawn', 'fixture')}
    res['dl_decl_or_def_excluded'] = {k: len(sites[k]) for k in ('dl_load_decl_or_def', 'dl_sym_decl_or_def')}
    res['registry_by_macro'] = dict(collections.Counter(x['macro'] for x in sites['registry']))
    res['registry_unmatched'] = unmatched
    res['self_spawn_names'] = len({x['name'] for x in sites['self_spawn']})
    res['self_spawn_names_total_in_runners'] = len(names)
    res['cmake_targets'] = sorted(targets)
    res['link_sites'] = link_sites
    res['link_pairs_own_targets'] = sorted(link_pairs)
    res['configure_file'] = conf
    res['quoted_includes_missing_everywhere'] = missing_quoted
    res['callback_sites'] = len(cb)
    res['env_sites'] = len(env)
    res['env_by_dir'] = dict(collections.Counter(s.split('/')[0] + ('/' + s.split('/')[1] if s.startswith('src/') and s.count('/') > 1 else '') for s, _, _ in env))
    res['env'] = env
    res['python'] = py
    res['light_dir_pairs'] = sorted(dpairs)
    json.dump({'summary': res, 'sites': sites}, open(out, 'w'), indent=1)
    for k in ('dl_load', 'dl_sym', 'registry', 'self_spawn', 'fixture'):
        print(k, json.dumps(res[k]))
    for k in ('dl_decl_or_def_excluded', 'registry_by_macro', 'registry_unmatched', 'self_spawn_names',
              'self_spawn_names_total_in_runners', 'cmake_targets', 'link_sites', 'link_pairs_own_targets',
              'configure_file', 'quoted_includes_missing_everywhere', 'callback_sites', 'env_sites', 'env_by_dir', 'python'):
        print(k, json.dumps(res[k])[:1500])


if __name__ == '__main__':
    main()
