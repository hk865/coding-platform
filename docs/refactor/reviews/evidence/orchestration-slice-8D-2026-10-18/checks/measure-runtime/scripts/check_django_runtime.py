#!/usr/bin/env python3
"""Checker (independent of dj_*.py): recount Django's runtime / non-import dependencies and how many of the
runtime pairs the light-scan graph already connects.

    cd / && python3 -I check_django_runtime.py WORKSPACE MY_EDGES_ROOT.json THEIR_INVENTORY.json THEIR_SITES.json OUT.json

Reads files only (ast.parse, regexes).  Uses this directory's check_django_edges.py (our own resolver) for the
dotted-name lookup; the measuring agent's JSON is read only to compare against.
"""
import ast
import collections
import json
import os
import random
import re
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_django_edges as E  # noqa: E402  (our own checker resolver)

DOT = re.compile(r'^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$')
LABEL_MODEL = re.compile(r'^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$')


def dn(p):
    return p.rsplit('/', 1)[0] if '/' in p else ''


def fname(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def is_str(n):
    return isinstance(n, ast.Constant) and isinstance(n.value, str)


def top_bound(tree):
    names, star = set(), False

    def visit(body):
        nonlocal star
        for st in body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(st.name)
            elif isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                tg = st.targets if isinstance(st, ast.Assign) else [st.target]
                for t in tg:
                    for n in ast.walk(t):
                        if isinstance(n, ast.Name):
                            names.add(n.id)
            elif isinstance(st, ast.Import):
                for a in st.names:
                    names.add(a.asname or a.name.split('.')[0])
            elif isinstance(st, ast.ImportFrom):
                for a in st.names:
                    if a.name == '*':
                        star = True
                    else:
                        names.add(a.asname or a.name)
            elif isinstance(st, ast.If):
                visit(st.body); visit(st.orelse)
            elif isinstance(st, ast.Try):
                visit(st.body); visit(st.orelse); visit(st.finalbody)
                for h in st.handlers:
                    visit(h.body)
            elif isinstance(st, (ast.With, ast.For, ast.While)):
                visit(st.body)
    visit(tree.body)
    return names, star


def main():
    ws, edges_path, inv_path, sites_path, out_path = sys.argv[1:6]
    mine = json.load(open(edges_path, encoding='utf-8'))
    inv = json.load(open(inv_path, encoding='utf-8'))
    sites = json.load(open(sites_path, encoding='utf-8'))
    claimed, texts, skipped, _, _ = E.collect(ws)
    paths = sorted(texts)
    lk_root = E.Lookup(paths, ['.'])
    lk_tests = E.Lookup(paths, ['tests', '.'])
    trees = {}
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for p in paths:
            try:
                trees[p] = ast.parse(texts[p])
            except (SyntaxError, ValueError, RecursionError, MemoryError):
                pass
    edges = {(f, t) for f, t, s in mine['edgeList']}
    dir_edges = {(dn(f), dn(t)) for f, t in edges if dn(f) != dn(t)}

    def conn(f, t):
        if f == t:
            return 'self'
        if (f, t) in edges:
            return 'edge'
        if (t, f) in edges:
            return 'reverse'
        if dn(f) == dn(t):
            return 'same-dir'
        if (dn(f), dn(t)) in dir_edges:
            return 'dir-edge'
        if (dn(t), dn(f)) in dir_edges:
            return 'dir-edge-reverse-only'
        return 'new'

    bound = {p: top_bound(t) for p, t in trees.items()}

    def mod_file(name, frm):
        for lk in ([lk_root, lk_tests] if frm.startswith('tests/') else [lk_root]):
            st, node = lk.chain(name.split('.'), lk.roots, True)
            if st == 'ok' and node[0] in ('pkg', 'mod'):
                return node[1], ('root' if lk is lk_root else 'tests-root')
        return None, None

    def dotted_target(value, frm):
        f, r = mod_file(value, frm)
        if f:
            return f, 'module', r
        parts = value.split('.')
        for cut in (1, 2):
            if len(parts) > cut:
                f, r = mod_file('.'.join(parts[:-cut]), frm)
                if f:
                    names, star = bound.get(f, (set(), False))
                    if parts[-cut] in names or star:
                        return f, 'attr' if cut == 1 else 'attr2', r
                    return None, None, None
        return None, None, None

    res = {}
    # ------------------------------------------------------------------ 1. importlib / __import__ / import_string
    dyn = []
    imp_str = []
    for p, tree in trees.items():
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                fn = fname(n.func)
                if fn in ('import_module', '__import__'):
                    a0 = n.args[0] if n.args else next((k.value for k in n.keywords if k.arg == 'name'), None)
                    pkg = n.args[1] if (fn == 'import_module' and len(n.args) > 1) else \
                        next((k.value for k in n.keywords if k.arg == 'package'), None)
                    lit = is_str(a0)
                    rel = lit and a0.value.startswith('.')
                    kind = 'literal' if lit and not rel else (
                        'literal-name-literal-package' if rel and (pkg is None or is_str(pkg)) else
                        'literal-name-nonliteral-package' if rel else 'non-literal')
                    base = ast.unparse(n.func)
                    dyn.append({'at': '{}:{}'.format(p, n.lineno), 'func': base, 'kind': kind,
                                'arg': ast.unparse(a0)[:80] if a0 is not None else None})
                elif fn == 'import_string':
                    a0 = n.args[0] if n.args else None
                    imp_str.append({'at': '{}:{}'.format(p, n.lineno), 'literal': is_str(a0),
                                    'arg': ast.unparse(a0)[:80] if a0 is not None else None})

    def scope(at):
        return at.split('/')[0]
    dk = collections.Counter((d['kind'], scope(d['at'])) for d in dyn)
    res['dynamicImport'] = {
        'total': len(dyn), 'byKindScope': {'{} @ {}'.format(*k): v for k, v in sorted(dk.items())},
        'funcForms': dict(collections.Counter(d['func'] for d in dyn)),
        'literalSites': [d for d in dyn if d['kind'] != 'non-literal'],
    }
    # resolve the literal ones
    lit_res = collections.Counter()
    for d in dyn:
        if d['kind'] == 'literal':
            p = d['at'].rsplit(':', 1)[0]
            v = ast.literal_eval(d['arg'])
            st, node = lk_root.chain(v.split('.'), lk_root.roots, True)
            if st == 'ok' and node[0] != 'ns':
                lit_res['root'] += 1
            else:
                st, node = lk_tests.chain(v.split('.'), lk_tests.roots, True)
                lit_res['tests-root' if st == 'ok' and node[0] != 'ns' else 'unresolved'] += 1
    res['dynamicImport']['literalResolution'] = dict(lit_res)
    res['importString'] = {'total': len(imp_str),
                           'byLiteralScope': {'{} @ {}'.format(k[0], k[1]): v for k, v in sorted(
                               collections.Counter(('literal' if i['literal'] else 'non-literal', scope(i['at'])) for i in imp_str).items())},
                           'tests': [i for i in imp_str if i['at'].startswith('tests/')]}
    # ------------------------------------------------------------------ 2. all dotted strings (non-docstring)
    my_dotted = {}
    for p, tree in trees.items():
        docs = set()
        for n in ast.walk(tree):
            if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.body:
                b0 = n.body[0]
                if isinstance(b0, ast.Expr) and is_str(b0.value):
                    docs.add(id(b0.value))
        for n in ast.walk(tree):
            if is_str(n) and id(n) not in docs and DOT.match(n.value):
                to, how, r = dotted_target(n.value, p)
                my_dotted[(p, n.lineno, n.value)] = (to, how, r)
    their = sites['dottedSites']
    their_keys = collections.Counter((s['from'], s['line'], s['value']) for s in their)
    their_resolved = {(s['from'], s['line'], s['value']): s['to'] for s in their if s['to']}
    my_resolved = {k: v[0] for k, v in my_dotted.items() if v[0]}
    agree = sum(1 for k, t in their_resolved.items() if my_resolved.get(k) == t)
    differ = [[list(k), t, my_resolved.get(k)] for k, t in their_resolved.items() if my_resolved.get(k) != t]
    only_mine = [list(k) + [v] for k, v in my_resolved.items() if k not in their_resolved]
    res['dottedAll'] = {
        'myDottedStrings': len(my_dotted), 'myResolved': len(my_resolved),
        'theirSites': len(their), 'theirResolved': len(their_resolved),
        'resolvedAgree': agree, 'resolvedDiffer': len(differ), 'differExamples': differ[:15],
        'resolvedOnlyMine': len(only_mine), 'onlyMineExamples': sorted(only_mine)[:15],
    }
    # ------------------------------------------------------------------ 3. their wiring sites, my target + connection
    wk = set(sites['wiringKinds'])
    wiring = [s for s in their if s['kind'] in wk]
    pairs = {}
    pairs_dj = {}
    conn_site_agree = 0
    for s in wiring:
        to, how, r = dotted_target(s['value'], s['from'])
        if to and s['to'] and to == s['to'] and conn(s['from'], to) == s['connection']:
            conn_site_agree += 1
        if to:
            pairs[(s['from'], to)] = conn(s['from'], to)
            if s['from'].startswith('django/') and to.startswith('django/'):
                pairs_dj[(s['from'], to)] = conn(s['from'], to)
    res['wiring'] = {
        'sites': len(wiring), 'byScope': dict(collections.Counter(scope(s['from'] + '/') for s in wiring)),
        'resolvedByMe': sum(1 for s in wiring if dotted_target(s['value'], s['from'])[0]),
        'resolvedOnlyViaTestsRootByMe': sum(1 for s in wiring if dotted_target(s['value'], s['from'])[2] == 'tests-root'),
        'sitesWhereMyTargetAndConnectionEqualTheirs': conn_site_agree,
        'uniquePairs': len(pairs), 'byConnection': dict(collections.Counter(pairs.values())),
        'djangoOnlyPairs': len(pairs_dj), 'djangoOnlyByConnection': dict(collections.Counter(pairs_dj.values())),
    }
    # global_settings
    gs = [s for s in wiring if s['from'] == 'django/conf/global_settings.py']
    gs_targets = {dotted_target(s['value'], s['from'])[0] for s in gs} - {None}
    gs_out = [t for f, t in edges if f == 'django/conf/global_settings.py']
    res['globalSettings'] = {'wiringSites': len(gs), 'targets': len(gs_targets),
                             'fileEdgesToTargets': sum(1 for t in gs_targets if ('django/conf/global_settings.py', t) in edges),
                             'globalSettingsOutgoingEdgesAtAll': len(gs_out),
                             'globalSettingsIncomingEdges': sum(1 for f, t in edges if t == 'django/conf/global_settings.py'),
                             'dottedStringsInFileAll': sum(1 for k in my_dotted if k[0] == 'django/conf/global_settings.py'),
                             'byConnection': dict(collections.Counter(conn('django/conf/global_settings.py', t) for t in gs_targets))}
    # an independent wiring rule of our own: string values of UPPER_CASE settings / setting-like dict keys, include(),
    # import_string(), import_module(), AppConfig.name; resolved ones only
    own = []
    for p, tree in trees.items():
        par = {}
        for n in ast.walk(tree):
            for c in ast.iter_child_nodes(n):
                par[c] = n
        for n in ast.walk(tree):
            if not (is_str(n) and DOT.match(n.value)):
                continue
            cur, ctx = par.get(n), None
            while cur is not None and ctx is None:
                if isinstance(cur, (ast.List, ast.Tuple, ast.Set, ast.Starred)):
                    cur = par.get(cur)
                    continue
                if isinstance(cur, ast.keyword):
                    ctx = 'setting' if cur.arg and re.match(r'^[A-Z][A-Z0-9_]+$', cur.arg) else 'kw-other'
                elif isinstance(cur, ast.Call):
                    f = fname(cur.func)
                    ctx = 'loader-call' if f in ('include', 'import_string', 'import_module', 'get_callable', 'load_backend') else 'call-other'
                elif isinstance(cur, ast.Dict):
                    ctx = 'dict'
                    for k, v in zip(cur.keys, cur.values):
                        pass
                    # which key does it hang under?
                    key = None
                    probe = n
                    while par.get(probe) is not cur:
                        probe = par.get(probe)
                    if probe in cur.values:
                        k = cur.keys[cur.values.index(probe)]
                        key = k.value if is_str(k) else None
                    ctx = 'setting' if key and re.match(r'^[A-Z][A-Z0-9_]+$', key) else 'dict-other'
                elif isinstance(cur, (ast.Assign, ast.AnnAssign)):
                    t = cur.targets[0] if isinstance(cur, ast.Assign) else cur.target
                    nm = t.id if isinstance(t, ast.Name) else t.attr if isinstance(t, ast.Attribute) else ''
                    if re.match(r'^[A-Z][A-Z0-9_]+$', nm):
                        ctx = 'setting'
                    elif isinstance(par.get(cur), ast.ClassDef) and nm in ('name', 'default_auto_field', 'compiler_module'):
                        ctx = 'appconfig-attr'
                    else:
                        ctx = 'assign-other'
                else:
                    ctx = 'other'
            if ctx in ('setting', 'loader-call', 'appconfig-attr'):
                to, how, r = dotted_target(n.value, p)
                own.append((p, n.lineno, n.value, ctx, to))
    own_pairs = {(p, to): conn(p, to) for p, l, v, c, to in own if to}
    own_pairs_dj = {k: v for k, v in own_pairs.items() if k[0].startswith('django/') and k[1].startswith('django/')}
    res['ownWiringRule'] = {'sites': len(own), 'resolved': sum(1 for x in own if x[4]),
                            'byCtx': dict(collections.Counter(x[3] for x in own)),
                            'uniquePairs': len(own_pairs), 'byConnection': dict(collections.Counter(own_pairs.values())),
                            'djangoOnlyPairs': len(own_pairs_dj), 'djangoOnlyByConnection': dict(collections.Counter(own_pairs_dj.values())),
                            'overlapWithTheirWiringSites': len({(p, l, v) for p, l, v, c, to in own} & {(s['from'], s['line'], s['value']) for s in wiring})}
    # ------------------------------------------------------------------ 4. app_label.Model references
    label_dir = collections.defaultdict(set)
    for p, tree in trees.items():
        if p.endswith('/apps.py'):
            for n in ast.walk(tree):
                if isinstance(n, ast.ClassDef):
                    vals = {st.targets[0].id: st.value.value for st in n.body if isinstance(st, ast.Assign)
                            and isinstance(st.targets[0], ast.Name) and is_str(st.value)}
                    if 'name' in vals:
                        label_dir[vals.get('label', vals['name'].split('.')[-1])].add(dn(p))
    for p in paths:
        if p.endswith('/models.py'):
            label_dir[dn(p).split('/')[-1]].add(dn(p))
        elif p.endswith('/models/__init__.py'):
            label_dir[dn(dn(p)).split('/')[-1]].add(dn(dn(p)))
        if p.startswith('tests/') and p.count('/') >= 2:
            label_dir[p.split('/')[1]].add('tests/' + p.split('/')[1])

    def models_of(label):
        ds = sorted(label_dir.get(label, ()), key=lambda d: (not d.startswith('django/contrib/'), d.count('/'), d))
        for d in ds:
            for c in (d + '/models.py', d + '/models/__init__.py'):
                if c in texts:
                    return c, len(ds)
        return None, len(ds)

    msites = []
    for p, tree in trees.items():
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                f = fname(n.func)
                cands = []
                if f in ('ForeignKey', 'OneToOneField', 'ManyToManyField', 'ForeignObject'):
                    if n.args and is_str(n.args[0]):
                        cands.append(('field-arg', n.args[0]))
                    for k in n.keywords:
                        if k.arg in ('to', 'through') and is_str(k.value):
                            cands.append(('field-' + k.arg, k.value))
                elif f == 'get_model':
                    if len(n.args) >= 2 and is_str(n.args[0]) and is_str(n.args[1]):
                        msites.append((p, n.lineno, n.args[0].value + '.' + n.args[1].value, 'get_model(2)'))
                        continue
                    if n.args and is_str(n.args[0]):
                        cands.append(('get_model(1)', n.args[0]))
                for k in n.keywords:
                    if k.arg == 'AUTH_USER_MODEL' and is_str(k.value):
                        cands.append(('AUTH_USER_MODEL', k.value))
                for c, node in cands:
                    if LABEL_MODEL.match(node.value):
                        msites.append((p, node.lineno, node.value, c))
            elif isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'AUTH_USER_MODEL' for t in n.targets) \
                    and is_str(n.value) and LABEL_MODEL.match(n.value.value):
                msites.append((p, n.value.lineno, n.value.value, 'AUTH_USER_MODEL'))
    mres = []
    for p, l, v, c in msites:
        to, nd = models_of(v.split('.')[0])
        mres.append((p, l, v, c, to))
    mpairs = {(p, to): conn(p, to) for p, l, v, c, to in mres if to}
    res['modelRefs'] = {'sites': len(msites), 'byCtx': dict(collections.Counter(x[3] for x in msites)),
                        'byScope': dict(collections.Counter(x[0].split('/')[0] for x in msites)),
                        'resolved': sum(1 for x in mres if x[4]), 'uniquePairs': len(mpairs),
                        'byConnection': dict(collections.Counter(mpairs.values())),
                        'theirSites': len(sites['modelSites']),
                        'overlapSites': len({(p, l, v) for p, l, v, c in msites} & {(s['from'], s['line'], s['value']) for s in sites['modelSites']})}
    # ------------------------------------------------------------------ 5. migration dependencies
    deps = []
    mig_files = [p for p in paths if '/migrations/' in p and not p.endswith('__init__.py') and not p.startswith('django/db/migrations/')]
    for p in mig_files:
        tree = trees.get(p)
        if tree is None:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.ClassDef):
                for st in n.body:
                    if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'dependencies' for t in st.targets) \
                            and isinstance(st.value, (ast.List, ast.Tuple)):
                        for el in st.value.elts:
                            if isinstance(el, ast.Tuple) and len(el.elts) == 2 and all(is_str(x) for x in el.elts):
                                deps.append((p, el.lineno, el.elts[0].value, el.elts[1].value, 'literal'))
                            else:
                                deps.append((p, el.lineno, None, ast.unparse(el)[:80], 'other'))
    dres = []
    for p, l, app, name, kind in deps:
        to = None
        if kind == 'literal' and not name.startswith('__'):
            here = dn(p)  # .../<app>/migrations
            app_dir = dn(here)
            if app_dir.split('/')[-1] == app or here.split('/')[-1] != 'migrations':
                cand = here + '/' + name + '.py'
            else:
                cand = None
            if cand is None or cand not in texts:
                # other app: look for <x>/<app>/migrations/<name>.py, prefer django/contrib, then same tree prefix
                found = sorted(q for q in texts if q.endswith('/' + app + '/migrations/' + name + '.py'))
                if not found:
                    found = sorted(q for q in texts if q.endswith('/migrations/' + name + '.py') and app in q.split('/'))
                pref = [q for q in found if q.startswith(dn(app_dir) + '/')] or [q for q in found if q.startswith('django/contrib/')] or found
                cand = pref[0] if pref else None
            to = cand
        dres.append((p, l, app, name, kind, to))
    dpairs = {(p, to): conn(p, to) for p, l, a, nm, k, to in dres if to}
    res['migrationDeps'] = {'migrationFiles': len(mig_files), 'items': len(deps),
                            'literal': sum(1 for x in deps if x[4] == 'literal'),
                            'special__': sum(1 for x in deps if x[4] == 'literal' and x[3].startswith('__')),
                            'other': [list(x) for x in deps if x[4] == 'other'],
                            'resolved': sum(1 for x in dres if x[5]),
                            'resolvedSameDir': sum(1 for x in dres if x[5] and dn(x[5]) == dn(x[0])),
                            'uniquePairs': len(dpairs), 'byConnection': dict(collections.Counter(dpairs.values())),
                            'unresolvedLiteral': [list(x[:4]) for x in dres if x[4] == 'literal' and not x[5]][:20]}
    # ------------------------------------------------------------------ 6. convention modules in django/
    dj = [p for p in paths if p.startswith('django/')]
    indeg_dj = collections.Counter(t for f, t in edges if f.startswith('django/') and t.startswith('django/'))
    indeg_all = collections.Counter(t for f, t in edges)
    conv = {
        'commands': lambda p: '/management/commands/' in p and not p.endswith('/__init__.py'),
        'contrib migrations': lambda p: p.startswith('django/contrib/') and '/migrations/' in p and not p.endswith('/__init__.py'),
        'templatetags': lambda p: '/templatetags/' in p and not p.endswith('/__init__.py'),
        'apps.py': lambda p: p.endswith('/apps.py'),
        'contrib admin.py': lambda p: p.startswith('django/contrib/') and p.endswith('/admin.py'),
        'db backends base.py': lambda p: p.startswith('django/db/backends/') and p.endswith('/base.py'),
        'locale formats': lambda p: p.startswith('django/conf/locale/') and p.endswith('/formats.py'),
    }
    res['conventionModules'] = {k: {'files': sum(1 for p in dj if r(p)),
                                    'noIncomingFromDjango': sum(1 for p in dj if r(p) and indeg_dj[p] == 0),
                                    'noIncomingAtAll': sum(1 for p in dj if r(p) and indeg_all[p] == 0)} for k, r in conv.items()}
    # ------------------------------------------------------------------ 7. templates
    load_sites, load_names, ext_inc = 0, 0, collections.Counter()
    tfiles = 0
    lib_files = {os.path.basename(p)[:-3]: p for p in paths if '/templatetags/' in p and not p.endswith('__init__.py')}
    unknown_libs = collections.Counter()
    for cur, dirs, fns in os.walk(ws):
        for fn in fns:
            if fn.endswith(('.html', '.txt', '.xml')) and '/templates' in cur.replace(os.sep, '/'):
                tfiles += 1
                try:
                    txt = open(os.path.join(cur, fn), encoding='utf-8').read()
                except (UnicodeDecodeError, OSError):
                    continue
                for m in re.finditer(r'{%-?\s*load\s+([^%]+?)\s*-?%}', txt):
                    load_sites += 1
                    words = m.group(1).split()
                    if 'from' in words:
                        words = words[words.index('from') + 1:]
                    load_names += len(words)
                    for w in words:
                        if w not in lib_files:
                            unknown_libs[w] += 1
                for m in re.finditer(r'{%-?\s*(extends|include)\s', txt):
                    ext_inc[m.group(1)] += 1
    res['templates'] = {'templateTextFilesUnderTemplatesDirs': tfiles, 'loadSites': load_sites, 'loadNames': load_names,
                        'namesNotMatchingATemplatetagsFile': dict(unknown_libs), 'extendsInclude': dict(ext_inc)}
    # ------------------------------------------------------------------ 8. misc counts
    misc = collections.Counter()
    syspath = []
    ctypes_sites = []
    for p, tree in trees.items():
        par = {}
        for n in ast.walk(tree):
            for c in ast.iter_child_nodes(n):
                par[c] = n
        for n in ast.walk(tree):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                cur = par.get(n)
                place = 'module'
                while cur is not None:
                    if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                        place = 'function'
                        break
                    cur = par.get(cur)
                if place == 'module':
                    cur = par.get(n)
                    while cur is not None:
                        if isinstance(cur, ast.Try):
                            place = 'try'
                            break
                        cur = par.get(cur)
                misc['import-stmt-' + place] += 1
            if isinstance(n, ast.Call):
                f = fname(n.func)
                txt = ast.unparse(n.func)
                if f == 'connect' and isinstance(n.func, ast.Attribute):
                    misc['.connect('] += 1
                if f == 'register':
                    misc['register('] += 1
                if txt.startswith('sys.path.') or f == 'extend_sys_path':
                    syspath.append('{}:{} {}'.format(p, n.lineno, txt))
                if f in ('CDLL', 'WinDLL', 'LoadLibrary', 'find_library', 'PyDLL', 'OleDLL'):
                    a0 = n.args[0] if n.args else None
                    ctypes_sites.append('{}:{} {}({})'.format(p, n.lineno, txt, ast.unparse(a0) if a0 is not None else ''))
            if isinstance(n, (ast.Assign, ast.AugAssign)):
                tg = n.targets if isinstance(n, ast.Assign) else [n.target]
                for t in tg:
                    u = ast.unparse(t)
                    if u.startswith('sys.path'):
                        syspath.append('{}:{} {} ='.format(p, n.lineno, u))
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                for d in n.decorator_list:
                    dd = d.func if isinstance(d, ast.Call) else d
                    if fname(dd) == 'receiver':
                        misc['@receiver'] += 1
            if isinstance(n, ast.If) and 'TYPE_CHECKING' in ast.unparse(n.test):
                misc['if TYPE_CHECKING'] += 1
        for st in tree.body:
            if isinstance(st, ast.FunctionDef) and st.name == '__getattr__':
                misc['module __getattr__'] += 1
                res.setdefault('moduleGetattr', []).append('{}:{}'.format(p, st.lineno))
    res['misc'] = dict(misc)
    res['sysPath'] = {'count': len(syspath), 'sites': sorted(syspath)}
    res['ctypes'] = {'count': len(ctypes_sites), 'sites': sorted(ctypes_sites)}
    # function-level import pairs only reachable through function-level imports
    # ------------------------------------------------------------------ 9. structure (django/)
    dj_edges = {(f, t) for f, t in edges if f.startswith('django/') and t.startswith('django/')}
    zero = [p for p in dj if indeg_dj[p] == 0]
    res['structure'] = {
        'djangoFiles': len(dj), 'djangoInternalEdges': len(dj_edges),
        'djangoInternalToInit': sum(1 for f, t in dj_edges if t.endswith('/__init__.py')),
        'allEdgesToInit': sum(1 for f, t in edges if t.endswith('/__init__.py')),
        'top': collections.Counter(t for f, t in dj_edges).most_common(4),
        'inDegreeZero': len(zero), 'inDegreeZeroCountingAll': sum(1 for p in dj if indeg_all[p] == 0),
        'inDegreeZeroInit': sum(1 for p in zero if p.endswith('/__init__.py')),
        'inDegreeZeroLocaleInit': sum(1 for p in zero if re.match(r'^django/conf/locale/[^/]+/__init__\.py$', p)),
    }
    # loader -> loaded pairs, our own construction
    loaders = [
        ('management command', lambda p: '/management/commands/' in p and not p.endswith('/__init__.py'), 'django/core/management/__init__.py'),
        ('migration', lambda p: p.startswith('django/contrib/') and '/migrations/' in p and not p.endswith('/__init__.py'), 'django/db/migrations/loader.py'),
        ('locale formats', lambda p: p.startswith('django/conf/locale/') and p.endswith('/formats.py'), 'django/utils/formats.py'),
        ('apps.py', lambda p: p.endswith('/apps.py'), 'django/apps/config.py'),
        ('templatetags', lambda p: '/templatetags/' in p and not p.endswith('/__init__.py'), 'django/template/backends/django.py'),
        ('contrib admin.py', lambda p: p.startswith('django/contrib/') and p.endswith('/admin.py'), 'django/contrib/admin/__init__.py'),
        ('db backend base.py', lambda p: p.startswith('django/db/backends/') and p.endswith('/base.py'), 'django/db/utils.py'),
        # app models modules only: a directory that also has apps.py (an installed app)
        ('app models module', lambda p: (p.endswith('/models.py') and dn(p) + '/apps.py' in texts) or
         (p.endswith('/models/__init__.py') and dn(dn(p)) + '/apps.py' in texts), 'django/apps/config.py'),
    ]
    lp = []
    for kind, rule, loader in loaders:
        for p in dj:
            if rule(p):
                lp.append((kind, loader, p))
    for (f, t), c in pairs_dj.items():
        if c != 'self':
            lp.append(('dotted string in django/', f, t))

    def comp(p):
        parts = p.split('/')
        if len(parts) == 2:
            return 'django/(top)'
        if parts[1] in ('contrib', 'db', 'core'):
            return '/'.join(parts[:3]) if len(parts) > 3 else '/'.join(parts[:2]) + '/(files)'
        return '/'.join(parts[:2])
    djd = {(dn(f), dn(t)) for f, t in dj_edges if dn(f) != dn(t)}
    djc = {(comp(f), comp(t)) for f, t in dj_edges if comp(f) != comp(t)}

    def dir_level(f, t):
        if (f, t) in dj_edges or (t, f) in dj_edges:
            return 'file edge'
        if dn(f) == dn(t):
            return 'same dir'
        if (dn(f), dn(t)) in djd:
            return 'dir edge'
        if (dn(t), dn(f)) in djd:
            return 'dir edge reverse only'
        return 'none'

    def comp_level(f, t):
        if (f, t) in dj_edges or (t, f) in dj_edges:
            return 'file edge'
        if comp(f) == comp(t):
            return 'same comp'
        if (comp(f), comp(t)) in djc:
            return 'comp edge'
        if (comp(t), comp(f)) in djc:
            return 'comp edge reverse only'
        return 'none'
    lp = sorted(set(lp))
    bykind = collections.defaultdict(collections.Counter)
    bykind_c = collections.defaultdict(collections.Counter)
    for kind, f, t in lp:
        bykind[kind][dir_level(f, t)] += 1
        bykind_c[kind][comp_level(f, t)] += 1
    tot = collections.Counter()
    for v in bykind.values():
        tot.update(v)
    totc = collections.Counter()
    for v in bykind_c.values():
        totc.update(v)
    res['loaderPairs'] = {'pairs': len(lp), 'dirLevelByKind': {k: dict(v) for k, v in bykind.items()},
                          'dirLevelTotal': dict(tot), 'compLevelByKind': {k: dict(v) for k, v in bykind_c.items()},
                          'compLevelTotal': dict(totc), 'components': len({comp(p) for p in dj})}
    # their 'models module' rule as written, to see what it caught
    rx = re.compile(r'/(models\.py|models/__init__\.py)$')
    res['theirModelsRuleMatches'] = sorted(p for p in dj if rx.search(p))
    # ------------------------------------------------------------------ 10. ten sampled sites to re-classify by hand
    rnd = random.Random(1017)
    pool = [('dotted wiring', s) for s in wiring if s['to']] + [('model ref', s) for s in sites['modelSites'] if s['to']]
    sample = rnd.sample(pool, 10)
    out = []
    for kind, s in sample:
        line = texts[s['from']].splitlines()[s['line'] - 1].strip()[:160]
        out.append({'kind': kind, 'their': {k: s.get(k) for k in ('from', 'line', 'value', 'context', 'kind', 'to', 'connection')},
                    'sourceLine': line, 'myConnection': conn(s['from'], s['to'])})
    res['handSample'] = out
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k not in ('theirModelsRuleMatches',)}, ensure_ascii=False, indent=1)[:30000])


if __name__ == '__main__':
    main()
