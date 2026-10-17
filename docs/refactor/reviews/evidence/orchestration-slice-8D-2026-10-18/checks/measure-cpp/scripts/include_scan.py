"""Textual #include inventory of a workspace against a compile database (no libclang).

Usage: python3 -I include_scan.py <compile_commands.json> <workspace_root> <out.json> <sysdir>...

For every TU: walk #include directives textually from the main file through files that resolve
inside the workspace (conditionals are NOT evaluated: every directive counts). Resolution order
follows GCC/Clang: "x" -> the including file's directory, -iquote, then the <> chain; <x> -> -I
dirs, -isystem dirs, then <sysdir>... (the compiler's default dirs, only for the machine view).
Workspace view = only files inside the workspace exist (like the adapter's VFS with
-nostdinc -nostdinc++). Machine view = the real file system.
Each directive also records whether it sits under a non-guard conditional and its brace depth.
"""
import json
import os
import posixpath
import re
import shlex
import sys
from collections import defaultdict

SRC_EXT = ('.c', '.cc', '.cpp', '.cxx', '.C')
HDR_EXT = ('.h', '.hh', '.hpp', '.hxx', '.ipp', '.tpp', '.inl', '.inc')
DIRECTIVE = re.compile(r'^\s*#\s*(\w+)(.*)$')
INCLUDE = re.compile(r'^\s*([<"])([^>"]+)[>"]')


def strip_code(text):
    """Remove comments and string/char literals, keep newlines. Returns cleaned text."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            seg = text[i:n if j < 0 else j + 2]
            out.append('\n' * seg.count('\n'))
            i = n if j < 0 else j + 2
        elif c in '"\'':
            j = i + 1
            while j < n and text[j] != c and text[j] != '\n':
                j += 2 if text[j] == '\\' else 1
            out.append(c + c)
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def scan_file(path):
    with open(path, encoding='utf-8', errors='replace') as fh:
        raw = fh.read()
    # join continuation lines but keep line numbers of the first physical line
    clean = strip_code(raw)
    lines = clean.split('\n')
    directives, depth_stack, brace = [], [], 0
    first_directives = []
    guard = None
    for lineno, line in enumerate(lines, 1):
        m = DIRECTIVE.match(line)
        if m:
            name, rest = m.group(1), m.group(2)
            first_directives.append((name, rest.strip()))
            if len(first_directives) == 2 and first_directives[0][0] == 'ifndef' and first_directives[1][0] == 'define' \
                    and first_directives[0][1].split()[:1] == first_directives[1][1].split()[:1]:
                guard = 0  # the outermost #ifndef at stack index 0 is an include guard
            if name in ('if', 'ifdef', 'ifndef'):
                depth_stack.append(name)
            elif name == 'endif' and depth_stack:
                depth_stack.pop()
            elif name in ('include', 'include_next', 'import'):
                cond = len(depth_stack) - (1 if guard == 0 and depth_stack else 0)
                inc = INCLUDE.match(rest)
                # take the spelling from the raw line (strip_code blanked the string literal)
                raw_line = raw.split('\n')[lineno - 1]
                inc_raw = re.search(r'#\s*\w+\s*([<"])([^>"]+)[>"]', raw_line)
                if inc_raw:
                    directives.append({'line': lineno, 'kind': name, 'quote': inc_raw.group(1) == '"',
                                       'name': inc_raw.group(2), 'conditional_depth': cond, 'brace_depth': brace})
                else:
                    directives.append({'line': lineno, 'kind': name, 'quote': None, 'name': rest.strip(),
                                       'conditional_depth': cond, 'brace_depth': brace, 'computed': True})
            continue
        brace += line.count('{') - line.count('}')
    return directives


def parse_args(entry):
    raw = entry.get('arguments') or shlex.split(entry['command'], posix=True)
    quote, inc, sysi = [], [], []
    i = 1
    while i < len(raw):
        a = raw[i]
        for opt, dest in (('-iquote', quote), ('-isystem', sysi), ('-I', inc)):
            if a == opt:
                dest.append(posixpath.normpath(posixpath.join(entry['directory'], raw[i + 1]))); i += 1; break
            if a.startswith(opt) and opt == '-I':
                dest.append(posixpath.normpath(posixpath.join(entry['directory'], a[2:]))); break
        i += 1
    seen, chain = set(), []
    for d in inc + sysi:
        if d not in seen:
            seen.add(d); chain.append(d)
    return quote, chain


def main(argv):
    db_path, root, out, sysdirs = argv[1], posixpath.normpath(argv[2]), argv[3], argv[4:]
    entries = json.load(open(db_path, encoding='utf-8'))
    ws_files = set()
    for d, _, fs in os.walk(root):
        for f in fs:
            ws_files.add(posixpath.normpath(posixpath.join(d, f)))
    cache = {}

    def directives(path):
        if path not in cache:
            cache[path] = scan_file(path)
        return cache[path]

    def resolve(name, quote, includer, qdirs, chain, machine):
        exists = (lambda p: os.path.isfile(p)) if machine else (lambda p: p in ws_files)
        cands = []
        if quote:
            cands.append(posixpath.dirname(includer))
            cands.extend(qdirs)
        cands.extend(chain)
        if machine:
            cands.extend(sysdirs)
        for d in cands:
            p = posixpath.normpath(posixpath.join(d, name))
            if exists(p):
                return p
        return None

    per_tu = []
    reached_any = defaultdict(set)
    missing = defaultdict(lambda: {'directives': set(), 'tus': set(), 'on_machine': None, 'conditional': False})
    directive_rows = {}
    for entry in entries:
        main_file = posixpath.normpath(posixpath.join(entry['directory'], entry['file']))
        qdirs, chain = parse_args(entry)
        seen, queue = {main_file}, [main_file]
        counts = defaultdict(int)
        while queue:
            f = queue.pop(0)
            for d in directives(f):
                key = (f, d['line'])
                counts['directives'] += 1
                if d.get('computed'):
                    counts['computed'] += 1
                    directive_rows[key] = {**d, 'file': posixpath.relpath(f, root), 'ws': None, 'machine': None}
                    continue
                ws = resolve(d['name'], d['quote'], f, qdirs, chain, False)
                mach = resolve(d['name'], d['quote'], f, qdirs, chain, True)
                if ws:
                    counts['resolved_in_workspace'] += 1
                    if ws not in seen:
                        seen.add(ws); queue.append(ws)
                else:
                    counts['unresolved_in_workspace'] += 1
                    m = missing[d['name']]
                    m['directives'].add('%s:%d' % (posixpath.relpath(f, root), d['line']))
                    m['tus'].add(posixpath.relpath(main_file, root))
                    m['on_machine'] = (m['on_machine'] or False) or bool(mach)
                    m['conditional'] = m['conditional'] or d['conditional_depth'] > 0
                    counts['unresolved_on_machine_too' if not mach else 'unresolved_but_on_machine'] += 1
                directive_rows[key] = {**d, 'file': posixpath.relpath(f, root),
                                       'ws': posixpath.relpath(ws, root) if ws else None,
                                       'machine': mach}
        rel = sorted(posixpath.relpath(p, root) for p in seen)
        for p in rel:
            reached_any[p].add(posixpath.relpath(main_file, root))
        per_tu.append({'tu': posixpath.relpath(main_file, root), 'workspace_files_reached': len(rel),
                       'headers_reached': len([p for p in rel if p != posixpath.relpath(main_file, root)]),
                       **counts})
    ws_rel = sorted(posixpath.relpath(p, root) for p in ws_files)
    headers = [p for p in ws_rel if p.endswith(HDR_EXT)]
    sources = [p for p in ws_rel if p.endswith(SRC_EXT)]
    tus = {posixpath.relpath(posixpath.normpath(posixpath.join(e['directory'], e['file'])), root) for e in entries}
    groups = defaultdict(lambda: {'names': 0, 'directives': 0, 'on_machine': 0, 'absent': 0, 'conditional': 0})
    for name, m in missing.items():
        top = name.split('/')[0] + '/' if '/' in name else ('<C++ std, no extension>' if '.' not in name else name)
        g = groups[top]
        g['names'] += 1; g['directives'] += len(m['directives'])
        g['on_machine' if m['on_machine'] else 'absent'] += 1
        g['conditional'] += 1 if m['conditional'] else 0
    result = {
        'workspace_root': root,
        'tu_entries': len(entries), 'tu_distinct': len(tus),
        'workspace_sources': len(sources), 'sources_not_in_db': sorted(set(sources) - tus),
        'workspace_headers': len(headers),
        'headers_reached_by_some_tu': sorted(h for h in headers if h in reached_any),
        'headers_not_reached': sorted(h for h in headers if h not in reached_any),
        'per_tu': per_tu,
        'missing_includes': {k: {'directives': sorted(v['directives']), 'tus': len(v['tus']), 'on_machine': v['on_machine'],
                                 'any_under_conditional': v['conditional']} for k, v in sorted(missing.items())},
        'missing_groups': dict(sorted(groups.items())),
        'directives_under_conditional': [r for r in directive_rows.values() if r['conditional_depth'] > 0],
        'directives_inside_braces': [r for r in directive_rows.values() if r['brace_depth'] > 0],
        'computed_includes': [r for r in directive_rows.values() if r.get('computed')],
    }
    json.dump(result, open(out, 'w', encoding='utf-8', newline='\n'), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in result.items()
                      if k not in ('per_tu', 'missing_includes', 'missing_groups')}, indent=1))
    print('missing groups:')
    for k, g in sorted(groups.items(), key=lambda kv: -kv[1]['directives']):
        print('  %-40s names=%d directives=%d on_machine=%d absent=%d under_cond=%d' % (k, g['names'], g['directives'], g['on_machine'], g['absent'], g['conditional']))


if __name__ == '__main__':
    main(sys.argv)
