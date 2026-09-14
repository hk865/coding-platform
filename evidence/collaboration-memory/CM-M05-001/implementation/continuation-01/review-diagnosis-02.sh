#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
bash scripts/test-wsl.sh tests/app/independent-review.test.ts -t 'runs a real independent' --maxWorkers=1 > evidence/collaboration-memory/CM-M05-001/implementation/continuation-01/review-diagnosis-02.log 2>&1
