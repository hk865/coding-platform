#!/usr/bin/env python3
"""Classify a light-scan result's unresolved references and draw seeded samples for hand checking.

    cd / && python3 -I dj_classify.py WORKSPACE SCAN.json OUT.json [--seed N] [--n 30]

Unresolved classes (null reason only; the reasoned ones are listed as they are):
  stdlib        first segment of an absolute name is in sys.stdlib_module_names
  project-django   absolute name starting with 'django' that the scan did not find (each one is listed)
  project-tests-root   importer is under tests/ and the full name is tests/<a/b/c>.py or tests/<a/b/c>/__init__.py
                       (tests/runtests.py is started as a script, so tests/ is sys.path[0] at run time)
  project-other-dir    the full name is <D>/<a/b/c>.py or <D>/<a/b/c>/__init__.py for some other directory D (listed)
  relative      a relative import that was not found (listed)
  third-party   everything else (top names counted)
Samples: N random edges and N random unresolved entries, each with the source line(s) of the import, for a reader.
"""
import ast
import collections
import json
import os
import random
import sys
import warnings

STDLIB = frozenset(sys.stdlib_module_names)


def main():
    ws, scan_path, out_path = sys.argv[1:4]
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 20261017
    n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 30
    scan = json.load(open(scan_path, encoding='utf-8'))
    py_paths = set()
    dirs = set()
    for dirpath, dirnames, filenames in os.walk(ws):
        rel_dir = os.path.relpath(dirpath, ws).replace(os.sep, '/')
        for fn in filenames:
            if fn.endswith('.py'):
                rel = fn if rel_dir == '.' else rel_dir + '/' + fn
                py_paths.add(rel)
                parts = rel.split('/')
                for i in range(1, len(parts)):
                    dirs.add('/'.join(parts[:i]))
    base_names = collections.defaultdict(list)
    for p in py_paths:
        parts = p.split('/')
        base_names[parts[-1][:-3]].append(p)
    for d in dirs:
        base_names[d.split('/')[-1]].append(d + '/')

    classes = collections.Counter()
    by_scope = collections.Counter()
    listed = collections.defaultdict(list)
    third = collections.Counter()
    stdlib_names = collections.Counter()
    for u in scan['unresolved']:
        scope = 'django/' if u['from'].startswith('django/') else ('tests/' if u['from'].startswith('tests/') else 'other')
        spec = u['specifier']
        if u['reason'] is not None:
            cls = 'reason:' + u['reason']
            listed[cls].append(u)
        elif spec.startswith('.'):
            cls = 'relative'
            listed[cls].append(u)
        else:
            top = spec.split('.')[0]
            if top in STDLIB:
                cls = 'stdlib'
                stdlib_names[top] += 1
            elif top == 'django':
                cls = 'project-django'
                listed[cls].append(u)
            else:
                # Would the FULL dotted name be a file under some directory D used as an extra root?
                tail = spec.replace('.', '/')
                hits = sorted(p for p in py_paths
                              if p in (tail + '.py', tail + '/__init__.py')
                              or p.endswith('/' + tail + '.py') or p.endswith('/' + tail + '/__init__.py'))
                roots_hit = sorted({p[:len(p) - len(tail + '.py')].rstrip('/') if p.endswith(tail + '.py')
                                    else p[:len(p) - len(tail + '/__init__.py')].rstrip('/') for p in hits})
                if 'tests' in roots_hit and u['from'].startswith('tests/'):
                    cls = 'project-tests-root'
                    listed[cls].append(u)
                elif hits:
                    cls = 'project-other-dir'
                    listed[cls].append(dict(u, candidates=hits[:5]))
                else:
                    cls = 'third-party'
                    third[top] += 1
        classes[cls] += 1
        by_scope[(cls, scope)] += 1

    rng = random.Random(seed)
    edge_sample = rng.sample(scan['edges'], min(n, len(scan['edges'])))
    unres_sample = rng.sample(scan['unresolved'], min(n, len(scan['unresolved'])))

    def import_lines(rel, spec):
        try:
            src = open(os.path.join(ws, rel), 'rb').read().decode('utf-8-sig')
        except OSError:
            return []
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            tree = ast.parse(src)
        lines = src.splitlines()
        out = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(a.name == spec for a in node.names):
                out.append((node.lineno, lines[node.lineno - 1].strip()))
            elif isinstance(node, ast.ImportFrom) and ('.' * (node.level or 0) + (node.module or '')) == spec:
                out.append((node.lineno, ' '.join(l.strip() for l in lines[node.lineno - 1:node.end_lineno])[:220]))
        return sorted(out)[:3]

    result = {
        'classes': dict(classes.most_common()),
        'classesByScope': {'{} @ {}'.format(k[0], k[1]): v for k, v in sorted(by_scope.items())},
        'stdlibTopNames': dict(stdlib_names.most_common(40)),
        'thirdPartyTopNames': dict(third.most_common()),
        'listed': {k: v for k, v in listed.items()},
        'edgeSample': [{'from': e[0], 'to': e[1], 'specifier': e[2], 'lines': import_lines(ws and e[0], e[2])}
                       for e in edge_sample],
        'unresolvedSample': [dict(u, lines=import_lines(u['from'], u['specifier'])) for u in unres_sample],
    }
    with open(out_path, 'w', encoding='utf-8') as h:
        json.dump(result, h, ensure_ascii=False, indent=1)
    print(json.dumps({'classes': result['classes'], 'classesByScope': result['classesByScope']}, ensure_ascii=False, indent=1))
    print('third-party top names:', len(third), dict(third.most_common(30)))
    print('stdlib top names:', len(stdlib_names))


if __name__ == '__main__':
    main()
