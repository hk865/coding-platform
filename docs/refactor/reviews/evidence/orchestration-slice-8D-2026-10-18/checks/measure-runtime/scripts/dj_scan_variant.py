#!/usr/bin/env python3
"""Run light_import_scan.scan() with extra import roots put IN FRONT of the configured ones (what-if, not draft 4).

    cd / && python3 -I dj_scan_variant.py WORKSPACE OUT.json ROOT [ROOT ...]

Used for Django: tests/runtests.py is started as a script, so sys.path[0] is tests/ and every test app is a
top-level package ("admin_views.models").  Draft 4 only knows the configured roots ('.'), so this measures how many
unresolved references are really project files reachable through a root that only exists at run time.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # our own scripts directory, not the workspace
import light_import_scan as L  # noqa: E402

ws, out = sys.argv[1], sys.argv[2]
extra = sys.argv[3:]
original = L.plan_roots


def patched(selected, content, claimed_paths):
    roots, notes = original(selected, content, claimed_paths)
    return extra + [r for r in roots if r not in extra], notes


L.plan_roots = patched
result = L.scan(ws, None, True)
with open(out, 'w', encoding='utf-8') as handle:
    json.dump(result, handle, ensure_ascii=False)
print('roots', result['roots'], 'files', result['files'], 'parsed', result['parsed'], 'edges', len(result['edges']),
      'unresolved', len(result['unresolved']), 'byReason', result['stats']['unresolvedByReason'],
      'seconds', result['stats']['seconds'])
