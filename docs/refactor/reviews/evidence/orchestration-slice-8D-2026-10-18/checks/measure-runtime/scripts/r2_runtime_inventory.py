#!/usr/bin/env python3
"""Runtime / non-import dependency inventory of ros2/demos, compared with the light scan's edges.

Run only as (from a working directory outside the clone; nothing in the clone is executed or imported):
  python3 -I r2_runtime_inventory.py --src SRC --build BUILD --results RESULTS --out OUT.json --text OUT.txt

  SRC      the clone (data only)
  BUILD    the configure-only build root (per-package dirs; generated rclcpp_components mains are read as data)
  RESULTS  holds light-eval-ref.json (C/C++ light scan + draft-4 rules), reference.ndjson + compile_commands.merged.json
           (where the true compile resolved each #include), py-ws.json / py-pkg-*.json (Python light scan),
           cmake-targets.json (CMake File API)

Every site is found by reading text: C/C++ with comments blanked (strings kept) and a balanced-parenthesis argument
splitter; Python with the standard-library ast (parse only); launch XML with ElementTree; launch YAML with yaml.safe_load.
"""
import argparse
import ast
import collections
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

try:
    import yaml  # system PyYAML (python3-yaml); safe_load only
except Exception:  # pragma: no cover
    yaml = None

CPP_EXT = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}
VIS = 'visibility_control.h'


# ----------------------------------------------------------------------------------------------- text helpers
def read(path):
    with open(path, encoding='utf-8', errors='replace') as handle:
        return handle.read()


def blank_cpp_comments(text):
    out, i, n = list(text), 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            out[i] = out[i + 1] = ' '
            i += 2
            while i < n and not (text[i] == '*' and i + 1 < n and text[i + 1] == '/'):
                if text[i] != '\n':
                    out[i] = ' '
                i += 1
            if i < n:
                out[i] = out[i + 1] = ' '
                i += 2
            continue
        if c == 'R' and i + 1 < n and text[i + 1] == '"' and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == '_')):
            m = re.match(r'R"([^(\s]{0,16})\(', text[i:])
            if m:
                end = text.find(')' + m.group(1) + '"', i + m.end())
                i = n if end < 0 else end + len(m.group(1)) + 2
                continue
        if c in '"\'':
            q = c
            i += 1
            while i < n and text[i] != q and text[i] != '\n':
                i += 2 if text[i] == '\\' else 1
            i += 1
            continue
        i += 1
    return ''.join(out)


def line_of(text, offset):
    return text.count('\n', 0, offset) + 1


def split_args(text, open_idx):
    """text[open_idx] == '('; returns ([(arg, start_offset)], close_idx)."""
    depth, i, n = 0, open_idx, len(text)
    args, start = [], open_idx + 1
    while i < n:
        c = text[i]
        if c in '"\'':
            q = c
            i += 1
            while i < n and text[i] != q:
                i += 2 if text[i] == '\\' else 1
            i += 1
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                args.append((text[start:i], start))
                return [(a.strip(), s) for a, s in args if a.strip() or len(args) > 1], i
        elif c == ',' and depth == 1:
            args.append((text[start:i], start))
            start = i + 1
        i += 1
    return [(a.strip(), s) for a, s in args], n


def balance_angle(text, idx):
    """text[idx] == '<'; returns (inner, index after '>')."""
    depth, i = 0, idx
    while i < len(text):
        if text[i] == '<':
            depth += 1
        elif text[i] == '>':
            depth -= 1
            if depth == 0:
                return text[idx + 1:i], i + 1
        elif text[i] in ';{}':
            break
        i += 1
    return None, idx


STR_RE = re.compile(r'^"((?:[^"\\]|\\.)*)"$')


def cpp_resolve_name(arg, blanked, _depth=0, _site=None):
    """-> (status, values, detail)."""
    a = arg.strip()
    m = STR_RE.match(a)
    if m:
        return 'literal', [m.group(1)], None
    m = re.match(r'^std::string\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)$', a)
    if m:
        return 'literal', [m.group(1)], None
    m = re.match(r'^([A-Za-z_]\w*)\s*\+\s*"((?:[^"\\]|\\.)*)"$', a)
    if m and not _depth:
        st, vals, _ = cpp_resolve_name(m.group(1), blanked, _depth, _site)
        if vals:
            return st + ' + literal', [v + m.group(2) for v in vals], a[:80]
        return 'non-literal', [], a[:80]
    ident = re.sub(r'^(?:this->|\*)', '', a)
    ident = re.sub(r'\.c_str\(\)$', '', ident)
    if not re.match(r'^[A-Za-z_]\w*$', ident):
        return 'non-literal', [], a[:80]
    vals, kind = [], 'same-file constant'
    for pat in (r'\b%s\s*=\s*"((?:[^"\\]|\\.)*)"', r'\b%s\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)', r'\b%s\s*\{\s*"((?:[^"\\]|\\.)*)"\s*\}'):
        vals += re.findall(pat % re.escape(ident), blanked)
    pvals = re.findall(r'\b%s\s*=\s*(?:this->|\w+->)?declare_parameter(?:<[^>]*>)?\s*\(\s*"[^"]*"\s*,\s*"((?:[^"\\]|\\.)*)"' % re.escape(ident), blanked)
    if not vals and pvals:
        vals, kind = pvals, 'parameter default'
    vals = sorted(set(vals))
    if len(vals) == 1:
        return kind, vals, ident
    if len(vals) > 1:
        return 'ambiguous', vals, ident
    if not _depth:
        ctor = cpp_ctor_argument(ident, blanked, _site)
        if ctor:
            return ctor
    return 'non-literal', [], ident


def cpp_ctor_argument(ident, blanked, site=None):
    """ident is a constructor parameter (directly, or a member initialised from one): the literal passed by an
    instantiation make_shared<Class>(...) / Class var(...) in the SAME file, at the same position."""
    m = re.search(r'\b%s\s*\(\s*([A-Za-z_]\w*)\s*\)' % re.escape(ident), blanked)   # member initialiser x_(x)
    param = m.group(1) if m and m.group(1) != ident else ident
    vals = set()
    cands = []
    for cm in re.finditer(r'\b([A-Z]\w*)\s*\(', blanked):
        args, _ = split_args(blanked, cm.end() - 1)
        pos = next((k for k, (arg, _) in enumerate(args) if re.search(r'[&\s]%s\s*(?:=.*)?$' % re.escape(param), arg)
                    and re.search(r'\bstd::string\b|\bchar\b', arg)), None)
        if pos is not None:
            cands.append((cm.start(), cm.group(1), pos))
    if site is not None and any(c[0] <= site for c in cands):
        cands = [max((c for c in cands if c[0] <= site), key=lambda c: c[0])]
    for _start, cls, pos in cands:
        for im in re.finditer(r'(?:make_shared<%s>|make_unique<%s>|\b%s\s+\w+)\s*\(' % (cls, cls, cls), blanked):
            iargs, _ = split_args(blanked, im.end() - 1)
            if len(iargs) > pos:
                st, v, _ = cpp_resolve_name(iargs[pos][0], blanked, 1)
                vals |= set(v)
    if vals:
        return 'same-file constructor argument', sorted(vals), param
    return None


# ----------------------------------------------------------------------------------------------- C/C++ sites
CPP_API = {
    'create_publisher': ('topic', 'pub', 0), 'create_subscription': ('topic', 'sub', 0),
    'create_service': ('service', 'server', 0), 'create_client': ('service', 'client', 0),
    'create_generic_publisher': ('topic', 'pub', 0), 'create_generic_subscription': ('topic', 'sub', 0),
}
CPP_ACTION_API = {'create_server': ('action', 'server', 1), 'create_client': ('action', 'client', 1)}
API_RE = re.compile(r'\b(rclcpp_action::)?(create_publisher|create_subscription|create_service|create_client|create_server|'
                    r'create_generic_publisher|create_generic_subscription)\b\s*')


def cpp_type(type_text, blanked):
    if not type_text:
        return None
    t = re.sub(r'\s+', '', type_text)
    m = re.search(r'\busing\s+%s\s*=\s*([\w:]+)\s*;' % re.escape(t), blanked)
    if m:
        t = m.group(1)
    t = t.lstrip(':')
    if t.count('::') == 2 and re.match(r'^\w+::(msg|srv|action)::\w+$', t):
        return t.replace('::', '/')
    return 'cpp:' + t


def cpp_comm_sites(rel, text):
    blanked = blank_cpp_comments(text)
    sites = []
    for m in API_RE.finditer(blanked):
        prefix, api = m.group(1), m.group(2)
        if api == 'create_server' and not prefix:
            continue
        kind, role, idx = (CPP_ACTION_API[api] if prefix else CPP_API[api])
        j = m.end()
        type_text = None
        if j < len(blanked) and blanked[j] == '<':
            type_text, j = balance_angle(blanked, j)
            if type_text is None:
                continue
        while j < len(blanked) and blanked[j] in ' \t\n':
            j += 1
        if j >= len(blanked) or blanked[j] != '(':
            continue
        args, _ = split_args(blanked, j)
        if api.startswith('create_generic'):
            type_text = None
        if len(args) <= idx:
            continue
        status, vals, detail = cpp_resolve_name(args[idx][0], blanked, 0, m.start())
        if prefix and status == 'non-literal':
            lit = next((x for x, _ in args if STR_RE.match(x)), None)
            if lit:
                status, vals, detail = 'literal', [STR_RE.match(lit).group(1)], 'node-interfaces overload'
        sites.append({'file': rel, 'line': line_of(blanked, m.start()), 'lang': 'cpp', 'api': (prefix or '') + api, 'kind': kind,
                      'role': role, 'name_status': status, 'names': vals, 'detail': detail,
                      'type': cpp_type(type_text, blanked)})
    return sites, blanked


def cpp_node_names(rel, blanked):
    names = []
    for m in re.finditer(r'(?:\b(?:rclcpp::)?Node|\b(?:rclcpp_lifecycle::)?LifecycleNode|make_shared<rclcpp::Node>|Node::make_shared|'
                         r'make_shared<rclcpp_lifecycle::LifecycleNode>)\s*\(\s*', blanked):
        args, _ = split_args(blanked, m.end() - 1) if blanked[m.end() - 1] == '(' else ([], 0)
        if not args:
            continue
        status, vals, detail = cpp_resolve_name(args[0][0], blanked)
        lifecycle = 'LifecycleNode' in m.group(0)
        logger_here = any('enable_logger_service' in x and 'true' in x for x, _ in args)
        if status == 'non-literal' and detail and re.match(r'^\w+$', detail):
            # a constructor parameter: look for make_shared<Class>("lit") / Class var("lit") in the same file
            cls = re.findall(r'class\s+(\w+)\s*(?:final\s*)?:\s*public\s+(?:rclcpp::Node|rclcpp_lifecycle::LifecycleNode)', blanked)
            lits = []
            for c in cls:
                lits += re.findall(r'make_shared<%s>\s*\(\s*"([^"]+)"' % re.escape(c), blanked)
                lits += re.findall(r'\b%s\s+\w+\s*\(\s*"([^"]+)"' % re.escape(c), blanked)
            if lits:
                status, vals = 'same-file constructor argument', sorted(set(lits))
        names.append({'file': rel, 'line': line_of(blanked, m.start()), 'lifecycle': lifecycle, 'status': status, 'names': vals,
                      'logger_service': logger_here})
    return names, [n for n in names if n['logger_service']]


CPP_RUNTIME_PATTERNS = [
    ('dlopen/dlsym/LoadLibrary', r'\b(dlopen|dlsym|dlmopen|LoadLibrary[AW]?|GetProcAddress)\s*\('),
    ('class_loader', r'\bclass_loader::(?:ClassLoader|MultiLibraryClassLoader)\b|\b(?:createInstance|createUniqueInstance|createSharedInstance|getAvailableClasses)\s*<'),
    ('rcpputils::SharedLibrary', r'\brcpputils::SharedLibrary\b'),
    ('pluginlib', r'\bPLUGINLIB_EXPORT_CLASS\s*\(|\bpluginlib::ClassLoader\b'),
    ('CLASS_LOADER_REGISTER_CLASS', r'\bCLASS_LOADER_REGISTER_CLASS\s*\('),
    ('RCLCPP_COMPONENTS_REGISTER_NODE', r'\bRCLCPP_COMPONENTS_REGISTER_NODE\s*\(\s*([\w:]+)\s*\)'),
    ('ament_index lookup', r'\bament_index_cpp::get_\w+\s*\('),
    ('std::bind callback', r'\bstd::bind\s*\(\s*&'),
    ('timer callback', r'\bcreate_(?:wall_)?timer\s*\('),
    ('parameter callback registry', r'\badd_on_set_parameters_callback\s*\(|\badd_post_set_parameters_callback\s*\(|\badd_pre_set_parameters_callback\s*\(|'
                                    r'\badd_parameter_callback\s*\(|\badd_parameter_event_callback\s*\('),
    ('parameters client', r'\b(?:Sync|Async)ParametersClient\b\s*>?\s*\('),
    ('ParameterEventHandler', r'\bParameterEventHandler\b\s*>\s*\('),
]


# ----------------------------------------------------------------------------------------------- Python sites
PY_API = {
    'create_publisher': ('topic', 'pub', 1, 'topic'), 'create_lifecycle_publisher': ('topic', 'pub', 1, 'topic'),
    'create_subscription': ('topic', 'sub', 1, 'topic'), 'create_service': ('service', 'server', 1, 'srv_name'),
    'create_client': ('service', 'client', 1, 'srv_name'),
}
PY_CLS = {'ActionServer': ('action', 'server', 2, 'action_name'), 'ActionClient': ('action', 'client', 2, 'action_name')}


class PyFile:
    def __init__(self, rel, text):
        self.rel, self.tree = rel, ast.parse(text)
        self.parents = {}
        for node in ast.walk(self.tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        self.imports = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                for a in node.names:
                    self.imports[a.asname or a.name] = node.module + '.' + a.name
            elif isinstance(node, ast.Import):
                for a in node.names:
                    self.imports[a.asname or a.name.split('.')[0]] = a.name if a.asname else a.name.split('.')[0]

    def enclosing(self, node, kinds):
        while node in self.parents:
            node = self.parents[node]
            if isinstance(node, kinds):
                return node
        return None

    def resolve(self, expr):
        if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
            return 'literal', [expr.value], None
        if isinstance(expr, ast.Name):
            vals = []
            fn = self.enclosing(expr, (ast.FunctionDef, ast.AsyncFunctionDef))
            scopes = [fn] if fn else []
            scopes.append(self.tree)
            for scope in scopes:
                for node in ast.walk(scope):
                    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == expr.id for t in node.targets) \
                            and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                        vals.append(node.value.value)
                if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = scope.args.args
                    defaults = scope.args.defaults
                    for a, d in zip(args[len(args) - len(defaults):], defaults):
                        if a.arg == expr.id and isinstance(d, ast.Constant) and isinstance(d.value, str):
                            return 'default argument', [d.value], expr.id
                if vals:
                    break
            vals = sorted(set(vals))
            if len(vals) == 1:
                return 'same-file constant', vals, expr.id
            if vals:
                return 'ambiguous', vals, expr.id
            ctor = self.ctor_argument(expr.id, fn)
            if ctor:
                return ctor
            return 'non-literal', [], expr.id
        if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add) and isinstance(expr.right, ast.Constant) \
                and isinstance(expr.right.value, str):
            st, v, _ = self.resolve(expr.left)
            if v:
                return st + ' + literal', [x + expr.right.value for x in v], ast.unparse(expr)[:80]
            return 'non-literal', [], ast.unparse(expr)[:80]
        if isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Name) and expr.value.id == 'self':
            cls = self.enclosing(expr, (ast.ClassDef,))
            vals = []
            for node in ast.walk(cls or self.tree):
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Attribute) and t.attr == expr.attr for t in node.targets):
                    st, v, _ = self.resolve(node.value) if not isinstance(node.value, ast.Attribute) else ('non-literal', [], None)
                    vals += v
            vals = sorted(set(vals))
            if len(vals) == 1:
                return 'same-file constant', vals, 'self.' + expr.attr
            if vals:
                return 'ambiguous', vals, 'self.' + expr.attr
            return 'non-literal', [], 'self.' + expr.attr
        return 'non-literal', [], ast.unparse(expr)[:80]

    def ctor_argument(self, param, fn):
        """param of __init__ of class C (no usable default): literal passed by C(...) calls in the same file."""
        if not fn or fn.name != '__init__':
            return None
        cls = self.enclosing(fn, (ast.ClassDef,))
        names = [x.arg for x in fn.args.args]
        if not cls or param not in names:
            return None
        pos = names.index(param) - 1
        vals = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == cls.name:
                arg = node.args[pos] if len(node.args) > pos else next((k.value for k in node.keywords if k.arg == param), None)
                if arg is not None:
                    st, v, _ = self.resolve(arg)
                    vals |= set(v)
        if vals:
            return 'same-file constructor argument', sorted(vals), param
        return None

    def type_of(self, expr):
        if isinstance(expr, ast.Name):
            full = self.imports.get(expr.id)
            if full:
                parts = full.split('.')
                if len(parts) == 3 and parts[1] in ('msg', 'srv', 'action'):
                    return '/'.join(parts)
            return 'py:' + expr.id
        if isinstance(expr, ast.Attribute):
            dotted = ast.unparse(expr)
            parts = dotted.split('.')
            if len(parts) >= 3 and parts[-2] in ('msg', 'srv', 'action'):
                return '/'.join(parts[-3:])
            return 'py:' + dotted
        return None

    def comm_sites(self):
        sites = []
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            spec, api = None, None
            if isinstance(node.func, ast.Attribute) and node.func.attr in PY_API:
                api = node.func.attr
                spec = PY_API[api]
            elif isinstance(node.func, ast.Name) and node.func.id in PY_CLS:
                api = node.func.id
                spec = PY_CLS[api]
            if not spec:
                continue
            kind, role, idx, kw = spec
            expr = node.args[idx] if len(node.args) > idx else next((k.value for k in node.keywords if k.arg == kw), None)
            texpr = node.args[idx - 1] if len(node.args) >= idx else next((k.value for k in node.keywords if k.arg in ('msg_type', 'srv_type', 'action_type')), None)
            if expr is None:
                continue
            status, vals, detail = self.resolve(expr)
            sites.append({'file': self.rel, 'line': node.lineno, 'lang': 'py', 'api': api, 'kind': kind, 'role': role,
                          'name_status': status, 'names': vals, 'detail': detail, 'type': self.type_of(texpr) if texpr is not None else None})
        return sites

    def node_names(self):
        names, lifecycle_mod = [], any(v.startswith('rclpy.lifecycle') for v in self.imports.values())
        logger = False
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            is_super_init = isinstance(f, ast.Attribute) and f.attr == '__init__' and isinstance(f.value, ast.Call) \
                and isinstance(f.value.func, ast.Name) and f.value.func.id == 'super'
            is_ctor = (isinstance(f, ast.Name) and f.id in ('Node', 'LifecycleNode')) or \
                (isinstance(f, ast.Attribute) and f.attr == 'create_node')
            if not (is_super_init or is_ctor):
                continue
            logger_here = any(k.arg == 'enable_logger_service' and isinstance(k.value, ast.Constant) and k.value.value is True for k in node.keywords)
            expr = node.args[0] if node.args else next((k.value for k in node.keywords if k.arg == 'node_name'), None)
            if expr is None:
                continue
            status, vals, _ = self.resolve(expr)
            names.append({'file': self.rel, 'line': node.lineno, 'lifecycle': lifecycle_mod, 'status': status, 'names': vals,
                          'logger_service': logger_here})
        return names, [n for n in names if n['logger_service']]

    def launch_entries(self):
        out = []
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            fname = node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id if isinstance(node.func, ast.Name) else None
            if fname not in ('Node', 'LifecycleNode', 'ComposableNode', 'ComposableNodeContainer', 'IncludeLaunchDescription',
                             'ExecuteProcess', 'LoadComposableNodes'):
                continue
            kws = {}
            for k in node.keywords:
                if k.arg in ('package', 'executable', 'plugin', 'name', 'namespace', 'node_executable', 'cmd'):
                    st, v, d = self.resolve(k.value)
                    kws[k.arg] = v[0] if len(v) == 1 else ('<%s: %s>' % (st, d or ast.unparse(k.value)[:60]))
                elif k.arg in ('remappings', 'parameters', 'arguments'):
                    kws[k.arg] = ast.unparse(k.value)[:160]
            if fname == 'IncludeLaunchDescription':
                kws['source'] = ast.unparse(node.args[0])[:200] if node.args else None
            out.append({'file': self.rel, 'line': node.lineno, 'action': fname, **kws})
        return out


# ----------------------------------------------------------------------------------------------- graph helpers
class Graph:
    def __init__(self, pairs):
        self.out = collections.defaultdict(set)
        self.und = collections.defaultdict(set)
        for a, b in pairs:
            self.out[a].add(b)
            self.und[a].add(b)
            self.und[b].add(a)

    def reach(self, start, adj, skip=frozenset()):
        seen, stack = {start}, [start]
        while stack:
            x = stack.pop()
            for y in adj.get(x, ()):
                if y not in seen and y not in skip:
                    seen.add(y)
                    stack.append(y)
        return seen

    def directed_path(self, a, b):
        return b in self.reach(a, self.out) or a in self.reach(b, self.out)

    def common_reachable(self, a, b, skip_names=()):
        skip = {x for x in set(self.out) | {y for s in self.out.values() for y in s} if os.path.basename(x) in skip_names}
        ra, rb = self.reach(a, self.out, skip), self.reach(b, self.out, skip)
        return sorted((ra & rb) - {a, b} - skip)

    def common_ancestor(self, a, b):
        rev = collections.defaultdict(set)
        for x, ys in self.out.items():
            for y in ys:
                rev[y].add(x)
        ra, rb = self.reach(a, rev), self.reach(b, rev)
        return sorted((ra & rb) - {a, b})

    def undirected_path(self, a, b, skip_names=()):
        skip = {x for x in self.und if os.path.basename(x) in skip_names}
        return b in self.reach(a, self.und, skip)


# ----------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--build', required=True)
    ap.add_argument('--results', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--text', required=True)
    ap.add_argument('--hand', help='JSON list {file, line, names, category, evidence}: hand-resolved names of non-literal sites')
    a = ap.parse_args()
    src, R = os.path.realpath(a.src), a.results
    T = []

    with open(os.path.join(R, 'git-not-ignored.z'), 'rb') as handle:
        files = sorted(p.decode() for p in handle.read().split(b'\0') if p)

    # packages
    packages = {}
    for f in files:
        if f.endswith('package.xml'):
            x = read(os.path.join(src, f))
            name = re.search(r'<name>([^<]+)</name>', x).group(1)
            bt = re.search(r'<build_type>([^<]+)</build_type>', x)
            deps = sorted(set(re.findall(r'<(?:depend|build_depend|exec_depend|test_depend|build_export_depend)>([^<]+)<', x)))
            packages[name] = {'dir': os.path.dirname(f), 'build_type': bt.group(1) if bt else None, 'deps': deps,
                              'deps_lines': {d: x[:x.find('>' + d + '<')].count('\n') + 1 for d in deps}}
    pkg_dirs = sorted(((v['dir'], k) for k, v in packages.items()), key=lambda t: -len(t[0]))

    def pkg_of(rel):
        for d, n in pkg_dirs:
            if rel == d or rel.startswith(d + '/'):
                return n
        return None
    interface_files = collections.defaultdict(list)
    for f in files:
        m = re.match(r'(.*)/(msg|srv|action)/(\w+)\.(msg|srv|action)$', f)
        if m and pkg_of(f):
            interface_files[pkg_of(f)].append(f)
    with open(os.path.join(R, 'packages.json'), 'w') as handle:
        json.dump({k: v['dir'] for k, v in packages.items()}, handle, indent=1)

    # light-scan edges
    light = json.load(open(os.path.join(R, 'light-eval-ref.json'), encoding='utf-8'))
    cpp_edges = [tuple(e) for e in light['edge_list']]
    py_ws = json.load(open(os.path.join(R, 'py-ws.json'), encoding='utf-8'))
    py_edges_ws = [(e[0], e[1]) for e in py_ws['edges']]
    py_edges_pkg = []
    for path in sorted(glob.glob(os.path.join(R, 'py-pkg-*.json'))):
        d = json.load(open(path, encoding='utf-8'))
        base = os.path.relpath(d['workspace'], src)
        py_edges_pkg += [(base + '/' + e[0], base + '/' + e[1]) for e in d['edges']]
    G = Graph(cpp_edges + py_edges_ws)
    Gp = Graph(cpp_edges + py_edges_ws + py_edges_pkg)
    pkg_edges = {(pkg_of(x), pkg_of(y)) for x, y in cpp_edges + py_edges_ws}
    pkg_edges_p = {(pkg_of(x), pkg_of(y)) for x, y in cpp_edges + py_edges_ws + py_edges_pkg}
    T.append('light edges: C/C++ %d, Python (whole repo) %d, Python (per package) %d; package pairs with an edge (excluding same package): %d'
             % (len(cpp_edges), len(py_edges_ws), len(py_edges_pkg), sum(1 for p, q in pkg_edges_p if p != q)))

    # ---- scan sources
    comm, node_names, runtime_sites = [], [], collections.defaultdict(list)
    logger_nodes, launch = [], []
    py_files = {}
    component_classes = {}
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        full = os.path.join(src, f)
        if ext in CPP_EXT:
            text = read(full)
            sites, blanked = cpp_comm_sites(f, text)
            comm += sites
            names, logger = cpp_node_names(f, blanked)
            node_names += names
            logger_nodes += logger
            for kind, pat in CPP_RUNTIME_PATTERNS:
                for m in re.finditer(pat, blanked):
                    entry = {'file': f, 'line': line_of(blanked, m.start()), 'text': text.split('\n')[line_of(blanked, m.start()) - 1].strip()[:140]}
                    if kind == 'RCLCPP_COMPONENTS_REGISTER_NODE':
                        entry['class'] = m.group(1)
                        component_classes[m.group(1)] = f
                    runtime_sites[kind].append(entry)
        elif ext == '.py':
            text = read(full)
            try:
                pf = PyFile(f, text)
            except SyntaxError:
                continue
            py_files[f] = pf
            comm += pf.comm_sites()
            names, logger = pf.node_names()
            node_names += names
            logger_nodes += logger
            launch += [dict(e, format='py') for e in pf.launch_entries()]
            for node in ast.walk(pf.tree):
                if isinstance(node, ast.Call):
                    fn = ast.unparse(node.func)
                    if fn in ('importlib.import_module', 'import_module', '__import__'):
                        runtime_sites['py importlib/__import__'].append({'file': f, 'line': node.lineno, 'text': ast.unparse(node)[:140]})
                    elif fn.endswith('get_package_share_directory') or fn.endswith('get_package_prefix') or fn.endswith('FindPackageShare'):
                        runtime_sites['py ament index / package share lookup'].append({'file': f, 'line': node.lineno, 'text': ast.unparse(node)[:140]})
                if isinstance(node, (ast.Import, ast.ImportFrom)) and pf.enclosing(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    runtime_sites['py import inside a function (light scan collects it)'].append({'file': f, 'line': node.lineno, 'text': ast.unparse(node)[:140]})
        elif f.endswith('.xml') and '/launch/' in '/' + f:
            root = ET.fromstring(read(full))
            for el in root.iter():
                if el.tag in ('node', 'include', 'composable_node', 'executable'):
                    launch.append({'file': f, 'line': None, 'format': 'xml', 'action': el.tag, 'package': el.get('pkg'),
                                   'executable': el.get('exec'), 'plugin': el.get('plugin'), 'name': el.get('name'),
                                   'source': el.get('file'), 'remappings': [(r.get('from'), r.get('to')) for r in el.findall('remap')] or None})
            text = read(full)
            for e in launch:
                if e['file'] == f and e['line'] is None and e.get('executable'):
                    m = re.search(r'exec="%s"' % re.escape(e['executable']), text)
                    e['line'] = line_of(text, m.start()) if m else None
        elif (f.endswith('.yaml') or f.endswith('.yml')) and '/launch/' in '/' + f and yaml:
            text = read(full)
            data = yaml.safe_load(text)
            for item in (data or {}).get('launch', []) if isinstance(data, dict) else []:
                for key, val in item.items():
                    if key in ('node', 'include') and isinstance(val, dict):
                        m = re.search(r'exec:\s*"?%s"?' % re.escape(str(val.get('exec'))), text) if val.get('exec') else None
                        launch.append({'file': f, 'line': line_of(text, m.start()) if m else None, 'format': 'yaml', 'action': key,
                                       'package': val.get('pkg'), 'executable': val.get('exec'), 'name': val.get('name'),
                                       'source': val.get('file'), 'remappings': val.get('remap')})

    # plugin description XML (pluginlib) and CMake-side registrations
    for f in files:
        if f.endswith('.xml') and not f.endswith('package.xml'):
            x = read(os.path.join(src, f))
            if re.search(r'<library\s+path=', x) or 'base_class_type' in x:
                runtime_sites['pluginlib plugin description XML'].append({'file': f, 'line': 1, 'text': x[:100]})
        if os.path.basename(f) == 'CMakeLists.txt':
            x = read(os.path.join(src, f))
            for m in re.finditer(r'\b(rclcpp_components_register_nodes?|pluginlib_export_plugin_description_file|configure_file|'
                                 r'rosidl_generate_interfaces)\s*\(([^)]*)\)', x):
                runtime_sites['cmake ' + m.group(1)].append({'file': f, 'line': line_of(x, m.start()), 'text': ' '.join(m.group(0).split())[:160]})

    # generated rclcpp_components mains (configure output, read as data): executable -> class
    exe_class = {}
    for path in sorted(glob.glob(os.path.join(a.build, '*', 'rclcpp_components', 'node_main_*.cpp'))):
        pkg = path.split(os.sep)[-3]
        exe = os.path.basename(path)[len('node_main_'):-4]
        x = read(path)
        m = re.search(r'NodeFactoryTemplate<([\w:]+)>', x)
        lib = re.search(r'library_name = "([^"]+)"', x)
        exe_class[(pkg, exe)] = {'class': m.group(1) if m else None, 'library': lib.group(1) if lib else None}
    runtime_sites['generated rclcpp_components main (build dir, dlopen + class name)'] = [
        {'file': 'build/%s/rclcpp_components/node_main_%s.cpp' % k, 'line': None, 'text': '%s in %s' % (v['class'], v['library'])}
        for k, v in sorted(exe_class.items())]

    # ---- CMake targets (File API)
    cm = json.load(open(os.path.join(R, 'cmake-targets.json'), encoding='utf-8'))
    exe_sources = {}
    for pkg, d in cm.items():
        for t in d.get('targets', []):
            if t['type'] == 'EXECUTABLE':
                exe_sources[(pkg, t['name'])] = t['workspace_sources']

    # python entry points (setup.py console_scripts) and data_files
    entry_points = []
    for f, pf in py_files.items():
        if os.path.basename(f) != 'setup.py':
            continue
        pdir = os.path.dirname(f)
        for node in ast.walk(pf.tree):
            if isinstance(node, ast.Call) and ast.unparse(node.func) == 'setup':
                for k in node.keywords:
                    if k.arg == 'entry_points' and isinstance(k.value, ast.Dict):
                        for key, val in zip(k.value.keys, k.value.values):
                            if isinstance(val, (ast.List, ast.Tuple)):
                                for el in val.elts:
                                    if isinstance(el, ast.Constant) and isinstance(el.value, str):
                                        name, _, target = el.value.partition('=')
                                        mod = target.strip().split(':')[0]
                                        cands = [pdir + '/' + mod.replace('.', '/') + '.py', pdir + '/' + mod.replace('.', '/') + '/__init__.py']
                                        tgt = next((c for c in cands if c in py_files), None)
                                        entry_points.append({'file': f, 'line': el.lineno, 'group': ast.literal_eval(key) if isinstance(key, ast.Constant) else None,
                                                             'name': name.strip(), 'module': mod, 'target_file': tgt,
                                                             'edge_from_setup': bool(tgt) and G.directed_path(f, tgt)})
    exe_py = {(pkg_of(e['file']), e['name']): e['target_file'] for e in entry_points}

    def resolve_executable(pkg, exe):
        if pkg not in packages:
            return [], 'external package'
        if (pkg, exe) in exe_py:
            return [exe_py[(pkg, exe)]] if exe_py[(pkg, exe)] else [], 'ament_python console_scripts entry point'
        srcs = exe_sources.get((pkg, exe))
        if srcs:
            return srcs, 'CMake executable target sources'
        if (pkg, exe) in exe_class:
            cls = exe_class[(pkg, exe)]['class']
            f = component_classes.get(cls)
            return ([f] if f else []), 'generated component main -> RCLCPP_COMPONENTS_REGISTER_NODE(%s)' % cls
        return [], 'not found in workspace'

    # ---- launch entries -> files
    launch_rows = []
    for e in launch:
        if e['action'] in ('Node', 'LifecycleNode', 'node', 'ComposableNode', 'composable_node'):
            pkg, exe, plugin = e.get('package'), e.get('executable'), e.get('plugin')
            literal = all(isinstance(v, str) and not v.startswith('<') for v in ([pkg] + ([exe] if exe else [plugin])) if True)
            if plugin:
                tf = component_classes.get(plugin)
                targets, how = ([tf] if tf else []), 'component plugin class'
            elif literal:
                targets, how = resolve_executable(pkg, exe)
            else:
                targets, how = [], 'non-literal'
            row = dict(e, literal=literal, targets=targets, how=how,
                       file_edge=any(G.directed_path(e['file'], t) for t in targets),
                       file_path_undirected=any(Gp.undirected_path(e['file'], t) for t in targets),
                       same_package=bool(targets) and pkg_of(targets[0]) == pkg_of(e['file']),
                       package_edge=any((pkg_of(e['file']), pkg_of(t)) in pkg_edges_p for t in targets) and not (bool(targets) and pkg_of(targets[0]) == pkg_of(e['file'])))
            launch_rows.append(row)
        else:
            launch_rows.append(dict(e, literal=None, targets=[], how='other launch action'))

    # ---- implicit services/topics from node names
    implicit = []
    for n in node_names:
        for name in n['names']:
            if n['lifecycle']:
                for s in ('change_state', 'get_state', 'get_available_states', 'get_available_transitions', 'get_transition_graph'):
                    implicit.append({'file': n['file'], 'line': n['line'], 'lang': 'cpp' if n['file'].endswith(('.cpp', '.hpp', '.h')) else 'py',
                                     'api': 'implicit lifecycle service', 'kind': 'service', 'role': 'server', 'name_status': 'implicit (' + n['status'] + ')',
                                     'names': [name + '/' + s], 'detail': None, 'type': None})
                implicit.append({'file': n['file'], 'line': n['line'], 'lang': 'cpp' if n['file'].endswith(('.cpp', '.hpp', '.h')) else 'py',
                                 'api': 'implicit lifecycle transition_event', 'kind': 'topic', 'role': 'pub', 'name_status': 'implicit (' + n['status'] + ')',
                                 'names': [name + '/transition_event'], 'detail': None, 'type': 'lifecycle_msgs/msg/TransitionEvent'})
    for n in logger_nodes:
        for name in n['names']:
            for s in ('get_logger_levels', 'set_logger_levels'):
                implicit.append({'file': n['file'], 'line': n['line'], 'lang': 'cpp' if n['file'].endswith(('.cpp', '.hpp', '.h')) else 'py',
                                 'api': 'implicit logger service', 'kind': 'service', 'role': 'server', 'name_status': 'implicit (' + n['status'] + ')',
                                 'names': [name + '/' + s], 'detail': None, 'type': None})

    # ---- hand-resolved names (cross-file data flow, runtime-only) for the non-literal sites
    hand_rows = json.load(open(a.hand, encoding='utf-8')) if a.hand else []
    hand_index = {(h['file'], h['line']): h for h in hand_rows}
    hand_applied = []
    for site in comm:
        h = hand_index.get((site['file'], site['line']))
        if h and site['name_status'] == 'non-literal':
            site['name_status'] = 'hand: ' + h['category']
            site['names'] = h['names']
            site['evidence'] = h['evidence']
            hand_applied.append((site['file'], site['line']))
    hand_missing = sorted(set(hand_index) - set(hand_applied))

    # ---- communication graph
    def norm(name):
        return name.lstrip('/')
    endpoints = collections.defaultdict(lambda: collections.defaultdict(list))  # (kind, name) -> role -> [site]
    for s in comm + implicit:
        for name in s['names']:
            endpoints[(s['kind'], norm(name))][s['role']].append(s)
    pairs = []
    role_pairs = {'topic': ('pub', 'sub'), 'service': ('server', 'client'), 'action': ('server', 'client')}
    for (kind, name), roles in sorted(endpoints.items()):
        prov, cons = role_pairs[kind]
        for p in roles.get(prov, []):
            for c in roles.get(cons, []):
                tp, tc = p.get('type'), c.get('type')
                type_ok = None if (not tp or not tc or tp.startswith(('cpp:', 'py:')) or tc.startswith(('cpp:', 'py:'))) else (tp == tc)
                if p['kind'] == 'service' and type_ok is None and tp and tc and tp == tc:
                    type_ok = True
                pairs.append({'kind': kind, 'name': name, 'from': p['file'], 'from_line': p['line'], 'to': c['file'], 'to_line': c['line'],
                              'from_lang': p['lang'], 'to_lang': c['lang'], 'type_from': tp, 'type_to': tc, 'type_match': type_ok,
                              'implicit': 'implicit' in p['api'] or 'implicit' in c['api'],
                              'name_status': (p['name_status'], c['name_status'])})
    for pr in pairs:
        a_, b_ = pr['from'], pr['to']
        pr['same_file'] = a_ == b_
        pr['same_package'] = pkg_of(a_) == pkg_of(b_)
        pr['direct_edge'] = (b_ in G.out.get(a_, ())) or (a_ in G.out.get(b_, ()))
        pr['directed_path'] = G.directed_path(a_, b_)
        pr['directed_path_with_pkg_python'] = Gp.directed_path(a_, b_)
        pr['common_header'] = G.common_reachable(a_, b_)
        pr['common_header_excl_visibility'] = G.common_reachable(a_, b_, skip_names=(VIS,))
        pr['common_includer'] = G.common_ancestor(a_, b_)
        pr['package_edge'] = (pkg_of(a_), pkg_of(b_)) in pkg_edges_p or (pkg_of(b_), pkg_of(a_)) in pkg_edges_p
    # file-pair dedupe (a communicating pair of files, any topic)
    file_pairs = {}
    for pr in pairs:
        if pr['same_file'] or pr['type_match'] is False:
            continue
        key = tuple(sorted((pr['from'], pr['to'])))
        file_pairs.setdefault(key, []).append(pr)

    # launch-confirmed pairs: both files are started by the same launch file
    started = collections.defaultdict(set)
    for r in launch_rows:
        for t in r.get('targets') or []:
            started[r['file']].add(t)
    launch_confirmed = {k: sorted(f for f, ts in started.items() if k[0] in ts and k[1] in ts) for k in file_pairs}
    launch_confirmed = {k: v for k, v in launch_confirmed.items() if v}

    # ---- cmake link deps vs include edges
    link_rows = []
    direct_includes = collections.defaultdict(set)
    for x, y in cpp_edges:
        direct_includes[x].add(y)
    for pkg, d in sorted(cm.items()):
        tmap = {t['name']: t for t in d.get('targets', [])}
        for t in d.get('targets', []):
            for dep in t['same_package_deps']:
                if dep['kind'] != 'link' or dep['target'] not in tmap:
                    continue
                b = tmap[dep['target']]
                b_iface = set(b['workspace_sources']) | {h for s_ in b['workspace_sources'] for h in direct_includes.get(s_, ())}
                reach_a = set()
                for s_ in t['workspace_sources']:
                    reach_a |= G.reach(s_, G.out)
                hit = sorted(reach_a & b_iface)
                hit_strict = [h for h in hit if os.path.basename(h) != VIS]
                link_rows.append({'package': pkg, 'from_target': t['name'], 'to_target': b['name'], 'from_sources': t['workspace_sources'],
                                  'own': bool(t['workspace_sources']) and bool(b['workspace_sources']),
                                  'to_sources': b['workspace_sources'], 'include_connected': bool(hit_strict),
                                  'only_via_visibility_header': bool(hit) and not hit_strict, 'via': hit_strict[:5]})
            for other in t['links_other_workspace_packages']:
                link_rows.append({'package': pkg, 'from_target': t['name'], 'to_package': other, 'cross_package': True,
                                  'from_sources': t['workspace_sources'],
                                  'include_connected': any((pkg, other) == (pkg_of(x), pkg_of(y)) for x, y in cpp_edges)})
    declared = []
    for name, p in sorted(packages.items()):
        for dep in p['deps']:
            if dep in packages and dep != name:
                declared.append({'package': name, 'depends_on': dep, 'file': p['dir'] + '/package.xml', 'line': p['deps_lines'][dep],
                                 'edge_between_packages': (name, dep) in pkg_edges_p})

    # ---- unresolved includes: classify by where the true compile (reference mode) found them
    db = json.load(open(os.path.join(R, 'compile_commands.merged.json'), encoding='utf-8'))
    where = {}
    for line in open(os.path.join(R, 'reference.ndjson'), encoding='utf-8'):
        row = json.loads(line)
        for x in row.get('inclusions', []) or []:
            if x['file'].startswith(src + '/'):
                where.setdefault((os.path.relpath(x['file'], src), x['line']), x['resolved'])
    sites_by_pair = collections.defaultdict(list)
    for line in open(os.path.join(R, 'light.ndjson'), encoding='utf-8'):
        row = json.loads(line)
        for x in row.get('inclusions', []) or []:
            if x['file'].startswith(src + '/'):
                rel = os.path.relpath(x['file'], src)
                spec = ('<%s>' % x['spelled']) if x['delim'] == '<' else ('"%s"' % x['spelled'])
                sites_by_pair[(rel, spec)].append(x['line'])
    build_root = os.path.realpath(a.build)
    iface_pkgs = set(interface_files)

    def classify(rel, spec, lines):
        inner = spec[1:-1]
        seg = inner.split('/')
        if len(seg) == 3 and seg[0] in iface_pkgs and seg[1] in ('msg', 'srv', 'action') and seg[2].endswith(('.hpp', '.h')):
            camel = ''.join(w.capitalize() for w in os.path.splitext(seg[2])[0].split('_'))
            cand = '%s/%s/%s.%s' % (packages[seg[0]]['dir'], seg[1], camel, seg[1])
            return 'workspace interface (rosidl generated)', cand if cand in files else None
        res = next((where.get((rel, ln)) for ln in lines if where.get((rel, ln))), None)
        if res is None:
            return 'not found by the true compile either', None
        if res.startswith(build_root):
            return 'generated in the build dir', None
        if res.startswith('/opt/ros/'):
            p = res.split('/include/', 1)[1].split('/')[0] if '/include/' in res else '?'
            return ('ROS underlay copy of a workspace package' if p in packages else 'ROS (opt/ros/jazzy)'), None
        if '/c++/' in res or res.startswith('/usr/lib/gcc'):
            return 'C/C++ standard library', None
        if res.startswith('/usr/include/'):
            sub = res[len('/usr/include/'):].split('/')[0]
            if sub in ('opencv4', 'eigen3', 'boost', 'pcl-1.14', 'x86_64-linux-gnu') and sub != 'x86_64-linux-gnu':
                return 'third-party system library (%s)' % sub, None
            return 'system / libc', None
        return 'other: ' + res[:40], None
    unresolved_classes = collections.Counter()
    unresolved_examples = collections.defaultdict(list)
    generated_map = []
    for f_, spec, reason in light['unresolved_list']:
        cls, iface = classify(f_, spec, sites_by_pair.get((f_, spec), []))
        unresolved_classes[cls] += 1
        if len(unresolved_examples[cls]) < 5:
            unresolved_examples[cls].append('%s:%s %s' % (f_, (sites_by_pair.get((f_, spec)) or ['?'])[0], spec))
        if iface is not None or cls.startswith('workspace interface'):
            generated_map.append({'from': f_, 'line': (sites_by_pair.get((f_, spec)) or [None])[0], 'spec': spec, 'interface_file': iface,
                                  'from_package': pkg_of(f_), 'interface_package': spec[1:-1].split('/')[0],
                                  'package_edge': (pkg_of(f_), spec[1:-1].split('/')[0]) in pkg_edges_p})
    # python: generated interface modules
    py_generated = []
    for u in py_ws['unresolved']:
        seg = u['specifier'].split('.')
        if seg[0] in iface_pkgs and len(seg) >= 2 and seg[1] in ('msg', 'srv', 'action'):
            py_generated.append({'from': u['from'], 'spec': u['specifier']})
    py_unres = collections.Counter()
    stdlib = set(sys.stdlib_module_names)
    rospy_dir = '/opt/ros/jazzy/lib/python3.12/site-packages'
    ros_py = set(os.listdir(rospy_dir)) if os.path.isdir(rospy_dir) else set()
    ws_py_pkgs = {os.path.basename(os.path.dirname(f)) for f in py_files if f.endswith('__init__.py')}
    for u in py_ws['unresolved']:
        s0 = u['specifier'].split('.')[0]
        if not s0:
            py_unres['relative'] += 1
        elif s0 in iface_pkgs:
            py_unres['workspace interface package (generated Python)'] += 1
        elif s0 in ws_py_pkgs:
            py_unres['workspace Python package under a package directory (not an import root)'] += 1
        elif s0 in stdlib:
            py_unres['standard library'] += 1
        elif s0 in ros_py:
            py_unres['ROS (opt/ros/jazzy Python)'] += 1
        else:
            py_unres['other third-party (pytest, matplotlib, setuptools...)'] += 1

    out = {
        'packages': {k: {'dir': v['dir'], 'build_type': v['build_type'], 'interface_files': interface_files.get(k, [])} for k, v in packages.items()},
        'light_edges': {'cpp': len(cpp_edges), 'py_ws': len(py_edges_ws), 'py_pkg': len(py_edges_pkg),
                        'cross_package_pairs': sorted([list(p) for p in pkg_edges_p if p[0] != p[1]])},
        'runtime_sites': {k: v for k, v in sorted(runtime_sites.items())},
        'comm_sites': comm, 'implicit_sites': implicit, 'node_names': node_names, 'pairs': pairs,
        'file_pairs': {'%s <-> %s' % k: [{'kind': p['kind'], 'name': p['name']} for p in v] for k, v in sorted(file_pairs.items())},
        'launch': launch_rows, 'launch_confirmed_pairs': {'%s <-> %s' % k: v for k, v in sorted(launch_confirmed.items())},
        'hand_applied': hand_applied, 'hand_missing': hand_missing, 'entry_points': entry_points, 'cmake_links': link_rows, 'declared_package_deps': declared,
        'unresolved_include_classes': dict(unresolved_classes), 'unresolved_include_examples': dict(unresolved_examples),
        'generated_interface_includes': generated_map, 'py_generated_interface_imports': py_generated, 'py_unresolved_classes': dict(py_unres),
    }

    # ---------------------------------------------------------------- text summary
    def ex(rows, n=5, fmt=lambda r: '%s:%s' % (r['file'], r['line'])):
        return '; '.join(fmt(r) for r in rows[:n])
    T.append('packages: %d (%s)' % (len(packages), dict(collections.Counter(v['build_type'] for v in packages.values()))))
    T.append('interface files: %s' % {k: len(v) for k, v in interface_files.items()})
    T.append('\n== runtime sites by kind (count; examples)')
    for k, v in sorted(runtime_sites.items()):
        T.append('  %-70s %4d  %s' % (k, len(v), ex(v, 4, lambda r: '%s:%s %s' % (r['file'], r['line'], r['text'][:70]))))
    T.append('\n== communication sites (explicit): %d' % len(comm))
    c1 = collections.Counter((s['lang'], s['kind'], s['role']) for s in comm)
    T.append('  by lang/kind/role: %s' % dict(sorted(c1.items())))
    c2 = collections.Counter(s['name_status'] for s in comm)
    T.append('  name status: %s' % dict(c2))
    for st in c2:
        T.append('    %s: %s' % (st, ex([s for s in comm if s['name_status'] == st], 5,
                                         lambda r: '%s:%s %s(%s)' % (r['file'], r['line'], r['api'], ','.join(r['names']) or r['detail']))))
    T.append('  implicit endpoints (lifecycle/logger services from node names): %d from %d node-name sites (%s)'
             % (len(implicit), len(node_names), dict(collections.Counter(n['status'] for n in node_names))))
    T.append('\n== communication graph')
    T.append('  endpoint names: %d; provider->consumer pairs (site level): %d' % (len(endpoints), len(pairs)))
    T.append('  pairs by kind: %s' % dict(collections.Counter(p['kind'] for p in pairs)))
    T.append('  type mismatch (same name, different literal types, not communicating): %d' % sum(1 for p in pairs if p['type_match'] is False))
    real = [p for p in pairs if p['type_match'] is not False]
    T.append('  same-file pairs: %d' % sum(1 for p in real if p['same_file']))
    T.append('  type-mismatch pairs: %s' % ['%s:%s -> %s:%s %s (%s vs %s)' % (p['from'], p['from_line'], p['to'], p['to_line'], p['name'], p['type_from'], p['type_to'])
                                         for p in pairs if p['type_match'] is False])
    fp = list(file_pairs.items())
    T.append('  distinct communicating FILE pairs (different files, types not known to differ): %d' % len(fp))

    def agg(pred):
        return sum(1 for k, v in fp if pred(k, v))
    T.append('    cross-language (C++ <-> Python): %d' % agg(lambda k, v: v[0]['from_lang'] != v[0]['to_lang']))
    T.append('    same package: %d; different packages: %d' % (agg(lambda k, v: v[0]['same_package']), agg(lambda k, v: not v[0]['same_package'])))
    T.append('    with a direct light edge: %d' % agg(lambda k, v: v[0]['direct_edge']))
    T.append('    with a directed include/import path (either way): %d' % agg(lambda k, v: v[0]['directed_path']))
    T.append('    ... counting per-package Python roots too: %d' % agg(lambda k, v: v[0]['directed_path_with_pkg_python']))
    T.append('    sharing a reachable project header: %d (excluding visibility_control.h: %d)'
             % (agg(lambda k, v: bool(v[0]['common_header'])), agg(lambda k, v: bool(v[0]['common_header_excl_visibility']))))
    T.append('    included (directly or not) by one common file: %d %s' % (agg(lambda k, v: bool(v[0]['common_includer'])),
             ['%s <-> %s by %s' % (k[0], k[1], v[0]['common_includer'][:2]) for k, v in fp if v[0]['common_includer']][:6]))
    T.append('    different packages with any light edge between the packages: %d' % agg(lambda k, v: not v[0]['same_package'] and v[0]['package_edge']))
    T.append('    NO include/import path at all (no direct, no directed path, no shared header excl. visibility): %d'
             % agg(lambda k, v: not v[0]['directed_path_with_pkg_python'] and not v[0]['common_header_excl_visibility']))
    T.append('  examples of pairs with no path:')
    for k, v in [x for x in fp if not x[1][0]['directed_path_with_pkg_python'] and not x[1][0]['common_header_excl_visibility']][:12]:
        p = v[0]
        T.append('    %s:%s -> %s:%s  [%s %s]' % (p['from'], p['from_line'], p['to'], p['to_line'], p['kind'], p['name']))
    T.append('  launch-confirmed file pairs (both started by one launch file): %d; with a directed path %d; sharing a header excl. visibility %d; %s'
             % (len(launch_confirmed), sum(1 for k in launch_confirmed if file_pairs[k][0]['directed_path_with_pkg_python']),
                sum(1 for k in launch_confirmed if file_pairs[k][0]['common_header_excl_visibility']),
                ['%s <-> %s via %s' % (k[0], k[1], v[0]) for k, v in sorted(launch_confirmed.items())][:12]))
    T.append('  hand-resolved sites applied: %d (missing %s); by category %s' % (len(hand_applied), hand_missing,
             dict(collections.Counter(s_['name_status'] for s_ in comm if s_['name_status'].startswith('hand')))))
    T.append('  topics/services/actions by name (provider count / consumer count):')
    for (kind, name), roles in sorted(endpoints.items()):
        prov, cons = role_pairs[kind]
        T.append('    %-8s %-45s %2d / %2d  files %s' % (kind, name, len(roles.get(prov, [])), len(roles.get(cons, [])),
                 sorted({x['file'].split('/')[0] for r_ in roles.values() for x in r_})))
    T.append('  examples of pairs WITH a path:')
    for k, v in [x for x in fp if x[1][0]['directed_path_with_pkg_python'] or x[1][0]['common_header_excl_visibility']][:8]:
        p = v[0]
        T.append('    %s -> %s [%s %s] direct=%s via=%s' % (p['from'], p['to'], p['kind'], p['name'], p['direct_edge'], p['common_header_excl_visibility'][:2]))
    T.append('\n== launch files')
    nodes_l = [r for r in launch_rows if r['how'] != 'other launch action']
    T.append('  launch actions: %d (node-like %d) in %d files; formats %s' % (len(launch_rows), len(nodes_l), len({r['file'] for r in launch_rows}),
                                                                           dict(collections.Counter(r['format'] for r in launch_rows))))
    T.append('  node-like: literal %d; resolved to a workspace file %d; external package %d; how %s'
             % (sum(1 for r in nodes_l if r['literal']), sum(1 for r in nodes_l if r['targets']), sum(1 for r in nodes_l if r['how'] == 'external package'),
                dict(collections.Counter(r['how'].split(' -> ')[0] for r in nodes_l))))
    T.append('  of those resolved: with a light edge launch->target %d; any undirected path %d; same package %d'
             % (sum(1 for r in nodes_l if r['targets'] and r['file_edge']), sum(1 for r in nodes_l if r['targets'] and r['file_path_undirected']),
                sum(1 for r in nodes_l if r['targets'] and r['same_package'])))
    for r in nodes_l[:8]:
        T.append('    %s:%s %s(%s, %s) -> %s' % (r['file'], r['line'], r['action'], r.get('package'), r.get('executable') or r.get('plugin'), r['targets']))
    T.append('  remappings in launch: %s' % [(r['file'], r.get('remappings')) for r in launch_rows if r.get('remappings')])
    T.append('\n== python entry points: %d, resolved %d, with a light edge from setup.py %d; e.g. %s'
             % (len(entry_points), sum(1 for e in entry_points if e['target_file']), sum(1 for e in entry_points if e['edge_from_setup']),
                ex(entry_points, 4, lambda e: '%s:%s %s=%s -> %s' % (e['file'], e['line'], e['name'], e['module'], e['target_file']))))
    T.append('\n== CMake link dependencies between own targets')
    own = [r for r in link_rows if not r.get('cross_package') and r.get('own')]
    T.append('  own-source targets (both sides have workspace sources): %d; include-connected %d; not connected %d: %s'
             % (len(own), sum(1 for r in own if r['include_connected']), sum(1 for r in own if not r['include_connected']),
                ['%s -> %s' % (r['from_target'], r['to_target']) for r in own if not r['include_connected']]))
    gen_links = [r for r in link_rows if not r.get('cross_package') and not r.get('own')]
    T.append('  links involving generated-only targets (rosidl): %d; from own-source targets to generated targets: %s'
             % (len(gen_links), sorted({'%s -> %s' % (r['from_target'], r['to_target']) for r in gen_links if r['from_sources']})))
    same = [r for r in link_rows if not r.get('cross_package') and r.get('own')]
    T.append('  same-package link deps: %d; include-connected %d; only via visibility_control.h %d; none %d'
             % (len(same), sum(1 for r in same if r['include_connected']), sum(1 for r in same if r['only_via_visibility_header']),
                sum(1 for r in same if not r['include_connected'] and not r['only_via_visibility_header'])))
    for r in same:
        T.append('    %s: %s -> %s connected=%s via=%s' % (r['package'], r['from_target'], r['to_target'], r['include_connected'], r['via'][:2]))
    cross = [r for r in link_rows if r.get('cross_package')]
    T.append('  cross-package link lines to workspace packages (served by the underlay here): %d %s'
             % (len(cross), sorted({(r['package'], r['to_package']) for r in cross})))
    T.append('  declared package.xml deps between workspace packages: %d; with a light edge between the packages: %d; %s'
             % (len(declared), sum(1 for d in declared if d['edge_between_packages']), [(d['package'], d['depends_on']) for d in declared]))
    T.append('\n== unresolved C/C++ includes (unique (file, specifier)) by what the true compile found: %s' % dict(unresolved_classes))
    for k, v in unresolved_examples.items():
        T.append('    %s: %s' % (k, '; '.join(v[:4])))
    T.append('  workspace interface includes: %d; mapped to an interface file %d; from packages %s'
             % (len(generated_map), sum(1 for g in generated_map if g['interface_file']), dict(collections.Counter((g['from_package'], g['interface_package']) for g in generated_map))))
    T.append('  python unresolved by class: %s; generated interface imports %d %s' % (dict(py_unres), len(py_generated), py_generated[:4]))
    with open(a.out, 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1, ensure_ascii=False, default=list)
    with open(a.text, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(T) + '\n')
    print('\n'.join(T))


if __name__ == '__main__':
    main()
