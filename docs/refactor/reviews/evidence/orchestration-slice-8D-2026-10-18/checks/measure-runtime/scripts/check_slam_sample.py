#!/usr/bin/env python3
"""Checker: samples for hand re-classification and a few cross-checks.
 1. 10 runtime sites drawn (seeded, one per kind) from the measuring agent's runtime-inventory.json,
    printed with their classification and the source lines, for reading by hand.
 2. 6 light-scan edges and 6 unresolved includes (seeded) with the #include line and the file test.
 3. unresolved specifiers whose path suffix matches a project file (would mean a lost project edge).
 4. per-package / per-kind file counts with an edge (own include check).
 5. the prototype rerun vs the original light output (edge sets).
Usage: python3 -I check_slam_sample.py <root> <runtime-inventory.json> <include-check.json> <cpp-light.ndjson> <cpp-light-rerun.ndjson>
"""
import json, os, random, re, sys, collections
root, invp, incp, l1, l2 = sys.argv[1:6]
rnd = random.Random(20261017)
inv = json.load(open(invp)); inc = json.load(open(incp))
def src(f, line, ctx=1):
    try:
        L = open(os.path.join(root, f), encoding='utf-8', errors='replace').read().splitlines()
    except Exception as e:
        return str(e)
    return ' | '.join(x.strip() for x in L[max(0, line - 1 - 0):line - 1 + ctx + 1])[:300]

print('== 1. ten runtime sites from the measurement (seeded) ==')
pool = []
for kind in ('cpp_create_publisher', 'cpp_create_subscription', 'cpp_tf_sendTransform', 'cpp_param_read_getRemoteParam',
             'cpp_process_system', 'cpp_runtime_path_macro', 'cpp_param_read_getParam'):
    lst = inv['cpp_sites'][kind]; pool.append((kind, rnd.choice(lst)))
for kind in ('py_create_client', 'py_create_publisher'):
    lst = inv['py_sites'][kind]; pool.append((kind, rnd.choice(lst)))
nodes = [(lf, n) for lf, d in inv['launch'].items() for n in d['nodes']]
lf, n = rnd.choice(nodes); pool.append(('launch_node', dict(n, file=lf)))
for kind, s in pool:
    f = s.get('file'); ln = s.get('line')
    print('[%s] %s:%s' % (kind, f, ln))
    print('   theirs:', json.dumps({k: v for k, v in s.items() if k not in ('file', 'line')}, ensure_ascii=False)[:300])
    print('   source:', src(f, ln, 2))

print('\n== 2. edges and unresolved (seeded hand sample) ==')
E = [tuple(e) for e in inc['edges_sorted']]; U = [tuple(u) for u in inc['unresolved_sorted']]
for a, b in rnd.sample(E, 6):
    t = open(os.path.join(root, a), encoding='utf-8', errors='replace').read().splitlines()
    hits = [(i + 1, x.strip()) for i, x in enumerate(t) if re.match(r'\s*#\s*include', x) and os.path.basename(b) in x]
    print('E', a, '->', b, '| exists:', os.path.isfile(os.path.join(root, b)), '|', hits[:2])
for a, s in rnd.sample(U, 6):
    t = open(os.path.join(root, a), encoding='utf-8', errors='replace').read().splitlines()
    hits = [(i + 1, x.strip()) for i, x in enumerate(t) if re.match(r'\s*#\s*include', x) and s[1:-1] in x]
    print('U', a, s, '|', hits[:2])

print('\n== 3. unresolved specifier whose path suffix is a project file ==')
files = set()
for dp, dns, fns in os.walk(root):
    for fn in fns: files.add(os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, '/'))
sfx = [(a, s, [f for f in files if f.endswith('/' + s[1:-1])]) for a, s in U]
print('matches:', [x for x in sfx if x[2]])
print('basename-only matches:', [(a, s, [f for f in files if os.path.basename(f) == os.path.basename(s[1:-1])]) for a, s in U
                                 if [f for f in files if os.path.basename(f) == os.path.basename(s[1:-1])]])

print('\n== 4. files with an edge, by package ==')
ends = set(a for a, _ in E) | set(b for _, b in E)
pk = collections.defaultdict(lambda: [0, 0])
for f in files:
    p = f.split('/')[2] if f.startswith('ros2_ws/src/') else '(root)'
    pk[p][0] += 1; pk[p][1] += f in ends
print(dict(pk), 'total with edge', len(ends))

print('\n== 5. prototype rerun vs original ==')
def edges(p):
    out = set(); st = collections.Counter()
    rp = os.path.normpath(root) + '/'
    for line in open(p):
        o = json.loads(line); st[o['status']] += 1
        for i in o['inclusions']:
            if i['file'].startswith(rp) and i.get('resolved') and i['resolved'].startswith(rp):
                out.add((i['file'][len(rp):], i['resolved'][len(rp):]))
    return out, st
e1, s1 = edges(l1); e2, s2 = edges(l2)
print('original', len(e1), dict(s1), 'rerun', len(e2), dict(s2), 'identical', e1 == e2)
