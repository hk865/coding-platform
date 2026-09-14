#!/bin/bash
cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=/mnt/d/1.project/Software/agent_platform/.local/toolchains/bwrap/usr/bin/bwrap
node evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-02/acceptance/preconnect-repro.mjs > evidence/collaboration-memory/batch/M01-M05-implementation/CMM01-M05-snap-02/acceptance/preconnect-repro.log 2>&1
