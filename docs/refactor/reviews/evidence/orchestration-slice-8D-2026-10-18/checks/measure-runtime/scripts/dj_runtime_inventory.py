#!/usr/bin/env python3
"""Runtime / non-import dependency inventory for a Django source tree, compared with the light import scan's edges.

    cd / && python3 -I dj_runtime_inventory.py WORKSPACE SCAN_ROOT.json OUT.json

Reads files only (ast.parse / text regexes); never imports or runs anything from WORKSPACE.  It reuses the
prototype's Resolver (draft 4 section 11.3 rules) from our own scripts directory to turn literal dotted paths into
files.  Resolution is tried with the configured roots ['.'] first and, for files under tests/, with ['tests', '.']
(tests/runtests.py is started as a script, so tests/ is sys.path[0] at run time); the root used is recorded.

For every resolved runtime pair (from-file, to-file) it says whether the light scan already connects it:
  edge       (from, to) is a light-scan edge
  reverse    (to, from) is a light-scan edge (connected, other direction)
  same-dir   both files are in the same directory (same package)
  dir-edge   some light-scan edge joins the two directories (module/directory level)
  new        none of the above: information the light scan does not have
"""
import ast
import collections
import json
import os
import re
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # our scripts directory only
import light_import_scan as L  # noqa: E402

DOTTED = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$')
MODEL_REF = re.compile(r'^([a-z_][a-z0-9_]*)\.([A-Z][A-Za-z0-9_]*)$')
TEMPLATE_NAME = re.compile(r'^[\w][\w./-]*\.(html|txt|xml)$')
LOAD_TAG = re.compile(r'{%-?\s*load\s+(.+?)\s*-?%}')
EXT_INC_TAG = re.compile(r'{%-?\s*(extends|include)\s+(.+?)\s*-?%}')
FIELD_FUNCS = {'ForeignKey', 'OneToOneField', 'ManyToManyField', 'ForeignObject', 'GenericRelation', 'ParentalKey'}
WIRING_CALLS = {'import_string', 'import_module', 'include', 'get_callable', 'load_backend', 'get_storage_class',
                'get_connection', 'get_hasher', 'load_command_class', 'call_command', 'get_cache', 'module_has_submodule',
                'autodiscover_modules', 'apps.get_app_config', 'import_by_path', 'get_mod_func', 'url', 'path', 're_path'}


def dname(p):
    return p.rsplit('/', 1)[0] if '/' in p else ''


class Ctx:
    """Edges of the light scan, as sets for the connected-ness test."""

    def __init__(self, scan):
        self.edges = {(e[0], e[1]) for e in scan['edges']}
        self.dir_edges = set()   # directed (dir(from), dir(to))
        for f, t in self.edges:
            a, b = dname(f), dname(t)
            if a != b:
                self.dir_edges.add((a, b))

    def connected(self, f, t):
        if f == t:
            return 'self'
        if (f, t) in self.edges:
            return 'edge'
        if (t, f) in self.edges:
            return 'reverse'
        if dname(f) == dname(t):
            return 'same-dir'
        if (dname(f), dname(t)) in self.dir_edges:
            return 'dir-edge'
        if (dname(t), dname(f)) in self.dir_edges:
            return 'dir-edge-reverse-only'
        return 'new'


def parents(tree):
    out = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            out[child] = node
    return out


def call_name(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name):
            return func.value.id + '.' + func.attr if func.value.id in ('apps', 'importlib', 'pkgutil', 'sys', 'ctypes',
                                                                        'os', 'admin', 'checks', 'loader') else func.attr
        return func.attr
    return None


def docstring_nodes(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                ids.add(id(first.value))
    return ids


def context_of(node, par):
    """Short syntactic context of a string constant: the nearest call / keyword / dict key / assignment."""
    child, cur = node, par.get(node)
    in_container = False
    while cur is not None:
        if isinstance(cur, (ast.List, ast.Tuple, ast.Set)):
            in_container = True
        elif isinstance(cur, ast.keyword):
            return 'kw:' + (cur.arg or '**')
        elif isinstance(cur, ast.Call):
            name = call_name(cur.func) or '?'
            pos = 'arg' if child in cur.args else 'other'
            return 'call:{}:{}'.format(name, pos)
        elif isinstance(cur, ast.Dict):
            if child in cur.values:
                k = cur.keys[cur.values.index(child)]
                if isinstance(k, ast.Constant):
                    return 'dictval:' + str(k.value)
                return 'dictval:?'
            if child in cur.keys:
                return 'dictkey'
        elif isinstance(cur, (ast.Assign, ast.AnnAssign)):
            targets = cur.targets if isinstance(cur, ast.Assign) else [cur.target]
            t = targets[0]
            name = t.id if isinstance(t, ast.Name) else (t.attr if isinstance(t, ast.Attribute) else '?')
            owner = par.get(cur)
            scope = 'classattr' if isinstance(owner, ast.ClassDef) else ('module' if isinstance(owner, ast.Module) else 'local')
            return 'assign:{}:{}'.format(scope, name)
        elif isinstance(cur, (ast.Compare, ast.Return, ast.Expr, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef,
                              ast.Module, ast.Lambda, ast.BinOp, ast.JoinedStr, ast.Subscript, ast.Attribute)):
            return 'other:' + type(cur).__name__
        child, cur = cur, par.get(cur)
    return 'other'


def kind_of_context(ctx):
    """Group contexts into wiring kinds (what a runtime loader reads) versus other uses."""
    if ctx.startswith('call:import_string') or ctx.startswith('call:import_module') or ctx.startswith('call:importlib.import_module'):
        return 'import_string/import_module call'
    if ctx.startswith('call:include:') or ctx.startswith('call:get_callable') or ctx.startswith('kw:urlconf') \
            or ctx in ('kw:ROOT_URLCONF', 'assign:module:ROOT_URLCONF', 'assign:classattr:urlconf'):
        return 'URLconf (include / ROOT_URLCONF / urlconf)'
    if ctx.startswith('call:getLogger') or ctx.startswith('call:logging.getLogger'):
        return 'logger name (not a dependency)'
    if ctx.startswith('call:patch:') or ctx.startswith('call:object:') or ctx.startswith('call:mock.patch'):
        return 'mock.patch target (imported by string)'
    m = re.match(r'^(kw|assign:module|assign:classattr|assign:local|dictval):([A-Z][A-Z0-9_]*)$', ctx)
    if m:
        return 'setting value (UPPER_CASE name)'
    if ctx.startswith('dictval:'):
        return 'dict value (BACKEND/ENGINE/class/registry...)'
    if ctx in ('assign:classattr:name', 'assign:classattr:default_auto_field', 'assign:classattr:default_site',
               'assign:classattr:compiler_module') or ctx.startswith('assign:classattr:'):
        return 'class attribute (AppConfig.name, compiler_module, ...)'
    if ctx.startswith('call:override_settings') or ctx.startswith('call:modify_settings') or ctx.startswith('call:settings'):
        return 'setting value (UPPER_CASE name)'
    if ctx.startswith('call:'):
        return 'other call argument'
    return 'other (assertions, messages, comparisons...)'


def main():
    ws, scan_path, out_path = sys.argv[1:4]
    scan = json.load(open(scan_path, encoding='utf-8'))
    ctx = Ctx(scan)
    paths, _ = L.inventory(ws, None)
    material = {}
    for p in paths:
        if L.claimed(p):
            content, reason = L.read_like_capture(os.path.join(ws, *p.split('/')))
            if reason is None:
                material[p] = content
    mpaths = sorted(material)
    res_root = L.Resolver(mpaths, [''])
    res_tests = L.Resolver(mpaths, ['tests', ''])

    def resolve_module(name, from_path):
        for label, r in (('root', res_root), ('tests-root', res_tests)):
            if label == 'tests-root' and not from_path.startswith('tests/'):
                continue
            out = r.resolve_import(name)
            if out[0][0] == 'edge':
                return out[0][1], label
        return None, None

    def resolve_dotted(name, from_path):
        """module path, or module.attr / module.Class.attr path -> (file, how, root)."""
        f, root = resolve_module(name, from_path)
        if f:
            return f, 'module', root
        parts = name.split('.')
        for cut in (1, 2):
            if len(parts) > cut:
                f, root = resolve_module('.'.join(parts[:-cut]), from_path)
                if f:
                    # the attribute (or the class, for module.Class.attr) must be bound at module level in that file,
                    # unless the file has a star import (then we cannot tell)
                    names, star = top_names.get(f, (set(), False))
                    if parts[-cut] in names or star:
                        return f, ('attr' if cut == 1 else 'attr2') + ('-star' if parts[-cut] not in names else ''), root
                    return None, None, None
        return None, None, None

    # --------------------------------------------------------------------------------------- parse once
    trees = {}
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for p in mpaths:
            try:
                trees[p] = ast.parse(material[p])
            except L.PARSE_FAILURES:
                pass

    def bound_names(tree):
        names, star = set(), False
        stack = list(tree.body)
        while stack:
            st = stack.pop()
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(st.name)
            elif isinstance(st, ast.Assign):
                for t in st.targets:
                    for n in ast.walk(t):
                        if isinstance(n, ast.Name):
                            names.add(n.id)
            elif isinstance(st, (ast.AnnAssign, ast.AugAssign)) and isinstance(st.target, ast.Name):
                names.add(st.target.id)
            elif isinstance(st, ast.Import):
                for a in st.names:
                    names.add(a.asname or a.name.split('.')[0])
            elif isinstance(st, ast.ImportFrom):
                for a in st.names:
                    if a.name == '*':
                        star = True
                    else:
                        names.add(a.asname or a.name)
            elif isinstance(st, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                for field in ('body', 'orelse', 'finalbody', 'handlers'):
                    for sub in getattr(st, field, []) or []:
                        stack.extend(sub.body if isinstance(sub, ast.ExceptHandler) else [sub])
        return names, star

    top_names = {p: bound_names(t) for p, t in trees.items()}
    result = {'workspace': ws, 'pythonFilesParsed': len(trees)}

    # --------------------------------------------------------------------------------------- label map (apps)
    label_dirs = collections.defaultdict(set)
    for p, tree in trees.items():
        if p.endswith('/apps.py'):
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    vals = {}
                    for st in node.body:
                        if isinstance(st, ast.Assign) and isinstance(st.targets[0], ast.Name) \
                                and isinstance(st.value, ast.Constant) and isinstance(st.value.value, str):
                            vals[st.targets[0].id] = st.value.value
                    if 'name' in vals:
                        label = vals.get('label') or vals['name'].rsplit('.', 1)[-1]
                        label_dirs[label].add(dname(p))
    for p in mpaths:
        if p.endswith('/models.py') or p.endswith('/models/__init__.py'):
            d = dname(p) if p.endswith('/models.py') else dname(dname(p))
            label_dirs.setdefault(d.rsplit('/', 1)[-1], set()).add(d)
    for p in mpaths:
        parts = p.split('/')
        if len(parts) >= 3 and parts[0] == 'tests':
            label_dirs.setdefault(parts[1], set()).add('tests/' + parts[1])

    def app_dir(label):
        dirs = label_dirs.get(label)
        if not dirs:
            return None, 0
        pref = sorted(dirs, key=lambda d: (0 if d.startswith('django/contrib/') else 1 if d.count('/') == 1 else 2, d))
        return pref[0], len(dirs)

    def models_file(d):
        for cand in (d + '/models.py', d + '/models/__init__.py'):
            if cand in material:
                return cand
        return None

    # --------------------------------------------------------------------------------------- walk every file
    dotted_sites = []
    import_string_calls = {'literal': 0, 'nonLiteral': 0, 'examplesNonLiteral': []}
    model_sites = []
    template_py_sites = []
    lazy = collections.Counter()
    lazy_pairs = collections.defaultdict(set)
    module_getattr = []
    signals = collections.Counter()
    signal_examples = collections.defaultdict(list)
    discovery = collections.defaultdict(list)
    syspath = []
    ctypes_sites = []
    for p, tree in trees.items():
        par = parents(tree)
        docs = docstring_nodes(tree)
        lines = material[p].splitlines()
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
                s = node.value
                if DOTTED.match(s) and not s.startswith('self.') and not MODEL_REF.match(s):
                    c = context_of(node, par)
                    f, how, root = resolve_dotted(s, p)
                    if f is None and not s.split('.')[0] in ('django',) and not p.startswith('tests/'):
                        continue
                    if f is None and p.startswith('tests/'):
                        # keep unresolved only when the first segment looks like a project package
                        top = s.split('.')[0]
                        if not (top == 'django' or ('tests/' + top) in res_root.dirs):
                            continue
                    dotted_sites.append({'from': p, 'line': node.lineno, 'value': s, 'context': c,
                                         'kind': kind_of_context(c), 'to': f, 'how': how, 'root': root})
                m = MODEL_REF.match(s)
                if m:
                    cur = par.get(node)
                    kw = cur.arg if isinstance(cur, ast.keyword) else None
                    call = par.get(cur) if isinstance(cur, ast.keyword) else cur
                    fn = call_name(call.func) if isinstance(call, ast.Call) else None
                    c = context_of(node, par)
                    is_model_ctx = (fn in FIELD_FUNCS and (kw in (None, 'to', 'through'))) or fn in ('get_model', 'apps.get_model') \
                        or 'AUTH_USER_MODEL' in c or (kw in ('to', 'through', 'model'))
                    if is_model_ctx:
                        label, model = m.group(1), m.group(2)
                        d, ndirs = app_dir(label)
                        mf = models_file(d) if d else None
                        model_sites.append({'from': p, 'line': node.lineno, 'value': s, 'context': c,
                                            'to': mf, 'ambiguousLabel': ndirs > 1})
                if TEMPLATE_NAME.match(s):
                    template_py_sites.append({'from': p, 'line': node.lineno, 'value': s, 'context': context_of(node, par)})
            elif isinstance(node, ast.Call):
                fn = call_name(node.func)
                if fn == 'import_string':
                    a = node.args[0] if node.args else None
                    if isinstance(a, ast.Constant) and isinstance(a.value, str):
                        import_string_calls['literal'] += 1
                    else:
                        import_string_calls['nonLiteral'] += 1
                        if len(import_string_calls['examplesNonLiteral']) < 12 and p.startswith('django/'):
                            import_string_calls['examplesNonLiteral'].append('{}:{} {}'.format(
                                p, node.lineno, ast.unparse(a)[:80] if a is not None else ''))
                if fn in ('get_model', 'apps.get_model') and len(node.args) >= 2 \
                        and all(isinstance(a, ast.Constant) and isinstance(a.value, str) for a in node.args[:2]):
                    label, model = node.args[0].value, node.args[1].value
                    d, ndirs = app_dir(label)
                    mf = models_file(d) if d else None
                    model_sites.append({'from': p, 'line': node.lineno, 'value': label + '.' + model,
                                        'context': 'call:get_model(label, model)', 'to': mf, 'ambiguousLabel': ndirs > 1})
                if fn in ('connect',) or fn == 'receiver':
                    signals[fn] += 1
                    if len(signal_examples[fn]) < 5 and p.startswith('django/'):
                        signal_examples[fn].append('{}:{}'.format(p, node.lineno))
                if fn in ('register', 'checks.register', 'admin.register') or (fn == 'register' and isinstance(node.func, ast.Attribute)):
                    signals['register(...)'] += 1
                    if len(signal_examples['register(...)']) < 5 and p.startswith('django/'):
                        signal_examples['register(...)'].append('{}:{}'.format(p, node.lineno))
                if fn in ('autodiscover_modules', 'module_has_submodule', 'pkgutil.iter_modules', 'iter_modules',
                          'walk_packages', 'pkgutil.walk_packages', 'find_spec'):
                    discovery[fn].append('{}:{}'.format(p, node.lineno))
                if fn in ('CDLL', 'ctypes.CDLL', 'LoadLibrary', 'find_library', 'cdll.LoadLibrary', 'PyDLL', 'WinDLL') \
                        and p != 'django/template/defaulttags.py':  # defaulttags.find_library is a template helper
                    a = node.args[0] if node.args else None
                    ctypes_sites.append({'at': '{}:{}'.format(p, node.lineno), 'func': fn,
                                         'arg': ast.unparse(a)[:60] if a is not None else '',
                                         'literal': isinstance(a, ast.Constant)})
                if fn in ('insert', 'append', 'extend') and isinstance(node.func, ast.Attribute) \
                        and ast.unparse(node.func.value) == 'sys.path':
                    syspath.append('{}:{}'.format(p, node.lineno))
                if fn == 'extend_sys_path':
                    syspath.append('{}:{} (extend_sys_path)'.format(p, node.lineno))
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                cur, depth = par.get(node), None
                where = 'module'
                while cur is not None:
                    if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        where = 'function'
                        break
                    if isinstance(cur, ast.If) and 'TYPE_CHECKING' in ast.unparse(cur.test):
                        where = 'TYPE_CHECKING'
                        break
                    if isinstance(cur, ast.Try):
                        where = 'try' if where == 'module' else where
                    cur = par.get(cur)
                lazy[where] += 1
                if where == 'function':
                    if isinstance(node, ast.Import):
                        outs = []
                        for a in node.names:
                            outs += res_root.resolve_import(a.name)
                    else:
                        outs = res_root.resolve_from(p, node.level or 0, node.module, [a.name for a in node.names])
                    for k, v, _ in outs:
                        if k == 'edge' and v != p:
                            lazy_pairs[p].add(v)
            elif isinstance(node, (ast.FunctionDef,)) and node.name == '__getattr__' and isinstance(par.get(node), ast.Module):
                module_getattr.append('{}:{}'.format(p, node.lineno))

    # --------------------------------------------------------------------------------------- dotted paths summary
    def pair_summary(sites, key_to='to'):
        by = collections.Counter()
        pairs = {}
        for s in sites:
            if s.get(key_to):
                pairs[(s['from'], s[key_to])] = ctx.connected(s['from'], s[key_to])
        for v in pairs.values():
            by[v] += 1
        return {'uniquePairs': len(pairs), 'byConnection': dict(by)}

    kinds = collections.defaultdict(list)
    for s in dotted_sites:
        kinds[s['kind']].append(s)
    dotted_summary = {}
    for k, sites in sorted(kinds.items()):
        resolved = [s for s in sites if s['to']]
        by_scope = collections.Counter(('django' if s['from'].startswith('django/') else 'tests' if s['from'].startswith('tests/') else 'other')
                                       for s in sites)
        ex_new = [s for s in resolved if ctx.connected(s['from'], s['to']) == 'new' and s['from'].startswith('django/')][:6]
        ex_new += [s for s in resolved if ctx.connected(s['from'], s['to']) == 'new' and s['from'].startswith('tests/')][:3]
        dotted_summary[k] = {
            'sites': len(sites), 'byScope': dict(by_scope), 'resolved': len(resolved),
            'resolvedViaTestsRoot': sum(1 for s in resolved if s['root'] == 'tests-root'),
            'unresolved': len(sites) - len(resolved),
            'how': dict(collections.Counter(s['how'] for s in resolved)),
            **pair_summary(sites),
            'djangoOnly': dict(sites=sum(1 for s in sites if s['from'].startswith('django/')),
                               **pair_summary([s for s in sites if s['from'].startswith('django/')])),
            'topContexts': dict(collections.Counter(s['context'] for s in sites).most_common(8)),
            'examplesNew': ['{}:{} {!r} [{}] -> {}'.format(s['from'], s['line'], s['value'], s['context'], s['to']) for s in ex_new],
            'examplesUnresolved': ['{}:{} {!r} [{}]'.format(s['from'], s['line'], s['value'], s['context'])
                                   for s in sites if not s['to']][:5],
        }
    wiring_kinds = [k for k in dotted_summary if not k.startswith('other') and not k.startswith('logger')
                    and not k.startswith('mock.patch')]
    wiring = [s for s in dotted_sites if s['kind'] in wiring_kinds]
    result['dottedPathStrings'] = {
        'note': 'string literals that look like dotted Python paths and resolve (module, module.attr or module.Class.attr) '
                'with the light-scan rules; unresolved ones kept only when they start with django or a tests/ package',
        'allSites': len(dotted_sites), 'byKind': dotted_summary,
        'wiringKinds': wiring_kinds,
        'wiringTotal': {'sites': len(wiring), 'resolved': sum(1 for s in wiring if s['to']),
                        'django': sum(1 for s in wiring if s['from'].startswith('django/')),
                        **pair_summary(wiring)},
        'wiringDjangoOnly': pair_summary([s for s in wiring if s['from'].startswith('django/')]),
        'globalSettings': [{'line': s['line'], 'value': s['value'], 'to': s['to'],
                            'connection': ctx.connected(s['from'], s['to']) if s['to'] else None}
                           for s in dotted_sites if s['from'] == 'django/conf/global_settings.py'],
    }
    result['importString'] = import_string_calls

    # --------------------------------------------------------------------------------------- model references
    ms_res = [s for s in model_sites if s['to']]
    result['modelReferences'] = {
        'sites': len(model_sites), 'resolved': len(ms_res), 'ambiguousLabel': sum(1 for s in model_sites if s['ambiguousLabel']),
        'byScope': dict(collections.Counter('django' if s['from'].startswith('django/') else 'tests' for s in model_sites)),
        'contexts': dict(collections.Counter(s['context'].split(':')[0] + ':' + s['context'].split(':')[1] if ':' in s['context'] else s['context']
                                             for s in model_sites).most_common(12)),
        **pair_summary(model_sites),
        'examplesNew': ['{}:{} {!r} -> {}'.format(s['from'], s['line'], s['value'], s['to'])
                        for s in ms_res if ctx.connected(s['from'], s['to']) == 'new'][:8],
        'examplesUnresolved': ['{}:{} {!r}'.format(s['from'], s['line'], s['value']) for s in model_sites if not s['to']][:6],
    }

    # --------------------------------------------------------------------------------------- migrations
    mig = {'files': 0, 'depSites': 0, 'literal': 0, 'swappable': 0, 'special': 0, 'resolvedSameDir': 0,
           'resolvedOtherApp': 0, 'unresolved': 0, 'examplesUnresolved': [], 'examplesOther': []}
    mig_pairs = {}
    for p, tree in trees.items():
        segs = p.split('/')
        if not any(s.startswith('migrations') or s.endswith('migrations') for s in segs[:-1]) or segs[-1] == '__init__.py':
            continue
        cls = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Migration']
        if not cls:
            continue
        mig['files'] += 1
        for st in cls[0].body:
            if isinstance(st, ast.Assign) and isinstance(st.targets[0], ast.Name) \
                    and st.targets[0].id in ('dependencies', 'run_before', 'replaces') and isinstance(st.value, (ast.List, ast.Tuple)):
                for el in st.value.elts:
                    mig['depSites'] += 1
                    if isinstance(el, ast.Tuple) and len(el.elts) == 2 and all(isinstance(x, ast.Constant) for x in el.elts):
                        mig['literal'] += 1
                        label, name = el.elts[0].value, el.elts[1].value
                        if name in ('__first__', '__latest__'):
                            mig['special'] += 1
                            continue
                        same = dname(p) + '/' + name + '.py'
                        # own app label: <app>/migrations/x.py -> <app>; other layouts (MIGRATION_MODULES test dirs) unknown
                        own = dname(dname(p)).rsplit('/', 1)[-1] if dname(p).rsplit('/', 1)[-1] == 'migrations' else None
                        if same in material and same != p and (own is None or label == own):
                            mig['resolvedSameDir'] += 1
                            mig_pairs[(p, same)] = ctx.connected(p, same)
                            continue
                        d, _ = app_dir(label)
                        other = (d + '/migrations/' + name + '.py') if d else None
                        if other and other in material:
                            mig['resolvedOtherApp'] += 1
                            mig_pairs[(p, other)] = ctx.connected(p, other)
                            if len(mig['examplesOther']) < 6:
                                mig['examplesOther'].append('{}:{} ({!r}, {!r}) -> {} [{}]'.format(
                                    p, el.lineno, label, name, other, ctx.connected(p, other)))
                        else:
                            mig['unresolved'] += 1
                            if len(mig['examplesUnresolved']) < 6:
                                mig['examplesUnresolved'].append('{}:{} ({!r}, {!r})'.format(p, el.lineno, label, name))
                    else:
                        mig['swappable'] += 1
    mig['uniquePairs'] = len(mig_pairs)
    mig['byConnection'] = dict(collections.Counter(mig_pairs.values()))
    mig['djangoFiles'] = sum(1 for p in trees if p.startswith('django/') and '/migrations/' in p and not p.endswith('__init__.py'))
    result['migrations'] = mig

    # --------------------------------------------------------------------------------------- convention-discovered modules
    indeg = collections.Counter(t for f, t in ctx.edges)
    indeg_outside_dir = collections.Counter(t for f, t in ctx.edges if dname(f) != dname(t))

    def convention(pattern_ok, label):
        files = [p for p in mpaths if pattern_ok(p)]
        dj = [p for p in files if p.startswith('django/')]
        return {'files': len(files), 'django': len(dj),
                'noIncomingEdge': sum(1 for p in files if indeg[p] == 0),
                'djangoNoIncomingEdge': sum(1 for p in dj if indeg[p] == 0),
                'examplesNoIncoming': [p for p in dj if indeg[p] == 0][:6]}

    result['conventionModules'] = {
        'management commands (*/management/commands/*.py; load_command_class)':
            convention(lambda p: '/management/commands/' in p and not p.endswith('/__init__.py'), 'cmd'),
        'template tag libraries (*/templatetags/*.py; get_installed_libraries)':
            convention(lambda p: '/templatetags/' in p and not p.endswith('/__init__.py'), 'tt'),
        'migrations (*/migrations/*.py; MigrationLoader; not django/db/migrations, not the tests/migrations app itself)':
            convention(lambda p: '/migrations/' in p and not p.endswith('/__init__.py')
                       and not p.startswith('django/db/migrations/') and dname(p) != 'tests/migrations', 'mig'),
        'apps.py (AppConfig discovery)': convention(lambda p: p.endswith('/apps.py'), 'apps'),
        'admin.py (admin.autodiscover)': convention(lambda p: p.endswith('/admin.py'), 'admin'),
        'db backends base.py (load_backend "<ENGINE>.base")':
            convention(lambda p: p.startswith('django/db/backends/') and p.endswith('/base.py'), 'be'),
        'locale formats (django/conf/locale/*/formats.py; get_format_modules)':
            convention(lambda p: p.startswith('django/conf/locale/') and p.endswith('/formats.py'), 'fmt'),
    }

    # --------------------------------------------------------------------------------------- templates (non-Python files)
    text_files = {}
    for p in paths:
        if (p.startswith('django/') or p.startswith('tests/')) and not L.claimed(p) and not p.endswith('.py-tpl'):
            if not re.search(r'\.(html|txt|xml|json|js|css|tpl|email|htm|svg)$', p):
                continue
            c, r = L.read_like_capture(os.path.join(ws, *p.split('/')))
            if r is None:
                text_files[p] = c
    template_roots = sorted({p[:p.index('/templates/') + len('/templates/')] for p in paths if '/templates/' in p} |
                            {p[:p.index('/jinja2/') + len('/jinja2/')] for p in paths if '/jinja2/' in p})
    if any(p.startswith('templates/') for p in paths):
        template_roots.append('templates/')
    paths_set = set(paths)

    def find_template(name):
        return [r + name for r in template_roots if (r + name) in paths_set]

    tt_libs = collections.defaultdict(list)
    for p in mpaths:
        if '/templatetags/' in p and not p.endswith('/__init__.py'):
            tt_libs[p.rsplit('/', 1)[1][:-3]].append(p)
    builtin_tags = {'django/template/defaulttags.py', 'django/template/defaultfilters.py', 'django/template/loader_tags.py'}
    load = {'sites': 0, 'libraryNames': 0, 'resolved': 0, 'ambiguous': 0, 'unresolved': 0, 'unresolvedNames': collections.Counter(),
            'examples': []}
    load_pairs = set()
    extinc = {'sites': 0, 'literal': 0, 'resolved': 0, 'ambiguous': 0, 'nonLiteral': 0, 'unresolvedExamples': [],
              'examples': []}
    for p, c in text_files.items():
        for m in LOAD_TAG.finditer(c):
            load['sites'] += 1
            toks = m.group(1).split()
            names = [toks[-1]] if 'from' in toks else toks
            line = c.count('\n', 0, m.start()) + 1
            for n in names:
                load['libraryNames'] += 1
                cands = tt_libs.get(n) or []
                dj = [x for x in cands if x.startswith('django/')]
                if cands:
                    load['resolved'] += 1
                    target = (dj or cands)[0]
                    load_pairs.add((p, target))
                    if len(set(cands)) > 1:
                        load['ambiguous'] += 1
                    if len(load['examples']) < 5 and p.startswith('django/'):
                        load['examples'].append('{}:{} load {} -> {}'.format(p, line, n, target))
                else:
                    load['unresolved'] += 1
                    load['unresolvedNames'][n] += 1
        for m in EXT_INC_TAG.finditer(c):
            extinc['sites'] += 1
            arg = m.group(2).split()[0]
            line = c.count('\n', 0, m.start()) + 1
            if arg[:1] in '"\'' and arg[-1:] == arg[:1]:
                extinc['literal'] += 1
                hits = find_template(arg[1:-1])
                if hits:
                    extinc['resolved'] += 1
                    extinc['ambiguous'] += len(hits) > 1
                    if len(extinc['examples']) < 5 and p.startswith('django/'):
                        extinc['examples'].append('{}:{} {} {} -> {}'.format(p, line, m.group(1), arg, hits[0]))
                elif len(extinc['unresolvedExamples']) < 5:
                    extinc['unresolvedExamples'].append('{}:{} {} {}'.format(p, line, m.group(1), arg))
            else:
                extinc['nonLiteral'] += 1
    load['unresolvedNames'] = dict(load['unresolvedNames'].most_common(15))
    load['uniqueTemplateToPythonPairs'] = len(load_pairs)
    dj_load = {(f, t) for f, t in load_pairs if f.startswith('django/')}
    load['djangoTemplateToPythonPairs'] = len(dj_load)
    load['djangoTargets'] = sorted({t for f, t in dj_load})
    load['djangoTargetsWithoutIncomingEdge'] = sorted({t for f, t in dj_load if not any(e[1] == t for e in ctx.edges)})
    tpy = {'sites': len(template_py_sites), 'resolved': 0, 'django': 0, 'djangoResolved': 0, 'examples': [], 'contexts': collections.Counter()}
    for s in template_py_sites:
        hits = find_template(s['value'])
        tpy['contexts'][s['context'].split(':')[0] + ':' + s['context'].split(':')[1] if ':' in s['context'] else s['context']] += 1
        if s['from'].startswith('django/'):
            tpy['django'] += 1
        if hits:
            tpy['resolved'] += 1
            if s['from'].startswith('django/'):
                tpy['djangoResolved'] += 1
                if len(tpy['examples']) < 6:
                    tpy['examples'].append('{}:{} {!r} -> {}'.format(s['from'], s['line'], s['value'], hits[0]))
    tpy['contexts'] = dict(tpy['contexts'].most_common(10))
    tpy['djangoUniquePairs'] = len({(s['from'], find_template(s['value'])[0]) for s in template_py_sites
                                    if s['from'].startswith('django/') and find_template(s['value'])})
    tpy['djangoTemplatesReferencedFromPython'] = len({find_template(s['value'])[0] for s in template_py_sites
                                                      if s['from'].startswith('django/') and find_template(s['value'])})
    tpy['djangoTemplateFiles'] = sum(1 for p in paths if p.startswith('django/') and ('/templates/' in p or '/jinja2/' in p))
    result['templates'] = {'templateRoots': len(template_roots), 'textFilesRead': len(text_files),
                           'templateTagLibraries': {k: v for k, v in sorted(tt_libs.items()) if any(x.startswith('django/') for x in v)},
                           'loadTag': load, 'extendsInclude': extinc, 'pythonToTemplateStrings': tpy,
                           'builtinTagModulesAlwaysLoaded': sorted(builtin_tags)}

    # --------------------------------------------------------------------------------------- project template (.py-tpl)
    tpl = {}
    for p in paths:
        if p.endswith('settings.py-tpl'):
            c, r = L.read_like_capture(os.path.join(ws, *p.split('/')))
            if r:
                continue
            text = re.sub(r'{{\s*\w+\s*}}', 'proj', c)
            try:
                t = ast.parse(text)
            except SyntaxError as e:
                tpl[p] = {'error': str(e)}
                continue
            pr = parents(t)
            found = []
            for node in ast.walk(t):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and DOTTED.match(node.value):
                    f, how, root = resolve_dotted(node.value, 'django/x.py')
                    found.append({'line': node.lineno, 'value': node.value, 'context': context_of(node, pr), 'to': f})
            tpl[p] = {'dottedStrings': len(found), 'resolved': sum(1 for x in found if x['to']),
                      'distinctTargets': len({x['to'] for x in found if x['to']}),
                      'items': ['{} {!r} [{}] -> {}'.format(x['line'], x['value'], x['context'], x['to']) for x in found]}
    result['projectTemplateSettings'] = tpl

    # --------------------------------------------------------------------------------------- the rest
    lazy_only = 0
    lazy_total = 0
    module_level_pairs = set()
    for p, tree in trees.items():
        pass
    for f, ts in lazy_pairs.items():
        for t in ts:
            lazy_total += 1
    result['lazyImports'] = {'importStatementsByPlace': dict(lazy),
                             'note': 'function-level, try and TYPE_CHECKING imports are all collected by the light scan',
                             'functionLevelResolvedPairs': lazy_total}
    result['moduleGetattr'] = module_getattr
    result['registries'] = {'counts': dict(signals), 'examples': {k: v for k, v in signal_examples.items()}}
    result['discoveryCalls'] = {k: {'count': len(v), 'examples': v[:6]} for k, v in discovery.items()}
    result['sysPathChanges'] = {'count': len(syspath), 'sites': syspath}
    result['ctypes'] = ctypes_sites
    result['nonLiteralImportlib'] = len(scan.get('dynamic', {}).get('nonLiteral', []))

    with open(out_path, 'w', encoding='utf-8') as h:
        json.dump(result, h, ensure_ascii=False, indent=1, default=list)
    raw = {'dottedSites': [dict(s, connection=ctx.connected(s['from'], s['to']) if s['to'] else None) for s in dotted_sites],
           'modelSites': [dict(s, connection=ctx.connected(s['from'], s['to']) if s['to'] else None) for s in model_sites],
           'wiringKinds': wiring_kinds}
    with open(out_path[:-5] + '-sites.json', 'w', encoding='utf-8') as h:
        json.dump(raw, h, ensure_ascii=False)
    print('done', out_path)


if __name__ == '__main__':
    main()
