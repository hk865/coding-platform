#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
bash scripts/test-wsl.sh tests/app/independent-review.test.ts -t 'runs a real independent read-only Reviewer' --maxWorkers=1 > evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-03/review-diagnosis.log 2>&1