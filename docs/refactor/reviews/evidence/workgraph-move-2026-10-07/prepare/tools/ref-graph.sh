#!/usr/bin/env bash
# ref-graph.sh <out-dir>: TASK-D-PLAN §2 step 10 on the kept reference copy ~/dsh-work/ladder/LTd-ref: import graph after
# the move, the target check with target.json (fix B) and with the strict 10-02 declaration, the submodule graph, and
# check:architecture with the submodule fragment written into a THROWAWAY clone's module-target.json (never the copy).
set -euo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
OUT=$1; REF=$LADDER/LTd-ref
EVS=/mnt/d/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/reviews/evidence/workgraph-split-2026-10-07
mkdir -p "$OUT"; T=$(mktemp -d)
cd "$REF"
node scripts/import-graph.mjs --out "$T/after" > /dev/null
node "$EVS/scripts/assign.mjs" "$T/after/import-graph.json" "$EVS/target.json" > "$T/check-input.json"
node scripts/import-graph-check.mjs "$T/after/import-graph.json" "$T/check-input.json" > "$OUT/target-check-after.json" || true
node "$EVS/scripts/submodule-graph.mjs" "$T/after/import-graph.json" "$EVS/target.json" > "$OUT/submodule-graph-after.txt"
node "$EVS/scripts/submodule-graph.mjs" "$T/after/import-graph.json" "$EVS/variants/target-strict.json" > "$OUT/submodule-graph-after-strict.txt"
git -C "$REF" status --porcelain --ignored | grep -v node_modules > "$OUT/ref-status-after-graph.txt" || true
C=$T/clone; mkdir "$C"; rsync -a --exclude=/.git "$REF/" "$C/"
cd "$C"
for t in target variants/target-strict; do
  node "$EVS/scripts/with-fragment.mjs" docs/refactor/module-target.json "$EVS/$t.json"
  n=$(basename $t); { node scripts/check-boundaries.mjs; echo "check:architecture exit=$?"; } > "$OUT/check-architecture-with-submodules-${n}.txt" 2>&1 || echo "check:architecture exit=$?" >> "$OUT/check-architecture-with-submodules-${n}.txt"
  cp "$REF/docs/refactor/module-target.json" docs/refactor/module-target.json
done
rm -rf "$T"
echo ref-graph-done
