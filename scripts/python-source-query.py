"""Read-only analysis of an isolated, permission-filtered source snapshot.

Two operations share this file, routed on argv before the old top-level body:
  * ``import_graph`` (argv[1]) is the light, standard-library-only scanner used by
    the observation. It reads an NDJSON header and files from stdin and writes one
    NDJSON line per protocol event; one unit is one Python file.
  * ``python_index`` (any other argv) is the heavy Jedi semantic provider; its
    only 8D-rework changes are argv[1] as the analyzers directory, ``-S`` and
    the missing-Jedi message.
"""
import ast
import configparser
import hashlib
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

CONFIG_NAMES = ('pyrightconfig.json', 'pyproject.toml', 'setup.cfg')
SKIP_DIRS = frozenset(['.git', 'node_modules', '.venv', 'venv', '__pycache__',
                       '.mypy_cache', '.pytest_cache', '.tox'])
PARSE_FAILURES = (SyntaxError, RecursionError, MemoryError, ValueError)
UNUSED_PYRIGHT_FIELDS = ('pythonVersion', 'pythonPlatform', 'venv', 'venvPath', 'typeshedPath',
                         'executionEnvironments', 'include', 'exclude', 'ignore')
ROOT_FORBIDDEN_CHARS = ('\\', ':', '$', '~', '*', '?', '\0')
R_NOT_PACKAGE = '{} 是模块，不是包'
R_STDLIB_SHADOW = '命名空间目录和标准库重名'
R_NAMESPACE = '命名空间包，没有文件'
R_BEYOND_TOP = '相对导入越过了顶层包'
R_STDLIB = '标准库'
R_EXTERNAL = '命名空间目录，可能是同名的外部包'

# Set after argv routing: import_graph checks the interpreter version first,
# python_index keeps its old behaviour (a 3.10 interpreter fails this run).
tomllib = None


class UnsupportedConfiguration(ValueError):
    pass


class ConfigError(Exception):
    """Carries one of the frozen §11.3 configuration failure literals."""


def first200(text):
    return text[:200]


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
    sys.stdout.flush()


# --------------------------------------------------------------------------------- configuration

def strip_jsonc(text):
    """Drop // and /* */ comments outside strings, then commas in front of } or ]."""
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == '"':
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
        elif text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            if j < 0:
                raise ValueError('unterminated block comment')
            out.append(' ')
            i = j + 2
        else:
            out.append(ch)
            i += 1
    s = ''.join(out)
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch == '"':
            j = i + 1
            while j < n:
                if s[j] == '\\':
                    j += 2
                    continue
                if s[j] == '"':
                    j += 1
                    break
                j += 1
            out.append(s[i:j])
            i = j
            continue
        if ch == ',':
            k = i + 1
            while k < n and s[k] in ' \t\r\n':
                k += 1
            if k < n and s[k] in '}]':
                i += 1
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


class ConfigurationReader:
    """The one Python configuration reader (§11.3).

    ``python_index`` and ``import_graph`` walk the same branches and add roots in
    the same order (pyrightconfig.json, pyproject.toml's package-dir and
    packages.find.where before tool.pyright, then setup.cfg). ``observation``
    changes only what §11.3 allows: JSONC for pyrightconfig.json, unused fields
    and unusable roots into notes, and the observation configuration-error
    literals. Strict mode keeps the python_index texts and statuses unchanged.
    """

    def __init__(self, selected, source_paths, contents, observation):
        self.selected = selected
        self.sources = set(source_paths)
        self.contents = contents
        self.observation = observation
        self.roots = []
        self.unused = set()
        self.unusable = []
        self.limitations = []

    def base(self, config):
        return Path(config).parent if config else Path('.')

    def has_python_under(self, relative):
        if relative == '':
            return bool(self.sources)
        return any(path.startswith(relative + '/') for path in self.sources)

    def add_root(self, value, config):
        if self.observation:
            if not isinstance(value, str):
                self.unusable.append(json.dumps(value, ensure_ascii=False))
                return
            written = value
            # Frozen §11.3: first drop every trailing '/' ('src/' and 'src//' are 'src').
            value = value.rstrip('/')
            reason = None
            if value.startswith('/') or any(ch in value for ch in ROOT_FORBIDDEN_CHARS):
                reason = 'syntax'
            parts = value.split('/')
            if reason is None and ('..' in parts or '' in parts):
                reason = 'syntax'
            rel = None
            if reason is None:
                rel = '/'.join(part for part in parts if part != '.')
                if any(part in SKIP_DIRS for part in rel.split('/') if part):
                    reason = 'skipped-dir'
                elif not self.has_python_under(rel):
                    reason = 'no-python'
            if reason is not None:
                self.unusable.append(written)  # 11.5: the root as written in the configuration
                return
            if rel not in self.roots:
                self.roots.append(rel)
            return
        # python_index: the original strict validation, text for text.
        if not isinstance(value, str) or not value or any(char in value for char in ['\\', ':', '\0', '$', '~', '*', '?']) or value.startswith('/'):
            raise ValueError('configuration import root outside readable workspace: ' + str(value))
        parts = value.split('/')
        if '..' in parts or '' in parts:
            raise ValueError('configuration import root outside readable workspace: ' + value)
        relative = (self.base(config) / value).as_posix().removeprefix('./')
        if relative == '.':
            relative = ''
        if any(part in ['.git', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime', '.venv', '__pycache__', 'node_modules'] for part in relative.split('/')):
            raise ValueError('configuration import root outside readable scope: ' + value)
        if not any(not relative or name.startswith(relative + '/') for name in self.sources):
            raise ValueError('configuration import root unavailable in readable snapshot: ' + value)
        if relative not in self.roots:
            self.roots.append(relative)

    def pyright(self, data, config, filename, not_object):
        if not isinstance(data, dict):
            if self.observation:
                raise ConfigError(not_object)
            raise ValueError('Pyright configuration must be an object')
        if self.observation:
            if 'extends' in data:
                raise ConfigError('配置错误：{} 的 extends 观测还不跟进'.format(filename))
            for field in UNUSED_PYRIGHT_FIELDS:
                if field in data:
                    self.unused.add(field)
        else:
            for field in ['extends', 'executionEnvironments', 'venv', 'venvPath', 'typeshedPath', 'pythonVersion', 'pythonPlatform']:
                if field in data:
                    raise UnsupportedConfiguration(field + ' is not supported by the isolated Jedi provider; select a configuration with workspace import roots')
        conventional_src = (self.base(config) / 'src').as_posix() + '/'
        if data.get('autoSearchPaths', True) is not False and any(name.startswith(conventional_src) for name in self.sources):
            self.add_root('src', config)
        extra = data.get('extraPaths', [])
        if not isinstance(extra, list) or not all(isinstance(item, str) for item in extra):
            if self.observation:
                raise ConfigError('配置错误：{} 的 extraPaths 不是字符串列表'.format(filename))
            raise ValueError('extraPaths must be a list of relative paths')
        for value in extra:
            self.add_root(value, config)
        if 'stubPath' in data:
            stub = data['stubPath']
            if self.observation and (not isinstance(stub, str) or not stub):
                raise ConfigError('配置错误：{} 的 stubPath 不是非空字符串'.format(filename))
            self.add_root(stub, config)
        if not self.observation:
            for field in ['include', 'exclude', 'ignore']:
                if field in data:
                    self.limitations.append(field + ' affects Pyright checking; query selection uses explicit path/prefix over the readable source inventory')

    def setuptools(self, data, config):
        if not isinstance(data, dict):
            if self.observation:
                raise ConfigError('配置错误：pyproject.toml 的 tool.setuptools 不是表')
            raise ValueError('setuptools configuration must be an object')
        package_dir = data.get('package-dir', {})
        if not isinstance(package_dir, dict):
            if self.observation:
                raise ConfigError('配置错误：pyproject.toml 的 tool.setuptools.package-dir 不是表')
            raise ValueError('setuptools package-dir must be a mapping')
        for package, value in package_dir.items():
            if package:
                if self.observation:
                    self.unused.add('package-dir')
                else:
                    raise UnsupportedConfiguration('named setuptools package-dir remapping is unsupported; an empty package prefix is required')
            else:
                if self.observation and not isinstance(value, str):
                    raise ConfigError('配置错误：pyproject.toml 的 package-dir 的空包名不是字符串')
                self.add_root(value, config)
        packages = data.get('packages', {})
        if isinstance(packages, dict) and isinstance(packages.get('find'), dict):
            where = packages['find'].get('where', [])
            if not isinstance(where, list) or not all(isinstance(item, str) for item in where):
                if self.observation:
                    raise ConfigError('配置错误：pyproject.toml 的 packages.find.where 不是字符串列表')
                raise ValueError('packages.find.where must be a list of relative paths')
            for value in where:
                self.add_root(value, config)

    def setup_cfg(self, content):
        parser = configparser.ConfigParser(interpolation=None)
        try:
            parser.read_string(content)
            mapping = parser.get('options', 'package_dir', fallback='')
            where = parser.get('options.packages.find', 'where', fallback='')
        except configparser.Error:
            if self.observation:
                raise ConfigError('配置错误：setup.cfg 解析不了')
            raise
        for entry in mapping.splitlines():
            if entry.strip():
                package, separator, value = entry.partition('=')
                if not separator or package.strip():
                    if self.observation:
                        self.unused.add('package_dir')
                    else:
                        raise UnsupportedConfiguration('named setuptools package_dir remapping is unsupported; an empty package prefix is required')
                else:
                    self.add_root(value.strip(), self.selected)
        for value in where.replace(',', '\n').splitlines():
            if value.strip():
                self.add_root(value.strip(), self.selected)

    def read(self):
        # The project directory remains a legitimate Python import root. Only
        # explicitly configured or conventional src roots supplement it.
        if self.sources:
            self.add_root('.', self.selected)
        if self.selected:
            if self.selected not in self.contents:
                if self.observation:
                    raise ConfigError('配置错误：{} 解析不了'.format(self.selected))
                raise ValueError('configuration unavailable in readable snapshot')
            content = self.contents[self.selected]
            if self.selected.endswith('pyrightconfig.json'):
                if self.observation:
                    try:
                        data = json.loads(strip_jsonc(content))
                    except ValueError:
                        raise ConfigError('配置错误：pyrightconfig.json 解析不了')
                else:
                    data = json.loads(content)
                self.pyright(data, self.selected, 'pyrightconfig.json', '配置错误：pyrightconfig.json 不是对象')
            elif self.selected.endswith('pyproject.toml'):
                if self.observation:
                    try:
                        data = tomllib.loads(content)
                    except tomllib.TOMLDecodeError:
                        raise ConfigError('配置错误：pyproject.toml 解析不了')
                else:
                    data = tomllib.loads(content)
                tool = data.get('tool', {})
                if self.observation and not isinstance(tool, dict):
                    raise ConfigError('配置错误：pyproject.toml 的 tool 不是表')
                self.setuptools(tool.get('setuptools', {}), self.selected)
                self.pyright(tool.get('pyright', {}), self.selected, 'pyproject.toml', '配置错误：pyproject.toml 的 tool.pyright 不是对象')
            elif self.selected.endswith('setup.cfg'):
                self.setup_cfg(content)
        elif self.has_python_under('src'):
            self.add_root('src', None)
        return self.roots, self.unused, self.unusable, self.limitations


def project_configuration(materials, query):
    """Interpret import roots only; never invoke packaging or environment code."""
    available = {file['path']: file for file in materials}
    sources = {name: file for name, file in available.items() if file['kind'] == 'source'}
    selected = query.get('configPath') or next((name for name in CONFIG_NAMES if name in available), None)
    reader = ConfigurationReader(selected, sources, {name: file['content'] for name, file in available.items()}, observation=False)
    roots, _, _, limitations = reader.read()
    used = []
    if selected:
        used.append({'path': selected, 'digest': available[selected]['digest']})
    return sources, roots, {'projectConfiguration': selected, 'configurationSources': used,
        'importRoots': [root or '.' for root in roots], 'configurationLimitations': limitations,
        'dependencyPolicy': 'only readable workspace .py/.pyi roots; no environment discovery, install, .pth execution or native extensions',
        'dependencyManifests': [{'path': file['path'], 'digest': file['digest']} for file in materials if file['kind'] == 'dependency_manifest']}


def plan_roots(selected, content, claimed_paths):
    """Observation adapter over the one ConfigurationReader (mode flag only)."""
    reader = ConfigurationReader(selected, claimed_paths,
                                 {} if selected is None else {selected: content}, observation=True)
    roots, unused, unusable, _ = reader.read()
    notes = []
    if selected is not None and unused:
        notes.append(first200('{} 里观测不用的字段：{}'.format(selected, '、'.join(sorted(unused)))))
    if unusable:
        notes.append(first200('{} 里用不了的查找根：{}'.format(selected or '(没有配置)', '、'.join(sorted(set(unusable))))))
    return roots, notes


# --------------------------------------------------------------------------------- resolution

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
        """('ok', Found) or ('unresolved', reason); shown_prefix carries the leading dots."""
        dirs, found = first_dirs, None
        for i, segment in enumerate(segments):
            found = self.find(dirs, segment)
            if i == 0 and absolute and found is not None and found.kind == 'namespace' and segment in self.stdlib:
                return 'unresolved', R_STDLIB_SHADOW
            if found is None:
                if i == 0 and absolute and segment in self.stdlib:
                    return 'unresolved', R_STDLIB
                return 'unresolved', None
            if found.kind == 'module' and i < len(segments) - 1:
                return 'unresolved', R_NOT_PACKAGE.format(shown_prefix + '.'.join(segments[:i + 1]))
            dirs = found.dirs
        return 'ok', found

    def first_only_namespace(self, dotted):
        first = dotted.split('.')[0]
        found = self.find(self.roots, first)
        return found is not None and found.kind == 'namespace' and first not in self.stdlib

    @staticmethod
    def external(results):
        return [(kind, R_EXTERNAL if kind == 'unresolved' else value, spec) for kind, value, spec in results]

    def module_identity(self, path):
        """(module segments, package segments) from the longest import root containing the file."""
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

    # One statement -> list of (kind, target_or_reason, specifier).
    def resolve_import(self, dotted):
        out = self._resolve_import(dotted)
        return self.external(out) if self.first_only_namespace(dotted) else out

    def _resolve_import(self, dotted):
        status, value = self.walk(dotted.split('.'), self.roots, True)
        if status == 'unresolved':
            return [('unresolved', value, dotted)]
        if value.kind == 'namespace':
            return [('unresolved', R_NAMESPACE, dotted)]
        return [('edge', value.file, dotted)]

    def resolve_from(self, path, level, module, names):
        out = self._resolve_from(path, level, module, names)
        if level == 0 and self.first_only_namespace(module):
            return self.external(out)
        return out

    def _resolve_from(self, path, level, module, names):
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


# --------------------------------------------------------------------------------- import_graph

def run_import_graph():
    line = sys.stdin.readline()
    if not line:
        return
    header = json.loads(line)
    paths = [str(path) for path in header.get('paths') or []]
    resume = header.get('resumeFrom') or 0
    if not paths:
        emit({'t': 'ready', 'engine': 'python-ast', 'engineVersion': '1', 'units': [], 'notes': []})
        emit({'t': 'end'})
        return
    config = header.get('config') or {}
    selected = config.get('path')
    content = config.get('content') or ''
    try:
        roots, notes = plan_roots(selected, content, paths)
    except ConfigError as error:
        emit({'t': 'failed', 'reason': str(error)})
        return

    emit({'t': 'ready', 'engine': 'python-ast', 'engineVersion': '1', 'units': paths, 'notes': notes})
    material = {}
    for raw in sys.stdin:
        if not raw.strip():
            continue
        message = json.loads(raw)
        if message.get('t') == 'file':
            material[message['path']] = message.get('content') or ''
    resolver = Resolver(paths, roots)
    sent_edges, sent_unresolved = set(), set()
    for index in range(max(0, resume), len(paths)):
        path = paths[index]
        emit({'t': 'start', 'i': index, 'path': path})
        try:
            tree = ast.parse(material.get(path, ''), filename=path)
        except PARSE_FAILURES as error:
            message = error.msg if isinstance(error, SyntaxError) else str(error)
            emit({'t': 'done', 'i': index, 'files': [{'path': path, 'status': 'failed',
                  'reason': first200('{}: {}'.format(type(error).__name__, message))}],
                  'edges': [], 'unresolved': []})
            continue
        nodes = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
        nodes.sort(key=lambda node: (node.lineno, node.col_offset))
        unit_edges, unit_unresolved = {}, {}
        for node in nodes:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    for kind, value, specifier in resolver.resolve_import(alias.name):
                        if kind == 'edge':
                            if value != path:
                                unit_edges[(path, value, specifier)] = None
                        else:
                            unit_unresolved.setdefault((path, specifier), []).append(value)
            else:
                names = [alias.name for alias in node.names]
                for kind, value, specifier in resolver.resolve_from(path, node.level or 0, node.module, names):
                    if kind == 'edge':
                        if value != path:
                            unit_edges[(path, value, specifier)] = None
                    else:
                        unit_unresolved.setdefault((path, specifier), []).append(value)
        edges = [list(key) for key in sorted(unit_edges) if key not in sent_edges]
        sent_edges.update(unit_edges)
        unresolved = []
        for (source, specifier) in sorted(unit_unresolved):
            reasons = sorted(reason for reason in unit_unresolved[(source, specifier)] if reason is not None)
            reason = reasons[0] if reasons else None
            if (source, specifier, reason) not in sent_unresolved:
                sent_unresolved.add((source, specifier, reason))
                unresolved.append({'from': source, 'specifier': specifier, 'reason': reason})
        emit({'t': 'done', 'i': index, 'files': [{'path': path, 'status': 'parsed'}],
              'edges': edges, 'unresolved': unresolved})
    emit({'t': 'end'})


# --------------------------------------------------------------------------------- routing

# §11.3/§11.5: route on argv before the python_index body. import_graph uses only
# the standard library and checks the interpreter version first.
if sys.argv[1:2] == ['import_graph']:
    if sys.version_info < (3, 11):
        emit({'t': 'unavailable', 'message': 'Python 3.11 or newer is required for import_graph'})
        sys.exit(0)
    import tomllib as tomllib_module
    tomllib = tomllib_module
    # §11.3: any other ordinary exception in the language entry is a failed line,
    # never a traceback/process exit. ConfigError keeps its frozen literals.
    try:
        run_import_graph()
    except ConfigError as error:
        emit({'t': 'failed', 'reason': str(error)})
    except Exception as error:
        emit({'t': 'failed', 'reason': '{}: {}'.format(type(error).__name__, first200(str(error)))})
    sys.exit(0)

# --------------------------------------------------------------------------------- python_index

# The old top-level body: argv[1] is the analyzers directory (the caller passes
# -S). tomllib is imported here, so a 3.10 interpreter still fails this analyzer
# run as before.
import tomllib as tomllib_module
tomllib = tomllib_module
analyzers_directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / '.local' / 'source-analyzers'
packages = analyzers_directory / 'packages'
# Read a single checked archive from the mounted project, then import from the
# private process scratch directory. This avoids hundreds of slow mounted-FS
# imports while preserving a new interpreter and source isolation per query.
archive_path = analyzers_directory / 'analyzers.zip'
dependency_scratch = None
if archive_path.exists():
    archive_bytes = archive_path.read_bytes()
    if hashlib.sha256(archive_bytes).hexdigest() != archive_path.with_suffix('.sha256').read_text().strip():
        raise ValueError('analyzer dependency archive integrity mismatch')
    dependency_scratch = tempfile.TemporaryDirectory(prefix='platform-analyzer-dependencies-')
    packages = Path(dependency_scratch.name)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for info in archive.infolist():
            if not (packages / info.filename).resolve().is_relative_to(packages.resolve()) or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('unsafe analyzer dependency path')
        archive.extractall(packages)
sys.path.insert(0, str(packages))
try:
    import jedi
except ImportError:
    print(json.dumps({'status': 'unsupported', 'message': f'Python semantic provider missing: jedi is not in {archive_path}'}))
    sys.exit(0)

jedi.settings.use_filesystem_cache = False
# Each query has its own process; Jedi's in-process parser cache cannot race
# another query or retain a previous workspace. No persistent cache is written.
jedi.settings.fast_parser = True
request = json.load(sys.stdin)
query = request['query']
try:
    files, import_roots, configuration_coverage = project_configuration(request['files'], query)
except UnsupportedConfiguration as error:
    print(json.dumps({'status': 'unsupported', 'message': str(error)}))
    sys.exit(0)
except (ValueError, TypeError, configparser.Error) as error:
    print(json.dumps({'status': 'rejected', 'message': 'Python configuration: ' + str(error)}))
    sys.exit(0)
results, diagnostics = [], []
with tempfile.TemporaryDirectory(prefix='platform-python-source-') as directory:
    root = Path(directory).resolve()
    for name, file in files.items():
        target = (root / name).resolve()
        if not target.is_relative_to(root):
            raise ValueError('path outside snapshot')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(file['content'], encoding='utf-8')
    project = jedi.Project(root, sys_path=[str(root / name) for name in import_roots], smart_sys_path=False, load_unsafe_extensions=False)

    def codepoint_column(path, line, byte_column):
        """Python AST offsets are UTF-8 bytes, independent of editor columns."""
        text = files[path]['content'].splitlines()[line - 1]
        return len(text.encode('utf-8')[:byte_column].decode('utf-8'))

    def editor_column(path, line, byte_column):
        text = files[path]['content'].splitlines()[line - 1]
        return len(text[:codepoint_column(path, line, byte_column)].encode('utf-16-le')) // 2 + 1

    def location(name):
        if name.module_path is None or name.line is None:
            return None
        path = Path(name.module_path).resolve()
        if not path.is_relative_to(root):
            return None
        relative = path.relative_to(root).as_posix()
        if relative not in files:
            return None
        if name.type == 'module':
            # Jedi anchors a module at (1, 0), even for an empty __init__.py.
            # This is a file reference, not an identifier span in its body.
            return {'path': relative, 'digest': files[relative]['digest'], 'line': 1, 'column': 1,
                    'endLine': 1, 'endColumn': 1, 'name': name.name, 'kind': 'module', 'locationKind': 'module_file'}
        lines = files[relative]['content'].splitlines()
        if not 1 <= name.line <= len(lines):
            return None
        line = lines[name.line - 1]
        column = len(line[:name.column].encode('utf-16-le')) // 2 + 1
        return {'path': relative, 'digest': files[relative]['digest'], 'line': name.line, 'column': column,
                'endLine': name.line, 'endColumn': column + len(name.name.encode('utf-16-le')) // 2,
                'name': name.name, 'kind': name.type}

    def symbol_identity(loc):
        # A module file anchor may coincide with a declaration at (1, 1).
        # Matching positions alone would incorrectly merge those symbols.
        return tuple(loc.get(key) for key in ['path', 'line', 'column', 'kind', 'name', 'locationKind'])

    selected = [query['path']] if query.get('path') else sorted(files)
    if query.get('prefix'):
        selected = [name for name in selected if name.startswith(query['prefix'] + '/') or name == query['prefix']]
    for path in selected:
        if path not in files:
            raise ValueError('path outside indexed files')
        file = files[path]
        script = jedi.Script(code=file['content'], path=root / path, project=project)
        operation = query['operation']
        if operation in ['definitions', 'references']:
            line = query['line']
            text = file['content'].splitlines()[line - 1]
            column = len(text.encode('utf-16-le')[:(query['column'] - 1) * 2].decode('utf-16-le'))
            names = script.goto(line, column, follow_imports=True) if operation == 'definitions' else script.get_references(line, column, include_builtins=False, scope='project')
            results.extend(loc for name in names if (loc := location(name)) is not None)
            if operation == 'references':
                # Jedi's project reference search can stop at an import alias.
                # Resolve candidate names semantically to the same definition;
                # matching identifier text alone must never create a reference.
                targets = {symbol_identity(loc) for name in script.goto(line, column, follow_imports=True) if (loc := location(name)) is not None}
                for candidate_path, candidate_file in files.items():
                    candidate_script = jedi.Script(code=candidate_file['content'], path=root / candidate_path, project=project)
                    for candidate in candidate_script.get_names(all_scopes=True, definitions=True, references=True):
                        resolved = candidate_script.goto(candidate.line, candidate.column, follow_imports=True)
                        if any(symbol_identity(loc) in targets for name in resolved if (loc := location(name)) is not None):
                            loc = location(candidate)
                            if loc is not None:
                                results.append(loc)
        elif operation == 'symbols':
            results.extend(loc for name in script.get_names(all_scopes=True, definitions=True, references=False) if (loc := location(name)) is not None)
        else:
            try:
                tree = ast.parse(file['content'])
            except SyntaxError as error:
                diagnostics.append({'path': path, 'line': error.lineno, 'message': error.msg})
                continue
            for node in ast.walk(tree):
                if operation == 'imports' and isinstance(node, (ast.Import, ast.ImportFrom)):
                    for alias in node.names:
                        names = script.goto(alias.lineno, codepoint_column(path, alias.lineno, alias.col_offset), follow_imports=True)
                        targets = [loc for name in names if (loc := location(name)) is not None]
                        results.append({'path': path, 'digest': file['digest'], 'line': node.lineno, 'column': editor_column(path, node.lineno, node.col_offset),
                                        'module': ('.' * node.level + (node.module or '') + '.' + alias.name) if isinstance(node, ast.ImportFrom) else alias.name,
                                        'resolution': 'resolved' if targets else 'unknown', 'targets': targets})
                if operation == 'calls' and isinstance(node, ast.Call):
                    expression = node.func
                    # AST columns are UTF-8 bytes; Jedi columns are Unicode code points.
                    end = codepoint_column(path, expression.end_lineno, expression.end_col_offset)
                    names = script.goto(expression.end_lineno, max(0, end - 1), follow_imports=True)
                    targets = [loc for name in names if (loc := location(name)) is not None]
                    results.append({'path': path, 'digest': file['digest'], 'line': node.lineno, 'column': editor_column(path, node.lineno, node.col_offset),
                                    'expression': ast.unparse(expression)[:200], 'resolution': 'static_candidate' if targets else 'unknown',
                                    'targets': targets, 'uncertainty': 'Dynamic Python dispatch is not a proven runtime call edge.'})
        diagnostics.extend({'path': path, 'line': error.line, 'message': error.get_message()} for error in script.get_syntax_errors())
unique = {json.dumps(result, sort_keys=True): result for result in results}
print(json.dumps({'status': 'sourced', 'engine': 'jedi', 'engineVersion': jedi.__version__, 'results': list(unique.values()),
                  'diagnostics': diagnostics,
                  'coverage': {'semanticResolution': 'isolated readable Python project; inference can be incomplete',
                  **configuration_coverage, 'externalDependencies': False, 'workspaceDependencies': True, 'fullCallGraph': False,
                  'projectCodeExecuted': False, 'incremental': 'content-addressed query reuse; isolated analyzer rebuilt after snapshot changes'}}))
