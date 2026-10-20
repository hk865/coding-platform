#!/bin/bash
# usage: suite.sh <maxWorkers> <unit-name>
set -u
WORKERS=${1:-4}
UNIT=${2:-t-cov-after}
EXTRA=${3:-}
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
SP=/mnt/d/cc-lead-notes/impl/t/coverage
COPY=/home/han001/dsh-work/slices/s9tcova
SAMPLES="$SP/mem-samples-$UNIT.txt"
: > "$SAMPLES"

avail=$(free -m | awk '/^Mem:/{print $7}')
echo "available before start: $avail MB"
if [ "$avail" -le 2000 ]; then echo "NOT ENOUGH MEMORY"; exit 99; fi

( cd "$COPY" && npm run -s build > "$SP/after-build.txt" 2>&1 ); BRC=$?
echo "build exit $BRC"; echo "$BRC" > "$SP/after-build.rc"
[ "$BRC" = 0 ] || { echo "BUILD FAILED"; exit 98; }

# sampler: wait for the scope to appear, then poll every 10 s while active
(
  i=0
  while ! systemctl --user is-active -q "$UNIT.scope"; do
    sleep 1; i=$((i+1)); [ $i -gt 120 ] && { echo "sampler: unit never became active" >> "$SAMPLES"; exit 0; }
  done
  while systemctl --user is-active -q "$UNIT.scope"; do
    pk=$(systemctl --user show "$UNIT.scope" -p MemoryPeak --value 2>/dev/null)
    cur=$(systemctl --user show "$UNIT.scope" -p MemoryCurrent --value 2>/dev/null)
    av=$(free -m | awk '/^Mem:/{print $7}')
    echo "$(date +%T) peak=$pk current=$cur avail_mb=$av" >> "$SAMPLES"
    sleep 10
  done
  echo "$(date +%T) unit no longer active" >> "$SAMPLES"
) &
SAMPLER=$!

START=$(date '+%F %T %Z')
echo "suite start $START (workers=$WORKERS unit=$UNIT)"
(
  cd "$COPY" && systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax=8G \
    --setenv=CODING_AGENT_BWRAP_PATH="$CODING_AGENT_BWRAP_PATH" \
    npx vitest run --maxWorkers="$WORKERS" --coverage.enabled --coverage.provider=v8 \
      --coverage.include='src/**' --coverage.reporter=json --coverage.reporter=json-summary \
      --coverage.reporter=text-summary --coverage.reportsDirectory=coverage-after $EXTRA \
      > ../t-cov-after.log 2>&1
)
RC=$?
END=$(date '+%F %T %Z')
wait $SAMPLER 2>/dev/null
echo "suite end $END exit $RC"
{
  echo "unit=$UNIT workers=$WORKERS"
  echo "start=$START"
  echo "end=$END"
  echo "exit=$RC"
} > "$SP/suite-$UNIT.meta"
tail -3 "$SAMPLES"
