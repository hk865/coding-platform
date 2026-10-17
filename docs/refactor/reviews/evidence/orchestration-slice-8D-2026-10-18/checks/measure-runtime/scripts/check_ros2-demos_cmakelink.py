#!/usr/bin/env python3
"""Checker (ros2-demos): link dependencies between the project's own targets, from CMake's generated link.txt.

Run only as: python3 -I check_ros2-demos_cmakelink.py SRC BUILD INC_DETAIL_JSON OUT_JSON
For every BUILD/<pkg>/CMakeFiles/<target>.dir/link.txt (written at configure/generate time, nothing built), the
tokens lib<other>.so / lib<other>.a that name another target of the same build dir are own-target links. Each
target's workspace sources come from the compile database outputs (CMakeFiles/<target>.dir/...). A link A -> B is
'include-connected' when a source of A and a source of B reach a common workspace file (directed include closure,
excluding visibility_control.h), or one reaches the other.
"""
import collections
import json
import os
import re
import sys


def main():
    src, build, inc_detail, out = sys.argv[1:5]
    det = json.load(open(inc_detail))
    succ = collections.defaultdict(set)
    for e in det['edges']:
        succ[e[0]].add(e[3])

    def closure(f):
        seen, todo = {f}, [f]
        while todo:
            x = todo.pop()
            for y in succ.get(x, ()):
                if y not in seen:
                    seen.add(y)
                    todo.append(y)
        return seen
    links, tsrc = [], collections.defaultdict(set)
    gen_only = collections.Counter()
    for pkg in sorted(os.listdir(build)):
        cc = os.path.join(build, pkg, 'compile_commands.json')
        if not os.path.exists(cc):
            continue
        for e in json.load(open(cc)):
            o = e.get('output') or re.search(r'-o\s+(\S+)', e.get('command', '')).group(1)
            m = re.match(r'CMakeFiles/([^/]+)\.dir/', o)
            f = os.path.normpath(os.path.join(e['directory'], e['file']))
            if m:
                tsrc[(pkg, m.group(1))].add(os.path.relpath(f, src) if f.startswith(src + '/') else 'BUILD:' + f)
        cmf = os.path.join(build, pkg, 'CMakeFiles')
        targets = [d[:-4] for d in os.listdir(cmf) if d.endswith('.dir')]
        for t in targets:
            lt = os.path.join(cmf, t + '.dir', 'link.txt')
            if not os.path.exists(lt):
                continue
            toks = open(lt).read().split()
            for tok in toks:
                m = re.match(r'^(?:.*/)?lib([\w.+-]+?)\.(?:so|a)$', tok)
                if m and m.group(1) in targets and m.group(1) != t and not tok.startswith('/opt'):
                    links.append((pkg, t, m.group(1)))
    res = {'own_target_links_total': len(links), 'links': []}
    both_src = 0
    conn = 0
    for pkg, a, b in links:
        sa = {x for x in tsrc.get((pkg, a), ()) if not x.startswith('BUILD:')}
        sb = {x for x in tsrc.get((pkg, b), ()) if not x.startswith('BUILD:')}
        if not sa or not sb:
            gen_only['generated-only side'] += 1
            continue
        both_src += 1
        ca = set().union(*(closure(x) for x in sa))
        cb = set().union(*(closure(x) for x in sb))
        common = {x for x in ca & cb if os.path.basename(x) != 'visibility_control.h'}
        ok = bool(common)
        conn += ok
        res['links'].append([pkg, a, b, sorted(sa), sorted(sb), sorted(common)])
    res['links_both_sides_workspace_sources'] = both_src
    res['include_connected'] = conn
    res['not_connected'] = [l[:3] for l in res['links'] if not l[5]]
    res['links_with_a_generated_only_side'] = dict(gen_only)
    json.dump(res, open(out, 'w'), indent=1)
    print(json.dumps(res, indent=1)[:5000])


if __name__ == '__main__':
    main()
