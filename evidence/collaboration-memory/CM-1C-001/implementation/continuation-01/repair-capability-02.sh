#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
bash scripts/test-wsl.sh tests/coordination/coordination-capability.test.ts --maxWorkers=1 -t 'exploration with existing participation' > evidence/collaboration-memory/CM-1C-001/implementation/continuation-01/repair-capability-02.log 2>&1
