#!/usr/bin/env bash
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
bash scripts/test-wsl.sh tests/coordination --maxWorkers=4 > evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/targeted.log 2>&1
result=$?
echo EXIT_CODE=$result >> evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/targeted.log
exit $result
