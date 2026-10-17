#!/usr/bin/env python3
"""Checker (ros2-demos): independent inventory of ROS 2 communication call sites and the static name graph.

Run only as: python3 -I check_ros2-demos_comm.py SRC GIT_LIST_Z INC_DETAIL_JSON PY_PKG_JSON_DIR HAND_JSON OUT_JSON
  SRC              workspace root (data only)
  GIT_LIST_Z       git-not-ignored paths
  INC_DETAIL_JSON  checker's own C/C++ edges (check_ros2-demos_inc.py), which equal the prototype's 90
  PY_PKG_JSON_DIR  dir with the checker's per-package Python results (py-pkg-*.json) for the 4 Python edges
  HAND_JSON        the CHECKER's own hand resolution of non-literal names (written after reading each site)
Method: comments stripped (C/C++ by a small lexer; Python by tokenize), call sites found by name, the argument
list split at top-level commas, the name argument taken by position (C++ create_*<T>(name, ...): 1st;
rclcpp_action::create_*(node, name): 2nd; Python node.create_*(Type, name, ...): 2nd; ActionServer/ActionClient
(node, Type, name): 3rd). String literal -> literal; identifier assigned a string literal once in the same file
-> same-file constant; everything else looked up in HAND_JSON by file:line.
"""
import collections
import io
import json
import os
import re
import sys
import tokenize

INC_RE = re.compile(r'^[ \t]*#[ \t]*include(_next)?[ \t]*(.*)$')


def strip_c_comments(text):
    """Blank out // and /* */ comments, keep string literals and line numbers (same lexer as check_ros2-demos_inc.py)."""
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
                line_start = text.rfind('\n', 0, i) + 1
                if INC_RE.match(text[line_start:i] + 'x"') is None:
                    in_str = True
                    q = c
            out.append(c)
        i += 1
    return ''.join(out)

CPP_EXT = ('.cpp', '.hpp', '.h', '.cc', '.c')
CALL_CPP = re.compile(r'\b(rclcpp_action::create_server|rclcpp_action::create_client|create_publisher|create_subscription|create_service|create_client)\b')
CALL_PY = re.compile(r'\b(create_lifecycle_publisher|create_publisher|create_subscription|create_service|create_client|ActionServer|ActionClient)\s*\(')


def split_args(text, start):
    """text[start] == '('; return (list of top-level args, end index)."""
    depth = 0
    args, cur = [], []
    i = start
    in_s = None
    while i < len(text):
        c = text[i]
        if in_s:
            cur.append(c)
            if c == '\\':
                cur.append(text[i + 1])
                i += 2
                continue
            if c == in_s:
                in_s = None
        elif c in '"\'':
            in_s = c
            cur.append(c)
        elif c in '([{':
            depth += 1
            if depth > 1:
                cur.append(c)
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                args.append(''.join(cur).strip())
                return args, i
            cur.append(c)
        elif c == ',' and depth == 1:
            args.append(''.join(cur).strip())
            cur = []
        else:
            if depth >= 1:
                cur.append(c)
        i += 1
    return args, i


def skip_template(text, i):
    """at text[i] == '<' skip a balanced template argument list; return index after it and the inside."""
    depth = 0
    j = i
    while j < len(text):
        if text[j] == '<':
            depth += 1
        elif text[j] == '>':
            depth -= 1
            if depth == 0:
                return j + 1, text[i + 1:j]
        j += 1
    return i, ''


def py_strip(src):
    out = []
    toks = tokenize.generate_tokens(io.StringIO(src).readline)
    lines = src.split('\n')
    drop = set()
    for t in toks:
        if t.type == tokenize.COMMENT:
            drop.add((t.start[0], t.start[1]))
    res = []
    for no, l in enumerate(lines, 1):
        cut = [c for (r, c) in drop if r == no]
        res.append(l[:cut[0]] if cut else l)
    return '\n'.join(res)


def main():
    src, gz, inc_detail, pydir, hand_json, out = sys.argv[1:7]
    with_extra = '--extra' in sys.argv[7:]
    files = sorted(p.decode() for p in open(gz, 'rb').read().split(b'\0') if p)
    hand_all = json.load(open(hand_json))
    hand = hand_all['sites']
    implicit = [x for x in hand_all['implicit'] if with_extra or not x.get('extra')]
    sites = []
    for f in files:
        if not (f.endswith(CPP_EXT) or f.endswith('.py')):
            continue
        raw = open(os.path.join(src, f), encoding='utf-8', errors='replace').read()
        is_py = f.endswith('.py')
        text = py_strip(raw) if is_py else strip_c_comments(raw)
        rx = CALL_PY if is_py else CALL_CPP
        for m in rx.finditer(text):
            fn = m.group(1)
            i = m.end()
            line = text.count('\n', 0, m.start()) + 1
            # skip definitions / declarations: preceded by 'def ' or a type return like 'Ptr create_'
            pre = text[max(0, m.start() - 40):m.start()]
            if is_py and re.search(r'def\s+$', pre):
                continue
            tmpl = ''
            if not is_py:
                while i < len(text) and text[i] in ' \t\n':
                    i += 1
                if i < len(text) and text[i] == '<':
                    i, tmpl = skip_template(text, i)
                while i < len(text) and text[i] in ' \t\n':
                    i += 1
            else:
                i = m.end() - 1
            if i >= len(text) or text[i] != '(':
                sites.append({'file': f, 'line': line, 'fn': fn, 'skip': 'no call paren', 'ctx': text[m.start():m.start() + 60]})
                continue
            args, _ = split_args(text, i)
            if is_py:
                kind = {'create_publisher': ('topic', 'pub'), 'create_lifecycle_publisher': ('topic', 'pub'),
                        'create_subscription': ('topic', 'sub'),
                        'create_service': ('service', 'server'), 'create_client': ('service', 'client'),
                        'ActionServer': ('action', 'server'), 'ActionClient': ('action', 'client')}[fn]
                pos = 2 if fn.startswith('Action') else 1
                typ = args[pos - 1] if len(args) >= pos else None
                # keyword forms
                kw = {a.split('=', 1)[0].strip(): a.split('=', 1)[1].strip() for a in args if re.match(r'^\w+\s*=[^=]', a)}
                namearg = kw.get('topic') or kw.get('srv_name') or kw.get('action_name') or (args[pos] if len(args) > pos else None)
            else:
                kind = {'create_publisher': ('topic', 'pub'), 'create_subscription': ('topic', 'sub'),
                        'create_service': ('service', 'server'), 'create_client': ('service', 'client'),
                        'rclcpp_action::create_server': ('action', 'server'), 'rclcpp_action::create_client': ('action', 'client')}[fn]
                pos = 1 if fn.startswith('rclcpp_action') else 0
                typ = tmpl.strip() or None
                namearg = args[pos] if len(args) > pos else None
            sites.append({'file': f, 'line': line, 'fn': fn, 'lang': 'py' if is_py else 'cpp', 'kind': kind[0], 'role': kind[1],
                          'type': typ, 'namearg': namearg, 'nargs': len(args)})
    # name status
    for s in sites:
        if 'skip' in s:
            continue
        a = s['namearg'] or ''
        key = '%s:%d' % (s['file'], s['line'])
        lit = re.fullmatch(r'"([^"]*)"|\'([^\']*)\'', a)
        if key in hand:
            s['status'] = 'hand: ' + hand[key]['status']
            s['names'] = hand[key]['names']
        elif lit:
            s['status'] = 'literal'
            s['names'] = [lit.group(1) if lit.group(1) is not None else lit.group(2)]
        else:
            ident = re.fullmatch(r'[A-Za-z_][\w:.]*', a)
            raw = open(os.path.join(src, s['file']), encoding='utf-8', errors='replace').read()
            vals = []
            if ident:
                nm = a.split('.')[-1].split('::')[-1]
                vals = re.findall(r'\b' + re.escape(nm) + r'\s*(?:\[\])?\s*(?:=|\{|\()\s*"([^"]*)"', raw) + \
                    re.findall(r'\b' + re.escape(nm) + r'\s*=\s*\'([^\']*)\'', raw)
            if ident and len(set(vals)) == 1:
                s['status'] = 'same-file constant'
                s['names'] = vals[:1]
            else:
                s['status'] = 'UNRESOLVED (needs hand)'
                s['names'] = []
    # ----- graph -----
    good = [s for s in sites if 'skip' not in s]
    def norm(n):
        return n.lstrip('/')
    prov = collections.defaultdict(list)
    cons = collections.defaultdict(list)
    for s in good:
        for n in s.get('names', []):
            k = (s['kind'], norm(n))
            if s['role'] in ('pub', 'server'):
                prov[k].append(s)
            else:
                cons[k].append(s)
    # implicit endpoints from the checker's hand table (lifecycle / logger services)
    implicit_endpoints = 0
    for v in implicit:
        f, ln = v['file'], v['line']
        for kind_, names in (('service', v['services']), ('topic', v['topics'])):
            for n in names:
                implicit_endpoints += 1
                prov[(kind_, norm(n))].append({'file': f, 'line': ln, 'type': v.get('type'), 'implicit': True,
                                               'lang': 'cpp' if f.endswith(CPP_EXT) else 'py'})

    def tnorm(t):
        if not t:
            return None
        t = t.replace('::', '/').replace(' ', '')
        t = re.sub(r'\.', '/', t)
        parts = t.split('/')
        last = parts[-1] if parts else t
        # image_tools' type adapter is adapted to sensor_msgs/msg/Image (cv_mat_sensor_msgs_image_type_adapter.hpp)
        if last == 'ROSCvMatContainer':
            return 'Image'
        if last in ('topic_type',):  # topic_monitor: type found at run time
            return None
        return last
    pairs = []
    mismatch = []
    for k in set(prov) | set(cons):
        for p in prov.get(k, []):
            for c in cons.get(k, []):
                tp, tc = tnorm(p.get('type')), tnorm(c.get('type'))
                if tp and tc and tp != tc and not p.get('implicit'):
                    mismatch.append((p['file'], c['file'], k[1], tp, tc))
                    continue
                pairs.append((p['file'], p['line'], c['file'], c['line'], k))
    file_pairs = set()
    for a, _, b, _, k in pairs:
        if a != b:
            file_pairs.add(tuple(sorted((a, b))))
    pkg_dirs = sorted((os.path.dirname(p) for p in files if p.endswith('package.xml')), key=len, reverse=True)

    def pkg_of(p):
        for d in pkg_dirs:
            if p.startswith(d + '/'):
                return d
        return '.'
    # light graph
    det = json.load(open(inc_detail))
    E = set((e[0], e[3]) for e in det['edges'])
    for fn in os.listdir(pydir):
        if fn.startswith('py-pkg-') and fn.endswith('.json'):
            o = json.load(open(os.path.join(pydir, fn)))
            wsrel = os.path.relpath(o['workspace'], src)
            for a, b in o['edge_list']:
                E.add((os.path.normpath(os.path.join(wsrel, a)), os.path.normpath(os.path.join(wsrel, b))))
    succ = collections.defaultdict(set)
    for a, b in E:
        succ[a].add(b)

    def reach(a):
        seen, todo = set(), [a]
        while todo:
            x = todo.pop()
            for y in succ.get(x, ()):
                if y not in seen:
                    seen.add(y)
                    todo.append(y)
        return seen
    R = {}
    def r(a):
        if a not in R:
            R[a] = reach(a)
        return R[a]
    stats = collections.Counter()
    shared = []
    nopath = []
    for a, b in sorted(file_pairs):
        direct = (a, b) in E or (b, a) in E
        path = b in r(a) or a in r(b)
        sh = (r(a) | {a}) & (r(b) | {b})
        sh_nv = {x for x in sh if os.path.basename(x) != 'visibility_control.h'}
        stats['pairs'] += 1
        stats['direct'] += direct
        stats['directed_path'] += path
        stats['shared_any'] += bool(sh)
        stats['shared_non_visibility'] += bool(sh_nv)
        if sh_nv:
            shared.append((a, b, sorted(sh_nv)))
        if not direct and not path and not sh_nv:
            nopath.append((a, b))
    langs = collections.Counter()
    for a, b in file_pairs:
        la, lb = a.endswith('.py'), b.endswith('.py')
        langs['cross-language' if la != lb else ('py-py' if la else 'cpp-cpp')] += 1
    res = {
        'sites': len(good), 'skipped_matches': [s for s in sites if 'skip' in s],
        'by_lang_kind_role': {'%s/%s/%s' % k: v for k, v in collections.Counter((s['lang'], s['kind'], s['role']) for s in good).items()},
        'by_status': dict(collections.Counter(s['status'] for s in good)),
        'unresolved_sites': [(s['file'], s['line'], s['fn'], s['namearg']) for s in good if s['status'].startswith('UNRESOLVED')],
        'implicit_endpoints': implicit_endpoints, 'with_extra': with_extra,
        'same_package_pairs': sum(1 for a, b in file_pairs if pkg_of(a) == pkg_of(b)),
        'different_package_pairs': sum(1 for a, b in file_pairs if pkg_of(a) != pkg_of(b)),
        'package_pairs_with_light_edge': sorted(set((pkg_of(a), pkg_of(b)) for a, b in E if pkg_of(a) != pkg_of(b))),
        'names': len(set(prov) | set(cons)), 'site_pairs': len(pairs), 'type_mismatch': mismatch,
        'file_pairs': len(file_pairs), 'file_pairs_by_lang': dict(langs), 'light_edges_used': len(E),
        'connectivity': dict(stats), 'shared_non_visibility': shared, 'no_path': len(nopath),
        'per_name': sorted('%s %s %d/%d' % (k[0], k[1], len(prov.get(k, [])), len(cons.get(k, []))) for k in set(prov) | set(cons)),
    }
    json.dump({'res': res, 'sites': sites, 'file_pairs': sorted(file_pairs), 'pairs': pairs}, open(out, 'w'), indent=1, default=list)
    for k, v in res.items():
        s = json.dumps(v, ensure_ascii=False, default=list)
        print(k, s if len(s) < 3000 else s[:3000] + ' ...')


if __name__ == '__main__':
    main()
