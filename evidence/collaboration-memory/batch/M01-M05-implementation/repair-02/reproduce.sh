#!/usr/bin/env bash
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=/mnt/d/1.project/Software/agent_platform/.local/toolchains/bwrap/usr/bin/bwrap
cd /mnt/d/1.project/Software/agent_platform
pnpm --dir src/ui exec playwright test --config ../../evidence/collaboration-memory/batch/M01-M05-implementation/repair-02/playwright.config.mjs --repeat-each=3 > evidence/collaboration-memory/batch/M01-M05-implementation/repair-02/observe.log 2>&1
