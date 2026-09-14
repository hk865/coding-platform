#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
bash scripts/test-wsl.sh tests/app/explorations.test.ts --maxWorkers=1 -t 'executes a real read-only dependency chain' > evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-01/logs/exploration-repro.log 2>&1
