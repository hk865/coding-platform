#!/usr/bin/env bash
# ros2/demos: what draft 4/5's database-selection rule sees in a colcon-style workspace.
# A scratch copy (no .git of the clone): <ws>/src/demos = the sources, <ws>/build/<pkg>/compile_commands.json = the
# per-package databases from r2-02 (paths not rewritten; only the selection rule is probed), .gitignore = build/ install/ log/.
# git only lists files (scratch repo, nothing committed, no hooks).
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
S="$ROOT/src/ros2-demos"
B="$ROOT/build/ros2-demos"
W="$ROOT/work/ros2-demos-colcon"
R="$ROOT/results/ros2-demos"
if [ ! -d "$W" ]; then
  mkdir -p "$W/src/demos" "$W/build"
  (cd "$S" && git -c core.fsmonitor=false ls-files -z | xargs -0 cp --parents -t "$W/src/demos")
  for d in "$B"/*/; do n=$(basename "$d"); [ -f "$d/compile_commands.json" ] && mkdir -p "$W/build/$n" && cp "$d/compile_commands.json" "$W/build/$n/"; done
  printf 'build/\ninstall/\nlog/\n' > "$W/.gitignore"
  git init -q "$W"
fi
cd "$W"
echo "-- (c) colcon workspace as a git repo, build/ ignored: ignored compile databases found by the draft's probe"
git -c core.fsmonitor=false ls-files --others --ignored --exclude-standard -z -- ':(glob)**/compile_commands.json' | tr '\0' '\n' | tee "$R/colcon-probe.txt" | wc -l
echo "-- not ignored compile databases:"; git -c core.fsmonitor=false ls-files --others --exclude-standard -z -- ':(glob)**/compile_commands.json' | tr '\0' '\n' | wc -l
echo "-- (b) not a git repo: compile_commands.json files a plain walk finds: $(find "$W" -name compile_commands.json -not -path '*/.git/*' | wc -l)"
echo "-- (a) workspace = the git repo (the clone): compile_commands.json inside: $(find "$S" -name compile_commands.json -not -path '*/.git/*' | wc -l); CMakeLists.txt at root: $(test -f "$S/CMakeLists.txt" && echo yes || echo no); anywhere: $(find "$S" -name CMakeLists.txt -not -path '*/.git/*' | wc -l)"
