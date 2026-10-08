#!/usr/bin/env bash
# visible.sh <out-dir>   (WSL; TASK-D-PLAN §2 step 4, the book's visible checks on a fresh LTd copy at H)
# 1. visible-check.mjs: the book's three commands in a throwaway clone (outside the sandbox, as a feedback round sees it);
# 2. the same three commands inside the DSH sandbox (run-dsh.mjs exec, no model), as DSH sees them.
# Run on a quiet machine, one after the other. The copy is dropped at the end.
set -uo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
OUT=$1; C=$LADDER/LTd-vis
mkdir -p "$OUT"
drop_copy "$C"; bash "$LADDER/LTd/setup.sh" "$C" > /dev/null
s=$(date +%s); node "$COMMON/visible-check.mjs" "$C" "$LADDER/LTd" > "$OUT/visible-clone.md" 2>&1; echo "visible-check secs=$(( $(date +%s) - s ))"
for cmd in "npm run typecheck" "npm run check:architecture" "npx vitest run tests/architecture tests/state tests/work-graph"; do
  s=$(date +%s)
  node "$COMMON/run-dsh.mjs" exec "$C" -- bash -c "NO_COLOR=1 $cmd 2>&1; echo \"(exit \$?)\"" > "$OUT/sandbox-$(echo "$cmd" | tr ' :/' '___').txt" 2>&1
  echo "sandbox '$cmd' secs=$(( $(date +%s) - s ))"
done
git -C "$C" status --short --ignored | grep -v node_modules > "$OUT/copy-status-after.txt" || true
drop_copy "$C"
echo visible-done
