#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
C=evidence/collaboration-memory/CM-1C-001/implementation/continuation-01
OUT=evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-01
cp "$C/real-model-02.json" "$OUT/pre-freeze-model-reference.json"
C1_REAL_MODEL=1 bash scripts/test-wsl.sh tests/coordination/architecture-review-real-model.test.ts --maxWorkers=1 > "$OUT/logs/real-model.log" 2>&1
result=$?
if [ "$result" -eq 0 ]; then cp "$C/real-model-02.json" "$OUT/real-model.json"; fi
cp "$OUT/pre-freeze-model-reference.json" "$C/real-model-02.json"
exit "$result"
