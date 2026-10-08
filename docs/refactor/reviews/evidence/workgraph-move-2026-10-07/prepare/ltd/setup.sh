#!/usr/bin/env bash
# LTd setup (task D, the real WorkGraph split at H = 58ea2fdc, decision 40): a copy of base (base = git archive of H +
# node_modules, plus the two vendor runtime packages), history replaced by one commit tagged ladder-setup, setup record
# written outside the copy. The task is a pure move (the 18 moves M1-M18 of
# docs/refactor/reviews/evidence/workgraph-split-2026-10-07/moves.json) and the task book carries the whole move table.
# Stripped before the setup commit (2026-10-07, found by the oracle pair's canary check): the two evidence directories
# of task D's own preparation, which hold the answer material of this level (the reference move script wg-move.mjs and
# mk-expected.mjs with both canaries, the expected listing at 4404f4dc, the move-table draft, TASK-D-PLAN with the
# hidden checks). No test, script or config reads them; the move changes only src/ and tests/, so the patch made in
# the copy is unaffected.
#   bash ~/dsh-work/ladder/LTd/setup.sh [dest]      (default dest: ~/dsh-work/ladder/LTd-run)
set -euo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
DEST=${1:-$LADDER/LTd-run}
make_copy "$DEST"
rm -rf "$DEST/docs/refactor/reviews/evidence/workgraph-split-2026-10-07" "$DEST/docs/refactor/reviews/evidence/dsh-ladder-2026-10-07"
seal_copy "$DEST" LTd
echo "LTd copy ready: $DEST  (run DSH there with: node $COMMON/run-dsh.mjs run $DEST $LADDER/LTd/task-part1.md <runName> --level $LADDER/LTd)"
