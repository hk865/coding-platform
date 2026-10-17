#!/bin/bash
# verifier: which files under the CMake source tree the VFS list left out as binary/oversized/symlink
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
R=$W/results/cmake-src
python3 -I - "$SRC" "$R/vfs-files-A.txt" <<'PY'
import os, re, sys
root, lst = sys.argv[1], sys.argv[2]
SOURCE_RE = re.compile(r'\.(?:c|cc|cpp|cxx|C|h|hh|hpp|hxx|inc|ipp|inl|tcc|def)$')
listed = set(l.strip() for l in open(lst) if l.strip())
out = []
for cur, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d != '.git']
    for n in files:
        full = os.path.join(cur, n); rel = os.path.relpath(full, root)
        if not (SOURCE_RE.search(n) or '.' not in n): continue
        if rel in listed: continue
        kind = 'symlink' if os.path.islink(full) else ('big' if os.path.getsize(full) > 2*1024*1024 else ('nul' if b'\0' in open(full,'rb').read() else 'other'))
        out.append((kind, rel, n))
for o in out: print(o)
print('listed', len(listed))
PY
