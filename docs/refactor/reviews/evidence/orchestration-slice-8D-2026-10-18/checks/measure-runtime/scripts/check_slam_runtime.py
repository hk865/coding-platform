#!/usr/bin/env python3
"""Checker: own inventory of runtime / non-import dependencies in the SLAM copy, and how many of the
runtime file pairs are already covered by the light-scan graph. Independent of slam_runtime_inventory.py.

Method: C/C++ = regex over source with comments removed and string contents kept separately;
Python (nodes and .launch.py) = ast; YAML = PyYAML safe_load (system package, read-only use);
CMake / package.xml = regex. Light-scan edges come from check_slam_include.py's output (which
matched the prototype's 86 edges one by one) plus the Python scan (0 edges).

Usage: python3 -I check_slam_runtime.py <root> <include-check.json> <out.json>
"""
import ast, json, os, re, sys, collections, posixpath
import yaml

root, incp, outp = sys.argv[1:4]
root = os.path.normpath(root)
FILES = set()
for dp, dns, fns in os.walk(root):
    for fn in fns:
        FILES.add(os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, '/'))
SRC = 'ros2_ws/src/'
PKGS = sorted(set(f[len(SRC):].split('/')[0] for f in FILES if f.startswith(SRC)))

def pkg(f):
    return f[len(SRC):].split('/')[0] if f.startswith(SRC) else '(root)'

def read(f):
    return open(os.path.join(root, f), 'rb').read().decode('utf-8', 'replace')

CPP_EXT = ('.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx')
cpp_files = sorted(f for f in FILES if f.lower().endswith(CPP_EXT))
py_files = sorted(f for f in FILES if f.endswith('.py'))
launch_py = [f for f in py_files if f.endswith('.launch.py')]
node_py = [f for f in py_files if not f.endswith('.launch.py')]

def code_and_strings(text):
    """Return (code with comments removed and string contents blanked, list of (offset, string))."""
    out = []; strings = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and text.startswith('//', i):
            j = text.find('\n', i); j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j; continue
        if c == '/' and text.startswith('/*', i):
            j = text.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append(re.sub(r'[^\n]', ' ', text[i:j])); i = j; continue
        if c == '"' or (c == "'" and not (i > 0 and text[i-1].isalnum())):
            j = i + 1
            while j < n and text[j] != c and text[j] != '\n':
                if text[j] == '\\': j += 1
                j += 1
            strings.append((i, text[i + 1:j]))
            out.append(c + ' ' * (j - i - 1) + (c if j < n else '')); i = j + 1; continue
        out.append(c); i += 1
    return ''.join(out), strings

def lineno(text, off):
    return text.count('\n', 0, off) + 1

def call_args(code, raw, open_paren):
    """Split the argument list starting at open_paren (index of '(') using blanked code for depth,
    return list of raw argument texts."""
    depth = 0; args = []; start = open_paren + 1; i = open_paren
    while i < len(code):
        ch = code[i]
        if ch in '([{': depth += 1
        elif ch in ')]}':
            depth -= 1
            if depth == 0:
                args.append(raw[start:i].strip()); break
        elif ch == ',' and depth == 1:
            args.append(raw[start:i].strip()); start = i + 1
        elif ch == '<' and False:
            pass
        i += 1
    return args

def lit(arg):
    m = re.fullmatch(r'"((?:[^"\\]|\\.)*)"', arg.strip())
    return m.group(1) if m else None

# ---------------------------------------------------------------- C/C++ sites
cpp = collections.defaultdict(list)
cpp_param_keys = collections.defaultdict(set)   # file -> declared/read literal parameter keys
cpp_var_param = {}                               # (file, var) -> key  from get_parameter("k", var)
for f in cpp_files:
    raw = read(f); code, strings = code_and_strings(raw)
    def sites(pattern, kind, with_args=True):
        for m in re.finditer(pattern, code):
            ln = lineno(raw, m.start())
            rec = {'file': f, 'line': ln}
            if with_args:
                p = code.find('(', m.end() - 1)
                rec['args'] = call_args(code, raw, p) if p >= 0 else []
            cpp[kind].append(rec)
    sites(r'\bcreate_publisher\s*(<[^;()]*?>)?\s*\(', 'create_publisher')
    sites(r'\bcreate_subscription\s*(<[^;()]*?>)?\s*\(', 'create_subscription')
    sites(r'\bcreate_service\s*(<[^;()]*?>)?\s*\(', 'create_service')
    sites(r'\bcreate_client\s*(<[^;()]*?>)?\s*\(', 'create_client')
    sites(r'\brclcpp_action::create_(server|client)\b', 'action', False)
    sites(r'\bcreate_(wall_)?timer\s*\(', 'timer')
    sites(r'\bsendTransform\s*\(', 'sendTransform')
    sites(r'\b(Sync|Async)ParametersClient\b(?!\s*&)', 'param_client', False)
    sites(r'(?<![\w:.])popen\s*\(', 'popen')
    sites(r'(?<![\w:.>])system\s*\(', 'system')
    sites(r'\bstd::bind\s*\(', 'std_bind')
    sites(r'\b(dlopen|dlsym|LoadLibrary\w*)\s*\(', 'dlopen')
    sites(r'\b(PLUGINLIB_EXPORT_CLASS|pluginlib::ClassLoader|class_loader::\w+)', 'pluginlib', False)
    sites(r'\bRCLCPP_COMPONENTS_REGISTER_NODE\b', 'components', False)
    # getParam / getRemoteParam call sites (not the template definitions "T getParam(")
    for name in ('getParam', 'getRemoteParam'):
        for m in re.finditer(r'(?<![\w])(T\s+)?' + name + r'\s*(<[^;()]*?>)?\s*\(', code):
            if m.group(1):
                continue
            p = code.find('(', m.end() - 1)
            a = call_args(code, raw, p)
            cpp[name].append({'file': f, 'line': lineno(raw, m.start()), 'args': a})
    for m in re.finditer(r'\bdeclare_parameter\s*(<[^;()]*?>)?\s*\(', code):
        a = call_args(code, raw, code.find('(', m.end() - 1))
        k = lit(a[0]) if a else None
        cpp['declare_parameter'].append({'file': f, 'line': lineno(raw, m.start()), 'key': k})
        if k: cpp_param_keys[f].add(k)
    for m in re.finditer(r'\bget_parameter\s*\(', code):
        a = call_args(code, raw, code.find('(', m.end() - 1))
        k = lit(a[0]) if a else None
        if k:
            cpp_param_keys[f].add(k)
            if len(a) > 1 and re.fullmatch(r'\w+', a[1]):
                cpp_var_param[(f, a[1])] = k
    for m in re.finditer(r'\b(ROOT_DIR|DEBUG_FILE_DIR)\b', code):
        ln = lineno(raw, m.start())
        if not any(r['line'] == ln and r['file'] == f for r in cpp['root_dir_lines']):
            cpp['root_dir_lines'].append({'file': f, 'line': ln, 'text': raw.splitlines()[ln - 1].strip()[:140]})
# getRemoteParam / getParam literal keys -> camera_loader reads (only the literal part of the name)
for kind in ('getParam', 'getRemoteParam'):
    for r in cpp[kind]:
        keys = []
        for a in r['args']:
            for s in re.findall(r'"([A-Za-z_][\w./]*)"', a):
                keys.append(s.lstrip('/'))
        r['literal_keys'] = keys
        for k in keys:
            cpp_param_keys[r['file']].add(k)

# ---------------------------------------------------------------- Python sites (nodes)
py = collections.defaultdict(list)
py_param_keys = collections.defaultdict(set)
py_param_default = {}
for f in node_py:
    raw = read(f); tree = ast.parse(raw)
    # parameter defaults and self._x = get_parameter("k").value
    attr_param = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'declare_parameter':
            if node.args and isinstance(node.args[0], ast.Constant):
                k = node.args[0].value; py_param_keys[f].add(k)
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    py_param_default[(f, k)] = node.args[1].value
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Attribute):
            v = node.value
            if isinstance(v, ast.Attribute) and v.attr == 'value' and isinstance(v.value, ast.Call) \
                    and isinstance(v.value.func, ast.Attribute) and v.value.func.attr == 'get_parameter' \
                    and v.value.args and isinstance(v.value.args[0], ast.Constant):
                attr_param[node.targets[0].attr] = v.value.args[0].value
    # literal lists assigned to self.<x> (for f-strings over a list)
    lists = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, (ast.List, ast.Tuple)):
            vals = [e.value for e in node.value.elts if isinstance(e, ast.Constant)]
            for t in node.targets:
                nm = t.attr if isinstance(t, ast.Attribute) else (t.id if isinstance(t, ast.Name) else None)
                if nm and vals and len(vals) == len(node.value.elts): lists[nm] = vals
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call): continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else (fn.id if isinstance(fn, ast.Name) else None)
        if name in ('create_publisher', 'create_subscription', 'create_client', 'create_service', 'ActionClient', 'ActionServer'):
            idx = 2 if name in ('ActionClient', 'ActionServer') else 1
            a = node.args[idx] if len(node.args) > idx else None
            rec = {'file': f, 'line': node.lineno}
            if isinstance(a, ast.Constant):
                rec['how'] = 'literal'; rec['names'] = [a.value]
            elif isinstance(a, ast.Attribute) and a.attr in attr_param:
                k = attr_param[a.attr]
                rec['how'] = 'parameter'; rec['param'] = k; rec['names'] = [py_param_default.get((f, k))]
            elif isinstance(a, ast.JoinedStr):
                rec['how'] = 'f-string'
                # expand f"/{name}/change_state" over a literal list iterated by `for name in self.<list>`
                names = []
                for loop in ast.walk(tree):
                    if isinstance(loop, ast.For) and any(n is node for n in ast.walk(loop)):
                        it = loop.iter
                        nm = it.attr if isinstance(it, ast.Attribute) else (it.id if isinstance(it, ast.Name) else None)
                        if nm in lists:
                            for v in lists[nm]:
                                s = ''
                                for part in a.values:
                                    s += part.value if isinstance(part, ast.Constant) else v
                                names.append(s)
                rec['names'] = names
            else:
                rec['how'] = 'other'; rec['names'] = []
            py[name].append(rec)
        elif name in ('create_timer', 'sendTransform', 'TransformBroadcaster', 'StaticTransformBroadcaster'):
            py[name].append({'file': f, 'line': node.lineno})
        elif name == 'open' and isinstance(fn, ast.Name):
            a = node.args[0] if node.args else None
            py['open'].append({'file': f, 'line': node.lineno, 'literal': isinstance(a, ast.Constant)})
        elif name in ('import_module', '__import__', 'system', 'Popen', 'run', 'check_output', 'call') and (
                name in ('import_module', '__import__') or (isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id in ('os', 'subprocess'))):
            py[name].append({'file': f, 'line': node.lineno})

# ---------------------------------------------------------------- launch files (ast)
def share_to_src(pkgname, parts):
    p = posixpath.join(SRC + pkgname, *parts)
    return p if p in FILES else None

def exe_map():
    m = {}
    for p in PKGS:
        cm = SRC + p + '/CMakeLists.txt'
        if cm not in FILES: continue
        t = read(cm)
        for mm in re.finditer(r'add_executable\s*\(\s*(\S+)\s+([^)]*)\)', t):
            srcs = [SRC + p + '/' + s for s in mm.group(2).split() if (SRC + p + '/' + s) in FILES]
            m[(p, mm.group(1))] = srcs
        for mm in re.finditer(r'install\s*\(\s*PROGRAMS\s+([^)]*?)DESTINATION', t, re.S):
            for s in mm.group(1).split():
                if (SRC + p + '/' + s) in FILES:
                    m[(p, posixpath.basename(s))] = [SRC + p + '/' + s]
    return m
EXE = exe_map()

launch = {'nodes': [], 'include': [], 'exec_process': [], 'param_refs': [], 'refs': [], 'remaps': []}
for f in launch_py:
    raw = read(f); tree = ast.parse(raw)
    env = {}   # name -> ('share', pkg) | ('path', relpath or None, text) | ('arg', name)
    arg_default = {}
    def ev(n):
        if isinstance(n, ast.Constant): return ('const', n.value)
        if isinstance(n, ast.Name): return env.get(n.id, ('unknown', n.id))
        if isinstance(n, ast.Call):
            fn = n.func
            nm = fn.attr if isinstance(fn, ast.Attribute) else (fn.id if isinstance(fn, ast.Name) else None)
            if nm == 'get_package_share_directory' and n.args and isinstance(n.args[0], ast.Constant):
                return ('share', n.args[0].value, [])
            if nm == 'join' and isinstance(fn, ast.Attribute):
                vs = [ev(a) for a in n.args]
                if vs and vs[0][0] == 'share' and all(v[0] == 'const' for v in vs[1:]):
                    return ('share', vs[0][1], vs[0][2] + [v[1] for v in vs[1:]])
                return ('unknown', 'join')
            if nm == 'LaunchConfiguration' and n.args and isinstance(n.args[0], ast.Constant):
                return arg_default.get(n.args[0].value, ('arg', n.args[0].value))
        return ('unknown', type(n).__name__)
    # two passes so that later DeclareLaunchArgument defaults are known
    for _ in range(2):
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                v = ev(node.value)
                if v[0] != 'unknown': env[node.targets[0].id] = v
            if isinstance(node, ast.Call) and getattr(node.func, 'id', None) == 'DeclareLaunchArgument':
                nm = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
                for kw in node.keywords:
                    if kw.arg == 'default_value' and nm:
                        v = ev(kw.value)
                        if v[0] == 'share': arg_default[nm] = v
    def target(v):
        if v[0] == 'share':
            return share_to_src(v[1], v[2]), '@share/%s/%s' % (v[1], '/'.join(v[2]))
        return None, None
    # every resolved share path anywhere in the file (path assignments)
    seen_paths = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            v = ev(node)
            if v[0] == 'share' and v[2]:
                t, txt = target(v)
                if t and (t, txt) not in seen_paths:
                    seen_paths.add((t, txt)); launch['refs'].append({'from': f, 'line': node.lineno, 'to': t, 'kind': 'path'})
        if not isinstance(node, ast.Call): continue
        nm = getattr(node.func, 'id', None)
        if nm == 'Node':
            kw = {k.arg: k.value for k in node.keywords}
            p = kw.get('package'); e = kw.get('executable')
            p = p.value if isinstance(p, ast.Constant) else None
            e = e.value if isinstance(e, ast.Constant) else None
            files = EXE.get((p, e), []) if p in PKGS else []
            rec = {'file': f, 'line': node.lineno, 'package': p, 'executable': e, 'project_files': files, 'params': []}
            if 'parameters' in kw and isinstance(kw['parameters'], ast.List):
                for el in kw['parameters'].elts:
                    if isinstance(el, ast.Dict):
                        for dv in el.values:
                            v = ev(dv); t, _ = target(v)
                            if t: rec['params'].append({'yaml': t, 'how': 'dict value (config_file)'})
                        continue
                    v = ev(el); t, _ = target(v)
                    if t: rec['params'].append({'yaml': t, 'how': 'parameter file'})
            if 'remappings' in kw and isinstance(kw['remappings'], ast.List):
                for el in kw['remappings'].elts:
                    if isinstance(el, ast.Tuple) and all(isinstance(x, ast.Constant) for x in el.elts):
                        launch['remaps'].append({'file': f, 'line': el.lineno, 'node': '%s/%s' % (p, e), 'from': el.elts[0].value, 'to': el.elts[1].value})
            launch['nodes'].append(rec)
            for pr in rec['params']:
                launch['param_refs'].append({'launch': f, 'line': node.lineno, 'yaml': pr['yaml'], 'node': '%s/%s' % (p, e), 'project_node_files': files})
        elif nm == 'IncludeLaunchDescription':
            inner = node.args[0] if node.args else None
            t = None; txt = None
            if isinstance(inner, ast.Call) and inner.args:
                t, txt = target(ev(inner.args[0]))
            launch['include'].append({'file': f, 'line': node.lineno, 'to': t, 'text': txt})
        elif nm == 'ExecuteProcess':
            kw = {k.arg: k.value for k in node.keywords}
            cmd = []
            if isinstance(kw.get('cmd'), ast.List):
                cmd = [x.value for x in kw['cmd'].elts if isinstance(x, ast.Constant)]
            launch['exec_process'].append({'file': f, 'line': node.lineno, 'cmd': cmd})
            for i, x in enumerate(cmd):
                if x == '-r' and i + 1 < len(cmd) and ':=' in cmd[i + 1]:
                    a, b = cmd[i + 1].split(':=', 1)
                    launch['remaps'].append({'file': f, 'line': node.lineno, 'node': 'ExecuteProcess ' + ' '.join(cmd[:4]), 'from': a, 'to': b})

# ---------------------------------------------------------------- YAML
def flat(d, pre=''):
    out = {}
    if isinstance(d, dict):
        for k, v in d.items():
            kk = '%s.%s' % (pre, k) if pre else str(k)
            if isinstance(v, dict): out.update(flat(v, kk))
            else: out[kk] = v
    return out
yaml_docs = {}
for f in FILES:
    if f.endswith(('.yaml', '.yml')) and f.startswith(SRC):
        try: yaml_docs[f] = yaml.safe_load(read(f))
        except Exception as e: yaml_docs[f] = {'__error__': str(e)}
yaml_params = {}        # file -> {key: value}  (keys of all nodes merged; used for parameter pairs)
yaml_node_params = {}   # file -> {(node path, key): value}  (used for topic keys, so two nodes' odom_topic stay two)
def find_ros_params(d, path=()):
    if isinstance(d, dict):
        for k, v in d.items():
            if k == 'ros__parameters' and isinstance(v, dict):
                yield '/'.join(path), v
            elif isinstance(v, dict):
                yield from find_ros_params(v, path + (str(k),))
for f, d in yaml_docs.items():
    if isinstance(d, dict):
        keys = {}; nk = {}
        for node, body in find_ros_params(d):
            for k, v in flat(body).items():
                keys[k] = v; nk[(node, k)] = v
        if keys: yaml_params[f] = keys; yaml_node_params[f] = nk

bridge = []
for f, d in yaml_docs.items():
    if isinstance(d, list) and d and isinstance(d[0], dict) and 'ros_topic_name' in d[0]:
        for e in d:
            bridge.append({'file': f, 'ros': e.get('ros_topic_name'), 'gz': e.get('gz_topic_name'), 'dir': e.get('direction')})
ext_cfg_topics = []
# only YAML files that are loaded by external (non-project) nodes other than parameter_blackboard;
# rover/avia/tb3 topic keys are LIVMapper's own parameters and are resolved at its create_subscription sites
_proj_yaml = set(r['yaml'] for r in launch['param_refs'] if r['project_node_files'] or r['node'].endswith('parameter_blackboard'))
_ext_yaml = set(r['yaml'] for r in launch['param_refs']) - _proj_yaml
for f, nkeys in yaml_node_params.items():
    if f not in _ext_yaml: continue
    for (node, k), v in nkeys.items():
        if re.search(r'(^|[._])(\w*_)?topic$', k) and isinstance(v, str) and v.startswith('/'):
            ext_cfg_topics.append({'file': f, 'key': node + ':' + k, 'topic': v})

# ---------------------------------------------------------------- topic endpoints
EP = []
def add(topic, role, f, line, how, owner):
    if topic: EP.append({'topic': topic, 'role': role, 'file': f, 'line': line, 'how': how, 'owner': owner})
yaml_for_livmapper = [f for f in yaml_params if 'common.lid_topic' in yaml_params[f]]
for kind, role in (('create_publisher', 'pub'), ('create_subscription', 'sub')):
    for r in cpp[kind]:
        a0 = r['args'][0] if r['args'] else ''
        t = lit(a0)
        if t:
            r['how'] = 'literal'; add(t, role, r['file'], r['line'], 'literal', 'project')
        elif (r['file'], a0) in cpp_var_param:
            k = cpp_var_param[(r['file'], a0)]
            vals = sorted(set(yaml_params[y][k] for y in yaml_for_livmapper if k in yaml_params[y]))
            r['how'] = 'parameter ' + k; r['values_in_yaml'] = vals
            for v in vals: add(v, role, r['file'], r['line'], 'parameter', 'project')
        else:
            r['how'] = 'other'
for kind, role in (('create_publisher', 'pub'), ('create_subscription', 'sub')):
    for r in py[kind]:
        for t in r.get('names') or []:
            add(t, role, r['file'], r['line'], r['how'], 'project')
for b in bridge:
    if b['dir'] == 'GZ_TO_ROS': add(b['ros'], 'pub', b['file'], None, 'bridge', 'config-bridge')
    elif b['dir'] == 'ROS_TO_GZ': add(b['ros'], 'sub', b['file'], None, 'bridge', 'config-bridge')
for c in ext_cfg_topics:
    add(c['topic'], 'sub', c['file'], None, 'yaml ' + c['key'], 'config-external-node')
for r in launch['remaps']:
    if r['to'].startswith('/'):
        role = 'pub' if r['from'] in ('out',) else 'sub'
        add(r['to'], role, r['file'], r['line'], 'remap ' + r['from'], 'launch-external-node')

bytopic = collections.defaultdict(lambda: {'pub': [], 'sub': []})
for e in EP: bytopic[e['topic']][e['role']].append(e)
site_pairs = []; file_pairs_topic = collections.defaultdict(set)
for t, d in bytopic.items():
    for p in d['pub']:
        for s in d['sub']:
            if p['file'] == s['file']: continue
            site_pairs.append((t, '%s:%s' % (p['file'], p['line']), '%s:%s' % (s['file'], s['line']), p['owner'], s['owner']))
            file_pairs_topic[frozenset((p['file'], s['file']))].add(t)
code_code = set(k for k in file_pairs_topic if all(x.endswith(('.py', '.cpp', '.h')) and not x.endswith('.launch.py') for x in k))

# ---------------------------------------------------------------- launch pairs
lp = collections.defaultdict(set)
for r in launch['refs']: lp[frozenset((r['from'], r['to']))].add('path')
for n in launch['nodes']:
    for t in n['project_files']: lp[frozenset((n['file'], t))].add('run-executable')
    for p in n['params']: lp[frozenset((n['file'], p['yaml']))].add('parameter')
for i in launch['include']:
    if i['to']: lp[frozenset((i['file'], i['to']))].add('include-launch')

# ---------------------------------------------------------------- parameter pairs (yaml used by a launch Node -> code reading its keys)
used_yaml = set(r['yaml'] for r in launch['param_refs'])
# a YAML only pairs with code that runs in the node it is loaded into: a project executable (its own code
# plus the project libraries it links: here any project file that reads the key), or parameter_blackboard
# (read remotely through getRemoteParam). YAML loaded only by external nodes (nav2, octomap_server) is not
# paired with project code even when a key name happens to match (octomap's frame_id vs mapping_controller).
yaml_for_project = set(r['yaml'] for r in launch['param_refs'] if r['project_node_files'] or r['node'].endswith('parameter_blackboard'))
pp = {}
param_detail = {}
code_keys = {}
for f, ks in cpp_param_keys.items(): code_keys[f] = set(ks)
for f, ks in py_param_keys.items(): code_keys.setdefault(f, set()).update(ks)
for y in sorted(used_yaml):
    keys = yaml_params.get(y)
    if not keys: continue
    for f, ks in code_keys.items():
        common = set(keys) & ks
        if common and y in yaml_for_project:
            pp[frozenset((y, f))] = len(common)
    allcode = set().union(*code_keys.values())
    param_detail[y] = {'keys': len(keys), 'read_by_some_code': len(set(keys) & allcode),
                       'not_read': sorted(set(keys) - allcode)}

# ---------------------------------------------------------------- TF duplicates
tf = []
for r in cpp['sendTransform']:
    txt = read(r['file']).splitlines()[r['line'] - 1]
    fr = re.findall(r'"([A-Za-z_][\w/]*)"', txt)
    tf.append({'file': r['file'], 'line': r['line'], 'frames': fr[-2:] if len(fr) >= 2 else None})
for r in py['sendTransform']:
    src = read(r['file'])
    fid = re.findall(r'\.frame_id\s*=\s*"([^"]+)"', src); cid = re.findall(r'child_frame_id\s*=\s*"([^"]+)"', src)
    tf.append({'file': r['file'], 'line': r['line'], 'frames': [fid[0], cid[0]] if fid and cid else None})
byframe = collections.defaultdict(set)
for t in tf:
    if t['frames']: byframe[tuple(t['frames'])].add(t['file'])
tfp = {}
for fr, fs in byframe.items():
    fs = sorted(fs)
    for i in range(len(fs)):
        for j in range(i + 1, len(fs)):
            tfp[frozenset((fs[i], fs[j]))] = fr

# ---------------------------------------------------------------- light graph
inc = json.load(open(incp))
L = set(tuple(e) for e in inc['edges_sorted'])
adj = collections.defaultdict(set)
for a, b in L: adj[a].add(b); adj[b].add(a)
def connected(a, b):
    if a not in adj or b not in adj: return False
    seen = {a}; st = [a]
    while st:
        x = st.pop()
        if x == b: return True
        for y in adj[x]:
            if y not in seen: seen.add(y); st.append(y)
    return False
cross_light = collections.Counter()
for a, b in L:
    if pkg(a) != pkg(b): cross_light[frozenset((pkg(a), pkg(b)))] += 1

def summarize(pairs):
    pairs = set(pairs)
    return {'pairs': len(pairs),
            'direct_light_edge': sum(1 for p in pairs if len(p) == 2 and (tuple(sorted(p)) in L or tuple(sorted(p, reverse=True)) in L)),
            'connected_in_light_graph': sum(1 for p in pairs if len(p) == 2 and connected(*sorted(p))),
            'both_sides_cpp': sum(1 for p in pairs if all(x.endswith(CPP_EXT) for x in p)),
            'one_side_has_any_light_edge': sum(1 for p in pairs if any(x in adj for x in p)),
            'cross_package': sum(1 for p in pairs if len(set(pkg(x) for x in p)) == 2),
            'cross_package_with_light_edge_between_packages': sum(1 for p in pairs if len(set(pkg(x) for x in p)) == 2 and cross_light.get(frozenset(pkg(x) for x in p), 0) > 0)}

allp = set(file_pairs_topic) | set(lp) | set(pp) | set(tfp)
files_inv = set().union(*allp) if allp else set()

# ---------------------------------------------------------------- extras the measurement did not count
extra = collections.defaultdict(set)
# shell scripts naming project files / launch files / ros2 run executables
for f in FILES:
    if f.endswith('.sh'):
        t = read(f)
        for m in re.finditer(r'python3\s+(\S+\.py)', t):
            p = m.group(1).replace('src/', SRC, 1) if m.group(1).startswith('src/') else m.group(1)
            if p in FILES: extra['shell->script'].add(frozenset((f, p)))
        for m in re.finditer(r'ros2\s+launch\s+(\w+)\s+(\S+\.launch\.py)', t):
            p = SRC + m.group(1) + '/launch/' + m.group(2)
            if p in FILES: extra['shell->launch'].add(frozenset((f, p)))
        for m in re.finditer(r'ros2\s+run\s+(\w+)\s+(\S+)', t):
            for s in EXE.get((m.group(1), m.group(2)), []): extra['shell->executable'].add(frozenset((f, s)))
# rviz displays subscribing to project-published topics
proj_pub = collections.defaultdict(set)
for e in EP:
    if e['role'] == 'pub' and e['owner'] == 'project': proj_pub[e['topic']].add(e['file'])
rviz_topics = collections.Counter()
for f in FILES:
    if f.endswith('.rviz'):
        d = yaml.safe_load(read(f))
        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k == 'Value' and isinstance(v, str) and v.startswith('/'): yield v
                    else: yield from walk(v)
            elif isinstance(o, list):
                for x in o: yield from walk(x)
        for t in set(walk(d)):
            rviz_topics[f] += 1
            for pf in proj_pub.get(t, ()): extra['rviz->publisher'].add(frozenset((f, pf)))
# URDF/SDF gz topics <-> bridge gz_topic_name
gz_bridge_topics = {b['gz'].lstrip('/'): b['file'] for b in bridge if b['gz']}
for f in FILES:
    if f.endswith(('.xacro', '.urdf', '.sdf')):
        for m in re.finditer(r'<topic>\s*([^<\s]+)\s*</topic>', read(f)):
            t = m.group(1).lstrip('/')
            for bt, bf in gz_bridge_topics.items():
                if bt == t or bt.startswith(t + '/'):
                    extra['model gz topic->bridge'].add(frozenset((f, bf)))

# ---------------------------------------------------------------- package relations
pkgrel = collections.defaultdict(set)
for p in PKGS:
    px = SRC + p + '/package.xml'
    if px in FILES:
        for m in re.finditer(r'<(\w*depend)>\s*([\w-]+)\s*</\1>', read(px)):
            if m.group(2) in PKGS and m.group(2) != p:
                pkgrel[frozenset((p, m.group(2)))].add('package.xml ' + m.group(1))
    cm = SRC + p + '/CMakeLists.txt'
    if cm in FILES:
        t = re.sub(r'#[^\n]*', '', read(cm))
        for m in re.finditer(r'(ament_target_dependencies|target_link_libraries|target_include_directories|find_package|set)\s*\(([^)]*)\)', t, re.I):
            for q in PKGS:
                if q != p and re.search(r'(?<![\w])' + re.escape(q) + r'(?![\w])', m.group(2)):
                    pkgrel[frozenset((p, q))].add('cmake ' + m.group(1).lower())
for k, v in cross_light.items(): pkgrel[k].add('light-scan edge x%d' % v)
for pr in allp:
    ps = frozenset(pkg(x) for x in pr)
    if len(ps) == 2 and '(root)' not in ps: pkgrel[ps].add('runtime file pair')
missing_deps = []
for p in PKGS:
    px = SRC + p + '/package.xml'
    if px in FILES:
        for m in re.finditer(r'<(\w*depend)>\s*([\w-]+)\s*</\1>', read(px)):
            if m.group(2).startswith(('fast_livo', 'vikit', 'tb3')) and m.group(2) not in PKGS:
                missing_deps.append({'package': p, 'dep': m.group(2), 'line': lineno(read(px), m.start())})

# ---------------------------------------------------------------- non-existent things
zero_checks = {
    'project .msg/.srv/.action/.idl files': sorted(f for f in FILES if f.endswith(('.msg', '.srv', '.action', '.idl'))),
    'setup.py/setup.cfg/pyproject.toml': sorted(f for f in FILES if posixpath.basename(f) in ('setup.py', 'setup.cfg', 'pyproject.toml')),
    'configure_file in CMake': sorted('%s:%d' % (f, lineno(read(f), m.start())) for f in FILES if f.endswith('CMakeLists.txt') for m in re.finditer(r'configure_(package_config_)?file', read(f))),
    'plugin XML (pluginlib export)': sorted(f for f in FILES if f.endswith('.xml') and 'class_libraries' in read(f)),
}
gz_plugins = []
for f in FILES:
    if f.endswith(('.xacro', '.urdf', '.sdf')):
        t = read(f)
        for m in re.finditer(r'<plugin\b[^>]*?filename="([^"]+)"', t, re.S):
            gz_plugins.append({'file': f, 'line': lineno(t, m.start()), 'filename': m.group(1)})

def P(s): return sorted(sorted(x) for x in s)
out = {
    'cpp_counts': {k: len(v) for k, v in cpp.items()},
    'cpp_pub_literal': sum(1 for r in cpp['create_publisher'] if r.get('how') == 'literal'),
    'cpp_sub_how': collections.Counter(r.get('how', '').split(' ')[0] for r in cpp['create_subscription']),
    'cpp_getParam_by_file': collections.Counter(r['file'] for r in cpp['getParam']),
    'cpp_getRemoteParam_by_file': collections.Counter(r['file'] for r in cpp['getRemoteParam']),
    'cpp_declare_parameter_by_file': collections.Counter(r['file'] for r in cpp['declare_parameter']),
    'cpp_sites': {k: v for k, v in cpp.items() if k not in ('getParam', 'declare_parameter')},
    'py_counts': {k: len(v) for k, v in py.items()},
    'py_sites': py,
    'launch_counts': {'Node': len(launch['nodes']), 'Node_to_project_file': sum(1 for n in launch['nodes'] if n['project_files']),
                      'Node_project_files_distinct': len(set(x for n in launch['nodes'] for x in n['project_files'])),
                      'IncludeLaunchDescription': len(launch['include']), 'include_to_project': sum(1 for i in launch['include'] if i['to']),
                      'param_file_refs': len(launch['param_refs']), 'param_yaml_distinct': len(used_yaml),
                      'ExecuteProcess': len(launch['exec_process']), 'remaps': len(launch['remaps'])},
    'launch': launch,
    'bridge_entries': len(bridge), 'ext_cfg_topics': ext_cfg_topics,
    'topic_endpoints': len(EP), 'topic_site_pairs': len(site_pairs), 'topic_site_pair_list': site_pairs,
    'topic_file_pairs': {(' <-> '.join(sorted(k))): sorted(v) for k, v in file_pairs_topic.items()},
    'topic_code_code_file_pairs': P(code_code),
    'launch_pairs': {(' <-> '.join(sorted(k))): sorted(v) for k, v in lp.items()},
    'param_pairs': {(' <-> '.join(sorted(k))): v for k, v in pp.items()}, 'param_yaml_detail': param_detail,
    'tf': tf, 'tf_dup_pairs': {(' <-> '.join(sorted(k))): v for k, v in tfp.items()},
    'summary': {'topic': summarize(file_pairs_topic), 'launch': summarize(lp), 'parameter': summarize(pp), 'tf': summarize(tfp),
                'all': summarize(allp), 'sum_of_kinds': len(file_pairs_topic) + len(lp) + len(pp) + len(tfp),
                'files_involved': len(files_inv),
                'overlaps': P(set(file_pairs_topic) & set(lp)) + P(set(file_pairs_topic) & set(pp)) + P(set(lp) & set(pp))},
    'extra_not_in_35': {k: P(v) for k, v in extra.items()},
    'extra_summary': {k: summarize(v) for k, v in extra.items()},
    'extra_new_vs_35': len(set().union(*extra.values()) - allp) if extra else 0,
    'rviz_topics_per_file': rviz_topics,
    'package_relations': {(' <-> '.join(sorted(k))): sorted(v) for k, v in sorted(pkgrel.items(), key=lambda x: sorted(x[0]))},
    'missing_own_deps': missing_deps,
    'zero_checks': zero_checks, 'gz_plugins': gz_plugins,
}
json.dump(out, open(outp, 'w'), indent=1, ensure_ascii=False, default=lambda o: dict(o) if isinstance(o, collections.Counter) else list(o))
show = {k: out[k] for k in ('cpp_counts', 'cpp_pub_literal', 'cpp_sub_how', 'cpp_getParam_by_file', 'cpp_getRemoteParam_by_file',
                            'cpp_declare_parameter_by_file', 'py_counts', 'launch_counts', 'bridge_entries', 'topic_endpoints',
                            'topic_site_pairs', 'summary', 'extra_summary', 'extra_new_vs_35', 'param_yaml_detail', 'missing_own_deps', 'zero_checks')}
show['ext_cfg_topics'] = len(ext_cfg_topics); show['gz_plugins'] = len(gz_plugins)
show['package_relations'] = out['package_relations']
print(json.dumps(show, indent=1, ensure_ascii=False, default=lambda o: dict(o) if isinstance(o, collections.Counter) else list(o)))
