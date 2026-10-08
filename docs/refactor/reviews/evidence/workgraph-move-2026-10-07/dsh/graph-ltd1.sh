#!/usr/bin/env bash
# graph-ltd1.sh <out-dir>: TASK-D-PLAN §6.5 — the same §6 import-graph check as prepare/tools/ref-graph.sh, on a
# throwaway rsync clone of DSH's copy LTd-1 (the copy itself is only read).
set -euo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
OUT=$1; SRC=$LADDER/LTd-1
EVS=/mnt/d/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/reviews/evidence/workgraph-split-2026-10-07
mkdir -p "$OUT"; T=$(mktemp -d)
REF=$T/ltd1; mkdir "$REF"; rsync -a "$SRC/" "$REF/"
cd "$REF"
node scripts/import-graph.mjs --out "$T/after" > /dev/null
node "$EVS/scripts/assign.mjs" "$T/after/import-graph.json" "$EVS/target.json" > "$T/check-input.json"
node scripts/import-graph-check.mjs "$T/after/import-graph.json" "$T/check-input.json" > "$OUT/target-check-after.json" || true
node "$EVS/scripts/submodule-graph.mjs" "$T/after/import-graph.json" "$EVS/target.json" > "$OUT/submodule-graph-after.txt"
node "$EVS/scripts/submodule-graph.mjs" "$T/after/import-graph.json" "$EVS/variants/target-strict.json" > "$OUT/submodule-graph-after-strict.txt"
C=$T/clone; mkdir "$C"; rsync -a --exclude=/.git "$REF/" "$C/"
cd "$C"
for t in target variants/target-strict; do
  node "$EVS/scripts/with-fragment.mjs" docs/refactor/module-target.json "$EVS/$t.json"
  n=$(basename $t); { node scripts/check-boundaries.mjs; echo "check:architecture exit=$?"; } > "$OUT/check-architecture-with-submodules-${n}.txt" 2>&1 || echo "check:architecture exit=$?" >> "$OUT/check-architecture-with-submodules-${n}.txt"
  cp "$REF/docs/refactor/module-target.json" docs/refactor/module-target.json
done
rm -rf "$T"
git -C "$SRC" status --porcelain --ignored | grep -v node_modules > "$OUT/ltd1-status-after-graph.txt" || true
echo graph-ltd1-done
