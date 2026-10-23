#!/bin/bash
# Apply Codex's J-06 fixture patch (a7/A.out.md §3, zero-context) to s9pc2 at 9e984e1, typecheck, run the lead's
# smoke test of the completed_turn branch and a sample of openRealRunHarness callers with bubblewrap; the smoke file is
# removed afterwards and nothing is committed here. (lead, 2026-10-23 night)
set -u
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
D=/home/han001/dsh-work/slices/s9pc2; N=/mnt/d/cc-lead-notes/impl/pc; P=/mnt/d/cc-lead-notes/codex2/pc/a7/FX-J06.diff
test "$(git -C $D rev-parse --short HEAD)" = 9e984e1 || { echo "HEAD is not 9e984e1"; exit 2; }
test -z "$(git -C $D status --porcelain)" || { echo "tree not clean"; exit 2; }
git -C $D apply --unidiff-zero $P || { echo "patch does not apply"; exit 2; }
git -C $D diff --stat | cat
cd $D || exit 1
mkdir -p .dsh-scratch
flock .dsh-scratch/tsc.lock npm run -s typecheck > /tmp/pc2-j06-tc.txt 2>&1; echo "typecheck $?"; tail -5 /tmp/pc2-j06-tc.txt
S=tests/runtime/PC2-zz-lead-smoke-j06.test.ts
cp $N/smoke/PC2-zz-lead-smoke-j06.test.ts $S
timeout 900 npx vitest run --maxWorkers=2 $S tests/runtime/PC2-joint-history.test.ts tests/runtime/PC-prepare-review-freeze.test.ts \
  tests/runtime/K3-35-workspace-baseline-prepare.test.ts tests/runtime/K3-review-preparation.test.ts \
  tests/work-graph/K3-47-continuation-gate.test.ts tests/work-graph/UCR-settle-review.test.ts \
  tests/business/K3-review-workflow-rows.test.ts > /tmp/pc2-j06-vitest.txt 2>&1; echo "vitest $?"
rm -f -- "${D:?}/${S:?}"
sed -r 's/\x1b\[[0-9;]*m//g' /tmp/pc2-j06-vitest.txt | grep -E "SMOKE|^ +(Test Files|Tests|Duration)|FAIL|Error:" | head -20
git status --porcelain | cat
