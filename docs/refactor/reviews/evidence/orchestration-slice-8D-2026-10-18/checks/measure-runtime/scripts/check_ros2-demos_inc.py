#!/usr/bin/env python3
"""Checker (ros2-demos): an independent textual #include resolver, compared with the prototype's light output.

Run only as: python3 -I check_ros2-demos_inc.py SRC DB_JSON GIT_LIST_Z LIGHT_NDJSON OUT_JSON
  SRC          workspace root (data only)
  DB_JSON      output of check_ros2-demos_db.py (units = first entry per distinct source main file)
  GIT_LIST_Z   NUL-separated git-not-ignored paths (made by the checker's own git ls-files call)
  LIGHT_NDJSON the prototype's light-mode output (the thing under test; only read)
Method (not the prototype's): read each workspace file as text, strip comments, find every #include line,
resolve the spelling with GCC's search order using the unit's REAL flags plus the compiler's default system
dirs (so the target is where the compiler would find it, system headers included), and walk only into
workspace files. No conditional evaluation: directives inside #if blocks other than the include guard are
listed separately. Then compare per directive site with the prototype.
"""
import collections
import json
import os
import re
import sys

CLAIMED = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}
SYS_CXX = ['/usr/include/c++/13', '/usr/include/x86_64-linux-gnu/c++/13', '/usr/include/c++/13/backward',
           '/usr/lib/gcc/x86_64-linux-gnu/13/include', '/usr/local/include', '/usr/include/x86_64-linux-gnu', '/usr/include']
SYS_C = ['/usr/lib/gcc/x86_64-linux-gnu/13/include', '/usr/local/include', '/usr/include/x86_64-linux-gnu', '/usr/include']
INC_RE = re.compile(r'^[ \t]*#[ \t]*include(_next)?[ \t]*(.*)$')
COND_RE = re.compile(r'^[ \t]*#[ \t]*(if|ifdef|ifndef|elif|else|endif)\b(.*)$')


def strip_comments(text):
    out, i, n = [], 0, len(text)
    in_block = in_line = in_str = False
    q = ''
    while i < n:
        c = text[i]
        if in_block:
            if text.startswith('*/', i):
                in_block = False
                i += 2
                continue
            out.append('\n' if c == '\n' else ' ')
        elif in_line:
            if c == '\n':
                in_line = False
                out.append(c)
            else:
                out.append(' ')
        elif in_str:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == q or c == '\n':
                in_str = False
        else:
            if text.startswith('/*', i):
                in_block = True
                out.append('  ')
                i += 2
                continue
            if text.startswith('//', i):
                in_line = True
                out.append('  ')
                i += 2
                continue
            if c in '"\'':
                # a quote on an #include line is the spelling, keep scanning it as text
                line_start = text.rfind('\n', 0, i) + 1
                if INC_RE.match(text[line_start:i] + 'x"') is None:
                    in_str = True
                    q = c
            out.append(c)
        i += 1
    return ''.join(out)


def parse_args(args, directory):
    quote, ang, sysd, incl = [], [], [], []
    i = 1
    while i < len(args):
        a = args[i]
        def val(flag):
            nonlocal i
            if a == flag:
                i += 1
                return args[i]
            return a[len(flag):]
        if a.startswith('-iquote'):
            quote.append(os.path.normpath(os.path.join(directory, val('-iquote'))))
        elif a.startswith('-isystem'):
            sysd.append(os.path.normpath(os.path.join(directory, val('-isystem'))))
        elif a.startswith('-I'):
            ang.append(os.path.normpath(os.path.join(directory, val('-I'))))
        elif a == '-include':
            i += 1
            incl.append(args[i])
        i += 1
    # GCC drops -I/-isystem duplicates, and a -I dir also given as -isystem is treated as system (kept in system slot)
    seen, ang2 = set(), []
    for d in ang:
        if d not in seen and d not in sysd:
            seen.add(d)
            ang2.append(d)
    sys2 = []
    for d in sysd:
        if d not in seen:
            seen.add(d)
            sys2.append(d)
    return quote, ang2, sys2, incl


def scan_file(path, cache):
    if path in cache:
        return cache[path]
    text = open(path, encoding='utf-8', errors='replace').read()
    text = strip_comments(text)
    lines = text.split('\n')
    sites = []
    depth = 0
    guard_pending = None
    first_cond_is_guard = False
    cond_lines = []
    stack = []
    for no, line in enumerate(lines, 1):
        m = COND_RE.match(line)
        if m:
            kw, rest = m.group(1), m.group(2).strip()
            if kw in ('if', 'ifdef', 'ifndef'):
                is_guard = False
                if kw == 'ifndef' and not stack and not sites and guard_pending is None and not first_cond_is_guard:
                    nxt = next((l for l in lines[no:no + 3] if l.strip()), '')
                    if re.match(r'^[ \t]*#[ \t]*define[ \t]+' + re.escape(rest.split()[0]) + r'\b', nxt or ''):
                        is_guard = True
                        first_cond_is_guard = True
                stack.append((kw, rest, no, is_guard))
            elif kw == 'endif' and stack:
                stack.pop()
            continue
        m = INC_RE.match(line)
        if m:
            spec = m.group(2).strip()
            mm = re.match(r'^(<[^>]*>|"[^"]*")', spec)
            conds = [(k, r, n) for (k, r, n, g) in stack if not g]
            sites.append({'line': no, 'raw': spec, 'spec': mm.group(1) if mm else None, 'next': bool(m.group(1)),
                          'conds': conds})
    cache[path] = sites
    return sites


def resolve(spec, includer_dir, quote, ang, sysd, sysdefault):
    name = spec[1:-1]
    order = []
    if spec[0] == '"':
        order.append(includer_dir)
        order += quote
    order += ang + sysd + sysdefault
    for d in order:
        p = os.path.normpath(os.path.join(d, name))
        if os.path.isfile(p):
            return p
    return None


def main():
    src, db_json, git_z, light_nd, out = sys.argv[1:6]
    db = json.load(open(db_json))
    ws = set(p.decode() for p in open(git_z, 'rb').read().split(b'\0') if p)
    claimed = sorted(p for p in ws if os.path.splitext(p)[1].lower() in CLAIMED)
    cache = {}
    sites = {}        # (rel, line) -> dict
    reached = set()
    per_unit_reached = {}
    for u in db['units']:
        args = u['args']
        is_c = os.path.basename(args[0]) in ('cc', 'gcc')
        sysdef = SYS_C if is_c else SYS_CXX
        quote, ang, sysd, incl = parse_args(args, u['directory'])
        todo = [u['file']]
        seen = set()
        while todo:
            f = todo.pop()
            if f in seen:
                continue
            seen.add(f)
            rel = os.path.relpath(f, src)
            reached.add(rel)
            for s in scan_file(f, cache):
                key = (rel, s['line'])
                if s['spec'] is None:
                    tgt = None
                    kind = 'macro-or-malformed'
                else:
                    tgt = resolve(s['spec'], os.path.dirname(f), quote, ang, sysd, sysdef)
                    if tgt is None:
                        kind = 'not-found'
                    elif tgt.startswith(src + '/') and os.path.relpath(tgt, src) in ws:
                        kind = 'workspace'
                    else:
                        kind = 'external'
                rec = sites.setdefault(key, {'file': rel, 'line': s['line'], 'spec': s['spec'] or s['raw'], 'targets': {},
                                             'conds': s['conds']})
                tkey = os.path.relpath(tgt, src) if kind == 'workspace' else (tgt or kind)
                rec['targets'][tkey] = rec['targets'].get(tkey, 0) + 1
                rec.setdefault('kinds', set()).add(kind)
                if kind == 'workspace':
                    todo.append(tgt)
        per_unit_reached[u['rel']] = sorted(os.path.relpath(x, src) for x in seen)
    # classify
    edges = {k: v for k, v in sites.items() if 'workspace' in v['kinds']}
    unres = {k: v for k, v in sites.items() if 'workspace' not in v['kinds']}
    multi = {k: v for k, v in sites.items() if len(v['targets']) > 1}

    def ext_class(v):
        t = next(iter(v['targets']))
        if t in ('not-found', 'macro-or-malformed'):
            return t
        if '/usr/include/c++/' in t or '/usr/include/x86_64-linux-gnu/c++/' in t:
            return 'C/C++ standard library'
        if t.startswith('/opt/ros/jazzy/'):
            return 'ROS (/opt/ros/jazzy)'
        if '/opencv4/' in t:
            return 'opencv4'
        if '/build/ros2-demos/' in t:
            return 'build dir (generated)'
        if t.startswith('/usr/'):
            return 'system / libc'
        return 'other:' + t
    uclass = collections.Counter(ext_class(v) for v in unres.values())
    # unresolved that name a workspace interface package (msg/srv/action of a package in this repo)
    ws_iface_pkgs = {'action_tutorials_interfaces', 'logging_demo', 'pendulum_msgs'}
    iface = [v for v in unres.values() if v['spec'] and re.match(r'^["<](%s)/(msg|srv|action)/' % '|'.join(ws_iface_pkgs), v['spec'])]
    iface_where = collections.Counter(ext_class(v) for v in iface)
    edge_pairs = set((v['file'], next(iter(v['targets']))) for v in edges.values())
    dir_pairs = set((os.path.dirname(a), os.path.dirname(b)) for a, b in edge_pairs if os.path.dirname(a) != os.path.dirname(b))
    vis = sum(1 for a, b in edge_pairs if os.path.basename(b) == 'visibility_control.h')
    conds = [v for v in sites.values() if v['conds']]
    claimed_reached = [p for p in claimed if p in reached]
    claimed_not = [p for p in claimed if p not in reached]
    # ---- compare with the prototype (light) per directive site ----
    proto_edges, proto_unres, proto_status = set(), set(), collections.Counter()
    proto_claim = collections.Counter()
    proto_units = 0
    for line in open(light_nd):
        o = json.loads(line)
        proto_status[o.get('status')] += 1
        if 'inclusions' not in o:
            continue
        proto_units += 1
        for inc in o['inclusions']:
            src_rel = os.path.relpath(inc['file'], src)
            ln = inc['line']
            spec = (inc['delim'] + inc['spelled'] + ('>' if inc['delim'] == '<' else '"')) if inc.get('delim') else inc.get('text')
            if inc.get('resolved'):
                proto_edges.add((src_rel, ln, os.path.relpath(inc['resolved'], src)))
            else:
                proto_unres.add((src_rel, ln, spec))
            proto_claim[inc.get('kind')] += 1
    mine_e = set((v['file'], v['line'], next(iter(v['targets']))) for v in edges.values())
    mine_u = set((v['file'], v['line'], v['spec']) for v in unres.values())
    res = {
        'units': len(db['units']), 'claimed': len(claimed), 'claimed_reached': len(claimed_reached),
        'claimed_not_reached': claimed_not,
        'directive_sites': len(sites), 'edge_sites': len(edges), 'edge_file_pairs': len(edge_pairs),
        'edge_dir_pairs_excl_same': len(dir_pairs), 'edge_pairs_to_visibility_control': vis,
        'unresolved_sites': len(unres), 'unresolved_class': dict(uclass),
        'unresolved_naming_ws_interface_pkg': len(iface), 'ws_interface_found_in': dict(iface_where),
        'sites_with_more_than_one_target_across_units': len(multi),
        'macro_or_malformed': [v for v in sites.values() if v['spec'] is None or not re.match(r'^[<"]', v['spec'] or '')],
        'sites_inside_non_guard_conditionals': [(v['file'], v['line'], v['spec'], v['conds']) for v in conds],
        'quoted_unresolved_that_resolve_to_workspace_basename': [],
        'proto_status': dict(proto_status), 'proto_units_with_inclusions': proto_units,
        'proto_edge_triples': len(proto_edges), 'proto_unres': len(proto_unres),
        'edge_triples_only_mine': sorted(mine_e - proto_edges)[:50], 'edge_triples_only_proto': sorted(proto_edges - mine_e)[:50],
        'unres_only_mine': sorted(mine_u - proto_unres, key=str)[:30], 'unres_only_proto': sorted(proto_unres - mine_u, key=str)[:30],
    }
    base = collections.defaultdict(list)
    for p in ws:
        base[os.path.basename(p)].append(p)
    for v in unres.values():
        if v['spec'] and v['spec'][0] in '"<':
            nm = os.path.basename(v['spec'][1:-1])
            if nm in base:
                res['quoted_unresolved_that_resolve_to_workspace_basename'].append((v['file'], v['line'], v['spec'], base[nm]))
    json.dump(res, open(out, 'w'), indent=1, default=list)
    json.dump({'edges': sorted([v['file'], v['line'], v['spec'], next(iter(v['targets']))] for v in edges.values()),
               'unresolved': sorted([v['file'], v['line'], v['spec'], next(iter(v['targets'])), ext_class(v)] for v in unres.values()),
               'reached': sorted(reached), 'per_unit_reached': per_unit_reached},
              open(out.replace('.json', '.detail.json'), 'w'), indent=0)
    for k, v in res.items():
        s = json.dumps(v, ensure_ascii=False, default=list)
        print(k, s if len(s) < 1500 else s[:1500] + ' ...')


if __name__ == '__main__':
    main()
