#!/usr/bin/env bash
# For each wrap-up commit touching service files (src/ minus work-graph/state and ui):
# added lines (wrap-up's own) and deleted lines blamed to their origin commit.
set -euo pipefail
cd /d/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6
for c in "$@"; do
  files=$(git diff --name-only "$c^" "$c" -- src | grep -v '^src/ui/' | grep -v '^src/core/work-graph/state/' || true)
  for f in $files; do
    add=$(git diff --numstat "$c^" "$c" -- "$f" | awk '{print $1}')
    echo "ADD $c $f $add"
    git diff -U0 "$c^" "$c" -- "$f" | grep '^@@' | sed -E 's/^@@ -([0-9]+)(,([0-9]+))? .*/\1 \3/' | while read start len; do
      len=${len:-1}; [ "$len" = "0" ] && continue
      git blame --line-porcelain -L "$start,+$len" "$c^" -- "$f" | grep -E '^[0-9a-f]{40} ' | cut -c1-8 | while read o; do echo "DEL $c $f $o"; done
    done
  done
done
