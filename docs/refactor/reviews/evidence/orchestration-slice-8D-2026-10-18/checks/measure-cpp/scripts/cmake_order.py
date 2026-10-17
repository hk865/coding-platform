"""Ordered (preprocessing-order, all branches, first visit only) regex include walk per TU.

For each TU: position of the first include that resolves into the build tree, and whether it is the
main file's first include. Approximation: every #include line is followed regardless of #if; a header
already visited in this TU is not re-entered (include guards assumed).

Usage: python3 -I cmake_order.py <compile_commands.json> <source_root> <build_root>
"""
import collections
import json
import os
import posixpath
import re
import shlex
import sys

cc, SRC, BLD = sys.argv[1:4]
SRC, BLD = os.path.realpath(SRC), os.path.realpath(BLD)
INC_RE = re.compile(r'^[ \t]*#[ \t]*(include_next|include|import)[ \t]*([<"])([^>"\n]+)[>"]', re.M)
COMMENT_RE = re.compile(r'/\*.*?\*/|//[^\n]*', re.S)
cache = {}


def incs(p):
    if p not in cache:
        try:
            t = COMMENT_RE.sub(lambda m: '\n' * m.group(0).count('\n'), open(p, encoding='utf-8', errors='replace').read())
        except OSError:
            t = ''
        cache[p] = [(m.group(2), m.group(3).strip()) for m in INC_RE.finditer(t)]
    return cache[p]


def in_build(p):
    return p.startswith(BLD + '/')


stats = collections.Counter()
first_pos = []
first_names = collections.Counter()
for e in json.load(open(cc, encoding='utf-8')):
    raw = shlex.split(e['command'], posix=True) if 'command' in e else e['arguments']
    d = e['directory']
    quote, angle = [], []
    i = 1
    while i < len(raw):
        a = raw[i]
        for flag, lst in (('-iquote', quote), ('-isystem', angle), ('-I', angle)):
            if a == flag:
                v = raw[i + 1]; i += 1
                lst.append(v if v.startswith('/') else posixpath.normpath(posixpath.join(d, v)))
                break
            if a.startswith(flag) and flag == '-I':
                v = a[2:]
                lst.append(v if v.startswith('/') else posixpath.normpath(posixpath.join(d, v)))
                break
        i += 1
    seen = set()
    order = []  # sequence of (includer, spelled, resolved or None)

    def walk(p, depth):
        if p in seen or depth > 200:
            return
        seen.add(p)
        for delim, s in incs(p):
            cands = ([posixpath.dirname(p)] + quote if delim == '"' else []) + angle
            hit = next((posixpath.normpath(posixpath.join(c, s)) for c in cands if os.path.isfile(posixpath.join(c, s))), None)
            order.append((p, delim + s, hit))
            if hit:
                walk(hit, depth + 1)

    walk(e['file'], 0)
    idx = next((k for k, (_, _, h) in enumerate(order) if h and in_build(h)), None)
    unresolved_before = None
    if idx is None:
        stats['no build-tree include'] += 1
        continue
    first_pos.append(idx)
    first_names[order[idx][1]] += 1
    unresolved_before = sum(1 for (_, _, h) in order[:idx] if h is None)
    stats['first build-tree include is directive #1 of the TU'] += idx == 0
    stats['first build-tree include is in the main file'] += order[idx][0] == e['file']
    stats['some unresolved include precedes the first build-tree include'] += unresolved_before > 0
    stats['TUs with a build-tree include'] += 1

first_pos.sort()
print(json.dumps({'stats': dict(stats),
                  'first_build_include_position': {'min': first_pos[0], 'median': first_pos[len(first_pos) // 2], 'max': first_pos[-1]} if first_pos else None,
                  'first_build_include_spelling_top': first_names.most_common(12)}, indent=1))
