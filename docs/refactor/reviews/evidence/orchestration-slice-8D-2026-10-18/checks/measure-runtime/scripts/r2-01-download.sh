#!/usr/bin/env bash
# ros2/demos (jazzy branch): the ONLY download of this measurement (user-approved 2026-10-17).
# Shallow clone into a NEW EMPTY directory; nothing in it is executed. Records commit, size, file counts.
set -euo pipefail
ROOT="$HOME/dsh-work/measure-runtime"
D="$ROOT/src/ros2-demos"
R="$ROOT/results/ros2-demos"
if [ -e "$D" ]; then echo "ABORT: $D already exists"; exit 2; fi
mkdir -p "$D" "$R"
cd "$ROOT"
START=$(date +%s.%N)
git -c core.hooksPath=/dev/null -c core.autocrlf=false -c protocol.file.allow=never \
  clone --depth 1 --branch jazzy --no-tags https://github.com/ros2/demos "$D" 2>&1 | tail -3
END=$(date +%s.%N)
python3 -I -c 'import sys; print("clone_wall_s=%.2f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$START" "$END"
echo "commit=$(git -C "$D" rev-parse HEAD)"
git -C "$D" log -1 --format='commit_date=%cI%nsubject=%s'
echo "tracked_files=$(git -C "$D" ls-files | wc -l)"
echo "worktree_bytes_excluding_git=$(du -sb --exclude=.git "$D" | cut -f1)"
echo "git_dir_bytes=$(du -sb "$D/.git" | cut -f1)"
git -C "$D" ls-files -s | awk '$1 == "120000" {print "symlink:", $4}'
git -C "$D" ls-files | sed -n 's|\(.*\)\.\([A-Za-z0-9_]*\)$|\2|p' | sort | uniq -c | sort -rn | head -20
