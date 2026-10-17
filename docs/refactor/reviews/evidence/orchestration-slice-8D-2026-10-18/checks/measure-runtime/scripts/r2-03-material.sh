#!/usr/bin/env bash
# ros2/demos: merge the per-package compile databases (outside the source) and build the material lists.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/ros2-demos"
B="$ROOT/build/ros2-demos"
R="$ROOT/results/ros2-demos"
SC=/mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts
cd "$R"
DBS=$(ls "$B"/*/compile_commands.json | sort)
echo "per-package databases: $(echo "$DBS" | wc -l)"
python3 -I "$SC/r2_merge_db.py" "$R/compile_commands.merged.json" $DBS
python3 -I - "$R/compile_commands.merged.json" "$S" "$B" <<'PY'
import json, sys, collections
db, src, bld = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
where = collections.Counter('source' if e['file'].startswith(src + '/') else 'build' if e['file'].startswith(bld + '/') else 'other' for e in db)
print('main file location:', dict(where))
kinds = collections.Counter()
for e in db:
    f = e['file']
    if f.startswith(bld + '/'):
        rest = f[len(bld) + 1:]
        if '/rosidl_generator' in rest or '/rosidl_typesupport' in rest: kinds['rosidl generated'] += 1
        elif 'rclcpp_components' in rest: kinds['rclcpp_components generated main'] += 1
        else: kinds['other build-dir file: ' + rest.split('/', 1)[1]] += 1
print('build-dir main files by kind:', dict(kinds))
comp = collections.Counter(e['arguments'][0].rsplit('/', 1)[-1] for e in db)
print('compilers:', dict(comp))
PY
git -c core.fsmonitor=false -C "$S" ls-files -z --cached --others --exclude-standard > "$R/git-not-ignored.z"
git -c core.fsmonitor=false -C "$S" ls-files -z --others --ignored --exclude-standard > "$R/git-ignored.z"
echo "git not ignored: $(tr '\0' '\n' < "$R/git-not-ignored.z" | wc -l); ignored: $(tr '\0' '\n' < "$R/git-ignored.z" | wc -l)"
python3 -I "$SC/r2_material.py" "$S" "$R/git-not-ignored.z" "$R/cpp"
