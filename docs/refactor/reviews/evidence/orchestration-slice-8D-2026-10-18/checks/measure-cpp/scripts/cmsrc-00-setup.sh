#!/bin/bash
# cmake-src: production-like VFS file list for the source tree (scenario A) and for source+build (scenario B).
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
SRC=$W/downloads/cmake-3.30.5/cmake-3.30.5
BLD=$W/build/cmake-3.30.5
R=$W/results/cmake-src
mkdir -p "$R"
free -m | awk '/Mem:/{print "available MB", $7}'
echo "== A: source tree only"
python3 -I $S/vfs_filelist.py "$SRC" "$R/vfs-files-A.txt"
wc -l < "$R/vfs-files-A.txt"
echo "== B: source + build tree, relative to $W"
python3 -I $S/vfs_filelist.py "$SRC" "$R/vfs-files-B-src.txt" --rel-to "$W"
python3 -I $S/vfs_filelist.py "$BLD" "$R/vfs-files-B-bld.txt" --rel-to "$W"
cat "$R/vfs-files-B-src.txt" "$R/vfs-files-B-bld.txt" | sort > "$R/vfs-files-B.txt"
wc -l < "$R/vfs-files-B.txt"
# directories named like the non-git skip list inside the source tree (informational)
find "$SRC" -type d \( -name build -o -name dist -o -name node_modules -o -name coverage -o -name .cache -o -name out -o -name target \) | sed "s|$SRC/||" | head -20
python3 -I -c 'import json,sys; db=json.load(open(sys.argv[1])); print("db entries", len(db)); print("sorted by file?", [e["file"] for e in db]==sorted(e["file"] for e in db))' "$BLD/compile_commands.json"
