#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
OUT=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
export C1_REAL_MODEL=1
bash scripts/test-wsl.sh tests/coordination/architecture-review-real-model.test.ts --maxWorkers=1 > "$OUT/real-model-02.log" 2>&1
code=$?
tail -90 "$OUT/real-model-02.log"
exit "$code"
