#!/bin/bash
# Memory profile of the full suite (lead, 2026-10-20 night; the user asked for finer test-memory estimates).
# One full run on the merge copy (code = 0e381ce4) with per-file heap (--logHeapUsage), per-file start/end
# (JSON reporter) and the run's cgroup memory sampled every second. Copies only; writes under impl/t/mem.
# usage: mk-memprof.sh [workers]
set -u
WORKERS=${1:-5}
UNIT=t-memprof
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
OUT=/mnt/d/cc-lead-notes/impl/t/mem
COPY=/home/han001/dsh-work/slices/s9tmerge
test "$(git -C $COPY rev-parse --short HEAD)" = e99b385 || { echo "merge copy HEAD is not e99b385"; exit 2; }
avail=$(free -m | awk '/^Mem:/{print $7}')
echo "start $(date +%H:%M:%S) available $avail MB, workers $WORKERS, nproc $(nproc)"
[ "$avail" -gt 2000 ] || { echo "NOT ENOUGH MEMORY"; exit 99; }
SAMPLES=$OUT/samples.tsv
printf 'epoch_ms\tcurrent_bytes\tpeak_bytes\tavailable_mb\tworkers_running\n' > $SAMPLES
(
  i=0
  while ! systemctl --user is-active -q "$UNIT.scope"; do sleep 0.5; i=$((i+1)); [ $i -gt 240 ] && exit 0; done
  CG=/sys/fs/cgroup$(systemctl --user show "$UNIT.scope" -p ControlGroup --value)
  while [ -e "$CG/memory.current" ]; do
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%s%3N)" "$(cat $CG/memory.current)" "$(cat $CG/memory.peak 2>/dev/null || echo -)" \
      "$(free -m | awk '/^Mem:/{print $7}')" "$(pgrep -fc 'vitest/dist/workers' 2>/dev/null || echo 0)" >> $SAMPLES
    sleep 1
  done
) &
SAMPLER=$!
cd $COPY || exit 1
systemd-run --user --scope -q --unit=$UNIT -p MemoryMax=8G -p MemorySwapMax=0 \
  npx vitest run --maxWorkers=$WORKERS --logHeapUsage --reporter=default --reporter=json \
  --outputFile.json=$OUT/memprof.json > $OUT/memprof-run.txt 2>&1
RC=$?
wait $SAMPLER 2>/dev/null
echo "end $(date +%H:%M:%S) exit $RC"
tail -6 $OUT/memprof-run.txt | sed 's/\x1b\[[0-9;]*m//g'
awk -F'\t' 'NR>1 && $3!="-" {if ($3>p) p=$3} END {printf "scope peak %.0f MiB\n", p/1048576}' $SAMPLES
