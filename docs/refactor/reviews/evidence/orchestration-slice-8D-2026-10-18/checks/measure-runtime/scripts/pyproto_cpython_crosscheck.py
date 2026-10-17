#!/usr/bin/env python3
"""Cross-check the prototype's absolute-name lookups against CPython's own finder on OUR OWN fixtures only
(the fixture files are empty or contain only import statements written by the prototype author; never run this on
downloaded code: find_spec executes parent packages' __init__.py).

    python3 -I pyproto_cpython_crosscheck.py CASE_DIR ROOT[,ROOT...] NAME [NAME...]

Prints, per name, where CPython finds it with sys.path = the given roots + the interpreter's stdlib entries.
"""
import importlib.util
import json
import os
import sys

case_dir = os.path.abspath(sys.argv[1])
roots = [os.path.normpath(os.path.join(case_dir, r)) for r in sys.argv[2].split(',')]
stdlib = [p for p in sys.path if p and 'site-packages' not in p and 'dist-packages' not in p]
sys.path[:] = roots + stdlib
sys.dont_write_bytecode = True
out = {}
for name in sys.argv[3:]:
    try:
        spec = importlib.util.find_spec(name)
        if spec is None:
            out[name] = 'not found'
        elif spec.origin in (None, 'namespace') or spec.submodule_search_locations is not None and spec.origin is None:
            out[name] = 'namespace ' + ','.join(os.path.relpath(p, case_dir) for p in spec.submodule_search_locations)
        elif spec.origin.startswith(case_dir + os.sep):
            out[name] = os.path.relpath(spec.origin, case_dir).replace(os.sep, '/')
        else:
            out[name] = 'outside: ' + spec.origin
    except Exception as error:
        out[name] = '{}: {}'.format(type(error).__name__, error)
print(json.dumps(out, ensure_ascii=False, indent=1))
