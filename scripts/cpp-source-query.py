"""Fixed libclang C API reader. Project commands, plugins and code never execute.

API: clang.llvm.org/doxygen/group__CINDEX.html; LLVM 18 redirect-only VFS:
github.com/llvm/llvm-project/blob/llvmorg-18.1.3/llvm/include/llvm/Support/VirtualFileSystem.h

Three operations, routed on argv: ``cpp_index`` (no argv, one JSON request on stdin),
``import_graph`` (the observation's NDJSON scan) and ``single_file`` (slice-8E2-SPEC W11: the
resident lookup of one file's functions and classes with preamble reuse).
"""
import collections
import ctypes as C
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shlex
import shutil
import sys
import tempfile
import time


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


def database_source(entry):
    """An entry's `directory` + `file` as one normalized name: (directory, file, physical, absolute)."""
    directory = entry['directory'].replace('\\', '/')
    file = entry['file'].replace('\\', '/')
    physical = posixpath.normpath(posixpath.join(directory, file))
    return directory, file, physical, bool(physical.startswith('/') or re.match(r'^[A-Za-z]:/', physical))


def compile_unit(entry, source_paths, files):
    """One compilation database entry to `{path, args, working, ignoredArguments}` with every
    path rebased into the redirect-only VFS. `source_paths` are the readable sources an entry
    may name; `files` answers whether a forced include is readable. Unknown arguments raise
    Unsupported rather than being dropped."""
    if not isinstance(entry, dict) or not isinstance(entry.get('directory'), str) or not isinstance(entry.get('file'), str):
        raise Unsupported('Invalid compilation database entry')
    # Absolute build paths are aliases only. They are matched to a unique
    # readable source suffix; they never authorize access to that host path.
    directory, file, physical, absolute = database_source(entry)
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


def one_variant_per_source(units):
    """A source compiled with two different argument lists has no single precise reading."""
    variants = {}
    for unit in units:
        identity = json.dumps(unit['args'])
        if unit['path'] in variants and variants[unit['path']] != identity:
            raise Unsupported('Multiple compilation variants for one source; select a database with one explicit configuration per translation unit: ' + unit['path'])
        variants[unit['path']] = identity
    return list({unit['path']: unit for unit in units}.values())


def semantic_arguments(args, overlay, system_headers=False, error_limit=30):
    """The fixed tail every semantic parse adds to the filtered arguments. Without system headers
    only the overlay's workspace files are visible (-nostdinc/-nostdinc++); with them the overlay
    also maps the compiler's own header directories file by file (slice-8E2-SPEC W11 rule 1)."""
    isolation = [] if system_headers else ['-nostdinc', '-nostdinc++']
    return args + ['-ivfsoverlay', overlay] + isolation + ['-fno-modules', '-fno-implicit-modules', '-fsyntax-only', '-ferror-limit=%d' % error_limit]


def utf16_column(line_text, byte_column):
    """libclang columns count UTF-8 bytes from 1; locations report UTF-16 units from 1."""
    prefix = line_text.encode('utf-8')[:max(0, byte_column - 1)].decode('utf-8', errors='replace')
    return len(prefix.encode('utf-16-le')) // 2 + 1


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
        return {'path': path, 'digest': files[path]['digest'], 'line': line.value, 'column': utf16_column(text, column.value)}

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

    units = one_variant_per_source([compile_unit(entry, source_paths, files) for entry in configs])
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
                args = semantic_arguments(unit['args'], str(overlay))
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


# ---------------------------------------------------------------------------
# Observation: `import_graph` (slice-8 §11.4 / §11.5).  The TS executor speaks
# one JSON object per line.  This path is independent of the semantic adapter:
# it only reads preprocessor directives and diagnostics, and one translation
# unit libclang cannot parse is reported as that unit's failure.
# ---------------------------------------------------------------------------
GRAPH_OPTIONS = 0x01 | 0x02 | 0x40 | 0x200  # DetailedPreprocessingRecord|Incomplete|SkipFunctionBodies|KeepGoing
GRAPH_EXTRA = ['-w', '-ferror-limit=0', '-fno-modules', '-fno-implicit-modules', '-fsyntax-only']
DEFAULT_TARGET = 'x86_64-pc-linux-gnu'
LEX_CATEGORY = 'Lexical or Preprocessor Issue'
GRAPH_COMPILER = r'(?:clang\+\+|clang|gcc|g\+\+|cc|c\+\+)(?:-[0-9.]+)?'
GRAPH_DIRECTIVE_RE = re.compile(r'^\s*#\s*(?:include_next|include|import)\b')


def graph_include_specifier(text):
    """§11.4: the specifier exactly as written, delimiters included, or the
    written macro word.  One extractor serves plain includes, expanded macros
    and the unexpanded-macro diagnostic: it joins backslash continuations and
    skips whitespace and both comment forms before the token."""
    if isinstance(text, bytes):
        text = text.decode('utf-8', errors='replace')
    text = re.sub(r'\\\r?\n', '', text)
    match = GRAPH_DIRECTIVE_RE.match(text)
    if not match:
        return None
    index = match.end()
    while index < len(text):
        if text[index].isspace():
            index += 1
        elif text.startswith('//', index):
            return None
        elif text.startswith('/*', index):
            end = text.find('*/', index + 2)
            if end < 0:
                return None
            index = end + 2
        else:
            break
    if index >= len(text):
        return None
    first = text[index]
    if first == '"':
        position = index + 1
        while position < len(text):
            if text[position] == '\\':
                position += 2
                continue
            if text[position] == '"':
                return text[index:position + 1]
            position += 1
        return text[index:]
    if first == '<':
        end = text.find('>', index + 1)
        return text[index:end + 1] if end >= 0 else text[index:]
    word = re.match(r'[A-Za-z_][A-Za-z0-9_]*', text[index:])
    if word:
        return word.group(0)
    rest = text[index:].split()
    return rest[0] if rest else None


def graph_physical_lines(cache, content):
    """§11.4: split a file's frozen content into physical lines exactly once.

    `cache` is one per-run dict keyed by the frozen content string, so every
    reference to the same file (in either extraction path, and across compile
    units) reuses the same list instead of re-splitting the whole file."""
    physical = cache.get(content)
    if physical is None:
        physical = content.split('\n')
        cache[content] = physical
    return physical


def graph_logical_directive(cache, contents, path, line):
    """§11.4: the whole logical directive that contains the reported physical
    line, with every backslash continuation joined (LF and CRLF, continuing
    until the final physical line) and with no byte cap.  Both call sites hand
    this text to `graph_include_specifier`; the reported line locates the
    directive, so no column or offset arithmetic is involved.  The physical
    lines come from the shared per-file `cache`."""
    physical = graph_physical_lines(cache, contents.get(path, ''))

    def bare(value):
        return value[:-1] if value.endswith('\r') else value

    if line < 1 or line > len(physical):
        return ''
    index = line - 1
    # A diagnostic can point at a continuation line (e.g. the line that holds
    # the unexpanded macro); walk back to the first physical line of the same
    # spliced directive.
    while index > 0 and bare(physical[index - 1]).endswith('\\'):
        index -= 1
    parts = []
    while index < len(physical):
        current = bare(physical[index])
        index += 1
        if current.endswith('\\'):
            parts.append(current[:-1])
            continue
        parts.append(current)
        break
    return ''.join(parts)

# The table of §11.4 (ported from light_include_scan.py:70-151 and the
# measurement prototype).  A = keep, B = ignore and record, C = reject.
KEEP_PATH = ['-isystem', '-iquote', '-idirafter', '-include', '-imacros', '-I', '-D', '-U']
JOINED_PATH = {'-I', '-D', '-U'}
KEEP_TARGET = ['-x', '-target', '--target']
KEEP_REGEX = [r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', r'--target=[A-Za-z0-9_+.-]+', r'-O[0-3szg]',
              r'-g(?:[0-3]|dwarf-[2-5])?', r'-W(?:no-)?[A-Za-z0-9=-]+']
KEEP_ZERO = ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fexceptions', '-fno-exceptions', '-frtti', '-fno-rtti',
             '-fms-extensions', '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin',
             '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++',
             '-fopenmp', '-mmmx', '-msse', '-msse2', '-msse3', '-mssse3', '-fno-math-errno']
DROP_ONE = ['-o', '-MF', '-MT', '-MQ']
DROP_ZERO = ['-c', '-MD', '-MMD', '-MP', '-pipe']
DROP_TABLE = [
    ('exact', '-w', 0, 'none'), ('exact', '-pedantic', 0, 'none'), ('exact', '-pedantic-errors', 0, 'none'),
    ('exact', '-Wpedantic', 0, 'none'),
    ('exact', '-M', 0, 'none'), ('exact', '-MM', 0, 'none'), ('exact', '-MG', 0, 'none'), ('exact', '-S', 0, 'none'),
    ('exact', '-E', 0, 'none'), ('exact', '-v', 0, 'none'), ('exact', '-H', 0, 'none'), ('exact', '-save-temps', 0, 'none'),
    ('prefix', '-save-temps=', 0, 'none'),
    ('exact', '-shared', 0, 'none'), ('exact', '-static', 0, 'none'), ('exact', '-rdynamic', 0, 'none'),
    ('exact', '-pie', 0, 'none'), ('exact', '-no-pie', 0, 'none'), ('exact', '-s', 0, 'none'),
    ('exact', '-nostdlib', 0, 'none'), ('exact', '-nostdlib++', 0, 'none'), ('exact', '-nodefaultlibs', 0, 'none'),
    ('exact', '-nostartfiles', 0, 'none'), ('exact', '-static-libgcc', 0, 'none'), ('exact', '-static-libstdc++', 0, 'none'),
    ('exact', '--param', 1, 'none'), ('prefix', '--param=', 0, 'none'),
    ('exact', '-Xlinker', 1, 'none'), ('exact', '-Xassembler', 1, 'none'), ('exact', '-u', 1, 'none'),
    ('exact', '-z', 1, 'none'), ('exact', '-T', 1, 'none'), ('exact', '-L', 1, 'none'), ('prefix', '-L', 0, 'none'),
    ('prefix', '-l', 0, 'none'), ('prefix', '-Wl,', 0, 'none'), ('prefix', '-Wa,', 0, 'none'),
    ('exact', '-dumpdir', 1, 'none'), ('exact', '-dumpbase', 1, 'none'), ('exact', '-dumpbase-ext', 1, 'none'),
    ('exact', '-aux-info', 1, 'none'), ('exact', '-B', 1, 'none'), ('prefix', '-B', 0, 'none'),
    ('prefix', '-fuse-ld=', 0, 'none'), ('prefix', '-rtlib=', 0, 'none'), ('prefix', '-unwindlib=', 0, 'none'),
    ('prefix', '-g', 0, 'none'),
    ('prefix', '-O', 0, 'macros'),
    ('exact', '-ansi', 0, 'macros'),
    ('prefix', '-march=', 0, 'macros'), ('prefix', '-mcpu=', 0, 'macros'), ('prefix', '-mtune=', 0, 'none'),
    ('prefix', '-m', 0, 'macros'),
    ('exact', '-arch', 1, 'macros'),
    ('prefix', '-fopenmp', 0, 'macros'), ('prefix', '-fno-openmp', 0, 'macros'),
    ('prefix', '-ffast-math', 0, 'macros'), ('prefix', '-fno-fast-math', 0, 'macros'),
    ('prefix', '-ffinite-math-only', 0, 'macros'), ('prefix', '-fno-finite-math-only', 0, 'macros'),
    ('prefix', '-fsanitize', 0, 'macros'), ('prefix', '-fno-sanitize', 0, 'macros'),
    ('prefix', '-fcoroutines', 0, 'macros'), ('prefix', '-fconcepts', 0, 'macros'), ('prefix', '-fchar8_t', 0, 'macros'),
    ('prefix', '-fno-char8_t', 0, 'macros'), ('prefix', '-faligned-new', 0, 'macros'), ('prefix', '-fno-aligned-new', 0, 'macros'),
    ('prefix', '-fsized-deallocation', 0, 'macros'), ('prefix', '-fno-sized-deallocation', 0, 'macros'),
    ('exact', '-fno-operator-names', 0, 'language'), ('exact', '-fpermissive', 0, 'language'),
    ('exact', '-fno-access-control', 0, 'language'), ('prefix', '-ftemplate-depth', 0, 'language'),
    ('prefix', '-fconstexpr-depth', 0, 'language'), ('prefix', '-fconstexpr-steps', 0, 'language'),
    ('prefix', '-fext-numeric-literals', 0, 'language'), ('prefix', '-fno-gnu-keywords', 0, 'language'),
    ('prefix', '-stdlib=', 0, 'include-paths'), ('prefix', '--gcc-toolchain=', 0, 'include-paths'),
    ('exact', '-gcc-toolchain', 1, 'include-paths'), ('prefix', '--sysroot=', 0, 'include-paths'),
    ('exact', '--sysroot', 1, 'include-paths'), ('exact', '-isysroot', 1, 'include-paths'),
    ('exact', '-iprefix', 1, 'include-paths'),
    ('exact', '-iwithprefix', 1, 'include-paths'), ('exact', '-iwithprefixbefore', 1, 'include-paths'),
    ('exact', '-cxx-isystem', 1, 'include-paths'), ('exact', '-iframework', 1, 'include-paths'),
    ('exact', '-F', 1, 'include-paths'), ('prefix', '-F', 0, 'include-paths'),
    ('exact', '-resource-dir', 1, 'include-paths'), ('prefix', '-resource-dir=', 0, 'include-paths'),
] + [('prefix', p, 0, 'none') for p in [
    '-fvisibility', '-ffunction-sections', '-fno-function-sections', '-fdata-sections', '-fno-data-sections', '-fstack-protector',
    '-fno-stack-protector', '-fstack-clash-protection', '-fno-stack-clash-protection', '-fcf-protection', '-fomit-frame-pointer',
    '-fno-omit-frame-pointer', '-fstrict-aliasing', '-fno-strict-aliasing', '-fwrapv', '-fno-wrapv', '-ftrapv',
    '-fstrict-overflow', '-fno-strict-overflow', '-fasynchronous-unwind-tables', '-fno-asynchronous-unwind-tables',
    '-funwind-tables', '-fno-unwind-tables', '-fplt', '-fno-plt', '-fsemantic-interposition', '-fno-semantic-interposition',
    '-fexcess-precision', '-fmath-errno', '-fno-math-errno', '-fsigned-zeros', '-fno-signed-zeros', '-ftrapping-math',
    '-fno-trapping-math', '-funroll-loops', '-fno-unroll-loops', '-fgnu-unique', '-fno-gnu-unique',
    '-fdelete-null-pointer-checks', '-fno-delete-null-pointer-checks', '-finline', '-fno-inline', '-fdiagnostics',
    '-fno-diagnostics', '-fcolor-diagnostics', '-fno-color-diagnostics', '-fmessage-length', '-fdebug-prefix-map',
    '-ffile-prefix-map', '-fmacro-prefix-map', '-fprofile-arcs', '-fno-profile-arcs', '-ftest-coverage', '-fcoverage-mapping',
    '-fprofile-instr-generate', '-fprofile-generate', '-fprofile-update', '-flto', '-fno-lto', '-ffat-lto-objects',
    '-fno-fat-lto-objects', '-fcommon', '-fno-common', '-fno-builtin-', '-fbuiltin', '-fthreadsafe-statics',
    '-fno-threadsafe-statics', '-felide-constructors', '-fno-elide-constructors', '-fopenmp-simd', '-fstrict-enums', '-ftree-',
    '-fno-tree-', '-fipa-', '-fno-ipa-', '-fvar-tracking', '-fno-var-tracking', '-fstack-usage', '-fident', '-fno-ident',
    '-fuse-cxa-atexit', '-fno-use-cxa-atexit', '-fpch-preprocess', '-fno-keep-inline-dllexport', '-fdebug-types-section',
    '-fno-debug-types-section', '-fstandalone-debug', '-fno-standalone-debug', '-fno-limit-debug-info', '-fvectorize',
    '-fno-vectorize', '-fslp-vectorize', '-fno-slp-vectorize', '-fprefetch-loop-arrays', '-fno-prefetch-loop-arrays',
    '-fasm', '-fno-asm', '-fpcc-struct-return', '-freg-struct-return', '-fshort-enums', '-fno-short-enums',
    '-fzero-initialized-in-bss', '-fno-zero-initialized-in-bss', '-fjump-tables', '-fno-jump-tables', '-fmerge-all-constants',
    '-fno-merge-all-constants', '-ffp-contract', '-fno-fp-contract', '-ffp-model', '-frounding-math', '-fno-rounding-math',
    '-freciprocal-math', '-fno-reciprocal-math', '-fassociative-math', '-fno-associative-math', '-fhonor-nans', '-fno-honor-nans',
    '-fhonor-infinities', '-fno-honor-infinities', '-fexpensive-optimizations', '-fno-expensive-optimizations', '-fgcse', '-fno-gcse',
    '-falign-', '-fno-align-', '-fschedule-insns', '-fno-schedule-insns', '-fpeel-loops', '-fno-peel-loops']]
REJECT_TABLE = [
    ('exact', '-Xclang', 1), ('exact', '-Xpreprocessor', 1), ('prefix', '-Wp,', 0), ('prefix', '-fplugin', 0),
    ('prefix', '-fpass-plugin', 0), ('exact', '-load', 1), ('exact', '-ivfsoverlay', 1), ('exact', '--config', 1),
    ('prefix', '--config=', 0), ('prefix', '-specs', 0), ('exact', '-include-pch', 1), ('prefix', '-fmodule-file', 0),
    ('prefix', '-fmodule-map-file', 0), ('prefix', '-fprebuilt-module-path', 0), ('exact', '-Xarch_host', 1),
    ('exact', '-Xopenmp-target', 1), ('prefix', '-fprofile-use', 0), ('prefix', '-fprofile-instr-use', 0),
    ('prefix', '-fsanitize-blacklist', 0), ('prefix', '-fsanitize-ignorelist', 0)]


class GraphFailure(Exception):
    pass


class GraphUnavailable(Exception):
    pass


def graph_norm(value):
    return posixpath.normpath(value.replace('\\', '/'))


def graph_under(path, root):
    return path == root or path.startswith(root + '/')


def graph_extension(path):
    base = path.rsplit('/', 1)[-1]
    dot = base.rfind('.')
    return base[dot:].lower() if dot > 0 else ''


def graph_includable(path):
    base = path.rsplit('/', 1)[-1]
    return graph_extension(path) == '.def' or '.' not in base


def graph_to_workspace(host, roots):
    for root in roots:
        if root and graph_under(host, root):
            relative = host[len(root):].lstrip('/')
            return relative or '.'
    return None


def graph_overlay_rel(name):
    if not name:
        return None
    name = posixpath.normpath(name)
    return name[len('/workspace/'):] if name.startswith('/workspace/') else None


def graph_table_match(table, argument):
    for row in table:
        if row[0] == 'exact' and argument == row[1]:
            return row
    prefixes = [row for row in table if row[0] == 'prefix' and argument.startswith(row[1])]
    return max(prefixes, key=lambda row: len(row[1])) if prefixes else None


def graph_classify_fnf(spelling):
    if spelling.startswith('expected "FILENAME" or <FILENAME>'):
        return 'macro_unexpanded'
    if 'file not found' not in spelling:
        return None
    if 'with <angled>' in spelling:
        return 'angled_recovered'
    if 'did you mean' in spelling:
        return 'typo_recovered'
    return 'missing'


def graph_emit(row):
    sys.stdout.write(json.dumps(row, ensure_ascii=False) + '\n')
    sys.stdout.flush()


class Clang18:
    def __init__(self, path):
        try:
            lib = C.CDLL(path)
        except OSError as error:
            raise GraphUnavailable('libclang unavailable: ' + str(error))

        def bind(name, result, *args):
            function = getattr(lib, name)
            function.restype, function.argtypes = result, list(args)
            return function

        pointer, uint, char = C.c_void_p, C.c_uint, C.c_char_p
        self.get_string = bind('clang_getCString', char, CXString)
        self.dispose_string = bind('clang_disposeString', None, CXString)
        version = bind('clang_getClangVersion', CXString)
        self.create_index = bind('clang_createIndex', pointer, C.c_int, C.c_int)
        self.parse = bind('clang_parseTranslationUnit2', C.c_int, pointer, char, C.POINTER(char), C.c_int, pointer, uint, uint, C.POINTER(pointer))
        self.tu_cursor = bind('clang_getTranslationUnitCursor', Cursor, pointer)
        self.Visitor = C.CFUNCTYPE(uint, Cursor, Cursor, pointer)
        self.visit_children = bind('clang_visitChildren', uint, Cursor, self.Visitor, pointer)
        self.spelling = bind('clang_getCursorSpelling', CXString, Cursor)
        self.cursor_location = bind('clang_getCursorLocation', Location, Cursor)
        self.included_file = bind('clang_getIncludedFile', pointer, Cursor)
        self.file_name = bind('clang_getFileName', CXString, pointer)
        self.InclusionVisitor = C.CFUNCTYPE(None, pointer, C.POINTER(Location), uint, pointer)
        self.get_inclusions = bind('clang_getInclusions', None, pointer, self.InclusionVisitor, pointer)
        self.expansion_location = bind('clang_getExpansionLocation', None, Location, C.POINTER(pointer), C.POINTER(uint), C.POINTER(uint), C.POINTER(uint))
        self.diagnostic_count = bind('clang_getNumDiagnostics', uint, pointer)
        self.get_diagnostic = bind('clang_getDiagnostic', pointer, pointer, uint)
        self.diagnostic_severity = bind('clang_getDiagnosticSeverity', uint, pointer)
        self.diagnostic_spelling = bind('clang_getDiagnosticSpelling', CXString, pointer)
        self.diagnostic_location = bind('clang_getDiagnosticLocation', Location, pointer)
        self.diagnostic_category = bind('clang_getDiagnosticCategoryText', CXString, pointer)
        self.dispose_diagnostic = bind('clang_disposeDiagnostic', None, pointer)
        self.dispose_tu = bind('clang_disposeTranslationUnit', None, pointer)
        self.dispose_index = bind('clang_disposeIndex', None, pointer)
        self.version = self.string(version())
        if not re.search(r'clang version 18\.', self.version):
            raise GraphUnavailable('Unsupported libclang ABI/version: ' + self.version + '; this adapter is verified with libclang 18')

    def string(self, value):
        try:
            return (self.get_string(value) or b'').decode('utf-8', errors='replace')
        finally:
            self.dispose_string(value)


def graph_databases(databases):
    """§11.4: the provider alone selects; this reads its list, in order."""
    if not databases:
        raise GraphFailure('没有 compile_commands.json')
    selected = []
    for item in databases:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not isinstance(item.get('content'), str):
            raise GraphFailure('配置错误：compile_commands.json 解析不了')
        selected.append((graph_norm(item['path']), item['content']))
    note = '合并了 %d 个编译数据库' % len(selected) if len(selected) > 1 else None
    return selected, note


def graph_filter_args(unit, raw, directory, directory_virtual, virtual_root, host_roots, vfs_set):
    """§11.4 steps 1-6, in the table's order.  Returns nothing; the first
    failing argument is the unit's failure reason."""
    compiler = PurePosixPath(raw[0].replace('\\', '/')).name if raw else ''
    if not re.fullmatch(GRAPH_COMPILER, compiler):
        unit['fail'] = '不认识的编译器：' + compiler
        return
    arguments, index = [], 1

    def fail(text):
        unit['fail'] = '不认识的编译参数：' + text

    while index < len(raw):
        argument = raw[index]
        if any(token in argument for token in ['\n', '\r', '`', '$(', ';', '&&', '||']) or argument.startswith('@'):
            return fail('@' if argument.startswith('@') else argument.split('=')[0])
        option = next((flag for flag in KEEP_PATH if argument == flag or (flag in JOINED_PATH and argument.startswith(flag) and len(argument) > len(flag))), None)
        if option:
            if argument == option:
                if index + 1 >= len(raw):
                    return fail(argument)
                value, index = raw[index + 1], index + 2
            else:
                value, index = argument[len(option):], index + 1
            if option in ('-D', '-U'):
                arguments.extend([option, value])
                continue
            if posixpath.isabs(value):
                path, path_virtual = graph_norm(value), False
            else:
                path, path_virtual = graph_norm(posixpath.join(directory, value)), directory_virtual
            relative = graph_to_workspace(path, (virtual_root,) if path_virtual else host_roots)
            if option in ('-include', '-imacros'):
                if relative is None or relative not in vfs_set:
                    unit['forced'].add(path)
                    continue
            elif relative is None:
                unit['outside'].add(path)
                continue
            arguments.extend([option, '/workspace' + (('/' + relative) if relative != '.' else '')])
            continue
        if argument in KEEP_TARGET:
            if index + 1 >= len(raw) or not re.fullmatch(r'[A-Za-z0-9_+.-]+', raw[index + 1]) or (argument == '-x' and raw[index + 1] not in ('c', 'c++')):
                value = raw[index + 1] if index + 1 < len(raw) else ''
                return fail(argument + ((' ' + value) if value else ''))
            arguments.extend([argument, raw[index + 1]])
            index += 2
            continue
        if any(re.fullmatch(pattern, argument) for pattern in KEEP_REGEX) or argument in KEEP_ZERO:
            arguments.append(argument)
            index += 1
            continue
        if argument in DROP_ONE:
            index += 2
            continue
        if argument in DROP_ZERO:
            index += 1
            continue
        if not argument.startswith('-'):
            if graph_norm(posixpath.join(directory, argument)) != unit['main_host']:
                return fail('多出的位置参数')
            index += 1
            continue
        row = graph_table_match(REJECT_TABLE, argument)
        if row:
            return fail(argument.split('=')[0])
        row = graph_table_match(DROP_TABLE, argument)
        if row:
            if row[3] in ('macros', 'language'):
                unit['flags'].add(argument)
            elif row[3] == 'include-paths':
                unit['flags'].add(row[1].rstrip('='))
            index += 1 + row[2]
            continue
        return fail(argument.split('=')[0])
    unit['args'] = arguments


def graph_build_overlay(contents, vfs_set, scratch):
    tree = {'type': 'directory', 'name': '/workspace', 'contents': []}
    directories = {'': tree}
    for number, name in enumerate(sorted(vfs_set)):
        if name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/')):
            raise GraphFailure('配置错误：文件路径不在工作区里')
        content_path = Path(scratch) / str(number)
        content_path.write_text(contents.get(name, ''), encoding='utf-8')
        parent = ''
        segments = name.split('/')
        for segment in segments[:-1]:
            child = parent + '/' + segment if parent else segment
            if child not in directories:
                directories[child] = {'type': 'directory', 'name': segment, 'contents': []}
                directories[parent]['contents'].append(directories[child])
            parent = child
        directories[parent]['contents'].append({'type': 'file', 'name': segments[-1], 'external-contents': str(content_path)})
    overlay = Path(scratch) / 'vfs.json'
    overlay.write_text(json.dumps({'version': 0, 'case-sensitive': True, 'use-external-names': False, 'fallthrough': False, 'roots': [tree]}), encoding='utf-8')
    return str(overlay)


def graph_unit(cl, index, overlay, unit, number, contents, lines_cache, vfs_set, claimed_set, sent_edges, sent_unresolved, self_pairs):
    if unit['fail']:
        return {'t': 'done', 'i': number, 'files': [{'path': unit['main'], 'status': 'failed', 'reason': unit['fail']}],
                'edges': [], 'unresolved': []}
    args = list(unit['args'])
    if not any(argument in ('-target', '--target') or argument.startswith('--target=') for argument in args):
        args.extend(['-target', DEFAULT_TARGET])
    args.extend(GRAPH_EXTRA + ['-ivfsoverlay', overlay, '-nostdinc', '-nostdinc++'])
    encoded = [argument.encode() for argument in args]
    argv = (C.c_char_p * len(encoded))(*encoded)
    tu = C.c_void_p()
    code = cl.parse(index, ('/workspace/' + unit['main']).encode(), argv, len(argv), None, 0, GRAPH_OPTIONS, C.byref(tu))
    if code != 0 or not tu.value:
        if tu.value:
            cl.dispose_tu(tu)
        return {'t': 'done', 'i': number, 'files': [{'path': unit['main'], 'status': 'failed', 'reason': 'libclang 解析不了（code %d）' % code}],
                'edges': [], 'unresolved': []}
    callback_errors = []

    def fname(file_ptr):
        return cl.string(cl.file_name(file_ptr)) if file_ptr else None

    def location(value):
        file_ptr, line, column, offset = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        cl.expansion_location(value, C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
        return fname(file_ptr.value), line.value, column.value, offset.value

    stacks = collections.defaultdict(list)
    directives = []

    @cl.InclusionVisitor
    def inclusion_visitor(included, stack, depth, data):
        try:
            name = graph_overlay_rel(fname(included))
            if name is None:
                return
            chain = []
            for position in range(depth):
                source, line, _column, _offset = location(stack[position])
                chain.append((graph_overlay_rel(source), line))
            stacks[name].append(chain)
        except Exception as error:
            callback_errors.append(error)

    @cl.Visitor
    def visitor(cursor, parent, data):
        try:
            if cursor.kind == 503:  # CXCursor_InclusionDirective
                source, line, column, offset = location(cl.cursor_location(cursor))
                relative = graph_overlay_rel(source)
                if relative is not None:
                    included = cl.included_file(cursor)
                    directives.append((relative, line, column, offset, cl.string(cl.spelling(cursor)),
                                       graph_overlay_rel(fname(included)) if included else None))
            return 1
        except Exception as error:
            callback_errors.append(error)
            return 1

    rows = []
    try:
        cl.get_inclusions(tu, inclusion_visitor, None)
        cl.visit_children(cl.tu_cursor(tu), visitor, None)
        for diagnostic_number in range(cl.diagnostic_count(tu)):
            diagnostic = cl.get_diagnostic(tu, diagnostic_number)
            try:
                severity = cl.diagnostic_severity(diagnostic)
                if severity < 3:
                    continue
                source, line, _column, _offset = location(cl.diagnostic_location(diagnostic))
                spelling = cl.string(cl.diagnostic_spelling(diagnostic))
                rows.append({'source': graph_overlay_rel(source), 'line': line, 'severity': severity,
                             'category': cl.string(cl.diagnostic_category(diagnostic)), 'spelling': spelling,
                             'classify': graph_classify_fnf(spelling)})
            finally:
                cl.dispose_diagnostic(diagnostic)
        if callback_errors:
            raise callback_errors[0]
    finally:
        cl.dispose_tu(tu)

    fallback = {}
    for row in rows:
        if row['source'] is not None and row['classify'] in ('angled_recovered', 'typo_recovered'):
            fallback[(row['source'], row['line'])] = row['classify']
    read = {unit['main']}
    for name, chains in stacks.items():
        if name is None or name not in vfs_set:
            continue
        if any(not any(location_key in fallback for location_key in chain) for chain in chains):
            read.add(name)
    failed = {}
    for row in rows:
        source = row['source']
        if source and source in read and row['severity'] >= 3 and row['category'] == LEX_CATEGORY and row['classify'] is None:
            failed.setdefault(source, '预处理出错：' + row['spelling'][:200])
    per_file = {}
    for path in read:
        if path in claimed_set:
            per_file[path] = ('failed', failed[path]) if path in failed else ('parsed', None)
    edges, unresolved = set(), set()
    for source, line, column, offset, spelled, target in directives:
        if source not in read or source in failed:
            continue
        specifier = graph_include_specifier(graph_logical_directive(lines_cache, contents, source, line)) or spelled
        kind = fallback.get((source, line))
        if kind == 'angled_recovered':
            unresolved.add((source, specifier, None if target == source else '尖括号引用只能按引号规则找到'))
        elif kind == 'typo_recovered':
            unresolved.add((source, specifier, '拼写纠正后才找到'))
        elif target is not None and target in vfs_set:
            if target != source:
                edges.add((source, target, specifier))
            else:
                self_pairs.add((source, specifier))
        else:
            unresolved.add((source, specifier, None))
    for row in rows:
        source = row['source']
        if source and row['classify'] == 'macro_unexpanded' and source in read and source not in failed:
            text = graph_logical_directive(lines_cache, contents, source, row['line'])
            specifier = graph_include_specifier(text)
            unresolved.add((source, specifier if specifier else text.strip(), 'include 后面跟宏'))
    unresolved = {row for row in unresolved if (row[0], row[1]) not in self_pairs}
    files = [dict({'path': path, 'status': status}, **({'reason': reason} if reason is not None else {}))
             for path, (status, reason) in sorted(per_file.items())]
    new_edges, new_unresolved = [], []
    for edge in sorted(edges, key=lambda row: (row[0], row[1], row[2])):
        if edge in sent_edges:
            continue
        sent_edges.add(edge)
        new_edges.append(list(edge))
    for row in sorted(unresolved, key=lambda item: (item[0], item[1], item[2] or '')):
        if row in sent_unresolved:
            continue
        sent_unresolved.add(row)
        new_unresolved.append({'from': row[0], 'specifier': row[1], 'reason': row[2]})
    return {'t': 'done', 'i': number, 'files': files, 'edges': new_edges, 'unresolved': new_unresolved}


def graph_run():
    first = sys.stdin.readline()
    if not first.strip():
        raise GraphFailure('配置错误：没有输入')
    try:
        header = json.loads(first)
    except ValueError:
        raise GraphFailure('配置错误：头一行解析不了')
    if not isinstance(header, dict) or header.get('t') != 'header':
        raise GraphFailure('配置错误：头一行不是 header')
    config = header.get('config') if isinstance(header.get('config'), dict) else {}
    paths = [path for path in header.get('paths') or [] if isinstance(path, str)]
    claimed_set = set(paths)
    contents = {}
    for raw in sys.stdin:
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except ValueError:
            continue
        if isinstance(row, dict) and row.get('t') == 'file' and isinstance(row.get('path'), str) and isinstance(row.get('content'), str):
            contents[row['path']] = row['content']
    host_root = graph_norm(config['workspaceRoot']) if isinstance(config.get('workspaceRoot'), str) and config['workspaceRoot'] else None
    host_real = graph_norm(config['workspaceRealRoot']) if isinstance(config.get('workspaceRealRoot'), str) and config['workspaceRealRoot'] else None
    virtual_root = host_root or host_real or '/workspace'
    host_roots = tuple(root for root in (host_root, host_real) if root)
    selected, merged_note = graph_databases(config.get('databases') or [])
    for path, content in selected:
        if '\0' in content:
            raise GraphFailure(path.rsplit('/', 1)[-1] + ' 读不了：binary source')
    entries = []
    for path, content in selected:
        try:
            data = json.loads(content)
        except ValueError:
            raise GraphFailure('配置错误：compile_commands.json 解析不了')
        if not isinstance(data, list):
            raise GraphFailure('配置错误：compile_commands.json 不是数组')
        if posixpath.isabs(path):
            database_host, database_virtual = graph_norm(posixpath.dirname(path)), False
        elif host_root:
            database_host, database_virtual = graph_norm(posixpath.join(host_root, posixpath.dirname(path))), False
        else:
            database_host, database_virtual = graph_norm(posixpath.join(virtual_root, posixpath.dirname(path))), True
        entries.extend((database_host, database_virtual, entry) for entry in data)
    for number, (_database, _virtual, entry) in enumerate(entries, start=1):
        problem = None
        if not isinstance(entry, dict):
            problem = '不是对象'
        elif 'file' not in entry:
            problem = '没有 file'
        elif 'directory' not in entry:
            problem = '没有 directory'
        elif not isinstance(entry['file'], str):
            problem = '的 file 不是字符串'
        elif not isinstance(entry['directory'], str):
            problem = '的 directory 不是字符串'
        elif 'arguments' in entry and not (isinstance(entry['arguments'], list) and all(isinstance(value, str) for value in entry['arguments'])):
            problem = '的 arguments 不是字符串列表'
        elif 'arguments' not in entry and 'command' not in entry:
            problem = '没有 arguments 也没有 command'
        if problem:
            raise GraphFailure('配置错误：compile_commands.json 的第 %d 条%s' % (number, problem))
    vfs_set = set(paths) | {path for path in contents if graph_includable(path)}
    units, seen, unobserved = [], set(), 0
    for database_host, database_virtual, entry in entries:
        directory = entry['directory']
        if posixpath.isabs(directory):
            directory, directory_virtual = graph_norm(directory), False
        else:
            directory, directory_virtual = graph_norm(posixpath.join(database_host, directory)), database_virtual
        file_value = entry['file']
        if posixpath.isabs(file_value):
            main_host, main_virtual = graph_norm(file_value), False
        else:
            main_host, main_virtual = graph_norm(posixpath.join(directory, file_value)), directory_virtual
        main = graph_to_workspace(main_host, (virtual_root,) if main_virtual else host_roots)
        unit = {'main': main, 'main_host': main_host, 'args': [], 'fail': None,
                'outside': set(), 'forced': set(), 'flags': set()}
        raw = entry.get('arguments')
        if raw is None:
            command = entry.get('command')
            try:
                raw = shlex.split(command, posix=True) if isinstance(command, str) else []
            except ValueError:
                unit['fail'] = '编译命令拆不开'
                raw = []
            if not isinstance(command, str):
                unit['fail'] = '编译命令拆不开'
        if unit['fail'] is None:
            graph_filter_args(unit, raw, directory, directory_virtual, virtual_root, host_roots, vfs_set)
        identity = (main if main is not None else main_host, tuple(unit['args']), unit['fail'])
        if identity in seen:
            continue
        seen.add(identity)
        if main is None or main not in claimed_set:
            unobserved += 1
            continue
        units.append(unit)
    notes = set()
    if merged_note:
        notes.add(merged_note)
    flags = set().union(*(unit['flags'] for unit in units)) if units else set()
    if flags:
        notes.add('忽略的编译参数：' + '、'.join(sorted(flags)))
    outside = set().union(*(unit['outside'] for unit in units)) if units else set()
    if outside:
        notes.add('忽略了 %d 个工作区外的查找目录' % len(outside))
    forced = set().union(*(unit['forced'] for unit in units)) if units else set()
    if forced:
        notes.add('忽略了 %d 个读不到的强制包含文件' % len(forced))
    if unobserved:
        notes.add('%d 个编译单元的主文件不在观测的文件里' % unobserved)
    library = config.get('libraryPath')
    if not isinstance(library, str) or not posixpath.isabs(library) or not Path(library).is_file():
        raise GraphUnavailable('libclang unavailable: ' + str(library))
    try:
        cl = Clang18(library)
    except GraphUnavailable:
        raise
    except (OSError, AttributeError) as error:
        raise GraphUnavailable('libclang unavailable: ' + str(error))
    resume = header.get('resumeFrom')
    resume = resume if isinstance(resume, int) and resume > 0 else 0
    sent_edges, sent_unresolved, self_pairs = set(), set(), set()
    lines_cache = {}
    with tempfile.TemporaryDirectory(prefix='platform-cpp-import-graph-') as scratch:
        overlay = graph_build_overlay(contents, vfs_set, scratch)
        graph_emit({'t': 'ready', 'engine': 'libclang', 'engineVersion': cl.version,
                    'units': [unit['main'] for unit in units], 'notes': sorted(notes)})
        index = cl.create_index(0, 0)
        try:
            for number, unit in enumerate(units):
                if number < resume:
                    continue
                graph_emit({'t': 'start', 'i': number, 'path': unit['main']})
                try:
                    done = graph_unit(cl, index, overlay, unit, number, contents, lines_cache, vfs_set, claimed_set, sent_edges, sent_unresolved, self_pairs)
                except (GraphFailure, GraphUnavailable):
                    raise
                except Exception as error:
                    done = {'t': 'done', 'i': number, 'files': [{'path': unit['main'], 'status': 'failed',
                            'reason': type(error).__name__ + ': ' + str(error)[:200]}], 'edges': [], 'unresolved': []}
                graph_emit(done)
        finally:
            cl.dispose_index(index)
    graph_emit({'t': 'end'})


def graph_import():
    try:
        graph_run()
    except GraphUnavailable as error:
        graph_emit({'t': 'unavailable', 'message': str(error)})
    except GraphFailure as error:
        graph_emit({'t': 'failed', 'reason': str(error)})
    except Exception as error:
        graph_emit({'t': 'failed', 'reason': type(error).__name__ + ': ' + str(error)[:200]})


# ---------------------------------------------------------------------------
# Single-file lookup (slice-8E2-SPEC W11).  One resident process, one JSON object per line
# in both directions:
#   in   {"t": "hello", "libraryPath"}
#   out  {"t": "ready", "engine", "engineVersion", "precise", "systemDirectories",
#         "systemFiles", "overlayMs", "probes"} | {"t": "unavailable", "message"}
#   in   {"t": "lookup", "path", "text", "mode": "read" | "write", "entries": [...] | null}
#   out  any number of {"t": "read", "paths", "content": bool}, each answered by
#   in   {"t": "files", "files": [{"path", "digest", "content"?} | {"path", "absent": true}]}
#        | {"t": "files", "failed": reason}
#   out  {"t": "result", "exact", "symbols", "warm"?} | {"t": "unsupported", "message"}
#        | {"t": "failed", "reason"}
# `entries` are the root database's entries that may name this file (null: no
# database).  Workspace files reach the process only through `read`, answered by
# the platform's reads; the compiler's own header directories are read directly,
# read-only (W11 rule 1, decision 117).
# ---------------------------------------------------------------------------
SINGLE_PRECISE = 0x04 | 0x100 | 0x200   # PrecompiledPreamble|CreatePreambleOnFirstParse|KeepGoing
SINGLE_FALLBACK = 0x400 | 0x200         # SingleFileParse|KeepGoing
# Retained translation units, least recently used dropped first (about 43 MiB each, slice-8E2-SPEC §3.2 item 9).
CPP_RETAINED_UNITS_MAX = 8
# Discovery parses (only for includes named through a macro); each adds at least one asked path.
CPP_DISCOVERY_ROUNDS_MAX = 16
# Struct, Class, Function, CXXMethod, Constructor, Destructor, FunctionTemplate, ClassTemplate.
SINGLE_KINDS = frozenset([2, 4, 8, 21, 24, 25, 30, 31])
PROBE_PATH = 'platform-probe.cpp'
PROBE_SOURCE = b'#include <cstddef>\n'
SEARCH_START = '#include <...> search starts here:'
SEARCH_END = 'End of search list.'
VALUED_ARGUMENTS = ('-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U', '-x', '-target', '--target')
CONDITION_RE = re.compile(r'^\s*#\s*(?:el)?if')
HAS_INCLUDE_RE = re.compile(r'__has_include(?:_next)?\s*\(\s*(?:"([^"\n]+)"|<([^>\n]+)>)')


class CXUnsavedFile(C.Structure):
    _fields_ = [('Filename', C.c_char_p), ('Contents', C.c_char_p), ('Length', C.c_ulong)]


class LookupFailed(Exception):
    """This lookup cannot finish (a read failed, libclang could not parse); the process goes on."""


class Clang18Single(Clang18):
    """The import-graph bindings plus what a retained, reparsed translation unit needs."""

    def __init__(self, path):
        super().__init__(path)
        lib = C.CDLL(path)

        def bind(name, result, *args):
            function = getattr(lib, name)
            function.restype, function.argtypes = result, list(args)
            return function

        pointer, uint, char = C.c_void_p, C.c_uint, C.c_char_p
        self.parse_unsaved = bind('clang_parseTranslationUnit2', C.c_int, pointer, char, C.POINTER(char), C.c_int,
                                  C.POINTER(CXUnsavedFile), uint, uint, C.POINTER(pointer))
        self.reparse = bind('clang_reparseTranslationUnit', C.c_int, pointer, uint, C.POINTER(CXUnsavedFile), uint)
        self.kind_spelling = bind('clang_getCursorKindSpelling', CXString, uint)
        self.spelling_location = bind('clang_getSpellingLocation', None, Location, C.POINTER(pointer), C.POINTER(uint), C.POINTER(uint), C.POINTER(uint))
        self.get_file = bind('clang_getFile', pointer, pointer, char)
        self.name_range = bind('clang_Cursor_getSpellingNameRange', Range, Cursor, uint, uint)
        self.range_end = bind('clang_getRangeEnd', Location, Range)


class RequiredPaths:
    """Stands for `files` in compile_unit: records each forced include instead of checking it;
    the lookup reads them and rejects the unit when one is absent."""

    def __init__(self):
        self.paths = []

    def __contains__(self, path):
        if path not in self.paths:
            self.paths.append(path)
        return True


class RetainedUnit:
    def __init__(self, tu, scratch, workspace, system):
        self.tu = tu
        self.scratch = scratch
        self.workspace = workspace   # every workspace path this unit asked about: {digest, content} or None
        self.system = system         # every compiler header it included: listed path -> sha256 at inclusion


def names_source(entry, path):
    """Whether an entry is this file, read as compile_unit reads it: an absolute name ends with
    '/' + path, a relative one is path."""
    if not isinstance(entry, dict) or not isinstance(entry.get('directory'), str) or not isinstance(entry.get('file'), str):
        return False
    _directory, _file, physical, absolute = database_source(entry)
    return physical.endswith('/' + path) if absolute else physical == path


def include_search(args):
    search = {'-iquote': [], '-I': [], '-isystem': []}
    index = 0
    while index < len(args):
        if args[index] in VALUED_ARGUMENTS and index + 1 < len(args):
            if args[index] in search:
                search[args[index]].append(args[index + 1])
            index += 2
        else:
            index += 1
    return search


def include_candidates(includer, name, quoted, search):
    """Workspace paths an include can resolve to, in the compiler's search order: the
    includer's directory and -iquote for quoted names, then -I, then -isystem. Absolute
    names and names that leave the workspace have none."""
    if not name or name.startswith('/'):
        return []
    directories = ([posixpath.dirname('/workspace/' + includer)] + search['-iquote'] if quoted else []) + search['-I'] + search['-isystem']
    candidates = []
    for directory in directories:
        relative = graph_overlay_rel(posixpath.join(directory, name))
        if relative and relative not in candidates:
            candidates.append(relative)
    return candidates


def vfs_roots(mapped):
    """{absolute VFS path: external file} to redirect-only overlay roots, one per top-level
    directory, every file its own `file` entry (no directory remaps)."""
    tree = {}
    for name in sorted(mapped):
        node, parts = tree, name.strip('/').split('/')
        for part in parts[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                break
        else:
            node.setdefault(parts[-1], mapped[name])

    def entry(name, node):
        if isinstance(node, str):
            return {'type': 'file', 'name': name, 'external-contents': node}
        return {'type': 'directory', 'name': name, 'contents': [entry(key, value) for key, value in node.items()]}
    return [entry('/' + key, value) for key, value in tree.items()]


def system_headers(directories):
    """W11 rule 1: every file under the listed include directories whose real path (symlinks
    resolved) is still inside one of them, keyed by its listed path. Symlinked directories are
    followed only to the same places; a directory reached twice is walked once."""
    reals = [os.path.realpath(directory) for directory in directories]

    def inside(real):
        return any(graph_under(real, root) for root in reals)

    mapped = {}
    for directory in directories:
        base = posixpath.normpath(directory)
        if graph_under(base, '/workspace'):
            continue
        visited = set()
        for top, names, files in os.walk(directory, followlinks=True):
            real_top = os.path.realpath(top)
            if real_top in visited or not inside(real_top):
                names[:] = []
                continue
            visited.add(real_top)
            relative = posixpath.relpath(top, directory)
            prefix = base if relative == '.' else posixpath.join(base, relative)
            for name in files:
                real = os.path.realpath(posixpath.join(top, name))
                if inside(real) and os.path.isfile(real):
                    mapped.setdefault(posixpath.join(prefix, name), real)
    return mapped


def search_list(text):
    """The `-v` angled search list, in order; empty when the markers are missing."""
    lines = [line.rstrip('\r') for line in text.split('\n')]
    if SEARCH_START not in lines:
        return []
    directories = []
    for line in lines[lines.index(SEARCH_START) + 1:]:
        if line == SEARCH_END:
            return directories
        entry = line.strip()
        if entry.endswith(' (framework directory)'):
            entry = entry[:-len(' (framework directory)')]
        if entry.startswith('/'):
            directories.append(entry)
    return []


def file_digest(path):
    try:
        with open(path, 'rb') as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def read_files(paths, content):
    """Asks the main thread for workspace files, which it reads through the platform."""
    graph_emit({'t': 'read', 'paths': paths, 'content': content})
    raw = sys.stdin.readline()
    if not raw:
        raise SystemExit(0)
    message = json.loads(raw)
    if message.get('failed') is not None:
        raise LookupFailed(str(message['failed']))
    rows = {row['path']: row for row in message['files']}
    return {path: None if rows[path].get('absent') else {'digest': rows[path]['digest'], 'content': rows[path].get('content')}
            for path in paths}


class SingleFileLookup:
    def __init__(self, cl, scratch):
        self.cl, self.scratch = cl, scratch
        self.index = cl.create_index(0, 0)
        self.units = collections.OrderedDict()   # (path, json.dumps(args)) -> RetainedUnit
        self.system, self.system_roots, self.precise = {}, [], False
        self.empty_overlay = self.write_overlay(scratch, {}, 'empty.json')
        self.ready = self.probe()

    def close(self):
        for key in list(self.units):
            self.drop(key)
        self.cl.dispose_index(self.index)

    # -- parsing ------------------------------------------------------------
    def parse(self, path, data, args, options):
        encoded = [argument.encode() for argument in args]
        argv = (C.c_char_p * len(encoded))(*encoded)
        unsaved = (CXUnsavedFile * 1)(CXUnsavedFile(('/workspace/' + path).encode(), data, len(data)))
        tu = C.c_void_p()
        code = self.cl.parse_unsaved(self.index, ('/workspace/' + path).encode(), argv, len(argv), unsaved, 1, options, C.byref(tu))
        if code != 0 or not tu.value:
            if tu.value:
                self.cl.dispose_tu(tu)
            raise LookupFailed('libclang 解析不了（code %d）' % code)
        return tu

    def errors(self, tu):
        count = 0
        for number in range(self.cl.diagnostic_count(tu)):
            diagnostic = self.cl.get_diagnostic(tu, number)
            try:
                count += self.cl.diagnostic_severity(diagnostic) >= 3
            finally:
                self.cl.dispose_diagnostic(diagnostic)
        return count

    def write_overlay(self, directory, workspace, name):
        """One overlay file per parse: the pre-serialized compiler headers plus this unit's
        workspace files (stacked overlays with fallthrough=false would not see each other)."""
        roots = [json.dumps(root) for root in vfs_roots(workspace)] or [json.dumps({'type': 'directory', 'name': '/workspace', 'contents': []})]
        path = posixpath.join(directory, name)
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write('{"version": 0, "case-sensitive": true, "use-external-names": false, "fallthrough": false, "roots": ['
                         + ', '.join(self.system_roots + roots) + ']}')
        return path

    def probe(self):
        """Rule 4: whether the compiler's own headers work, from a parse of an in-memory
        `#include <cstddef>` with `-v` (which also prints the search list) and the same
        parse through the overlay that maps them. Either failing: workspace files only."""
        def errors_of(args):
            try:
                tu = self.parse(PROBE_PATH, PROBE_SOURCE, args, 0)
            except LookupFailed:
                return 1
            try:
                return self.errors(tu)
            finally:
                self.cl.dispose_tu(tu)

        with tempfile.TemporaryFile() as capture:
            saved = os.dup(2)
            os.dup2(capture.fileno(), 2)
            try:
                search_errors = errors_of(['-x', 'c++', '-v'])
            finally:
                os.dup2(saved, 2)
                os.close(saved)
            capture.seek(0)
            listed = search_list(capture.read().decode('utf-8', errors='replace'))
        started = time.perf_counter()
        system = system_headers(listed)
        roots = [json.dumps(root) for root in vfs_roots(system)]
        overlay_ms = round((time.perf_counter() - started) * 1000)
        self.system, self.system_roots = system, roots
        overlay_errors = errors_of(semantic_arguments(['-x', 'c++'], self.write_overlay(self.scratch, {}, 'probe.json'), system_headers=True))
        self.precise = bool(listed) and search_errors == 0 and overlay_errors == 0
        if not self.precise:
            self.system, self.system_roots = {}, []
        return {'t': 'ready', 'engine': 'libclang', 'engineVersion': self.cl.version, 'precise': self.precise,
                'systemDirectories': listed, 'systemFiles': len(system), 'overlayMs': overlay_ms,
                'probes': {'searchErrors': search_errors, 'overlayErrors': overlay_errors}}

    # -- what a unit needs and used -------------------------------------------
    def directive_needs(self, tu, contents, known, search):
        """After a discovery parse (detailed preprocessing record): for every include in a
        workspace file, the candidates searched before the one it resolved to (all of them
        when it resolved outside the workspace or not at all) that were not asked yet."""
        cl, cache, needed, errors = self.cl, {}, [], []

        @cl.Visitor
        def visitor(cursor, parent, data):
            try:
                if cursor.kind == 503:  # CXCursor_InclusionDirective
                    source, line = self.expansion(cl.cursor_location(cursor))
                    includer = graph_overlay_rel(source)
                    if includer in contents:
                        specifier = graph_include_specifier(graph_logical_directive(cache, contents, includer, line)) or ''
                        included = cl.included_file(cursor)
                        target = graph_overlay_rel(cl.string(cl.file_name(included))) if included else None
                        candidates = include_candidates(includer, cl.string(cl.spelling(cursor)), not specifier.startswith('<'), search)
                        if target in candidates:
                            candidates = candidates[:candidates.index(target)]
                        needed.extend(path for path in candidates if path not in known and path not in needed)
                return 1
            except Exception as error:
                errors.append(error)
                return 0

        cl.visit_children(cl.tu_cursor(tu), visitor, None)
        if errors:
            raise errors[0]
        return needed

    @staticmethod
    def text_needs(relative, contents, cache, known, search, needed):
        """Adds to `needed` the not yet asked candidates of one file's include lines and
        `__has_include` names, read as text (inactive branches included). True when an
        include names its file through a macro, which only a parse can resolve."""
        macro = False
        for number, line in enumerate(graph_physical_lines(cache, contents[relative]), start=1):
            names = []
            if GRAPH_DIRECTIVE_RE.match(line):
                specifier = graph_include_specifier(graph_logical_directive(cache, contents, relative, number)) or ''
                if len(specifier) >= 2 and specifier[0] in '"<':
                    names.append((specifier[1:-1], specifier[0] == '"'))
                else:
                    macro = macro or bool(specifier)
            elif CONDITION_RE.match(line):
                # `__has_include` looks files up without a directive or a diagnostic, so
                # only the text shows which workspace paths it depends on.
                names.extend((quoted or angled, bool(quoted)) for quoted, angled in HAS_INCLUDE_RE.findall(line))
            for name, quoted in names:
                needed.extend(candidate for candidate in include_candidates(relative, name, quoted, search)
                              if candidate not in known and candidate not in needed)
        return macro

    def system_used(self, tu, previous):
        """Rule 3: the digest of every compiler header the unit included, read directly; a
        header recorded before keeps the digest it had then."""
        cl, names, errors = self.cl, set(), []

        @cl.InclusionVisitor
        def visit(included, stack, depth, data):
            try:
                name = posixpath.normpath(cl.string(cl.file_name(included)))
                if name in self.system:
                    names.add(name)
            except Exception as error:
                errors.append(error)

        cl.get_inclusions(tu, visit, None)
        if errors:
            raise errors[0]
        return {name: previous[name] if name in previous else file_digest(self.system[name]) for name in names}

    def expansion(self, value):
        file_ptr, line, column, offset = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
        self.cl.expansion_location(value, C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
        return (self.cl.string(self.cl.file_name(file_ptr)) if file_ptr.value else None), line.value

    def symbols(self, tu, path, text):
        """Rule 2: functions, methods, constructors, destructors, classes, structs and their
        templates whose name is spelled in the looked-up file; the span is the name."""
        cl, lines, rows, errors = self.cl, text.split('\n'), [], []
        main = cl.get_file(tu, ('/workspace/' + path).encode())
        if not main:
            return rows

        @cl.Visitor
        def visitor(cursor, parent, data):
            try:
                location = cl.cursor_location(cursor)
                file_ptr, line, column, offset = C.c_void_p(), C.c_uint(), C.c_uint(), C.c_uint()
                # A declaration of this file sits only under cursors written (after macro
                # expansion) in this file; a namespace named by a command-line macro included.
                cl.expansion_location(location, C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
                if file_ptr.value != main:
                    return 1
                if cursor.kind in SINGLE_KINDS:
                    cl.spelling_location(location, C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
                    if file_ptr.value == main and 0 < line.value <= len(lines):
                        name, text_line, start_line = cl.string(cl.spelling(cursor)), lines[line.value - 1], line.value
                        start = utf16_column(text_line, column.value)
                        # The name as written (`Wrapper` of `Wrapper<T>`'s constructor, `~ Wrapper`),
                        # else the spelling's own length.
                        cl.spelling_location(cl.range_end(cl.name_range(cursor, 0, 0)), C.byref(file_ptr), C.byref(line), C.byref(column), C.byref(offset))
                        end = utf16_column(text_line, column.value) if file_ptr.value == main and line.value == start_line else 0
                        if end <= start:
                            end = start + len(name.encode('utf-16-le')) // 2
                        rows.append({'name': name, 'kind': cl.string(cl.kind_spelling(cursor.kind)),
                                     'start': {'line': start_line, 'column': start}, 'end': {'line': start_line, 'column': end}})
                return 2
            except Exception as error:
                errors.append(error)
                return 0

        cl.visit_children(cl.tu_cursor(tu), visitor, None)
        if errors:
            raise errors[0]
        rows.sort(key=lambda row: (row['start']['line'], row['start']['column'], row['name'], row['kind']))
        return rows

    # -- units ----------------------------------------------------------------
    def build(self, path, text, unit, known, ask):
        """The precise parse that leaves a preamble, after every workspace path its includes
        can name was asked. `known` holds the content of every present path. The include lines
        of every file read are followed as text first; only when one names its file through a
        macro do discovery parses (with the preprocessing record) look for more."""
        scratch = tempfile.mkdtemp(prefix='unit-', dir=self.scratch)
        written, search, data, scanned = {}, include_search(unit['args']), text.encode('utf-8'), set()
        macro = False

        def prefetch():
            nonlocal macro
            while True:
                contents, cache, needed = self.contents(path, text, known), {}, []
                for relative in contents:
                    if relative not in scanned:
                        scanned.add(relative)
                        macro = self.text_needs(relative, contents, cache, known, search, needed) or macro
                if not needed:
                    return
                known.update(ask(needed, True))

        # libclang keeps a preamble across reparses only when the main file exists in the file
        # system it parsed with; its text still always comes from the unsaved buffer.
        main_copy = posixpath.join(scratch, 'main')

        def overlay(name):
            for relative, file in known.items():
                if file is not None and relative not in written:
                    target = posixpath.join(scratch, str(len(written)))
                    with open(target, 'w', encoding='utf-8', newline='') as handle:
                        handle.write(file['content'])
                    written[relative] = target
            files = {'/workspace/' + relative: target for relative, target in written.items()}
            files['/workspace/' + path] = main_copy
            return self.write_overlay(scratch, files, name)

        try:
            with open(main_copy, 'w', encoding='utf-8', newline='') as handle:
                handle.write(text)
            for number in range(CPP_DISCOVERY_ROUNDS_MAX + 1):
                prefetch()
                if not macro:
                    break
                tu = self.parse(path, data, semantic_arguments(unit['args'], overlay('discover-%d.json' % number), self.precise, error_limit=0), GRAPH_OPTIONS)
                try:
                    needed = self.directive_needs(tu, self.contents(path, text, known), known, search)
                finally:
                    self.cl.dispose_tu(tu)
                if not needed or number == CPP_DISCOVERY_ROUNDS_MAX:
                    break
                known.update(ask(needed, True))
            tu = self.parse(path, data, semantic_arguments(unit['args'], overlay('unit.json'), self.precise), SINGLE_PRECISE)
            try:
                return RetainedUnit(tu, scratch, dict(known), self.system_used(tu, {}))
            except BaseException:
                self.cl.dispose_tu(tu)
                raise
        except BaseException:
            shutil.rmtree(scratch, ignore_errors=True)
            raise

    @staticmethod
    def contents(path, text, known):
        return dict({relative: file['content'] for relative, file in known.items() if file is not None}, **{path: text})

    def unchanged(self, retained, current):
        for relative, before in retained.workspace.items():
            now = current.get(relative)
            if (before is None) != (now is None) or (before is not None and before['digest'] != now['digest']):
                return False
        return all(file_digest(self.system[name]) == digest for name, digest in retained.system.items())

    def reparse(self, retained, path, text):
        data = text.encode('utf-8')
        unsaved = (CXUnsavedFile * 1)(CXUnsavedFile(('/workspace/' + path).encode(), data, len(data)))
        if self.cl.reparse(retained.tu, 1, unsaved, 0) != 0:
            return False   # the unit is unusable after a failed reparse; the caller drops it
        retained.system = self.system_used(retained.tu, retained.system)
        return True

    def keep(self, key, retained):
        self.units[key] = retained
        while len(self.units) > CPP_RETAINED_UNITS_MAX:
            self.drop(next(iter(self.units)))

    def drop(self, key):
        retained = self.units.pop(key, None)
        if retained is not None:
            self.cl.dispose_tu(retained.tu)
            shutil.rmtree(retained.scratch, ignore_errors=True)

    def result(self, tu, path, text, precise, warm=False):
        reply = {'t': 'result', 'exact': precise and self.errors(tu) == 0, 'symbols': self.symbols(tu, path, text)}
        if warm:
            reply['warm'] = True
        return reply

    def fallback(self, path, text, args, warm):
        """No usable precise unit: the main file alone, includes not processed, no database
        flags but its -std; nothing else is visible to it."""
        standard = [argument for argument in args if argument.startswith('-std=')]
        tu = self.parse(path, text.encode('utf-8'), semantic_arguments(['-x', 'c++'] + standard, self.empty_overlay), SINGLE_FALLBACK)
        try:
            return self.result(tu, path, text, False, warm)
        finally:
            self.cl.dispose_tu(tu)

    def lookup(self, request, ask):
        path, text, mode = request['path'], request['text'], request['mode']
        entries = [entry for entry in (request.get('entries') or []) if names_source(entry, path)]
        if not entries:
            return self.fallback(path, text, [], warm=False)
        forced = RequiredPaths()
        unit = one_variant_per_source([compile_unit(entry, [path], forced) for entry in entries])[0]
        key = (path, json.dumps(unit['args']))
        for other in [known_key for known_key in self.units if known_key[0] == path and known_key != key]:
            self.drop(other)
        seed = {}
        retained = self.units.get(key)
        if retained is not None:
            current = ask(sorted(retained.workspace), False) if retained.workspace else {}
            if self.unchanged(retained, current):
                if self.reparse(retained, path, text):
                    self.units.move_to_end(key)
                    # The headers are as built; only the new main text can name a path not asked
                    # yet (an include named through a macro is read at the next build).
                    needed = []
                    self.text_needs(path, self.contents(path, text, retained.workspace), {}, retained.workspace,
                                    include_search(unit['args']), needed)
                    if not needed:
                        return self.result(retained.tu, path, text, True)
                    if mode == 'read':
                        # The unit cannot see those headers, so the preamble for this text is not built
                        # yet: fall back and warm (slice-8E2-SPEC W11); the kept unit stays as the seed.
                        return self.fallback(path, text, unit['args'], warm=True)
                seed = retained.workspace
            else:
                seed = current
            self.drop(key)
        if mode == 'read':
            return self.fallback(path, text, unit['args'], warm=True)
        known = dict(seed)
        wanted = [relative for relative, file in known.items() if file is not None and file.get('content') is None]
        wanted += [relative for relative in forced.paths if relative not in known]
        if wanted:
            known.update(ask(wanted, True))
        absent = [relative for relative in forced.paths if known.get(relative) is None]
        if absent:
            raise Unsupported('Forced include is unavailable in snapshot: ' + absent[0])
        built = self.build(path, text, unit, known, ask)
        self.keep(key, built)
        return self.result(built.tu, path, text, True)

    def answer(self, request):
        try:
            return self.lookup(request, read_files)
        except Unsupported as error:
            return {'t': 'unsupported', 'message': str(error)[:1000]}
        except LookupFailed as error:
            return {'t': 'failed', 'reason': str(error)[:200]}
        except Exception as error:
            return {'t': 'failed', 'reason': type(error).__name__ + ': ' + str(error)[:200]}


def single_file_run():
    hello = json.loads(sys.stdin.readline() or 'null')
    library = hello.get('libraryPath') if isinstance(hello, dict) else None
    if not isinstance(library, str) or not posixpath.isabs(library) or not Path(library).is_file():
        raise GraphUnavailable('libclang unavailable: ' + str(library))
    try:
        cl = Clang18Single(library)
    except (OSError, AttributeError) as error:
        raise GraphUnavailable('libclang unavailable: ' + str(error))
    with tempfile.TemporaryDirectory(prefix='platform-cpp-single-') as scratch:
        state = SingleFileLookup(cl, scratch)
        try:
            graph_emit(state.ready)
            for raw in iter(sys.stdin.readline, ''):
                if raw.strip():
                    graph_emit(state.answer(json.loads(raw)))
        finally:
            state.close()


def single_file():
    try:
        single_file_run()
    except GraphUnavailable as error:
        graph_emit({'t': 'unavailable', 'message': str(error)})
    except Exception as error:
        graph_emit({'t': 'failed', 'reason': type(error).__name__ + ': ' + str(error)[:200]})


if len(sys.argv) > 1 and sys.argv[1] == 'import_graph':
    graph_import()
elif len(sys.argv) > 1 and sys.argv[1] == 'single_file':
    single_file()
else:
    try:
        print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False))
    except (Unsupported, OSError, AttributeError) as error:
        print(json.dumps({'status': 'unsupported', 'message': str(error)}))
    except Exception as error:
        print(json.dumps({'status': 'rejected', 'message': str(error)}))
