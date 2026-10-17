#!/usr/bin/env python3
"""Runtime / non-import dependency inventory for the user's ROS 2 SLAM workspace copy (measurement only).

Run only as (stdlib only; never from inside the copy):

    python3 -I slam_runtime_inventory.py ROOT CPP_LIGHT_NDJSON PY_SCAN_JSON OUT_JSON

ROOT              the copy (~/dsh-work/measure-cpp/copies/slam-ros2-ws), read only
CPP_LIGHT_NDJSON  light-mode output of light_include_scan.py (the include edges of the light scan)
PY_SCAN_JSON      output of light_import_scan.py (the Python edges of the light scan)

What it extracts (static, from literals only; nothing is executed, YAML is read with a small indentation reader):
  * light-scan edges (file pairs and package pairs)
  * C/C++: create_publisher / create_subscription / create_service / create_client / timers, rclcpp_action, image_transport,
    TF sendTransform frame pairs, declare_parameter / get_parameter, popen / system, dlopen / dlsym / LoadLibrary,
    pluginlib, rclcpp_components, std::bind callback registrations (count only)
  * Python nodes: the same calls through ast, ActionClient / ActionServer, TF frames, declare_parameter
  * launch files (.launch.py through ast): Node(package, executable, name, parameters, remappings, condition),
    IncludeLaunchDescription paths, ExecuteProcess commands, DeclareLaunchArgument defaults
  * CMake: targets, own-target link dependencies, ament_target_dependencies, cross-package include dirs,
    install(PROGRAMS / DIRECTORY), -D macros used for runtime paths
  * package.xml dependencies on own packages (and names that are not packages of this workspace)
  * YAML: ros_gz_bridge topic table, *_topic parameters, parameter keys per file; URDF/SDF gz plugins and topics;
    rviz topics; shell scripts that start project files
Then it joins publishers and subscribers by literal topic name and checks every pair against the light-scan edges.
"""
import ast
import collections
import json
import os
import re
import sys

SRC = 'ros2_ws/src'
CPP_EXT = ('.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.ipp', '.inl')


# ---------------------------------------------------------------------------------------------- helpers

def rel_files(root):
    out = []
    for cur, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in ('.git', '__pycache__'))
        for name in files:
            full = os.path.join(cur, name)
            if os.path.islink(full):
                continue
            out.append(os.path.relpath(full, root).replace(os.sep, '/'))
    return sorted(out)


def read(root, rel):
    with open(os.path.join(root, *rel.split('/')), 'r', encoding='utf-8', errors='replace') as h:
        return h.read()


def package_of(rel):
    if rel.startswith(SRC + '/'):
        return rel.split('/')[2]
    return '(root)'


def line_of(text, offset):
    return text.count('\n', 0, offset) + 1


def strip_cpp_comments(text):
    """Replace // and /* */ comments with spaces (newlines kept); string and char literals untouched."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in text[i:j]))
            i = j
        elif c in '"\'':
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def balanced_args(text, open_paren):
    """Text between the parenthesis at open_paren and its partner, and the top-level comma-split arguments."""
    depth, i, n = 0, open_paren, len(text)
    start = open_paren + 1
    args, cur_start = [], start
    while i < n:
        c = text[i]
        if c in '"\'' and not (i > 0 and text[i - 1] == '\\'):   # CMake's \" outside a quoted argument is a plain quote
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == '\\' else 1
            i = j + 1
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                args.append(text[cur_start:i].strip())
                return text[start:i], args
        elif c == ',' and depth == 1:
            args.append(text[cur_start:i].strip())
            cur_start = i + 1
        i += 1
    return text[start:], args


STRING_RE = re.compile(r'^"((?:[^"\\]|\\.)*)"$')


def cpp_literal(arg):
    m = STRING_RE.match(arg.strip())
    return m.group(1) if m else None


# ---------------------------------------------------------------------------------------------- light-scan edges

def load_cpp_edges(path, root_abs):
    edges, unresolved = set(), []
    prefix = root_abs.rstrip('/') + '/'
    with open(path, encoding='utf-8') as h:
        for line in h:
            rec = json.loads(line)
            if rec.get('mode') != 'light' or rec.get('status') != 'ok':
                continue
            for inc in rec['inclusions']:
                src = inc['file']
                if not src.startswith(prefix):
                    continue
                src_rel = src[len(prefix):]
                tgt = inc.get('resolved')
                if tgt and tgt.startswith(prefix):
                    edges.add((src_rel, tgt[len(prefix):]))
                elif not tgt:
                    unresolved.append((src_rel, inc['line'], inc.get('delim'), inc.get('spelled')))
    return edges, sorted(set(unresolved))


def load_py_edges(path):
    with open(path, encoding='utf-8') as h:
        data = json.load(h)
    return {(e[0], e[1]) for e in data['edges']}, data


# ---------------------------------------------------------------------------------------------- C/C++ sites

ROS_CALLS = re.compile(r'\b(create_publisher|create_subscription|create_service|create_client|create_wall_timer|create_timer|'
                       r'create_generic_publisher|create_generic_subscription)\s*(<(?:[^<>;{}]|<[^<>;{}]*>)*>)?\s*\(')
ACTION_CALLS = re.compile(r'\brclcpp_action::(create_server|create_client)\s*(<(?:[^<>;{}]|<[^<>;{}]*>)*>)?\s*\(')
IT_CALLS = re.compile(r'\b(\w+)\s*(?:\.|->)\s*(advertise|subscribe|advertiseCamera|subscribeCamera)\s*\(')
DECLARE_RE = re.compile(r'\bdeclare_parameter\s*(<(?:[^<>;{}]|<[^<>;{}]*>)*>)?\s*\(')
GETPARAM_RE = re.compile(r'\bget_parameter\s*\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)')
SEND_TF_RE = re.compile(r'\bsendTransform\s*\(')
PROC_RE = re.compile(r'\b(popen|system|execv|execvp|execl|fork)\s*\(')
DL_RE = re.compile(r'\b(dlopen|dlsym|LoadLibrary\w*|GetProcAddress)\s*\(')
PLUGIN_RE = re.compile(r'\b(PLUGINLIB_EXPORT_CLASS|pluginlib::ClassLoader|class_loader::|RCLCPP_COMPONENTS_REGISTER_NODE|'
                       r'rclcpp_components::)')
BIND_RE = re.compile(r'std::bind\s*\(\s*&(\w+)::(\w+)')
PARAM_CLIENT_RE = re.compile(r'\b(SyncParametersClient|AsyncParametersClient)\b')
# vikit_ros reads parameters through its own helpers (params_helper.h): getParam<T>(nh, "name"...) and
# getRemoteParam<T>(nh, remote_node, "name"...); only literal names are collected (ns + "/x" forms are not literal)
READ_PARAM_RE = re.compile(r'\b(getParam|getRemoteParam)\s*<[^<>;]*>\s*\(')
ROOT_DIR_RE = re.compile(r'\b(ROOT_DIR|DEBUG_FILE_DIR)\b')


def cpp_sites(root, files):
    sites = collections.defaultdict(list)
    params = {}            # param name -> (file, line, default literal or text)
    var_param = {}         # (file, var) -> param name
    for rel in files:
        raw = read(root, rel)
        text = strip_cpp_comments(raw)
        for m in GETPARAM_RE.finditer(text):
            var_param[(rel, m.group(2))] = m.group(1)
        for m in DECLARE_RE.finditer(text):
            _, args = balanced_args(text, m.end() - 1)
            name = cpp_literal(args[0]) if args else None
            if name is not None:
                params.setdefault(name, (rel, line_of(text, m.start()), args[1] if len(args) > 1 else None))
        for m in ROS_CALLS.finditer(text):
            kind = m.group(1)
            _, args = balanced_args(text, m.end() - 1)
            first = args[0] if args else ''
            sites['cpp_' + kind].append({'file': rel, 'line': line_of(text, m.start()), 'type': (m.group(2) or '').strip('<>'),
                                         'arg': first, 'literal': cpp_literal(first)})
        for m in ACTION_CALLS.finditer(text):
            _, args = balanced_args(text, m.end() - 1)
            name = args[1] if len(args) > 1 else ''
            sites['cpp_action_' + m.group(1)].append({'file': rel, 'line': line_of(text, m.start()), 'arg': name,
                                                      'literal': cpp_literal(name)})
        for m in IT_CALLS.finditer(text):
            _, args = balanced_args(text, m.end() - 1)
            first = args[0] if args else ''
            sites['cpp_image_transport_' + m.group(2)].append({'file': rel, 'line': line_of(text, m.start()), 'arg': first,
                                                               'literal': cpp_literal(first)})
        for m in SEND_TF_RE.finditer(text):
            body, _ = balanced_args(text, m.end() - 1)
            lits = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
            sites['cpp_tf_sendTransform'].append({'file': rel, 'line': line_of(text, m.start()),
                                                  'frames': lits[-2:] if len(lits) >= 2 else lits})
        for m in PROC_RE.finditer(text):
            body, _ = balanced_args(text, m.end() - 1)
            sites['cpp_process_' + m.group(1)].append({'file': rel, 'line': line_of(text, m.start()), 'arg': body.strip()[:120]})
        for m in DL_RE.finditer(text):
            sites['cpp_dl_' + m.group(1)].append({'file': rel, 'line': line_of(text, m.start())})
        for m in PLUGIN_RE.finditer(text):
            sites['cpp_plugin_' + m.group(1).rstrip(':')].append({'file': rel, 'line': line_of(text, m.start())})
        for m in PARAM_CLIENT_RE.finditer(text):
            sites['cpp_param_client_' + m.group(1)].append({'file': rel, 'line': line_of(text, m.start())})
        for m in READ_PARAM_RE.finditer(text):
            _, args = balanced_args(text, m.end() - 1)
            idx = 2 if m.group(1) == 'getRemoteParam' else 1
            name = cpp_literal(args[idx]) if len(args) > idx else None
            sites['cpp_param_read_' + m.group(1)].append({'file': rel, 'line': line_of(text, m.start()), 'name': name,
                                                          'arg': args[idx] if len(args) > idx else None,
                                                          'remote_node_arg': args[1] if m.group(1) == 'getRemoteParam' and len(args) > 1 else None})
        for m in BIND_RE.finditer(text):
            sites['cpp_callback_bind'].append({'file': rel, 'line': line_of(text, m.start()), 'target': m.group(1) + '::' + m.group(2)})
        seen_lines = set()
        for m in ROOT_DIR_RE.finditer(text):
            ln = line_of(text, m.start())
            if ln in seen_lines:
                continue
            seen_lines.add(ln)
            line_text = raw.split('\n')[ln - 1].strip()
            sites['cpp_runtime_path_macro'].append({'file': rel, 'line': ln, 'macro': m.group(1), 'text': line_text[:160]})
    return sites, params, var_param


# ---------------------------------------------------------------------------------------------- Python nodes and launch files

PY_TOPIC_ARG = {'create_publisher': 1, 'create_subscription': 1, 'create_service': 1, 'create_client': 1}
PY_CTOR_ARG = {'ActionClient': 2, 'ActionServer': 2}


def call_name(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


class PyModule:
    def __init__(self, rel, text):
        self.rel = rel
        self.tree = ast.parse(text)
        self.parents = {}
        for node in ast.walk(self.tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        # simple assignments: name -> value node; self.attr -> value node (last assignment wins, fine for this project)
        self.assign = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                t = node.targets[0]
                if isinstance(t, ast.Name):
                    self.assign[t.id] = node.value
                elif isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self':
                    self.assign['self.' + t.attr] = node.value
        self.declared = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call) and call_name(node.func) == 'declare_parameter' and node.args:
                name = node.args[0]
                if isinstance(name, ast.Constant) and isinstance(name.value, str):
                    default = node.args[1] if len(node.args) > 1 else None
                    self.declared[name.value] = (node.lineno, default.value if isinstance(default, ast.Constant) else None)
        self.launch_args = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call) and call_name(node.func) == 'DeclareLaunchArgument' and node.args:
                name = node.args[0]
                if isinstance(name, ast.Constant):
                    kw = {k.arg: k.value for k in node.keywords}
                    self.launch_args[name.value] = kw.get('default_value')

    def loop_values(self, node, name):
        """Values of `name` when it is the target of an enclosing for-loop over a literal list."""
        cur = self.parents.get(node)
        while cur is not None:
            if isinstance(cur, ast.For) and isinstance(cur.target, ast.Name) and cur.target.id == name:
                it = cur.iter
                key = None
                if isinstance(it, ast.Attribute) and isinstance(it.value, ast.Name) and it.value.id == 'self':
                    key = 'self.' + it.attr
                elif isinstance(it, ast.Name):
                    key = it.id
                seq = self.assign.get(key) if key else it
                if isinstance(seq, (ast.List, ast.Tuple)) and all(isinstance(e, ast.Constant) for e in seq.elts):
                    return [e.value for e in seq.elts]
                return None
            cur = self.parents.get(cur)
        return None

    def topic_value(self, node, arg):
        """(kind, values, how): kind literal | fstring-literal-loop | parameter-default | unresolved."""
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return 'literal', [arg.value], None
        if isinstance(arg, ast.JoinedStr):
            parts = []
            for v in arg.values:
                if isinstance(v, ast.Constant):
                    parts.append([v.value])
                elif isinstance(v, ast.FormattedValue) and isinstance(v.value, ast.Name):
                    vals = self.loop_values(node, v.value.id)
                    if vals is None:
                        return 'unresolved', [], 'f-string ' + ast.unparse(arg)
                    parts.append([str(x) for x in vals])
                else:
                    return 'unresolved', [], 'f-string ' + ast.unparse(arg)
            out = ['']
            for p in parts:
                out = [a + b for a in out for b in p]
            return 'fstring-over-literal-list', out, ast.unparse(arg)
        if isinstance(arg, ast.Attribute) and isinstance(arg.value, ast.Name) and arg.value.id == 'self':
            src = self.assign.get('self.' + arg.attr)
            # self.x = self.get_parameter("p").value
            if isinstance(src, ast.Attribute) and isinstance(src.value, ast.Call) and call_name(src.value.func) == 'get_parameter':
                p = src.value.args[0].value if src.value.args and isinstance(src.value.args[0], ast.Constant) else None
                if p in self.declared and isinstance(self.declared[p][1], str):
                    return 'parameter-default', [self.declared[p][1]], 'parameter ' + p
                return 'unresolved', [], 'parameter ' + str(p)
        return 'unresolved', [], ast.unparse(arg)

    def tf_frames(self, call):
        func = self.parents.get(call)
        while func is not None and not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func = self.parents.get(func)
        frames = {}
        if func is None:
            return frames
        for node in ast.walk(func):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Attribute):
                attr = node.targets[0].attr
                if attr in ('frame_id', 'child_frame_id') and isinstance(node.value, ast.Constant):
                    frames[attr] = node.value.value
        return frames


def py_node_sites(modules):
    sites = collections.defaultdict(list)
    for mod in modules:
        for node in ast.walk(mod.tree):
            if not isinstance(node, ast.Call):
                continue
            name = call_name(node.func)
            if name in PY_TOPIC_ARG or name in PY_CTOR_ARG:
                idx = PY_TOPIC_ARG.get(name, PY_CTOR_ARG.get(name))
                arg = node.args[idx] if len(node.args) > idx else next((k.value for k in node.keywords if k.arg in ('topic', 'srv_name', 'action_name')), None)
                if arg is None:
                    continue
                kind, values, how = mod.topic_value(node, arg)
                typ = node.args[idx - 1] if len(node.args) >= idx else None
                sites['py_' + name].append({'file': mod.rel, 'line': node.lineno, 'type': ast.unparse(typ) if typ is not None else None,
                                            'resolution': kind, 'names': values, 'how': how})
            elif name == 'create_timer':
                sites['py_create_timer'].append({'file': mod.rel, 'line': node.lineno})
            elif name in ('TransformBroadcaster', 'StaticTransformBroadcaster', 'TransformListener'):
                sites['py_tf_' + name].append({'file': mod.rel, 'line': node.lineno})
            elif name == 'sendTransform':
                fr = mod.tf_frames(node)
                sites['py_tf_sendTransform'].append({'file': mod.rel, 'line': node.lineno,
                                                     'frames': [fr.get('frame_id'), fr.get('child_frame_id')]})
            elif name in ('import_module', '__import__'):
                sites['py_dynamic_import'].append({'file': mod.rel, 'line': node.lineno})
            elif name in ('system', 'Popen', 'run', 'call', 'check_call', 'check_output') and isinstance(node.func, ast.Attribute) \
                    and isinstance(node.func.value, ast.Name) and node.func.value.id in ('os', 'subprocess'):
                sites['py_process'].append({'file': mod.rel, 'line': node.lineno, 'call': ast.unparse(node)[:120]})
            elif name == 'open' and isinstance(node.func, ast.Name):
                arg = node.args[0] if node.args else None
                sites['py_open'].append({'file': mod.rel, 'line': node.lineno, 'arg': ast.unparse(arg) if arg is not None else None,
                                         'literal': isinstance(arg, ast.Constant)})
    return sites


class LaunchEval:
    """Evaluates the launch-description expressions of one .launch.py to strings / markers (no execution)."""

    def __init__(self, mod):
        self.mod = mod

    def ev(self, node, depth=0):
        if depth > 20 or node is None:
            return None
        m = self.mod
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in m.assign:
                return self.ev(m.assign[node.id], depth + 1)
            return '@name:' + node.id
        if isinstance(node, (ast.List, ast.Tuple)):
            return [self.ev(e, depth + 1) for e in node.elts]
        if isinstance(node, ast.Dict):
            return {str(self.ev(k, depth + 1)): self.ev(v, depth + 1) for k, v in zip(node.keys, node.values)}
        if isinstance(node, ast.Call):
            name = call_name(node.func)
            args = [self.ev(a, depth + 1) for a in node.args]
            kw = {k.arg: k.value for k in node.keywords}
            if name == 'get_package_share_directory' and args and isinstance(args[0], str):
                return '@share/' + args[0]
            if name == 'join' and all(isinstance(a, str) for a in args):
                return '/'.join(args)
            if name == 'LaunchConfiguration' and args:
                arg = args[0]
                default = m.launch_args.get(arg)
                dv = self.ev(default, depth + 1) if default is not None else (self.ev(kw['default'], depth + 1) if 'default' in kw else None)
                return {'@arg': arg, 'default': dv}
            if name == 'ParameterValue' and node.args:
                return {'@ParameterValue': self.ev(node.args[0], depth + 1)}
            if name == 'Command':
                return {'@Command': args}
            if name == 'PythonExpression':
                return {'@PythonExpression': ast.unparse(node)}
            if name == 'IfCondition' and args:
                return {'@if': args[0]}
            if name in ('items',):
                return self.ev(node.func.value, depth + 1)
            return {'@call': name, 'args': args}
        if isinstance(node, ast.Attribute):
            return '@attr:' + ast.unparse(node)
        return '@expr:' + ast.unparse(node)[:80]


def launch_sites(mod):
    ev = LaunchEval(mod)
    out = {'nodes': [], 'includes': [], 'processes': [], 'args': {}}
    for k, v in mod.launch_args.items():
        out['args'][k] = ev.ev(v)
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Call):
            continue
        name = call_name(node.func)
        kw = {k.arg: k.value for k in node.keywords}
        if name == 'Node':
            item = {'line': node.lineno}
            for key in ('package', 'executable', 'name', 'parameters', 'remappings', 'arguments', 'condition'):
                if key in kw:
                    item[key] = ev.ev(kw[key])
            out['nodes'].append(item)
        elif name == 'IncludeLaunchDescription':
            src = node.args[0] if node.args else kw.get('launch_description_source')
            path = ev.ev(src.args[0]) if isinstance(src, ast.Call) and src.args else None
            out['includes'].append({'line': node.lineno, 'path': path,
                                    'launch_arguments': ev.ev(kw['launch_arguments']) if 'launch_arguments' in kw else None,
                                    'condition': ev.ev(kw['condition']) if 'condition' in kw else None})
        elif name == 'ExecuteProcess':
            out['processes'].append({'line': node.lineno, 'cmd': ev.ev(kw.get('cmd'))})
    return out


# ---------------------------------------------------------------------------------------------- CMake, package.xml, YAML, URDF, rviz, shell

CMAKE_CMD = re.compile(r'(?im)^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(')


def cmake_commands(text):
    text = re.sub(r'#[^\n]*', lambda m: ' ' * len(m.group(0)), text)
    for m in CMAKE_CMD.finditer(text):
        body, _ = balanced_args(text, m.end() - 1)
        toks = re.findall(r'"[^"]*"|[^\s"]+', body)
        yield m.group(1).lower(), [t.strip('"') for t in toks], line_of(text, m.start())


def cmake_package(root, pkg):
    rel = '{}/{}/CMakeLists.txt'.format(SRC, pkg)
    if not os.path.exists(os.path.join(root, *rel.split('/'))):
        return None
    text = read(root, rel)
    var = {'CMAKE_CURRENT_SOURCE_DIR': '@src/' + pkg, 'PROJECT_SOURCE_DIR': '@src/' + pkg, 'PROJECT_NAME': pkg}
    info = {'file': rel, 'targets': {}, 'link': [], 'ament_deps': [], 'include_dirs': [], 'install_programs': [],
            'install_share_dirs': [], 'find_package': [], 'definitions': []}

    def expand(tok):
        for _ in range(5):
            new = re.sub(r'\$\{(\w+)\}', lambda m: var.get(m.group(1), '${' + m.group(1) + '}'), tok)
            if new == tok:
                break
            tok = new
        return tok

    def expand_list(toks):
        out = []
        for t in toks:
            e = expand(t)
            out.extend(e.split(';') if ';' in e and not e.startswith('-D') else [e])
        return out

    for cmd, args, ln in cmake_commands(text):
        if cmd == 'set' and args:
            var[args[0]] = ';'.join(expand_list(args[1:]))
        elif cmd == 'list' and len(args) >= 2 and args[0].upper() == 'APPEND':
            old = var.get(args[1], '')
            var[args[1]] = ';'.join([x for x in old.split(';') if x] + expand_list(args[2:]))
        elif cmd == 'project' and args:
            var['PROJECT_NAME'] = expand(args[0])
        elif cmd in ('add_library', 'add_executable') and args:
            name = expand(args[0])
            srcs = [s for s in expand_list(args[1:]) if s not in ('SHARED', 'STATIC', 'MODULE', 'INTERFACE')]
            info['targets'][name] = {'kind': cmd, 'line': ln,
                                     'sources': ['{}/{}/{}'.format(SRC, pkg, s) for s in srcs if not s.startswith('$')]}
        elif cmd == 'target_link_libraries' and args:
            info['link'].append({'line': ln, 'target': expand(args[0]), 'items': [x for x in expand_list(args[1:]) if x]})
        elif cmd == 'ament_target_dependencies' and args:
            info['ament_deps'].append({'line': ln, 'target': expand(args[0]), 'deps': [x for x in expand_list(args[1:]) if x]})
        elif cmd in ('target_include_directories', 'include_directories'):
            for x in expand_list(args):
                if '@src/' in x:
                    info['include_dirs'].append({'line': ln, 'dir': x})
        elif cmd == 'install' and args:
            up = [a.upper() for a in args]
            if up[0] == 'PROGRAMS':
                end = up.index('DESTINATION') if 'DESTINATION' in up else len(args)
                info['install_programs'].append({'line': ln, 'files': ['{}/{}/{}'.format(SRC, pkg, f) for f in args[1:end]]})
            elif up[0] == 'DIRECTORY':
                end = up.index('DESTINATION') if 'DESTINATION' in up else len(args)
                dest = expand(args[end + 1]) if end + 1 < len(args) else ''
                if dest.startswith('share/'):
                    info['install_share_dirs'].append({'line': ln, 'dirs': [d.rstrip('/') for d in args[1:end]], 'dest': dest})
        elif cmd == 'find_package' and args:
            info['find_package'].append(args[0])
        elif cmd == 'add_definitions':
            info['definitions'].append({'line': ln, 'defs': expand_list(args)})
    return info


def package_xml_deps(root, pkg):
    rel = '{}/{}/package.xml'.format(SRC, pkg)
    text = read(root, rel)
    out = []
    for i, line in enumerate(text.split('\n'), 1):
        for m in re.finditer(r'<(depend|build_depend|exec_depend|build_export_depend|test_depend)>\s*([^<\s]+)\s*</', line):
            out.append({'line': i, 'kind': m.group(1), 'name': m.group(2)})
    return rel, out


def yaml_flat_keys(text):
    """Flatten simple block-mapping YAML to dotted keys (lists and flow values are leaves). Enough for ROS param files."""
    stack, keys = [], []
    for i, raw in enumerate(text.split('\n'), 1):
        line = raw.split(' #')[0].rstrip() if not raw.lstrip().startswith('#') else ''
        if not line.strip() or line.strip().startswith('- '):
            continue
        indent = len(line) - len(line.lstrip(' '))
        m = re.match(r'^\s*("?[^:"]+"?)\s*:\s*(.*)$', line)
        if not m:
            continue
        key, value = m.group(1).strip('"'), m.group(2).strip()
        while stack and stack[-1][0] >= indent:
            stack.pop()
        path = [k for _, k in stack] + [key]
        if value:
            keys.append(('.'.join(path), value.strip('"\''), i))
        else:
            stack.append((indent, key))
    return keys


def bridge_table(text):
    out, cur = [], None
    for i, raw in enumerate(text.split('\n'), 1):
        line = raw.strip()
        if line.startswith('- '):
            if cur:
                out.append(cur)
            cur = {'line': i}
            line = line[2:]
        m = re.match(r'^(\w+)\s*:\s*"?([^"]*)"?\s*$', line)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2)
    if cur:
        out.append(cur)
    return out


# ---------------------------------------------------------------------------------------------- main

def main(argv):
    root, cpp_path, py_path, out_path = argv
    root_abs = os.path.abspath(root)
    files = rel_files(root_abs)
    packages = sorted({package_of(f) for f in files if f.startswith(SRC + '/')})
    cpp_files = [f for f in files if f.lower().endswith(CPP_EXT)]
    py_files = [f for f in files if f.lower().endswith('.py')]

    cpp_edges, cpp_unresolved = load_cpp_edges(cpp_path, root_abs)
    py_edges, py_scan = load_py_edges(py_path)
    all_edges = cpp_edges | py_edges
    pkg_edges = collections.Counter((package_of(a), package_of(b)) for a, b in all_edges if package_of(a) != package_of(b))
    adj = collections.defaultdict(set)
    for a, b in all_edges:
        adj[a].add(b)
        adj[b].add(a)

    def connected(a, b):
        """direct edge (either direction), and whether b is reachable from a ignoring direction."""
        direct = (a, b) in all_edges or (b, a) in all_edges
        seen, todo = {a}, [a]
        while todo:
            x = todo.pop()
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    todo.append(y)
        return direct, b in seen

    result = {'root': root_abs, 'files': len(files), 'packages': packages,
              'light_scan': {'cpp_edges': len(cpp_edges), 'py_edges': len(py_edges),
                             'cross_package_edges': {'{} -> {}'.format(a, b): n for (a, b), n in sorted(pkg_edges.items())},
                             'cpp_edge_list': sorted(cpp_edges), 'py_edge_list': sorted(py_edges)}}

    # generated / message headers among the unresolved includes
    gen = [u for u in cpp_unresolved if u[3] and re.search(r'/(msg|srv|action)/', u[3])]
    gen_pkgs = collections.Counter(u[3].split('/')[0] for u in gen)
    interface_files = [f for f in files if f.endswith(('.msg', '.srv', '.action', '.idl'))]
    result['generated_headers'] = {'unresolved_include_sites': len(cpp_unresolved), 'msg_srv_action_sites': len(gen),
                                   'by_package': dict(gen_pkgs), 'examples': gen[:8],
                                   'project_interface_files': interface_files}

    # C/C++ sites
    csites, cparams, cvar = cpp_sites(root_abs, cpp_files)
    # Python nodes and launch files
    modules = {f: PyModule(f, read(root_abs, f)) for f in py_files}
    launch_files = [f for f in py_files if '.launch.' in os.path.basename(f)]
    node_files = [f for f in py_files if f not in launch_files]
    psites = py_node_sites([modules[f] for f in node_files])
    launches = {f: launch_sites(modules[f]) for f in launch_files}

    # CMake / package.xml
    cmake = {p: cmake_package(root_abs, p) for p in packages}
    pxml = {p: package_xml_deps(root_abs, p) for p in packages}

    # YAML / URDF / SDF / rviz / shell
    yaml_files = [f for f in files if f.endswith(('.yaml', '.yml')) and f.startswith(SRC)]
    yaml_keys = {f: yaml_flat_keys(read(root_abs, f)) for f in yaml_files}
    bridge = {f: bridge_table(read(root_abs, f)) for f in yaml_files if 'ros_topic_name' in read(root_abs, f)}
    plugin_sites, model_topics = [], []
    for f in files:
        if f.endswith(('.xacro', '.urdf', '.sdf')):
            text = read(root_abs, f)
            for m in re.finditer(r'filename\s*=\s*"([^"]+)"', text):
                kind = 'gz-plugin' if 'gz-sim' in m.group(1) or m.group(1).endswith('.so') else 'mesh/resource'
                plugin_sites.append({'file': f, 'line': line_of(text, m.start()), 'value': m.group(1), 'kind': kind})
            for m in re.finditer(r'<topic>([^<]+)</topic>', text):
                model_topics.append({'file': f, 'line': line_of(text, m.start()), 'topic': m.group(1)})
    rviz_topics = []
    for f in files:
        if f.endswith('.rviz'):
            lines = read(root_abs, f).split('\n')
            for i, line in enumerate(lines):
                if re.match(r'^\s*(Topic|Update Topic):\s*$', line):
                    for j in range(i + 1, min(i + 8, len(lines))):
                        mv = re.match(r'^\s*Value:\s*(/\S+)\s*$', lines[j])
                        if mv:
                            rviz_topics.append({'file': f, 'line': j + 1, 'topic': mv.group(1)})
                            break
    shell_sites = []
    for f in files:
        if f.endswith('.sh') or f.endswith('Dockerfile') or f.endswith('docker-compose.yml'):
            for i, line in enumerate(read(root_abs, f).split('\n'), 1):
                s = line.strip()
                if s.startswith('#'):
                    continue
                for m in re.finditer(r'\b(ros2 (?:launch|run|topic \w+|service \w+|action \w+|bag \w+|param \w+)\s+[^\s\\|>&]+(?:\s+[^\s\\|>&-][^\s\\|>&]*)?|'
                                     r'python3\s+[^\s\\|>&]+\.py|colcon build[^\\|>&]*|source\s+[^\s\\|>&]+)', s):
                    shell_sites.append({'file': f, 'line': i, 'cmd': m.group(1).strip()})

    # ---------------------------------------------------------------- executables -> files
    exe_files = {}   # (pkg, exe) -> {'files': [...], 'how': ...}
    for p, info in cmake.items():
        if not info:
            continue
        for name, t in info['targets'].items():
            if t['kind'] == 'add_executable':
                exe_files[(p, name)] = {'files': t['sources'], 'how': '{}:{} add_executable'.format(info['file'], t['line'])}
        for ip in info['install_programs']:
            for f in ip['files']:
                exe_files[(p, os.path.basename(f))] = {'files': [f], 'how': '{}:{} install(PROGRAMS)'.format(info['file'], ip['line'])}
    # library a C++ executable links (own targets only), so a node's code = main + linked own library sources
    own_lib_sources, lib_pkg = {}, {}
    for p, info in cmake.items():
        if info:
            for name, t in info['targets'].items():
                if t['kind'] == 'add_library':
                    own_lib_sources[name] = t['sources']
                    lib_pkg[name] = p

    def item_lib(item):
        for lib in own_lib_sources:
            if item == lib or item.startswith(lib + '::') or item.endswith('/install/{0}/lib/lib{0}.so'.format(lib)):
                return lib
        return None

    def linked_own_libs(pkg):
        """Own libraries a package's targets link, transitively (target_link_libraries only)."""
        out, todo = [], [pkg]
        while todo:
            p = todo.pop()
            info = cmake.get(p)
            for l in (info['link'] if info else []):
                for item in l['items']:
                    lib = item_lib(item)
                    if lib and lib not in out and lib_pkg[lib] != pkg:
                        out.append(lib)
                        todo.append(lib_pkg[lib])
        return out

    def share_to_file(path):
        if not isinstance(path, str) or not path.startswith('@share/'):
            return None, 'not a share path'
        parts = path[len('@share/'):].split('/')
        pkg, sub = parts[0], parts[1:]
        if pkg not in packages:
            return None, 'external package ' + pkg
        info = cmake.get(pkg)
        dirs = {d for x in (info['install_share_dirs'] if info else []) for d in x['dirs']}
        if not sub or sub[0] not in dirs:
            return None, 'directory not installed to share/'
        rel = '{}/{}/{}'.format(SRC, pkg, '/'.join(sub))
        return (rel if rel in files else None), ('ok' if rel in files else 'file not in project: ' + rel)

    # ---------------------------------------------------------------- launch -> files
    launch_refs = []
    for lf, ls in launches.items():
        for inc in ls['includes']:
            target, why = share_to_file(inc['path'])
            launch_refs.append({'from': lf, 'line': inc['line'], 'kind': 'include-launch', 'value': inc['path'], 'to': target, 'why': why})
        for nd in ls['nodes']:
            pkg, exe = nd.get('package'), nd.get('executable')
            if (pkg, exe) in exe_files:
                for t in exe_files[(pkg, exe)]['files']:
                    launch_refs.append({'from': lf, 'line': nd['line'], 'kind': 'run-executable', 'value': '{} {}'.format(pkg, exe),
                                        'to': t, 'why': exe_files[(pkg, exe)]['how']})
            else:
                launch_refs.append({'from': lf, 'line': nd['line'], 'kind': 'run-executable', 'value': '{} {}'.format(pkg, exe),
                                    'to': None, 'why': 'external package' if pkg not in packages else 'executable not found'})
            for prm in nd.get('parameters') or []:
                vals = []
                if isinstance(prm, str):
                    vals.append(prm)
                elif isinstance(prm, dict) and '@arg' in prm and isinstance(prm.get('default'), str):
                    vals.append(prm['default'])
                elif isinstance(prm, dict):
                    for v in prm.values():
                        if isinstance(v, str) and v.startswith('@share/'):
                            vals.append(v)
                for v in vals:
                    target, why = share_to_file(v)
                    launch_refs.append({'from': lf, 'line': nd['line'], 'kind': 'parameter-file', 'value': v, 'to': target, 'why': why,
                                        'node': '{} {}'.format(pkg, exe)})
            for a in nd.get('arguments') or []:
                if isinstance(a, str) and a.startswith('@share/'):
                    target, why = share_to_file(a)
                    launch_refs.append({'from': lf, 'line': nd['line'], 'kind': 'argument-file', 'value': a, 'to': target, 'why': why})
            prm = nd.get('parameters') or []
            for d in prm:
                if isinstance(d, dict):
                    for k, v in d.items():
                        if isinstance(v, dict) and '@ParameterValue' in v:
                            cmd = v['@ParameterValue'].get('@Command', []) if isinstance(v['@ParameterValue'], dict) else []
                            for c in cmd if isinstance(cmd, list) else []:
                                for x in (c if isinstance(c, list) else [c]):
                                    if isinstance(x, str) and x.startswith('@share/'):
                                        target, why = share_to_file(x)
                                        launch_refs.append({'from': lf, 'line': nd['line'], 'kind': 'xacro-file', 'value': x, 'to': target, 'why': why})
        # other share paths assigned in the file (world, rviz, bridge config, launch arguments)
        ev = LaunchEval(modules[lf])
        for name, node in modules[lf].assign.items():
            v = ev.ev(node)
            if isinstance(v, str) and v.startswith('@share/') and v.count('/') >= 3:
                target, why = share_to_file(v)
                launch_refs.append({'from': lf, 'line': node.lineno, 'kind': 'path-assignment', 'value': v, 'to': target, 'why': why, 'var': name})

    # ---------------------------------------------------------------- topics
    endpoints = []   # {topic, role, file, line, how, node}
    def add(topic, role, file, line, how, owner='project'):
        endpoints.append({'topic': topic, 'role': role, 'file': file, 'line': line, 'how': how, 'owner': owner})

    def cpp_resolve(site):
        if site['literal'] is not None:
            return [(site['literal'], 'literal')]
        var = site['arg'].strip()
        param = cvar.get((site['file'], var))
        if not param:
            # member variable set in another file of the same class (LIVMapper.cpp sets, LIVMapper.cpp uses)
            param = next((p for (f, v), p in cvar.items() if v == var), None)
        if not param:
            return [(None, 'unresolved: ' + var)]
        out = []
        default = cparams.get(param)
        if default and cpp_literal(default[2] or '') is not None:
            out.append((cpp_literal(default[2]), 'parameter {} default ({}:{})'.format(param, default[0], default[1])))
        for yf, keys in yaml_keys.items():
            for k, v, ln in keys:
                if k.endswith('ros__parameters.' + param):
                    out.append((v, 'parameter {} = {}:{}'.format(param, yf, ln)))
        return out or [(None, 'parameter ' + param + ' without literal')]

    for kind, role in (('cpp_create_publisher', 'pub'), ('cpp_create_subscription', 'sub'), ('cpp_create_service', 'srv-server'),
                       ('cpp_create_client', 'srv-client')):
        for s in csites.get(kind, []):
            for topic, how in cpp_resolve(s):
                add(topic, role, s['file'], s['line'], how)
    for kind, role in (('py_create_publisher', 'pub'), ('py_create_subscription', 'sub'), ('py_create_service', 'srv-server'),
                       ('py_create_client', 'srv-client'), ('py_ActionClient', 'action-client'), ('py_ActionServer', 'action-server')):
        for s in psites.get(kind, []):
            for topic in s['names'] or [None]:
                add(topic, role, s['file'], s['line'], s['resolution'] + (' ' + s['how'] if s['how'] else ''))
    for f, table in bridge.items():
        for e in table:
            t = e.get('ros_topic_name')
            if not t:
                continue
            role = 'pub' if e.get('direction') == 'GZ_TO_ROS' else 'sub'
            add(t, role, f, e['line'], 'ros_gz_bridge table ({})'.format(e.get('direction')), owner='config(bridge)')
    # launch remappings of external nodes: the role comes from the remapped name (manual rule for this project:
    # cloud_in and in/compressed are inputs, out is an output); the remapped external node is the real endpoint
    def remap_role(src):
        return 'pub' if src == 'out' or src.startswith('out/') else 'sub'
    for lf, ls in launches.items():
        for nd in ls['nodes']:
            for r in nd.get('remappings') or []:
                if isinstance(r, list) and len(r) == 2:
                    add(r[1], remap_role(r[0]), lf, nd['line'], 'remap {} -> {} for external {} {}'.format(r[0], r[1], nd.get('package'), nd.get('executable')),
                        owner='launch(external node)')
        for pr in ls['processes']:
            cmd = pr['cmd'] if isinstance(pr['cmd'], list) else []
            for i, x in enumerate(cmd):
                if x == '-r' and i + 1 < len(cmd) and isinstance(cmd[i + 1], str) and ':=' in cmd[i + 1]:
                    a, b = cmd[i + 1].split(':=', 1)
                    add(b, remap_role(a), lf, pr['line'], 'ExecuteProcess remap {} -> {} ({})'.format(a, b, ' '.join(c for c in cmd[:4] if isinstance(c, str))),
                        owner='launch(external node)')
    # topic parameters in YAML files that launch files pass ONLY to external nodes (nav2): consumers there.
    # YAML files passed to project nodes were used above to resolve the project node's own topic parameters.
    yaml_users = collections.defaultdict(set)
    for r in launch_refs:
        if r['kind'] == 'parameter-file' and r['to']:
            pkg_exe = tuple(r.get('node', ' ').split(' ', 1))
            yaml_users[r['to']].add('external' if pkg_exe not in exe_files else 'project')
    for yf, keys in yaml_keys.items():
        if yaml_users.get(yf) != {'external'}:
            continue
        for k, v, ln in keys:
            if (k.endswith('_topic') or k.endswith('.topic')) and v.startswith('/'):
                add(v, 'sub', yf, ln, 'parameter ' + k + ' of an external node', owner='config(external node)')

    by_topic = collections.defaultdict(list)
    for e in endpoints:
        if e['topic']:
            by_topic[e['topic']].append(e)
    pairs = []
    seen_pairs = set()
    for topic, eps in sorted(by_topic.items()):
        pubs = [e for e in eps if e['role'] in ('pub', 'srv-server', 'action-server')]
        subs = [e for e in eps if e['role'] in ('sub', 'srv-client', 'action-client')]
        for p in pubs:
            for s in subs:
                key = (topic, p['file'], p['line'], s['file'], s['line'])
                if p['file'] == s['file'] or key in seen_pairs:
                    continue
                seen_pairs.add(key)
                direct, reach = connected(p['file'], s['file'])
                pp, sp = package_of(p['file']), package_of(s['file'])
                pkg_direct = pp == sp or (pp, sp) in pkg_edges or (sp, pp) in pkg_edges
                pairs.append({'topic': topic, 'from': '{}:{}'.format(p['file'], p['line']), 'to': '{}:{}'.format(s['file'], s['line']),
                              'from_owner': p['owner'], 'to_owner': s['owner'], 'from_how': p['how'], 'to_how': s['how'],
                              'file_edge': direct, 'file_reachable_undirected': reach,
                              'package_pair': '{} -> {}'.format(pp, sp), 'package_edge_or_same': pkg_direct})

    # TF frame publishers
    tf = []
    for s in csites.get('cpp_tf_sendTransform', []):
        tf.append({'file': s['file'], 'line': s['line'], 'frames': s['frames']})
    for s in psites.get('py_tf_sendTransform', []):
        tf.append({'file': s['file'], 'line': s['line'], 'frames': s['frames']})
    for lf, ls in launches.items():
        for nd in ls['nodes']:
            if nd.get('executable') == 'static_transform_publisher':
                a = nd.get('arguments') or []
                fr = [a[i + 1] for i, x in enumerate(a) if x in ('--frame-id', '--child-frame-id') and i + 1 < len(a)]
                tf.append({'file': lf, 'line': nd['line'], 'frames': fr, 'static': True})
    tf_by_pair = collections.defaultdict(list)
    for t in tf:
        if len(t['frames']) == 2:
            tf_by_pair[tuple(t['frames'])].append('{}:{}'.format(t['file'], t['line']))

    # ---------------------------------------------------------------- CMake / package relations between own packages
    pkg_rel = collections.defaultdict(lambda: collections.defaultdict(list))
    for p, info in cmake.items():
        if not info:
            continue
        for l in info['link']:
            for item in l['items']:
                for q in packages:
                    if q != p and (item == q or item.startswith(q + '::') or '/install/{}/'.format(q) in item or item == q):
                        pkg_rel[(p, q)]['cmake-link'].append('{}:{} {}'.format(info['file'], l['line'], item))
        for d in info['ament_deps']:
            for item in d['deps']:
                if item in packages and item != p:
                    pkg_rel[(p, item)]['ament_target_dependencies'].append('{}:{}'.format(info['file'], d['line']))
        for d in info['include_dirs']:
            m = re.match(r'@src/([^/]+)/\.\./([^/]+)', d['dir'])
            if m and m.group(2) in packages:
                pkg_rel[(p, m.group(2))]['include-dir'].append('{}:{} {}'.format(info['file'], d['line'], d['dir'].replace('@src/', 'src/')))
    pxml_unknown = []
    for p, (rel, deps) in pxml.items():
        for d in deps:
            if d['name'] in packages and d['name'] != p:
                pkg_rel[(p, d['name'])]['package.xml ' + d['kind']].append('{}:{}'.format(rel, d['line']))
    for r in launch_refs:
        if r['to']:
            a, b = package_of(r['from']), package_of(r['to'])
            if a != b:
                pkg_rel[(a, b)]['launch ' + r['kind']].append('{}:{} -> {}'.format(r['from'], r['line'], r['to']))
    for pr in pairs:
        a, b = pr['package_pair'].split(' -> ')
        if a != b and pr['from_owner'] == 'project' and pr['to_owner'] == 'project':
            pkg_rel[(a, b)]['topic ' + pr['topic']].append('{} -> {}'.format(pr['from'], pr['to']))
    pkg_table = []
    for (a, b), kinds in sorted(pkg_rel.items()):
        pkg_table.append({'pair': '{} -> {}'.format(a, b), 'light_scan_edges': pkg_edges.get((a, b), 0),
                          'light_scan_edges_reverse': pkg_edges.get((b, a), 0),
                          'relations': {k: v for k, v in sorted(kinds.items())}})

    # parameter keys: yaml files given to a project node vs parameters declared in that node's code
    param_join = []
    for r in launch_refs:
        if r['kind'] != 'parameter-file' or not r['to']:
            continue
        node = r.get('node', '')
        pkg, exe = node.split(' ', 1) if ' ' in node else (None, None)
        code = []
        if (pkg, exe) in exe_files:
            code = list(exe_files[(pkg, exe)]['files'])
            libs = linked_own_libs(pkg)
            for lib in libs:
                code += own_lib_sources.get(lib, [])
        keys = yaml_keys.get(r['to'], [])
        names = [k.split('ros__parameters.', 1)[1] for k, v, ln in keys if 'ros__parameters.' in k]
        declared_c = {n for n, (f, ln, d) in cparams.items() if f in code}
        read_c = {s['name'] for kind in ('cpp_param_read_getParam', 'cpp_param_read_getRemoteParam')
                  for s in csites.get(kind, []) if s['name'] and s['file'] in code}
        declared_py = set()
        for f in code:
            if f in modules:
                declared_py |= set(modules[f].declared)
        declared = declared_c | declared_py
        key_files = collections.Counter()
        for n in names:
            if n in cparams and cparams[n][0] in code:
                key_files[cparams[n][0]] += 1
            elif n in read_c:
                for kind in ('cpp_param_read_getParam', 'cpp_param_read_getRemoteParam'):
                    f = next((s['file'] for s in csites.get(kind, []) if s['name'] == n and s['file'] in code), None)
                    if f:
                        key_files[f] += 1
                        break
            else:
                f = next((f for f in code if f in modules and n in modules[f].declared), None)
                if f:
                    key_files[f] += 1
        param_join.append({'yaml': r['to'], 'launch': '{}:{}'.format(r['from'], r['line']), 'node': node, 'node_code_files': sorted(set(code)),
                           'files_declaring_or_reading_keys': dict(key_files),
                           'keys': len(names), 'keys_declared_in_node_code': sum(1 for n in names if n in declared),
                           'keys_read_by_vikit_helpers_in_node_code': sum(1 for n in names if n in read_c and n not in declared),
                           'keys_not_found_in_node_code': sorted(n for n in names if n not in declared and n not in read_c),
                           'external_node': (pkg, exe) not in exe_files})

    # ---------------------------------------------------------------- how much the light scan already connects
    def file_of(loc):
        return loc.rsplit(':', 1)[0]
    rel_pairs = collections.defaultdict(set)
    for pr in pairs:
        rel_pairs['topic/service/action ({} -> {})'.format(pr['from_owner'], pr['to_owner'])].add((file_of(pr['from']), file_of(pr['to'])))
    for r in launch_refs:
        if r['to']:
            rel_pairs['launch ' + r['kind']].add((r['from'], r['to']))
    for pj in param_join:
        if not pj['external_node']:
            for f in pj['files_declaring_or_reading_keys']:
                rel_pairs['parameter file -> code file that declares or reads its keys'].add((pj['yaml'], f))
    for (a, b), locs in tf_by_pair.items():
        files_ = sorted({file_of(x) for x in locs})
        for i in range(len(files_)):
            for j in range(i + 1, len(files_)):
                rel_pairs['same TF frame pair published twice'].add((files_[i], files_[j]))
    coverage = {}
    for kind, prs in sorted(rel_pairs.items()):
        n = len(prs)
        direct = sum(1 for a, b in prs if connected(a, b)[0])
        reach = sum(1 for a, b in prs if connected(a, b)[1])
        pkg_same = sum(1 for a, b in prs if package_of(a) == package_of(b))
        pkg_edge = sum(1 for a, b in prs if package_of(a) != package_of(b) and
                       ((package_of(a), package_of(b)) in pkg_edges or (package_of(b), package_of(a)) in pkg_edges))
        coverage[kind] = {'file_pairs': n, 'direct_light_edge': direct, 'reachable_in_light_graph_undirected': reach,
                          'same_package': pkg_same, 'different_package_with_light_edge_between_packages': pkg_edge,
                          'pairs': sorted(prs)}
    result['light_scan_coverage_of_runtime_pairs'] = coverage

    result.update({
        'cpp_sites': {k: v for k, v in sorted(csites.items())},
        'cpp_site_counts': {k: len(v) for k, v in sorted(csites.items())},
        'cpp_parameters_declared': len(cparams),
        'py_sites': {k: v for k, v in sorted(psites.items())},
        'py_site_counts': {k: len(v) for k, v in sorted(psites.items())},
        'launch': launches,
        'launch_refs': launch_refs,
        'cmake': cmake,
        'package_xml': {p: {'file': rel, 'deps': deps} for p, (rel, deps) in pxml.items()},
        'package_xml_names_not_in_workspace_but_look_local': [
            {'package': p, 'name': d['name'], 'line': d['line'], 'file': rel} for p, (rel, deps) in pxml.items() for d in deps
            if d['name'].startswith(('fast_livo', 'vikit')) and d['name'] not in packages],
        'bridge': bridge,
        'model_plugins': plugin_sites,
        'model_topics': model_topics,
        'rviz_topics': rviz_topics,
        'shell_sites': shell_sites,
        'endpoints': endpoints,
        'topic_pairs': pairs,
        'tf_publishers': tf,
        'tf_pairs_with_more_than_one_publisher': {'{} -> {}'.format(a, b): v for (a, b), v in tf_by_pair.items() if len(v) > 1},
        'package_relations': pkg_table,
        'parameter_files': param_join,
        'executables': {'{} {}'.format(p, e): v for (p, e), v in sorted(exe_files.items())},
    })
    with open(out_path, 'w', encoding='utf-8') as h:
        json.dump(result, h, ensure_ascii=False, indent=1)
    # short stdout summary
    print('files', len(files), 'cpp_edges', len(cpp_edges), 'py_edges', len(py_edges), 'cross-pkg', dict(pkg_edges))
    print('cpp sites', result['cpp_site_counts'])
    print('py sites', result['py_site_counts'])
    print('topic pairs', len(pairs), 'project-project', sum(1 for p in pairs if p['from_owner'] == 'project' and p['to_owner'] == 'project'))
    print('launch refs', collections.Counter(r['kind'] for r in launch_refs), 'resolved', sum(1 for r in launch_refs if r['to']))


if __name__ == '__main__':
    main(sys.argv[1:])
