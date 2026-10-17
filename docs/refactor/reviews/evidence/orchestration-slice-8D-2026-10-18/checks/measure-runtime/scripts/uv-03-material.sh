#!/usr/bin/env bash
# libuv: material lists for layout A (build dir outside the workspace) and layout B (build dir copied into an ignored
# build/ inside a copy of the workspace, compile database paths rewritten).  git only lists files (a scratch git dir
# outside the source; nothing is committed, no hooks or filters run).
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/libuv/libuv-v1.48.0"
BLD="$ROOT/build/libuv-out"
WB="$ROOT/work/libuv-B"
G="$ROOT/work/libuv-gitdir"
R="$ROOT/results/libuv"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
mkdir -p "$ROOT/work" "$R"
cd "$ROOT"
[ -d "$G/.git" ] || git init -q "$G"
echo "== layout A: workspace = source tree"
git --git-dir="$G/.git" --work-tree="$S" ls-files --others --exclude-standard -z > "$R/A.git-not-ignored.z"
git --git-dir="$G/.git" --work-tree="$S" ls-files --others --ignored --exclude-standard -z > "$R/A.git-ignored.z"
echo "ignored in A: $(tr '\0' '\n' < "$R/A.git-ignored.z" | wc -l)"; tr '\0' '\n' < "$R/A.git-ignored.z" | head -20
python3 -I "$SC/uv_material.py" "$S" "$R/A.git-not-ignored.z" "$R/A"
echo "== layout B: copy of the workspace with the configured build dir as build/ (ignored by /build/)"
if [ ! -d "$WB" ]; then
  mkdir -p "$WB"
  cp -a "$S/." "$WB/"
  cp -a "$BLD" "$WB/build"
  python3 -I -c 'import json,sys
src,bld,wb=sys.argv[1:4]; p=wb+"/build/compile_commands.json"
db=json.load(open(p))
for e in db:
    for k in ("directory","command","file","output"):
        if k in e: e[k]=e[k].replace(bld, wb+"/build").replace(src, wb)
json.dump(db, open(p,"w"), indent=2)
print("rewritten", len(db))' "$S" "$BLD" "$WB"
fi
git --git-dir="$G/.git" --work-tree="$WB" ls-files --others --exclude-standard -z > "$R/B.git-not-ignored.z"
python3 -I "$SC/uv_material.py" "$WB" "$R/B.git-not-ignored.z" "$R/B"
echo "-- draft 4 section 11.4 probe: does the pathspec search reach compile_commands.json inside the ignored build/?"
git --git-dir="$G/.git" --work-tree="$WB" ls-files --others --ignored --exclude-standard -z -- ':(glob)**/compile_commands.json' | tr '\0' '\n'
echo "-- same with --directory (should collapse to build/)"
git --git-dir="$G/.git" --work-tree="$WB" ls-files --others --ignored --exclude-standard --directory -z -- ':(glob)**/compile_commands.json' | tr '\0' '\n'
echo "-- files under build/ in B (all ignored): $(find "$WB/build" -type f | wc -l); C/C++ there:"
find "$WB/build" -type f \( -name '*.c' -o -name '*.h' -o -name '*.cpp' \) | sed "s|$WB/||"
cmp <(tr '\0' '\n' < "$R/A.git-not-ignored.z" | sort) <(tr '\0' '\n' < "$R/B.git-not-ignored.z" | sort) && echo "A and B material lists identical"
