#!/bin/bash
# Rerun S1's D2 byte proof (recovered probes, out-S1/files/probes) on s85-base and on the night-1 merge n1-merged.
# Copies under ~/dsh-work/s85-scratch/S1-rerun; node_modules hard-linked from s9sc. base-1, base-2, merge-1; compare
# base-1/base-2 and base-1/merge-1. (lead, 2026-10-21)
set -e
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
SL=/home/han001/dsh-work/slices; S=/home/han001/dsh-work/s85-scratch/S1-rerun; RC=/mnt/d/cc-lead-notes/impl/s85/probe-recover
test ! -e $S || { echo "$S exists"; exit 2; }
mkdir -p $S/base $S/merge
git -C $SL/s9s85b -c core.autocrlf=false archive s85-base | tar -x -C $S/base
git -C $SL/s9s85m -c core.autocrlf=false archive n1-merged | tar -x -C $S/merge
for C in base merge; do cp -al $SL/s9sc/node_modules $S/$C/node_modules; cp -al $SL/s9sc/vendor/coding-agent/node_modules $S/$C/vendor/coding-agent/node_modules; done
cp -r $RC/out-S1/files/probes $S/probes
python3 $S/probes/apply-probe.py $S/base
python3 $S/probes/apply-probe.py $S/merge
T="tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/S3-graph-tools.test.ts tests/runtime/K-readonly-command.test.ts tests/runtime/K3-14-record-unknown-call-review-tool.test.ts tests/runtime/K3-16-proposal-tool.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/runtime/B2-01-shell-hook.test.ts"
cap() {  # <copy> <log name>
  mkdir -p $S/probes/logs/$2
  ( cd $S/$1 && S85_PROBE_LOG_DIR=$S/probes/logs/$2 systemd-run --user --scope -q --unit=s85-probe-S1-$2 -p MemoryMax=4G timeout 900 npx vitest run --maxWorkers=2 $T > $S/$2-a.txt 2>&1; echo "$2 a exit $?" )
  ( cd $S/$1 && S85_PROBE_LOG_DIR=$S/probes/logs/$2 systemd-run --user --scope -q --unit=s85-probe-S1-$2b -p MemoryMax=4G timeout 900 npx vitest run --maxWorkers=2 tests/runtime/__probe-cases.test.ts > $S/$2-b.txt 2>&1; echo "$2 b exit $?" )
  for x in a b; do sed -r 's/\x1b\[[0-9;]*m//g' $S/$2-$x.txt | grep -E "^ +(Test Files|Tests) "; done
}
set +e
cap base base-1; cap base base-2; cap merge merge-1
cd $S/probes
echo "== base-1 vs base-2"; python3 compare.py logs/base-1 logs/base-2 > logs/base-compare.txt 2>&1; echo "exit $?"; tail -5 logs/base-compare.txt
echo "== base-1 vs merge-1"; python3 compare.py logs/base-1 logs/merge-1 > logs/merge-compare.txt 2>&1; echo "exit $?"; tail -5 logs/merge-compare.txt
for d in base-1 base-2 merge-1; do echo "$d: $(cat logs/$d/*.jsonl | wc -l) captures"; done
mkdir -p $RC/rerun-S1; cp logs/base-compare.txt logs/merge-compare.txt $RC/rerun-S1/; cp $S/*-a.txt $S/*-b.txt $RC/rerun-S1/
