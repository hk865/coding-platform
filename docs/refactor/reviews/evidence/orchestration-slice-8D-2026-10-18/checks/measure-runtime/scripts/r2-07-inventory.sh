#!/usr/bin/env bash
# ros2/demos: package map, CMake File API targets, runtime-dependency inventory.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/ros2-demos"
R="$ROOT/results/ros2-demos"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
cd "$R"
python3 -I - "$S" "$R/git-not-ignored.z" "$R/packages.json" <<'PY'
import json, os, re, sys
src, lst, out = sys.argv[1:4]
files = [p.decode() for p in open(lst, 'rb').read().split(b'\0') if p]
pk = {}
for f in files:
    if f.endswith('package.xml'):
        pk[re.search(r'<name>([^<]+)</name>', open(os.path.join(src, f), encoding='utf-8').read()).group(1)] = os.path.dirname(f)
json.dump(pk, open(out, 'w'), indent=1)
print(len(pk), 'packages')
PY
python3 -I "$SC/r2_cmake_targets.py" "$ROOT/build/ros2-demos-fileapi" "$S" "$R/packages.json" "$R/cmake-targets.json"
python3 -I "$SC/r2_runtime_inventory.py" --src "$S" --build "$ROOT/build/ros2-demos" --results "$R" --out "$R/runtime-inventory-auto.json" --text "$R/runtime-inventory-auto.txt" > /dev/null
python3 -I "$SC/r2_runtime_inventory.py" --src "$S" --build "$ROOT/build/ros2-demos" --results "$R" --hand "$SC/r2_hand_names.json" --out "$R/runtime-inventory.json" --text "$R/runtime-inventory.txt"
