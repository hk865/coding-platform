#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_platform
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > evidence/collaboration-memory/CM-M01-001/implementation/continuation-01/types-04.log 2>&1
