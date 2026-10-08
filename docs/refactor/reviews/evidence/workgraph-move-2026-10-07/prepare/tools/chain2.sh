#!/usr/bin/env bash
# chain2.sh: after LTd/setup.sh started stripping the two task-D evidence directories: sync, regenerate expected.json,
# sync, re-measure the visible checks, rerun the oracle pair. Sequential, quiet machine.
set -uo pipefail
S=/mnt/c/Users/han001/AppData/Local/Temp/claude/D--1-project-Software-agent-next-main--claude-worktrees-claude-code-task-execution-f3cca6/e5036f9b-df59-40c2-bf49-8b148d5818f6/scratchpad
T=$S/dsh-ladder/_tools; P=$S/taskd/prepare
start=$(date +%s)
bash $T/sync.sh
bash $T/mk-move-data.sh LTd
bash $T/sync.sh
cmp $P/expected-unstripped.json $S/dsh-ladder/LTd/data/expected.json && echo "expected.json unchanged by the strip"
bash $P/tools/visible.sh $P/visible-stripped
bash $T/oracle-ltd.sh
echo chain2-secs=$(( $(date +%s) - start ))
