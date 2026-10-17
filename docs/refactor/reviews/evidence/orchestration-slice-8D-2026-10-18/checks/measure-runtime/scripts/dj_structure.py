#!/usr/bin/env python3
"""What the light scan's edges-only graph says about django/ versus what is wired at run time.

    cd / && python3 -I dj_structure.py SCAN_ROOT.json INVENTORY.json INVENTORY-sites.json OUT.json WORKSPACE

Reads our own JSON outputs and only lists file names under WORKSPACE/django (no file contents).
Components: django/contrib/<app>, django/db/<sub>, django/core/<sub>, django/<x>, and 'django/(top)' for top-level files.
"""
import collections
import os
import json
import re
import sys


def comp(p):
    parts = p.split('/')
    if len(parts) == 2:
        return 'django/(top)'
    if parts[1] in ('contrib', 'db', 'core') and len(parts) > 3:
        return '/'.join(parts[:3])
    if parts[1] in ('contrib', 'db', 'core'):
        return '/'.join(parts[:2]) + '/(files)'
    return '/'.join(parts[:2])


def main():
    scan_path, inv_path, sites_path, out_path = sys.argv[1:5]
    scan = json.load(open(scan_path, encoding='utf-8'))
    inv = json.load(open(inv_path, encoding='utf-8'))
    sites = json.load(open(sites_path, encoding='utf-8'))
    ws = sys.argv[5]
    dj_files = []
    for dirpath, dirnames, filenames in os.walk(os.path.join(ws, 'django')):
        dirnames[:] = [d for d in dirnames if d != '__pycache__']
        for fn in filenames:
            if fn.endswith('.py'):
                dj_files.append(os.path.relpath(os.path.join(dirpath, fn), ws).replace(os.sep, '/'))
    dj_files.sort()
    edges = [(f, t) for f, t, _ in scan['edges'] if f.startswith('django/') and t.startswith('django/')]
    indeg = collections.Counter(t for f, t in edges)
    outdeg = collections.Counter(f for f, t in edges)
    comp_edges = collections.Counter((comp(f), comp(t)) for f, t in edges if comp(f) != comp(t))
    comps = collections.Counter(comp(p) for p in dj_files)
    result = {'djangoFilesSeenInScan': len(dj_files), 'djangoInternalEdges': len(edges),
              'edgesFromTestsIntoDjango': sum(1 for f, t, _ in scan['edges'] if f.startswith('tests/') and t.startswith('django/')),
              'components': len(comps), 'componentEdges': len(comp_edges)}
    result['topInDegree'] = [[p, n] for p, n in indeg.most_common(12)]
    # hubs: share of django files that import django/conf/__init__.py (settings)
    conf_importers = {f for f, t in edges if t == 'django/conf/__init__.py'}
    result['filesImportingDjangoConf'] = len(conf_importers)

    # ------------------------------------------------------------------ runtime-wired targets in django/
    runtime_targets = collections.defaultdict(set)   # file -> reasons
    runtime_pairs = set()                            # (from_file, to_file, kind)
    for s in sites['dottedSites']:
        if s['kind'] in sites['wiringKinds'] and s['to'] and s['to'].startswith('django/'):
            runtime_targets[s['to']].add('dotted string in ' + ('django/' if s['from'].startswith('django/') else 'tests/'))
            if s['from'].startswith('django/') and s['from'] != s['to']:
                runtime_pairs.add((s['from'], s['to'], 'dotted string'))
    for path, info in inv['projectTemplateSettings'].items():
        for item in info.get('items', []):
            m = re.search(r'-> (django/\S+)$', item)
            if m:
                runtime_targets[m.group(1)].add('settings.py-tpl')
                runtime_pairs.add(('django/conf/project_template/project_name/settings.py-tpl', m.group(1), 'project template settings'))
    for t in inv['templates']['loadTag']['djangoTargets']:
        runtime_targets[t].add('{% load %} in a django template')
    for s in sites['modelSites']:
        if s['to'] and s['to'].startswith('django/'):
            runtime_targets[s['to']].add('app_label.Model string')
    all_dj_paths = set(dj_files)
    conv_rules = [
        (lambda p: '/management/commands/' in p and not p.endswith('__init__.py'), 'management command (load_command_class)',
         'django/core/management/__init__.py'),
        (lambda p: '/migrations/' in p and not p.endswith('__init__.py') and '/db/migrations/' not in p, 'migration (MigrationLoader)',
         'django/db/migrations/loader.py'),
        (lambda p: p.startswith('django/conf/locale/') and p.endswith('/formats.py'), 'locale formats (get_format_modules)',
         'django/utils/formats.py'),
        (lambda p: p.endswith('/apps.py'), 'apps.py (AppConfig.create)', 'django/apps/config.py'),
        (lambda p: '/templatetags/' in p and not p.endswith('__init__.py'), 'template library (get_installed_libraries)',
         'django/template/backends/django.py'),
        (lambda p: p.endswith('/admin.py') and p.startswith('django/contrib/'), 'admin.py (admin.autodiscover)',
         'django/contrib/admin/__init__.py'),
        (lambda p: p.startswith('django/db/backends/') and p.endswith('/base.py'), 'db backend base.py (load_backend)',
         'django/db/utils.py'),
        (lambda p: re.search(r'/(models\.py|models/__init__\.py)$', p) is not None, 'models module (AppConfig.import_models)',
         'django/apps/config.py'),
    ]
    for p in all_dj_paths:
        for rule, why, loader in conv_rules:
            if rule(p):
                runtime_targets[p].add(why)
                runtime_pairs.add((loader, p, why))
    # ------------------------------------------------------------------ in-degree zero files
    zero = sorted(p for p in all_dj_paths if indeg[p] == 0)
    zero_by_reason = collections.Counter()
    unexplained = []
    for p in zero:
        reasons = runtime_targets.get(p)
        if reasons:
            zero_by_reason[sorted(reasons)[0]] += 1
        else:
            unexplained.append(p)
    result['inDegreeZero'] = {'files': len(zero), 'explainedByRuntimeWiring': len(zero) - len(unexplained),
                              'byFirstReason': dict(zero_by_reason.most_common()),
                              'unexplained': len(unexplained), 'unexplainedList': unexplained[:80]}
    # ------------------------------------------------------------------ runtime pairs vs edges at three levels
    file_edges = set(edges)
    comp_set = set(comp_edges)
    by_kind = collections.defaultdict(collections.Counter)
    comp_new = collections.defaultdict(set)
    for f, t, kind in runtime_pairs:
        if (f, t) in file_edges:
            c = 'file edge'
        elif (t, f) in file_edges:
            c = 'reverse file edge'
        elif comp(f) == comp(t):
            c = 'same component'
        elif (comp(f), comp(t)) in comp_set:
            c = 'component edge'
        elif (comp(t), comp(f)) in comp_set:
            c = 'component edge, reverse only'
        else:
            c = 'new at component level'
            comp_new[kind].add((comp(f), comp(t)))
        by_kind[kind][c] += 1
    result['runtimePairs'] = {k: dict(v) for k, v in sorted(by_kind.items())}
    result['runtimePairsTotal'] = len(runtime_pairs)
    # the same at directory level (a directory = a Python package)
    def dn(p):
        return p.rsplit('/', 1)[0]
    dir_set = {(dn(f), dn(t)) for f, t in edges if dn(f) != dn(t)}
    by_kind_dir = collections.defaultdict(collections.Counter)
    for f, t, kind in runtime_pairs:
        if (f, t) in file_edges or (t, f) in file_edges:
            c = 'file edge (either direction)'
        elif dn(f) == dn(t):
            c = 'same directory'
        elif (dn(f), dn(t)) in dir_set:
            c = 'directory edge, same direction'
        elif (dn(t), dn(f)) in dir_set:
            c = 'directory edge, reverse only'
        else:
            c = 'new at directory level'
        by_kind_dir[kind][c] += 1
    result['runtimePairsDirectoryLevel'] = {k: dict(v) for k, v in sorted(by_kind_dir.items())}
    result['runtimePairsDirectoryLevelTotal'] = dict(sum(by_kind_dir.values(), collections.Counter()))
    result['runtimePairsComponentLevelTotal'] = dict(sum(by_kind.values(), collections.Counter()))
    indeg_all = collections.Counter(t for f, t, _ in scan['edges'])
    result['inDegreeZeroCountingTestsEdges'] = sum(1 for p in dj_files if indeg_all[p] == 0)
    result['unexplainedNotLocaleInit'] = [p for p in unexplained if not re.match(r'^django/conf/locale/[^/]+/__init__\.py$', p)]
    result['unexplainedInitFiles'] = sum(1 for p in unexplained if p.endswith('/__init__.py'))
    result['newComponentPairs'] = {k: sorted(map(list, v))[:25] for k, v in sorted(comp_new.items())}
    result['newComponentPairsCount'] = {k: len(v) for k, v in comp_new.items()}
    result['componentList'] = dict(comps.most_common())
    result['topComponentEdges'] = [[a, b, n] for (a, b), n in comp_edges.most_common(15)]
    with open(out_path, 'w', encoding='utf-8') as h:
        json.dump(result, h, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in result.items() if k not in ('componentList', 'newComponentPairs')}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
