#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
bash scripts/test-wsl.sh tests/control/architecture-inspection.test.ts tests/control/baseline-evolution.test.ts tests/control/baseline-evolution-port.test.ts tests/read-model/p1-14-baseline-change-view.test.ts tests/sqlite-read-model/p1-14-baseline-change-view.test.ts --maxWorkers=4 > "$OUT/source-selection-02.log" 2>&1
result=$?
tail -n 20 "$OUT/source-selection-02.log"
exit "$result"