#!/usr/bin/env python3
"""Light Python import scan: a measurement prototype for slice-8 spec draft 4, section 11.3.

Run only as (Python 3.11+, standard library only, never from inside the scanned tree):

    python3 -I light_import_scan.py WORKSPACE [--file-list LIST] [--literal-dynamic] [--out OUT.json] [--pretty]

What it does (draft 4 section 11.3, read line by line; deviations are listed in prototype/README.md):
  * material: the claimed Python files (*.py / *.pyi, extension case-insensitive) of WORKSPACE, either from a walk
    that never enters .git node_modules .venv venv __pycache__ .mypy_cache .pytest_cache .tox (symlinks are not
    material), or from --file-list (paths relative to WORKSPACE, newline- or NUL-separated, e.g. `git ls-files -z`;
    the same directory names are still dropped).  Each file is read like the capture reads it: over 2 MiB ->
    skipped 'source exceeds file capacity'; NUL byte or not UTF-8 -> skipped 'binary source'; one leading BOM is
    dropped (the kernel's TextDecoder does that).
  * configuration: the first of pyrightconfig.json, pyproject.toml, setup.cfg that EXISTS at the root (read or
    skipped); a skipped one fails the language with '<name> 读不了：<skip reason>'; no fall-back.
  * import roots in the per-configuration order of 11.3; observation-mode notes for unused fields and unusable
    roots; only the config error literals of 11.3 fail the language.
  * every file: ast.parse once; SyntaxError / RecursionError / MemoryError / ValueError fail the file with
    '<type>: <msg>' (SyntaxError and subclasses use .msg, others str(e); first 200 characters); every
    Import / ImportFrom anywhere in the tree is collected; importlib / __import__ are NOT edges.
  * resolution: CPython-style, one level at a time, exact-case paths, per 11.3 (lookup order n/__init__.py, n.py,
    n/__init__.pyi, n.pyi, namespace portion); reasons as the literals of 11.3; self edges dropped; edges deduped
    by (from, to) keeping the first specifier; unresolved deduped by (from, specifier) keeping the first non-null
    reason in string order; a (from, specifier) may have both an edge and an unresolved entry.
  * --literal-dynamic: additionally (separately, never as edges) reports importlib.import_module("x") /
    __import__("x") calls whose name is a string literal, resolved with the same rules, plus the non-literal
    call sites.

Output: one JSON object {files, parsed, failed, edges, unresolved, notes, reason, ...}; see README.md.
"""
import argparse
import ast
import configparser
import json
import os
import stat
import sys
import time
import warnings

PROTOTYPE_VERSION = 1
SKIP_DIRS = frozenset(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox'])
CONFIG_NAMES = ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg']
FILE_BYTES = 2 * 1024 * 1024
UNIT_LIMIT_S = 20.0
LANGUAGE_LIMIT_S = 120.0
PARSE_FAILURES = (SyntaxError, RecursionError, MemoryError, ValueError)
UNUSED_PYRIGHT_FIELDS = ['pythonVersion', 'pythonPlatform', 'venv', 'venvPath', 'typeshedPath',
                         'executionEnvironments', 'include', 'exclude', 'ignore']
ROOT_FORBIDDEN_CHARS = ['\\', ':', '$', '~', '*', '?', '\0']

# Reason literals (draft 4, 11.3 / 11.5)
R_NOT_PACKAGE = '{} 是模块，不是包'
R_STDLIB = '命名空间目录和标准库重名'
R_NAMESPACE = '命名空间包，没有文件'
R_BEYOND_TOP = '相对导入越过了顶层包'


class ConfigError(Exception):
    """Carries one of the 11.3 configuration failure literals."""


def first200(text):
    return text[:200]


def claimed(path):
    lower = path.lower()
    return lower.endswith('.py') or lower.endswith('.pyi')


def safe_path(path):
    """isSafeSourcePath (project-source-snapshot.ts:66) plus the skip-list directories."""
    if not path or any(ch in path for ch in ['\\', ':', '\0']):
        return False
    parts = path.split('/')
    if any(not part or part in ('.', '..') for part in parts):
        return False
    return not any(part in SKIP_DIRS for part in parts[:-1])


# ---------------------------------------------------------------------------------------------- material

def read_like_capture(abs_path):
    """(content, None) or (None, skip reason), as captureObservationSource + the kernel decoder would."""
    try:
        info = os.lstat(abs_path)
        if not stat.S_ISREG(info.st_mode):
            return None, 'binary source'
        if info.st_size > FILE_BYTES:
            return None, 'source exceeds file capacity'
        with open(abs_path, 'rb') as handle:
            data = handle.read(FILE_BYTES + 1)
    except OSError:
        return None, 'source unavailable, denied or exceeds file capacity'
    if len(data) > FILE_BYTES:
        return None, 'source exceeds file capacity'
    if b'\0' in data:
        return None, 'binary source'
    try:
        return data.decode('utf-8-sig'), None
    except UnicodeDecodeError:
        return None, 'binary source'


def inventory(workspace, file_list):
    """Relative posix paths of regular, non-symlink files that are material candidates."""
    stats = {'unsafeOrSkippedListPaths': 0, 'missingListPaths': 0, 'symlinks': 0}
    paths = []
    if file_list is None:
        for current, dirnames, filenames in os.walk(workspace, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not os.path.islink(os.path.join(current, d)))
            rel_dir = os.path.relpath(current, workspace).replace(os.sep, '/')
            rel_dir = '' if rel_dir == '.' else rel_dir
            for name in filenames:
                rel = rel_dir + '/' + name if rel_dir else name
                full = os.path.join(current, name)
                if os.path.islink(full):
                    stats['symlinks'] += 1
                    continue
                if not safe_path(rel):
                    stats['unsafeOrSkippedListPaths'] += 1
                    continue
                paths.append(rel)
    else:
        with open(file_list, 'rb') as handle:
            raw = handle.read().decode('utf-8', 'surrogateescape')
        entries = raw.split('\0') if '\0' in raw else raw.splitlines()
        for rel in entries:
            if not rel:
                continue
            if not safe_path(rel):
                stats['unsafeOrSkippedListPaths'] += 1
                continue
            full = os.path.join(workspace, *rel.split('/'))
            try:
                info = os.lstat(full)
            except OSError:
                stats['missingListPaths'] += 1
                continue
            if stat.S_ISLNK(info.st_mode):
                stats['symlinks'] += 1
                continue
            if not stat.S_ISREG(info.st_mode):
                continue
            paths.append(rel)
    return sorted(set(paths)), stats


# ---------------------------------------------------------------------------------------------- roots

class RootPlan:
    def __init__(self, claimed_paths):
        self.claimed_paths = claimed_paths
        self.roots = []          # normalized, '' is the workspace root
        self.unusable = []       # as written in the configuration
        self.unused = set()      # field names

    def has_python_under(self, rel):
        if rel == '':
            return bool(self.claimed_paths)
        prefix = rel + '/'
        return any(path.startswith(prefix) for path in self.claimed_paths)

    def add(self, value, implicit=False):
        if not isinstance(value, str):
            self.unusable.append(json.dumps(value, ensure_ascii=False))
            return
        if implicit and value == '.' and not self.claimed_paths:
            return  # no Python files: today's code does not add '.' either (python-source-query.py:84)
        reason = None
        if value.startswith('/') or any(ch in value for ch in ROOT_FORBIDDEN_CHARS):
            reason = 'syntax'
        parts = value.split('/')
        if reason is None and ('..' in parts or '' in parts):
            reason = 'syntax'
        if reason is None:
            rel = '/'.join(part for part in parts if part != '.')
            if any(part in SKIP_DIRS for part in rel.split('/') if part):
                reason = 'skipped-dir'
            elif not self.has_python_under(rel):
                reason = 'no-python'
        if reason is not None:
            self.unusable.append(value)
            return
        if rel not in self.roots:
            self.roots.append(rel)


def string_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def pyright_section(plan, data, fname, not_object_literal):
    if not isinstance(data, dict):
        raise ConfigError(not_object_literal)
    if 'extends' in data:
        raise ConfigError('配置错误：{} 的 extends 观测还不跟进'.format(fname))
    for field in UNUSED_PYRIGHT_FIELDS:
        if field in data:
            plan.unused.add(field)
    if data.get('autoSearchPaths', True) is not False and plan.has_python_under('src'):
        plan.add('src')
    extra = data.get('extraPaths', [])
    if not string_list(extra):
        raise ConfigError('配置错误：{} 的 extraPaths 不是字符串列表'.format(fname))
    for value in extra:
        plan.add(value)
    if 'stubPath' in data:
        stub = data['stubPath']
        if not isinstance(stub, str) or not stub:
            raise ConfigError('配置错误：{} 的 stubPath 不是非空字符串'.format(fname))
        plan.add(stub)


def plan_roots(selected, content, claimed_paths):
    """Import roots in the 11.3 order for the selected configuration (None = no configuration)."""
    plan = RootPlan(claimed_paths)
    plan.add('.', implicit=True)
    if selected is None:
        if plan.has_python_under('src'):
            plan.add('src')
    elif selected == 'pyrightconfig.json':
        try:
            data = json.loads(content)
        except ValueError:
            raise ConfigError('配置错误：pyrightconfig.json 解析不了')
        pyright_section(plan, data, 'pyrightconfig.json', '配置错误：pyrightconfig.json 不是对象')
    elif selected == 'pyproject.toml':
        import tomllib
        try:
            data = tomllib.loads(content)
        except tomllib.TOMLDecodeError:
            raise ConfigError('配置错误：pyproject.toml 解析不了')
        tool = data.get('tool', {})
        if not isinstance(tool, dict):
            raise ConfigError('配置错误：pyproject.toml 的 tool 不是表')
        setuptools = tool.get('setuptools', {})
        if not isinstance(setuptools, dict):
            raise ConfigError('配置错误：pyproject.toml 的 tool.setuptools 不是表')
        package_dir = setuptools.get('package-dir', {})
        if not isinstance(package_dir, dict):
            raise ConfigError('配置错误：pyproject.toml 的 tool.setuptools.package-dir 不是表')
        for package, value in package_dir.items():
            if package:
                plan.unused.add('package-dir')
            else:
                plan.add(value)
        packages = setuptools.get('packages', {})
        if isinstance(packages, dict) and isinstance(packages.get('find'), dict):
            where = packages['find'].get('where', [])
            if not string_list(where):
                raise ConfigError('配置错误：pyproject.toml 的 packages.find.where 不是字符串列表')
            for value in where:
                plan.add(value)
        pyright_section(plan, tool.get('pyright', {}), 'pyproject.toml', '配置错误：pyproject.toml 的 tool.pyright 不是对象')
    elif selected == 'setup.cfg':
        parser = configparser.ConfigParser(interpolation=None)
        try:
            parser.read_string(content)
            mapping = parser.get('options', 'package_dir', fallback='')
            where = parser.get('options.packages.find', 'where', fallback='')
        except configparser.Error:
            raise ConfigError('配置错误：setup.cfg 解析不了')
        for entry in mapping.splitlines():
            if entry.strip():
                package, separator, value = entry.partition('=')
                if not separator or package.strip():
                    plan.unused.add('package_dir')
                else:
                    plan.add(value.strip())
        for value in where.replace(',', '\n').splitlines():
            if value.strip():
                plan.add(value.strip())
    notes = []
    if selected is not None and plan.unused:
        notes.append(first200('{} 里观测不用的字段：{}'.format(selected, '、'.join(sorted(plan.unused)))))
    if plan.unusable:
        notes.append(first200('{} 里用不了的查找根：{}'.format(selected or '(没有配置)', '、'.join(sorted(set(plan.unusable))))))
    return plan.roots, notes


# ---------------------------------------------------------------------------------------------- resolution

class Found:
    __slots__ = ('kind', 'file', 'dirs')

    def __init__(self, kind, file=None, dirs=None):
        self.kind = kind          # 'package' (regular), 'module', 'namespace'
        self.file = file          # the edge target for package / module
        self.dirs = dirs or []    # where the next level is searched (package / namespace)


class Resolver:
    def __init__(self, material_paths, roots):
        self.files = set(material_paths)
        self.dirs = set()
        for path in material_paths:
            parts = path.split('/')
            for i in range(1, len(parts)):
                self.dirs.add('/'.join(parts[:i]))
        self.roots = roots
        self.stdlib = frozenset(sys.stdlib_module_names)

    def find(self, dirs, name):
        portions = []
        for d in dirs:
            p = d + '/' + name if d else name
            if p + '/__init__.py' in self.files:
                return Found('package', p + '/__init__.py', [p])
            if p + '.py' in self.files:
                return Found('module', p + '.py')
            if p + '/__init__.pyi' in self.files:
                return Found('package', p + '/__init__.pyi', [p])
            if p + '.pyi' in self.files:
                return Found('module', p + '.pyi')
            if p in self.dirs:
                portions.append(p)
        if portions:
            return Found('namespace', None, portions)
        return None

    def walk(self, segments, first_dirs, absolute, shown_prefix=''):
        """('ok', Found) or ('unresolved', reason).  shown_prefix is '' for absolute names, the dots otherwise."""
        dirs, first, found = first_dirs, None, None
        for i, segment in enumerate(segments):
            found = self.find(dirs, segment)
            if found is None:
                return 'unresolved', None
            if found.kind == 'module' and i < len(segments) - 1:
                return 'unresolved', R_NOT_PACKAGE.format(shown_prefix + '.'.join(segments[:i + 1]))
            if i == 0:
                first = found
            dirs = found.dirs
        if absolute and first.kind == 'namespace' and segments[0] in self.stdlib:
            return 'unresolved', R_STDLIB
        return 'ok', found

    def module_identity(self, path):
        """(module segments, package segments) from the longest import root that contains the file."""
        best = None
        for root in self.roots:
            if root == '' or path.startswith(root + '/'):
                if best is None or len(root) > len(best):
                    best = root
        rel = path if not best else path[len(best) + 1:]
        parts = rel.split('/')
        last = parts[-1]
        stem = last[:-4] if last.lower().endswith('.pyi') else last[:-3]
        if stem == '__init__':
            module = parts[:-1]
            return module, module
        return parts[:-1] + [stem], parts[:-1]

    def package_dir(self, directory):
        if (directory + '/__init__.py' if directory else '__init__.py') in self.files:
            return Found('package', (directory + '/' if directory else '') + '__init__.py', [directory])
        if (directory + '/__init__.pyi' if directory else '__init__.pyi') in self.files:
            return Found('package', (directory + '/' if directory else '') + '__init__.pyi', [directory])
        return Found('namespace', None, [directory])

    def relative_base(self, path, level):
        """Start directory for k dots, or None when the import goes beyond the top-level package."""
        _, package = self.module_identity(path)
        if len(package) < level:
            return None
        parts = path.split('/')[:-1]
        if level - 1 > 0:
            parts = parts[:len(parts) - (level - 1)]
        return '/'.join(parts)

    # One statement -> list of (kind, target_or_reason, specifier); kind is 'edge' or 'unresolved'.
    def resolve_import(self, dotted):
        status, value = self.walk(dotted.split('.'), self.roots, True)
        if status == 'unresolved':
            return [('unresolved', value, dotted)]
        if value.kind == 'namespace':
            return [('unresolved', R_NAMESPACE, dotted)]
        return [('edge', value.file, dotted)]

    def resolve_from(self, path, level, module, names):
        specifier = '.' * level + (module or '')
        if level == 0:
            status, x = self.walk(module.split('.'), self.roots, True)
        else:
            base = self.relative_base(path, level)
            if base is None:
                return [('unresolved', R_BEYOND_TOP, specifier)]
            if module:
                status, x = self.walk(module.split('.'), [base], False, '.' * level)
            else:
                status, x = 'ok', self.package_dir(base)
        if status == 'unresolved':
            return [('unresolved', x, specifier)]
        out = []
        for name in names:
            if name == '*' or x.kind == 'module':
                out.append(('unresolved', R_NAMESPACE, specifier) if x.kind == 'namespace' else ('edge', x.file, specifier))
                continue
            sub = self.find(x.dirs, name)
            if sub is not None and sub.kind in ('module', 'package'):
                out.append(('edge', sub.file, specifier))
            elif sub is not None:
                out.append(('unresolved', R_NAMESPACE, specifier))
            elif x.kind == 'package':
                out.append(('edge', x.file, specifier))
            else:
                out.append(('unresolved', R_NAMESPACE, specifier))
        return out

    # --literal-dynamic: importlib.import_module / __import__ with a literal name (prototype-only reasons)
    def resolve_dynamic(self, path, func, call):
        name_node = call.args[0] if call.args else next((k.value for k in call.keywords if k.arg == 'name'), None)
        if not (isinstance(name_node, ast.Constant) and isinstance(name_node.value, str)):
            return None
        name = name_node.value
        if func == '__import__':
            level_node = call.args[4] if len(call.args) > 4 else next((k.value for k in call.keywords if k.arg == 'level'), None)
            level = level_node.value if isinstance(level_node, ast.Constant) and isinstance(level_node.value, int) else 0
            if level > 0:
                return self.resolve_from(path, level, name, ['*'])
            return self.resolve_import(name) if name else [('unresolved', '动态：名字是空串', name)]
        # import_module(name, package=None)
        if not name.startswith('.'):
            return self.resolve_import(name) if name else [('unresolved', '动态：名字是空串', name)]
        package_node = call.args[1] if len(call.args) > 1 else next((k.value for k in call.keywords if k.arg == 'package'), None)
        module, package = self.module_identity(path)
        if isinstance(package_node, ast.Constant) and isinstance(package_node.value, str):
            anchor = package_node.value
        elif isinstance(package_node, ast.Name) and package_node.id == '__package__':
            anchor = '.'.join(package)
        elif isinstance(package_node, ast.Name) and package_node.id == '__name__':
            anchor = '.'.join(module)
        elif package_node is None:
            return [('unresolved', '动态：相对名字没有 package', name)]
        else:
            return [('unresolved', '动态：package 不是字面量', name)]
        if not anchor:
            return [('unresolved', '动态：相对名字没有 package', name)]
        level = len(name) - len(name.lstrip('.'))
        bits = anchor.rsplit('.', level - 1)
        if len(bits) < level:
            return [('unresolved', R_BEYOND_TOP, name)]
        rest = name[level:]
        absolute = bits[0] + ('.' + rest if rest else '')
        return self.resolve_import(absolute)


def dynamic_kind(func):
    if isinstance(func, ast.Name) and func.id in ('import_module', '__import__'):
        return func.id
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        if func.attr == 'import_module' and func.value.id == 'importlib':
            return 'import_module'
        if func.attr == '__import__' and func.value.id in ('importlib', 'builtins'):
            return '__import__'
    return None


# ---------------------------------------------------------------------------------------------- scan

def scan(workspace, file_list=None, literal_dynamic=False):
    started = time.perf_counter()
    result = {'prototype': 'light_import_scan.py', 'prototypeVersion': PROTOTYPE_VERSION,
              'python': sys.version.split()[0], 'workspace': os.path.abspath(workspace),
              'inventory': 'file-list' if file_list else 'walk'}
    if sys.version_info < (3, 11):
        result.update(files=0, parsed=0, edgesStatus='failed', reason='分析器不可用', failed=[], skipped=[],
                      edges=[], unresolved=[], notes=[])
        return result
    paths, inv_stats = inventory(workspace, file_list)
    present = set(paths)
    claimed_paths = [path for path in paths if claimed(path)]
    material, skipped = {}, []
    for path in claimed_paths:
        content, reason = read_like_capture(os.path.join(workspace, *path.split('/')))
        if reason is None:
            material[path] = content
        else:
            skipped.append({'path': path, 'reason': reason})
    material_paths = sorted(material)
    result.update(files=len(claimed_paths), inventoryStats=dict(inv_stats, inventoryPaths=len(paths)))

    def fail_language(reason, config):
        result.update(parsed=0, edgesStatus='failed', reason=reason, config=config, roots=None,
                      failed=[], skipped=skipped, edges=[], unresolved=[], notes=[])
        result['stats'] = {'seconds': round(time.perf_counter() - started, 3)}
        return result

    selected = next((name for name in CONFIG_NAMES if name in present), None)
    content = None
    if selected is not None:
        content, reason = read_like_capture(os.path.join(workspace, selected))
        if reason is not None:
            return fail_language('{} 读不了：{}'.format(selected, reason), selected)
    try:
        roots, notes = plan_roots(selected, content, material_paths)
    except ConfigError as error:
        return fail_language(str(error), selected)
    resolver = Resolver(material_paths, roots)
    edges, unresolved = {}, {}
    failed, parsed = [], 0
    raw_references = 0
    dyn_sites, dyn_nonliteral = [], []
    slowest, slowest_path, over_unit = 0.0, None, 0
    unexpected = 0
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        for path in material_paths:
            t0 = time.perf_counter()
            try:
                tree = ast.parse(material[path], filename=path)
            except PARSE_FAILURES as error:
                message = error.msg if isinstance(error, SyntaxError) else str(error)
                failed.append({'path': path, 'reason': first200('{}: {}'.format(type(error).__name__, message))})
                continue
            try:
                found = []
                nodes = []
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        nodes.append(node)
                    elif literal_dynamic and isinstance(node, ast.Call):
                        kind = dynamic_kind(node.func)
                        if kind:
                            nodes.append(node)
                nodes.sort(key=lambda n: (n.lineno, n.col_offset))
                file_dyn = []
                for node in nodes:
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            raw_references += 1
                            found.extend(resolver.resolve_import(alias.name))
                    elif isinstance(node, ast.ImportFrom):
                        names = [alias.name for alias in node.names]
                        raw_references += len(names)
                        found.extend(resolver.resolve_from(path, node.level or 0, node.module, names))
                    else:
                        kind = dynamic_kind(node.func)
                        outcome = resolver.resolve_dynamic(path, kind, node)
                        if outcome is None:
                            arg = node.args[0] if node.args else None
                            dyn_nonliteral.append({'from': path, 'line': node.lineno, 'func': kind,
                                                   'arg': first200(ast.unparse(arg)) if arg is not None else None})
                        else:
                            for item in outcome:
                                file_dyn.append((item, node.lineno, kind))
            except Exception as error:  # not in the 11.3 list: the real script would crash on this unit
                unexpected += 1
                failed.append({'path': path, 'reason': '分析进程崩溃（原型里是 {}: {}）'.format(type(error).__name__, first200(str(error)))})
                continue
            parsed += 1
            for kind, value, specifier in found:
                if kind == 'edge':
                    if value != path:
                        edges.setdefault((path, value), specifier)
                else:
                    unresolved.setdefault((path, specifier), set()).add(value)
            for (kind, value, specifier), line, func in file_dyn:
                if kind == 'edge' and value == path:
                    continue
                dyn_sites.append({'from': path, 'line': line, 'func': func, 'specifier': specifier,
                                  'to': value if kind == 'edge' else None,
                                  'reason': None if kind == 'edge' else value})
            elapsed = time.perf_counter() - t0
            if elapsed > slowest:
                slowest, slowest_path = elapsed, path
            if elapsed > UNIT_LIMIT_S:
                over_unit += 1
    edge_list = [[f, t, s] for (f, t), s in sorted(edges.items())]
    unresolved_list = []
    for (f, s), reasons in sorted(unresolved.items()):
        non_null = sorted(r for r in reasons if r is not None)
        unresolved_list.append({'from': f, 'specifier': s, 'reason': non_null[0] if non_null else None})
    total = time.perf_counter() - started
    by_reason = {}
    for item in unresolved_list:
        key = item['reason'] if item['reason'] is not None else 'null'
        by_reason[key] = by_reason.get(key, 0) + 1
    notes = sorted(set(notes))[:10]
    result.update(parsed=parsed, edgesStatus='supported', reason=None, config=selected,
                  roots=[root or '.' for root in roots], failed=sorted(failed, key=lambda x: x['path']),
                  skipped=skipped, edges=edge_list, unresolved=unresolved_list, notes=notes)
    issue_count = len(failed) + len(skipped)
    result['complete'] = parsed == result['files'] and issue_count == 0
    result['stats'] = {'seconds': round(total, 3), 'rawReferences': raw_references, 'edges': len(edge_list),
                       'unresolved': len(unresolved_list), 'unresolvedByReason': by_reason,
                       'slowestFileSeconds': round(slowest, 4), 'slowestFile': slowest_path,
                       'filesOverUnitLimit20s': over_unit, 'overLanguageLimit120s': total > LANGUAGE_LIMIT_S,
                       'unexpectedExceptions': unexpected}
    if literal_dynamic:
        static_pairs = set(edges)
        dyn_pairs = {(site['from'], site['to']) for site in dyn_sites if site['to'] is not None}
        result['dynamic'] = {
            'note': 'separate from edges: literal importlib.import_module / __import__ calls',
            'literalSites': len(dyn_sites), 'nonLiteralSites': len(dyn_nonliteral),
            'resolvedSites': sum(1 for site in dyn_sites if site['to'] is not None),
            'edgePairs': len(dyn_pairs), 'edgePairsNotInStaticEdges': len(dyn_pairs - static_pairs),
            'sites': dyn_sites, 'nonLiteral': dyn_nonliteral}
    return result


def main(argv):
    parser = argparse.ArgumentParser(description='Light Python import scan prototype (slice-8 draft 4, 11.3).')
    parser.add_argument('workspace')
    parser.add_argument('--file-list', help='paths relative to WORKSPACE, newline- or NUL-separated')
    parser.add_argument('--literal-dynamic', action='store_true')
    parser.add_argument('--out', help='write JSON here instead of stdout')
    parser.add_argument('--pretty', action='store_true')
    args = parser.parse_args(argv)
    result = scan(args.workspace, args.file_list, args.literal_dynamic)
    text = json.dumps(result, ensure_ascii=False, indent=1 if args.pretty else None)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as handle:
            handle.write(text + '\n')
        stats = result.get('stats', {})
        print('files={} parsed={} failed={} skipped={} edges={} unresolved={} status={} reason={} seconds={}'.format(
            result['files'], result['parsed'], len(result['failed']), len(result['skipped']), len(result['edges']),
            len(result['unresolved']), result['edgesStatus'], result['reason'], stats.get('seconds')), file=sys.stderr)
    else:
        sys.stdout.write(text + '\n')


if __name__ == '__main__':
    main(sys.argv[1:])
