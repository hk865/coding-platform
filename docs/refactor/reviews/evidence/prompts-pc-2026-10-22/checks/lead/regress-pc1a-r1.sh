#!/bin/bash
# Lead regression after PC-1a rework 1 (2026-10-22): the files DSH saw fail only for lack of bwrap, rerun with the
# bwrap path; one vitest command at a time, --maxWorkers=2.
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
cd /home/han001/dsh-work/slices/s9pc1a || exit 1
test "$(git rev-parse --short HEAD)" = dd89733 || { echo "HEAD moved"; exit 2; }
K="tests/kernel/K-readonly-sandbox.test.ts tests/kernel/RL-01-02-caps-effect.test.ts tests/kernel/RL-03-05-oom-pids.test.ts tests/kernel/RL-06-11-stop.test.ts tests/kernel/RL-12-15-conditions.test.ts tests/kernel/RL-15c-gate-stream-error.test.ts"
A="tests/app/A2-automation-verdict.test.ts tests/app/A2-requeue-route.test.ts tests/app/A2-reverify-route.test.ts tests/app/AG2b-collaboration.test.ts tests/app/MVP-workbench-tools.test.ts tests/app/R6-host.test.ts tests/app/change-emitters.test.ts tests/app/orchestration-mechanism.test.ts"
for set in "$K" "$A"; do
  npx vitest run --maxWorkers=2 $set 2>&1 | grep -E "Test Files|Tests |FAIL" | head -20
done
date +%H:%M
