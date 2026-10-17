#!/usr/bin/env python3
"""Checker (independent of the measuring agent): re-derive the SLAM copy's C/C++ include edges with a
plain-text resolver, and compare with the light include scan output (the prototype = thing under test).

Own method: no libclang. For every compile-database entry, take the in-workspace search dirs
(-I/-iquote/-isystem/-idirafter, joined or separate), walk #include lines from the main file through
workspace files (comments removed, ALL conditional branches taken), resolve like GCC/clang
(quoted: includer's dir, then -iquote, then -I/-isystem/-idirafter; angled: -I/-isystem/-idirafter),
a hit only if the normalized path is one of the workspace files. Edges = distinct (from, to);
unresolved = distinct (from, spelled-with-delims) that never resolved in any TU.

Usage: python3 -I check_slam_include.py <root> <compile_commands.json> <cpp-light.ndjson> <out.json>
"""
import json, os, posixpath, re, shlex, sys, collections

root, dbp, lightp, outp = sys.argv[1:5]
root = os.path.normpath(root)

files = set()
for dp, dns, fns in os.walk(root):
    for fn in fns:
        files.add(os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, '/'))

def rel(p):
    p = os.path.normpath(p)
    if p == root or p.startswith(root + os.sep):
        return os.path.relpath(p, root).replace(os.sep, '/')
    return None

def strip_comments(text):
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            if j < 0:
                break
            i = j
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            seg = text[i:(j + 2 if j >= 0 else n)]
            out.append('\n' * seg.count('\n'))
            i = (j + 2) if j >= 0 else n
            continue
        if c in '"\'':
            # keep string literal as is (avoid treating // inside strings as comment)
            j = i + 1
            while j < n and text[j] != c and text[j] != '\n':
                if text[j] == '\\':
                    j += 1
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)

INC = re.compile(r'^[ \t]*#[ \t]*(include|include_next|import)[ \t]*([<"])([^>"\n]+)[>"]', re.M)
MACRO_INC = re.compile(r'^[ \t]*#[ \t]*include[ \t]+([A-Za-z_][A-Za-z0-9_]*)', re.M)

cache = {}
def directives(relpath):
    if relpath in cache:
        return cache[relpath]
    with open(os.path.join(root, relpath), 'rb') as f:
        t = f.read().decode('utf-8', 'replace')
    t = strip_comments(t)
    res = []
    for m in INC.finditer(t):
        line = t.count('\n', 0, m.start()) + 1
        res.append((line, m.group(2), m.group(3).strip()))
    macros = []
    for m in MACRO_INC.finditer(t):
        line = t.count('\n', 0, m.start()) + 1
        macros.append((line, m.group(1)))
    cache[relpath] = (res, macros)
    return cache[relpath]

def parse_args(entry):
    args = entry.get('arguments') or shlex.split(entry['command'])
    d = entry['directory']
    quote, inc, sysd, after = [], [], [], []
    outside = []
    i = 1
    while i < len(args):
        a = args[i]
        for flag, lst in (('-iquote', quote), ('-isystem', sysd), ('-idirafter', after), ('-I', inc)):
            if a == flag or (a.startswith(flag) and len(a) > len(flag)):
                if a == flag:
                    v = args[i + 1]; i += 1
                else:
                    v = a[len(flag):]
                p = v if os.path.isabs(v) else os.path.join(d, v)
                r = rel(p)
                if r is None:
                    outside.append(os.path.normpath(p))
                else:
                    lst.append(r)
                break
        i += 1
    return quote, inc, sysd, after, outside

def lookup(dirs, spec):
    for d in dirs:
        cand = posixpath.normpath(posixpath.join(d, spec)) if d not in ('', '.') else posixpath.normpath(spec)
        if cand in files:
            return cand
    return None

db = json.load(open(dbp))
edges_tu = collections.defaultdict(set)      # (from,to) -> tus
unres_tu = collections.defaultdict(set)      # (from,spec) -> tus
edge_spec = set()                             # (from,spec) that resolved somewhere
macro_includes = []
reached = collections.Counter()
outside_dirs = set()
per_tu = []
for idx, e in enumerate(db):
    main = rel(e['file'] if os.path.isabs(e['file']) else os.path.join(e['directory'], e['file']))
    quote, inc, sysd, after, outside = parse_args(e)
    outside_dirs.update(outside)
    angled = inc + sysd + after
    seen = set([main])
    stack = [main]
    tu_edges = set()
    while stack:
        f = stack.pop()
        reached[f] += 0
        dirs, macros = directives(f)
        for line, delim, spec in dirs:
            if delim == '"':
                to = lookup([posixpath.dirname(f)] + quote + angled, spec)
            else:
                to = lookup(angled, spec)
            sp = ('<%s>' if delim == '<' else '"%s"') % spec
            if to is None:
                unres_tu[(f, sp)].add(idx)
            else:
                edge_spec.add((f, sp))
                if to != f:
                    edges_tu[(f, to)].add(idx)
                    tu_edges.add((f, to))
                if to not in seen:
                    seen.add(to); stack.append(to)
        for line, name in macros:
            macro_includes.append((f, line, name))
    for f in seen:
        reached[f] += 1
    per_tu.append({'tu': main, 'files_reached': len(seen), 'edges': len(tu_edges)})

edges = set(edges_tu)
unres = set(k for k in unres_tu if k not in edge_spec)

# ---- the light scan output (thing under test) ----
L_edges, L_spec_edge, L_unres = set(), set(), set()
L_status = collections.Counter()
L_entered = set()
L_ms = []
L_fail_diag = []
for line in open(lightp):
    o = json.loads(line)
    L_status[o['status']] += 1
    L_ms.append(o.get('elapsed_ms') or 0)
    for p in o.get('entered_project') or []:
        r = rel(p)
        if r: L_entered.add(r)
    for inc_ in o.get('inclusions') or []:
        fr = rel(inc_['file'])
        if fr is None:
            continue
        sp = ('<%s>' if inc_.get('delim') == '<' else '"%s"') % inc_['spelled']
        to = rel(inc_['resolved']) if inc_.get('resolved') else None
        if to is not None and to in files:
            L_spec_edge.add((fr, sp))
            if to != fr:
                L_edges.add((fr, to))
        else:
            L_unres.add((fr, sp))
    for d in o.get('diagnostics') or []:
        fr = rel(d['file']) if d.get('file') else None
        if fr and d.get('severity', 0) >= 3 and d.get('category') == 'Lexical or Preprocessor Issue':
            s = d.get('spelling', '')
            if 'file not found' in s or 'expected "FILENAME"' in s:
                continue
            L_fail_diag.append((o['tu_rel'], fr, d.get('line'), s[:200]))
L_unres = set(k for k in L_unres if k not in L_spec_edge)

def cat(spec):
    return 'ros-interface' if re.search(r'^[<"][A-Za-z0-9_]+/(msg|srv|action)/', spec) else 'other'

def pkg(p):
    m = re.match(r'ros2_ws/src/([^/]+)/', p)
    return m.group(1) if m else '(root)'

cross = collections.Counter()
for a, b in edges:
    if pkg(a) != pkg(b):
        cross['%s->%s' % (pkg(a), pkg(b))] += 1
Lcross = collections.Counter()
for a, b in L_edges:
    if pkg(a) != pkg(b):
        Lcross['%s->%s' % (pkg(a), pkg(b))] += 1

cpp_ext = ('.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp')
cpp_files = sorted(f for f in files if f.lower().endswith(cpp_ext))
endpoints = set(a for a, _ in edges) | set(b for _, b in edges)
Lendpoints = set(a for a, _ in L_edges) | set(b for _, b in L_edges)

out = {
    'workspace_files': len(files),
    'cpp_files': len(cpp_files),
    'tus': len(db),
    'outside_search_dirs_distinct': len(outside_dirs),
    'own': {
        'edges': len(edges), 'unresolved': len(unres),
        'unresolved_ros_interface': sum(1 for _, s in unres if cat(s) == 'ros-interface'),
        'cross_package': dict(cross),
        'cpp_files_with_edge': len([f for f in cpp_files if f in endpoints]),
        'cpp_files_reached': len([f for f in cpp_files if reached.get(f)]),
        'cpp_files_not_reached': sorted(f for f in cpp_files if not reached.get(f)),
        'macro_includes': macro_includes,
    },
    'light': {
        'status': dict(L_status), 'sum_elapsed_ms': round(sum(L_ms), 1),
        'edges': len(L_edges), 'unresolved': len(L_unres),
        'unresolved_ros_interface': sum(1 for _, s in L_unres if cat(s) == 'ros-interface'),
        'cross_package': dict(Lcross),
        'cpp_files_with_edge': len([f for f in cpp_files if f in Lendpoints]),
        'cpp_files_entered': len([f for f in cpp_files if f in L_entered]),
        'failure_rule_diagnostics': L_fail_diag,
    },
    'diff': {
        'edges_only_own': sorted(edges - L_edges), 'edges_only_light': sorted(L_edges - edges),
        'unres_only_own': sorted(unres - L_unres), 'unres_only_light': sorted(L_unres - unres),
        'cpp_without_edge_own': sorted(f for f in cpp_files if f not in endpoints),
    },
    'edges_sorted': sorted(edges), 'unresolved_sorted': sorted(unres),
    'per_tu': per_tu,
}
json.dump(out, open(outp, 'w'), indent=1, ensure_ascii=False)
s = dict(out); s.pop('edges_sorted'); s.pop('unresolved_sorted'); s.pop('per_tu')
s['own'] = dict(s['own']); s['own']['macro_includes'] = len(out['own']['macro_includes'])
print(json.dumps(s, indent=1, ensure_ascii=False))
