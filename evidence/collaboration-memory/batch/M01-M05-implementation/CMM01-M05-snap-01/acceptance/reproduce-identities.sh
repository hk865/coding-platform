#!/bin/bash
set -e
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=/mnt/d/1.project/Software/agent_platform/.local/toolchains/bwrap/usr/bin/bwrap
node .local/linux-test-tools/node_modules/vitest/vitest.mjs run --config evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-01/acceptance/vitest.config.mjs --maxWorkers=1 same-local-identity > evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-01/acceptance/identities-confirmed.log 2>&1
