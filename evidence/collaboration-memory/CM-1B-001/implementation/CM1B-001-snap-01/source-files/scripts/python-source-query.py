"""Read-only Jedi analysis of an isolated, permission-filtered source snapshot."""
import ast
import json
from pathlib import Path
import sys
import tempfile
import hashlib
import io
import zipfile
import configparser
import tomllib


class UnsupportedConfiguration(ValueError):
    pass


def project_configuration(materials, query):
    """Interpret import roots only; never invoke packaging or environment code."""
    available = {file['path']: file for file in materials}
    sources = {name: file for name, file in available.items() if file['kind'] == 'source'}
    selected = query.get('configPath') or next((name for name in ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg'] if name in available), None)
    roots, used, limitations = [], [], []

    def add_root(value, config):
        if not isinstance(value, str) or not value or any(char in value for char in ['\\', ':', '\0', '$', '~', '*', '?']) or value.startswith('/'):
            raise ValueError('configuration import root outside readable workspace: ' + str(value))
        parts = value.split('/')
        if '..' in parts or '' in parts:
            raise ValueError('configuration import root outside readable workspace: ' + value)
        base = Path(config).parent if config else Path('.')
        relative = (base / value).as_posix().removeprefix('./')
        if relative == '.':
            relative = ''
        if any(part in ['.git', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime', '.venv', '__pycache__', 'node_modules'] for part in relative.split('/')):
            raise ValueError('configuration import root outside readable scope: ' + value)
        if not any(not relative or name.startswith(relative + '/') for name in sources):
            raise ValueError('configuration import root unavailable in readable snapshot: ' + value)
        if relative not in roots:
            roots.append(relative)

    def string_list(value, field):
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(field + ' must be a list of relative paths')
        return value

    def pyright(data, config):
        if not isinstance(data, dict):
            raise ValueError('Pyright configuration must be an object')
        for field in ['extends', 'executionEnvironments', 'venv', 'venvPath', 'typeshedPath', 'pythonVersion', 'pythonPlatform']:
            if field in data:
                raise UnsupportedConfiguration(field + ' is not supported by the isolated Jedi provider; select a configuration with workspace import roots')
        conventional_src = (Path(config).parent / 'src').as_posix() + '/'
        if data.get('autoSearchPaths', True) is not False and any(name.startswith(conventional_src) for name in sources):
            add_root('src', config)
        for value in string_list(data.get('extraPaths', []), 'extraPaths'):
            add_root(value, config)
        if 'stubPath' in data:
            add_root(data['stubPath'], config)
        for field in ['include', 'exclude', 'ignore']:
            if field in data:
                limitations.append(field + ' affects Pyright checking; query selection uses explicit path/prefix over the readable source inventory')

    def setuptools(data, config):
        if not isinstance(data, dict):
            raise ValueError('setuptools configuration must be an object')
        package_dir = data.get('package-dir', {})
        if not isinstance(package_dir, dict):
            raise ValueError('setuptools package-dir must be a mapping')
        for package, value in package_dir.items():
            if package:
                raise UnsupportedConfiguration('named setuptools package-dir remapping is unsupported; an empty package prefix is required')
            add_root(value, config)
        packages = data.get('packages', {})
        if isinstance(packages, dict) and isinstance(packages.get('find'), dict):
            for value in string_list(packages['find'].get('where', []), 'packages.find.where'):
                add_root(value, config)

    # The project directory remains a legitimate Python import root. Only
    # explicitly configured or conventional src roots supplement it.
    if sources:
        add_root('.', selected)
    if selected:
        if selected not in available:
            raise ValueError('configuration unavailable in readable snapshot')
        used.append({'path': selected, 'digest': available[selected]['digest']})
        content = available[selected]['content']
        if selected.endswith('pyrightconfig.json'):
            pyright(json.loads(content), selected)
        elif selected.endswith('pyproject.toml'):
            tools = tomllib.loads(content).get('tool', {})
            setuptools(tools.get('setuptools', {}), selected)
            pyright(tools.get('pyright', {}), selected)
        elif selected.endswith('setup.cfg'):
            data = configparser.ConfigParser(interpolation=None)
            data.read_string(content)
            mapping = data.get('options', 'package_dir', fallback='')
            for entry in mapping.splitlines():
                if entry.strip():
                    package, separator, value = entry.partition('=')
                    if not separator or package.strip():
                        raise UnsupportedConfiguration('named setuptools package_dir remapping is unsupported; an empty package prefix is required')
                    add_root(value.strip(), selected)
            where = data.get('options.packages.find', 'where', fallback='')
            for value in where.replace(',', '\n').splitlines():
                if value.strip():
                    add_root(value.strip(), selected)
    elif any(name.startswith('src/') for name in sources):
        add_root('src', None)
    return sources, roots, {'projectConfiguration': selected, 'configurationSources': used,
        'importRoots': [root or '.' for root in roots], 'configurationLimitations': limitations,
        'dependencyPolicy': 'only readable workspace .py/.pyi roots; no environment discovery, install, .pth execution or native extensions',
        'dependencyManifests': [{'path': file['path'], 'digest': file['digest']} for file in materials if file['kind'] == 'dependency_manifest']}

packages = Path(__file__).resolve().parent.parent / '.local' / 'source-analyzers' / 'packages'
# Read a single checked archive from the mounted project, then import from the
# private process scratch directory. This avoids hundreds of slow mounted-FS
# imports while preserving a new interpreter and source isolation per query.
archive_path = packages.parent / 'analyzers.zip'
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
    print(json.dumps({'status': 'unsupported', 'message': 'Python semantic provider missing; run scripts/setup-source-analyzers.py'}))
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
                  'diagnostics': diagnostics, 'coverage': {'semanticResolution': 'isolated readable Python project; inference can be incomplete',
                  **configuration_coverage, 'externalDependencies': False, 'workspaceDependencies': True, 'fullCallGraph': False,
                  'projectCodeExecuted': False, 'incremental': 'content-addressed query reuse; isolated analyzer rebuilt after snapshot changes'}}))
