#!/usr/bin/env bash
set -u
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs > /mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-M06-001/implementation/continuation-01/documents-01.log 2>&1
result=$?
tail -n 5 /mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-M06-001/implementation/continuation-01/documents-01.log
exit "$result"
