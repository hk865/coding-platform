"""Fixed libclang C API reader. Project commands, plugins and code never execute.

API: clang.llvm.org/doxygen/group__CINDEX.html; LLVM 18 redirect-only VFS:
github.com/llvm/llvm-project/blob/llvmorg-18.1.3/llvm/include/llvm/Support/VirtualFileSystem.h
"""
import ctypes as C
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shlex
import sys
import tempfile


class Unsupported(Exception):
    pass


class CXString(C.Structure):
    _fields_ = [('data', C.c_void_p), ('private_flags', C.c_uint)]


class Cursor(C.Structure):
    _fields_ = [('kind', C.c_uint), ('xdata', C.c_int), ('data', C.c_void_p * 3)]


class Location(C.Structure):
    _fields_ = [('ptr_data', C.c_void_p * 2), ('int_data', C.c_uint)]


class Range(C.Structure):
    _fields_ = [('ptr_data', C.c_void_p * 2), ('begin_int_data', C.c_uint), ('end_int_data', C.c_uint)]


def main(request):
    files = {f['path']: f for f in request['files']}
    query = request['query']
    lib_path = Path(request['libraryPath'])
    if not lib_path.is_absolute() or not lib_path.is_file():
        raise Unsupported('libclang analyzer unavailable; configure a trusted installed libclang 18 library')
    lib = C.CDLL(str(lib_path))

    def bind(name, result, *args):
        function = getattr(lib, name)
        function.restype, function.argtypes = result, list(args)
        return function

    pointer, uint, char = C.c_void_p, C.c_uint, C.c_char_p
    get_string = bind('clang_getCString', char, CXString)
    dispose_string = bind('clang_disposeString', None, CXString)

    def string(value):
        try:
            return (get_string(value) or b'').decode('utf-8', errors='replace')
        finally:
            dispose_string(value)

    version = string(bind('clang_getClangVersion', CXString)())
    if not re.search(r'clang version 18\.', version):
        raise Unsupported('Unsupported libclang ABI/version: ' + version + '; this adapter is verified with libclang 18')
    create_index = bind('clang_createIndex', pointer, C.c_int, C.c_int)
    parse = bind('clang_parseTranslationUnit2', C.c_int, pointer, char, C.POINTER(char), C.c_int, pointer, uint, uint, C.POINTER(pointer))
    tu_cursor = bind('clang_getTranslationUnitCursor', Cursor, pointer)
    Visitor = C.CFUNCTYPE(uint, Cursor, Cursor, pointer)
    visit_children = bind('clang_visitChildren', uint, Cursor, Visitor, pointer)
    spelling = bind('clang_getCursorSpelling', CXString, Cursor)
    display = bind('clang_getCursorDisplayName', CXString, Cursor)
    kind_name = bind('clang_getCursorKindSpelling', CXString, uint)
    usr = bind('clang_getCursorUSR', CXString, Cursor)
    referenced = bind('clang_getCursorReferenced', Cursor, Cursor)
    is_definition = bind('clang_isCursorDefinition', uint, Cursor)
    is_declaration = bind('clang_isDeclaration', uint, uint)
    cursor_location = bind('clang_getCursorLocation', Location, Cursor)
    cursor_extent = bind('clang_getCursorExtent', Range, Cursor)
    range_end = bind('clang_getRangeEnd', Location, Range)
    spelling_location = bind('clang_getSpellingLocation', None, Location, C.POINTER(pointer), C.POINTER(uint), C.POINTER(uint), C.POINTER(uint))
    file_name = bind('clang_getFileName', CXString, pointer)
    included_file = bind('clang_getIncludedFile', pointer, Cursor)
    get_file = bind('clang_getFile', pointer, pointer, char)
    get_location = bind('clang_getLocation', Location, pointer, pointer, uint, uint)
    get_cursor = bind('clang_getCursor', Cursor, pointer, Location)
    diagnostic_count = bind('clang_getNumDiagnostics', uint, pointer)
    get_diagnostic = bind('clang_getDiagnostic', pointer, pointer, uint)
    diagnostic_severity = bind('clang_getDiagnosticSeverity', uint, pointer)
    diagnostic_text = bind('clang_getDiagnosticSpelling', CXString, pointer)
    diagnostic_location = bind('clang_getDiagnosticLocation', Location, pointer)
    dispose_diagnostic = bind('clang_disposeDiagnostic', None, pointer)
    dispose_tu = bind('clang_disposeTranslationUnit', None, pointer)
    dispose_index = bind('clang_disposeIndex', None, pointer)

    def local_path(value):
        value = posixpath.normpath(value)
        return value[11:] if value.startswith('/workspace/') and value[11:] in files else None

    def location(value):
        file_ptr, line, column, offset = pointer(), uint(), uint(), uint()
        spelling_location(value, C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
        path = local_path(string(file_name(file_ptr))) if file_ptr else None
        if path is None:
            return None
        lines = files[path]['content'].split('\n')
        text = lines[line.value - 1] if 0 < line.value <= len(lines) else ''
        prefix = text.encode('utf-8')[:max(0, column.value - 1)].decode('utf-8', errors='replace')
        return {'path': path, 'digest': files[path]['digest'], 'line': line.value, 'column': len(prefix.encode('utf-16-le')) // 2 + 1}

    def loc_cursor(cursor):
        loc = location(cursor_location(cursor))
        if loc is None:
            return None
        end = location(range_end(cursor_extent(cursor)))
        return {**loc, 'endLine': end['line'] if end else loc['line'], 'endColumn': end['column'] if end else loc['column'],
                'name': string(spelling(cursor)), 'kind': string(kind_name(cursor.kind)), 'symbolId': string(usr(cursor))}

    configs = json.loads(files[query['configPath']]['content'])
    if not isinstance(configs, list) or not configs:
        raise Unsupported('Compilation database must contain translation units')
    if len(configs) > 512:
        raise Unsupported('Compilation database exceeds 512 translation units; select a narrower database')
    source_paths = [p for p in files if re.search(r'\.(c|cc|cpp|cxx|C)$', p)]

    def compile_unit(entry):
        if not isinstance(entry, dict) or not isinstance(entry.get('directory'), str) or not isinstance(entry.get('file'), str):
            raise Unsupported('Invalid compilation database entry')
        directory = entry['directory'].replace('\\', '/')
        file = entry['file'].replace('\\', '/')
        # Absolute build paths are aliases only. They are matched to a unique
        # readable source suffix; they never authorize access to that host path.
        physical = posixpath.normpath(posixpath.join(directory, file))
        absolute = physical.startswith('/') or re.match(r'^[A-Za-z]:/', physical)
        if absolute:
            matches = [p for p in source_paths if physical.endswith('/' + p)]
            if len(matches) != 1:
                raise Unsupported('Absolute compilation source cannot map uniquely to readable snapshot: ' + file)
            path = matches[0]
            base = physical[:-len(path)].rstrip('/')
            directory = posixpath.normpath(directory)
            if directory != base and not directory.startswith(base + '/'):
                raise Unsupported('Compilation directory is outside mapped workspace')
            working = directory[len(base):].strip('/')
        else:
            base, working, path = None, posixpath.normpath(directory), physical
            if path not in source_paths or working == '..' or working.startswith('../'):
                raise Unsupported('Compilation source is outside readable snapshot: ' + file)

        def mapped(value, require_file=False):
            value = value.replace('\\', '/')
            if value.startswith('/') or re.match(r'^[A-Za-z]:/', value):
                if base is None or (value != base and not value.startswith(base + '/')):
                    raise Unsupported('External compilation paths require an explicitly readable in-workspace dependency: ' + value)
                relative = posixpath.normpath(value[len(base):].strip('/') or '.')
            else:
                relative = posixpath.normpath(posixpath.join(working, value))
            if relative == '..' or relative.startswith('../') or relative.startswith('/'):
                raise Unsupported('Compilation path escapes workspace: ' + value)
            if require_file and relative not in files:
                raise Unsupported('Forced include is unavailable in snapshot: ' + value)
            return '/workspace' + (('/' + relative) if relative != '.' else '')

        raw = entry.get('arguments')
        if raw is None and isinstance(entry.get('command'), str):
            raw = shlex.split(entry['command'], posix=True)
        if not isinstance(raw, list) or not raw or len(raw) > 512 or not all(isinstance(v, str) and '\0' not in v for v in raw):
            raise Unsupported('Invalid compiler argument array')
        compiler = PurePosixPath(raw[0].replace('\\', '/')).name
        if not re.fullmatch(r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?', compiler):
            raise Unsupported('Compiler wrappers/shells are not executed or inferred: ' + compiler)
        args, ignored_args = [], []
        i = 1
        while i < len(raw):
            arg = raw[i]
            if any(token in arg for token in ['\n', '\r', '`', '$(', ';', '&&', '||']) or arg.startswith('@'):
                raise Unsupported('Shell syntax/response files are not supported compiler arguments')
            if arg in ['-o', '-MF', '-MT', '-MQ']:
                if i + 1 >= len(raw):
                    raise Unsupported('Missing compiler argument: ' + arg)
                ignored_args.extend(raw[i:i + 2]); i += 2; continue
            if arg in ['-c', '-MMD', '-MD', '-MP', '-pipe']:
                ignored_args.append(arg); i += 1; continue
            option = next((flag for flag in ['-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U'] if arg == flag or (flag in ['-I', '-D', '-U'] and arg.startswith(flag))), None)
            if option:
                if arg == option:
                    i += 1
                    if i >= len(raw):
                        raise Unsupported('Missing compiler argument: ' + option)
                    value = raw[i]
                else:
                    value = arg[len(option):]
                args.extend([option, value if option in ['-D', '-U'] else mapped(value, option in ['-include', '-imacros'])])
            elif arg in ['-x', '-target', '--target']:
                i += 1
                if i >= len(raw) or not re.fullmatch(r'[A-Za-z0-9_+.-]+', raw[i]) or (arg == '-x' and raw[i] not in ['c', 'c++']):
                    raise Unsupported('Invalid language/target option')
                args.extend([arg, raw[i]])
            elif re.fullmatch(r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', arg) or re.fullmatch(r'--target=[A-Za-z0-9_+.-]+', arg) or re.fullmatch(r'-O[0-3szg]', arg) or re.fullmatch(r'-g(?:[0-3]|dwarf-[2-5])?', arg) or re.fullmatch(r'-W(?:no-)?[A-Za-z0-9=-]+', arg):
                args.append(arg)
            elif arg in ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti', '-fms-extensions', '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin', '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']:
                args.append(arg)
            elif not arg.startswith('-') and mapped(arg) == '/workspace/' + path:
                pass
            else:
                raise Unsupported('Unsupported compiler option; configuration was not silently discarded: ' + arg)
            i += 1
        return {'path': path, 'args': args, 'working': mapped('.'), 'ignoredArguments': ignored_args}

    units = [compile_unit(entry) for entry in configs]
    variants = {}
    for unit in units:
        identity = json.dumps(unit['args'])
        if unit['path'] in variants and variants[unit['path']] != identity:
            raise Unsupported('Multiple compilation variants for one source; select a database with one explicit configuration per translation unit: ' + unit['path'])
        variants[unit['path']] = identity
    units = list({unit['path']: unit for unit in units}.values())
    diagnostics, declarations, references, calls, imports = [], [], [], [], []
    targets = set()
    with tempfile.TemporaryDirectory(prefix='platform-cpp-source-') as scratch:
        root = Path(scratch)
        # No directory remaps: only files already read through the sandbox exist
        # in the VFS. fallthrough=false also blocks literal absolute #includes.
        tree = {'type': 'directory', 'name': '/workspace', 'contents': []}
        directories = {'': tree}
        for number, (name, file) in enumerate(sorted(files.items())):
            if name.startswith('/') or any(p in ['', '.', '..'] for p in name.split('/')):
                raise ValueError('Unsafe source snapshot path')
            content_path = root / str(number)
            content_path.write_text(file['content'], encoding='utf-8')
            parent = ''
            for segment in name.split('/')[:-1]:
                child = parent + '/' + segment if parent else segment
                if child not in directories:
                    directories[child] = {'type': 'directory', 'name': segment, 'contents': []}
                    directories[parent]['contents'].append(directories[child])
                parent = child
            directories[parent]['contents'].append({'type': 'file', 'name': name.split('/')[-1], 'external-contents': str(content_path)})
        overlay = root / 'vfs.json'
        overlay.write_text(json.dumps({'version': 0, 'case-sensitive': True, 'use-external-names': False, 'fallthrough': False, 'roots': [tree]}))
        index = create_index(0, 0)
        try:
            for unit in units:
                tu = pointer()
                # All source and include arguments have already been rebased to
                # absolute VFS paths. Do not ask Clang's driver to chdir into a
                # virtual directory before its overlay has been installed.
                args = unit['args'] + ['-ivfsoverlay', str(overlay), '-nostdinc', '-nostdinc++', '-fno-modules', '-fno-implicit-modules', '-fsyntax-only', '-ferror-limit=30']
                encoded = [arg.encode() for arg in args]
                argv = (char * len(encoded))(*encoded)
                code = parse(index, ('/workspace/' + unit['path']).encode(), argv, len(argv), None, 0, 1, C.byref(tu))
                if code != 0 or not tu:
                    raise Unsupported('libclang could not parse configured translation unit: ' + unit['path'] + ' (code ' + str(code) + ')')
                try:
                    for diagnostic_index in range(diagnostic_count(tu)):
                        diagnostic = get_diagnostic(tu, diagnostic_index)
                        try:
                            loc = location(diagnostic_location(diagnostic))
                            diagnostics.append({**(loc or {'path': unit['path']}), 'severity': diagnostic_severity(diagnostic), 'message': string(diagnostic_text(diagnostic))[:1000], 'translationUnit': unit['path']})
                        finally:
                            dispose_diagnostic(diagnostic)
                    if query['operation'] in ['definitions', 'references']:
                        file_ptr = get_file(tu, ('/workspace/' + query['path']).encode())
                        if file_ptr:
                            line = files[query['path']]['content'].split('\n')[query['line'] - 1]
                            try:
                                prefix = line.encode('utf-16-le')[:(query['column'] - 1) * 2].decode('utf-16-le')
                            except UnicodeError:
                                raise ValueError('UTF-16 column splits a surrogate pair')
                            cursor = get_cursor(tu, get_location(tu, file_ptr, query['line'], len(prefix.encode('utf-8')) + 1))
                            target = referenced(cursor)
                            key = string(usr(target)) or string(usr(cursor))
                            if key:
                                targets.add(key)

                    callback_errors = []

                    @Visitor
                    def visitor(cursor, parent, data):
                        try:
                            loc = loc_cursor(cursor)
                            if loc is None:
                                return 2
                            loc['translationUnit'] = unit['path']
                            if is_declaration(cursor.kind):
                                declarations.append({**loc, 'displayName': string(display(cursor)), 'definition': bool(is_definition(cursor))})
                            target = referenced(cursor)
                            target_id = string(usr(target))
                            if target_id and not is_declaration(cursor.kind):
                                references.append({**loc, 'targetId': target_id, 'declaration': False})
                            if cursor.kind == 103:  # CXCursor_CallExpr
                                calls.append({**loc, 'targetId': target_id or None, 'resolution': 'static_candidate' if target_id else 'unknown', 'targets': []})
                            if cursor.kind == 503:  # CXCursor_InclusionDirective
                                included = included_file(cursor)
                                path = local_path(string(file_name(included))) if included else None
                                imports.append({**loc, 'module': loc['name'], 'resolution': 'resolved' if path else 'unknown', 'targets': [{'path': path, 'digest': files[path]['digest']}] if path else []})
                            if sum(map(len, [declarations, references, calls, imports])) > 200000:
                                raise Unsupported('C/C++ semantic result capacity exceeded; narrow project database')
                            return 2
                        except Exception as error:
                            callback_errors.append(error)
                            return 0

                    visit_children(tu_cursor(tu), visitor, None)
                    if callback_errors:
                        raise callback_errors[0]
                finally:
                    dispose_tu(tu)
        finally:
            dispose_index(index)

    def unique(rows):
        seen, result = set(), []
        for row in rows:
            row = {key: value for key, value in row.items() if key != 'translationUnit'}
            key = json.dumps(row, sort_keys=True)
            if key not in seen:
                seen.add(key); result.append(row)
        return sorted(result, key=lambda row: (row.get('path', ''), row.get('line', 0), row.get('column', 0), row.get('name', '')))

    definitions = {}
    for declaration in unique(declarations):
        if declaration['symbolId'] and declaration['definition']:
            definitions.setdefault(declaration['symbolId'], []).append(declaration)
    for call in calls:
        call['targets'] = [row for row in definitions.get(call['targetId'], []) if row['kind'] in ['FunctionDecl', 'CXXMethod', 'Constructor', 'Destructor', 'ConversionFunction', 'FunctionTemplate']]
        if call['targetId'] and not call['targets']:
            call['resolution'] = 'unknown'
    operation = query['operation']
    if operation == 'definitions':
        results = [row for key in targets for row in definitions.get(key, [])]
    elif operation == 'references':
        results = [row for row in references if row['targetId'] in targets]
        results += [{**row, 'targetId': row['symbolId'], 'declaration': True} for row in declarations if row['symbolId'] in targets]
    else:
        results = {'symbols': declarations, 'imports': imports, 'calls': calls}[operation]
        if query.get('path'):
            results = [row for row in results if row['path'] == query['path']]
    if query.get('prefix'):
        results = [row for row in results if row['path'] == query['prefix'] or row['path'].startswith(query['prefix'] + '/')]
    if operation in ['definitions', 'references'] and not targets:
        diagnostics.append({'path': query['path'], 'line': query['line'], 'message': 'No semantic target resolved at this location', 'severity': 2})
    return {'status': 'sourced', 'engine': 'libclang', 'engineVersion': version, 'engineDigest': hashlib.sha256(lib_path.read_bytes()).hexdigest(), 'adapterDigest': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'results': unique(results), 'diagnostics': unique(diagnostics), 'coverage': {
                'projectConfiguration': query['configPath'], 'translationUnits': [u['path'] for u in units],
                'configurationOnlyArguments': [{'path': u['path'], 'ignoredArguments': u['ignoredArguments']} for u in units if u['ignoredArguments']],
                'semanticResolution': True, 'complete': False, 'hasErrors': any(d.get('severity', 0) >= 3 for d in diagnostics),
                'sourceAccess': 'redirect-only VFS of permission-filtered workspace files',
                'externalDependencies': 'Only readable in-workspace headers; host standard/system headers are not implicitly read',
                'calls': 'Static candidates only; virtual dispatch, function pointers and runtime behavior are not a complete call graph',
                'incremental': 'Content change detection; each query rebuilds configured translation units in a fresh isolated process',
                'unconfiguredSources': [p for p in source_paths if p not in {u['path'] for u in units}],
            }}


try:
    print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False))
except (Unsupported, OSError, AttributeError) as error:
    print(json.dumps({'status': 'unsupported', 'message': str(error)}))
except Exception as error:
    print(json.dumps({'status': 'rejected', 'message': str(error)}))
