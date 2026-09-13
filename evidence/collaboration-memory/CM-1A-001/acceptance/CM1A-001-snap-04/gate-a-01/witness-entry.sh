cd /mnt/d/1.project/Software/agent_platform
export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
bash evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/run-witness.sh --maxWorkers=1 > evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/witness.log 2>&1
result=$?
echo EXIT_CODE=$result >> evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/witness.log
exit $result