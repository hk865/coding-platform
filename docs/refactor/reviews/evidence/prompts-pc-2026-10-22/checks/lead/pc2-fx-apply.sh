#!/bin/bash
# Apply Codex's four fixture patches (J-04, J-06, J-08, J-09; a5/FX.out.md, checked by the lead) to s9pc2 at 2dae25f,
# typecheck, run the existing callers of the changed fixtures, then commit them as the rework-2 base and tag it.
# (lead, 2026-10-23 night)
set -u
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
D=/home/han001/dsh-work/slices/s9pc2; F=/mnt/d/cc-lead-notes/codex2/pc/a5
test "$(git -C $D rev-parse --short HEAD)" = 2dae25f || { echo "HEAD is not 2dae25f"; exit 2; }
test -z "$(git -C $D status --porcelain)" || { echo "tree not clean"; exit 2; }
cat $F/FX-1.diff $F/FX-2.diff $F/FX-3.diff $F/FX-4.diff > /tmp/pc2-fx.diff
git -C $D apply /tmp/pc2-fx.diff || { echo "patch does not apply"; exit 2; }
git -C $D diff --stat | cat
cd $D || exit 1
mkdir -p .dsh-scratch
flock .dsh-scratch/tsc.lock npm run -s typecheck > /tmp/pc2-fx-tc.txt 2>&1; echo "typecheck $?"; tail -5 /tmp/pc2-fx-tc.txt
timeout 900 npx vitest run --maxWorkers=2 tests/runtime/PC2-joint-history.test.ts tests/runtime/PC2-review-shrink.test.ts \
  tests/runtime/PC-joint-prepare-freeze.test.ts tests/runtime/PC-prepare-review-freeze.test.ts \
  tests/work-graph/PC-entry-frozen-review.test.ts tests/runtime/PC2-joint-tools.test.ts tests/runtime/PC2-joint-packs.test.ts \
  tests/composition/WP2-wiring.test.ts tests/runtime/S4C2-assembly.test.ts tests/runtime/PC2-declaration-prepare.test.ts \
  > /tmp/pc2-fx-vitest.txt 2>&1; echo "vitest $?"
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/pc2-fx-vitest.txt | grep -E "^ +(Test Files|Tests|Duration)|FAIL" | head -20
