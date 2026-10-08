#!/usr/bin/env bash
# Task D, stage DSH, part 1 (TASK-D-PLAN §5): fresh copy LTd-1, then DSH part 1 in the bubblewrap runner.
set -uo pipefail
L=~/dsh-work/ladder; . $L/_common/env.sh
S=/mnt/c/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/e5036f9b-df59-40c2-bf49-8b148d5818f6/scratchpad
OUT=$S/taskd/dsh
[ -e $L/LTd-1 ] && { echo "LTd-1 exists"; exit 2; }
date -Is > $OUT/p1.start
bash $L/LTd/setup.sh $L/LTd-1 > $OUT/setup-LTd-1.log 2>&1 || { echo setup failed; exit 3; }
node $COMMON/run-dsh.mjs run $L/LTd-1 $L/LTd/task-part1.md LTd-1-p1 --level $L/LTd > $OUT/p1.runner.out 2>&1
echo "runner exit $?" >> $OUT/p1.runner.out
date -Is > $OUT/p1.end
