#!/usr/bin/env python3
"""Colcon-layout simulation of the SLAM compile database (supplement to task d).

Run only as: python3 -I slam_colcon_db.py IN.json OUT.json WS_SRC
In a real colcon build the include directories a package gets from ANOTHER workspace package through ament
(exported include dirs, imported targets) point at <ws>/install/<pkg>/include, a git-ignored copy, not at
<ws>/src/<pkg>/include.  The measurement database points them at the source tree (stand-in configs).  This
rewrites exactly those values: an -I / -isystem value under WS_SRC/<other package>/ written without '..'
(the '..' ones are written by hand in the CMakeLists files and are real) becomes WS_SRC/../install/<pkg>/...
The package of an entry is the last segment of its build directory.
"""
import json
import os
import sys

src_in, out, ws_src = sys.argv[1], sys.argv[2], os.path.normpath(sys.argv[3])
install = os.path.join(os.path.dirname(ws_src), 'install')
db = json.load(open(src_in, encoding='utf-8'))
changes = []


def rewrite(value, pkg):
    if '..' in value.split('/') or not value.startswith(ws_src + '/'):
        return value
    other = value[len(ws_src) + 1:].split('/')[0]
    if other == pkg:
        return value
    return os.path.join(install, value[len(ws_src) + 1:])


for entry in db:
    pkg = entry['directory'].rstrip('/').split('/')[-1]
    args, i, new = entry['arguments'], 0, []
    while i < len(args):
        x = args[i]
        if x in ('-isystem', '-iquote', '-idirafter', '-I') and i + 1 < len(args):
            v = rewrite(args[i + 1], pkg)
            if v != args[i + 1]:
                changes.append((pkg, x, args[i + 1], v))
            new += [x, v]; i += 2; continue
        if x.startswith('-I') and len(x) > 2:
            v = rewrite(x[2:], pkg)
            if v != x[2:]:
                changes.append((pkg, '-I', x[2:], v))
            new.append('-I' + v); i += 1; continue
        new.append(x); i += 1
    entry['arguments'] = new
json.dump(db, open(out, 'w', encoding='utf-8'), indent=1)
seen = sorted(set(changes))
for c in seen:
    print('%s: %s %s -> %s' % c)
print('rewritten values:', len(changes), 'distinct:', len(seen))
