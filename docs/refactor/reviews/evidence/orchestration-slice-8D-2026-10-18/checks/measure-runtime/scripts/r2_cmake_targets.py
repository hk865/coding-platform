#!/usr/bin/env python3
"""Read the CMake File API (codemodel-v2) replies of the ros2/demos configure-only pass.

Run only as:  python3 -I r2_cmake_targets.py FILEAPI_BUILD_ROOT SOURCE_ROOT WORKSPACE_PACKAGES_JSON OUT.json

  FILEAPI_BUILD_ROOT        ~/dsh-work/measure-runtime/build/ros2-demos-fileapi (one sub-directory per package)
  SOURCE_ROOT               the clone (data only; nothing in it is executed or imported)
  WORKSPACE_PACKAGES_JSON   {"<package name>": "<package dir relative to SOURCE_ROOT>", ...}

Output per package: its targets (name, type, workspace sources, generated sources), and for each target the
dependencies on targets of the same package ('link' when the dependency's artifact appears in the link line,
otherwise 'build-order'), plus link-line libraries of OTHER workspace packages (served by /opt/ros/jazzy here).
"""
import glob
import json
import os
import re
import sys


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def main():
    build_root, source_root, packages_path, out_path = sys.argv[1:5]
    packages = load(packages_path)
    lib_re = re.compile(r'(?:^|/)lib([A-Za-z0-9_]+?)(?:__[A-Za-z0-9_]+)?\.(?:so|a)(?:\.[0-9.]+)?$')
    result = {}
    for name, rel in sorted(packages.items()):
        reply_dir = os.path.join(build_root, name, '.cmake', 'api', 'v1', 'reply')
        index_files = sorted(glob.glob(os.path.join(reply_dir, 'index-*.json')))
        if not index_files:
            result[name] = {'error': 'no file API reply'}
            continue
        index = load(index_files[-1])
        codemodel_ref = index['reply']['codemodel-v2']['jsonFile']
        codemodel = load(os.path.join(reply_dir, codemodel_ref))
        config = codemodel['configurations'][0]
        targets_by_id = {}
        for ref in config['targets']:
            t = load(os.path.join(reply_dir, ref['jsonFile']))
            targets_by_id[ref['id']] = t
        pkg_src = os.path.join(source_root, rel)
        out_targets = []
        for tid, t in targets_by_id.items():
            if t['type'] == 'UTILITY':
                continue
            ws_sources, gen_sources = [], []
            for s in t.get('sources', []):
                p = s['path']
                full = p if os.path.isabs(p) else os.path.normpath(os.path.join(pkg_src, p))
                if full.startswith(source_root + '/'):
                    ws_sources.append(os.path.relpath(full, source_root))
                else:
                    gen_sources.append(os.path.relpath(full, os.path.join(build_root, name)) if full.startswith(build_root) else full)
            fragments = [f['fragment'] for f in t.get('link', {}).get('commandFragments', []) if f.get('role') == 'libraries']
            deps = []
            for d in t.get('dependencies', []):
                dt = targets_by_id.get(d['id'])
                if not dt or dt['type'] == 'UTILITY':
                    continue
                artifacts = [os.path.basename(a['path']) for a in dt.get('artifacts', [])]
                linked = any(any(f.endswith(a) or os.path.basename(f) == a for f in fragments) for a in artifacts)
                deps.append({'target': dt['name'], 'kind': 'link' if linked else 'build-order'})
            other_ws = set()
            for f in fragments:
                m = lib_re.search(f)
                if m and m.group(1) in packages and m.group(1) != name:
                    other_ws.add(m.group(1))
            out_targets.append({'name': t['name'], 'type': t['type'], 'workspace_sources': sorted(ws_sources),
                                'generated_sources': sorted(gen_sources), 'same_package_deps': deps,
                                'links_other_workspace_packages': sorted(other_ws)})
        result[name] = {'dir': rel, 'targets': sorted(out_targets, key=lambda x: x['name'])}
    with open(out_path, 'w', encoding='utf-8') as handle:
        json.dump(result, handle, indent=1)
    for name, pkg in result.items():
        if 'targets' in pkg:
            print(name, len(pkg['targets']), 'targets;',
                  sum(1 for t in pkg['targets'] for d in t['same_package_deps'] if d['kind'] == 'link'), 'same-package link deps;',
                  sorted({o for t in pkg['targets'] for o in t['links_other_workspace_packages']}))


if __name__ == '__main__':
    main()
