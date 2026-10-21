#!/bin/bash
# S3's e2 probe (guide, final Query input, tools at two points) on S3's own commit (s9s85-S3 HEAD = s85-base + S3),
# because its anchors in observed-model-run.ts are the base layout and the merge carries S1's rewrite of that file
# (the tools on the merge are covered by S1's probe rerun). Compares with base-run1 of rerun-S3.sh. (lead, 2026-10-21)
set -e
export PATH=$HOME/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH
export CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap
SL=/home/han001/dsh-work/slices; S=/home/han001/dsh-work/s85-scratch/S3-rerun; RC=/mnt/d/cc-lead-notes/impl/s85/probe-recover
E2=$S/probes/e2; C=$S/s3only-e2
test -d $E2/base-run1 || { echo "base-run1 missing"; exit 2; }
test ! -e $C || { echo "$C exists"; exit 2; }
mkdir -p $C; git -C $SL/s9s85-S3 -c core.autocrlf=false archive HEAD | tar -x -C $C
echo "S3 commit: $(git -C $SL/s9s85-S3 log --oneline -1 | cat)"
cp -al $SL/s9sc/node_modules $C/node_modules; cp -al $SL/s9sc/vendor/coding-agent/node_modules $C/vendor/coding-agent/node_modules
node $E2/apply-probes.mjs $C
set +e
bash $E2/run-capture.sh $C $E2/s3only $S/e2-s3only.log > /dev/null 2>&1; echo "e2 s3only exit $?"
grep -h "^status=" $S/e2-s3only.log | sort | uniq -c
( cd $E2 && node compare.mjs base-run1 s3only > $S/e2-compare-s3only.txt 2>&1; echo "e2 base vs s3only exit $?"; tail -8 $S/e2-compare-s3only.txt )
cp $S/e2-s3only.log $S/e2-compare-s3only.txt $RC/rerun-S3/
