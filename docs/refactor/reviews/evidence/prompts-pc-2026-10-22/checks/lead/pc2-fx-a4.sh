#!/bin/bash
# Land Codex's audit-4 patches (a8/A.out.md §3: A4-01 reads the J-06 manifest through the review Runtime's own
# MaterialPort instead of the internal loadPreparedManifest; A4-02 comment "two" -> "three") on s9pc2 at 2efd8f8, after
# rework 3 (the last; decision 81: Codex patches, the lead lands and checks). Typecheck, the two changed files with
# bubblewrap, A3-01's production mutation once more (RED, undo, GREEN), then commit as the lead. (lead, 2026-10-23 night)
set -u
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
D=/home/han001/dsh-work/slices/s9pc2; X=/mnt/d/cc-lead-notes/codex2/pc/a8
K=tests/runtime/PC2-joint-k3-history.test.ts; B=tests/runtime/PC2-joint-budget.test.ts
M=src/core/agent-runtime/context-history-facts.ts
av=$(free -m | awk '/Mem:/{print $7}'); [ "$av" -gt 2000 ] || { echo "available ${av} MB, not started"; exit 3; }
test "$(git -C $D rev-parse --short HEAD)" = 2efd8f8 || { echo "HEAD is not 2efd8f8"; exit 2; }
test -z "$(git -C $D status --porcelain)" || { echo "tree not clean"; exit 2; }
git -C $D apply --unidiff-zero $X/FX-A4-01.diff $X/FX-A4-02.diff || { echo "patches do not apply"; exit 2; }
git -C $D diff --stat | cat
cd $D || exit 1
mkdir -p .dsh-scratch
flock .dsh-scratch/tsc.lock npm run -s typecheck > /tmp/pc2-a4-tc.txt 2>&1; echo "typecheck $?"; tail -5 /tmp/pc2-a4-tc.txt
v() { timeout 900 npx vitest run --maxWorkers=2 "$@" 2>&1 | sed -r 's/\x1b\[[0-9;]*m//g' | grep -E "^ +(Test Files|Tests)|FAIL|AssertionError|Error:" | head -12; }
echo "== the two changed files"; v $K $B
echo "== A3-01 mutation: $M:33 -> return false"
grep -c 'return input.sessionBasis?.throughPosition != null || input.hasCompletedCursor;' $M
sed -i 's/return input.sessionBasis?.throughPosition != null || input.hasCompletedCursor;/return false;/' $M
git diff --stat -- src | cat
echo "-- RED expected"; v $K
git checkout -q -- $M; echo "production changes left: $(git diff --name-only -- src | wc -l)"
echo "-- GREEN expected"; v $K
git status --porcelain | cat
